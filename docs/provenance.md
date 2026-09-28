# Source recovery and consolidation

Sources were inspected locally on 28 September 2026. The source folders were
left in place and their imported file hashes were verified unchanged.
[The manifest](source-manifest.json) records exact origins and source/destination
SHA256 values, including files adapted during consolidation.

| Source | Selection |
| --- | --- |
| `~/elo-teleop`, commit `3dd3cee28ef708ec8e8fe6b5058a27c374c51c02` | Historical Cloudflare/WebXR operator, recovered from Git rather than the current Quest/MJPEG rewrite |
| `~/elo-teleop/bridge` and `broadcaster` working tree | SO-101 bridge, XR mapper, model assets and Cloudflare publisher |
| `~/Developer/lerobot` and `~/lerobot`, commit `0b067df57d21d3a02d6c511f1609172fa39ac29b` | Identical relevant source; copied one set of eight upstream examples and license |
| `~/Developer/tldraw_demo` | Historical SO-101 canvas experiment, kept separately with its known hardware defects documented |
| `~/Developer/Projects/tldr_ai` | Associated canvas grasp design document, included as historical context |

`~/Developer/elo_teleop` is an ELO/OpenArm hardware plugin, not the SO-101/Zapbox
operator. RC-car Zapbox prototypes and the current Quest/MJPEG application were
reviewed but excluded from the primary pipeline. No custom SO-101 dataset,
calibration, training launcher or model weights were discovered in the two
LeRobot source trees.

## New integration work

- Added the missing direct operator-to-Python WebSocket transport and explicit
  connected/disarmed states; retained Cloudflare video signaling.
- Removed unsupported claims of a working SFU robot data-channel peer and live
  hardware telemetry; fixed stale stereo texture and recording-button handling.
- Corrected the Python publisher URL to include the session and track required by
  the recovered viewer. A bridge URL is now explicit, with video-only as default.
- Kept the existing robot pipeline in `bridge/hardware.py`; added a lightweight
  default dry-run CLI, packet validation, TLS configuration and one-client limit.
- Added measured-position hold on release/tracking loss/disconnect/input timeout,
  explicit re-latch after faults, finite-target checks, first-frame joint clamping,
  and orderly completion of serial work before disconnecting.
- Added environment examples, pinned robotics dependency, setup documentation,
  tests, source manifest and Git ignores for local state.

The original target README, including its historical project narrative, is
preserved in [project-story.md](project-story.md), with its demo links updated
to the supplied video. It is a historical
write-up; the root README describes the actual consolidated implementation and
its current validation limits.

No source `.git`, `.env`, TLS certificate/key, dependency directory, virtual
environment, recording, dataset or checkpoint was imported. Dependencies built
for validation live only in ignored target directories. No commits, pushes,
public deployments or hardware/camera operations were performed.

## Attribution

LeRobot source headers and Apache-2.0 license are preserved. The model's existing
local files originate from TheRobotStudio/SO-ARM100; its repository license was
retrieved from the official GitHub repository and retained in
`third_party/so-arm100/LICENSE`. The local Elo and canvas sources supplied no root
project license, so this consolidation does not assign one to those components.
