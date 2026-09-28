import { useCallback, useEffect, useState } from 'react'
import { Tldraw, createShapeId, type Editor, type TLShapeId } from 'tldraw'
import 'tldraw/tldraw.css'
import './app.css'

import { customShapeUtils } from './shapes'
import type { GraspAnnotationIds } from './lib/coordinatePipeline'
import { createGraspAnnotation } from './lib/annotations'
import { loadHomography, type Homography } from './lib/calibrationStore'
import { BRIDGE_URL } from './lib/config'
import { useGraspBridge } from './hooks/useGraspBridge'
import { CalibrationPanel } from './components/CalibrationPanel'
import { StatusPanel, useMediaDevices } from './components/StatusPanel'

export default function App() {
	const [editor, setEditor] = useState<Editor | null>(null)
	const [videoShapeId, setVideoShapeId] = useState<TLShapeId | null>(null)
	const [graspIds, setGraspIds] = useState<GraspAnnotationIds | null>(null)
	const [cameraLabel, setCameraLabel] = useState('default')
	const [deviceId, setDeviceId] = useState<string | null>(null)
	const [calibrating, setCalibrating] = useState(false)
	const [homography, setHomography] = useState<Homography | null>(null)
	const [dryRun, setDryRun] = useState(true)

	const devices = useMediaDevices()
	const bridge = useGraspBridge(BRIDGE_URL)

	useEffect(() => {
		setHomography(loadHomography(cameraLabel))
	}, [cameraLabel])

	const handleMount = useCallback(
		(mountedEditor: Editor) => {
			setEditor(mountedEditor)
			const existing = mountedEditor.getCurrentPageShapes().find((s) => s.type === 'webcam')
			if (existing) {
				setVideoShapeId(existing.id)
				return
			}
			const id = createShapeId()
			mountedEditor.createShape({
				id,
				type: 'webcam',
				x: 80,
				y: 80,
				props: { w: 640, h: 480, label: cameraLabel, deviceId },
			})
			setVideoShapeId(id)
			mountedEditor.zoomToFit()
		},
		// only used to seed the shape's initial props on first mount
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[]
	)

	useEffect(() => {
		if (!editor || !videoShapeId) return
		editor.updateShape({ id: videoShapeId, type: 'webcam', props: { label: cameraLabel, deviceId } })
	}, [editor, videoShapeId, cameraLabel, deviceId])

	function handleNewAnnotation() {
		if (!editor || !videoShapeId) return
		setGraspIds(createGraspAnnotation(editor, videoShapeId, graspIds))
	}

	function handleCalibrationDone() {
		setHomography(loadHomography(cameraLabel))
		setCalibrating(false)
	}

	return (
		<div className="app">
			<div className="canvas-area">
				<Tldraw
					shapeUtils={customShapeUtils}
					onMount={handleMount}
					components={{ StylePanel: null }}
				/>
				{calibrating && (
					<div className="modal-overlay">
						<CalibrationPanel
							editor={editor}
							videoShapeId={videoShapeId}
							cameraLabel={cameraLabel}
							onDone={handleCalibrationDone}
							onCancel={() => setCalibrating(false)}
						/>
					</div>
				)}
			</div>
			<StatusPanel
				editor={editor}
				videoShapeId={videoShapeId}
				graspIds={graspIds}
				homography={homography}
				cameraLabel={cameraLabel}
				onCameraLabelChange={setCameraLabel}
				devices={devices}
				deviceId={deviceId}
				onDeviceChange={setDeviceId}
				onNewAnnotation={handleNewAnnotation}
				onCalibrate={() => setCalibrating(true)}
				dryRun={dryRun}
				onDryRunChange={setDryRun}
				connectionState={bridge.connectionState}
				lastStatus={bridge.lastStatus}
				log={bridge.log}
				onSend={bridge.send}
			/>
		</div>
	)
}
