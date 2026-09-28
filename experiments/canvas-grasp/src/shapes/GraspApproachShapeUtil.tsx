import {
	Circle2d,
	HTMLContainer,
	ShapeUtil,
	T,
	track,
	useEditor,
	type RecordProps,
	type TLBaseShape,
	type TLShapeId,
} from 'tldraw'
import { POINT_RADIUS } from './GraspPointShapeUtil'

const asShapeId = (id: string) => id as TLShapeId

export type GraspApproachShape = TLBaseShape<
	'grasp-approach',
	{
		// stored as a plain string (not TLShapeId) since RecordProps validators work on
		// primitives; cast to TLShapeId at the editor.getShape() call site.
		pointShapeId: string | null
	}
>

export const graspApproachShapeProps: RecordProps<GraspApproachShape> = {
	pointShapeId: T.string.nullable(),
}

export const HANDLE_RADIUS = 8
const TEAL = '#0d9488'

export class GraspApproachShapeUtil extends ShapeUtil<GraspApproachShape> {
	static override type = 'grasp-approach' as const
	static override props = graspApproachShapeProps

	override getDefaultProps(): GraspApproachShape['props'] {
		return { pointShapeId: null }
	}

	override canEdit() {
		return false
	}

	override canResize() {
		return false
	}

	override hideRotateHandle() {
		return true
	}

	override getGeometry() {
		return new Circle2d({
			radius: HANDLE_RADIUS,
			isFilled: true,
		})
	}

	override component(shape: GraspApproachShape) {
		return <ApproachHandle shape={shape} />
	}

	override getIndicatorPath() {
		const r = HANDLE_RADIUS
		const path = new Path2D()
		path.arc(r, r, r, 0, Math.PI * 2)
		return path
	}
}

const ApproachHandle = track(function ApproachHandle({ shape }: { shape: GraspApproachShape }) {
	const editor = useEditor()
	const r = HANDLE_RADIUS

	const point = shape.props.pointShapeId
		? editor.getShape(asShapeId(shape.props.pointShapeId))
		: undefined

	let dx = 0
	let dy = 0
	if (point && point.parentId === shape.parentId) {
		// grasp-point's origin is its own top-left; POINT_RADIUS offset gets us to its center
		dx = point.x + POINT_RADIUS - (shape.x + r)
		dy = point.y + POINT_RADIUS - (shape.y + r)
	}

	const pad = 4
	const minX = Math.min(0, dx) - pad
	const minY = Math.min(0, dy) - pad
	const maxX = Math.max(r * 2, dx) + pad
	const maxY = Math.max(r * 2, dy) + pad
	// shift so drawing coords (which reference the handle center at local (r, r)) land inside
	// a positive width/height box positioned at the (possibly negative) offset via left/top.
	const ox = -minX
	const oy = -minY

	return (
		<HTMLContainer style={{ pointerEvents: 'none' }}>
			<svg
				width={maxX - minX}
				height={maxY - minY}
				style={{ position: 'absolute', left: minX, top: minY, overflow: 'visible' }}
			>
				{(dx !== 0 || dy !== 0) && (
					<line
						x1={r + ox}
						y1={r + oy}
						x2={r + dx + ox}
						y2={r + dy + oy}
						stroke={TEAL}
						strokeWidth={2}
						strokeDasharray="4 3"
					/>
				)}
				<circle cx={r + ox} cy={r + oy} r={r} fill={TEAL} stroke="white" strokeWidth={2} />
			</svg>
		</HTMLContainer>
	)
})
