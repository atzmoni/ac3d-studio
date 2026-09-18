import { getMaterial } from './pattern-engine';
import { getPlanterStyle } from './planter-styles';
import type {
  FabricationCheck, FoldKind, FoldLine, MaterialSpec, PlanterModel, PlanterParameters,
  PlanterPiece, PlanterStats, Vec2, Vec3,
} from './types';

const TAU = Math.PI * 2;
const DEG = 180 / Math.PI;
const EPSILON = 1e-9;

/** Gap left between nested pieces so the cutter has room to turn around (mm). */
const NEST_GAP = 15;
/** Creases flatter than this are an artefact of the triangulation, not a fold. */
const FLAT_CREASE = 0.5;
/** Relief cut at each end of a joint tab so neighbouring tabs clear each other (mm). */
const TAB_RELIEF = 4;

export const DEFAULT_PLANTER: PlanterParameters = {
  style: 'diamond',
  footprint: 'polygon',
  construction: 'single-sheet',
  sides: 6,
  topDiameter: 400,
  bottomDiameter: 330,
  topWidth: 400,
  topLength: 300,
  bottomWidth: 320,
  bottomLength: 240,
  height: 500,
  rows: 3,
  bulge: 0,
  twist: 0,
  rhythm: 30,
  tabWidth: 25,
  jointTab: 20,
  rimWidth: 45,
  baseInset: 3,
  baseTab: 18,
  rimTab: 18,
  sheetWidth: 1220,
  sheetHeight: 2440,
  assembly: 100,
};

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}

/** Every field is slider- or keyboard-driven, so nothing downstream may assume a sane value. */
export function normalizePlanter(parameters: PlanterParameters): PlanterParameters {
  const span = (value: number) => clamp(Math.abs(value), 60, 4000);
  return {
    ...parameters,
    // A rectangle has four corners by definition; the slider does not get a say.
    sides: parameters.footprint === 'rectangle' ? 4 : Math.round(clamp(parameters.sides, 3, 12)),
    rows: Math.round(clamp(parameters.rows, 1, 8)),
    topDiameter: span(parameters.topDiameter),
    bottomDiameter: span(parameters.bottomDiameter),
    topWidth: span(parameters.topWidth),
    topLength: span(parameters.topLength),
    bottomWidth: span(parameters.bottomWidth),
    bottomLength: span(parameters.bottomLength),
    height: span(parameters.height),
    bulge: clamp(parameters.bulge, -45, 60),
    twist: clamp(parameters.twist, -180, 180),
    rhythm: clamp(Math.abs(parameters.rhythm), 0, 60),
    tabWidth: clamp(Math.abs(parameters.tabWidth), 0, 120),
    jointTab: clamp(Math.abs(parameters.jointTab), 0, 120),
    rimWidth: clamp(Math.abs(parameters.rimWidth), 5, 400),
    baseInset: clamp(Math.abs(parameters.baseInset), 0, 40),
    baseTab: clamp(Math.abs(parameters.baseTab), 0, 60),
    rimTab: clamp(Math.abs(parameters.rimTab), 0, 60),
    sheetWidth: clamp(Math.abs(parameters.sheetWidth), 300, 6000),
    sheetHeight: clamp(Math.abs(parameters.sheetHeight), 300, 6000),
    assembly: clamp(parameters.assembly, 0, 100),
  };
}

// ---------------------------------------------------------------------------
// Small vector helpers — the wall is z-up here; the 3D view maps it to y-up.
// ---------------------------------------------------------------------------

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x,
});
function unit(v: Vec3): Vec3 {
  const length = Math.hypot(v.x, v.y, v.z) || EPSILON;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}
const dist3 = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const dist2 = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const add2 = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const flatten = (ring: Vec3[], sides: number): Vec2[] => ring.slice(0, sides).map((point) => ({ x: point.x, y: point.y }));

/** Signed area of a closed polygon — also tells us its winding. */
function polygonArea(points: Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function perimeter(points: Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) sum += dist2(points[i], points[(i + 1) % points.length]);
  return sum;
}

function centroid(points: Vec2[]): Vec2 {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function bounds(points: Vec2[]) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, maxX, minY, maxY };
}

/** Distance from the centre to the nearest edge — the largest circle the mouth holds. */
function inradius(points: Vec2[]): number {
  const centre = centroid(points);
  let smallest = Infinity;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const length = dist2(a, b) || EPSILON;
    smallest = Math.min(smallest, Math.abs((b.x - a.x) * (a.y - centre.y) - (a.x - centre.x) * (b.y - a.y)) / length);
  }
  return smallest;
}

/**
 * Shrink a convex polygon by the same distance off every edge, by offsetting each
 * edge line inward and re-intersecting them. Pulling the corners in instead would
 * move a sharp corner much further than a blunt one, which is not what "clears the
 * wall by 3 mm all round" means on the shop floor.
 */
function insetConvex(points: Vec2[], amount: number): Vec2[] {
  if (amount <= EPSILON) return points;
  const centre = centroid(points);
  const limited = Math.min(amount, inradius(points) * 0.8);
  const lines = points.map((a, i) => {
    const b = points[(i + 1) % points.length];
    const length = dist2(a, b) || EPSILON;
    let nx = (b.y - a.y) / length;
    let ny = -(b.x - a.x) / length;
    if ((centre.x - a.x) * nx + (centre.y - a.y) * ny < 0) { nx = -nx; ny = -ny; }
    return { px: a.x + nx * limited, py: a.y + ny * limited, dx: b.x - a.x, dy: b.y - a.y };
  });

  return points.map((fallback, i) => {
    const previous = lines[(i - 1 + lines.length) % lines.length];
    const here = lines[i];
    const denominator = previous.dx * here.dy - previous.dy * here.dx;
    if (Math.abs(denominator) < EPSILON) return fallback;
    const t = ((here.px - previous.px) * here.dy - (here.py - previous.py) * here.dx) / denominator;
    return { x: previous.px + previous.dx * t, y: previous.py + previous.dy * t };
  });
}

// ---------------------------------------------------------------------------
// The pot as a solid
// ---------------------------------------------------------------------------

