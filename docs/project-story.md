# SO-101 XR Teleoperation

Control a robot arm from a VR headset, over the internet, in real time.

[![Demo video](https://img.youtube.com/vi/ccDjp0XjTPY/hqdefault.jpg)](https://youtu.be/ccDjp0XjTPY)

*Click to watch: Zapbox XR headset teleoperating an SO-ARM101.*

## Overview

I built an end-to-end VR teleoperation pipeline during my Robotics SWE internship at [Elo](https://elo.inc), an early-stage startup building an open-source wheeled humanoid. The operator wears a headset, sees a live stereo feed from the robot's cameras, and drives the arm with their hand controllers.

The operator client lives in Elo's GitHub: **[im-elo/elo-teleop-kk](https://github.com/im-elo/elo-teleop-kk)**.
This repo is my personal write-up of the project, plus my own SO-101 work (calibration, scripts, and imitation learning experiments).

## Architecture

```
Headset (WebXR client)
   │  controller poses, buttons, thumbsticks @ ~30 Hz
   ▼
WebRTC data channel ──▶ Python WebSocket bridge ──▶ Placo IK ──▶ SO-ARM101 (USB)

Robot camera ──WebRTC──▶ Cloudflare Realtime SFU ──▶ Headset (mono or stereo video)
Robot telemetry ──────────────────────────────────▶ Headset HUD
```

## What I built

**Operator client (Next.js, Three.js, WebXR)**
- Immersive VR viewer with mono and side-by-side stereo modes, using per-eye render layers so each eye sees its own camera.
- Reads headset pose, controller grip poses, thumbsticks and buttons every frame, and streams them to the robot as JSON at ~30 Hz.
- Arm latch: the right controller toggles whether your hand actually drives the arm, with rising-edge detection so holding the button doesn't flicker it, and a visual indicator on the wrist.
- Head-locked HUD showing battery, latency, robot status, latch state and per-joint temperatures (red above 70 C).

**Video and networking (WebRTC via Cloudflare Realtime SFU)**
- Full signaling flow: session creation, track registration after the peer connection comes up, and handling renegotiation offers from the SFU.
- Server-side API proxy so the Cloudflare secret never reaches the browser.
- Separate data channels: an unreliable, unordered channel for control input (low latency beats guaranteed delivery), and a telemetry channel back to the operator.
- A test publisher page that streams a webcam, so the whole loop can be tested without the robot.

**Robot-side control**
- Python WebSocket bridge that turns operator input into arm targets, solved with Placo inverse kinematics and sent to the SO-ARM101 over USB.
- Latest-packet-wins control loop, so stale commands are dropped instead of queued.
- Per-joint velocity clamping to stop the servo bus from overloading on sudden hand movements.

## Stack

Next.js, TypeScript, Three.js, WebXR, WebRTC, Cloudflare Realtime SFU, Python, Placo, SO-ARM101, Zapbox headset

## Design decisions

| Decision | Why |
| --- | --- |
| Unreliable, unordered data channel for input | A late control packet is useless, so dropping it is better than waiting for it |
| Latest-packet-wins on the robot side | Keeps the arm tracking where the hand is now, not where it was |
| Velocity clamping per joint | Protects the hardware and the bus from spikes |
| Arm latch | The operator can move freely without dragging the arm around |
| Secrets proxied server-side | Credentials never ship to the headset browser |

## Status and next steps

- Done: live stereo video, XR input streaming, arm control, telemetry HUD
- In progress: collecting teleoperated demonstrations to train imitation learning policies on the SO-101 with [LeRobot](https://github.com/huggingface/lerobot)
- Planned: autonomous demo video, dataset and trained policy published on Hugging Face

## Links

- Demo video: [Watch on YouTube](https://youtu.be/ccDjp0XjTPY)
- Operator client (Elo): https://github.com/im-elo/elo-teleop-kk
- Portfolio: https://kazybekkh.me

Built by Kazybek Khairulla during my internship at Elo.
