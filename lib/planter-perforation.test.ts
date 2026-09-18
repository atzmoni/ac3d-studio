import { describe, expect, it } from 'vitest';
import {
  barycentric, circleContour, drainRing, filletPolygon, perforateFacet, polygonArea,
  roundedRect, shrinkTriangle, subdivideTriangle, triangleInradius,
  type PerforationSpec, type Triangle2,
} from './planter-perforation';
import type { Vec2 } from './types';

const EQUILATERAL: Triangle2 = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 150, y: 259.807 }];
const SCALENE: Triangle2 = [{ x: 12, y: -40 }, { x: 410, y: 33 }, { x: 96, y: 288 }];
const SLIVER: Triangle2 = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 390, y: 9 }];

const spec = (overrides: Partial<PerforationSpec> = {}): PerforationSpec => ({
  density: 2, opening: 1, web: 12, margin: 22, tool: 6, ...overrides,
});

/** Distance from `point` to the segment a→b. */
function toSegment(point: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const span = dx * dx + dy * dy;
  const t = span <= 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / span));
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

/** Distance from `point` to a closed contour's boundary. */
const toBoundary = (point: Vec2, ring: Vec2[]): number => ring.reduce(
  (nearest, a, i) => Math.min(nearest, toSegment(point, a, ring[(i + 1) % ring.length])),
  Infinity,
);

/** Is `point` inside a closed convex contour, whichever way round it was written? */
function inside(point: Vec2, ring: Vec2[]): boolean {
  const orientation = Math.sign(polygonArea(ring)) || 1;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const side = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    if (side * orientation < -1e-6) return false;
  }
  return true;
}

/** Closest approach between two closed contours. */
const between = (one: Vec2[], other: Vec2[]): number => Math.min(
  ...one.map((point) => toBoundary(point, other)),
  ...other.map((point) => toBoundary(point, one)),
);

describe('triangle inset', () => {
  it('moves every edge in by exactly the amount asked for', () => {
    for (const tri of [EQUILATERAL, SCALENE]) {
      const inset = shrinkTriangle(tri, 17) as Triangle2;
      expect(inset).not.toBeNull();
      // The inradius falling by exactly the inset is the same statement as
      // every edge having moved in by it — which is why the incentre is the
      // centre to scale about and the centroid is not.
      expect(triangleInradius(inset)).toBeCloseTo(triangleInradius(tri) - 17, 6);
      for (let i = 0; i < 3; i += 1) {
        expect(toBoundary(inset[i], tri)).toBeGreaterThanOrEqual(17 - 1e-6);
      }
    }
  });

  it('refuses a triangle with nothing left to give', () => {
    // A long sliver has plenty of area and almost no inradius; a corner-based
    // inset would happily return a self-crossing triangle here.
    expect(triangleInradius(SLIVER)).toBeLessThan(6);
    expect(shrinkTriangle(SLIVER, 6)).toBeNull();
    expect(shrinkTriangle(EQUILATERAL, 1000)).toBeNull();
  });

  it('leaves the triangle alone when nothing is asked of it', () => {
    expect(shrinkTriangle(EQUILATERAL, 0)).toEqual(EQUILATERAL);
  });
});

describe('subdivision', () => {
  it('splits into n² pieces that exactly cover the parent', () => {
    for (const n of [1, 2, 3, 4, 6, 8]) {
      const parts = subdivideTriangle(SCALENE, n);
      expect(parts).toHaveLength(n * n);
      const covered = parts.reduce((sum, part) => sum + Math.abs(polygonArea(part)), 0);
      expect(covered).toBeCloseTo(Math.abs(polygonArea(SCALENE)), 6);
      for (const part of parts) {
        for (const corner of part) expect(inside(corner, SCALENE)).toBe(true);
      }
    }
  });

  it('alternates orientation, so the web between cells comes out even', () => {
    const n = 3;
    const parts = subdivideTriangle(EQUILATERAL, n);
    // Every piece is the parent at 1/n, either translated or point-reflected.
    // Winding does not tell the two apart — both come out counter-clockwise —
    // so this reads the first edge, which runs along the parent's first edge on
    // an upright piece and along its second on an inverted one.
    const edge = (a: Vec2, b: Vec2): Vec2 => ({ x: b.x - a.x, y: b.y - a.y });
    const first = edge(EQUILATERAL[0], EQUILATERAL[1]);
    const second = edge(EQUILATERAL[0], EQUILATERAL[2]);
    // Blown back up to full size, a piece's first edge is one of the parent's.
    const grown = (part: Triangle2): Vec2 => {
      const step = edge(part[0], part[1]);
      return { x: step.x * n, y: step.y * n };
    };
    const matches = (got: Vec2, want: Vec2) => Math.hypot(got.x - want.x, got.y - want.y) < 1e-6;

    const upright = parts.filter((part) => matches(grown(part), first));
    const inverted = parts.filter((part) => matches(grown(part), second));
    // n(n+1)/2 one way, n(n−1)/2 the other, and nothing else.
    expect(upright).toHaveLength(6);
    expect(inverted).toHaveLength(3);
    expect(upright.length + inverted.length).toBe(parts.length);
  });
});