/** The unit cross-section: a regular polygon, or the four corners of a rectangle. */
function unitSection(parameters: PlanterParameters): Vec2[] {
  if (parameters.footprint === 'rectangle') {
    return [{ x: 1, y: 1 }, { x: -1, y: 1 }, { x: -1, y: -1 }, { x: 1, y: -1 }];
  }
  const sector = TAU / parameters.sides;
  return Array.from({ length: parameters.sides }, (_, i) => ({ x: Math.cos(i * sector), y: Math.sin(i * sector) }));
}

/**
 * Wall vertices, indexed `[ring][column]`. Column `sides` repeats column 0: the
 * wall is a tube, and a development has to cut it open somewhere — that seam is
 * where the glue tab goes, so the duplicate column is the cut, not a bug.
 */
export function planterVertices(parameters: PlanterParameters): Vec3[][] {
  const safe = normalizePlanter(parameters);
  const style = getPlanterStyle(safe.style);
  const section = unitSection(safe);
  const sector = TAU / safe.sides;
  const rhythm = safe.rhythm / 100;
  const rectangular = safe.footprint === 'rectangle';

  // Bands take unequal shares of the height so the facet rhythm can be deepened
  // without touching any radius. Shares are normalised, so the pot still ends up
  // exactly as tall as asked whatever the rhythm does.
  const shares: number[] = [];
  for (let b = 0; b < safe.rows; b += 1) shares.push(Math.max(0.15, 1 + style.band(b, safe.rows) * rhythm));
  const total = shares.reduce((sum, share) => sum + share, 0);

  const rings: Vec3[][] = [];
  let climbed = 0;
  for (let k = 0; k <= safe.rows; k += 1) {
    const height = safe.height * (climbed / total);
    if (k < safe.rows) climbed += shares[k];
    // Taper is linear in the *band index*, not in height: a run of equal-length
    // ring-to-ring steps is what keeps a staggered wall developable.
    const u = k / safe.rows;
    const half = (low: number, high: number) => (low + (high - low) * u) / 2;
    // The bulge is a parabola peaking at mid-height, so the mouth and the foot keep
    // the dimensions the operator typed in. It is also the one lever here that adds
    // curvature — a single blank cannot fold into it, which the checks say plainly.
    const swell = 1 + (safe.bulge / 100) * 4 * u * (1 - u);
    const halfX = Math.max(1, swell * (rectangular ? half(safe.bottomWidth, safe.topWidth) : half(safe.bottomDiameter, safe.topDiameter)));
    const halfY = Math.max(1, swell * (rectangular ? half(safe.bottomLength, safe.topLength) : half(safe.bottomDiameter, safe.topDiameter)));

    const spin = (safe.twist / DEG) * u + k * style.offsetStep * sector;
    const cos = Math.cos(spin);
    const sin = Math.sin(spin);
    const ring: Vec3[] = [];
    for (let i = 0; i <= safe.sides; i += 1) {
      const local = section[i % safe.sides];
      const x = local.x * halfX;
      const y = local.y * halfY;
      ring.push({ x: x * cos - y * sin, y: x * sin + y * cos, z: height });
    }
    rings.push(ring);
  }
  return rings;
}

interface Triangle { v: [number, number, number]; normal: Vec3 }

/**
 * Two triangles per facet. The first always sits on a ring-k edge and the second
 * on a ring-(k+1) edge, whatever the stagger — which is what lets one unfolding
 * routine handle aligned quads, half-staggered diamonds and quarter spirals alike.
 */
function planterTriangles(parameters: PlanterParameters, rings: Vec3[][]): Triangle[] {
  const { sides, rows } = parameters;
  const stride = sides + 1;
  const at = (id: number) => rings[Math.floor(id / stride)][id % stride];
  const triangles: Triangle[] = [];

  const push = (a: number, b: number, c: number) => {
    const pa = at(a);
    const pb = at(b);
    const pc = at(c);
    const normal = unit(cross(sub(pb, pa), sub(pc, pa)));
    // Orient outward: the wall is star-shaped about the axis, so "away from the
    // axis" is an unambiguous outside, whichever way the winding came out.
    const outward = { x: (pa.x + pb.x + pc.x) / 3, y: (pa.y + pb.y + pc.y) / 3, z: 0 };
    if (dot(normal, outward) < 0) {
      triangles.push({ v: [a, c, b], normal: { x: -normal.x, y: -normal.y, z: -normal.z } });
    } else {
      triangles.push({ v: [a, b, c], normal });
    }
  };

  for (let k = 0; k < rows; k += 1) {
    for (let i = 0; i < sides; i += 1) {
      push(k * stride + i, k * stride + i + 1, (k + 1) * stride + i);
      push(k * stride + i + 1, (k + 1) * stride + i + 1, (k + 1) * stride + i);
    }
  }
  return triangles;
}

// ---------------------------------------------------------------------------
// Development
// ---------------------------------------------------------------------------

/**
 * Third corner of a triangle given the other two and the two edge lengths it has
 * to keep. Always returns the solution on the positive side of a→b, so a net laid
 * out this way is consistently the view from *outside* the finished pot.
 */
function placeThird(a: Vec2, b: Vec2, da: number, db: number): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const span = Math.hypot(dx, dy) || EPSILON;
  const along = (da * da - db * db + span * span) / (2 * span);
  const across = Math.sqrt(Math.max(0, da * da - along * along));
  const ux = dx / span;
  const uy = dy / span;
  return { x: a.x + along * ux - across * uy, y: a.y + along * uy + across * ux };
}

interface Unfolder {
  rings: Vec3[][];
  triangles: Triangle[];
  sides: number;
  rows: number;
}

/** Place the one unplaced corner of a triangle from the two that are already down. */
function placeCorner(unfolder: Unfolder, flat: (Vec2 | null)[], triangle: Triangle) {
  const stride = unfolder.sides + 1;
  const at = (id: number) => unfolder.rings[Math.floor(id / stride)][id % stride];
  const [a, b, c] = triangle.v;
  if ([a, b, c].filter((id) => flat[id] === null).length !== 1) return;
  // Rotate the triple so the unknown corner is last; a cyclic rotation keeps the
  // winding, and the winding is what fixes which side the corner lands on.
  const order: [number, number, number] = flat[a] === null ? [b, c, a] : flat[b] === null ? [c, a, b] : [a, b, c];
  const [p, q, r] = order;
  flat[r] = placeThird(flat[p] as Vec2, flat[q] as Vec2, dist3(at(p), at(r)), dist3(at(q), at(r)));
}

