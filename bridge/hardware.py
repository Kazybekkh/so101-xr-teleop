#!/usr/bin/env python
"""
Zapbox / WebXR -> SO101 follower bridge.

Receives ``InputPacket`` JSON messages from the Next.js viewer over WebSocket
and drives the SO101 follower arm over USB.

Architecture
------------

The viewer pushes one ``InputPacket`` every ~33 ms. The WS handler does not
process them directly — it only stores the latest packet. A single
``control_loop`` task pulls that latest packet at most ``TARGET_HZ`` times
per second and runs it through the pipeline. This:

  * keeps the serial port single-threaded (no "Port is in use!" races),
  * drops stale input — only the freshest packet wins, so if the bridge
    can't keep up the arm tracks the *current* hand pose, not a backlog,
  * gives a stable, predictable cadence regardless of WS jitter.

Pipeline (per processed packet):

    InputPacket
      -> MapXRActionToRobotAction        (xr.packet -> target_*)
      -> EEReferenceAndDelta             (target_* -> ee.* using latched FK)
      -> EEClampStep                     (clip + clamp jump magnitude)
      -> GripperVelocityToJoint          (ee.gripper_vel -> ee.gripper_pos)
      -> InverseKinematicsEEToJoints     (ee.* -> *.pos via Placo IK)
      -> JointClampStep                  (limit max °/frame — prevents IK flips)
      -> follower.send_action(...)       (write Goal_Position over USB)

Configuration via env vars (or ``.env`` next to this file):

    FOLLOWER_PORT       USB port for the SO101 follower
    FOLLOWER_ID         Calibration id stored under ~/.cache/huggingface/lerobot
    WS_PORT             WebSocket listen port (default: 8765)
    URDF_PATH           Path to the SO101 URDF (auto-downloaded if missing)
    EE_STEP_SIZE        Position scaling for controller deltas (default: 1.0)
    EE_MAX_STEP_M       Max EE motion per processed frame in metres (default: 0.08)
    TARGET_HZ           Upper bound on control loop rate (default: 15)
    MAX_JOINT_DELTA_DEG Max joint change per frame in degrees (default: 5.0)
    XR_ROT_SCALE        Wrist-following gain. 0 = ignore controller rotation
                        entirely (default: 0.0).
    XR_ROT_DEADBAND     Rotation deadband in radians (default: 0.05 ≈ 2.9°).
    XR_POS_DEADBAND     Position deadband in metres (default: 0.005 = 5 mm).
"""

from __future__ import annotations

import asyncio
import json
import math
import os
import signal
import sys
import threading
import time
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

THIS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(THIS_DIR))

# Load .env file next to this script if present.
ENV_PATH = THIS_DIR / ".env"
if ENV_PATH.exists():
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())

import websockets

from lerobot.model.kinematics import RobotKinematics
from lerobot.processor import (
    RobotAction,
    RobotActionProcessorStep,
    RobotObservation,
    RobotProcessorPipeline,
)
from lerobot.processor.converters import (
    robot_action_observation_to_transition,
    transition_to_robot_action,
)
from lerobot.robots.so_follower import SO101Follower, SO101FollowerConfig
from lerobot.robots.so_follower.robot_kinematic_processor import (
    EEReferenceAndDelta,
    GripperVelocityToJoint,
    InverseKinematicsEEToJoints,
)

from xr_mapper import MapXRActionToRobotAction
from protocol import get_server_config, parse_packet


# ---------------------------------------------------------------------------
# Custom pipeline steps
# ---------------------------------------------------------------------------


@dataclass
class EEClampStep(RobotActionProcessorStep):
    """Clamp EE position to bounds and limit per-frame step magnitude."""

    end_effector_bounds: dict
    max_ee_step_m: float = 0.05
    _last_pos: np.ndarray | None = field(default=None, init=False, repr=False)

    def action(self, action: RobotAction) -> RobotAction:
        pos = np.array([action["ee.x"], action["ee.y"], action["ee.z"]], dtype=float)
        pos = np.clip(
            pos,
            self.end_effector_bounds["min"],
            self.end_effector_bounds["max"],
        )

        if self._last_pos is not None:
            dpos = pos - self._last_pos
            n = float(np.linalg.norm(dpos))
            if n > self.max_ee_step_m and n > 0:
                pos = self._last_pos + dpos * (self.max_ee_step_m / n)

        self._last_pos = pos

        action["ee.x"] = float(pos[0])
        action["ee.y"] = float(pos[1])
        action["ee.z"] = float(pos[2])
        return action

    def reset(self) -> None:
        self._last_pos = None

    def transform_features(self, features):
        return features


