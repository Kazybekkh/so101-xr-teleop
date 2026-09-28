import { useEffect, useState } from 'react'
import { track, type Editor, type TLShapeId } from 'tldraw'
import type { GraspAnnotationIds } from '../lib/coordinatePipeline'
import { computeGraspOutput } from '../lib/coordinatePipeline'
import type { Homography } from '../lib/calibrationStore'
import { loadCalibrationRecord } from '../lib/calibrationStore'
import { GRASP_HEIGHT_MM } from '../lib/config'
import type { BridgeConnectionState, BridgeStatusMessage, GraspCommand } from '../types/protocol'
import type { BridgeLogEntry } from '../hooks/useGraspBridge'

interface Props {
	editor: Editor | null
	videoShapeId: TLShapeId | null
	graspIds: GraspAnnotationIds | null
	homography: Homography | null
	cameraLabel: string
	onCameraLabelChange: (label: string) => void
	devices: MediaDeviceInfo[]
	deviceId: string | null
	onDeviceChange: (deviceId: string | null) => void
	onNewAnnotation: () => void
	onCalibrate: () => void
	dryRun: boolean
	onDryRunChange: (v: boolean) => void
	connectionState: BridgeConnectionState
	lastStatus: BridgeStatusMessage | null
	log: BridgeLogEntry[]
	onSend: (command: GraspCommand) => boolean
}

const connectionLabel: Record<BridgeConnectionState, string> = {
	connected: 'Connected',
	connecting: 'Connecting…',
	disconnected: 'Disconnected — retrying',
	error: 'Connection error',
}

export const StatusPanel = track(function StatusPanel({
	editor,
	videoShapeId,
	graspIds,
	homography,
	cameraLabel,
	onCameraLabelChange,
	devices,
	deviceId,
	onDeviceChange,
	onNewAnnotation,
	onCalibrate,
	dryRun,
	onDryRunChange,
	connectionState,
	lastStatus,
	log,
	onSend,
}: Props) {
	const [gripperOverride, setGripperOverride] = useState<number | null>(null)

	const calibrationRecord = loadCalibrationRecord(cameraLabel)

	const output =
		editor && videoShapeId && graspIds && homography
			? computeGraspOutput(editor, videoShapeId, graspIds, homography)
			: null

	const command: GraspCommand | null = output
		? {
				type: 'grasp',
				world_mm: [
					Math.round(output.world.x * 10) / 10,
					Math.round(output.world.y * 10) / 10,
					GRASP_HEIGHT_MM,
				],
				approach_deg: Math.round(output.approach_deg * 10) / 10,
				gripper_mm: Math.round((gripperOverride ?? output.gripper_mm) * 10) / 10,
				dry_run: dryRun,
			}
		: null

	return (
		<aside className="status-panel">
			<h2>Grasp Annotator</h2>

			<section className="panel-section">
				<h3>Camera</h3>
				<label className="field">
					<span>Label (calibration key)</span>
					<input value={cameraLabel} onChange={(e) => onCameraLabelChange(e.target.value)} />
				</label>
				<label className="field">
					<span>Device</span>
					<select
						value={deviceId ?? ''}
						onChange={(e) => onDeviceChange(e.target.value || null)}
					>
						<option value="">System default</option>
						{devices.map((d) => (
							<option key={d.deviceId} value={d.deviceId}>
								{d.label || d.deviceId}
							</option>
						))}
					</select>
				</label>
			</section>

			<section className="panel-section">
				<h3>Calibration</h3>
				<p className="calibration-status">
					{calibrationRecord ? (
						<>
							Calibrated{' '}
							<span className="muted">
								({new Date(calibrationRecord.calibratedAt).toLocaleString()})
							</span>
						</>
					) : (
						<span className="warn">Not calibrated</span>
					)}
				</p>
				<button onClick={onCalibrate}>{calibrationRecord ? 'Recalibrate' : 'Calibrate'}</button>
			</section>

			<section className="panel-section">
				<h3>Annotation</h3>
				<button onClick={onNewAnnotation} disabled={!videoShapeId}>
					New grasp annotation
				</button>
				<label className="field">
					<span>Gripper width override (mm)</span>
					<input
						type="number"
						placeholder={output ? output.gripper_mm.toFixed(1) : '—'}
						value={gripperOverride ?? ''}
						onChange={(e) =>
							setGripperOverride(e.target.value === '' ? null : Number(e.target.value))
						}
					/>
				</label>
			</section>

			<section className="panel-section">
				<h3>Live output</h3>
				{!homography && <p className="warn">Calibrate the table before grasp output is available.</p>}
				{homography && !graspIds && <p className="muted">Draw a grasp annotation to see output.</p>}
				<pre className="json-output">
					{command ? JSON.stringify(command, null, 2) : '// incomplete — see warnings above'}
				</pre>
			</section>

			<section className="panel-section">
				<h3>Dry run</h3>
				<label className="toggle">
					<input
						type="checkbox"
						checked={dryRun}
						onChange={(e) => onDryRunChange(e.target.checked)}
					/>
					<span>{dryRun ? 'On — bridge will only log, no motion' : 'Off — bridge will drive the arm'}</span>
				</label>
				<button
					className="primary"
					disabled={!command}
					onClick={() => command && onSend(command)}
				>
					Send grasp command
				</button>
			</section>

			<section className="panel-section">
				<h3>Bridge — {connectionLabel[connectionState]}</h3>
				{lastStatus && (
					<p className={`bridge-state bridge-state--${lastStatus.state}`}>
						{lastStatus.state}: {lastStatus.detail}
					</p>
				)}
				<div className="bridge-log">
					{log
						.slice()
						.reverse()
						.map((entry) => (
							<div key={entry.id} className={`log-entry log-entry--${entry.direction}`}>
								<span className="log-time">{entry.at}</span>
								<span className="log-message">{entry.message}</span>
							</div>
						))}
				</div>
			</section>
		</aside>
	)
})

export function useMediaDevices() {
	const [devices, setDevices] = useState<MediaDeviceInfo[]>([])

	useEffect(() => {
		let cancelled = false
		async function load() {
			try {
				const all = await navigator.mediaDevices.enumerateDevices()
				if (!cancelled) setDevices(all.filter((d) => d.kind === 'videoinput'))
			} catch {
				// ignore — enumerateDevices can fail before permission is granted
			}
		}
		load()
		navigator.mediaDevices.addEventListener('devicechange', load)
		return () => {
			cancelled = true
			navigator.mediaDevices.removeEventListener('devicechange', load)
		}
	}, [])

	return devices
}