describe('corner filleting', () => {
  it('rounds every corner and keeps the contour inside the sharp one', () => {
    const rounded = filletPolygon(EQUILATERAL, 5);
    expect(rounded.length).toBeGreaterThan(3);
    for (const point of rounded) expect(inside(point, EQUILATERAL)).toBe(true);
    expect(Math.abs(polygonArea(rounded))).toBeLessThan(Math.abs(polygonArea(EQUILATERAL)));
  });

  it('holds the arc within the chord tolerance the shop was promised', () => {
    const radius = 4;
    const rounded = filletPolygon(EQUILATERAL, radius);
    // Points on an arc of radius r sit at most 2·√(2rs − s²) apart for sagitta
    // s, so the longest step round a corner bounds how far the written contour
    // can stray from the curve the cutter will actually take.
    const longestArcStep = Math.max(...rounded.map((point, i) => {
      const next = rounded[(i + 1) % rounded.length];
      const step = Math.hypot(next.x - point.x, next.y - point.y);
      return step < radius * 2 ? step : 0;
    }));
    const sagitta = radius - Math.sqrt(Math.max(0, radius * radius - (longestArcStep / 2) ** 2));
    expect(sagitta).toBeLessThanOrEqual(0.02 + 1e-9);
  });

  it('never lets two corners eat into the same edge', () => {
    // A 6 mm radius cannot fit twice into a 5 mm edge; it has to give way.
    const tiny: Vec2[] = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 2.5, y: 4.33 }];
    const rounded = filletPolygon(tiny, 6);
    expect(Math.abs(polygonArea(rounded))).toBeGreaterThan(0);
    for (const point of rounded) expect(inside(point, tiny)).toBe(true);
  });

  it('passes a sharp contour straight through when there is no cutter radius', () => {
    expect(filletPolygon(EQUILATERAL, 0)).toEqual(EQUILATERAL);
  });
});

describe('perforating a facet', () => {
  it('keeps every cut-out clear of the creases by the margin', () => {
    const result = perforateFacet(SCALENE, spec({ margin: 25 }));
    expect(result.cells.length).toBeGreaterThan(0);
    for (const cell of result.cells) {
      for (const point of cell) {
        expect(inside(point, SCALENE)).toBe(true);
        expect(toBoundary(point, SCALENE)).toBeGreaterThanOrEqual(25 - 1e-6);
      }
    }
  });

  it('leaves the full web between neighbouring cut-outs', () => {
    const web = 14;
    const result = perforateFacet(EQUILATERAL, spec({ web, density: 3 }));
    expect(result.cells.length).toBeGreaterThan(1);
    for (let i = 0; i < result.cells.length; i += 1) {
      for (let j = i + 1; j < result.cells.length; j += 1) {
        expect(between(result.cells[i], result.cells[j])).toBeGreaterThanOrEqual(web - 1e-6);
      }
    }
  });

  it('leaves solid what the cutter cannot drop into, and says how much', () => {
    // A 40 mm cutter cannot enter any cell this subdivision produces.
    const result = perforateFacet(EQUILATERAL, spec({ density: 4, tool: 40 }));
    expect(result.cells).toHaveLength(0);
    expect(result.dropped).toBe(16);
    expect(result.area).toBe(0);
  });

  it('cuts nothing at all out of a facet the margin has already used up', () => {
    expect(perforateFacet(SLIVER, spec())).toEqual({ cells: [], dropped: 0, area: 0 });
  });

  it('reports the area it actually removed', () => {
    const result = perforateFacet(SCALENE, spec());
    const measured = result.cells.reduce((sum, cell) => sum + Math.abs(polygonArea(cell)), 0);
    expect(result.area).toBeCloseTo(measured, 6);
    expect(result.area).toBeLessThan(Math.abs(polygonArea(SCALENE)));
  });

  it('opens less wall as the pattern gets finer, because the web is a constant', () => {
    // Worth pinning down, because it is the opposite of what a "density" slider
    // suggests: more cells at the same web means more web, not more light.
    const coarse = perforateFacet(SCALENE, spec({ density: 1 }));
    const fine = perforateFacet(SCALENE, spec({ density: 3 }));
    expect(fine.cells.length).toBeGreaterThan(coarse.cells.length);
    expect(fine.area).toBeLessThan(coarse.area);
  });

  it('is deterministic, so a redraw that differs is a real change', () => {
    expect(perforateFacet(SCALENE, spec())).toEqual(perforateFacet(SCALENE, spec()));
  });
});

