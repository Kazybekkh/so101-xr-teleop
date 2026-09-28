"""Receive and validate controller packets without connecting any hardware."""

from __future__ import annotations

import asyncio
import json

from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed

if __package__:
    from .protocol import MAX_PACKET_BYTES, get_server_config, parse_packet
else:
    from protocol import MAX_PACKET_BYTES, get_server_config, parse_packet


class DryRunBridge:
    """One controller connection, with truthful acknowledgements and counts."""

    def __init__(self) -> None:
        self.accepted_packets = 0
        self.rejected_packets = 0
        self.arm_latched = False
        self.controller_count = 0
        self._client = None

    def _status(self, accepted: bool) -> dict:
        return {
            "type": "dry-run",
            "mode": "dry-run",
            "accepted": accepted,
            "packetsAccepted": self.accepted_packets,
            "packetsRejected": self.rejected_packets,
            "armLatched": self.arm_latched,
            "controllerCount": self.controller_count,
            "hardwareConnected": False,
        }

    async def handle_client(self, websocket) -> None:
        if self._client is not None:
            await websocket.close(code=1013, reason="Another controller client is connected")
            return
        self._client = websocket
        print("[dry-run] Controller connected; hardware remains disconnected.", flush=True)
        try:
            async for raw in websocket:
                try:
                    packet = parse_packet(raw)
                except ValueError as exc:
                    self.rejected_packets += 1
                    response = self._status(False)
                    response["error"] = str(exc)
                    print(f"[dry-run] Rejected packet #{self.rejected_packets}: {exc}", flush=True)
                else:
                    previous_latch = self.arm_latched
                    self.accepted_packets += 1
                    self.arm_latched = packet["armLatched"]
                    self.controller_count = len(packet["controllers"])
                    response = self._status(True)
                    if self.accepted_packets == 1 or self.accepted_packets % 30 == 0 or previous_latch != self.arm_latched:
                        print(
                            f"[dry-run] accepted={self.accepted_packets} rejected={self.rejected_packets} "
                            f"controllers={self.controller_count} requested_latch={self.arm_latched}; no motor commands",
                            flush=True,
                        )
                await websocket.send(json.dumps(response))
        except ConnectionClosed:
            pass
        finally:
            self._client = None
            self.arm_latched = False
            self.controller_count = 0
            print("[dry-run] Controller disconnected; requested latch cleared.", flush=True)


async def amain() -> None:
    host, port, tls = get_server_config()
    bridge = DryRunBridge()
    async with serve(bridge.handle_client, host, port, ssl=tls, max_size=MAX_PACKET_BYTES, max_queue=1):
        scheme = "wss" if tls is not None else "ws"
        display_host = f"[{host}]" if ":" in host else host
        print(f"[dry-run] Listening on {scheme}://{display_host}:{port}", flush=True)
        print("[dry-run] Input validation only; no robot, serial port, camera, or IK solver is opened.", flush=True)
        await asyncio.Future()
