# PRD: Canvas grasp annotator

Draw on a live camera feed, the arm moves. tldraw canvas as a teleop input device rather than a display.

Hackathon scope. One session. The demo is the physical loop, so protect that above everything.

---

## 1. What it does

A live webcam feed renders as a shape on an infinite canvas. The user draws a box around an object, drops a grasp point, and drags an approach angle. Those canvas coordinates convert to robot world coordinates and go over WebSocket to the SO-101, which executes a top down grasp.

The pitch in one line: annotation on a canvas becomes robot intent.

---

## 2. Scope

### In
- Live webcam as a custom tldraw shape
- Annotation shapes parented to the video shape so they pan and zoom with it
- Four point table calibration producing a homography
- Canvas to pixel to world coordinate conversion
- WebSocket bridge to a Python process driving the arm
- Planar IK for a fixed height top down grasp
- Emitted command shown as JSON in a side panel
- Dry run toggle that sends nothing and just prints

### Out
- Depth cameras, point clouds, 6DOF grasps
- Object detection or tracking
- Multi object queues, undo of executed motions
- Any ML at all

### Stretch, only after the loop works end to end
- Roboflow call to auto suggest boxes
- Annotation persists and tracks across frames
- Queue several grasps and run in sequence

---

## 3. Stack

**Frontend**: Vite, React, TypeScript, tldraw. Webcam via `getUserMedia`. Homography via the `perspective-transform` package, which is tiny and does exactly the 4 point solve needed.

**Bridge**: Python. `websockets` for the server, existing LeRobot or Feetech SDK setup for the arm.

**Transport**: plain JSON over WebSocket on `ws://localhost:8765`. No auth, no protobuf.

---

## 4. Coordinate pipeline

This is the only genuinely hard part. Get it right before touching the robot.

1. **Canvas point** from the annotation shape, in tldraw page space
2. **Shape local** via the video shape's transform. Use `editor.getShapePageTransform(videoShapeId)` and invert it.
3. **Pixel** by scaling shape local coordinates by `videoWidth / shape.props.w`
4. **World** by applying the homography to the pixel point

The homography assumes everything sits on a known flat table plane. That assumption is what lets you skip depth entirely. State it out loud in the demo rather than hiding it.

### Calibration flow
Place a printed marker or tape at four points on the table whose world coordinates you have measured. Click each one in the video in a fixed order. Store the resulting 3x3 matrix in localStorage keyed by camera label. Add a "recalibrate" button, because someone will knock the camera.

Do not skip calibration and try to eyeball a scale factor. It will be wrong in a way that looks almost right, which is the worst kind of wrong at a demo.

---

## 5. Annotation shapes

Three tldraw custom shapes, all children of the video shape:

- `grasp-box`: a `BaseBoxShapeUtil` subclass, teal stroke, no fill. Sets the region of interest.
- `grasp-point`: small circle with two gripper jaw marks. Position is the grasp centre.
- `grasp-approach`: a handle the user drags. Its angle from the grasp point is the approach yaw.

Keep all three as one logical annotation in app state. Only one annotation exists at a time in v1. Creating a new one clears the old.

---

## 6. Protocol

Client to bridge:

```json
{
  "type": "grasp",
  "world_mm": [312, -84, 145],
  "approach_deg": 34,
  "gripper_mm": 40,
  "dry_run": false
}
```

Bridge to client:

```json
{ "type": "status", "state": "moving" | "done" | "error", "detail": "..." }
```

Client shows the state in the panel. On `error`, keep the annotation on screen so the user can adjust rather than redraw.

---

## 7. Motion

Constrain hard to keep IK tractable:

- Fixed approach height, descend vertically to the grasp z
- Top down orientation only, wrist yaw set by `approach_deg`
- Base rotation from `atan2(y, x)`, then two link planar IK for reach and height

Sequence: home, move above target, descend, close gripper, lift, return to home.

Safety, non negotiable even at a hackathon:
- Clamp target to a hardcoded workspace box, reject anything outside
- Cap joint velocity well below max
- Reject any command received while a motion is in flight
- Keep the power switch within reach and mention it when judges lean in

---

## 8. Build order

Each step must leave something demoable.

**M0.** Vite app, tldraw mounts, webcam renders as a custom shape. *Demoable: a live feed on an infinite canvas.*

**M1.** Draw the three annotation shapes, parented correctly. Pan and zoom, confirm they stay registered to the frame. *This is the tldraw proof.*

**M2.** Calibration flow and the coordinate pipeline. Print world coordinates to the panel on every annotation change. Hold a ruler to the table and check the numbers. *No robot yet.*

**M3.** WebSocket bridge with `dry_run` forced true. Bridge prints what it would do. *Full loop, no motion.*

**M4.** Real motion. Start with the arm's gripper removed or the workspace clear.

**M5.** Polish, error copy, rehearse the demo twice with the actual table setup.

If M4 fails, demo M3. A visibly correct coordinate pipeline with a dry run log is still a real demo. A crashed arm is not.

---

## 9. Risks

**Camera moves and calibration silently rots.** Add a visible warning if no calibration exists for the current camera label. Tape the camera down.

**Coordinate frame sign errors.** Expect them. Build a debug overlay that projects the world origin and axes back into the video so you can see the frame rather than reason about it.

**Webcam permissions in the tldraw iframe context.** Test this in minute five, not hour six.

**Lighting at the venue.** Different from your desk. Recalibrate on site before presenting, and build the recalibration flow to take under thirty seconds.

---

## 10. Demo script

1. Live feed, pan and zoom the canvas so judges see it is a real canvas
2. Draw a box around an object
3. Drop the grasp point, drag the approach angle
4. Point at the JSON updating live
5. Send. Arm picks it up.
6. Move the object, draw again, pick again

Under 60 seconds. The second pick is what proves it is not a scripted animation, so do not skip it.
