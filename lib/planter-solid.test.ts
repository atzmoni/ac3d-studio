import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { solidSkin } from './planter-solid';
import { buildPlanterModel, DEFAULT_PLANTER } from './planter-engine';

/**
 * A flat quad, split on the 0-2 diagonal. Four edges are the cutter's, the
 * diagonal is a crease — so whatever the groove is set to, this piece must come
 * back with material showing on exactly four sides and none down the middle.
 */
const QUAD = {
  corners: [
    [new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0), new THREE.Vector3(10, 10, 0)],
    [new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 10, 0), new THREE.Vector3(0, 10, 0)],
  ],
  ids: [[0, 1, 2], [0, 2, 3]] as [number, number, number][],
};

const NO_GROOVE = { depth: 0, width: 0, skin: 0 };

/** Every triangle in a position buffer, as triples of points. */
const facetsOf = (buffer: Float32Array | number[]): THREE.Vector3[][] => {
  const out: THREE.Vector3[][] = [];
  for (let i = 0; i + 8 < buffer.length; i += 9) {
    out.push([0, 3, 6].map((k) => new THREE.Vector3(buffer[i + k], buffer[i + k + 1], buffer[i + k + 2])));
  }
  return out;
};

const areaOf = (facets: THREE.Vector3[][]) => facets.reduce((sum, [a, b, c]) => sum
  + new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).length() / 2, 0);

/** Every z in a buffer — the quad lies in z = 0, so this is depth into the stock. */
const depthsOf = (buffer: Float32Array) => {
  const out: number[] = [];
  for (let i = 2; i < buffer.length; i += 3) out.push(buffer[i]);
  return out;
};

describe('the wall as a solid', () => {
  it('puts the back face exactly one thickness behind the front', () => {
    const { inner } = solidSkin(QUAD.corners, QUAD.ids, 4, NO_GROOVE);
    const depths = depthsOf(inner);
    expect(depths.length).toBeGreaterThan(0);
    for (const z of depths) expect(z).toBeCloseTo(-4, 5);
    // Two facets, one back face each, and nothing else: an ungrooved crease is
    // unbroken material and must not be given a wall down the middle of it.
    expect(inner.length / 9).toBe(2);
    expect(areaOf(facetsOf(inner))).toBeCloseTo(100, 3);
  });

  it('shows material at every edge the cutter parted, and at no other', () => {
    const { rim } = solidSkin(QUAD.corners, QUAD.ids, 4, NO_GROOVE);
    // Four sides of 10, four deep. The diagonal is grooved, not cut, so it
    // contributes nothing — if it did, the pot would appear to be in two pieces.
    expect(areaOf(facetsOf(rim))).toBeCloseTo(4 * 10 * 4, 3);
    expect(rim.length / 9).toBe(8);
  });

  it('scales the band with the stock, because that is the whole point of it', () => {
    const thin = solidSkin(QUAD.corners, QUAD.ids, 2, NO_GROOVE);
    const thick = solidSkin(QUAD.corners, QUAD.ids, 4, NO_GROOVE);
    expect(areaOf(facetsOf(thick.rim))).toBeCloseTo(areaOf(facetsOf(thin.rim)) * 2, 3);
  });

  it('draws nothing at all for stock with no thickness', () => {
    const { inner, rim } = solidSkin(QUAD.corners, QUAD.ids, 0, NO_GROOVE);
    expect(inner.length).toBe(0);
    expect(rim.length).toBe(0);
  });

  it('cuts the groove to the bit, and never through the hinge', () => {
    // 4 mm stock, 1.2 mm skin: the bit takes 2.8 mm, and at 90° a 2.8 mm cut
    // breaks the back face 5.6 mm wide.
    const groove = { depth: 2.8, width: 5.6, skin: 1.2 };
    const { inner } = solidSkin(QUAD.corners, QUAD.ids, 4, groove);
    const depths = depthsOf(inner);
    // Nothing is deeper than the stock and nothing is shallower than the skin.
    // The second is the one that matters: cut past the skin and there is no
    // hinge left, and the drawing is of two parts rather than one fold.
    expect(Math.min(...depths)).toBeCloseTo(-4, 5);
    expect(Math.max(...depths)).toBeCloseTo(-groove.skin, 5);
  });

  it('gives up half the groove from each side, so the cut is centred on the crease', () => {
    const groove = { depth: 2.8, width: 5.6, skin: 1.2 };
    const { inner } = solidSkin(QUAD.corners, QUAD.ids, 4, groove);
    // The back face is held off the diagonal by half a width and the two ramps
    // make up the rest, so the facet footprint is still covered end to end — a
    // groove takes stock out of the back, it does not take the panel away.
    const flat = facetsOf(inner).filter((tri) => tri.every((p) => Math.abs(p.z + 4) < 1e-4));
    const kept = areaOf(flat.map((tri) => tri.map((p) => new THREE.Vector3(p.x, p.y, 0))));
    // And the cut is mitred where it meets the facet's other edges rather than
    // run off the end as a parallel strip. Each half here is a right isosceles
    // triangle with the hypotenuse moved in by half a width, so both legs lose
    // that half-width times √2 — which is the difference between a groove that
    // stops where the next one starts and two cuts crossing at the corner.
    const leg = 10 - (groove.width / 2) * Math.SQRT2;
    expect(kept).toBeCloseTo(2 * (leg * leg) / 2, 2);
  });

  it('leaves the back unbroken on stock that is bent hot rather than grooved', () => {
    // Acrylic crazes at a sharp crease, so the bit never touches it. A preview
    // that drew a groove there would be drawing an operation nobody performs.
    const model = buildPlanterModel({ ...DEFAULT_PLANTER, material: 'acrylic-3' });
    expect(model.groove.heatBent).toBe(true);
    expect(model.groove.depth).toBe(0);
    const { inner } = solidSkin(QUAD.corners, QUAD.ids, 3, {
      depth: model.groove.depth, width: model.groove.width, skin: model.groove.skin,
    });
    expect(inner.length / 9).toBe(2);
    for (const z of depthsOf(inner)) expect(z).toBeCloseTo(-3, 5);
  });

  it('survives a groove wider than the facet it is cut into', () => {
    // Real designs reach this: fine facets on thick stock with a blunt bit. It
    // is a fabrication error and the checks say so — but the preview still has
    // to draw something finite rather than a facet turned inside out.
    const { inner, rim } = solidSkin(QUAD.corners, QUAD.ids, 4, { depth: 2.8, width: 40, skin: 1.2 });
    for (const value of [...inner, ...rim]) expect(Number.isFinite(value)).toBe(true);
  });
});