@dataclass
class JointClampStep(RobotActionProcessorStep):
    """Bound each IK target relative to the measured joints for this update.

    Seeding on every step bounds the first command and prevents targets from
    advancing indefinitely while a joint is stalled. This is a target-step
    limit, not a measured actuator-speed or collision guarantee.
    """

    motor_names: list[str]
    max_delta_deg: float = 5.0
    _last_joints: dict[str, float] | None = field(default=None, init=False, repr=False)

    def seed(self, observation: dict[str, float]) -> None:
        """Bound the next target from measured joints, including the first frame."""
        if not math.isfinite(self.max_delta_deg) or self.max_delta_deg <= 0:
            raise ValueError("Joint clamp limit must be finite and positive")
        measured = {n: float(observation[f"{n}.pos"]) for n in self.motor_names}
        if not all(math.isfinite(value) for value in measured.values()):
            raise ValueError("Non-finite measured joint position")
        self._last_joints = measured

    def action(self, action: RobotAction) -> RobotAction:
        if self._last_joints is None:
            raise RuntimeError("Joint clamp must be seeded from measured joints")

        clamped = False
        for name in self.motor_names:
            key = f"{name}.pos"
            cur = float(action[key])
            if not math.isfinite(cur):
                raise ValueError(f"Non-finite IK target for {name}")
            prev = self._last_joints[name]
            delta = cur - prev
            if abs(delta) > self.max_delta_deg:
                cur = prev + max(-self.max_delta_deg, min(self.max_delta_deg, delta))
                action[key] = cur
                clamped = True
            self._last_joints[name] = cur

        if clamped:
            print(f"[bridge] joint clamp active")

        return action

    def reset(self) -> None:
        self._last_joints = None

    def transform_features(self, features):
        return features


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

FOLLOWER_PORT = os.environ.get("FOLLOWER_PORT", "")
FOLLOWER_ID = os.environ.get("FOLLOWER_ID", "so101_follower")
URDF_PATH = os.environ.get("URDF_PATH", str(THIS_DIR / "SO101" / "so101_new_calib.urdf"))

EE_STEP_SIZE = float(os.environ.get("EE_STEP_SIZE", "1.0"))
EE_MAX_STEP_M = float(os.environ.get("EE_MAX_STEP_M", "0.08"))

# 15 Hz target: the Feetech half-duplex bus does a read+write per step
# (2 serial transactions). At 15 Hz = 30 transactions/s, well within the
# bus's capacity. 30 Hz caused "Port is in use!" floods.
TARGET_HZ = float(os.environ.get("TARGET_HZ", "15"))
if not math.isfinite(TARGET_HZ) or TARGET_HZ <= 0:
    raise ValueError("TARGET_HZ must be finite and positive")
TARGET_DT = 1.0 / TARGET_HZ
INPUT_TIMEOUT_S = float(os.environ.get("INPUT_TIMEOUT_S", "0.25"))
if not math.isfinite(INPUT_TIMEOUT_S) or INPUT_TIMEOUT_S <= 0:
    raise ValueError("INPUT_TIMEOUT_S must be finite and positive")

# Max joint position change per frame (degrees). At 15 Hz, 5°/frame =
# 75°/s max angular velocity — plenty for smooth teleop.
MAX_JOINT_DELTA_DEG = float(os.environ.get("MAX_JOINT_DELTA_DEG", "5.0"))
for _name, _value in {
    "MAX_JOINT_DELTA_DEG": MAX_JOINT_DELTA_DEG,
    "EE_MAX_STEP_M": EE_MAX_STEP_M,
    "EE_STEP_SIZE": EE_STEP_SIZE,
}.items():
    if not math.isfinite(_value) or _value <= 0:
        raise ValueError(f"{_name} must be finite and positive")

