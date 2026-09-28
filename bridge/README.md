# SO-101 WebXR bridge

Recovered from the local `elo-teleop/bridge` work and integrated with the
Zapbox operator client. `main.py` starts a **dry-run receiver by default**.
Only `--hardware` imports the robot implementation and connects the arm.

From the repository root, without a robot:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r bridge/requirements-dry-run.txt
.venv/bin/python bridge/main.py --dry-run
```

The receiver listens on `ws://127.0.0.1:8765`, validates real controller packets,
and reports receipt. It does not simulate motor positions, IK, or live telemetry.
For headset access, configure `bridge/.env` using `.env.example`; use a reachable
host and WSS with `WS_TLS_CERT`/`WS_TLS_KEY`, or a TLS reverse proxy. An HTTPS
WebXR page cannot connect to an insecure remote `ws://` address.

## Hardware setup

The bridge uses the same LeRobot revision as both local checkouts:
`0b067df57d21d3a02d6c511f1609172fa39ac29b`. Its imports use
`lerobot.robots.so_follower`, not the old `so101_follower` module path.

```bash
.venv/bin/python -m pip install -r bridge/requirements.txt
cp bridge/.env.example bridge/.env
# Edit bridge/.env: set FOLLOWER_PORT and your existing calibration FOLLOWER_ID.
.venv/bin/python bridge/main.py --hardware
```

For this machine, the existing LeRobot environment can also run the bridge
without installing another full robotics stack:

```bash
/Users/kazybekkhairulla/Developer/lerobot/.venv/bin/python bridge/main.py --dry-run
```

Calibration belongs to the physical arm. No machine-specific calibration was
invented or copied. If the arm is not calibrated, use LeRobot's calibration
command deliberately before teleoperation:

```bash
lerobot-calibrate --robot.type=so101_follower \
  --robot.port=/path/to/your/serial/device --robot.id=so101_follower
```

This command operates hardware. The same port and ID must be used by the bridge.
The supplied URDF and meshes are in `SO101/`; the original download fallback is
retained for missing files.

## Control behavior

- Input is `InputPacket` JSON over one WebSocket connection. See
  [the protocol](../docs/protocol.md).
- Only the newest packet is processed, at up to `TARGET_HZ` (default 15 Hz).
- A valid right controller and the arm latch are both required. The operator
  must first send an unlatched packet after connecting or losing tracking.
- Release, tracking loss, malformed input, disconnect, or 250 ms without fresh
  input stops new IK targets and requests a hold at the measured joint positions.
  Releasing and latching again is required to resume after a fault.
- Every target, including the first one after latching, is clamped against the
  measured joint positions. The default maximum step is 5 degrees for arm joints
  (the gripper uses LeRobot's normalized units).
- The gripper is disabled along with the arm. Left trigger/grip mapping is
  retained from the original code and must be checked against the physical arm.
- Shutdown waits for a running control step before disconnecting. LeRobot's
  disconnect behavior may release torque; support the arm when stopping it.

The consolidation was tested without connected hardware. These software limits
do not establish mechanical clearance, correct calibration, or a measured safe
speed on an actual arm. Initial powered operation still needs a supervised check.

## Files

- `main.py`: default dry-run / explicit hardware selection.
- `dry_run.py`, `protocol.py`: hardware-free receiver, input validation, TLS config.
- `hardware.py`: recovered LeRobot/Placo control pipeline with integration fixes.
- `xr_mapper.py`: latched controller deltas and WebXR-to-robot axis conversion.
- `SO101/`: original local URDF and meshes.
