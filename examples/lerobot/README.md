# LeRobot reference examples

These are unchanged **upstream Hugging Face LeRobot examples**, copied from the
local `Developer/lerobot` checkout at commit
`0b067df57d21d3a02d6c511f1609172fa39ac29b` (package version `0.4.3`). The second
local checkout, `~/lerobot`, contains identical versions of these files.
They provide reference implementations for SO-100/SO-101 end-effector control,
dataset recording, replay, and ACT policy evaluation. They are not the original
Elo/Zapbox operator client or robot bridge.

| Folder | Input and purpose |
| --- | --- |
| `phone_to_so100/` | iOS HEBI Mobile I/O or Android WebXR phone input, mapped through inverse kinematics to a follower arm |
| `so100_to_so100_EE/` | Leader-arm input and end-effector-space recording/replay/evaluation |

Each folder contains `teleoperate.py`, `record.py`, `replay.py`, and `evaluate.py`.
The inspected LeRobot revision exposes `SO100Follower` and `SO101Follower` as
aliases of the same follower implementation through `lerobot.robots.so_follower`.
The example folder names retain their upstream spelling.

## Before using an example

These scripts are source references, not ready-to-run project launchers. Running
them connects to robot hardware and can move the arm. None was executed during
the consolidation.

1. Install the pinned LeRobot dependency described in the project setup. These
   examples additionally need its `feetech` and `kinematics` extras, and the
   phone examples need `phone`.
2. Adapt a copy for the actual serial port, robot/leader IDs, camera indexes,
   phone platform, and workspace bounds. The source values are upstream
   examples, not calibration for this machine.
3. Supply a matching SO-101 URDF and its referenced assets. The scripts use
   `./SO101/so101_new_calib.urdf` relative to the working directory; these robot
   assets were absent from both local LeRobot checkouts. This consolidated repo
   includes the recovered model under `bridge/SO101/`; adapt the example's path
   to that directory or run an adapted example with `bridge/` as its working directory.
4. Review dataset and model IDs and all hardware settings before running.
   `record.py` and `evaluate.py` end with `dataset.push_to_hub()`. Remove that
   call in your working copy if you want local-only recording. Replay and
   evaluation also command the real robot.

No private calibration, environments, datasets, model weights, or full LeRobot
library were copied. There were no custom training launchers in either source
checkout; training uses LeRobot's `lerobot-train` CLI.

## Attribution

Original source: [huggingface/lerobot](https://github.com/huggingface/lerobot/tree/0b067df57d21d3a02d6c511f1609172fa39ac29b/examples).
Copyright belongs to the Hugging Face team as stated in each source file. The
examples are provided under [Apache License 2.0](../../third_party/lerobot/LICENSE).
Original copyright/license headers have been preserved.
