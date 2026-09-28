#!/usr/bin/env python3
"""
Webcam Broadcaster (Side A)

Captures your laptop webcam and streams it to Cloudflare Realtime SFU.
When running, it prints a viewer URL you open on the Zapbox.

Usage:
    python main.py

Requires .env file (or env vars):
    CLOUDFLARE_REALTIME_APP_ID=your_app_id
    CLOUDFLARE_REALTIME_TOKEN=your_token

Optional env vars:
    WEBCAM_DEVICE=0          (default: 0 — first webcam)
    CAMERA_SOURCE=           (OpenCV source: device index, /dev/video0, or http://…)
    WEBCAM_WIDTH=640         (default: 640)
    WEBCAM_HEIGHT=480        (default: 480)
    TRACK_NAME=robot-camera  (default: robot-camera)
    VIEWER_URL=https://teleop.robot-elo.com   (base URL hosting the viewer)
    VIEWER_STEREO=sbs        (printed viewer URL stereo mode: mono|sbs)
    BRIDGE_URL=              (optional ws/wss URL of the bridge/main.py
                              — if set, included in the viewer link / QR code)
"""

import asyncio
import json
import os
import socket
import sys
import time
import fractions
import urllib.parse
from pathlib import Path

import aiohttp
import numpy as np
import qrcode
from av import VideoFrame
from aiortc import RTCPeerConnection, RTCSessionDescription, VideoStreamTrack


