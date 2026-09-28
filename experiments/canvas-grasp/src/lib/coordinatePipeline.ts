import { Mat, type Editor, type TLShapeId, type VecLike } from 'tldraw'
import type { WebcamShape } from '../shapes/WebcamShapeUtil'
import type { GraspBoxShape } from '../shapes/GraspBoxShapeUtil'
import { getVideoNativeSize } from './videoRegistry'
import type { Homography } from './calibrationStore'

export interface PixelPoint {
	x: number
	y: number
}

export interface WorldPoint {
	x: number
	y: number
}

/**
 * Step 1-3 of the PRD pipeline: a page-space point -> the webcam shape's local
 * space (via the inverted page transform) -> pixel space (scaled by the video's
 * native resolution over its on-canvas display size).
 */
export function pagePointToPixel(
	editor: Editor,
	videoShapeId: TLShapeId,
	pagePoint: VecLike
): PixelPoint | null {
	const shape = editor.getShape(videoShapeId) as WebcamShape | undefined
	if (!shape) return null

	const native = getVideoNativeSize(videoShapeId)
	if (!native) return null

	const pageTransform = editor.getShapePageTransform(videoShapeId)
	if (!pageTransform) return null

	const inverse = Mat.Inverse(pageTransform)
	const local = Mat.applyToPoint(inverse, pagePoint)

	const scaleX = native.videoWidth / shape.props.w
	const scaleY = native.videoHeight / shape.props.h

	return { x: local.x * scaleX, y: local.y * scaleY }
}

/** Step 4: pixel -> world (table) coordinates via the calibrated homography. */
export function pixelToWorld(pixel: PixelPoint, homography: Homography): WorldPoint {
	const [x, y] = homography.transform(pixel.x, pixel.y)
	return { x, y }
}

export function worldToPixel(world: WorldPoint, homography: Homography): PixelPoint {
	const [x, y] = homography.transformInverse(world.x, world.y)
	return { x, y }
}

/** The page-space center of a shape (using its own geometry bounds, in its parent's frame). */
export function getShapePageCenter(editor: Editor, shapeId: TLShapeId): VecLike | null {
	const bounds = editor.getShapePageBounds(shapeId)
	if (!bounds) return null
	return { x: bounds.midX, y: bounds.midY }
}

export interface GraspAnnotationIds {
	boxId: TLShapeId
	pointId: TLShapeId
	approachId: TLShapeId
}

export interface GraspOutput {
	pixel: PixelPoint
	world: WorldPoint
	approach_deg: number
	gripper_mm: number
}

/**
 * Derives the full live grasp readout from the current annotation shapes: the grasp
 * point's world position, the wrist yaw (computed in *world* space from the point ->
 * approach-handle vector, so calibration rotation between camera and table is respected),
 * and the gripper opening width (the grasp-box's world-space edge-to-edge distance).
 */
export function computeGraspOutput(
	editor: Editor,
	videoShapeId: TLShapeId,
	ids: GraspAnnotationIds,
	homography: Homography
): GraspOutput | null {
	const pointCenter = getShapePageCenter(editor, ids.pointId)
	const approachCenter = getShapePageCenter(editor, ids.approachId)
	const box = editor.getShape(ids.boxId) as GraspBoxShape | undefined
	const boxPageTransform = editor.getShapePageTransform(ids.boxId)
	if (!pointCenter || !approachCenter || !box || !boxPageTransform) return null

	const pointPixel = pagePointToPixel(editor, videoShapeId, pointCenter)
	const approachPixel = pagePointToPixel(editor, videoShapeId, approachCenter)
	if (!pointPixel || !approachPixel) return null

	const pointWorld = pixelToWorld(pointPixel, homography)
	const approachWorld = pixelToWorld(approachPixel, homography)

	const approach_deg =
		(Math.atan2(approachWorld.y - pointWorld.y, approachWorld.x - pointWorld.x) * 180) / Math.PI

	const leftPage = Mat.applyToPoint(boxPageTransform, { x: 0, y: box.props.h / 2 })
	const rightPage = Mat.applyToPoint(boxPageTransform, { x: box.props.w, y: box.props.h / 2 })
	const leftPixel = pagePointToPixel(editor, videoShapeId, leftPage)
	const rightPixel = pagePointToPixel(editor, videoShapeId, rightPage)
	if (!leftPixel || !rightPixel) return null

	const leftWorld = pixelToWorld(leftPixel, homography)
	const rightWorld = pixelToWorld(rightPixel, homography)
	const gripper_mm = Math.hypot(rightWorld.x - leftWorld.x, rightWorld.y - leftWorld.y)

	return { pixel: pointPixel, world: pointWorld, approach_deg, gripper_mm }
}
