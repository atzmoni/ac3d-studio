import { describe, expect, it } from 'vitest';
import { buildFoldTree, cornersAt } from './fold-tree';
import { buildPlanterModel, DEFAULT_PLANTER } from './planter-engine';
import type { PlanterParameters, PlanterModel, Vec2, Vec3 } from './types';

const build = (overrides: Partial<PlanterParameters> = {}) => buildPlanterModel({ ...DEFAULT_PLANTER, ...overrides });

/** One band's triangles as fold-tree input: flat/built corners plus vertex ids. */
function bandTriangles(model: PlanterModel, band: number) {
  const { sides } = model.parameters;
  const stride = sides + 1;
  const flatOf = (id: number): Vec2 => model.flatByBand[band][Math.floor(id / stride) - band][id % stride];
  const builtOf = (id: number): Vec3 => model.vertices[Math.floor(id / stride)][id % stride];
  const ids = model.triangles.slice(band * sides * 2, (band + 1) * sides * 2).map((t) => t.v);
  const triangles = ids.map(([a, b, c]) => ({
    flat: [flatOf(a), flatOf(b), flatOf(c)] as [Vec2, Vec2, Vec2],
    built: [builtOf(a), builtOf(b), builtOf(c)] as [Vec3, Vec3, Vec3],
  }));
  const flatPts = triangles.flatMap((t) => t.flat);
  const pivot = { x: flatPts.reduce((s, p) => s + p.x, 0) / flatPts.length, y: flatPts.reduce((s, p) => s + p.y, 0) / flatPts.length };
  return { triangles, ids, pivot };
}

/** The whole wall as one piece, the way single-sheet construction builds it. */
function wallTriangles(model: PlanterModel) {
  const { sides, rows } = model.parameters;
  const stride = sides + 1;
  const flatOf = (id: number): Vec2 => {
    const ring = Math.floor(id / stride);
    const band = Math.min(ring, rows - 1);
    return model.flatByBand[band][ring - band][id % stride];
  };
  const builtOf = (id: number): Vec3 => model.vertices[Math.floor(id / stride)][id % stride];
  const ids = model.triangles.map((t) => t.v);
  const triangles = ids.map(([a, b, c]) => ({
    flat: [flatOf(a), flatOf(b), flatOf(c)] as [Vec2, Vec2, Vec2],
    built: [builtOf(a), builtOf(b), builtOf(c)] as [Vec3, Vec3, Vec3],
  }));
  return { triangles, ids, pivot: { x: 0, y: 0 } };
}

