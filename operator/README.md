# SO-101 XR operator

Recovered from `elo-teleop` commit `3dd3cee`, before its uncommitted Quest/MJPEG rewrite. This app preserves the Cloudflare video publisher, WebXR stereo viewer, controller input and recording tools, and adds the missing direct WebSocket connection to the SO-101 bridge.

## Run

Use Node 22.13+ LTS (or Node 24+) and npm.

```sh
cd operator
npm ci
cp .env.example .env.local
# Fill in your own Cloudflare Realtime App ID and token in .env.local.
npm run dev -- --experimental-https
```

WebXR needs a secure origin. The headset must trust the HTTPS viewer certificate. For an HTTPS viewer, the bridge URL must use `wss://` with a trusted certificate too; configure TLS in the root bridge, or use your own TLS reverse proxy. Certificates and credentials are intentionally not included.

The Python broadcaster prints a link of this form:

```text
https://YOUR_VIEWER_HOST:3000/viewer?session=SESSION_ID&track=robot-camera&stereo=sbs&bridge=wss://YOUR_BRIDGE_HOST:8765
```

Parameters: `session` is the Cloudflare publisher session ID (required), `track` defaults to `robot-camera`, `stereo` is `mono` (default) or `sbs`, and `bridge` is the optional arm bridge URL. Without a bridge, the viewer is video-only. `/publisher` can publish a browser webcam instead of the Python broadcaster; add `bridge` to its generated viewer link to enable the arm.

## Controls and connection behavior

- Right A: toggle arm latch, only when the bridge socket is connected.
- Right B: toggle HUD; hardware battery, temperature and latency telemetry remain unavailable.
- Right controller: arm pose relative to the moment it was latched.
- Left trigger / grip: close / open gripper, subject to the bridge's arm-enable rules.
- Add `record=true` to enable XR recording; with HUD open, left Y starts/stops recording. Files are saved under ignored `operator/recordings/`.

The bridge opens when XR starts and closes when XR ends or the page is hidden. Tracking loss unlatches the arm. Stale input or an outgoing socket backlog closes the connection and disarms the client. Re-enter XR to reconnect; enabling arm control always requires pressing A again. A connected socket confirms only the network link; it does not prove the physical robot is calibrated or moving. Robot control uses the direct bridge socket; Cloudflare is used for video, not for a claimed robot data-channel peer.

The `/api/input/*` POST/SSE relay is a local dashboard/recording aid. It is in-memory and is intended for a single local Next server. Recording and signaling endpoints do not implement user authentication; deploy access control before exposing the operator publicly.

## Checks

```sh
npm run typecheck
npm test
npm run build
```

The robot transport tests use fake sockets and never touch hardware. See the root provenance record for original file hashes and consolidation changes. No source `.git`, credentials, certificates, recordings, dependencies, or agent-instruction files were imported. The source repository did not supply a project license; this recovery does not grant a new license.