describe('the pot it is actually built from', () => {
  it('keeps the whole wall one thickness thick, however it is folded', () => {
    const model = buildPlanterModel({ ...DEFAULT_PLANTER, sides: 6, rows: 3 });
    const stride = model.parameters.sides + 1;
    const at = (id: number) => model.vertices[Math.floor(id / stride)][id % stride];
    // Every inner vertex has to clear every facet that owns it by at least the
    // stock. Closer than that and the wall is drawn thinner than it is cut; the
    // mitre is what buys the corners their extra reach.
    for (const triangle of model.triangles) {
      for (const id of triangle.v) {
        const outer = at(id);
        const inner = model.solid.inner[Math.floor(id / stride)][id % stride];
        const gap = (outer.x - inner.x) * triangle.normal.x
          + (outer.y - inner.y) * triangle.normal.y
          + (outer.z - inner.z) * triangle.normal.z;
        expect(gap).toBeGreaterThanOrEqual(model.solid.thickness - 1e-6);
      }
    }
  });

  it('holds less than a shell with no thickness would have claimed', () => {
    const model = buildPlanterModel(DEFAULT_PLANTER);
    expect(model.solid.litres).toBeLessThan(model.solid.surfaceLitres);
    // Not a rounding difference — 4 mm stock on a 400 mm pot is several percent
    // of what somebody is being told the thing holds.
    expect(model.solid.surfaceLitres / model.solid.litres - 1).toBeGreaterThan(0.03);
  });

  it('will not let the base plate be cut too big to drop through its own hole', () => {
    // The inset is measured off the OUTSIDE of the foot, so an inset under one
    // thickness describes a plate wider than the opening it has to pass. It used
    // to default to 3 mm on 4 mm stock, which is 1 mm of interference that
    // nothing on the drawing would have mentioned.
    for (const material of ['acp-4', 'acp-3', 'steel-2'] as const) {
      const model = buildPlanterModel({ ...DEFAULT_PLANTER, material, baseInset: 0 });
      expect(model.parameters.baseInset).toBeGreaterThan(model.material.thickness);
    }
  });

  it('leaves the cavity the room it says it leaves', () => {
    // The liner is fitted to the inside face. Measured off the outside, as it
    // was, a stated 22 mm gap was 18 mm of actual room for the strip and its
    // wiring on 4 mm stock — nearly a fifth of it gone.
    const model = buildPlanterModel({
      ...DEFAULT_PLANTER, liner: true, cavity: 22, perforation: 'triangles', led: '3000k',
    });
    expect(model.solid.cavity).toBe(model.parameters.cavity);
  });
});