describe('panel window and drains', () => {
  it('keeps the window inside the box it was given', () => {
    const window = roundedRect({ x: 40, y: 15 }, { x: 1, y: 0 }, 100, 60, 5);
    for (const point of window) {
      expect(Math.abs(point.x - 40)).toBeLessThanOrEqual(50 + 1e-6);
      expect(Math.abs(point.y - 15)).toBeLessThanOrEqual(30 + 1e-6);
    }
    // Rounded corners, so it comes in a little under the full rectangle.
    expect(Math.abs(polygonArea(window))).toBeGreaterThan(100 * 60 * 0.95);
    expect(Math.abs(polygonArea(window))).toBeLessThan(100 * 60);
  });

  it('follows the direction it is given rather than the axes', () => {
    const diagonal = roundedRect({ x: 0, y: 0 }, { x: 1, y: 1 }, 100, 20, 3);
    const span = Math.max(...diagonal.map((point) => Math.hypot(point.x, point.y)));
    expect(span).toBeGreaterThan(48);
    expect(span).toBeLessThan(52);
  });

  it('writes a circle the cutter can follow', () => {
    const circle = circleContour({ x: 5, y: -3 }, 14);
    expect(circle.length).toBeGreaterThanOrEqual(12);
    for (const point of circle) expect(Math.hypot(point.x - 5, point.y + 3)).toBeCloseTo(7, 9);
  });

  it('spaces drain holes evenly and refuses a plate too small to take them', () => {
    const holes = drainRing({ x: 0, y: 0 }, 60, 6, 14);
    expect(holes).toHaveLength(6);
    for (let i = 0; i < holes.length; i += 1) {
      for (let j = i + 1; j < holes.length; j += 1) {
        expect(between(holes[i], holes[j])).toBeGreaterThan(0);
      }
    }
    expect(drainRing({ x: 0, y: 0 }, 10, 6, 14)).toHaveLength(0);
    expect(drainRing({ x: 0, y: 0 }, 60, 0, 14)).toHaveLength(0);
  });
});

describe('barycentric mapping', () => {
  it('rebuilds a point from the corners it was measured against', () => {
    const point = { x: 140, y: 70 };
    const [u, v, w] = barycentric(SCALENE, point);
    expect(u + v + w).toBeCloseTo(1, 9);
    expect(SCALENE[0].x * u + SCALENE[1].x * v + SCALENE[2].x * w).toBeCloseTo(point.x, 6);
    expect(SCALENE[0].y * u + SCALENE[1].y * v + SCALENE[2].y * w).toBeCloseTo(point.y, 6);
  });

  it('carries a point onto a moved triangle rigidly', () => {
    // The same weights on a rotated, translated copy land the point where the
    // rigid motion would put it — which is the whole basis for riding the flat
    // pattern up onto the folding pot.
    const angle = 0.7;
    const moved = SCALENE.map((point) => ({
      x: point.x * Math.cos(angle) - point.y * Math.sin(angle) + 30,
      y: point.x * Math.sin(angle) + point.y * Math.cos(angle) - 12,
    })) as Triangle2;
    const point = { x: 140, y: 70 };
    const [u, v, w] = barycentric(SCALENE, point);
    expect(moved[0].x * u + moved[1].x * v + moved[2].x * w)
      .toBeCloseTo(point.x * Math.cos(angle) - point.y * Math.sin(angle) + 30, 6);
    expect(moved[0].y * u + moved[1].y * v + moved[2].y * w)
      .toBeCloseTo(point.x * Math.sin(angle) + point.y * Math.cos(angle) - 12, 6);
  });

  it('survives a degenerate triangle instead of returning NaN', () => {
    const flat: Triangle2 = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }];
    for (const weight of barycentric(flat, { x: 5, y: 5 })) expect(Number.isFinite(weight)).toBe(true);
  });
});
