import PerspT from 'perspective-transform'

export type Homography = ReturnType<typeof PerspT>

export interface CalibrationPoint {
	pixel: [number, number]
	world_mm: [number, number]
}

export interface CalibrationRecord {
	cameraLabel: string
	points: CalibrationPoint[]
	calibratedAt: string
}

const STORAGE_PREFIX = 'grasp-annotator:calibration:'

function storageKey(cameraLabel: string) {
	return STORAGE_PREFIX + cameraLabel
}

export function saveCalibration(cameraLabel: string, points: CalibrationPoint[]) {
	const record: CalibrationRecord = {
		cameraLabel,
		points,
		calibratedAt: new Date().toISOString(),
	}
	localStorage.setItem(storageKey(cameraLabel), JSON.stringify(record))
	return record
}

export function loadCalibrationRecord(cameraLabel: string): CalibrationRecord | null {
	const raw = localStorage.getItem(storageKey(cameraLabel))
	if (!raw) return null
	try {
		return JSON.parse(raw) as CalibrationRecord
	} catch {
		return null
	}
}

export function clearCalibration(cameraLabel: string) {
	localStorage.removeItem(storageKey(cameraLabel))
}

export function homographyFromRecord(record: CalibrationRecord): Homography {
	const srcPts = record.points.flatMap((p) => p.pixel)
	const dstPts = record.points.flatMap((p) => p.world_mm)
	return PerspT(srcPts, dstPts)
}

export function loadHomography(cameraLabel: string): Homography | null {
	const record = loadCalibrationRecord(cameraLabel)
	if (!record || record.points.length !== 4) return null
	return homographyFromRecord(record)
}