/**
 * Walk one band as a triangle strip, each facet hinged off the edge it shares with
 * the last. A strip is a chain and never a loop, so this is always an exact
 * isometry — which is the whole reason banded construction can build shapes that
 * no single blank can.
 */
function unfoldStrip(unfolder: Unfolder, band: number, flat: (Vec2 | null)[], seed: boolean) {
  const { triangles, sides } = unfolder;
  const stride = sides + 1;
  if (seed) {
    const first = band * stride;
    const a = unfolder.rings[band][0];
    const b = unfolder.rings[band][1];
    flat[first] = { x: 0, y: 0 };
    flat[first + 1] = { x: dist3(a, b), y: 0 };
  }
  for (let i = 0; i < sides; i += 1) {
    placeCorner(unfolder, flat, triangles[(band * sides + i) * 2]);
    placeCorner(unfolder, flat, triangles[((band * sides + i) * 2) + 1]);
  }
}

/**
 * Flatten the whole wall as one blank. The bottom band is walked as a strip, so it
 * comes out exactly — a frustum fans into an arc, a staggered band into a zigzag,
 * with no assumption that the foot edge is straight. Every band above it hangs each
 * facet off the ring edge below, which keeps the ring creases exact and stops the
 * closure error of a non-developable design piling up at the seam: it stays spread
 * thinly across the band, where `developmentError` reports it.
 */
function unfoldWall(unfolder: Unfolder): Vec2[][] {
  const { triangles, sides, rows } = unfolder;
  const stride = sides + 1;
  const flat: (Vec2 | null)[] = new Array((rows + 1) * stride).fill(null);

  unfoldStrip(unfolder, 0, flat, true);
  for (let k = 1; k < rows; k += 1) {
    for (let i = 0; i < sides; i += 1) placeCorner(unfolder, flat, triangles[(k * sides + i) * 2]);
    for (let i = 0; i < sides; i += 1) placeCorner(unfolder, flat, triangles[((k * sides + i) * 2) + 1]);
  }

  const grid: Vec2[][] = [];
  for (let k = 0; k <= rows; k += 1) {
    grid.push(Array.from({ length: stride }, (_, i) => flat[k * stride + i] ?? { x: 0, y: 0 }));
  }
  return grid;
}

/** One band flattened on its own, in its own frame: `[below, above]`. */
function unfoldBand(unfolder: Unfolder, band: number): [Vec2[], Vec2[]] {
  const stride = unfolder.sides + 1;
  const flat: (Vec2 | null)[] = new Array((unfolder.rows + 1) * stride).fill(null);
  unfoldStrip(unfolder, band, flat, true);
  const row = (k: number) => Array.from({ length: stride }, (_, i) => flat[k * stride + i] ?? { x: 0, y: 0 });
  return [row(band), row(band + 1)];
}

// ---------------------------------------------------------------------------
// Creases
// ---------------------------------------------------------------------------

interface WallEdge { a: number; b: number; kind: FoldKind; bend: number }

/**
 * Every edge of the wall, with the angle it bends through and which way. Edges
 * carried by a single facet are the outline of the net; the rest are creases, and
 * a crease is a mountain when its neighbouring facet folds away from the outside.
 */
