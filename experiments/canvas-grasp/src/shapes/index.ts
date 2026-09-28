import { WebcamShapeUtil } from './WebcamShapeUtil'
import { GraspBoxShapeUtil } from './GraspBoxShapeUtil'
import { GraspPointShapeUtil } from './GraspPointShapeUtil'
import { GraspApproachShapeUtil } from './GraspApproachShapeUtil'

export const customShapeUtils = [
	WebcamShapeUtil,
	GraspBoxShapeUtil,
	GraspPointShapeUtil,
	GraspApproachShapeUtil,
]

export const ANNOTATION_SHAPE_TYPES = ['grasp-box', 'grasp-point', 'grasp-approach'] as const

export * from './WebcamShapeUtil'
export * from './GraspBoxShapeUtil'
export * from './GraspPointShapeUtil'
export * from './GraspApproachShapeUtil'
