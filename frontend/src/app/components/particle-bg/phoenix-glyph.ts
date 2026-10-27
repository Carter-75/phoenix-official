// The canonical phoenix glyph outline and its point-in-polygon test.
// One outline for every skin: it drives both the inner-fill particle
// sampling and the core sprite glyph, so the two layers always agree.
// Moved out of particle-bg.component.ts in the code organization
// pass (Oct 27, 2026); coordinates unchanged.
// Canonical phoenix outline in normalized bird space: nx is the wing
// axis (-1..1), nz is the body axis (0 at the beak tip, 1 at the tail
// plume tips). One outline for every skin: it drives both the
// inner-fill particle sampling and the core sprite glyph, so the two
// layers always agree. Drawn to read as an actual phoenix (visual spec
// addendum, Oct 25, 2026): a narrow beak spike, a round head clearly
// wider than the pinched neck behind it, swept wings with scalloped
// primary feathers on the trailing edge, a tapering body, and a tail
// that fans into five layered plumes (outer, mid, and the centre tip
// on the axis). Right half from the beak, clockwise; the full outline
// mirrors it.
const GLYPH_HALF: Array<[number, number]> = [
  // Beak: a narrow spike ahead of the head.
  [0.0, 0.0], [0.040, 0.045],
  // Head: round and wide, widest at the cheek, then the pinched neck.
  // The head and neck sit clearly ahead of the wings: the first
  // in-game iteration merged them into the wing dome and the bird
  // read as a mushroom, so the wing roots start further back now.
  [0.085, 0.055], [0.130, 0.100], [0.118, 0.145], [0.072, 0.180],
  // Chest and shoulder, widening into the wing root.
  [0.095, 0.215], [0.150, 0.245],
  // Wing leading edge, sweeping out and back to the pointed tip.
  [0.340, 0.245], [0.560, 0.275], [0.760, 0.325], [0.925, 0.390], [1.0, 0.455],
  // Wing trailing edge: three scalloped primary feathers back to the
  // rear wing root.
  [0.865, 0.510], [0.780, 0.462], [0.682, 0.535], [0.600, 0.485],
  [0.500, 0.548], [0.425, 0.502], [0.350, 0.555], [0.245, 0.525], [0.180, 0.565],
  // Body side, tapering to the hips.
  [0.152, 0.615], [0.136, 0.665],
  // Tail fan: outer plume, notch, mid plume, notch, centre plume tip.
  [0.155, 0.705], [0.238, 0.800], [0.332, 0.900], [0.410, 0.968],
  [0.298, 0.882], [0.233, 1.0], [0.128, 0.902], [0.0, 1.0],
];
export const GLYPH_OUTLINE: Array<[number, number]> = (() => {
  const pts: Array<[number, number]> = [...GLYPH_HALF];
  for (let i = GLYPH_HALF.length - 2; i >= 1; i--) pts.push([-GLYPH_HALF[i][0], GLYPH_HALF[i][1]]);
  return pts;
})();

export function pointInGlyph(nx: number, nz: number): boolean {
  // Ray cast against GLYPH_OUTLINE.
  let inside = false;
  const poly = GLYPH_OUTLINE;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
    if ((zi > nz) !== (zj > nz) && nx < ((xj - xi) * (nz - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