XR_ROT_SCALE = float(os.environ.get("XR_ROT_SCALE", "0.0"))
XR_ROT_DEADBAND = float(os.environ.get("XR_ROT_DEADBAND", "0.05"))
XR_POS_DEADBAND = float(os.environ.get("XR_POS_DEADBAND", "0.005"))

URDF_BASE_URL = (
    "https://raw.githubusercontent.com/TheRobotStudio/SO-ARM100/main/Simulation/SO101"
)
URDF_URL = f"{URDF_BASE_URL}/so101_new_calib.urdf"

URDF_ASSETS = [
    "assets/base_motor_holder_so101_v1.stl",
    "assets/base_so101_v2.stl",
    "assets/motor_holder_so101_base_v1.stl",
    "assets/motor_holder_so101_wrist_v1.stl",
    "assets/moving_jaw_so101_v1.stl",
    "assets/rotation_pitch_so101_v1.stl",
    "assets/sts3215_03a_no_horn_v1.stl",
    "assets/sts3215_03a_v1.stl",
    "assets/under_arm_so101_v1.stl",
    "assets/upper_arm_so101_v1.stl",
    "assets/waveshare_mounting_plate_so101_v2.stl",
    "assets/wrist_roll_follower_so101_v1.stl",
    "assets/wrist_roll_pitch_so101_v2.stl",
]

# ---------------------------------------------------------------------------
# URDF download
# ---------------------------------------------------------------------------


def _download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url, timeout=30) as resp:
        dest.write_bytes(resp.read())


def ensure_urdf(path: str) -> None:
    """Download the SO101 URDF and all mesh STLs into the URDF's directory."""
    urdf_path = Path(path)
    urdf_dir = urdf_path.parent

    if not (urdf_path.exists() and urdf_path.stat().st_size > 0):
        print(f"[bridge] URDF missing, downloading: {URDF_URL}")
        try:
            _download(URDF_URL, urdf_path)
            print(f"[bridge] URDF saved at {urdf_path}")
        except Exception as e:
            raise RuntimeError(f"Failed to download URDF from {URDF_URL}: {e}")

    missing = [a for a in URDF_ASSETS if not (urdf_dir / a).exists()]
    if not missing:
        return

    print(f"[bridge] Downloading {len(missing)} URDF mesh asset(s)...")
    for rel in missing:
        url = f"{URDF_BASE_URL}/{rel}"
        dest = urdf_dir / rel
        try:
            _download(url, dest)
        except Exception as e:
            raise RuntimeError(f"Failed to download mesh {url}: {e}")
    print("[bridge] All mesh assets present.")


# ---------------------------------------------------------------------------
# Bridge
# ---------------------------------------------------------------------------


