import type { Vec2 } from './types';

/**
 * The milled pattern: triangles cut out of triangles.
 *
 * The wall is already triangulated — every facet of it is one of the triangles
 * the unfolder places — so the perforation is laid out facet by facet on that
 * same triangulation rather than as a grid stamped across the net. Two things
 * follow from that, and both are the reason it is done this way:
 *
 * - No cut-out can ever cross a crease, because no cut-out leaves the facet it
 *   was subdivided out of. A hole across a fold is a fold that tears.
 * - The pattern reads as the pot's own geometry rather than as wallpaper laid
 *   over it. Change the style, the sides or the band count and the perforation
 *   follows, because it is cut from the same triangles the facets are.
 *
 * Every contour here is drawn the way a cutter can actually produce it. An end
 * mill of diameter `tool` leaves a radius in every internal corner whatever the
 * drawing says, so the corners are drawn at that radius — the file matches the
 * part that comes off the machine, and the roundness reads as intent rather
 * than as a tolerance the shop had to absorb.
 */

const TAU = Math.PI * 2;
const EPSILON = 1e-9;

/** Chord error allowed when an arc is written out as straight segments (mm). */
const SAGITTA = 0.02;

/** Ceiling on the segments in one corner arc — past this the file bloats for nothing. */
const MAX_ARC_STEPS = 24;

export interface PerforationSpec {
  /** Facet subdivision: 1 cuts one cell per facet, n cuts n². */
  density: number;
  /**
   * Share of each lattice cell actually cut away, 0–1. This is what decides how
   * much material leaves the sheet; the density only decides how many pieces it
   * leaves in. A composite panel carries its load in its skins, so a decorative
   * cut-out wants this low and the wall mostly solid.
   */
  opening: number;
  /** Solid web left between neighbouring cells (mm). */
  web: number;
  /** Solid border kept at every crease and cut edge of the facet (mm). */
  margin: number;
  /** Cutter diameter (mm). Every internal corner is drawn at its radius. */
  tool: number;
  /**
   * How present the pattern is at a given point, 0–1.
   *
   * This is what makes a panel dissolve: full at the top, nothing at the
   * bottom, with the pattern thinning out through the middle rather than
   * stopping at a line. It is handed in as a function of position because only
   * the caller knows which way is up once a facet has been flattened — the
   * generators just ask it about each opening before they draw one.
   *
   * Left out, the pattern is uniform.
   */
  fade?: (point: Vec2) => number;
  /**
   * Cut only this many of the facet's cells instead of all of them — "six of
   * the thirty-six". 0 or absent cuts every cell that survives the other rules.
   *
   * Which six is settled once and never moves, and where a fade is running the
   * draw is weighted by it, so the survivors are the cells high up the wall.
   * That is the difference between a pattern that thins out and a pattern with
   * holes missing from it.
   */
  picked?: number;
}

export interface PerforationResult {
  /** Closed contours, last point joining the first. Holes: this falls out. */
  cells: Vec2[][];
  /**
   * Flaps, for the family that cuts and folds instead of cutting out. Each is
   * three points — the two ends of its hinge first, then its free tip — and
   * nothing about it leaves the sheet: two of its edges are severed and it
   * bends out on the third.
   */
  flaps?: Triangle2[];
  /** Cells the cutter could not drop into, left solid rather than drawn undercut. */
  dropped: number;
  /**
   * Area opened up (mm²). For holes that is also the material removed; for
   * flaps nothing is removed at all and this is the aperture they bend out of.
   */
  area: number;
}

export type Triangle2 = [Vec2, Vec2, Vec2];

// ---------------------------------------------------------------------------
// Small plane geometry
// ---------------------------------------------------------------------------

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

function unit(v: Vec2): Vec2 {
  const length = Math.hypot(v.x, v.y) || EPSILON;
  return { x: v.x / length, y: v.y / length };
}

