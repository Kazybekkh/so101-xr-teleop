export const BRIDGE_URL = 'ws://localhost:8765'

// Fixed top-down grasp height (mm, robot base frame). Section 7: "Fixed approach height,
// descend vertically" - this is the z the gripper descends to before closing.
export const GRASP_HEIGHT_MM = 145

export const DEFAULT_GRIPPER_MM = 40

// Safety clamp box (mm, robot base frame) - matches the bridge's WORKSPACE_LIMITS_MM in
// bridge/server.py. Commands outside this box are rejected client-side too, as a first check.
export const WORKSPACE_LIMITS_MM = {
	x: [-300, 300] as [number, number],
	y: [-300, 300] as [number, number],
	z: [0, 250] as [number, number],
}
