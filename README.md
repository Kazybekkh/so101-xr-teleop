# SO-101 XR Teleoperation

Local code consolidated for Zapbox / WebXR control of an SO-101 follower arm,
with a Cloudflare video stream and a Python LeRobot/Placo bridge.

[![Watch the SO-101 XR teleoperation demo](https://img.youtube.com/vi/ccDjp0XjTPY/hqdefault.jpg)](https://youtu.be/ccDjp0XjTPY)

[Watch the demo on YouTube](https://youtu.be/ccDjp0XjTPY).

This repository now contains the actual operator, robot bridge, camera publisher,
robot model, and related examples recovered from this machine. The original
project write-up is preserved in [docs/project-story.md](docs/project-story.md).

## What is here

| Directory | Contents | Origin |
| --- | --- | --- |
| [operator](operator/README.md) | Next.js / Three.js WebXR viewer, Cloudflare signaling, controller input and XR recording | Recovered from `elo-teleop` commit `3dd3cee`, before the Quest/MJPEG rewrite |
| [bridge](bridge/README.md) | SO-101 controller mapper, Placo IK, USB follower control, URDF/meshes, new dry-run receiver | Existing uncommitted `elo-teleop/bridge` code, with integration fixes |
| [broadcaster](broadcaster/README.md) | Python camera/test-pattern WebRTC publisher and viewer QR link | Existing `elo-teleop/broadcaster/main.py` |
| [examples/lerobot](examples/lerobot/README.md) | Eight upstream teleoperate/record/replay/evaluate reference scripts | One copy from the two identical LeRobot checkouts |
| [experiments/canvas-grasp](experiments/canvas-grasp/README.md) | Historical canvas-driven SO-101 experiment with incomplete hardware support | Local `tldraw_demo` project |
| [tests](tests) | Packet, secure WebSocket, control-gating and joint-clamp checks | Added during consolidation; hardware is mocked |

Both LeRobot checkouts contain the same upstream source at
`0b067df57d21d3a02d6c511f1609172fa39ac29b`. The full library is a pinned dependency,
not another bundled fork. The separate `Developer/elo_teleop` package targets Elo's
larger arms and is not part of this SO-101 pipeline.

## Architecture

```text
Zapbox / WebXR controllers ── WSS ──> Python bridge ── Placo IK ──> SO-101 USB
                                          │
                                  latest packet, latch,
                                input timeout, joint clamp

Robot camera ── Python WebRTC publisher ── Cloudflare Realtime SFU ──> XR viewer
```

The recovered client did not connect to the existing Python WebSocket bridge.
That connection has been added. Cloudflare carries video; this version sends
controller input directly over WebSocket. A robot telemetry return channel is
not implemented, and the HUD does not present invented live hardware readings.
See [the packet protocol](docs/protocol.md).

## Start without hardware

From this repository's root:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r bridge/requirements-dry-run.txt
.venv/bin/python bridge/main.py --dry-run
```

This validates controller messages on `ws://127.0.0.1:8765`. It does not import
LeRobot, open a camera, connect USB, or simulate an arm. Hardware control requires
`--hardware` and an explicitly configured `FOLLOWER_PORT`.

For the headset client, in a second terminal:

```bash
cd operator
npm ci
cp .env.example .env.local
# Set your own Cloudflare app ID/token in .env.local.
npm run dev -- --experimental-https
```

The headset must trust the viewer's HTTPS certificate. A remote bridge must use
WSS as well; configure its certificate or a TLS proxy as described in
[bridge setup](bridge/README.md). Start the [camera publisher](broadcaster/README.md)
with your own Cloudflare app and reachable viewer address, then open the printed
viewer URL on the headset. It contains the required session and track IDs.

## Hardware and datasets

Follow [bridge setup](bridge/README.md) to install the pinned robotics stack,
select the USB port, and use calibration belonging to your physical arm. No
private calibration, credentials, recordings, model weights, source `.git`
directories, or virtual environments were imported.

The default bridge receives packets without moving hardware. In hardware mode,
release, tracking loss, disconnect and stale input request a hold at measured
joint positions. New motion requires valid right-controller tracking and an
explicit release/re-latch. These controls were tested with a mocked robot;
physical arm movement and calibration still need supervised validation.

The operator's recording tools capture XR input. They are **not** a synchronized
LeRobot demonstration dataset recorder. Upstream dataset and policy examples are
included as references, with their original hardware settings and Hub-upload
behavior documented in [examples/lerobot](examples/lerobot/README.md).
No custom SO-101 training launcher or trained policy was found in either local
LeRobot checkout.

## Validation

```bash
# Hardware-free packet and WebSocket tests (including a local TLS round trip):
python -m unittest discover -s tests -p 'test_protocol.py'
python -m unittest discover -s tests -p 'test_dry_run.py'

# Also exercises the controller with a fake robot; needs the robotics dependencies:
python -m unittest discover -s tests -p 'test_*.py'

cd operator
npm run lint
npm run typecheck
npm test
npm run build
```

No physical headset, camera, Cloudflare session or robot was operated during
consolidation. See [provenance](docs/provenance.md) for what was copied and changed,
and [validation](docs/validation.md) for completed checks and remaining limits.

## Attribution

Original operator and bridge work: local [im-elo/elo-teleop-kk](https://github.com/im-elo/elo-teleop-kk).
LeRobot examples retain their Apache-2.0 headers and [license](third_party/lerobot/LICENSE).
SO-101 model assets originate from [TheRobotStudio/SO-ARM100](https://github.com/TheRobotStudio/SO-ARM100)
and its [Apache-2.0 license](third_party/so-arm100/LICENSE).
The local Elo/operator and canvas repositories supplied no blanket project
license; no new license has been assigned to that recovered code.
