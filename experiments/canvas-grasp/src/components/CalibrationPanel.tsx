import { useEffect, useState } from 'react'
import type { Editor, TLShapeId } from 'tldraw'
import { pagePointToPixel } from '../lib/coordinatePipeline'
import { loadCalibrationRecord, saveCalibration, type CalibrationPoint } from '../lib/calibrationStore'

const DEFAULT_WORLD_MM: [number, number][] = [
	[0, 0],
	[300, 0],
	[300, 300],
	[0, 300],
]

interface Row {
	world_mm: [number, number]
	pixel: [number, number] | null
}

function makeInitialRows(cameraLabel: string): Row[] {
	const existing = loadCalibrationRecord(cameraLabel)
	if (existing && existing.points.length === 4) {
		return existing.points.map((p) => ({ world_mm: p.world_mm, pixel: p.pixel }))
	}
	return DEFAULT_WORLD_MM.map((world_mm) => ({ world_mm, pixel: null }))
}

export function CalibrationPanel({
	editor,
	videoShapeId,
	cameraLabel,
	onDone,
	onCancel,
}: {
	editor: Editor | null
	videoShapeId: TLShapeId | null
	cameraLabel: string
	onDone: () => void
	onCancel: () => void
}) {
	const [rows, setRows] = useState<Row[]>(() => makeInitialRows(cameraLabel))
	const [armedIndex, setArmedIndex] = useState<number | null>(null)

	useEffect(() => {
		if (armedIndex === null || !editor || !videoShapeId) return

		const container = editor.getContainer()

		const handlePointerDown = (e: PointerEvent) => {
			const rect = container.getBoundingClientRect()
			const pagePoint = editor.screenToPage({
				x: e.clientX - rect.left,
				y: e.clientY - rect.top,
			})
			const pixel = pagePointToPixel(editor, videoShapeId, pagePoint)
			if (!pixel) return
			setRows((prev) =>
				prev.map((row, i) => (i === armedIndex ? { ...row, pixel: [pixel.x, pixel.y] } : row))
			)
			setArmedIndex(null)
		}

		container.addEventListener('pointerdown', handlePointerDown, { capture: true })
		return () => container.removeEventListener('pointerdown', handlePointerDown, { capture: true })
	}, [armedIndex, editor, videoShapeId])

	const allCaptured = rows.every((r) => r.pixel !== null)

	function updateWorld(index: number, axis: 0 | 1, value: number) {
		setRows((prev) =>
			prev.map((row, i) => {
				if (i !== index) return row
				const world_mm: [number, number] = [...row.world_mm]
				world_mm[axis] = value
				return { ...row, world_mm }
			})
		)
	}

	function handleSave() {
		if (!allCaptured) return
		const points: CalibrationPoint[] = rows.map((r) => ({
			world_mm: r.world_mm,
			pixel: r.pixel as [number, number],
		}))
		saveCalibration(cameraLabel, points)
		onDone()
	}

	return (
		<div className="calibration-panel">
			<h3>Table calibration — {cameraLabel}</h3>
			<p className="calibration-hint">
				For each row, enter the measured table point (mm, robot base frame), then click
				"Capture" and click that same physical point in the video feed.
			</p>
			<table className="calibration-table">
				<thead>
					<tr>
						<th>#</th>
						<th>World X (mm)</th>
						<th>World Y (mm)</th>
						<th>Pixel</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{rows.map((row, i) => (
						<tr key={i} className={armedIndex === i ? 'armed' : undefined}>
							<td>{i + 1}</td>
							<td>
								<input
									type="number"
									value={row.world_mm[0]}
									onChange={(e) => updateWorld(i, 0, Number(e.target.value))}
								/>
							</td>
							<td>
								<input
									type="number"
									value={row.world_mm[1]}
									onChange={(e) => updateWorld(i, 1, Number(e.target.value))}
								/>
							</td>
							<td className="pixel-cell">
								{row.pixel ? `${row.pixel[0].toFixed(0)}, ${row.pixel[1].toFixed(0)}` : '—'}
							</td>
							<td>
								<button
									className={armedIndex === i ? 'capture-btn armed' : 'capture-btn'}
									onClick={() => setArmedIndex(i)}
								>
									{armedIndex === i ? 'Click the video…' : 'Capture'}
								</button>
							</td>
						</tr>
					))}
				</tbody>
			</table>
			<div className="calibration-actions">
				<button onClick={onCancel}>Cancel</button>
				<button className="primary" disabled={!allCaptured} onClick={handleSave}>
					Save calibration
				</button>
			</div>
		</div>
	)
}
