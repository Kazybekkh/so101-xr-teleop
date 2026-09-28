"""M4 hook: real motion via LeRobot's Feetech motor bus.

Not exercised by M0-M3 - the client always sends dry_run=true until M4 is
built out, and the bridge only reaches into this module when dry_run=false.
The import is guarded so the bridge still runs (in dry-run-only mode) on a
dev machine with no arm attached and no LeRobot install.

Update HOME_POSITION_DEG and the servo id map for your actual SO-101 wiring
before driving real hardware.
"""

from .ik import JointTargets
from .safety import JointMove, move_duration_s

try:
	from lerobot.common.robot_devices.motors.feetech import FeetechMotorsBus

	HARDWARE_AVAILABLE = True
except ImportError:
	FeetechMotorsBus = None
	HARDWARE_AVAILABLE = False


class HardwareUnavailable(Exception):
	pass


HOME_POSITION_DEG = JointTargets(base_deg=0.0, shoulder_deg=0.0, elbow_deg=0.0, wrist_deg=0.0)

# Maps our logical joint names to the SO-101's Feetech servo ids. Adjust to match
# how the arm is actually wired.
SERVO_IDS = {
	"base": 1,
	"shoulder": 2,
	"elbow": 3,
	"wrist": 4,
	"gripper": 5,
}


class SO101Arm:
	"""Thin wrapper around FeetechMotorsBus for the moves this bridge issues."""

	def __init__(self, port: str = "/dev/ttyACM0"):
		if not HARDWARE_AVAILABLE:
			raise HardwareUnavailable(
				"lerobot is not installed - install it and its Feetech extras to drive real hardware"
			)
		self._bus = FeetechMotorsBus(port=port, motors=SERVO_IDS)
		self._connected = False

	def connect(self):
		self._bus.connect()
		self._connected = True

	def disconnect(self):
		if self._connected:
			self._bus.disconnect()
			self._connected = False

	def _write_joint(self, name: str, degrees: float):
		self._bus.write("Goal_Position", SERVO_IDS[name], degrees)

	def move_to(self, targets: JointTargets, current: JointTargets) -> float:
		"""Writes goal positions for every joint and returns the move's duration."""
		duration_s = move_duration_s(
			[
				JointMove(current.base_deg, targets.base_deg),
				JointMove(current.shoulder_deg, targets.shoulder_deg),
				JointMove(current.elbow_deg, targets.elbow_deg),
				JointMove(current.wrist_deg, targets.wrist_deg),
			]
		)
		self._write_joint("base", targets.base_deg)
		self._write_joint("shoulder", targets.shoulder_deg)
		self._write_joint("elbow", targets.elbow_deg)
		self._write_joint("wrist", targets.wrist_deg)
		return duration_s

	def set_gripper_mm(self, opening_mm: float):
		self._bus.write("Goal_Position", SERVO_IDS["gripper"], opening_mm)

	def home(self, current: JointTargets) -> float:
		return self.move_to(HOME_POSITION_DEG, current)