class TeleopBridge:
    def __init__(self) -> None:
        if not FOLLOWER_PORT:
            raise ValueError("Set FOLLOWER_PORT before using --hardware")
        ensure_urdf(URDF_PATH)

        print(f"[bridge] Initializing SO101 follower on {FOLLOWER_PORT} (id={FOLLOWER_ID})")
        self.robot = SO101Follower(
            SO101FollowerConfig(
                port=FOLLOWER_PORT,
                id=FOLLOWER_ID,
                use_degrees=True,
            )
        )

        print(f"[bridge] Loading URDF: {URDF_PATH}")
        self.kinematics = RobotKinematics(
            urdf_path=URDF_PATH,
            target_frame_name="gripper_frame_link",
            joint_names=list(self.robot.bus.motors.keys()),
        )

        motor_names = list(self.robot.bus.motors.keys())
        self.motor_names = motor_names
        self.joint_clamp = JointClampStep(
            motor_names=motor_names, max_delta_deg=MAX_JOINT_DELTA_DEG
        )

        self.pipeline = RobotProcessorPipeline[
            tuple[RobotAction, RobotObservation], RobotAction
        ](
            steps=[
                MapXRActionToRobotAction(
                    pos_deadband_m=XR_POS_DEADBAND,
                    rot_deadband_rad=XR_ROT_DEADBAND,
                    rot_scale=XR_ROT_SCALE,
                ),
                EEReferenceAndDelta(
                    kinematics=self.kinematics,
                    end_effector_step_sizes={
                        "x": EE_STEP_SIZE,
                        "y": EE_STEP_SIZE,
                        "z": EE_STEP_SIZE,
                    },
                    motor_names=motor_names,
                    use_latched_reference=True,
                ),
                EEClampStep(
                    end_effector_bounds={
                        "min": [-1.0, -1.0, -1.0],
                        "max": [1.0, 1.0, 1.0],
                    },
                    max_ee_step_m=EE_MAX_STEP_M,
                ),
                GripperVelocityToJoint(speed_factor=20.0),
                InverseKinematicsEEToJoints(
                    kinematics=self.kinematics,
                    motor_names=motor_names,
                    initial_guess_current_joints=True,
                ),
                self.joint_clamp,
            ],
            to_transition=robot_action_observation_to_transition,
            to_output=transition_to_robot_action,
        )

        self._connected_clients = 0

        self._latest_packet: dict[str, Any] | None = None
        self._packet_lock = threading.Lock()
        self._last_packet_time = 0.0
        self._hold_requested = False
        self._needs_release = True

        self._prev_arm_latched = False

        self._step_count = 0
        self._last_stats_time = time.perf_counter()
        self._error_count = 0

    def connect(self) -> None:
        print("[bridge] Connecting to robot bus...")
        self.robot.connect()
        if not self.robot.is_connected:
            raise RuntimeError("SO101 follower failed to connect")
        print("[bridge] Robot connected.")

    def disconnect(self) -> None:
        try:
            self.robot.disconnect()
            print("[bridge] Robot disconnected cleanly.")
        except Exception as e:
            print(f"[bridge] Robot disconnect error: {e}")

    def _set_packet(self, packet: dict[str, Any]) -> None:
        with self._packet_lock:
            self._latest_packet = packet
            self._last_packet_time = time.monotonic()

    def request_hold(self) -> None:
        with self._packet_lock:
            self._latest_packet = None
            self._hold_requested = True

    def _take_packet(self) -> dict[str, Any] | None:
        """Atomically take the latest packet. Returns ``None`` when idle."""
        with self._packet_lock:
            packet = self._latest_packet
            self._latest_packet = None
        return packet

    def hold(self) -> dict[str, float]:
        """Hold measured joints once; never continue toward an old IK target."""
        result = {}
        if self._prev_arm_latched:
            observation = self.robot.get_observation()
            measured = {f"{name}.pos": float(observation[f"{name}.pos"]) for name in self.motor_names}
            if not all(math.isfinite(value) for value in measured.values()):
                raise ValueError("Cannot hold non-finite measured joint positions")
            result = self.robot.send_action(measured)
        self._prev_arm_latched = False
        self.pipeline.reset()
        return result

    def step(self, packet: dict[str, Any]) -> dict[str, float]:
        """Run one packet through the pipeline and command the arm.

        Called only from the single ``control_loop`` coroutine via
        ``asyncio.to_thread``, so the serial port is single-threaded.
        """
        arm_latched = packet["armLatched"]
        right_tracked = any(c["hand"] == "right" for c in packet["controllers"])
        if not arm_latched:
            self._needs_release = False
            return self.hold()
        if not right_tracked:
            self._needs_release = True
            return self.hold()
        if self._needs_release:
            return self.hold()
        if arm_latched and not self._prev_arm_latched:
            self.pipeline.reset()
            print("[bridge] pipeline reset (arm latched)")
        self._prev_arm_latched = arm_latched

        robot_obs = self.robot.get_observation()
        self.joint_clamp.seed(robot_obs)
        joint_action = self.pipeline(({"xr.packet": packet}, robot_obs))

        if self._step_count % 15 == 0 and arm_latched:
            joints_str = " ".join(
                f"{k}={v:.1f}" for k, v in joint_action.items() if str(k).endswith(".pos")
            )
            print(f"[bridge] joints: {joints_str}")

        return self.robot.send_action(joint_action)

    async def control_loop(self, stop_event: asyncio.Event) -> None:
        """Single worker that pulls the latest packet at TARGET_HZ and steps."""
        print(f"[bridge] control loop running at up to {TARGET_HZ:.0f} Hz")
        while not stop_event.is_set():
            t0 = time.perf_counter()
            packet = self._take_packet()
            with self._packet_lock:
                hold_requested = self._hold_requested
                self._hold_requested = False
                stale = time.monotonic() - self._last_packet_time > INPUT_TIMEOUT_S
            if hold_requested or stale:
                self._needs_release = True
                await finish_serial_call(self.hold)
                packet = None
            if packet is not None:
                try:
                    await finish_serial_call(self.step, packet)
                    self._step_count += 1
                    self._error_count = 0
                except Exception as e:
                    self._needs_release = True
                    await finish_serial_call(self.hold)
                    self._error_count += 1
                    if self._error_count <= 3 or self._error_count % 50 == 0:
                        print(f"[bridge] step error ({self._error_count}): {e}")
                    # Back off after repeated errors to let the serial bus recover.
                    if self._error_count > 5:
                        await asyncio.sleep(0.2)

            now = time.perf_counter()
            if now - self._last_stats_time > 5.0:
                hz = self._step_count / (now - self._last_stats_time)
                print(f"[bridge] effective control rate: {hz:.1f} Hz")
                self._step_count = 0
                self._last_stats_time = now

            elapsed = time.perf_counter() - t0
            await asyncio.sleep(max(0.0, TARGET_DT - elapsed))

    async def handle_client(self, ws) -> None:
        if self._connected_clients:
            await ws.close(code=1008, reason="A controller is already connected")
            return
        self._connected_clients += 1
        self.request_hold()
        peer = getattr(ws, "remote_address", "<unknown>")
        print(f"[bridge] client connected from {peer} ({self._connected_clients} active)")
        try:
            async for raw in ws:
                try:
                    packet = parse_packet(raw)
                except ValueError:
                    self.request_hold()
                    continue
                self._set_packet(packet)
        except websockets.ConnectionClosed:
            pass
        finally:
            self.request_hold()
            self._connected_clients -= 1
            print(f"[bridge] client disconnected ({self._connected_clients} active)")


