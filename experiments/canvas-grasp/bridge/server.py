"""WebSocket bridge between the canvas annotator and the SO-101 arm (Section 6/7 of the PRD).

Run:
    python -m bridge.server

Listens on ws://localhost:8765. Speaks the protocol from the PRD:
    client -> bridge: {"type":"grasp","world_mm":[x,y,z],"approach_deg":d,"gripper_mm":m,"dry_run":bool}
    bridge -> client: {"type":"status","state":"moving"|"done"|"error","detail":"..."}

M0-M3: the client always sends dry_run=true, so every command below takes the
logging-only path. M4 (real motion) hooks are implemented and wired up in
hardware.py, gated behind dry_run=false, but aren't exercised until a real
SO-101 + LeRobot install is attached - see hardware.HARDWARE_AVAILABLE.
"""

import asyncio
import json
import logging

import websockets

from .hardware import HOME_POSITION_DEG, HardwareUnavailable, SO101Arm
from .ik import JointTargets, Unreachable, planar_ik
from .safety import clamp_to_workspace

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("grasp-bridge")

HOST = "localhost"
PORT = 8765

HOVER_HEIGHT_MM = 80.0  # clearance above the grasp point before/after descending

_busy = False
_arm: SO101Arm | None = None


async def send_status(ws, state: str, detail: str):
	await ws.send(json.dumps({"type": "status", "state": state, "detail": detail}))


def validate_command(msg: dict) -> tuple[float, float, float, float, float, bool]:
	if msg.get("type") != "grasp":
		raise ValueError(f"unknown message type {msg.get('type')!r}")
	world_mm = msg["world_mm"]
	if not (isinstance(world_mm, list) and len(world_mm) == 3):
		raise ValueError("world_mm must be a [x, y, z] triple")
	x, y, z = (float(v) for v in world_mm)
	approach_deg = float(msg["approach_deg"])
	gripper_mm = float(msg["gripper_mm"])
	dry_run = bool(msg["dry_run"])
	return x, y, z, approach_deg, gripper_mm, dry_run


def plan_sequence(x: float, y: float, z: float, approach_deg: float) -> list[JointTargets]:
	"""home -> above target -> descend -> (close gripper happens between these two
	poses) -> lift (= above target again) -> home."""
	x, y, z = clamp_to_workspace(x, y, z)
	above = planar_ik(x, y, z + HOVER_HEIGHT_MM, approach_deg)
	descend = planar_ik(x, y, z, approach_deg)
	return [HOME_POSITION_DEG, above, descend, above, HOME_POSITION_DEG]


async def run_dry(ws, x: float, y: float, z: float, approach_deg: float, gripper_mm: float):
	sequence = plan_sequence(x, y, z, approach_deg)
	labels = ["home", "above target", "descend", "lift", "home"]
	log.info("[dry run] planned sequence for world=(%.1f, %.1f, %.1f) approach=%.1f gripper=%.1f", x, y, z, approach_deg, gripper_mm)
	for label, targets in zip(labels, sequence):
		log.info(
			"[dry run]   %-12s base=%.1f shoulder=%.1f elbow=%.1f wrist=%.1f",
			label,
			targets.base_deg,
			targets.shoulder_deg,
			targets.elbow_deg,
			targets.wrist_deg,
		)
	log.info("[dry run]   gripper -> %.1fmm", gripper_mm)
	await send_status(ws, "moving", "dry run - no motion sent to hardware")
	await asyncio.sleep(0.2)
	await send_status(ws, "done", "dry run complete")


async def run_live(ws, x: float, y: float, z: float, approach_deg: float, gripper_mm: float):
	global _arm
	if _arm is None:
		_arm = SO101Arm()
		_arm.connect()

	x, y, z = clamp_to_workspace(x, y, z)
	current = HOME_POSITION_DEG
	above = planar_ik(x, y, z + HOVER_HEIGHT_MM, approach_deg)
	descend = planar_ik(x, y, z, approach_deg)

	await send_status(ws, "moving", "moving above target")
	duration = _arm.move_to(above, current)
	await asyncio.sleep(duration)

	await send_status(ws, "moving", "descending")
	duration = _arm.move_to(descend, above)
	await asyncio.sleep(duration)

	await send_status(ws, "moving", "closing gripper")
	_arm.set_gripper_mm(gripper_mm)
	await asyncio.sleep(0.3)

	await send_status(ws, "moving", "lifting")
	duration = _arm.move_to(above, descend)
	await asyncio.sleep(duration)

	await send_status(ws, "moving", "returning home")
	duration = _arm.home(above)
	await asyncio.sleep(duration)

	await send_status(ws, "done", "grasp complete")


async def handle_grasp(ws, msg: dict):
	global _busy

	if _busy:
		await send_status(ws, "error", "arm is busy - command rejected")
		return

	try:
		x, y, z, approach_deg, gripper_mm, dry_run = validate_command(msg)
	except (ValueError, KeyError, TypeError) as exc:
		await send_status(ws, "error", f"bad command: {exc}")
		return

	_busy = True
	try:
		if dry_run:
			await run_dry(ws, x, y, z, approach_deg, gripper_mm)
			return

		try:
			await run_live(ws, x, y, z, approach_deg, gripper_mm)
		except HardwareUnavailable as exc:
			await send_status(ws, "error", f"hardware not available: {exc}")
		except Unreachable as exc:
			await send_status(ws, "error", f"unreachable target: {exc}")
		except Exception as exc:  # noqa: BLE001 - surface any hardware fault to the client
			log.exception("live motion failed")
			await send_status(ws, "error", f"motion failed: {exc}")
	except Unreachable as exc:
		await send_status(ws, "error", f"unreachable target: {exc}")
	finally:
		_busy = False


async def handler(ws):
	peer = ws.remote_address
	log.info("client connected: %s", peer)
	try:
		async for raw in ws:
			try:
				msg = json.loads(raw)
			except json.JSONDecodeError:
				await send_status(ws, "error", "invalid JSON")
				continue
			await handle_grasp(ws, msg)
	finally:
		log.info("client disconnected: %s", peer)


async def main():
	async with websockets.serve(handler, HOST, PORT):
		log.info("grasp bridge listening on ws://%s:%d", HOST, PORT)
		await asyncio.Future()


if __name__ == "__main__":
	asyncio.run(main())
