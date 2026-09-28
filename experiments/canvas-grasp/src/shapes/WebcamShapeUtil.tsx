import {
	BaseBoxShapeUtil,
	HTMLContainer,
	T,
	type RecordProps,
	type TLBaseShape,
} from 'tldraw'
import { useEffect, useRef, useState } from 'react'
import { clearVideoNativeSize, setVideoNativeSize } from '../lib/videoRegistry'

export type WebcamShape = TLBaseShape<
	'webcam',
	{
		w: number
		h: number
		label: string
		deviceId: string | null
	}
>

export const webcamShapeProps: RecordProps<WebcamShape> = {
	w: T.number,
	h: T.number,
	label: T.string,
	deviceId: T.string.nullable(),
}

export class WebcamShapeUtil extends BaseBoxShapeUtil<WebcamShape> {
	static override type = 'webcam' as const
	static override props = webcamShapeProps

	override getDefaultProps(): WebcamShape['props'] {
		return { w: 640, h: 480, label: 'default', deviceId: null }
	}

	override canEdit() {
		return false
	}

	override isAspectRatioLocked() {
		return true
	}

	override component(shape: WebcamShape) {
		return (
			<HTMLContainer style={{ pointerEvents: 'all' }}>
				<WebcamFeed shapeId={shape.id} deviceId={shape.props.deviceId} />
			</HTMLContainer>
		)
	}

	override getIndicatorPath(shape: WebcamShape) {
		const path = new Path2D()
		path.rect(0, 0, shape.props.w, shape.props.h)
		return path
	}
}

function WebcamFeed({
	shapeId,
	deviceId,
}: {
	shapeId: WebcamShape['id']
	deviceId: string | null
}) {
	const videoRef = useRef<HTMLVideoElement>(null)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		let stream: MediaStream | null = null
		let cancelled = false

		navigator.mediaDevices
			.getUserMedia({
				video: deviceId ? { deviceId: { exact: deviceId } } : true,
				audio: false,
			})
			.then((s) => {
				if (cancelled) {
					s.getTracks().forEach((t) => t.stop())
					return
				}
				stream = s
				const video = videoRef.current
				if (video) {
					video.srcObject = s
				}
			})
			.catch((err: Error) => {
				if (!cancelled) setError(err.message || 'Could not access camera')
			})

		return () => {
			cancelled = true
			stream?.getTracks().forEach((t) => t.stop())
			clearVideoNativeSize(shapeId)
		}
	}, [shapeId, deviceId])

	if (error) {
		return (
			<div className="webcam-error">
				<strong>Camera error</strong>
				<span>{error}</span>
			</div>
		)
	}

	return (
		// eslint-disable-next-line jsx-a11y/media-has-caption
		<video
			ref={videoRef}
			autoPlay
			muted
			playsInline
			style={{ width: '100%', height: '100%', objectFit: 'fill', display: 'block' }}
			onLoadedMetadata={(e) => {
				const video = e.currentTarget
				setVideoNativeSize(shapeId, {
					videoWidth: video.videoWidth,
					videoHeight: video.videoHeight,
				})
			}}
		/>
	)
}
