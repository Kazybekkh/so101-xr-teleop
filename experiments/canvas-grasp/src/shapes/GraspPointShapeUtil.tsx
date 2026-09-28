import { Circle2d, HTMLContainer, ShapeUtil, type TLBaseShape } from 'tldraw'

export type GraspPointShape = TLBaseShape<'grasp-point', Record<string, never>>

export const POINT_RADIUS = 10

const TEAL = '#0d9488'

export class GraspPointShapeUtil extends ShapeUtil<GraspPointShape> {
	static override type = 'grasp-point' as const
	static override props = {}

	override getDefaultProps(): GraspPointShape['props'] {
		return {}
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
			radius: POINT_RADIUS,
			isFilled: true,
			x: 0,
			y: 0,
		})
	}

	override component() {
		const r = POINT_RADIUS
		const jaw = 6
		return (
			<HTMLContainer style={{ pointerEvents: 'none' }}>
				<svg width={r * 2} height={r * 2} style={{ overflow: 'visible' }}>
					{/* gripper jaw marks */}
					<line
						x1={r - r - jaw}
						y1={r - r * 0.6}
						x2={r - r}
						y2={r - r * 0.6}
						stroke={TEAL}
						strokeWidth={2}
					/>
					<line
						x1={r - r - jaw}
						y1={r + r * 0.6}
						x2={r - r}
						y2={r + r * 0.6}
						stroke={TEAL}
						strokeWidth={2}
					/>
					<line
						x1={r + r}
						y1={r - r * 0.6}
						x2={r + r + jaw}
						y2={r - r * 0.6}
						stroke={TEAL}
						strokeWidth={2}
					/>
					<line
						x1={r + r}
						y1={r + r * 0.6}
						x2={r + r + jaw}
						y2={r + r * 0.6}
						stroke={TEAL}
						strokeWidth={2}
					/>
					<circle cx={r} cy={r} r={r} fill="white" stroke={TEAL} strokeWidth={2} />
					<circle cx={r} cy={r} r={2.5} fill={TEAL} />
				</svg>
			</HTMLContainer>
		)
	}

	override getIndicatorPath() {
		const r = POINT_RADIUS
		const path = new Path2D()
		path.arc(r, r, r, 0, Math.PI * 2)
		return path
	}
}