/** Signed area of a closed polygon. */
export function polygonArea(points: Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/** Radius of the largest circle a triangle holds — the cutter has to fit inside it. */
export function triangleInradius(tri: Triangle2): number {
  const a = dist(tri[1], tri[2]);
  const b = dist(tri[2], tri[0]);
  const c = dist(tri[0], tri[1]);
  const s = (a + b + c) / 2;
  if (s <= EPSILON) return 0;
  return Math.abs(polygonArea(tri)) / s;
}

/** A triangle's centroid — where the fade is asked about a cell. */
const centreOf = (tri: Triangle2): Vec2 => ({
  x: (tri[0].x + tri[1].x + tri[2].x) / 3,
  y: (tri[0].y + tri[1].y + tri[2].y) / 3,
});

function incentre(tri: Triangle2): Vec2 {
  const a = dist(tri[1], tri[2]);
  const b = dist(tri[2], tri[0]);
  const c = dist(tri[0], tri[1]);
  const total = a + b + c || EPSILON;
  return {
    x: (a * tri[0].x + b * tri[1].x + c * tri[2].x) / total,
    y: (a * tri[0].y + b * tri[1].y + c * tri[2].y) / total,
  };
}

/**
 * Pull every edge of a triangle in by the same distance.
 *
 * Scaling about the incentre is exactly that, not an approximation of it: a
 * triangle scaled by k about its incentre has inradius k·r, so each of its
 * edges sits (1 − k)·r inside the edge it came from. Pulling the corners in
 * instead would move a sharp corner much further than a blunt one, which is not
 * what "keep 22 mm clear of the crease" means at the machine.
 *
 * Returns null when the triangle has no room left to give.
 */
export function shrinkTriangle(tri: Triangle2, amount: number): Triangle2 | null {
  if (amount <= EPSILON) return tri;
  const r = triangleInradius(tri);
  if (r <= amount + EPSILON) return null;
  const centre = incentre(tri);
  const k = 1 - amount / r;
  return tri.map((point) => ({
    x: centre.x + (point.x - centre.x) * k,
    y: centre.y + (point.y - centre.y) * k,
  })) as Triangle2;
}

/**
 * Split a triangle into n² similar ones on the barycentric lattice — n(n+1)/2
 * pointing the same way as the parent and n(n−1)/2 pointing against it. Both
 * orientations are kept: a field of alternating triangles leaves an even web
 * everywhere, where keeping only the upright ones leaves solid inverted
 * triangles between them, which reads as a mistake rather than as a pattern at
 * anything past the lowest density.
 */
export function subdivideTriangle(tri: Triangle2, density: number): Triangle2[] {
  const n = Math.max(1, Math.round(density));
  const at = (i: number, j: number): Vec2 => ({
    x: tri[0].x + ((tri[1].x - tri[0].x) * i + (tri[2].x - tri[0].x) * j) / n,
    y: tri[0].y + ((tri[1].y - tri[0].y) * i + (tri[2].y - tri[0].y) * j) / n,
  });

  const out: Triangle2[] = [];
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i + j < n; i += 1) {
      out.push([at(i, j), at(i + 1, j), at(i, j + 1)]);
      if (i + j < n - 1) out.push([at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]);
    }
  }
  return out;
}

/** Segments an arc needs before its chords sit within `SAGITTA` of the true curve. */
function arcSteps(radius: number, sweep: number): number {
  if (radius <= SAGITTA) return 1;
  const step = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - SAGITTA / radius)));
  return Math.max(1, Math.min(MAX_ARC_STEPS, Math.ceil(Math.abs(sweep) / step)));
}

/**
 * Round every corner of a convex contour to the cutter's radius.
 *
 * The radius asked for is what the corner gets unless the legs cannot carry it:
 * each corner may claim at most half of each leg it sits on, so the two corners
 * at the ends of a short edge cannot eat into one another.
 */
