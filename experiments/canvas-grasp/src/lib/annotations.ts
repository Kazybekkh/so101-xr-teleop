import { createShapeId, type Editor, type TLShapeId } from 'tldraw'
import type { GraspAnnotationIds } from './coordinatePipeline'
import type { WebcamShape } from '../shapes/WebcamShapeUtil'

const BOX_W = 160
const BOX_H = 120
const APPROACH_OFFSET = 50

/**
 * Creates a new grasp-box + grasp-point + grasp-approach set parented to the webcam shape,
 * deleting any previous annotation set first ("one annotation at a time" per the PRD).
 */
export function createGraspAnnotation(
	editor: Editor,
	videoShapeId: TLShapeId,
	previous: GraspAnnotationIds | null
): GraspAnnotationIds {
	if (previous) {
		editor.deleteShapes([previous.boxId, previous.pointId, previous.approachId])
	}

	const video = editor.getShape(videoShapeId) as WebcamShape | undefined
	const centerX = video ? video.props.w / 2 : 320
	const centerY = video ? video.props.h / 2 : 240

	const boxId = createShapeId()
	const pointId = createShapeId()
	const approachId = createShapeId()

	editor.createShapes([
		{
			id: boxId,
			type: 'grasp-box',
			parentId: videoShapeId,
			x: centerX - BOX_W / 2,
			y: centerY - BOX_H / 2,
			props: { w: BOX_W, h: BOX_H },
		},
		{
			id: pointId,
			type: 'grasp-point',
			parentId: videoShapeId,
			x: centerX - 10,
			y: centerY - 10,
		},
		{
			id: approachId,
			type: 'grasp-approach',
			parentId: videoShapeId,
			x: centerX - 8 + APPROACH_OFFSET,
			y: centerY - 8,
			props: { pointShapeId: pointId },
		},
	])

	editor.select(boxId, pointId, approachId)

	return { boxId, pointId, approachId }
}

export function deleteGraspAnnotation(editor: Editor, ids: GraspAnnotationIds) {
	editor.deleteShapes([ids.boxId, ids.pointId, ids.approachId])
}
