# Consolidation validation — 28 September 2026

| Check | Result |
| --- | --- |
| Python packet, dry-run and mocked hardware suite | 30 tests passed |
| Hardware regression suite after final cancellation change | 17 tests passed |
| Real secure WebSocket test | Generated temporary certificate; actual local WSS packet exchange passed |
| TypeScript operator transport to Python dry-run bridge | Three actual packets acknowledged over a local WebSocket; no hardware imported by receiver |
| Operator dependency install | `npm ci` completed |
| Operator static checks | Lint without warnings and TypeScript typecheck passed |
| Operator transport tests | 5 tests passed |
| Operator production build | Next.js 16.2.1 production build passed |
| Imported source integrity | 100 imported file origins/hashes verified; originals unchanged |
| Python source syntax | All deliverable Python files parsed |
| SO-101 model | All 34 mesh references resolve to bundled files |
| Repository hygiene | No nested `.git`; 11 ignore checks passed; environment examples remain includable |
| Credential-pattern scan | No private-key or common API-token patterns found in deliverable source |

Python checks used the existing Python 3.12 LeRobot environment. Operator build
checks used the installed dependency lockfile; a newer non-LTS Node runtime emitted
an engine warning during installation. The documented supported runtime is Node
22.13+ LTS or 24+. The real cross-language socket test ran with Node 22.14.

The control tests import the real SDK classes but substitute fake robot I/O and
a fake IK pipeline. No SO101Follower constructor, Placo solver, serial connection,
camera, physical headset or Cloudflare publication was exercised. They establish
software behavior, not successful physical teleoperation or calibrated limits.

Cloudflare end-to-end video, trusted headset certificates, actual calibration,
controller-axis/gripper direction, actuator motion, and a synchronized LeRobot
recording pipeline remain to be checked or implemented. The historical canvas
experiment retains its documented placeholder/incompatible hardware path and was
only checked for source integrity and syntax.

No source repositories were modified, no commits or pushes were made, and the
project's existing HEAD remains `e93e026`. New files are left ready for review.
