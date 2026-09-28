# Canvas Grasp Annotator

Draw on a live camera feed, the arm moves. A tldraw canvas as a teleop input device
rather than a display: annotate a grasp on the video, and the annotation converts to
robot world coordinates and streams to an SO-101 arm over WebSocket.

Built through M0-M3 of the PRD in full. M4 (real motion) hooks — planar IK, joint
safety clamping, and the LeRobot/Feetech motor driver — are implemented in
`bridge/`, gated behind `dry_run=false`. Without a physical SO-101 + LeRobot install
attached, that path reports "hardware not available" instead of driving anything.

## Frontend

```
npm install
npm run dev
```

Opens on `http://localhost:5173`. Grants camera access on first load for the
`webcam` shape.

- **Camera**: set a label (used as the calibration storage key) and pick a device.
- **Calibration**: click "Calibrate", enter the measured table point (mm, robot base
  frame) for each of the 4 rows, click "Capture", then click that same physical
  point in the video. Once all 4 are captured, "Save calibration" computes the
  homography (via `perspective-transform`) and stores it in `localStorage` keyed by
  the camera label.
- **Annotation**: "New grasp annotation" drops a grasp-box, grasp-point, and
  grasp-approach handle onto the canvas, parented to the webcam shape so they pan
  and zoom with it. Drag the box to size the object, the point to set the grasp
  location, and the approach handle to set the wrist yaw. Only one annotation set
  exists at a time — creating a new one clears the old.
- **Live output**: the side panel shows the live `world_mm` / `approach_deg` /
  `gripper_mm` JSON, recomputed from the annotation shapes' page positions through
  the calibrated homography.
- **Dry run**: on by default. When on, the bridge only logs the planned motion and
  replies `done` without touching hardware.

## Bridge (Python)

```
cd bridge
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd ..
python -m bridge.server
```

Listens on `ws://localhost:8765`. Protocol:

```
client -> bridge: {"type":"grasp","world_mm":[x,y,z],"approach_deg":d,"gripper_mm":m,"dry_run":bool}
bridge -> client: {"type":"status","state":"moving"|"done"|"error","detail":"..."}
```

- `bridge/ik.py` — base rotation (`atan2(y, x)`) + two-link planar IK for a fixed-
  height top-down grasp. `LINK_1_MM` / `LINK_2_MM` are placeholders — measure your
  SO-101's upper arm / forearm and update them.
- `bridge/safety.py` — workspace clamp box and joint velocity cap (mirrors
  `src/lib/config.ts`'s `WORKSPACE_LIMITS_MM`, keep the two in sync).
- `bridge/hardware.py` — the M4 hook. Talks to LeRobot's `FeetechMotorsBus`; the
  import is guarded, so the bridge runs fine in dry-run-only mode with neither
  LeRobot nor an arm attached. Install `lerobot` (see `requirements.txt`) and update
  `SERVO_IDS` for your wiring to drive real hardware.
- `bridge/server.py` — the websocket server. Rejects a command if the arm is
  already mid-motion (`_busy`), clamps to the workspace box, and takes the
  dry-run-log or real-motion path based on the command's `dry_run` flag.

## Known limitations (out of scope per the PRD)

No depth/point clouds, no object detection, no multi-object queues, no undo of
executed motions, no ML.
