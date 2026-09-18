import { describe, expect, it } from 'vitest';
import { chainFoldLines, chainSegments, simplifyPolyline } from './polyline';
import type { Vec2 } from './types';

const at = (x: number, y: number): Vec2 => ({ x, y });
const seg = (ax: number, ay: number, bx: number, by: number) => [at(ax, ay), at(bx, by)] as const;
const coords = (points: Vec2[]) => points.map((p) => [p.x, p.y]);
/** Which way round a run was joined is the cutter's business, not the file's. */
const ends = (points: Vec2[]) => [points[0], points[points.length - 1]]
  .map((p) => [p.x, p.y])
  .sort((a, b) => a[0] - b[0] || a[1] - b[1]);

describe('polyline joining', () => {
  it('turns a straight run of segments into one two-point curve', () => {
    // The reported case: a ring crease arrives as one segment per facet, and the
    // control lifts and plunges at every one of them.
    const chains = chainSegments([
      seg(0, 0, 10, 0), seg(10, 0, 20, 0), seg(20, 0, 30, 0),
      seg(30, 0, 40, 0), seg(40, 0, 50, 0), seg(50, 0, 60, 0),
    ]);
    expect(chains).toHaveLength(1);
    expect(chains[0].closed).toBe(false);
    expect(coords(chains[0].points)).toEqual([[0, 0], [60, 0]]);
  });

  it('joins segments handed over out of order and back to front', () => {
    const chains = chainSegments([seg(20, 0, 30, 0), seg(10, 0, 0, 0), seg(20, 0, 10, 0)]);
    expect(chains).toHaveLength(1);
    expect(chains[0].points).toHaveLength(2);
    expect(ends(chains[0].points)).toEqual([[0, 0], [30, 0]]);
  });

  it('keeps every corner of a zigzag it joins', () => {
    const chains = chainSegments([seg(0, 0, 10, 20), seg(10, 20, 20, 0), seg(20, 0, 30, 20)]);
    expect(chains).toHaveLength(1);
    expect(chains[0].closed).toBe(false);
    expect(coords(chains[0].points)).toEqual([[0, 0], [10, 20], [20, 0], [30, 20]]);
  });

  it('closes a loop rather than leaving it as a run that meets itself', () => {
    const chains = chainSegments([
      seg(0, 0, 10, 0), seg(10, 0, 10, 10), seg(10, 10, 0, 10), seg(0, 10, 0, 0),
    ]);
    expect(chains).toHaveLength(1);
    expect(chains[0].closed).toBe(true);
    // Closed, so the first point is not repeated at the end.
    expect(coords(chains[0].points)).toEqual([[0, 0], [10, 0], [10, 10], [0, 10]]);
  });

  it('cuts a shared crease once, however many times it was handed over', () => {
    // Two facets each name the edge between them, one of them backwards. Cutting
    // it twice burns the groove twice and doubles the time on the machine.
    const chains = chainSegments([seg(0, 0, 10, 0), seg(10, 0, 0, 0), seg(0, 0, 10, 0)]);
    expect(chains).toHaveLength(1);
    expect(coords(chains[0].points)).toEqual([[0, 0], [10, 0]]);
  });

  it('welds ends that only float noise holds apart', () => {
    const chains = chainSegments([seg(0, 0, 10, 0), seg(10 + 5e-10, 0, 20, 0)]);
    expect(chains).toHaveLength(1);
    expect(coords(chains[0].points)).toEqual([[0, 0], [20, 0]]);
  });

  it('leaves genuinely separate runs separate', () => {
    const chains = chainSegments([seg(0, 0, 10, 0), seg(40, 0, 50, 0)]);
    expect(chains).toHaveLength(2);
    expect(coords(chains[0].points)).toEqual([[0, 0], [10, 0]]);
    expect(coords(chains[1].points)).toEqual([[40, 0], [50, 0]]);
  });

  it('runs straight on through a crossing instead of breaking at it', () => {
    // Where creases cross, stopping both of them at the intersection would put
    // four lifts where the cutter could have made two passes.
    const chains = chainSegments([
      seg(-10, 0, 0, 0), seg(0, 0, 10, 0), seg(0, -10, 0, 0), seg(0, 0, 0, 10),
    ]);
    expect(chains).toHaveLength(2);
    expect(ends(chains[0].points)).toEqual([[-10, 0], [10, 0]]);
    expect(ends(chains[1].points)).toEqual([[0, -10], [0, 10]]);
    expect(chains.every((chain) => chain.points.length === 2)).toBe(true);
  });

  it('never drops a segment, whatever shape it joins them into', () => {
    const segments = [
      seg(0, 0, 10, 0), seg(10, 0, 20, 0), seg(10, 0, 10, 10), seg(10, 10, 20, 10),
      seg(20, 10, 20, 0), seg(40, 40, 50, 40),
    ];
    const run = (chain: { points: Vec2[]; closed: boolean }) => {
      let length = chain.points.reduce(
        (sum, point, i) => (i === 0 ? sum : sum + Math.hypot(point.x - chain.points[i - 1].x, point.y - chain.points[i - 1].y)),
        0,
      );
      if (chain.closed && chain.points.length > 1) {
        const first = chain.points[0];
        const last = chain.points[chain.points.length - 1];
        length += Math.hypot(first.x - last.x, first.y - last.y);
      }
      return length;
    };
    const covered = chainSegments(segments).reduce((sum, chain) => sum + run(chain), 0);
    const total = segments.reduce((sum, [a, b]) => sum + Math.hypot(b.x - a.x, b.y - a.y), 0);
    expect(covered).toBeCloseTo(total, 6);
  });

  it('holds on to a vertex where the run doubles back on itself', () => {
    // Collinear, but flattening it would cut straight past the spike's tip.
    const chains = chainSegments([seg(0, 0, 10, 0), seg(10, 0, 5, 0)]);
    expect(chains).toHaveLength(1);
    expect(coords(chains[0].points)).toEqual([[0, 0], [10, 0], [5, 0]]);
  });

  it('joins fold lines given as flat coordinates', () => {
    const chains = chainFoldLines([
      { x1: 0, y1: 0, x2: 10, y2: 0 },
      { x1: 10, y1: 0, x2: 20, y2: 0 },
    ]);
    expect(chains).toHaveLength(1);
    expect(coords(chains[0].points)).toEqual([[0, 0], [20, 0]]);
  });
});

describe('polyline simplifying', () => {
  it('strips points that only restate a straight edge', () => {
    const simplified = simplifyPolyline({ points: [at(0, 0), at(5, 0), at(10, 0), at(10, 10)], closed: false });
    expect(coords(simplified.points)).toEqual([[0, 0], [10, 0], [10, 10]]);
  });

  it('keeps both ends of an open run exactly where they were', () => {
    const simplified = simplifyPolyline({ points: [at(0, 0), at(5, 0), at(10, 0)], closed: false });
    expect(coords(simplified.points)).toEqual([[0, 0], [10, 0]]);
  });

  it('leaves a corner alone when it is a real corner', () => {
    const points = [at(0, 0), at(10, 0), at(10, 10), at(0, 10)];
    expect(coords(simplifyPolyline({ points, closed: true }).points)).toEqual(coords(points));
  });

  it('moves no point further than the tolerance allows', () => {
    // A vertex 0.4 mm off the chord is a bevel somebody drew, not noise.
    const points = [at(0, 0), at(50, 0.4), at(100, 0)];
    expect(coords(simplifyPolyline({ points, closed: false }).points)).toEqual(coords(points));
  });
});
