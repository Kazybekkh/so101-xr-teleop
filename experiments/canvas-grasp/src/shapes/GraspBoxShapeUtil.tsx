import { BaseBoxShapeUtil, HTMLContainer, T, type RecordProps, type TLBaseShape } from 'tldraw'

export type GraspBoxShape = TLBaseShape<'grasp-box', { w: number; h: number }>

export const graspBoxShapeProps: RecordProps<GraspBoxShape> = {
	w: T.number,
	h: T.number,
}

const TEAL = '#0d9488'

export class GraspBoxShapeUtil extends BaseBoxShapeUtil<GraspBoxShape> {
	static override type = 'grasp-box' as const
	static override props = graspBoxShapeProps

	override getDefaultProps(): GraspBoxShape['props'] {
		return { w: 160, h: 120 }
	}

	override canEdit() {
		return false
	}

	override component(shape: GraspBoxShape) {
		return (
			<HTMLContainer style={{ pointerEvents: 'none' }}>
				<svg width={shape.props.w} height={shape.props.h} style={{ overflow: 'visible' }}>
					<rect
						x={1.5}
						y={1.5}
						width={Math.max(0, shape.props.w - 3)}
						height={Math.max(0, shape.props.h - 3)}
						fill="none"
						stroke={TEAL}
						strokeWidth={2}
					/>
				</svg>
			</HTMLContainer>
		)
	}

	override getIndicatorPath(shape: GraspBoxShape) {
		const path = new Path2D()
		path.rect(0, 0, shape.props.w, shape.props.h)
		return path
	}
}
