import type { Vec2 } from './types';

/**
 * Segment soup into joined runs.
 *
 * A control lifts, repositions and plunges at every entity boundary, so a ring
 * crease written as one line per facet is cut as a row of stabs rather than one
 * pass — and a shared crease written twice is cut twice. Welding coincident
 * endpoints, dropping duplicates and chaining what is left leaves the net as the
 * fewest continuous curves it can be, which is what the cutter follows.
 */

/** A run the cutter can follow without lifting. */
export interface Polyline {
  points: Vec2[];
  /** The last point joins the first, and is not repeated in `points`. */
  closed: boolean;
}

/**
 * Points closer than this are the same point, and a vertex further than this off
 * its neighbours' chord is a real corner (mm). A micron — orders below any
 * cutter's own accuracy, so welding and straightening here move nothing real.
 */
const TOLERANCE = 1e-3;

interface Node { point: Vec2; edges: number[] }
interface Edge { a: number; b: number }

/** Segment endpoints as a graph: coincident ends become one node, duplicates go. */
function buildGraph(segments: readonly (readonly [Vec2, Vec2])[], tolerance: number) {
  const nodes: Node[] = [];
  const buckets = new Map<string, number[]>();

  const idOf = (point: Vec2): number => {
    const cx = Math.floor(point.x / tolerance);
    const cy = Math.floor(point.y / tolerance);
    // A point sitting just over a cell boundary from its twin still has to find
    // it, so the lookup sweeps the neighbouring cells too.
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const id of buckets.get(`${cx + dx}:${cy + dy}`) ?? []) {
          if (Math.hypot(nodes[id].point.x - point.x, nodes[id].point.y - point.y) <= tolerance) return id;
        }
      }
    }
    const id = nodes.length;
    nodes.push({ point: { x: point.x, y: point.y }, edges: [] });
    const key = `${cx}:${cy}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(id);
    else buckets.set(key, [id]);
    return id;
  };

  const edges: Edge[] = [];
  const seen = new Set<string>();
  for (const [from, to] of segments) {
    const a = idOf(from);
    const b = idOf(to);
    if (a === b) continue;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    nodes[a].edges.push(edges.length);
    nodes[b].edges.push(edges.length);
    edges.push({ a, b });
  }
  return { nodes, edges };
}

/**
 * How far `point` sits off the chord from `from` to `to`, or `Infinity` when it
 * lies outside the chord — a vertex that doubles back is a spike to keep, not a
 * straight run to flatten, even though it is collinear.
 */
function deviation(from: Vec2, point: Vec2, to: Vec2): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const span = Math.hypot(dx, dy);
  if (span <= 0) return Math.hypot(point.x - from.x, point.y - from.y);
  const along = ((point.x - from.x) * dx + (point.y - from.y) * dy) / (span * span);
  if (along < 0 || along > 1) return Infinity;
  return Math.abs((point.x - from.x) * dy - (point.y - from.y) * dx) / span;
}

/** Drop vertices that only restate a straight run, keeping every real corner. */
export function simplifyPolyline(polyline: Polyline, tolerance = TOLERANCE): Polyline {
  const { points, closed } = polyline;
  if (points.length < 3) return { points: points.slice(), closed };

  // A closed run has no end to anchor from, so its first point is held fixed and
  // everything after it is tested against the last point actually kept.
  const kept: Vec2[] = [points[0]];
  const last = closed ? points.length : points.length - 1;
  for (let i = 1; i < last; i += 1) {
    const next = points[(i + 1) % points.length];
    if (deviation(kept[kept.length - 1], points[i], next) > tolerance) kept.push(points[i]);
  }
  if (!closed) kept.push(points[points.length - 1]);
  return { points: kept, closed };
}

/**
 * Join segments into the fewest runs that cover them. Shared endpoints weld,
 * duplicate and reversed-duplicate segments collapse to one, and where more than
 * two runs meet the chain carries on through the straightest of them, so a crease
 * crossing a junction stays one curve instead of breaking at every intersection.
 */
export function chainSegments(
  segments: readonly (readonly [Vec2, Vec2])[], tolerance = TOLERANCE,
): Polyline[] {
  const { nodes, edges } = buildGraph(segments, tolerance);
  const used = new Array<boolean>(edges.length).fill(false);
  const chains: Polyline[] = [];

  const across = (edge: number, from: number) => (edges[edge].a === from ? edges[edge].b : edges[edge].a);

  const heading = (from: number, edge: number): Vec2 => {
    const to = across(edge, from);
    const dx = nodes[to].point.x - nodes[from].point.x;
    const dy = nodes[to].point.y - nodes[from].point.y;
    const span = Math.hypot(dx, dy) || 1;
    return { x: dx / span, y: dy / span };
  };

  const walk = (start: number, first: number): Polyline => {
    const points = [nodes[start].point];
    let node = start;
    let edge = first;
    for (;;) {
      used[edge] = true;
      const came = heading(node, edge);
      node = across(edge, node);
      if (node === start) return { points, closed: true };
      points.push(nodes[node].point);
      let next = -1;
      let straightest = -Infinity;
      for (const candidate of nodes[node].edges) {
        if (used[candidate]) continue;
        const out = heading(node, candidate);
        const straightness = out.x * came.x + out.y * came.y;
        if (straightness > straightest) { straightest = straightness; next = candidate; }
      }
      if (next < 0) return { points, closed: false };
      edge = next;
    }
  };

  const drain = (node: number) => {
    for (const edge of nodes[node].edges) {
      if (!used[edge]) chains.push(walk(node, edge));
    }
  };

  // Loose ends before junctions: a run that passes through a junction can only be
  // followed one way from the junction itself, which would leave its other half
  // behind as a second curve. Reached from a true end, it stays one curve.
  for (let node = 0; node < nodes.length; node += 1) if (nodes[node].edges.length === 1) drain(node);
  for (let node = 0; node < nodes.length; node += 1) if (nodes[node].edges.length > 2) drain(node);
  // What is left runs two-to-a-node throughout: closed loops, with no end to start from.
  for (let edge = 0; edge < edges.length; edge += 1) {
    if (!used[edge]) chains.push(walk(edges[edge].a, edge));
  }

  return chains.map((chain) => simplifyPolyline(chain, tolerance));
}

/** The same joining, for lines carrying their endpoints as flat coordinates. */
export function chainFoldLines(
  lines: readonly { x1: number; y1: number; x2: number; y2: number }[], tolerance = TOLERANCE,
): Polyline[] {
  return chainSegments(
    lines.map((line) => [{ x: line.x1, y: line.y1 }, { x: line.x2, y: line.y2 }] as const),
    tolerance,
  );
}
