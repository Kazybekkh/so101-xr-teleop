import type { WebcamShape } from './WebcamShapeUtil'
import type { GraspBoxShape } from './GraspBoxShapeUtil'
import type { GraspPointShape } from './GraspPointShapeUtil'
import type { GraspApproachShape } from './GraspApproachShapeUtil'

// Registers our custom shape types with tldraw's TLShape union (see the
// TLGlobalShapePropsMap doc comment in @tldraw/tlschema for this pattern).
declare module '@tldraw/tlschema' {
	interface TLGlobalShapePropsMap {
		webcam: WebcamShape['props']
		'grasp-box': GraspBoxShape['props']
		'grasp-point': GraspPointShape['props']
		'grasp-approach': GraspApproachShape['props']
	}
}
