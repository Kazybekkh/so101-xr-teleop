# Controller transport

The operator sends one JSON packet roughly every 33 ms during an XR session:

```json
{
  "ts": 1000,
  "headset": {"position": [0, 1.6, 0], "orientation": [0, 0, 0, 1]},
  "controllers": [
    {
      "hand": "right",
      "position": [0.1, 1, -0.2],
      "orientation": [0, 0, 0, 1],
      "axes": [0, 0],
      "buttons": [{"pressed": false, "value": 0}]
    }
  ],
  "armLatched": false
}
```

Positions are metres in WebXR's Y-up frame; orientations are xyzw quaternions.
Controller axes are in [-1, 1] and button values in [0, 1]. `armLatched` must be a
JSON boolean. Pose coordinates must be finite; quaternion norm must be nonzero.
The headset pose and timestamp are optional to the receiver. A disabled packet
may have an empty controllers list. The hardware bridge requires a valid right
controller for motion and uses local monotonic receipt time for its watchdog.

The mapper converts deltas as robot `(x, y, z) = (-xr_z, -xr_x, xr_y)` and captures
the hand and robot reference poses when latching. Rotation following defaults to
off (`XR_ROT_SCALE=0`), as in the recovered local implementation.

`/viewer?session=...&track=robot-camera&stereo=sbs&bridge=wss://...` selects video
and a bridge. The operator discards stale or backlogged control input rather than
replaying it. The robot also uses a single latest-packet slot and one controlling
client. Video is WebRTC through Cloudflare; control is direct WebSocket. A full
robot telemetry channel and XR-to-LeRobot dataset recorder are not implemented.
