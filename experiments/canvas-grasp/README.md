# Canvas grasp annotator — recovered SO-101 experiment

This is a separate historical experiment recovered from `Developer/tldraw_demo`.
It uses a tldraw canvas over a camera feed to choose grasp positions, then sends
those positions to a Python WebSocket bridge. It is independent of the Zapbox
WebXR / Placo pipeline in this repository.

The original frontend, bridge, dependency manifests, lockfile, and patches are
preserved without code changes. [README.source.md](README.source.md) contains the
original README, and [docs/PRD-grasp-annotator.md](docs/PRD-grasp-annotator.md) is the
original design document recovered from `Developer/Projects/tldr_ai`. These are
historical descriptions, not proof that the hardware path works.

## Current status

Use this snapshot for code review and dry-run planning. **The real hardware path
is incomplete and has not been verified. Do not enable `dry_run=false`.** The
browser exposes a dry-run toggle, and the historical server trusts that client
flag; there is no independent server-side enable switch.

Known integration problems found during consolidation:

- `bridge/ik.py` uses placeholder 116 mm / 135 mm link lengths and a simplified
  four-joint pose model. It is not the SO-101 URDF / Placo model.
- `bridge/hardware.py` imports the obsolete
  `lerobot.common.robot_devices.motors.feetech` path and supplies a historical
  motor map that does not match the current SO-101 follower API.
- Its five-servo map and all-zero home pose must not be treated as a calibrated
  SO-101 configuration.
- The claimed velocity cap computes a delay after immediate goal-position
  writes. It does not limit actual servo speed.
- The gripper opening in millimetres is written directly to `Goal_Position`
  without a calibrated conversion.
- Input validation, fault handling, and disconnect behavior need further work
  before any physical robot use.

## Inspect or try the dry-run UI

From this directory, with a suitable Node.js installation:

```sh
npm ci
npm run dev
```

For the historical dry-run bridge, use a separate Python environment **without
LeRobot installed**, leave the browser's dry-run option enabled, and run:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r bridge/requirements.txt
.venv/bin/python -m bridge.server
```

The UI connects to `ws://localhost:8765`. The lockfile and `patches/` directory
are included because the frontend applies a `perspective-transform` patch during
installation. No dependency installation or hardware execution was performed
when copying this snapshot.

## Provenance

- Frontend and Python bridge: `Developer/tldraw_demo` (39 original files).
- Design document: `Developer/Projects/tldr_ai/PRD-grasp-annotator.md`.
- No license file was present in those source locations; no new license is
  assigned by this copy. Existing dependency licenses still apply.
- Environments, caches, generated build output, local agent settings, Git
  metadata, and credentials were excluded.

The separate `Agentic-Cars` Zapbox prototype was reviewed but not copied: it
controls a car with joystick/gyroscope signals and has no SO-101 arm pipeline.