const dist3 = (a: Vec3 | { x: number; y: number; z: number }, b: typeof a) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe('fold-tree', () => {
  it('reconstructs the true solid exactly at t = 1, for a banded and a flat-developable single-sheet wall', () => {
    // Banded strips are always exactly developable (a strip is a chain, never a
    // loop). A single-sheet wall is only exactly developable for the taper- and
    // curvature-free combinations the "develops flat to 0.00 mm" check reports —
    // topDiameter === bottomDiameter here is exactly that case, regardless of rhythm.
    for (const params of [
      { construction: 'banded' as const, bulge: 22, sides: 6, rows: 4, style: 'crystal' as const },
      { construction: 'single-sheet' as const, sides: 6, rows: 3, style: 'diamond' as const, topDiameter: 340, bottomDiameter: 340 },
    ]) {
      const model = build(params);
      expect(model.developmentError).toBeLessThan(1e-6);
      for (let band = 0; band < model.parameters.rows; band += 1) {
        const { triangles, ids, pivot } = bandTriangles(model, band);
        const tree = buildFoldTree(triangles, ids, pivot);
        const corners = cornersAt(tree, 1);
        triangles.forEach((tri, i) => {
          tri.built.forEach((truth, k) => {
            expect(dist3(corners[i][k], truth)).toBeLessThan(1e-6);
          });
        });
      }
    }
  });

  it('reconstructs exactly at t = 1 even for a single-sheet wall that only approximately develops', () => {
    // Taper combined with rhythm carries genuine Gaussian curvature (see
    // planter-developability-rule): no hinge chain can turn on these edges as a
    // pure rotation, because they are not quite the same length flat and built.
    // `cornersAt` corrects for that per triangle, eased in as t runs 0 -> 1, so
    // the reconstruction is exact at t = 1 regardless of how large the wall's
    // own `developmentError` is — see the dedicated bulge test below for a case
    // where the UNCORRECTED chain would have been wildly wrong instead.
    const model = build({ construction: 'single-sheet', sides: 6, rows: 3, style: 'diamond' });
    expect(model.developmentError).toBeGreaterThan(0.5);
    for (let band = 0; band < model.parameters.rows; band += 1) {
      const { triangles, ids, pivot } = bandTriangles(model, band);
      const tree = buildFoldTree(triangles, ids, pivot);
      const corners = cornersAt(tree, 1);
      triangles.forEach((tri, i) => {
        tri.built.forEach((truth, k) => {
          expect(dist3(corners[i][k], truth)).toBeLessThan(1e-6);
        });
      });
    }
  });

  it('never explodes past the model\'s own size for a badly non-developable single-sheet wall', () => {
    // The reported case: an 8-sided single-sheet wall with a large bulge has
    // real Gaussian curvature no flat blank can absorb (the UI already says so
    // — "switch to banded construction to build it"). Before the correction in
    // `cornersAt`, the raw hinge chain's small per-edge mismatches compounded
    // across the wall's 64 triangles into a reconstruction well over a metre
    // off — spiky, self-intersecting geometry instead of a closed pot. Every
    // corner, at every point in the fold, must stay within a sane multiple of
    // the pot's own size, and land exactly on the true solid at t = 1.
    const model = build({
      construction: 'single-sheet', footprint: 'polygon', sides: 8, rows: 4,
      bulge: 46, topDiameter: 300, bottomDiameter: 240, height: 720,
    });
    expect(model.developmentError).toBeGreaterThan(20); // genuinely, badly non-developable
    const { triangles, ids, pivot } = wallTriangles(model);
    const tree = buildFoldTree(triangles, ids, pivot);
    const span = Math.max(model.parameters.height, model.parameters.topDiameter, model.parameters.bottomDiameter);

    for (const t of [0, 0.2, 0.5, 0.8, 1]) {
      const corners = cornersAt(tree, t);
      for (const tri of corners) {
        for (const p of tri) {
          expect(Math.hypot(p.x, p.y, p.z)).toBeLessThan(span * 3);
        }
      }
    }
    const atEnd = cornersAt(tree, 1);
    triangles.forEach((tri, i) => {
      tri.built.forEach((truth, k) => {
        expect(dist3(atEnd[i][k], truth)).toBeLessThan(1e-6);
      });
    });
  });

  it('lies exactly on the flat net at t = 0', () => {
    const model = build({ construction: 'banded', bulge: 20, sides: 6, rows: 4 });
    const { triangles, ids, pivot } = bandTriangles(model, 1);
    const tree = buildFoldTree(triangles, ids, pivot);
    const corners = cornersAt(tree, 0);
    triangles.forEach((tri, i) => {
      tri.flat.forEach((truth, k) => {
        expect(corners[i][k].x).toBeCloseTo(truth.x, 6);
        expect(corners[i][k].y).toBeCloseTo(truth.y, 6);
        expect(corners[i][k].z).toBeCloseTo(0, 6);
      });
    });
  });

  it('keeps every facet perfectly rigid throughout the fold, not just at the ends', () => {
    const model = build({ construction: 'banded', bulge: -18, sides: 8, rows: 5, style: 'crystal' });
    const { triangles, ids, pivot } = bandTriangles(model, 2);
    const tree = buildFoldTree(triangles, ids, pivot);
    for (const t of [0, 0.2, 0.5, 0.8, 1]) {
      const corners = cornersAt(tree, t);
      triangles.forEach((tri, i) => {
        const trueEdges = [dist3(tri.built[0], tri.built[1]), dist3(tri.built[1], tri.built[2]), dist3(tri.built[2], tri.built[0])];
        const gotEdges = [dist3(corners[i][0], corners[i][1]), dist3(corners[i][1], corners[i][2]), dist3(corners[i][2], corners[i][0])];
        trueEdges.forEach((edge, k) => expect(gotEdges[k]).toBeCloseTo(edge, 6));
      });
    }
  });

  it('keeps a shared hinge edge coincident between neighbouring facets at every t', () => {
    const model = build({ construction: 'single-sheet', sides: 6, rows: 1, style: 'crystal' });
    const { triangles, ids, pivot } = bandTriangles(model, 0);
    const tree = buildFoldTree(triangles, ids, pivot);
    for (const t of [0, 0.3, 0.6, 1]) {
      const corners = cornersAt(tree, t);
      for (let i = 0; i < ids.length; i += 1) {
        for (let j = i + 1; j < ids.length; j += 1) {
          const shared = ids[i].filter((id) => ids[j].includes(id));
          if (shared.length < 2) continue;
          for (const id of shared) {
            const ki = ids[i].indexOf(id);
            const kj = ids[j].indexOf(id);
            expect(dist3(corners[i][ki], corners[j][kj])).toBeLessThan(1e-6);
          }
        }
      }
    }
  });
});