export function filletPolygon(points: Vec2[], radius: number): Vec2[] {
  if (radius <= EPSILON || points.length < 3) return points.slice();
  const out: Vec2[] = [];

  for (let i = 0; i < points.length; i += 1) {
    const corner = points[i];
    const before = points[(i - 1 + points.length) % points.length];
    const after = points[(i + 1) % points.length];
    const toBefore = unit(sub(before, corner));
    const toAfter = unit(sub(after, corner));
    const interior = Math.acos(Math.max(-1, Math.min(1, toBefore.x * toAfter.x + toBefore.y * toAfter.y)));
    if (interior < 1e-6 || Math.PI - interior < 1e-6) {
      out.push(corner);
      continue;
    }

    const half = interior / 2;
    const reach = Math.min(dist(corner, before), dist(corner, after)) / 2;
    const r = Math.min(radius, reach * Math.tan(half));
    if (r <= EPSILON) {
      out.push(corner);
      continue;
    }

    const along = r / Math.tan(half);
    const start = { x: corner.x + toBefore.x * along, y: corner.y + toBefore.y * along };
    const end = { x: corner.x + toAfter.x * along, y: corner.y + toAfter.y * along };
    const bisector = unit({ x: toBefore.x + toAfter.x, y: toBefore.y + toAfter.y });
    const centre = {
      x: corner.x + bisector.x * (r / Math.sin(half)),
      y: corner.y + bisector.y * (r / Math.sin(half)),
    };

    const from = Math.atan2(start.y - centre.y, start.x - centre.x);
    const to = Math.atan2(end.y - centre.y, end.x - centre.x);
    // The arc replaces a corner, so it always turns through less than half a
    // circle — the short way round is the right way round.
    let sweep = to - from;
    while (sweep > Math.PI) sweep -= TAU;
    while (sweep < -Math.PI) sweep += TAU;

    const steps = arcSteps(r, sweep);
    for (let s = 0; s <= steps; s += 1) {
      const angle = from + (sweep * s) / steps;
      out.push({ x: centre.x + Math.cos(angle) * r, y: centre.y + Math.sin(angle) * r });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The pattern
// ---------------------------------------------------------------------------

/**
 * One facet's worth of cut-outs.
 *
 * The facet is pulled in by `margin` first — that border is what the creases
 * and the net's own outline fold and rivet through, and nothing is cut inside
 * it. What is left is subdivided, and every cell is then pulled in by half the
 * web, so two cells sharing a lattice edge end up exactly `web` apart.
 */
export function perforateFacet(tri: Triangle2, spec: PerforationSpec): PerforationResult {
  const field = shrinkTriangle(tri, spec.margin);
  if (!field) return { cells: [], dropped: 0, area: 0 };

  const radius = spec.tool / 2;
  const cells: Vec2[][] = [];
  let dropped = 0;
  let area = 0;

  const lattice = subdivideTriangle(field, spec.density);
  let chosen = lattice;

  // "Six of the thirty-six." Weighted sampling without replacement: each cell
  // draws a key of u^(1/w) for its fade weight w, and the highest keys win —
  // which picks evenly when nothing is fading and leans up the wall when
  // something is. Seeded, so the same design always cuts the same six.
  const picked = Math.round(spec.picked ?? 0);
  if (picked > 0 && picked < lattice.length) {
    const draw = seeded(0xc2b2ae35);
    chosen = lattice
      .map((cell) => {
        const weight = spec.fade ? Math.max(0, Math.min(1, spec.fade(centreOf(cell)))) : 1;
        return { cell, key: weight <= 0 ? -1 : draw() ** (1 / weight) };
      })
      .sort((a, b) => b.key - a.key)
      .slice(0, picked)
      .filter((entry) => entry.key >= 0)
      .map((entry) => entry.cell);
    dropped += lattice.length - chosen.length;
  }

  for (const raw of chosen) {
    // Two things set how far a cell is pulled in from its lattice square, and
    // the tighter of them wins.
    //
    // The first is the opening asked for. A triangle scaled by k about its
    // incentre has k² of the area, so pulling in by (1 − √opening) of the
    // inradius removes exactly the share asked for — which is the number that
    // decides whether the panel is still a panel.
    //
    // The second is the web, which is a minimum and not a target: two cells
    // sharing a lattice edge each give up half of it, so they end up a full web
    // apart however small the openings get.
    //
    // A cell that was explicitly picked is cut at its full size: the count is
    // the lever in that mode, and thinning it by the fade as well would take
    // the material out twice.
    const here = picked > 0 ? 1 : (spec.fade ? spec.fade(centreOf(raw)) : 1);
    const opening = Math.max(0, Math.min(1, spec.opening)) * Math.max(0, Math.min(1, here));
    if (opening <= EPSILON) {
      dropped += 1;
      continue;
    }
    const wanted = triangleInradius(raw) * (1 - Math.sqrt(opening));
    const cell = shrinkTriangle(raw, Math.max(spec.web / 2, wanted));
    // A cell the cutter cannot drop into is not a cell. Leaving it solid is the
    // honest outcome; drawing it would promise a corner the tool cannot reach
    // and hand the shop a contour it has to gouge its way around.
    if (!cell || triangleInradius(cell) <= radius) {
      dropped += 1;
      continue;
    }
    const contour = filletPolygon(cell, radius);
    cells.push(contour);
    area += Math.abs(polygonArea(contour));
  }

  return { cells, dropped, area };
}

/**
 * A seeded generator, so a scatter is a design and not a lottery.
 *
 * Mulberry32. The same facet always scatters the same way, which is what makes
 * the pattern a thing you can approve on Monday and cut on Thursday — and it
 * means a diff between two exports is a real change rather than yesterday's
 * random numbers.
 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Distance from a point inside a triangle to its nearest edge. */
function toEdges(tri: Triangle2, point: Vec2): number {
  let nearest = Infinity;
  for (let i = 0; i < 3; i += 1) {
    const a = tri[i];
    const b = tri[(i + 1) % 3];
    const span = dist(a, b) || EPSILON;
    nearest = Math.min(nearest, Math.abs((b.x - a.x) * (a.y - point.y) - (a.x - point.x) * (b.y - a.y)) / span);
  }
  return nearest;
}

/** Attempts made to place one disc before it is given up on. */
const SCATTER_TRIES = 14;
/** Ceiling on the discs considered for one facet, whatever the numbers ask for. */
const SCATTER_LIMIT = 900;

/**
 * Scattered discs — the other way a perforated panel is made, and the one the
 * trade actually ships: a drift of round holes in mixed sizes, dense in places
 * and open in others, reading as weather rather than as a grid.
 *
 * Three things make it read as designed rather than as spillage. Sizes are
 * drawn with a strong bias to the small, so a few large discs carry the
 * composition and the rest fill around them. They are placed largest first,
 * because a big disc dropped into a field of small ones rarely finds room.
 * And every one of them keeps the full web from its neighbours and the full
 * border from the creases, exactly as the triangles do — a scatter is a
 * pattern with the same duties, not a licence to put a hole anywhere.
 *
 * A disc has no internal corners, so the cutter radius only sets how small a
 * disc is allowed to be: one the mill cannot produce is never drawn.
 */
export function scatterFacet(tri: Triangle2, spec: PerforationSpec): PerforationResult {
  const field = shrinkTriangle(tri, spec.margin);
  if (!field) return { cells: [], dropped: 0, area: 0 };

  const room = triangleInradius(field);
  const fieldArea = Math.abs(polygonArea(field));
  // The coarsest setting puts a disc about half the facet across; the finest
  // drops it to a ninth, which is the same scale the triangles work at.
  const largest = room / (Math.max(1, Math.round(spec.density)) + 1);
  const smallest = Math.max(spec.tool / 2, largest * 0.22);
  if (largest < smallest || smallest <= EPSILON) return { cells: [], dropped: 0, area: 0 };

  const target = fieldArea * Math.max(0, Math.min(1, spec.opening));
  const wanted = Math.min(
    SCATTER_LIMIT,
    Math.max(6, Math.round(target / (Math.PI * smallest * smallest))),
  );

  // A fixed seed: the facet's own geometry already makes two different facets
  // scatter differently, and two identical facets should come out identical.
  const random = seeded(0x9e3779b9);
  const radii = Array.from({ length: wanted }, () => {
    // u² pushes the draw towards the small end, which is what gives a few big
    // discs and a crowd of little ones rather than an even gravel.
    const bias = random() ** 2.2;
    return smallest + (largest - smallest) * bias;
  }).sort((a, b) => b - a);

  const placed: { centre: Vec2; radius: number }[] = [];
  let area = 0;
  let dropped = 0;

  for (const radius of radii) {
    if (area >= target) break;
    let landed = false;
    for (let attempt = 0; attempt < SCATTER_TRIES; attempt += 1) {
      let u = random();
      let v = random();
      if (u + v > 1) { u = 1 - u; v = 1 - v; }
      const centre = {
        x: field[0].x + (field[1].x - field[0].x) * u + (field[2].x - field[0].x) * v,
        y: field[0].y + (field[1].y - field[0].y) * u + (field[2].y - field[0].y) * v,
      };
      // Fully inside the border, and a full web off every disc already down.
      if (toEdges(field, centre) < radius) continue;
      // Thinner the further down the fade says we are, so the scatter dissolves
      // instead of stopping — the disc is simply not taken here this time.
      if (spec.fade && random() > Math.max(0, Math.min(1, spec.fade(centre)))) continue;
      if (placed.some((disc) => dist(disc.centre, centre) < disc.radius + radius + spec.web)) continue;
      placed.push({ centre, radius });
      area += Math.PI * radius * radius;
      landed = true;
      break;
    }
    if (!landed) dropped += 1;
  }

  return { cells: placed.map((disc) => circleContour(disc.centre, disc.radius * 2)), dropped, area };
}

/**
 * Scattered shards — half-square triangles on a grid, each turned at random and
 * most of the grid left empty.
 *
 * This is the pattern the trade cuts most: it reads as a drift of triangles
 * rather than as a lattice, because the grid under it is never visible — only a
 * fraction of its squares carry anything, and the ones that do point four
 * different ways. The grid is aligned to the facet's own first edge, so the
 * shards sit square to the pot rather than to the cutting sheet.
 *
 * `opening` sets how much of the grid is used, which is the same lever it is
 * everywhere else: a low number leaves a mostly solid wall with a scatter of
 * marks on it, which is what a composite panel wants.
 */
export function shardFacet(tri: Triangle2, spec: PerforationSpec): PerforationResult {
  const field = shrinkTriangle(tri, spec.margin);
  if (!field) return { cells: [], dropped: 0, area: 0 };

  const room = triangleInradius(field);
  const pitch = (room * 2) / (Math.max(1, Math.round(spec.density)) + 1);
  if (pitch <= spec.web + spec.tool) return { cells: [], dropped: 0, area: 0 };

  // The shard is the half-square, pulled in by half the web so that two in
  // neighbouring squares still end up a full web apart.
  const inset = spec.web / 2;
  const side = pitch - spec.web;
  if (side <= spec.tool) return { cells: [], dropped: 0, area: 0 };

  // A half-square fills half its square, so this is the share of squares that
  // have to carry a shard for the opening asked for to come out right.
  const fill = Math.max(0, Math.min(1, spec.opening)) * 2 * (pitch / side) ** 2;
  const along = unit(sub(field[1], field[0]));
  const across = { x: -along.y, y: along.x };
  const random = seeded(0x85ebca6b);

  // Walk a square grid across the field's own extent in that frame.
  const reach = field.map((corner) => ({
    u: (corner.x - field[0].x) * along.x + (corner.y - field[0].y) * along.y,
    v: (corner.x - field[0].x) * across.x + (corner.y - field[0].y) * across.y,
  }));
  const lowU = Math.min(...reach.map((r) => r.u));
  const highU = Math.max(...reach.map((r) => r.u));
  const lowV = Math.min(...reach.map((r) => r.v));
  const highV = Math.max(...reach.map((r) => r.v));

  const cells: Vec2[][] = [];
  let area = 0;
  const dropped = 0;

  for (let v = lowV; v < highV; v += pitch) {
    for (let u = lowU; u < highU; u += pitch) {
      const at0 = (du: number, dv: number): Vec2 => ({
        x: field[0].x + along.x * (u + du * pitch) + across.x * (v + dv * pitch),
        y: field[0].y + along.y * (u + du * pitch) + across.y * (v + dv * pitch),
      });
      const here = spec.fade ? spec.fade(at0(0.5, 0.5)) : 1;
      if (random() > fill * Math.max(0, Math.min(1, here))) continue;
      // One of four quarter turns, so the grid never shows through.
      const turn = Math.floor(random() * 4) % 4;
      const at = (du: number, dv: number): Vec2 => {
        const su = u + inset + du * side;
        const sv = v + inset + dv * side;
        return {
          x: field[0].x + along.x * su + across.x * sv,
          y: field[0].y + along.y * su + across.y * sv,
        };
      };
      // The right-angle corner walks round the square as the shard turns.
      const square: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
      const corner = square[turn];
      const first = square[(turn + 1) % 4];
      const second = square[(turn + 3) % 4];
      const shard: Triangle2 = [at(...corner), at(...first), at(...second)];
      // A grid square that hangs off the edge of the facet is not a dropped
      // cell, it is a square the field does not reach — `dropped` means the
      // cutter could not make it, and saying otherwise sends the shop looking
      // for a smaller mill it does not need.
      if (shard.some((point) => !insideTriangle(field, point))) continue;
      const contour = filletPolygon(shard, spec.tool / 2);
      cells.push(contour);
      area += Math.abs(polygonArea(contour));
    }
  }

  return { cells, dropped, area };
}

/** Is a point inside a triangle, whichever way round the triangle was written? */
function insideTriangle(tri: Triangle2, point: Vec2): boolean {
  const orientation = Math.sign(polygonArea(tri)) || 1;
  for (let i = 0; i < 3; i += 1) {
    const a = tri[i];
    const b = tri[(i + 1) % 3];
    if (((b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)) * orientation < 0) return false;
  }
  return true;
}

/**
 * A regular field of holes — rows of equal discs, staggered row to row.
 *
 * The plainest perforation there is, and the one that reads as manufacturing
 * rather than as decoration: a folded panel will often carry shards on the
 * faces that catch the light and this on the ones that do not, so that the eye
 * has somewhere to rest. The stagger is what keeps it from looking like graph
 * paper, and it is the same packing a perforating press would use.
 *
 * The grid is set out in the facet's own frame, so it stays square to the pot
 * rather than to the cutting sheet, and any hole that would break the border is
 * simply not drawn — the field runs off the edge of the facet the way a real
 * one runs off the edge of a sheet.
 */
export function gridFacet(tri: Triangle2, spec: PerforationSpec): PerforationResult {
  const field = shrinkTriangle(tri, spec.margin);
  if (!field) return { cells: [], dropped: 0, area: 0 };

  const room = triangleInradius(field);
  const pitch = (room * 2) / (Math.max(1, Math.round(spec.density)) + 1);
  // Area of one disc over the area of the rhombus it sits in, solved for the
  // radius that removes the share asked for.
  const spacing = pitch * Math.sqrt(3) / 2;
  const radius = Math.sqrt((Math.max(0, Math.min(1, spec.opening)) * pitch * spacing) / Math.PI);
  const capped = Math.min(radius, (pitch - spec.web) / 2, (spacing - spec.web) / 2);
  if (capped < spec.tool / 2) {
    // Every hole in the field would be one the mill cannot make. That is the
    // cutter's doing, so it is reported as such.
    return { cells: [], dropped: 1, area: 0 };
  }

  const along = unit(sub(field[1], field[0]));
  const across = { x: -along.y, y: along.x };
  const reach = field.map((corner) => ({
    u: (corner.x - field[0].x) * along.x + (corner.y - field[0].y) * along.y,
    v: (corner.x - field[0].x) * across.x + (corner.y - field[0].y) * across.y,
  }));
  const lowU = Math.min(...reach.map((r) => r.u));
  const highU = Math.max(...reach.map((r) => r.u));
  const lowV = Math.min(...reach.map((r) => r.v));
  const highV = Math.max(...reach.map((r) => r.v));

  const cells: Vec2[][] = [];
  let area = 0;
  const dropped = 0;
  let row = 0;

  for (let v = lowV; v <= highV; v += spacing, row += 1) {
    // Half a pitch across on alternate rows: hexagonal packing, which is both
    // denser and less mechanical-looking than a square one.
    for (let u = lowU + (row % 2 ? pitch / 2 : 0); u <= highU; u += pitch) {
      const centre = {
        x: field[0].x + along.x * u + across.x * v,
        y: field[0].y + along.y * u + across.y * v,
      };
      // Off the edge of the facet, or faded out — neither is the cutter's doing.
      if (!insideTriangle(field, centre) || toEdges(field, centre) < capped) continue;
      if (spec.fade && spec.fade(centre) < 0.5) continue;
      cells.push(circleContour(centre, capped * 2));
      area += Math.PI * capped * capped;
    }
  }

  return { cells, dropped, area };
}

/**
 * Round the interior corners of an OPEN path. The ends are left alone: they are
 * where the cut runs out into the hinge, and a radius there would leave a nib.
 */
function filletOpen(points: Vec2[], radius: number): Vec2[] {
  if (radius <= EPSILON || points.length < 3) return points.slice();
  // filletPolygon rounds every corner of a closed ring. Closing the path
  // temporarily and dropping the two corners that closing invented gives the
  // same arcs on the interior corners without writing the arc maths out twice.
  const closed = filletPolygon(points, radius);
  const first = points[0];
  const last = points[points.length - 1];
  const keep = closed.filter((point) => dist(point, first) > EPSILON && dist(point, last) > EPSILON);
  return [first, ...keep, last];
}

/**
 * Cut and fold — a fan of petals that bend out of the wall instead of dropping
 * out of it.
 *
 * Every other family here takes material away. This one takes none: each petal
 * is severed along its two radial edges and left attached along its outer one,
 * so it hinges outward and leaves its own shape as an opening behind it. The
 * sheet weighs the same afterwards, the aperture is real, and the folded petal
 * catches raking light on a face the flat wall does not have — which is the
 * whole reason the trade cuts panels this way.
 *
 * The fan runs from the facet's incentre out to its edges, so the petals point
 * the way the facet does and the pattern turns with the pot rather than sitting
 * on it. `density` sets how many petals each of the three edges carries.
 */
export function foldFacet(tri: Triangle2, spec: PerforationSpec): PerforationResult {
  const field = shrinkTriangle(tri, spec.margin);
  if (!field) return { cells: [], flaps: [], dropped: 0, area: 0 };

  const perEdge = Math.max(1, Math.round(spec.density));
  const centre = incentre(field);
  const radius = spec.tool / 2;

  // Walk the field's perimeter, dividing each edge into `perEdge` steps.
  const rim: Vec2[] = [];
  for (let e = 0; e < 3; e += 1) {
    const from = field[e];
    const to = field[(e + 1) % 3];
    for (let i = 0; i < perEdge; i += 1) {
      rim.push({
        x: from.x + (to.x - from.x) * (i / perEdge),
        y: from.y + (to.y - from.y) * (i / perEdge),
      });
    }
  }

  const flaps: Triangle2[] = [];
  let area = 0;
  let dropped = 0;

  for (let i = 0; i < rim.length; i += 1) {
    const wedge: Triangle2 = [rim[i], rim[(i + 1) % rim.length], centre];
    // Pulled in by the opening the same way a lattice cell is, and never by
    // less than half a web — two petals share a radial cut, and without the web
    // that cut would be one slit serving both of them.
    const room = triangleInradius(wedge);
    const shrunk = shrinkTriangle(
      wedge,
      Math.max(spec.web / 2, room * (1 - Math.sqrt(Math.max(0, Math.min(1, spec.opening))))),
    );
    // A petal the cutter cannot get round is not a petal.
    if (!shrunk || triangleInradius(shrunk) <= radius) {
      dropped += 1;
      continue;
    }
    if (spec.fade && spec.fade(centreOf(shrunk)) < 0.5) continue;
    flaps.push(shrunk);
    area += Math.abs(polygonArea(shrunk));
  }

  return { cells: [], flaps, dropped, area };
}

/**
 * The cut a flap needs: an open path from one end of its hinge, round its tip,
 * to the other end. The tip is rounded to the cutter, because that is what the
 * mill leaves there whatever the drawing says.
 */
export const flapSlit = (flap: Triangle2, tool: number): Vec2[] =>
  filletOpen([flap[0], flap[2], flap[1]], tool / 2);

/**
 * A rounded rectangle, `width` across `along` and `length` across it, centred on
 * `centre`. This is the window the solar panel shows through, so it is milled
 * and takes the same corner radius everything else milled here takes.
 */
export function roundedRect(centre: Vec2, along: Vec2, width: number, length: number, radius: number): Vec2[] {
  const u = unit(along);
  const v = { x: -u.y, y: u.x };
  const halfWidth = width / 2;
  const halfLength = length / 2;
  const corner = (sw: number, sl: number): Vec2 => ({
    x: centre.x + u.x * halfWidth * sw + v.x * halfLength * sl,
    y: centre.y + u.y * halfWidth * sw + v.y * halfLength * sl,
  });
  return filletPolygon(
    [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)],
    Math.min(radius, halfWidth, halfLength),
  );
}

/** A circle written as a polygon, fine enough that the cutter follows a circle. */
export function circleContour(centre: Vec2, diameter: number): Vec2[] {
  const radius = Math.max(EPSILON, diameter / 2);
  const steps = Math.max(12, arcSteps(radius, TAU));
  return Array.from({ length: steps }, (_, i) => ({
    x: centre.x + Math.cos((i / steps) * TAU) * radius,
    y: centre.y + Math.sin((i / steps) * TAU) * radius,
  }));
}

/**
 * Drain holes, on a ring inside a plate. Soil that cannot drain drowns the
 * plant, and water that cannot leave the pot ends up in the light cavity — so
 * both floors get these, and they sit on a ring rather than at the centre so
 * the liner's and the base plate's do not have to line up to work.
 */
export function drainRing(centre: Vec2, spread: number, count: number, diameter: number): Vec2[][] {
  if (spread <= diameter || count < 1) return [];
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * TAU;
    return circleContour(
      { x: centre.x + Math.cos(angle) * spread, y: centre.y + Math.sin(angle) * spread },
      diameter,
    );
  });
}

/**
 * Where `point` sits in `tri`, as the three weights that rebuild it from the
 * corners. A facet is rigid, so the same three weights rebuild the point from
 * the facet's corners at any stage of the fold — which is how a pattern laid
 * out on the flat net is carried onto the folded pot in the preview without
 * being laid out twice.
 */
export function barycentric(tri: Triangle2, point: Vec2): [number, number, number] {
  const v0 = sub(tri[1], tri[0]);
  const v1 = sub(tri[2], tri[0]);
  const v2 = sub(point, tri[0]);
  const denominator = v0.x * v1.y - v1.x * v0.y;
  if (Math.abs(denominator) < EPSILON) return [1, 0, 0];
  const b = (v2.x * v1.y - v1.x * v2.y) / denominator;
  const c = (v0.x * v2.y - v2.x * v0.y) / denominator;
  return [1 - b - c, b, c];
}