function wallEdges(triangles: Triangle[], rings: Vec3[][], stride: number): WallEdge[] {
  const at = (id: number) => rings[Math.floor(id / stride)][id % stride];
  const map = new Map<string, { a: number; b: number; tris: number[] }>();
  triangles.forEach((triangle, t) => {
    const [x, y, z] = triangle.v;
    ([[x, y], [y, z], [z, x]] as [number, number][]).forEach(([a, b]) => {
      const low = Math.min(a, b);
      const high = Math.max(a, b);
      const key = `${low}:${high}`;
      const entry = map.get(key) ?? { a: low, b: high, tris: [] };
      entry.tris.push(t);
      map.set(key, entry);
    });
  });

  const edges: WallEdge[] = [];
  for (const entry of map.values()) {
    if (entry.tris.length < 2) {
      edges.push({ a: entry.a, b: entry.b, kind: 'cut', bend: 0 });
      continue;
    }
    const first = triangles[entry.tris[0]];
    const second = triangles[entry.tris[1]];
    const bend = Math.acos(clamp(dot(first.normal, second.normal), -1, 1)) * DEG;
    const apex = second.v.find((id) => id !== entry.a && id !== entry.b) as number;
    const convex = dot(first.normal, sub(at(apex), at(entry.a))) < 0;
    edges.push({ a: entry.a, b: entry.b, kind: convex ? 'mountain' : 'valley', bend });
  }
  return edges;
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** Shift a piece into its own local frame and record the box it occupies. */
function finishPiece(
  id: string, label: string, outline: Vec2[], folds: FoldLine[], circles: PlanterPiece['circles'],
): PlanterPiece {
  const box = bounds(outline);
  const origin = { x: box.minX, y: box.minY };
  return {
    id,
    label,
    x: 0,
    y: 0,
    origin,
    width: box.maxX - box.minX,
    height: box.maxY - box.minY,
    outline: outline.map((point) => ({ x: point.x - origin.x, y: point.y - origin.y })),
    folds: folds.map((fold) => ({
      ...fold,
      x1: fold.x1 - origin.x, y1: fold.y1 - origin.y, x2: fold.x2 - origin.x, y2: fold.y2 - origin.y,
    })),
    circles: circles.map((circle) => ({ ...circle, cx: circle.cx - origin.x, cy: circle.cy - origin.y })),
  };
}

/** Unit normal of a polyline vertex, turned to point away from `from`. */
function outwardNormal(line: Vec2[], at: number, from: Vec2): Vec2 {
  const ahead = line[Math.min(line.length - 1, at + 1)];
  const behind = line[Math.max(0, at - 1)];
  const tangent = { x: ahead.x - behind.x, y: ahead.y - behind.y };
  const length = Math.hypot(tangent.x, tangent.y) || EPSILON;
  const normal = { x: tangent.y / length, y: -tangent.x / length };
  const inward = { x: from.x - line[at].x, y: from.y - line[at].y };
  return normal.x * inward.x + normal.y * inward.y > 0 ? { x: -normal.x, y: -normal.y } : normal;
}

/**
 * The tab that closes the tube, run up one seam. It is chamfered at both ends:
 * square corners there foul the base plate and the collar on assembly. Returned
 * walking the seam from its far end back to its start.
 */
function seamTab(seam: Vec2[], body: Vec2[], width: number): { outline: Vec2[]; folds: Vec2[][] } {
  if (width <= 0.5 || seam.length < 2) return { outline: [], folds: [] };
  const last = seam.length - 1;
  const chamfer = Math.min(width * 0.6, 0.4 * dist2(seam[0], seam[last]));
  const outline: Vec2[] = [];
  for (let k = last; k >= 0; k -= 1) {
    const normal = outwardNormal(seam, k, body[k]);
    const along = k === last
      ? { x: seam[last].x - seam[last - 1].x, y: seam[last].y - seam[last - 1].y }
      : { x: seam[1].x - seam[0].x, y: seam[1].y - seam[0].y };
    const length = Math.hypot(along.x, along.y) || EPSILON;
    const inset = k === last ? -chamfer : k === 0 ? chamfer : 0;
    outline.push({
      x: seam[k].x + normal.x * width + (along.x / length) * inset,
      y: seam[k].y + normal.y * width + (along.y / length) * inset,
    });
  }
  return { outline, folds: seam.slice(0, last).map((point, k) => [point, seam[k + 1]]) };
}

/**
 * Rivet tabs along a ring joint, walked in the direction `line` is given in. One
 * tab per segment rather than a single flange: a staggered ring develops as a
 * zigzag, and a flange can only fold along a straight line — so each segment gets
 * its own tab, with a relief gap so neighbours clear each other as they fold in.
 */
function jointTabs(line: Vec2[], body: Vec2[], width: number): { outline: Vec2[]; folds: Vec2[][] } {
  if (width <= 0.5) return { outline: line.slice(), folds: [] };
  const outline: Vec2[] = [];
  const folds: Vec2[][] = [];

  for (let i = 0; i < line.length - 1; i += 1) {
    const a = line[i];
    const b = line[i + 1];
    const length = dist2(a, b) || EPSILON;
    const relief = Math.min(TAB_RELIEF, length * 0.18);
    const dirX = (b.x - a.x) / length;
    const dirY = (b.y - a.y) / length;
    let nx = -dirY;
    let ny = dirX;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (nx * (body[i].x - mid.x) + ny * (body[i].y - mid.y) > 0) { nx = -nx; ny = -ny; }
    outline.push(a);
    outline.push({ x: a.x + nx * width + dirX * relief, y: a.y + ny * width + dirY * relief });
    outline.push({ x: b.x + nx * width - dirX * relief, y: b.y + ny * width - dirY * relief });
    folds.push([a, b]);
  }
  outline.push(line[line.length - 1]);
  return { outline, folds };
}

function creaseLines(prefix: string, pairs: Vec2[][], kind: FoldKind): FoldLine[] {
  return pairs.map(([a, b], i) => ({ id: `${prefix}-${i}`, kind, x1: a.x, y1: a.y, x2: b.x, y2: b.y }));
}

/**
 * The whole tube as one blank — every ring joint is a crease, not a rivet
 * line. The foot and mouth are not left as plain cut edges, though: the base
 * plate and the collar are separate pieces, and without a tab folding in to
 * meet them there is nothing to rivet or glue either one to.
 */
function wallPiece(parameters: PlanterParameters, flat: Vec2[][], edges: WallEdge[]): PlanterPiece {
  const { sides, rows, tabWidth, baseTab, rimTab } = parameters;
  const stride = sides + 1;
  const point = (id: number) => flat[Math.floor(id / stride)][id % stride];

  // Foot edge — tabbed inward for the base plate — up the right-hand seam,
  // back along the mouth — also tabbed inward, for the collar — the net is a
  // tube slit open, so its outline is just those runs in order.
  const foot = jointTabs(flat[0], flat[1], baseTab);
  const outline: Vec2[] = [...foot.outline];
  for (let k = 1; k <= rows; k += 1) outline.push(flat[k][sides]);
  const mouth = jointTabs(flat[rows].slice().reverse(), flat[rows - 1].slice().reverse(), rimTab);
  outline.push(...mouth.outline.slice(1));

  const folds: FoldLine[] = edges
    .filter((edge) => edge.kind !== 'cut' && edge.bend > FLAT_CREASE)
    .map((edge, n) => ({
      id: `wall-${n}`, kind: edge.kind,
      x1: point(edge.a).x, y1: point(edge.a).y, x2: point(edge.b).x, y2: point(edge.b).y,
    }));
  folds.push(...creaseLines('foot', foot.folds, 'valley'));
  folds.push(...creaseLines('mouth', mouth.folds, 'valley'));

  const tab = seamTab(flat.map((ring) => ring[0]), flat.map((ring) => ring[1]), tabWidth);
  if (tab.outline.length > 0) {
    outline.push(...tab.outline);
    folds.push(...creaseLines('tab', tab.folds, 'valley'));
  } else {
    for (let k = rows - 1; k >= 1; k -= 1) outline.push(flat[k][0]);
  }

  return finishPiece('wall', 'Wall — fold up', outline, folds, []);
}

/**
 * One band as its own strip. Each band develops exactly on its own, so this is the
 * construction that can build a bulged pot: the curvature a single blank cannot
 * absorb is taken up at the riveted ring joints instead.
 */
function bandPiece(
  parameters: PlanterParameters, band: number, below: Vec2[], above: Vec2[], edges: WallEdge[],
): PlanterPiece {
  const { sides, rows, tabWidth, jointTab, baseTab, rimTab } = parameters;
  const stride = sides + 1;
  const local = (id: number) => (Math.floor(id / stride) === band ? below : above)[id % stride];

  // Band 0's foot is the wall's actual foot, not an internal joint — tab it
  // inward with `baseTab` so the base plate has something to land on. Every
  // other band's foot stays plain: the band below it already carries the tab.
  const foot = band === 0 ? jointTabs(below, above, baseTab) : { outline: below.slice(), folds: [] as Vec2[][] };
  const outline: Vec2[] = [...foot.outline];
  const folds: FoldLine[] = [...creaseLines(`foot-${band}`, foot.folds, 'valley')];

  // The last band's mouth is likewise the wall's actual mouth: tabbed with
  // `rimTab` so the collar has something to land on, rather than left bare.
  // A distinct id prefix from here on — it rivets to the collar, not to a
  // neighbouring band, so it is not one of the wall's internal `joints`.
  const isMouth = band === rows - 1;
  const joint = jointTabs(above, below, isMouth ? rimTab : jointTab);
  outline.push(...joint.outline.slice().reverse());
  folds.push(...creaseLines(isMouth ? `rim-${band}` : `joint-${band}`, joint.folds, 'valley'));

  const tab = seamTab([below[0], above[0]], [below[1], above[1]], tabWidth);
  outline.push(...tab.outline);
  folds.push(...creaseLines(`tab-${band}`, tab.folds, 'valley'));

  // Only the slanted creases inside this band survive. Its two ring edges are cut
  // lines now, so a fold spanning one of them would be a fold across a joint.
  folds.push(...edges
    .filter((edge) => edge.kind !== 'cut' && edge.bend > FLAT_CREASE)
    .filter((edge) => Math.floor(edge.a / stride) === band && Math.floor(edge.b / stride) === band + 1)
    .map((edge, n) => ({
      id: `band${band}-${n}`, kind: edge.kind,
      x1: local(edge.a).x, y1: local(edge.a).y, x2: local(edge.b).x, y2: local(edge.b).y,
    })));

  return finishPiece(`band-${band}`, `Band ${band + 1} / ${rows}`, outline, folds, []);
}

function basePiece(parameters: PlanterParameters, rings: Vec3[][]): PlanterPiece {
  const foot = flatten(rings[0], parameters.sides);
  return finishPiece('base', 'Base plate', insetConvex(foot, parameters.baseInset), [], []);
}

function rimPiece(parameters: PlanterParameters, rings: Vec3[][]): PlanterPiece {
  const mouth = flatten(rings[parameters.rows], parameters.sides);
  // Collar width is measured in from the flats, which is where it runs narrowest.
  const opening = Math.max(15, inradius(mouth) - parameters.rimWidth);
  const centre = centroid(mouth);
  return finishPiece('rim', 'Top collar', mouth, [], [{ cx: centre.x, cy: centre.y, r: opening }]);
}

interface Layout { pieces: PlanterPiece[]; sheet: { width: number; height: number } }

function measure(placed: PlanterPiece[]): Layout {
  return {
    pieces: placed,
    sheet: {
      width: Math.max(...placed.map((piece) => piece.x + piece.width)),
      height: Math.max(...placed.map((piece) => piece.y + piece.height)),
    },
  };
}

/** Fill rows left to right, wrapping once a row would run past `target`. */
function shelfPack(pieces: PlanterPiece[], target: number): Layout {
  const placed: PlanterPiece[] = [];
  let shelfY = 0;
  let shelfHeight = 0;
  let cursor = 0;
  for (const piece of pieces) {
    if (cursor > 0 && cursor + NEST_GAP + piece.width > target) {
      shelfY += shelfHeight + NEST_GAP;
      shelfHeight = 0;
      cursor = 0;
    }
    if (cursor > 0) cursor += NEST_GAP;
    placed.push({ ...piece, x: cursor, y: shelfY });
    cursor += piece.width;
    shelfHeight = Math.max(shelfHeight, piece.height);
  }
  return measure(placed);
}

/**
 * Wall parts in a row, with the plates stacked in a column off the end. A wall net
 * is long and low, so the strip of sheet above the plates beside it is the only
 * free area worth having — and standing them there is often what brings a wide
 * design back inside the stock.
 */
function columnPack(wall: PlanterPiece[], plates: PlanterPiece[], target: number): Layout {
  const row = shelfPack(wall, target);
  let y = 0;
  const stacked = plates.map((piece) => {
    const placed = { ...piece, x: row.sheet.width + NEST_GAP, y };
    y += piece.height + NEST_GAP;
    return placed;
  });
  return measure([...row.pieces, ...stacked]);
}

/** Does a single part fit the stock sheet, either way round? */
function fitsStock(width: number, height: number, sheetWidth: number, sheetHeight: number): boolean {
  return (width <= sheetWidth && height <= sheetHeight) || (width <= sheetHeight && height <= sheetWidth);
}

/**
 * Drop the parts onto the stock. The wall net is long and low while the plates are
 * small and square, and a banded pot brings a strip per band, so no single
 * arrangement wins for every design: lay out a handful of candidates, each packed
 * across one edge of the sheet, and keep the first that clears a single sheet.
 *
 * A wide banded pot can genuinely need more stock than one sheet holds — that is a
 * material cost, not a design failure, so when nothing clears one sheet this keeps
 * the tightest candidate and reports how many sheets it takes rolled end to end
 * along the edge it was packed across, instead of shrinking the pot to fit.
 */
function nest(wall: PlanterPiece[], plates: PlanterPiece[], sheetWidth: number, sheetHeight: number): Layout & { sheets: number } {
  const all = [...wall, ...plates];
  const shortSide = Math.min(sheetWidth, sheetHeight);
  const longSide = Math.max(sheetWidth, sheetHeight);
  // `across` is the edge each candidate packed against; `along` is the other stock
  // dimension, so a fresh sheet is needed every `along` mm travelled down the roll.
  const options = [
    { layout: shelfPack(all, shortSide), across: shortSide, along: longSide },
    { layout: columnPack(wall, plates, shortSide), across: shortSide, along: longSide },
    { layout: shelfPack(all, longSide), across: longSide, along: shortSide },
    { layout: columnPack(wall, plates, longSide), across: longSide, along: shortSide },
  ];

  const fits = (sheet: Layout['sheet']) =>
    (sheet.width <= sheetWidth && sheet.height <= sheetHeight)
    || (sheet.width <= sheetHeight && sheet.height <= sheetWidth);
  const within = options.find((option) => fits(option.layout.sheet));
  if (within) return { ...within.layout, sheets: 1 };

  // The packer places a piece even when it overruns the target it was packed
  // against (a single band can be wider than the target), so a candidate whose
  // width overran its own `across` edge does not actually clear that edge on any
  // number of sheets rolled along it — only candidates that stayed inside their
  // target are real options for the roll.
  const eligible = options.filter((option) => option.layout.sheet.width <= option.across + 1e-6);
  const scored = (eligible.length > 0 ? eligible : options).map((option) => ({
    ...option,
    sheets: Math.max(1, Math.ceil(option.layout.sheet.height / option.along - 1e-9)),
  }));
  const best = scored.reduce((winner, option) => (option.sheets < winner.sheets ? option : winner));
  return { ...best.layout, sheets: best.sheets };
}

// ---------------------------------------------------------------------------

export function buildPlanterModel(parameters: PlanterParameters): PlanterModel {
  const safe = normalizePlanter(parameters);
  const stride = safe.sides + 1;
  const vertices = planterVertices(safe);
  const triangles = planterTriangles(safe, vertices);
  const edges = wallEdges(triangles, vertices, stride);
  const unfolder: Unfolder = { rings: vertices, triangles, sides: safe.sides, rows: safe.rows };
  const banded = safe.construction === 'banded';

  // Each wall part carries its own copy of the rings it touches. In single-sheet
  // construction those copies coincide; in banded construction they are the edges
  // of two separate parts that meet at a rivet line.
  const wallParts: PlanterPiece[] = [];
  const local: Vec2[][][] = [];
  if (banded) {
    for (let k = 0; k < safe.rows; k += 1) {
      const [below, above] = unfoldBand(unfolder, k);
      local.push([below, above]);
      wallParts.push(bandPiece(safe, k, below, above, edges));
    }
  } else {
    const grid = unfoldWall(unfolder);
    for (let k = 0; k < safe.rows; k += 1) local.push([grid[k], grid[k + 1]]);
    wallParts.push(wallPiece(safe, grid, edges));
  }

  const { pieces, sheet, sheets } = nest(
    wallParts,
    [basePiece(safe, vertices), rimPiece(safe, vertices)],
    safe.sheetWidth,
    safe.sheetHeight,
  );

  // Lift each band out of its construction frame onto the sheet, so the flat net
  // and the cut layout are one drawing rather than two.
  const flatByBand = local.map((rings, k) => {
    const piece = pieces[banded ? k : 0];
    const shift = { x: piece.x - piece.origin.x, y: piece.y - piece.origin.y };
    return rings.map((ring) => ring.map((point) => add2(point, shift)));
  });

  const at = (id: number) => vertices[Math.floor(id / stride)][id % stride];
  const planar = (band: number, id: number) => flatByBand[band][Math.floor(id / stride) - band][id % stride];
  let developmentError = 0;
  for (let k = 0; k < safe.rows; k += 1) {
    for (let t = 0; t < safe.sides * 2; t += 1) {
      const [a, b, c] = triangles[k * safe.sides * 2 + t].v;
      for (const [p, q] of [[a, b], [b, c], [c, a]]) {
        developmentError = Math.max(developmentError, Math.abs(dist2(planar(k, p), planar(k, q)) - dist3(at(p), at(q))));
      }
    }
  }

  return {
    parameters: safe,
    vertices,
    flatByBand,
    triangles,
    pieces,
    sheet,
    maxBend: edges.reduce((worst, edge) => (edge.kind === 'cut' ? worst : Math.max(worst, edge.bend)), 0),
    developmentError,
    joints: banded ? safe.rows - 1 : 0,
    sheets,
  };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/** Enclosed volume, summed frustum by frustum between the rings. */
export function planterVolumeLitres(model: PlanterModel): number {
  const { sides, rows } = model.parameters;
  let volume = 0;
  for (let k = 0; k < rows; k += 1) {
    const lower = Math.abs(polygonArea(flatten(model.vertices[k], sides)));
    const upper = Math.abs(polygonArea(flatten(model.vertices[k + 1], sides)));
    const rise = model.vertices[k + 1][0].z - model.vertices[k][0].z;
    volume += (rise / 3) * (lower + upper + Math.sqrt(lower * upper));
  }
  return volume / 1_000_000;
}

export function getPlanterStats(model: PlanterModel, material: MaterialSpec): PlanterStats {
  const { sides, rows } = model.parameters;
  const creaseLength = model.pieces.reduce(
    (sum, piece) => sum + piece.folds.reduce((run, fold) => run + Math.hypot(fold.x2 - fold.x1, fold.y2 - fold.y1), 0),
    0,
  );
  const cutLength = model.pieces.reduce(
    (sum, piece) => sum + perimeter(piece.outline) + piece.circles.reduce((run, circle) => run + TAU * circle.r, 0),
    0,
  );
  const sheetArea = model.pieces.reduce(
    (sum, piece) => sum + Math.abs(polygonArea(piece.outline))
      - piece.circles.reduce((hole, circle) => hole + Math.PI * circle.r * circle.r, 0),
    0,
  );
  const rim = model.pieces.find((piece) => piece.id === 'rim');
  const widest = model.vertices.reduce((best, ring) => {
    const box = bounds(flatten(ring, sides));
    const size = { width: box.maxX - box.minX, height: box.maxY - box.minY };
    return size.width * size.height > best.width * best.height ? size : best;
  }, { width: 0, height: 0 });

  return {
    facets: sides * rows * 2,
    creaseLength: `${(creaseLength / 1000).toFixed(2)} m`,
    cutLength: `${(cutLength / 1000).toFixed(2)} m`,
    sheetUsage: model.sheets > 1
      ? `${Math.ceil(model.sheet.width)} × ${Math.ceil(model.sheet.height)} mm across ${model.sheets} sheets`
      : `${Math.ceil(model.sheet.width)} × ${Math.ceil(model.sheet.height)} mm`,
    estimatedWeight: `${(sheetArea * material.thickness * material.density).toFixed(2)} kg`,
    volume: `≈ ${planterVolumeLitres(model).toFixed(1)} L`,
    topOpening: `${Math.round((rim?.circles[0]?.r ?? 0) * 2)} mm`,
    footprint: `${Math.round(widest.width)} × ${Math.round(widest.height)} mm`,
    pieces: model.pieces.length,
    sheets: model.sheets,
  };
}

/** Everything standing between this design and a finished pot, worst first. */
export function getPlanterChecks(model: PlanterModel, material: MaterialSpec): FabricationCheck[] {
  const { sides, rows, sheetWidth, sheetHeight, height, rimWidth, construction, jointTab, baseTab, rimTab } = model.parameters;
  const checks: FabricationCheck[] = [];
  const oversized = model.pieces.find((piece) => !fitsStock(piece.width, piece.height, sheetWidth, sheetHeight));

  if (oversized) {
    checks.push({
      id: 'sheet-fit', severity: 'error', title: 'A part is larger than the stock sheet',
      detail: `${oversized.label} needs ${Math.ceil(oversized.width)} × ${Math.ceil(oversized.height)} mm but the sheet is only ${sheetWidth} × ${sheetHeight} mm. Shrink the pot, drop a band, or switch to banded construction — separate strips are far smaller than one long blank.`,
    });
  } else if (model.sheets > 1) {
    checks.push({
      id: 'sheet-count', severity: 'info', title: `Needs ${model.sheets} stock sheets`,
      detail: `The nested parts run ${Math.ceil(model.sheet.width)} × ${Math.ceil(model.sheet.height)} mm laid out end to end — more than one ${sheetWidth} × ${sheetHeight} mm sheet holds. Budget ${model.sheets} sheets of ${material.shortName} for this run.`,
    });
  }

  if (model.maxBend > material.maxBendAngle + 0.5) {
    checks.push({
      id: 'bend-angle', severity: 'error', title: 'Crease beyond the material limit',
      detail: `The steepest crease turns ${model.maxBend.toFixed(0)}°, past the ${material.maxBendAngle}° limit for ${material.shortName}. The skin will split along the fold.`,
    });
  }

  const mouthInradius = inradius(flatten(model.vertices[rows], sides));
  if (rimWidth > mouthInradius - 15) {
    checks.push({
      id: 'rim-width', severity: 'error', title: 'Collar closes over the planting hole',
      detail: `A ${Math.round(rimWidth)} mm collar leaves under 15 mm of opening on a ${Math.round(mouthInradius * 2)} mm mouth. Narrow the collar or widen the top.`,
    });
  }

  // Taper, stagger, twist and band height all develop exactly from one blank. A
  // bulge does not: it is curvature, and a curved surface has no flat net at all.
  // Cutting the wall into bands sidesteps that, because a strip always develops.
  if (model.developmentError > 0.8) {
    const bulged = Math.abs(model.parameters.bulge) > 0.5;
    const culprit = bulged
      ? 'A bulged wall is curved, so no single blank folds into it. Switch construction to Banded — each band develops exactly and the rings rivet together.'
      : model.parameters.footprint === 'rectangle' && getPlanterStyle(model.parameters.style).offsetStep > 0
        ? 'Staggering the rings of a rectangle swings long edges onto short ones, which curves the wall. Square the footprint up, pick the Straight Facet style, or switch to Banded construction.'
        : model.parameters.rhythm > 1
          ? 'A band rhythm is free on a straight wall and fights a taper. Straighten the taper, take the rhythm down, or switch to Banded construction.'
          : 'Ease the taper or the band count, or switch to Banded construction.';
    checks.push({
      id: 'development', severity: model.developmentError > 3 ? 'error' : 'warning',
      title: 'Facets will not lie flat without stretch',
      detail: `Developing this wall as one blank leaves ${model.developmentError.toFixed(1)} mm of edge mismatch. ${culprit}`,
    });
  }

  if (material.foldMethod === 'heat-bend') {
    checks.push({
      id: 'heat-bend', severity: 'warning', title: `${material.shortName} cannot be V-grooved`,
      detail: `Acrylic crazes at a sharp crease. Line-bend every fold over a ${material.minRadius} mm radius former and treat the net as a bend layout, not a groove toolpath.`,
    });
  }

  if (construction === 'banded' && jointTab > 0.5 && jointTab < material.thickness * 4) {
    checks.push({
      id: 'joint-tab', severity: 'warning', title: 'Rivet tabs are short for this stock',
      detail: `A ${Math.round(jointTab)} mm tab on ${material.thickness} mm stock leaves little room to land a rivet clear of the fold. Give the joint tabs at least ${Math.ceil(material.thickness * 4)} mm.`,
    });
  }

  if (baseTab > 0.5 && baseTab < material.thickness * 4) {
    checks.push({
      id: 'base-tab', severity: 'warning', title: 'Base tabs are short for this stock',
      detail: `A ${Math.round(baseTab)} mm tab on ${material.thickness} mm stock leaves little room to land a rivet clear of the fold. Give the base tabs at least ${Math.ceil(material.thickness * 4)} mm.`,
    });
  }

  if (rimTab > 0.5 && rimTab < material.thickness * 4) {
    checks.push({
      id: 'rim-tab', severity: 'warning', title: 'Collar tabs are short for this stock',
      detail: `A ${Math.round(rimTab)} mm tab on ${material.thickness} mm stock leaves little room to land a rivet clear of the fold. Give the collar tabs at least ${Math.ceil(material.thickness * 4)} mm.`,
    });
  }

  const creases = model.pieces
    .filter((piece) => piece.id === 'wall' || piece.id.startsWith('band-'))
    .flatMap((piece) => piece.folds.map((fold) => Math.hypot(fold.x2 - fold.x1, fold.y2 - fold.y1)));
  const shortestCrease = creases.length > 0 ? Math.min(...creases) : Infinity;
  if (Number.isFinite(shortestCrease) && shortestCrease < material.recommendedCell * 0.4) {
    checks.push({
      id: 'facet-size', severity: 'warning', title: 'Facets are small for this stock',
      detail: `The shortest crease is ${Math.round(shortestCrease)} mm against a ${material.recommendedCell} mm recommended cell for ${material.shortName}. Grooves that crowd each other tear at the intersections.`,
    });
  }

  const foot = inradius(flatten(model.vertices[0], sides)) * 2;
  if (foot < height * 0.45) {
    checks.push({
      id: 'stability', severity: 'info', title: 'Tall and narrow — ballast the base',
      detail: `A ${Math.round(foot)} mm foot under a ${Math.round(height)} mm pot tips easily once the plant goes top-heavy. Weight the base plate or widen the foot.`,
    });
  }

  if (checks.length === 0) {
    const how = construction === 'banded'
      ? `${rows} riveted ${rows === 1 ? 'band' : 'bands'}`
      : `${rows} ${rows === 1 ? 'band' : 'bands'} from one blank`;
    checks.push({
      id: 'ready', severity: 'info', title: 'Cleared for fabrication',
      detail: `${sides} sides × ${how} on ${material.shortName}, steepest crease ${model.maxBend.toFixed(0)}°, nested into ${Math.ceil(model.sheet.width)} × ${Math.ceil(model.sheet.height)} mm.`,
    });
  }
  return checks;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export const FOLD_COLORS: Record<FoldKind, string> = {
  mountain: '#ff5f8f', valley: '#57d7e8', cut: '#6b7085',
};

/** A piece's geometry moved out of its local frame and into the nested sheet. */
export function placedGeometry(piece: PlanterPiece) {
  return {
    outline: piece.outline.map((point) => ({ x: point.x + piece.x, y: point.y + piece.y })),
    folds: piece.folds.map((fold) => ({
      ...fold,
      x1: fold.x1 + piece.x, y1: fold.y1 + piece.y, x2: fold.x2 + piece.x, y2: fold.y2 + piece.y,
    })),
    circles: piece.circles.map((circle) => ({ ...circle, cx: circle.cx + piece.x, cy: circle.cy + piece.y })),
  };
}

/** 1:1 millimetre SVG of the whole nested sheet, notation and shop notes included. */
export function buildPlanterSvg(model: PlanterModel, material: MaterialSpec, styleName: string): string {
  const { width, height } = model.sheet;
  const body: string[] = [];
  const annotation: string[] = [];

  for (const piece of model.pieces) {
    const { outline, folds, circles } = placedGeometry(piece);
    const points = outline.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
    body.push(`<polygon points="${points}" stroke="${FOLD_COLORS.cut}" stroke-width="0.4" stroke-dasharray="18 6 4 6"/>`);
    for (const circle of circles) {
      body.push(`<circle cx="${circle.cx.toFixed(2)}" cy="${circle.cy.toFixed(2)}" r="${circle.r.toFixed(2)}" stroke="${FOLD_COLORS.cut}" stroke-width="0.4" stroke-dasharray="18 6 4 6"/>`);
    }
    for (const fold of folds) {
      // Dash lengths are millimetres here, not screen pixels as on the canvas.
      const dash = fold.kind === 'valley' ? ' stroke-dasharray="14 8"' : '';
      body.push(`<line x1="${fold.x1.toFixed(2)}" y1="${fold.y1.toFixed(2)}" x2="${fold.x2.toFixed(2)}" y2="${fold.y2.toFixed(2)}" stroke="${FOLD_COLORS[fold.kind]}" stroke-width="0.3"${dash}/>`);
    }
    // Labels live in a y-up group, so each is flipped back the right way round.
    annotation.push(`<text x="${(piece.x + 6).toFixed(2)}" y="${(-(piece.y + 12)).toFixed(2)}" font-size="14" fill="#9aa2b4" transform="scale(1,-1)">${piece.label}</text>`);
  }

  const notes = [
    `${styleName} planter — ${model.parameters.sides} sides, ${model.parameters.rows} bands, ${Math.round(model.parameters.height)} mm tall`,
    `Material: ${material.name} (${material.thickness} mm)`,
    model.sheets > 1
      ? `Nest spans ${model.sheets} stock sheets of ${model.parameters.sheetWidth} × ${model.parameters.sheetHeight} mm`
      : `Fits one ${model.parameters.sheetWidth} × ${model.parameters.sheetHeight} mm stock sheet`,
    model.joints > 0
      ? `Banded build: ${model.joints} riveted ring ${model.joints === 1 ? 'joint' : 'joints'}, tabs fold inward`
      : 'Single-sheet build: every ring is a crease, not a joint',
    material.foldMethod === 'heat-bend'
      ? `Heat-bend over a ${material.minRadius} mm radius — do not V-groove`
      : 'V-groove on the reverse face; the net is drawn as seen from outside',
    `Steepest crease ${model.maxBend.toFixed(0)}° · development error ${model.developmentError.toFixed(2)} mm`,
    'Solid = mountain · dashed = valley · dash-dot = cut',
  ];

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width.toFixed(2)} ${height.toFixed(2)}" width="${width.toFixed(2)}mm" height="${height.toFixed(2)}mm">`
    + `<title>DXF.AC3D ${styleName} planter</title><desc>${notes.join(' | ')}</desc>`
    + '<rect width="100%" height="100%" fill="white"/>'
    + `<g transform="translate(0,${height.toFixed(2)}) scale(1,-1)" fill="none" stroke-linecap="round" stroke-linejoin="round">${body.join('')}`
    + `<g id="annotation" stroke="none">${annotation.join('')}</g></g></svg>`;
}

const DXF_LAYERS: Record<FoldKind, { name: string; color: number }> = {
  cut: { name: 'CUT', color: 7 }, mountain: { name: 'MOUNTAIN', color: 1 }, valley: { name: 'VALLEY', color: 5 },
};

const pair = (code: number, value: string | number): string => `${code}\n${value}\n`;

/**
 * DXF R12 — the format every router control still reads without argument. One
 * layer per fold kind, so cuts and grooves can be sent to different tools.
 */
export function buildPlanterDxf(model: PlanterModel): string {
  let out = pair(0, 'SECTION') + pair(2, 'TABLES') + pair(0, 'TABLE') + pair(2, 'LAYER') + pair(70, 3);
  for (const layer of Object.values(DXF_LAYERS)) {
    out += pair(0, 'LAYER') + pair(2, layer.name) + pair(70, 0) + pair(62, layer.color) + pair(6, 'CONTINUOUS');
  }
  out += pair(0, 'ENDTAB') + pair(0, 'ENDSEC') + pair(0, 'SECTION') + pair(2, 'ENTITIES');

  const line = (layer: string, a: Vec2, b: Vec2) =>
    pair(0, 'LINE') + pair(8, layer)
    + pair(10, a.x.toFixed(3)) + pair(20, a.y.toFixed(3)) + pair(30, '0.0')
    + pair(11, b.x.toFixed(3)) + pair(21, b.y.toFixed(3)) + pair(31, '0.0');

  for (const piece of model.pieces) {
    const { outline, folds, circles } = placedGeometry(piece);
    for (let i = 0; i < outline.length; i += 1) {
      out += line(DXF_LAYERS.cut.name, outline[i], outline[(i + 1) % outline.length]);
    }
    for (const circle of circles) {
      out += pair(0, 'CIRCLE') + pair(8, DXF_LAYERS.cut.name)
        + pair(10, circle.cx.toFixed(3)) + pair(20, circle.cy.toFixed(3)) + pair(30, '0.0')
        + pair(40, circle.r.toFixed(3));
    }
    for (const fold of folds) {
      out += line(DXF_LAYERS[fold.kind].name, { x: fold.x1, y: fold.y1 }, { x: fold.x2, y: fold.y2 });
    }
  }
  return `${out}${pair(0, 'ENDSEC')}${pair(0, 'EOF')}`;
}

export { getMaterial };
