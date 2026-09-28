"""Planar IK for a fixed-height top-down grasp on the SO-101 (Section 7 of the PRD).

The arm reaches a target (x, y, z) in its base frame with a top-down gripper
orientation. Motion decomposes into:
  - base rotation: atan2(y, x), turning the arm to face the target
  - a two-link planar solve in the vertical plane containing the target, for
    shoulder/elbow angles that reach (r, z) where r = hypot(x, y)
  - wrist yaw: set directly from approach_deg (the grasp's approach direction)

Link lengths are placeholders - measure the physical SO-101 upper arm / forearm
and update LINK_1_MM / LINK_2_MM before driving real hardware.
"""

from dataclasses import dataclass
import math

LINK_1_MM = 116.0
LINK_2_MM = 135.0


class Unreachable(Exception):
	"""Raised when a target is outside the arm's reach for the given link lengths."""


@dataclass
class JointTargets:
	base_deg: float
	shoulder_deg: float
	elbow_deg: float
	wrist_deg: float


def planar_ik(x_mm: float, y_mm: float, z_mm: float, approach_deg: float) -> JointTargets:
	base_rad = math.atan2(y_mm, x_mm)
	r = math.hypot(x_mm, y_mm)
	d = math.hypot(r, z_mm)

	reach = LINK_1_MM + LINK_2_MM
	if d > reach or d < abs(LINK_1_MM - LINK_2_MM):
		raise Unreachable(
			f"target distance {d:.1f}mm is outside the arm's reach "
			f"({abs(LINK_1_MM - LINK_2_MM):.1f}-{reach:.1f}mm)"
		)

	cos_elbow = (d * d - LINK_1_MM * LINK_1_MM - LINK_2_MM * LINK_2_MM) / (2 * LINK_1_MM * LINK_2_MM)
	cos_elbow = max(-1.0, min(1.0, cos_elbow))
	elbow_rad = math.acos(cos_elbow)

	shoulder_rad = math.atan2(z_mm, r) - math.atan2(
		LINK_2_MM * math.sin(elbow_rad), LINK_1_MM + LINK_2_MM * math.cos(elbow_rad)
	)

	return JointTargets(
		base_deg=math.degrees(base_rad),
		shoulder_deg=math.degrees(shoulder_rad),
		elbow_deg=math.degrees(elbow_rad),
		wrist_deg=approach_deg,
	)