def lan_ip() -> str:
    """Best-guess of this machine's LAN IP address (the one Zapbox can reach)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # We never actually send anything; this just lets the OS pick the
        # outgoing interface and tell us its IP.
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


LAN_IP = lan_ip()

# ---------------------------------------------------------------------------
# Config — reads from .env file or environment
# ---------------------------------------------------------------------------

def load_env():
    env_path = Path(__file__).parent / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, val = line.partition("=")
                os.environ.setdefault(key.strip(), val.strip())

load_env()

APP_ID     = os.environ.get("CLOUDFLARE_REALTIME_APP_ID", "")
TOKEN      = os.environ.get("CLOUDFLARE_REALTIME_TOKEN", "")
_raw_source = os.environ.get("CAMERA_SOURCE") or os.environ.get("WEBCAM_DEVICE", "0")
DEVICE     = int(_raw_source) if str(_raw_source).isdigit() else _raw_source
WIDTH      = int(os.environ.get("WEBCAM_WIDTH", "640"))
HEIGHT     = int(os.environ.get("WEBCAM_HEIGHT", "480"))
TRACK_NAME = os.environ.get("TRACK_NAME", "robot-camera")
USE_TEST_PATTERN = os.environ.get("USE_TEST_PATTERN", "").lower() in ("1", "true", "yes")
VIEWER_URL = os.environ.get("VIEWER_URL", f"http://{LAN_IP}:3000").rstrip("/")
VIEWER_STEREO = os.environ.get("VIEWER_STEREO", "sbs").strip() or "sbs"
BRIDGE_URL = os.environ.get("BRIDGE_URL", "").strip()
CF_BASE    = "https://rtc.live.cloudflare.com/v1/apps"

# ---------------------------------------------------------------------------
# Test pattern fallback (no camera required)
# ---------------------------------------------------------------------------

class TestPatternTrack(VideoStreamTrack):
    """Generates a moving colour-bar test pattern when webcam is unavailable."""

    kind = "video"

    def __init__(self, width: int = 640, height: int = 480):
        super().__init__()
        self.width = width
        self.height = height
        self._frame_count = 0
        print(f"[test-pattern] Generating {width}x{height} colour bars")

    async def recv(self) -> VideoFrame:
        pts, time_base = await self.next_timestamp()

        img = np.zeros((self.height, self.width, 3), dtype=np.uint8)
        bar_w = self.width // 8
        colors = [
            (192, 192, 192), (192, 192, 0), (0, 192, 192), (0, 192, 0),
            (192, 0, 192), (192, 0, 0), (0, 0, 192), (0, 0, 0),
        ]
        offset = (self._frame_count * 2) % self.width
        for i, color in enumerate(colors):
            x_start = (i * bar_w + offset) % self.width
            x_end = x_start + bar_w
            if x_end <= self.width:
                img[:, x_start:x_end] = color
            else:
                img[:, x_start:] = color
                img[:, :x_end - self.width] = color
        self._frame_count += 1

        frame = VideoFrame.from_ndarray(img, format="rgb24")
        frame.pts = pts
        frame.time_base = time_base
        return frame

    def stop(self):
        super().stop()
        print("[test-pattern] Stopped.")

# ---------------------------------------------------------------------------
# Webcam video track
# ---------------------------------------------------------------------------

class WebcamVideoTrack(VideoStreamTrack):
    """Reads frames from the system webcam via OpenCV."""

    kind = "video"

    def __init__(self, device: int | str = 0, width: int = 640, height: int = 480):
        super().__init__()
        import cv2
        self._cv2 = cv2
        self.cap = cv2.VideoCapture(device)
        if not self.cap.isOpened():
            raise RuntimeError(
                f"Could not open camera source {device!r}. "
                f"Try CAMERA_SOURCE=/dev/video0 or an http:// MJPEG URL."
            )
        if isinstance(device, int):
            self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
            self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
            self.cap.set(cv2.CAP_PROP_FPS, 30)
        print(f"[webcam] Opened {device!r} (requested {width}x{height})")

    async def recv(self) -> VideoFrame:
        pts, time_base = await self.next_timestamp()

        ret, bgr = self.cap.read()
        if not ret:
            raise RuntimeError("Webcam read failed — camera disconnected?")

        rgb = self._cv2.cvtColor(bgr, self._cv2.COLOR_BGR2RGB)
        frame = VideoFrame.from_ndarray(rgb, format="rgb24")
        frame.pts = pts
        frame.time_base = time_base
        return frame

    def stop(self):
        super().stop()
        self.cap.release()
        print("[webcam] Camera released.")

# ---------------------------------------------------------------------------
# Cloudflare Realtime signaling helpers
# ---------------------------------------------------------------------------

def cf_headers() -> dict:
    return {
        "Authorization": f"Bearer {TOKEN}",
        "Content-Type": "application/json",
    }


async def create_cf_session(
    http: aiohttp.ClientSession,
    offer_sdp: str,
    offer_type: str,
) -> dict:
    """Create a CF session with the SDP offer. Returns sessionId + answer SDP."""
    url = f"{CF_BASE}/{APP_ID}/sessions/new"
    body = {
        "sessionDescription": {"type": offer_type, "sdp": offer_sdp},
    }
    async with http.post(url, headers=cf_headers(), json=body) as resp:
        if not resp.ok:
            err = await resp.text()
            raise RuntimeError(f"CF create session failed {resp.status}: {err}")
        data = await resp.json()
    print(f"[cloudflare] Session created: {data['sessionId']}")
    return data


async def register_tracks(
    http: aiohttp.ClientSession,
    session_id: str,
    mid: str,
    track_name: str,
) -> dict:
    """Register named tracks with Cloudflare after the session is connected."""
    url = f"{CF_BASE}/{APP_ID}/sessions/{session_id}/tracks/new"
    body = {
        "tracks": [
            {
                "location": "local",
                "mid": mid,
                "trackName": track_name,
            }
        ],
    }
    async with http.post(url, headers=cf_headers(), json=body) as resp:
        if not resp.ok:
            text = await resp.text()
            raise RuntimeError(f"CF register tracks failed {resp.status}: {text}")
        return await resp.json()


async def register_current_session(
    http: aiohttp.ClientSession,
    viewer_base: str,
    session_id: str,
    track_name: str,
) -> None:
    """Tell the Next.js viewer which CF session is the live default room."""
    import ssl

    url = f"{viewer_base}/api/viewer/current"
    body = {"sessionId": session_id, "trackName": track_name, "room": "elo"}
    # Local mkcert / Next experimental-https certs are not in the system trust store.
    ssl_arg: ssl.SSLContext | bool = True
    if viewer_base.startswith("https://") and any(
        host in viewer_base for host in (LAN_IP, "127.0.0.1", "localhost")
    ):
        ssl_arg = False
    try:
        async with http.post(url, json=body, ssl=ssl_arg) as resp:
            if not resp.ok:
                text = await resp.text()
                print(f"[viewer] Failed to register current session ({resp.status}): {text}")
            else:
                print("[viewer] Registered current session for /viewer")
    except Exception as e:
        print(f"[viewer] Could not register current session: {e}")


# ---------------------------------------------------------------------------
# ICE gathering helper
# ---------------------------------------------------------------------------

async def wait_for_ice(pc: RTCPeerConnection, timeout: float = 5.0) -> None:
    """Wait until ICE gathering completes or timeout is reached."""
    if pc.iceGatheringState == "complete":
        return
    future: asyncio.Future = asyncio.get_event_loop().create_future()

    def on_state_change():
        if pc.iceGatheringState == "complete" and not future.done():
            future.set_result(None)

    pc.on("icegatheringstatechange", on_state_change)
    try:
        await asyncio.wait_for(future, timeout=timeout)
    except asyncio.TimeoutError:
        print(f"[webrtc] ICE gathering timed out after {timeout}s — continuing anyway")


# ---------------------------------------------------------------------------
# Main broadcast loop
# ---------------------------------------------------------------------------

async def run():
    if not APP_ID or not TOKEN:
        print(
            "ERROR: Missing Cloudflare credentials.\n"
            "Create broadcaster/.env with:\n"
            "  CLOUDFLARE_REALTIME_APP_ID=your_app_id\n"
            "  CLOUDFLARE_REALTIME_TOKEN=your_token\n"
            "\nGet these from: https://dash.cloudflare.com → Realtime → Create App"
        )
        sys.exit(1)

    print("=" * 55)
    print("  Webcam Broadcaster")
    print("=" * 55)

    if USE_TEST_PATTERN:
        video_source = TestPatternTrack(width=WIDTH, height=HEIGHT)
    else:
        try:
            video_source = WebcamVideoTrack(device=DEVICE, width=WIDTH, height=HEIGHT)
        except RuntimeError as e:
            print(f"[webcam] {e}")
            print("[webcam] Falling back to test pattern — grant camera permission to fix")
            video_source = TestPatternTrack(width=WIDTH, height=HEIGHT)

    pc = RTCPeerConnection()

    async with aiohttp.ClientSession() as http:
        sender = pc.addTrack(video_source)

        offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        print("[webrtc] Offer created, gathering ICE candidates...")

        await wait_for_ice(pc)

        mid = None
        for transceiver in pc.getTransceivers():
            if transceiver.sender == sender:
                mid = transceiver.mid
                break

        if mid is None:
            raise RuntimeError("Could not find MID for video track")

        print(f"[webrtc] Video track MID: {mid}")

        # Step 1: Create session with the SDP offer
        print("[cloudflare] Creating session...")
        session_data = await create_cf_session(
            http,
            pc.localDescription.sdp,
            pc.localDescription.type,
        )

        session_id = session_data["sessionId"]
        answer = RTCSessionDescription(
            type=session_data["sessionDescription"]["type"],
            sdp=session_data["sessionDescription"]["sdp"],
        )
        await pc.setRemoteDescription(answer)

        # Step 2: Register the named track so viewers can subscribe
        print("[cloudflare] Registering track...")
        await register_tracks(http, session_id, mid, TRACK_NAME)

        # The recovered Zapbox viewer explicitly selects a publisher session.
        params = {"session": session_id, "track": TRACK_NAME, "stereo": VIEWER_STEREO}
        if BRIDGE_URL:
            params["bridge"] = BRIDGE_URL
        viewer_link = f"{VIEWER_URL}/viewer?{urllib.parse.urlencode(params)}"

        print()
        print("=" * 55)
        print("  STREAMING — webcam is live!")
        print("=" * 55)
        print()
        print(f"  {viewer_link}")
        print(f"  session (debug): {session_id}")
        print()
        print("  Scan this on the Zapbox to open the viewer:")
        print()
        qr = qrcode.QRCode(border=1)
        qr.add_data(viewer_link)
        qr.make()
        qr.print_ascii(invert=True)
        print()
        if not BRIDGE_URL:
            print("  (set BRIDGE_URL in .env to also drive the SO101 arm)")
        print("  Press Ctrl+C to stop.")
        print()

        try:
            while True:
                await asyncio.sleep(1)
        except (KeyboardInterrupt, asyncio.CancelledError):
            pass
        finally:
            print("\n[broadcaster] Shutting down...")
            video_source.stop()
            await pc.close()
            print("[broadcaster] Done.")


if __name__ == "__main__":
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        pass
