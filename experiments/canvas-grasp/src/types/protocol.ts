export interface GraspCommand {
	type: 'grasp'
	world_mm: [number, number, number]
	approach_deg: number
	gripper_mm: number
	dry_run: boolean
}

export type BridgeState = 'moving' | 'done' | 'error'

export interface BridgeStatusMessage {
	type: 'status'
	state: BridgeState
	detail: string
}

export type BridgeConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'
