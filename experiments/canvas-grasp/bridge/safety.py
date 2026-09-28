"""Safety limits shared by the dry-run planner and the real motion path (Section 7)."""

from dataclasses import dataclass

# Mirrors WORKSPACE_LIMITS_MM in src/lib/config.ts - keep the two in sync.
WORKSPACE_LIMITS_MM = {
	"x": (-300.0, 300.0),
	"y": (-300.0, 300.0),
	"z": (0.0, 250.0),
}

MAX_JOINT_VELOCITY_DEG_S = 90.0


def clamp_to_workspace(x_mm: float, y_mm: float, z_mm: float) -> tuple[float, float, float]:
	x_lo, x_hi = WORKSPACE_LIMITS_MM["x"]
	y_lo, y_hi = WORKSPACE_LIMITS_MM["y"]
	z_lo, z_hi = WORKSPACE_LIMITS_MM["z"]
	return (
		max(x_lo, min(x_hi, x_mm)),
		max(y_lo, min(y_hi, y_mm)),
		max(z_lo, min(z_hi, z_mm)),
	)


@dataclass
class JointMove:
	start_deg: float
	end_deg: float

	@property
	def duration_s(self) -> float:
		return abs(self.end_deg - self.start_deg) / MAX_JOINT_VELOCITY_DEG_S


def move_duration_s(moves: list[JointMove]) -> float:
	"""Slowest joint gates the whole move, so every joint arrives together."""
	return max((m.duration_s for m in moves), default=0.0)
