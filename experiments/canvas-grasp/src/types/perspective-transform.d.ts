declare module 'perspective-transform' {
	interface PerspectiveTransform {
		coeffs: number[]
		coeffsInv: number[]
		srcPts: number[]
		dstPts: number[]
		transform(x: number, y: number): [number, number]
		transformInverse(x: number, y: number): [number, number]
	}

	function PerspT(srcPts: number[], dstPts: number[]): PerspectiveTransform

	export default PerspT
}
