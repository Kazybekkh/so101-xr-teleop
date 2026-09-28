import { atom } from 'tldraw'
import type { TLShapeId } from 'tldraw'

export interface VideoNativeSize {
	videoWidth: number
	videoHeight: number
}

// Native pixel resolution of each webcam shape's live stream, keyed by shape id.
// Populated by the webcam shape's component once the stream's metadata loads.
// The coordinate pipeline needs this (not shape.props.w/h, which is canvas display size).
const $nativeSizes = atom<Record<TLShapeId, VideoNativeSize>>('webcam-native-sizes', {})

export function setVideoNativeSize(shapeId: TLShapeId, size: VideoNativeSize) {
	$nativeSizes.update((sizes) => ({ ...sizes, [shapeId]: size }))
}

export function clearVideoNativeSize(shapeId: TLShapeId) {
	$nativeSizes.update((sizes) => {
		const next = { ...sizes }
		delete next[shapeId]
		return next
	})
}

export function getVideoNativeSize(shapeId: TLShapeId): VideoNativeSize | undefined {
	return $nativeSizes.get()[shapeId]
}

export const nativeSizesAtom = $nativeSizes
