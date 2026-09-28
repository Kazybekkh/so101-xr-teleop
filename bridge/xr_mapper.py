"""
Map a Zapbox/WebXR ``InputPacket`` into LeRobot's ``target_*`` action format.

The viewer (``src/app/viewer/page.tsx``) sends an ``InputPacket`` JSON
message over a WebSocket every ~33 ms with this shape::

    {
        "ts":    1234567890,
        "headset":   {"orientation": [x,y,z,w], "position": [x,y,z]},
        "controllers": [
            {
                "hand":      "left" | "right" | "none",
                "position":  [x, y, z],
                "orientation": [x, y, z, w],   # quaternion xyzw
                "axes":      [...],
                "buttons":   [{"pressed": bool, "value": float}, ...]
            },
            ...
        ],
        "armLatched": bool
    }

We translate the right-hand controller pose into delta commands relative to
the moment the user latched the arm (right-controller A button toggle on the
headset). LeRobot's ``EEReferenceAndDelta`` step then adds those deltas to
the latched robot end-effector pose, ``EEBoundsAndSafety`` clamps the result,
and ``InverseKinematicsEEToJoints`` solves IK against the SO101 URDF.

Coordinate transform (WebXR is right-handed, Y-up)::

    +X = right, +Y = up, +Z = backward (toward user)

SO101 URDF (typical robotics frame, Z-up)::

    +X = forward, +Y = left, +Z = up

The default mapping below converts a WebXR-frame delta to a robot-frame
delta. Sign flips are easy to tweak via ``pos_axis_map`` if the arm moves
the wrong way along an axis.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np

from lerobot.configs.types import FeatureType, PipelineFeatureType, PolicyFeature
from lerobot.processor import (
    ProcessorStepRegistry,
    RobotAction,
    RobotActionProcessorStep,
)
from lerobot.utils.rotation import Rotation


# Default WebXR -> robot axis mapping. Each tuple is (xr_index, sign).
# Override by passing ``pos_axis_map`` when constructing the step.
DEFAULT_POS_AXIS_MAP: tuple[tuple[int, float], tuple[int, float], tuple[int, float]] = (
    (2, -1.0),  # robot X = -xr_z (WebXR forward -> robot +X)
    (0, -1.0),  # robot Y = -xr_x (WebXR right -> robot -Y, i.e. left positive)
    (1, +1.0),  # robot Z = +xr_y (WebXR up   -> robot +Z)
)


@ProcessorStepRegistry.register("map_xr_action_to_robot_action")
@dataclass
class MapXRActionToRobotAction(RobotActionProcessorStep):
    """Convert an ``xr.packet`` action entry into ``target_*`` action fields.

    The packet is consumed from ``action["xr.packet"]`` and is expected to be
    an ``InputPacket`` dict (see module docstring).
    """

    pos_axis_map: tuple[tuple[int, float], tuple[int, float], tuple[int, float]] = (
        DEFAULT_POS_AXIS_MAP
    )
    # Reject controller-position deltas smaller than this many metres. Helps
    # ignore Zapbox tracking jitter while the user holds still. Tune if you
    # see the arm drift even when your hand isn't moving.
    pos_deadband_m: float = 0.005  # 5 mm

    # Reject controller-rotation deltas (in radians) smaller than this. The
    # Zapbox/WebXR IMU drifts a few degrees per frame even when the user
    # holds still, which would otherwise make the wrist shimmer constantly.
    rot_deadband_rad: float = 0.05  # ~2.9 degrees

    # Scale factor on the rotation delta sent into IK. 0.0 means "ignore
    # controller orientation entirely — let IK pick whatever wrist pose it
    # wants". Bump up to 1.0 once translation feels right and you want the
    # wrist to follow your hand.
    rot_scale: float = 0.0

    # Drop the first N frames after each fresh latch, in case the headset's
    # very-first reported controller pose is unstable.
    settle_frames: int = 2

    # Latched controller pose. Reset whenever ``armLatched`` flips false->true.
    _latched_pos: np.ndarray | None = field(default=None, init=False, repr=False)
    _latched_rot: Rotation | None = field(default=None, init=False, repr=False)
    _prev_arm_latched: bool = field(default=False, init=False, repr=False)
    _frames_since_latch: int = field(default=0, init=False, repr=False)

    def action(self, action: RobotAction) -> RobotAction:
        packet: dict[str, Any] | None = action.pop("xr.packet", None)
        if packet is None:
            raise ValueError("MapXRActionToRobotAction requires 'xr.packet' in action")

        arm_latched: bool = bool(packet.get("armLatched", False))

        right = None
        left = None
        for c in packet.get("controllers", []):
            if c.get("hand") == "right":
                right = c
            elif c.get("hand") == "left":
                left = c

        target_pos = np.zeros(3, dtype=float)
        target_rot = np.zeros(3, dtype=float)

        active = arm_latched and right is not None
        if active:
            cur_pos = np.array(right["position"], dtype=float)
            cur_rot = Rotation.from_quat(np.array(right["orientation"], dtype=float))

            # (Re-)latch on rising edge of armLatched. Re-latch *every* frame
            # for `settle_frames` so an unstable first pose can't poison the
            # reference: the arm only starts moving once tracking has settled.
            if not self._prev_arm_latched or self._latched_pos is None:
                self._latched_pos = cur_pos.copy()
                self._latched_rot = cur_rot
                self._frames_since_latch = 0
            elif self._frames_since_latch < self.settle_frames:
                self._latched_pos = cur_pos.copy()
                self._latched_rot = cur_rot

            self._frames_since_latch += 1

            d_xr = cur_pos - self._latched_pos
            # Position deadband: ignore sub-mm jitter.
            if float(np.linalg.norm(d_xr)) < self.pos_deadband_m:
                d_xr = np.zeros(3, dtype=float)

            target_pos = np.array(
                [sign * d_xr[idx] for idx, sign in self.pos_axis_map], dtype=float
            )

            if self.rot_scale > 0.0:
                delta_rot = cur_rot * self._latched_rot.inv()
                rotvec_xr = delta_rot.as_rotvec()
                # Rotation deadband: ignore IMU shimmer when the hand is still.
                if float(np.linalg.norm(rotvec_xr)) < self.rot_deadband_rad:
                    rotvec_xr = np.zeros(3, dtype=float)
                target_rot = self.rot_scale * np.array(
                    [sign * rotvec_xr[idx] for idx, sign in self.pos_axis_map],
                    dtype=float,
                )
        else:
            self._latched_pos = None
            self._latched_rot = None
            self._frames_since_latch = 0

        # Gripper: left trigger (button 0) closes, left grip (button 1) opens.
        # Reserved per the original PRD §3.4.
        gripper_vel = 0.0
        if active and left is not None:
            buttons = left.get("buttons") or []
            trigger_val = float(buttons[0]["value"]) if len(buttons) > 0 else 0.0
            grip_val = float(buttons[1]["value"]) if len(buttons) > 1 else 0.0
            gripper_vel = trigger_val - grip_val  # +1 = close, -1 = open

        action["enabled"] = active
        action["target_x"] = float(target_pos[0])
        action["target_y"] = float(target_pos[1])
        action["target_z"] = float(target_pos[2])
        action["target_wx"] = float(target_rot[0])
        action["target_wy"] = float(target_rot[1])
        action["target_wz"] = float(target_rot[2])
        action["gripper_vel"] = float(gripper_vel)

        self._prev_arm_latched = active
        return action

    def reset(self) -> None:
        self._latched_pos = None
        self._latched_rot = None
        self._prev_arm_latched = False
        self._frames_since_latch = 0

    def transform_features(
        self, features: dict[PipelineFeatureType, dict[str, PolicyFeature]]
    ) -> dict[PipelineFeatureType, dict[str, PolicyFeature]]:
        features[PipelineFeatureType.ACTION].pop("xr.packet", None)
        for feat in [
            "enabled",
            "target_x",
            "target_y",
            "target_z",
            "target_wx",
            "target_wy",
            "target_wz",
            "gripper_vel",
        ]:
            features[PipelineFeatureType.ACTION][feat] = PolicyFeature(
                type=FeatureType.ACTION, shape=(1,)
            )
        return features