async def finish_serial_call(function, *args):
    """Join serial work even when its awaiting coroutine is cancelled."""
    operation = asyncio.create_task(asyncio.to_thread(function, *args))
    try:
        return await asyncio.shield(operation)
    except asyncio.CancelledError:
        await operation
        raise


async def amain() -> None:
    host, port, tls = get_server_config()
    bridge = TeleopBridge()

    stop_event = asyncio.Event()

    def _on_signal(*_: Any) -> None:
        print("[bridge] shutdown signal received")
        stop_event.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _on_signal)
        except NotImplementedError:
            signal.signal(sig, _on_signal)

    scheme = "wss" if tls else "ws"
    loop_task = None
    try:
        # Bind first so a port conflict cannot leave a newly connected robot behind.
        async with websockets.serve(bridge.handle_client, host, port, ssl=tls, max_size=65536):
            await finish_serial_call(bridge.connect)
            print(f"[bridge] listening on {scheme}://{host}:{port}; release then latch to enable")
            loop_task = asyncio.create_task(bridge.control_loop(stop_event))
            stop_task = asyncio.create_task(stop_event.wait())
            try:
                done, _ = await asyncio.wait([loop_task, stop_task], return_when=asyncio.FIRST_COMPLETED)
                if loop_task in done:
                    await loop_task
            finally:
                stop_task.cancel()
                await asyncio.gather(stop_task, return_exceptions=True)
    finally:
        # Let any serial operation in to_thread finish before disconnecting.
        stop_event.set()
        try:
            if loop_task is not None:
                await asyncio.shield(loop_task)
        finally:
            await finish_serial_call(bridge.disconnect)


if __name__ == "__main__":
    raise SystemExit("Use python bridge/main.py --hardware to explicitly select hardware control.")
