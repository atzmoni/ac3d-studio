import { describe, expect, it } from 'vitest';
import {
  buildPlanterDxf, buildPlanterModel, buildPlanterPrintSvg, buildPlanterSvg, DEFAULT_PLANTER,
  getPlanterChecks, getPlanterStats, litPlanter, normalizePlanter, planterVolumeLitres,
} from './planter-engine';
import {
  CUSTOM_PALETTE, DEFAULT_GROUT, DEFAULT_PRINT_COLOURS, MAX_GROUT, MAX_PRINT_TONES,
  PRINT_PALETTES, PRINT_RULES,
} from './planter-print';
import { BLANK_PLANTER, PLANTER_CATEGORIES, PLANTER_PRESETS, PLANTER_STYLES } from './planter-styles';
import { getLedEffect, LED_EFFECTS } from './planter-led-effects';
import { flapSlit } from './planter-perforation';
import { MAX_COAT_MM, STONE_MATERIALS, STONE_SEALS } from './planter-stone';
import { checksHe, STONE_HE } from './planter-i18n-he';
import { getMaterial } from './pattern-engine';
import type { PlanterModel, PlanterParameters, PlanterPiece, Vec2 } from './types';

const build = (overrides: Partial<PlanterParameters> = {}) => buildPlanterModel({ ...DEFAULT_PLANTER, ...overrides });
const everyPreset = [...PLANTER_PRESETS, BLANK_PLANTER];

/** Narrower span across a piece's opening (mm). */
const openingWidth = (piece: PlanterPiece) => {
  const hole = piece.holes[0] ?? [];
  const xs = hole.map((point) => point.x);
  const ys = hole.map((point) => point.y);
  return Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
};

const polygonAreaOf = (points: Vec2[]) => Math.abs(points.reduce((sum, point, i) => {
  const next = points[(i + 1) % points.length];
  return sum + (point.x * next.y - next.x * point.y);
}, 0) / 2);

/**
 * How far a tab's outer edge is cut back from the end of the fold it hinges on.
 * The tab is written as the fold's start, then its two outer corners, so the
 * outline point after the fold's start is the corner the cut-back moved.
 */
const tabEndSetback = (piece: PlanterPiece, fold: { x1: number; y1: number; x2: number; y2: number }) => {
  const a = { x: fold.x1, y: fold.y1 };
  const span = Math.hypot(fold.x2 - a.x, fold.y2 - a.y) || 1;
  const dx = (fold.x2 - a.x) / span;
  const dy = (fold.y2 - a.y) / span;
  const start = piece.outline.findIndex((point) => Math.hypot(point.x - a.x, point.y - a.y) < 1e-6);
  if (start < 0) return Number.NaN;
  const corner = piece.outline[(start + 1) % piece.outline.length];
  return (corner.x - a.x) * dx + (corner.y - a.y) * dy;
};

/**
 * How far each edge of the hole sits off the edge it was stepped in from. The
 * inset keeps the vertex order, so hole edge i answers to outline edge i.
 */
const edgeDistances = (outline: Vec2[], hole: Vec2[]) => hole.map((point, i) => {
  const next = hole[(i + 1) % hole.length];
  const mid = { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 };
  const a = outline[i];
  const b = outline[(i + 1) % outline.length];
  const span = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return Math.abs((b.x - a.x) * (a.y - mid.y) - (a.x - mid.x) * (b.y - a.y)) / span;
});

/** Largest gap between a developed edge and the 3D edge it came from (mm). */
function isometryError(model: PlanterModel): number {
  const { sides, rows } = model.parameters;
  const stride = sides + 1;
  const solid = (id: number) => model.vertices[Math.floor(id / stride)][id % stride];
  const flat = (band: number, id: number) => model.flatByBand[band][Math.floor(id / stride) - band][id % stride];
  let worst = 0;
  for (let band = 0; band < rows; band += 1) {
    for (let t = 0; t < sides * 2; t += 1) {
      const [a, b, c] = model.triangles[band * sides * 2 + t].v;
      for (const [p, q] of [[a, b], [b, c], [c, a]]) {
        const there = Math.hypot(solid(p).x - solid(q).x, solid(p).y - solid(q).y, solid(p).z - solid(q).z);
        const here = Math.hypot(flat(band, p).x - flat(band, q).x, flat(band, p).y - flat(band, q).y);
        worst = Math.max(worst, Math.abs(there - here));
      }
    }
  }
  return worst;
}

const allPoints = (model: PlanterModel): Vec2[] => model.flatByBand.flat(2);

describe('planter registry', () => {
  it('exposes six wall styles and a preset for every one of them', () => {
    expect(PLANTER_STYLES).toHaveLength(6);
    const used = new Set(PLANTER_PRESETS.map((preset) => preset.parameters.style));
    expect(used).toEqual(new Set(PLANTER_STYLES.map((style) => style.id)));
  });

  it('files every preset under a category the library rail offers', () => {
    const offered = new Set(PLANTER_CATEGORIES.map((category) => category.id));
    for (const preset of everyPreset) expect(offered.has(preset.category)).toBe(true);
    // Every rail tab has to lead somewhere, or it reads as a dead control.
    for (const category of PLANTER_CATEGORIES) {
      if (category.id === 'all') continue;
      expect(PLANTER_PRESETS.some((preset) => preset.category === category.id)).toBe(true);
    }
  });

  it('gives every preset a unique id', () => {
    const ids = everyPreset.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('builds every preset into finite geometry with a base and a collar', () => {
    for (const preset of everyPreset) {
      const model = build(preset.parameters);
      const ids = model.pieces.map((piece) => piece.id);
      expect(ids).toContain('base');
      expect(ids).toContain('rim');
      expect(ids.filter((id) => id === 'wall' || id.startsWith('band-'))).toHaveLength(
        preset.parameters.construction === 'banded' ? model.parameters.rows : 1,
      );
      for (const piece of model.pieces) {
        expect(piece.outline.length).toBeGreaterThan(2);
        expect(piece.width).toBeGreaterThan(0);
        expect(piece.height).toBeGreaterThan(0);
        expect(piece.outline.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
      }
      expect(Number.isFinite(model.maxBend)).toBe(true);
    }
  });
});

describe('development', () => {
  // These three families are genuinely developable, so the net must come off the
  // solid with no stretch at all — anything else is a bug in the unfolder, not a
  // property of the design.
  it.each([
    { name: 'straight prism', p: { style: 'prism', topDiameter: 360, bottomDiameter: 360, rows: 1, rhythm: 0 } },
    { name: 'tapered frustum', p: { style: 'prism', topDiameter: 400, bottomDiameter: 260, rows: 3, rhythm: 0 } },
    { name: 'staggered cylinder', p: { style: 'crystal', topDiameter: 360, bottomDiameter: 360, rows: 4, rhythm: 0 } },
  ])('$name unfolds from one blank as an exact isometry', ({ p }) => {
    const model = build(p as Partial<PlanterParameters>);
    expect(isometryError(model)).toBeLessThan(1e-6);
    expect(model.developmentError).toBeLessThan(1e-6);
  });

  it('reports the stretch instead of hiding it when one blank cannot hold the shape', () => {
    const model = build({ style: 'crystal', topDiameter: 380, bottomDiameter: 320, rows: 4, bulge: 25 });
    expect(model.developmentError).toBeGreaterThan(0.8);
    expect(getPlanterChecks(model).map((check) => check.id)).toContain('development');
  });

  // A band is a chain of facets, never a loop, so it always flattens exactly —
  // which is what lets banded construction build a curved wall a blank cannot.
  it.each([
    { name: 'bulged', p: { bulge: 28 } },
    { name: 'waisted', p: { bulge: -30 } },
    { name: 'bulged and tapered', p: { bulge: 24, topDiameter: 420, bottomDiameter: 280 } },
    { name: 'bulged with a rhythm', p: { bulge: 20, style: 'diamond', rhythm: 34 } },
    { name: 'bulged rectangle', p: { bulge: 22, footprint: 'rectangle' } },
  ])('a banded build flattens exactly even when $name', ({ p }) => {
    const model = build({ construction: 'banded', rows: 4, ...(p as Partial<PlanterParameters>) });
    expect(isometryError(model)).toBeLessThan(1e-6);
    expect(model.developmentError).toBeLessThan(1e-6);
    expect(getPlanterChecks(model).map((check) => check.id)).not.toContain('development');
  });

  // The stock is rigid. A blank that does not develop is not a blank that needs
  // care on the bench — it is the wrong size for the pot, and cannot be folded
  // into it at all. So the split has to land on zero, not on "better".
  it.each([
    { name: 'bulged', p: { bulge: 28 } },
    { name: 'waisted', p: { bulge: -30 } },
    { name: 'bulged and tapered', p: { bulge: 24, topDiameter: 420, bottomDiameter: 280 } },
    { name: 'bulged with a rhythm', p: { bulge: 20, style: 'diamond', rhythm: 34 } },
    { name: 'bulged rectangle', p: { bulge: 22, footprint: 'rectangle' } },
    { name: 'tapered with a rhythm', p: { rhythm: 40, topDiameter: 420, bottomDiameter: 250 } },
  ])('a split build folds without stretching when $name', ({ p }) => {
    const over = { rows: 4, ...(p as Partial<PlanterParameters>) };
    expect(build({ construction: 'single-sheet', ...over }).developmentError).toBeGreaterThan(0.8);

    const model = build({ construction: 'split', ...over });
    expect(model.developmentError).toBeLessThanOrEqual(0.8);
    expect(getPlanterChecks(model).map((check) => check.id)).not.toContain('development');
  });

  it('cuts the wall only where the curvature is, never for the sake of it', () => {
    // A straight tapered prism develops as one blank, so a split must not invent
    // a rivet line: the same pot, the same single part, whichever mode is asked
    // for. Cutting a joint that carries nothing costs hardware and labour and
    // buys exactly nothing.
    const straight = { style: 'prism', rhythm: 0, twist: 0, bulge: 0, rows: 4 } as Partial<PlanterParameters>;
    expect(build({ ...straight, construction: 'split' }).parts).toEqual([{ from: 0, to: 3 }]);
    expect(build({ ...straight, construction: 'split' }).joints).toBe(0);
    expect(build({ ...straight, construction: 'banded' }).joints).toBe(3);

    // And on a wall that is curved, it is never worse than cutting every joint.
    for (const rows of [3, 4, 5, 6]) {
      const curved = { bulge: 20, rows } as Partial<PlanterParameters>;
      const split = build({ ...curved, construction: 'split' });
      expect(split.parts.length).toBeLessThanOrEqual(rows);
      // Every band belongs to exactly one part, in order, with no band missed.
      expect(split.parts[0].from).toBe(0);
      expect(split.parts[split.parts.length - 1].to).toBe(rows - 1);
      split.parts.forEach((part, i) => {
        expect(part.to).toBeGreaterThanOrEqual(part.from);
        if (i > 0) expect(part.from).toBe(split.parts[i - 1].to + 1);
      });
    }
  });

  it('draws the blank at the size the pot actually is', () => {
    // The wall's area is the material bought, and it is measured off the net. A
    // net that does not develop is smaller than the pot it claims to make, so a
    // stretched design under-quotes the stock — which is the defect the fold
    // preview shows as facets coming apart along lines that are only grooved.
    const over = { bulge: 20, rows: 4 } as Partial<PlanterParameters>;
    const area = (model: PlanterModel) => {
      const stride = model.parameters.sides + 1;
      const per = model.parameters.sides * 2;
      const flat = (band: number, id: number) => model.flatByBand[band][Math.floor(id / stride) - band][id % stride];
      const solid = (id: number) => model.vertices[Math.floor(id / stride)][id % stride];
      let net = 0;
      let built = 0;
      model.triangles.forEach((triangle, t) => {
        const band = Math.floor(t / per);
        const [a, b, c] = triangle.v.map((id) => flat(band, id));
        net += Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
        const [p, q, r] = triangle.v.map(solid);
        const u = { x: q.x - p.x, y: q.y - p.y, z: q.z - p.z };
        const v = { x: r.x - p.x, y: r.y - p.y, z: r.z - p.z };
        built += Math.hypot(
          u.y * v.z - u.z * v.y, u.z * v.x - u.x * v.z, u.x * v.y - u.y * v.x,
        ) / 2;
      });
      return { net, built };
    };

    // Relative, because that is how the error is spent: a percentage of the
    // stock ordered, not a fixed number of square millimetres.
    const stretched = area(build({ ...over, construction: 'single-sheet' }));
    expect(stretched.net / stretched.built).toBeLessThan(0.99);

    // A split still carries whatever mismatch DEVELOPMENT_TOLERANCE allows, so
    // this is not bit-exact — but a twentieth of a percent of the sheet is inside
    // the saw kerf, never mind the order.
    const split = area(build({ ...over, construction: 'split' }));
    expect(Math.abs(split.net / split.built - 1)).toBeLessThan(0.0005);
  });

  it('turns the ring creases of a banded build into rivet joints', () => {
    const banded = build({ construction: 'banded', rows: 4, bulge: 20 });
    expect(banded.joints).toBe(3);
    expect(build({ construction: 'single-sheet', rows: 4 }).joints).toBe(0);
    // One tab per segment per joint, plus a seam tab per band. The collar tab
    // on the last band's mouth is a separate connection (`rim-`), not one of
    // these internal band-to-band joints.
    const tabs = banded.pieces.flatMap((piece) => piece.folds.filter((fold) => fold.id.startsWith('joint-')));
    expect(tabs).toHaveLength(banded.joints * banded.parameters.sides);
  });

  it('gives the base and the collar their own rivet tabs, distinct from the internal joints', () => {
    const banded = build({ construction: 'banded', rows: 4, bulge: 20 });
    const footTabs = banded.pieces[0].folds.filter((fold) => fold.id.startsWith('foot-'));
    const rimTabs = banded.pieces[banded.parameters.rows - 1].folds.filter((fold) => fold.id.startsWith('rim-'));
    expect(footTabs).toHaveLength(banded.parameters.sides);
    expect(rimTabs).toHaveLength(banded.parameters.sides);

    const single = build({ construction: 'single-sheet', rows: 3 });
    const singleFoot = single.pieces[0].folds.filter((fold) => fold.id.startsWith('foot-'));
    const singleMouth = single.pieces[0].folds.filter((fold) => fold.id.startsWith('mouth-'));
    expect(singleFoot).toHaveLength(single.parameters.sides);
    expect(singleMouth).toHaveLength(single.parameters.sides);
  });

  it('places every wall vertex — no holes left in the net', () => {
    for (const preset of everyPreset) {
      const model = build(preset.parameters);
      const points = allPoints(model);
      expect(points).toHaveLength(model.parameters.rows * 2 * (model.parameters.sides + 1));
      expect(points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
      // A collapsed net would still be "finite" — it has to have real width.
      const box = Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x));
      expect(box).toBeGreaterThan(10);
    }
  });
});

describe('footprint', () => {
  it('builds a rectangle to the width and length it was given', () => {
    const model = build({
      footprint: 'rectangle', style: 'prism', rows: 1, height: 500,
      topWidth: 400, topLength: 300, bottomWidth: 400, bottomLength: 300, twist: 0,
    });
    const mouth = model.vertices[model.parameters.rows];
    const width = Math.max(...mouth.map((v) => v.x)) - Math.min(...mouth.map((v) => v.x));
    const length = Math.max(...mouth.map((v) => v.y)) - Math.min(...mouth.map((v) => v.y));
    expect(width).toBeCloseTo(400, 6);
    expect(length).toBeCloseTo(300, 6);
    expect(model.parameters.sides).toBe(4);
  });

  it('holds a rectangle to four corners whatever the sides slider says', () => {
    expect(normalizePlanter({ ...DEFAULT_PLANTER, footprint: 'rectangle', sides: 9 }).sides).toBe(4);
    expect(normalizePlanter({ ...DEFAULT_PLANTER, footprint: 'polygon', sides: 9 }).sides).toBe(9);
  });

  it('gives a smooth box exactly four vertical creases and nothing else', () => {
    const model = build({
      footprint: 'rectangle', style: 'prism', rows: 1, twist: 0,
      topWidth: 400, topLength: 300, bottomWidth: 320, bottomLength: 240,
    });
    // Excludes the seam tab and the base/collar rivet tabs — this counts only
    // the geometric corner creases the wall's own facets produce.
    const creases = model.pieces[0].folds.filter((fold) => fold.id.startsWith('wall-'));
    expect(creases).toHaveLength(3); // the fourth corner is the cut seam
    expect(creases.every((fold) => fold.kind === 'mountain')).toBe(true);
    expect(model.developmentError).toBeLessThan(1e-6);
  });

  it('measures a straight box against its closed-form volume', () => {
    const model = build({
      footprint: 'rectangle', style: 'prism', rows: 1, height: 500, twist: 0,
      topWidth: 400, topLength: 300, bottomWidth: 400, bottomLength: 300,
    });
    // Measured inside the wall and off the floor, because that is where the soil
    // goes. On 4 mm stock a 400 x 300 box is 392 x 292 inside, and the base plate
    // takes the first 4 mm of the height.
    const t = model.solid.thickness;
    expect(planterVolumeLitres(model)).toBeCloseTo(((400 - 2 * t) * (300 - 2 * t) * (500 - t)) / 1_000_000, 6);
    // The old answer is still worked out, and still the larger of the two: it is
    // what a shell with no thickness would have claimed, and it is 5% out.
    expect(model.solid.surfaceLitres).toBeCloseTo((400 * 300 * 500) / 1_000_000, 6);
  });

  it('tapers width and length independently', () => {
    const model = build({
      footprint: 'rectangle', style: 'prism', rows: 1, twist: 0,
      topWidth: 400, topLength: 300, bottomWidth: 200, bottomLength: 300,
    });
    const foot = model.vertices[0];
    expect(Math.max(...foot.map((v) => v.x)) - Math.min(...foot.map((v) => v.x))).toBeCloseTo(200, 6);
    expect(Math.max(...foot.map((v) => v.y)) - Math.min(...foot.map((v) => v.y))).toBeCloseTo(300, 6);
  });
});

describe('fold geometry', () => {
  it('creases a straight prism exactly at the polygon exterior angle', () => {
    for (const sides of [4, 6, 8]) {
      const model = build({ style: 'prism', sides, topDiameter: 360, bottomDiameter: 360, rows: 1, twist: 0 });
      expect(model.maxBend).toBeCloseTo(360 / sides, 6);
    }
  });

  it('reads the corners of a convex pot as mountains', () => {
    const model = build({ style: 'prism', sides: 6, topDiameter: 360, bottomDiameter: 300, rows: 1, twist: 0 });
    const creases = model.pieces[0].folds.filter((fold) => fold.id.startsWith('wall-'));
    expect(creases.length).toBeGreaterThan(0);
    expect(creases.every((fold) => fold.kind === 'mountain')).toBe(true);
  });

  it('reads a staggered wall as both mountains and valleys', () => {
    const kinds = new Set(build({ style: 'diamond', rows: 4, rhythm: 30 }).pieces[0].folds.map((fold) => fold.kind));
    expect(kinds).toContain('mountain');
    expect(kinds).toContain('valley');
  });

  it('drops the facet diagonal when a quad is already flat, and keeps it once twisted', () => {
    const upright = build({ style: 'prism', sides: 6, rows: 1, twist: 0 });
    const twisted = build({ style: 'prism', sides: 6, rows: 1, twist: 30 });
    const creases = (model: PlanterModel) => model.pieces[0].folds.filter((fold) => fold.id.startsWith('wall-')).length;
    expect(creases(upright)).toBe(5); // the five interior corner edges, no diagonals
    expect(creases(twisted)).toBeGreaterThan(creases(upright));
  });
});

describe('pieces', () => {
  it('shrinks the base plate off the edge so it drops inside the wall', () => {
    const loose = build({ baseInset: 8 });
    const tight = build({ baseInset: 0 });
    const plate = (model: PlanterModel) => model.pieces.find((piece) => piece.id === 'base') as PlanterPiece;
    expect(plate(loose).width).toBeLessThan(plate(tight).width);
    // Inset is measured off the edge, so a box loses exactly twice it across.
    const box = (inset: number) => plate(build({ footprint: 'rectangle', baseInset: inset, bottomWidth: 400 })).width;
    expect(box(6) - box(16)).toBeCloseTo(20, 6);
  });

  it('opens the collar wider as the rim narrows', () => {
    const hole = (rimWidth: number) =>
      openingWidth(build({ rimWidth }).pieces.find((piece) => piece.id === 'rim') as PlanterPiece);
    expect(hole(30)).toBeGreaterThan(hole(90));
  });

  it('cuts the collar opening to the pot\'s own shape, not a circle', () => {
    // A hexagonal pot gets a hexagonal hole and a rectangular one a rectangular
    // hole, so the collar reads as one band of even width all the way round.
    for (const [footprint, corners] of [['polygon', 6], ['rectangle', 4]] as const) {
      const rim = build({ footprint, sides: 6 }).pieces.find((piece) => piece.id === 'rim') as PlanterPiece;
      expect(rim.holes).toHaveLength(1);
      expect(rim.holes[0]).toHaveLength(corners);
    }
  });

  it('keeps the collar band the same width the whole way round', () => {
    // The hole is the outline stepped in, so every edge of it sits the rim's
    // width off the matching edge outside — that is what makes it read as a band.
    const rim = build({ footprint: 'polygon', sides: 6, rimWidth: 60 }).pieces.find((piece) => piece.id === 'rim') as PlanterPiece;
    const band = edgeDistances(rim.outline, rim.holes[0]);
    expect(Math.max(...band) - Math.min(...band)).toBeLessThan(0.5);
    expect(Math.min(...band)).toBeCloseTo(60, 1);
  });

  it('leaves an opening however wide the rim is set', () => {
    for (const rimWidth of [0, 40, 200, 5000]) {
      const rim = build({ rimWidth }).pieces.find((piece) => piece.id === 'rim') as PlanterPiece;
      expect(rim.holes[0].length).toBeGreaterThan(2);
      expect(openingWidth(rim)).toBeGreaterThan(0);
      expect(polygonAreaOf(rim.holes[0])).toBeLessThan(Math.abs(polygonAreaOf(rim.outline)));
    }
  });

  it('mitres the tabs that fold into one plane so they meet instead of overlapping', () => {
    // Foot tabs all come down into the base plate's plane together. Two tabs on
    // adjacent edges of the ring want the same material at the corner between
    // them unless each is cut back by w*tan(pi/n) — 4 mm of relief is nowhere
    // near that on a hexagon, and the pair jams before either lies flat.
    for (const sides of [4, 6, 8]) {
      const model = build({ footprint: sides === 4 ? 'rectangle' : 'polygon', sides, baseTab: 18 });
      const wall = model.pieces.find((piece) => piece.id === 'wall') as PlanterPiece;
      const feet = wall.folds.filter((fold) => fold.id.startsWith('foot-'));
      expect(feet.length).toBeGreaterThan(0);
      const needed = 18 * Math.tan(Math.PI / model.parameters.sides);
      for (const fold of feet) {
        expect(tabEndSetback(wall, fold)).toBeGreaterThanOrEqual(needed - 0.01);
      }
    }
  });

  it('leaves an internal ring joint\'s tabs their full run', () => {
    // Those fold against the band above, each onto its own facet, so mitring
    // them back would only throw away rivet land for a clash that cannot happen.
    const model = build({ construction: 'banded', sides: 6, rows: 3, jointTab: 18 });
    const band = model.pieces.find((piece) => piece.id === 'band-0') as PlanterPiece;
    const joints = band.folds.filter((fold) => fold.id.startsWith('joint-'));
    expect(joints.length).toBeGreaterThan(0);
    for (const fold of joints) expect(tabEndSetback(band, fold)).toBeLessThan(18 * Math.tan(Math.PI / 6));
  });

  it('never mitres a tab away to nothing, however sharp the corner', () => {
    for (const [sides, baseTab] of [[3, 60], [4, 60], [12, 60]] as const) {
      const model = build({ sides, baseTab, footprint: 'polygon' });
      const wall = model.pieces.find((piece) => piece.id === 'wall') as PlanterPiece;
      for (const fold of wall.folds.filter((f) => f.id.startsWith('foot-'))) {
        expect(Math.hypot(fold.x2 - fold.x1, fold.y2 - fold.y1)).toBeGreaterThan(0);
        expect(tabEndSetback(wall, fold)).toBeLessThan(Math.hypot(fold.x2 - fold.x1, fold.y2 - fold.y1) / 2);
      }
    }
  });

  it('adds a seam tab that widens the net and carries a fold per band', () => {
    const tabbed = build({ tabWidth: 40, rows: 3 });
    const bare = build({ tabWidth: 0, rows: 3 });
    expect(tabbed.pieces[0].width).toBeGreaterThan(bare.pieces[0].width);
    expect(tabbed.pieces[0].folds.filter((fold) => fold.id.startsWith('tab-'))).toHaveLength(3);
    expect(bare.pieces[0].folds.filter((fold) => fold.id.startsWith('tab-'))).toHaveLength(0);
  });

  it('nests every preset without a single piece overlapping another', () => {
    const overlaps = (a: PlanterPiece, b: PlanterPiece) =>
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    for (const preset of everyPreset) {
      const { pieces, sheet } = build(preset.parameters);
      for (let i = 0; i < pieces.length; i += 1) {
        for (let j = i + 1; j < pieces.length; j += 1) expect(overlaps(pieces[i], pieces[j])).toBe(false);
        expect(pieces[i].x + pieces[i].width).toBeLessThanOrEqual(sheet.width + 1e-6);
        expect(pieces[i].y + pieces[i].height).toBeLessThanOrEqual(sheet.height + 1e-6);
      }
    }
  });

  it('keeps every stock design part within a single 1220 x 2440 sheet', () => {
    // A whole nested layout may spill onto extra sheets for a wide banded pot — that
    // is a material cost the `sheets` count reports honestly. No single cut part may
    // ever exceed the stock sheet, though, in either orientation.
    for (const preset of everyPreset) {
      const { pieces } = build(preset.parameters);
      for (const piece of pieces) {
        const fits = (piece.width <= 1220 && piece.height <= 2440) || (piece.width <= 2440 && piece.height <= 1220);
        expect(`${preset.name} ${piece.label}: ${Math.ceil(piece.width)} x ${Math.ceil(piece.height)} fits=${fits}`).toContain('fits=true');
      }
    }
  });

  it('reports more than one sheet exactly when the layout genuinely spills past one', () => {
    for (const preset of everyPreset) {
      const model = build(preset.parameters);
      const within = (model.sheet.width <= 1220 && model.sheet.height <= 2440)
        || (model.sheet.width <= 2440 && model.sheet.height <= 1220);
      expect(model.sheets).toBeGreaterThanOrEqual(1);
      // Both directions matter: a layout that fits must report 1, and — the bug this
      // guards against — a layout that does NOT fit must never be reported as 1 either.
      expect(`${preset.name}: within=${within} sheets=${model.sheets}`)
        .toBe(`${preset.name}: within=${within} sheets=${within ? 1 : model.sheets > 1 ? model.sheets : 'BUG:1'}`);
    }
  });

  it('develops every stock design flat enough to cut', () => {
    for (const preset of everyPreset) {
      const model = build(preset.parameters);
      expect(`${preset.name}: ${model.developmentError.toFixed(2)} mm`).toMatch(/: 0\.[0-7]\d mm$/);
    }
  });
});

describe('reporting', () => {
  it('measures a hexagonal prism against the closed-form volume', () => {
    const model = build({ style: 'prism', sides: 6, topDiameter: 400, bottomDiameter: 400, height: 500, rows: 1 });
    // A regular hexagon of circumradius r has area 3√3/2 · r². The inside of the
    // wall is not r - t: offsetting two facets that meet at a 120° corner puts
    // the inside corner back by the mitre, t / cos(30°), which is 15% further.
    const t = model.solid.thickness;
    const area = (r: number) => ((3 * Math.sqrt(3)) / 2) * r * r;
    expect(planterVolumeLitres(model)).toBeCloseTo((area(200 - t / Math.cos(Math.PI / 6)) * (500 - t)) / 1_000_000, 6);
    expect(model.solid.surfaceLitres).toBeCloseTo((area(200) * 500) / 1_000_000, 6);
  });

  it('counts two facets per side per band, and the parts on the sheet', () => {
    expect(getPlanterStats(build({ sides: 6, rows: 3 })).facets).toBe(36);
    expect(getPlanterStats(build({ rows: 4, construction: 'single-sheet' })).pieces).toBe(3);
    expect(getPlanterStats(build({ rows: 4, construction: 'banded' })).pieces).toBe(6);
  });

  it('flags a net that will not fit the stock sheet', () => {
    const model = build({ topDiameter: 900, bottomDiameter: 800, height: 1400, sheetWidth: 600, sheetHeight: 600 });
    expect(getPlanterChecks(model).find((check) => check.id === 'sheet-fit')?.severity).toBe('error');
  });

  it('flags a collar that would close over the planting hole', () => {
    expect(getPlanterChecks(build({ topDiameter: 300, rimWidth: 140 })).map((check) => check.id)).toContain('rim-width');
  });

  it('flags rivet tabs too short to land a rivet clear of the fold', () => {
    const ids = getPlanterChecks(build({ construction: 'banded', rows: 3, jointTab: 8 })).map((check) => check.id);
    expect(ids).toContain('joint-tab');
    expect(getPlanterChecks(build({ construction: 'banded', rows: 3, jointTab: 25 })).map((c) => c.id)).not.toContain('joint-tab');
  });

  // A V-groove shuts on itself after turning through exactly its own included
  // angle. So the bit is not a setting beside the fold — it IS the fold, and a
  // mismatch is a corner with no mechanical stop in it.
  it('says when the fitted bit cannot close the folds it is given', () => {
    // A square box folds 90° at every corner. Fit the 120° bit a sign shop
    // already owns and the groove bottoms out with 30° still to go.
    const wide = getPlanterChecks(build({ footprint: 'rectangle', style: 'prism', rows: 1, vBitAngle: 120 }));
    const check = wide.find((one) => one.id === 'v-bit');
    expect(check?.severity).toBe('warning');
    expect(check?.detail).toContain('90');
    expect(check?.detail).toContain('120');
  });

  it('tells a bit that cannot reach from one that will not close', () => {
    // Different failures and different fixes, so they must not read alike. Too
    // wide leaves the corner soft; too narrow cannot make the angle at all, and
    // that is a part which does not exist rather than one which is springy.
    const narrow = getPlanterChecks(build({ footprint: 'rectangle', style: 'prism', rows: 1, vBitAngle: 45 }))
      .find((one) => one.id === 'v-bit');
    expect(narrow?.severity).toBe('error');
    const wide = getPlanterChecks(build({ footprint: 'rectangle', style: 'prism', rows: 1, vBitAngle: 120 }))
      .find((one) => one.id === 'v-bit');
    expect(wide?.severity).toBe('warning');
    expect(narrow?.title).not.toBe(wide?.title);
  });

  it('never complains about the bit when every crease gets its own', () => {
    // Which is the point of the auto bit, and why it is the default: the drawing
    // carries the angle line by line instead of one bit having to suit them all.
    for (const overrides of [{}, { sides: 6, rows: 3 }, { footprint: 'rectangle' as const }, { sides: 12, rows: 4 }]) {
      const ids = getPlanterChecks(build({ ...overrides, vBitAngle: 0 })).map((one) => one.id);
      expect(ids).not.toContain('v-bit');
    }
  });

  it('never talks about bits at all for stock that is bent hot', () => {
    const ids = getPlanterChecks(build({ material: 'acrylic-3', footprint: 'rectangle', rows: 1, vBitAngle: 120 }))
      .map((one) => one.id);
    expect(ids).not.toContain('v-bit');
    expect(ids).not.toContain('groove-width');
    expect(ids).toContain('heat-bend');
  });

  it('says when the groove is too wide for the facets it is cut into', () => {
    // Twelve sides and five bands makes facets a fraction of a box's, and a 135°
    // bit on 4 mm stock cuts a 13.5 mm groove. Little flat face survives that.
    const crowded = build({ sides: 12, rows: 5, topDiameter: 260, bottomDiameter: 220, vBitAngle: 135 });
    expect(getPlanterChecks(crowded).map((one) => one.id)).toContain('groove-width');
    const roomy = build({ sides: 4, rows: 1, vBitAngle: 45 });
    expect(getPlanterChecks(roomy).map((one) => one.id)).not.toContain('groove-width');
  });

  it('cuts the groove to the stock, never through the hinge', () => {
    for (const material of ['acp-4', 'acp-3', 'steel-2', 'cardboard-2'] as const) {
      const model = build({ material });
      // Depth plus skin is the sheet: the bit stops at the hinge, and the hinge
      // is what makes this one folded panel rather than two riveted ones.
      expect(model.groove.depth + model.groove.skin).toBeCloseTo(model.material.thickness, 9);
      expect(model.groove.skin).toBeGreaterThan(0);
    }
  });

  it('opens the groove wider as the bit gets blunter', () => {
    const at = (bit: number) => build({ vBitAngle: bit }).groove.width;
    expect(at(45)).toBeLessThan(at(90));
    expect(at(90)).toBeLessThan(at(135));
    // 2 · depth · tan(half the bit) — the cut is a V, so the width is the depth
    // opened out by the angle and nothing else.
    const model = build({ vBitAngle: 90 });
    expect(model.groove.width).toBeCloseTo(2 * model.groove.depth * Math.tan(Math.PI / 4), 9);
  });

  it('clears a stock design outright', () => {
    const model = build({ style: 'prism', sides: 6, topDiameter: 400, bottomDiameter: 340, height: 500, rows: 1 });
    expect(getPlanterChecks(model)).toEqual([expect.objectContaining({ id: 'ready', severity: 'info' })]);
  });

  it('gives every check enough detail to act on', () => {
    for (const preset of everyPreset) {
      for (const check of getPlanterChecks(build(preset.parameters))) {
        expect(check.detail.length).toBeGreaterThan(20);
      }
    }
  });
});

describe('output', () => {
  it('writes millimetre-true SVG carrying the fold notation', () => {
    const model = build();
    const svg = buildPlanterSvg(model, 'Diamond Relief');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toMatch(/width="[\d.]+mm" height="[\d.]+mm"/);
    expect(svg).toContain('Solid = mountain');
    // One closed contour per piece, plus one more for the collar's opening.
    expect((svg.match(/<polygon /g) ?? []).length).toBe(model.pieces.length + 1);
  });

  it('says in the file which way the pot is built', () => {
    const banded = buildPlanterSvg(build({ construction: 'banded', rows: 4 }), 'Crystal');
    expect(banded).toContain('3 riveted ring joints');
    // The drawing has to say which lines the cutter parts and which it only
    // grooves: on a wall in parts those are different rings, and nothing in the
    // geometry alone tells them apart.
    expect(banded).toContain('groove it, do not cut it');
    expect(buildPlanterSvg(build({ construction: 'single-sheet' }), 'Crystal')).toContain('One wall blank');
  });

  it('writes DXF R12 with a layer per fold kind', () => {
    // One bit fitted for the whole job, so every groove goes to the same tool
    // and the layer names are the ones a shop already has set up for it.
    const dxf = buildPlanterDxf(build({ vBitAngle: 90 }));
    for (const layer of ['CUT', 'MOUNTAIN', 'VALLEY']) expect(dxf).toContain(`\n${layer}\n`);
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true);
    expect(dxf).not.toMatch(/NaN|Infinity/);
  });

  it('names the bit on every groove when each crease needs its own', () => {
    // A groove shuts after turning through its own included angle, so a drawing
    // that says 'fold here' without saying how far cannot be machined: nothing
    // tells the operator which of forty lines wants which tool.
    const model = build({ vBitAngle: 0, sides: 6, rows: 3 });
    const dxf = buildPlanterDxf(model);
    const layers = [...new Set([...dxf.matchAll(/\n(MOUNTAIN|VALLEY)-(\d+)\n/g)].map(([, kind, deg]) => `${kind}-${deg}`))];
    expect(layers.length).toBeGreaterThan(0);
    expect(dxf).not.toMatch(/\n(MOUNTAIN|VALLEY)\n/);

    // And the angle on the layer is the angle of a fold that is really there,
    // to the nearest step a bit is ground to.
    const bends = model.pieces.flatMap((piece) => piece.folds)
      .filter((fold) => fold.kind !== 'cut' && fold.bend !== undefined)
      .map((fold) => Math.max(5, Math.round((fold.bend as number) / 5) * 5));
    for (const layer of layers) expect(bends).toContain(Number(layer.split('-')[1]));

    // Every layer the table declares carries something. A declared layer with
    // nothing on it is a tool an operator sets up for no reason.
    const declared = [...dxf.matchAll(/\nLAYER\n2\n([A-Z0-9-]+)\n/g)].map(([, name]) => name);
    for (const name of declared) expect(dxf).toContain(`\nVERTEX\n8\n${name}\n`);
  });

  it('will not chain two creases that want different tools into one groove', () => {
    // Joined up, the run would be grooved in a single pass at whichever angle was
    // read first — so the split by tool has to happen before the lines are chained.
    const dxf = buildPlanterDxf(build({ vBitAngle: 0, sides: 6, rows: 3, rhythm: 55 }));
    const blocks = dxf.split('\nPOLYLINE\n8\n').slice(1);
    expect(blocks.length).toBeGreaterThan(3);
    for (const block of blocks) {
      const layer = block.slice(0, block.indexOf('\n'));
      for (const [, on] of block.matchAll(/\nVERTEX\n8\n([A-Z0-9-]+)\n/g)) expect(on).toBe(layer);
    }
  });

  // The board lies on the bed decorative side DOWN, because the V-groove is cut
  // through the back skin. Send the outside view to that machine and every part
  // comes off handed the wrong way — and on a composite panel that is scrap.
  it('lays the cut file out for the face the cutter actually sees', () => {
    // Twisted, so the pot has a hand and the mirror is not a no-op.
    const model = build({ twist: 40, rows: 3 });
    const xs = (dxf: string) => [...dxf.matchAll(/VERTEX\n8\n\w+\n10\n([-\d.]+)\n/g)].map(([, x]) => Number(x));

    const groove = xs(buildPlanterDxf(model, 'groove'));
    const outside = xs(buildPlanterDxf(model, 'outside'));
    expect(groove).toHaveLength(outside.length);
    expect(groove).not.toEqual(outside);
    // Reflected about the nest's own edge, point for point and in order. The
    // file writes millimetres to three places and both sides of the comparison
    // are rounded, so two of those roundings is the honest tolerance.
    groove.forEach((x, i) => {
      expect(Math.abs(x - (model.sheet.width - outside[i]))).toBeLessThan(0.002);
    });
    // Which means it is still the same nest on the same stock, not one shifted
    // off the sheet: a mirror that needed a bigger board would be no use.
    expect(Math.min(...groove)).toBeGreaterThanOrEqual(-0.002);
    expect(Math.max(...groove)).toBeLessThanOrEqual(model.sheet.width + 0.002);

    // Mirroring twice is the identity, so nothing is quietly lost in the round trip.
    expect(buildPlanterDxf(model, 'groove')).not.toEqual(buildPlanterDxf(model, 'outside'));
    // And the groove face is what you get without asking, because that is the
    // file the shop cuts.
    expect(buildPlanterDxf(model)).toEqual(buildPlanterDxf(model, 'groove'));
  });

  it('says on the drawing which way round it is, and never mirrors the print', () => {
    const model = build({ twist: 40, rows: 3, print: 'triangles', printPalette: 'carnival' });
    expect(buildPlanterSvg(model, 'Crystal', 'groove')).toContain('MIRRORED');
    expect(buildPlanterSvg(model, 'Crystal', 'outside')).toContain('NOT mirrored');
    // The ink goes on the face that shows, so the print layout is the outside
    // view whatever the cut file is doing — and it has to say so, because the
    // two files reach the shop together.
    expect(buildPlanterPrintSvg(model, 'Crystal')).toContain('NOT mirrored');
  });

  it('keeps part labels readable on the mirrored drawing', () => {
    const model = build({ twist: 40, rows: 3 });
    const svg = buildPlanterSvg(model, 'Crystal', 'groove');
    // Glyphs must not reflect — only the y-flip the whole drawing already has.
    for (const text of svg.match(/<text [^>]*>/g) ?? []) {
      expect(text).toContain('transform="scale(1,-1)"');
    }
    // And each label still sits on its own part rather than off the far edge.
    const labelXs = [...svg.matchAll(/<text x="([-\d.]+)"/g)].map(([, x]) => Number(x));
    expect(labelXs.length).toBe(model.pieces.length);
    for (const x of labelXs) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(model.sheet.width);
    }
  });

  it('writes every run as one entity instead of a line per segment', () => {
    // The reported case: a net exported segment by segment lands on the machine
    // as hundreds of separate curves, and the cutter lifts between every one.
    const dxf = buildPlanterDxf(build({ construction: 'single-sheet', sides: 6, rows: 3 }));
    expect(dxf).not.toContain('\nLINE\n');
    expect(dxf).toContain('\nPOLYLINE\n');
    const svg = buildPlanterSvg(build({ construction: 'single-sheet', sides: 6, rows: 3 }), 'Diamond Relief');
    expect(svg).not.toMatch(/<line /);
  });

  it('closes each part\'s outline in the file, not by hand afterwards', () => {
    const model = build();
    const dxf = buildPlanterDxf(model);
    // Bit 1 of group 70 is the closed flag; every piece contributes one outline.
    const closed = dxf.match(/\nPOLYLINE\n8\n[A-Z]+\n66\n1\n70\n1\n/g) ?? [];
    expect(closed.length).toBeGreaterThanOrEqual(model.pieces.length);
    expect(buildPlanterSvg(model, 'Diamond Relief')).toContain('<polygon');
  });

  it('never writes the same crease twice', () => {
    // Two facets both name the edge between them; grooving it twice burns the
    // cut twice and doubles the time the part is on the machine.
    const dxf = buildPlanterDxf(build({ construction: 'banded', sides: 8, rows: 4 }));
    const runs = [...dxf.matchAll(/\nPOLYLINE\n8\n(\w+)\n[\s\S]*?\nSEQEND\n/g)].map((match) => {
      const points = [...match[0].matchAll(/VERTEX\n8\n\w+\n10\n([-\d.]+)\n20\n([-\d.]+)\n/g)]
        .map(([, x, y]) => `${x},${y}`);
      return `${match[1]}|${points.join(' ')}`;
    });
    expect(new Set(runs).size).toBe(runs.length);
  });

  it('keeps every exported coordinate inside the nested sheet', () => {
    for (const preset of everyPreset) {
      const model = build(preset.parameters);
      for (const piece of model.pieces) {
        for (const point of piece.outline) {
          expect(piece.x + point.x).toBeLessThanOrEqual(model.sheet.width + 1e-6);
          expect(piece.y + point.y).toBeLessThanOrEqual(model.sheet.height + 1e-6);
        }
      }
    }
  });
});

describe('input handling', () => {
  it('clamps values a slider or a paste can produce', () => {
    const safe = normalizePlanter({
      ...DEFAULT_PLANTER,
      sides: 0.4, rows: 99, height: -500, rhythm: 900, twist: 900, assembly: 400,
      topDiameter: NaN, topWidth: NaN, sheetWidth: 0, jointTab: -900,
    });
    expect(safe.sides).toBe(3);
    expect(safe.rows).toBe(8);
    expect(safe.height).toBe(500);
    expect(safe.rhythm).toBe(60);
    expect(safe.twist).toBe(180);
    expect(safe.assembly).toBe(100);
    expect(safe.topDiameter).toBe(60);
    expect(safe.topWidth).toBe(60);
    expect(safe.sheetWidth).toBe(300);
    expect(safe.jointTab).toBe(120);
  });

  it('survives the degenerate corners without producing NaN geometry', () => {
    const corners: Partial<PlanterParameters>[] = [
      { sides: 3, rows: 1, tabWidth: 0 },
      { sides: 12, rows: 8, rhythm: 60 },
      { topDiameter: 60, bottomDiameter: 4000, height: 60 },
      { bulge: -45, twist: -180 },
      { construction: 'banded', rows: 1, jointTab: 0 },
      { construction: 'banded', rows: 8, bulge: 60, tabWidth: 0, jointTab: 0 },
      { footprint: 'rectangle', topWidth: 60, topLength: 4000, bottomWidth: 4000, bottomLength: 60 },
      { footprint: 'rectangle', construction: 'banded', rows: 6, bulge: -45, twist: 180 },
    ];
    for (const corner of corners) {
      const model = build(corner);
      expect(allPoints(model).every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
      expect(buildPlanterDxf(model)).not.toMatch(/NaN/);
      expect(Number.isFinite(model.sheet.width) && model.sheet.width > 0).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Lighting
// ---------------------------------------------------------------------------

/** A pot with the whole lighting kit on it, sized so every part of it fits. */
const LIT: Partial<PlanterParameters> = {
  style: 'crystal', sides: 6, topDiameter: 380, bottomDiameter: 320, height: 520, rows: 3,
  perforation: 'triangles', perfDensity: 2, perfSkirt: 90, rimWidth: 95,
  liner: true, cavity: 22, solar: true,
};

/** A pot with facets big enough that a fine pattern still has room in them. */
const BIG: Partial<PlanterParameters> = {
  ...LIT, topDiameter: 600, bottomDiameter: 540, height: 800, rows: 4, rimWidth: 110,
};

const wallPieces = (model: PlanterModel) => model.pieces.filter(
  (piece) => piece.id === 'wall' || piece.id.startsWith('band-'),
);

/** Distance from `point` to the segment a→b. */
function toSegment(point: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const span = dx * dx + dy * dy;
  const t = span <= 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / span));
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

const toRing = (point: Vec2, ring: Vec2[]) => ring.reduce(
  (nearest, a, i) => Math.min(nearest, toSegment(point, a, ring[(i + 1) % ring.length])),
  Infinity,
);

/**
 * Is `point` inside a closed contour? Ray casting rather than a half-plane
 * test, because a wall net's outline is anything but convex — it is a zigzag of
 * fold-in tabs down two of its edges, and a convexity test would call the
 * material between them outside.
 */
function insideRing(point: Vec2, ring: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

describe('perforated wall', () => {
  it('changes nothing at all when it is switched off', () => {
    const model = build();
    expect(model.perfCells).toEqual([]);
    expect(model.perfDropped).toBe(0);
    expect(model.perfOpenArea).toBe(0);
    expect(model.liner).toBeNull();
    for (const piece of model.pieces) {
      if (piece.id !== 'rim') expect(piece.holes).toEqual([]);
    }
    expect(model.pieces.map((piece) => piece.id)).toEqual(['wall', 'base', 'rim']);
  });

  it('cuts out of the wall and nothing else', () => {
    const model = build(LIT);
    const cut = model.pieces.filter((piece) => piece.holes.length > 0).map((piece) => piece.id);
    // The collar's two are the planting hole and the panel window; the two
    // floors' are drains. Nothing is cut into the liner's wall — it is the
    // barrier, and a barrier with holes in it is not one.
    expect(cut.sort()).toEqual(['base', 'liner-base', 'rim', 'wall']);
    expect(wallPieces(model)[0].holes.length).toBeGreaterThan(0);
    expect(model.pieces.find((piece) => piece.id === 'liner-wall')?.holes).toEqual([]);
  });

  it('keeps every cut-out inside its own piece and clear of every crease', () => {
    // The one property that has to hold or the part is scrap: a hole that
    // crosses a fold is a fold that tears, and one that crosses the outline is
    // a part that falls in two on the bed.
    const cases: Partial<PlanterParameters>[] = [
      LIT,
      { ...LIT, construction: 'banded', bulge: 18 },
      // A fine fretwork on a big pot: small cells, thin webs, a small cutter.
      {
        ...LIT, topDiameter: 520, bottomDiameter: 460, height: 700,
        perfDensity: 5, perfWeb: 4, perfMargin: 14, perfTool: 3,
      },
      { ...LIT, footprint: 'rectangle', topWidth: 480, topLength: 340, bottomWidth: 420, bottomLength: 280 },
    ];
    for (const overrides of cases) {
      const model = build(overrides);
      const margin = model.parameters.perfMargin;
      // Per model, not per piece: a band that sits entirely under the skirt
      // rightly comes off the sheet with no cut-outs at all.
      expect(wallPieces(model).reduce((count, piece) => count + piece.holes.length, 0)).toBeGreaterThan(0);
      for (const piece of wallPieces(model)) {
        for (const hole of piece.holes) {
          for (const point of hole) {
            expect(insideRing(point, piece.outline)).toBe(true);
            for (const fold of piece.folds) {
              // Within a twentieth of a millimetre of the border asked for,
              // which is a good router's own positional accuracy — a pattern
              // stamped from a neighbouring facet follows that facet's own
              // development, and on a wall that does not develop perfectly the
              // two are a few microns apart.
              expect(toSegment(point, { x: fold.x1, y: fold.y1 }, { x: fold.x2, y: fold.y2 }))
                .toBeGreaterThanOrEqual(margin - 0.05);
            }
          }
        }
      }
    }
  });

  it('holds the web between every pair of cut-outs on a piece', () => {
    const model = build({ ...LIT, perfDensity: 3, perfWeb: 15 });
    for (const piece of wallPieces(model)) {
      const { holes } = piece;
      for (let i = 0; i < holes.length; i += 1) {
        for (let j = i + 1; j < holes.length; j += 1) {
          const gap = Math.min(
            ...holes[i].map((point) => toRing(point, holes[j])),
            ...holes[j].map((point) => toRing(point, holes[i])),
          );
          // Same twentieth of a millimetre as the border above, and for the
          // same reason: a stamped pattern rides its own facet's development.
          expect(gap).toBeGreaterThanOrEqual(15 - 0.05);
        }
      }
    }
  });

  it('leaves the foot solid up to the skirt', () => {
    const skirt = 180;
    const model = build({ ...LIT, perfSkirt: skirt, rows: 4 });
    const stride = model.parameters.sides + 1;
    expect(model.perfCells.length).toBeGreaterThan(0);
    for (const facet of model.perfCells) {
      const heights = model.triangles[facet.triangle].v.map(
        (id) => model.vertices[Math.floor(id / stride)][id % stride].z,
      );
      // A facet that dips into the skirt is left whole, so the lowest corner of
      // every perforated facet is at or above the line.
      expect(Math.min(...heights)).toBeGreaterThanOrEqual(skirt - 1e-6);
    }
  });

  it('carries the cut-outs onto the sheet in the same frame as the flat net', () => {
    for (const overrides of [LIT, { ...LIT, construction: 'banded' as const }]) {
      const model = build(overrides);
      const cells = model.perfCells.reduce((count, facet) => count + facet.cells.length, 0);
      const holes = wallPieces(model).reduce((count, piece) => count + piece.holes.length, 0);
      expect(cells).toBe(holes);
      for (const facet of model.perfCells) {
        for (const cell of facet.cells) {
          for (const point of cell) {
            expect(point.x).toBeGreaterThanOrEqual(-1e-6);
            expect(point.y).toBeGreaterThanOrEqual(-1e-6);
            expect(point.x).toBeLessThanOrEqual(model.sheet.width + 1e-6);
            expect(point.y).toBeLessThanOrEqual(model.sheet.height + 1e-6);
          }
        }
      }
    }
  });

  it('writes every cut-out into both export formats as a closed run', () => {
    const model = build(LIT);
    const cells = model.perfCells.reduce((count, facet) => count + facet.cells.length, 0);
    expect(cells).toBeGreaterThan(0);
    const svg = buildPlanterSvg(model, 'Crystal Facet');
    const solid = buildPlanterSvg(build(), 'Crystal Facet');
    expect((svg.match(/<polygon/g) ?? []).length - (solid.match(/<polygon/g) ?? []).length)
      .toBeGreaterThanOrEqual(cells);
    // R12 closes a run with bit 1 of group 70, so a cut-out arriving open would
    // be cut as a slit that never meets itself.
    const dxf = buildPlanterDxf(model);
    expect((dxf.match(/\n70\n1\n/g) ?? []).length).toBeGreaterThanOrEqual(cells);
    expect(dxf).not.toMatch(/NaN/);
  });

  it('reports what it opened up, and says so in the shop notes', () => {
    const model = build(LIT);
    const stats = getPlanterStats(model);
    const cells = model.perfCells.reduce((count, facet) => count + facet.cells.length, 0);
    expect(stats.openArea).toBe(`${Math.round(model.perfOpenArea * 100)}% open · ${cells} cut-outs`);
    expect(model.perfOpenArea).toBeGreaterThan(0);
    expect(model.perfOpenArea).toBeLessThan(1);
    expect(getPlanterStats(build()).openArea).toBeUndefined();
    expect(buildPlanterSvg(model, 'Crystal Facet')).toContain('milled cut-outs');
  });

  it('keeps the one-click wall decorative rather than structural', () => {
    // The whole point of the opening lever: a composite panel has to stay a
    // panel, so the button takes a little material out and no more. Anything
    // that pushes this up past a sixth of the wall has stopped decorating it.
    // Every catalogue design, not just a convenient one: the button is offered
    // on whatever is on the bench, so it has to stay decorative on all of them.
    for (const preset of [...PLANTER_PRESETS, BLANK_PLANTER]) {
      const model = build(litPlanter({ ...DEFAULT_PLANTER, ...preset.parameters }));
      expect(model.perfCells.length).toBeGreaterThan(0);
      expect(model.perfOpenArea).toBeGreaterThan(0.005);
      expect(model.perfOpenArea).toBeLessThan(0.16);
      expect(getPlanterChecks(model).some((check) => check.id === 'perf-open')).toBe(false);
    }
  });

  it('cuts the share of each cell it was asked for', () => {
    // Opening is an area fraction, so halving it roughly halves what leaves the
    // sheet — which is what makes it the lever to reach for when the panel is
    // going soft, rather than the pattern fineness.
    // At density 1 the cells are big enough that the opening is what binds. At
    // a fine density the web takes over as the floor, which is the point of the
    // web — so this is measured where the lever is actually the lever.
    const wide = build({ ...LIT, perfDensity: 1, perfOpening: 70 });
    const narrow = build({ ...LIT, perfDensity: 1, perfOpening: 12 });
    expect(narrow.perfOpenArea).toBeLessThan(wide.perfOpenArea * 0.3);
    expect(getPlanterChecks(wide).some((check) => check.id === 'perf-open')).toBe(false);

    // And the web is a floor the opening cannot talk its way past: asking for
    // almost the whole cell still leaves a full web between neighbours.
    const greedy = build({ ...LIT, perfDensity: 4, perfOpening: 90, perfWeb: 18 });
    for (const piece of wallPieces(greedy)) {
      const { holes } = piece;
      for (let i = 0; i < holes.length; i += 1) {
        for (let j = i + 1; j < holes.length; j += 1) {
          const gap = Math.min(
            ...holes[i].map((point) => toRing(point, holes[j])),
            ...holes[j].map((point) => toRing(point, holes[i])),
          );
          expect(gap).toBeGreaterThanOrEqual(18 - 0.05);
        }
      }
    }
  });

  it('cuts the count asked for, and the same one every time', () => {
    // "Six of the thirty-six." Six per facet, on every facet that carries any.
    const six = { ...BIG, perfDensity: 4, perfPicked: 6, perfWeb: 6, perfMargin: 12 };
    const model = build(six);
    expect(model.perfCells.length).toBeGreaterThan(0);
    for (const facet of model.perfCells) expect(facet.cells).toHaveLength(6);
    // Settled once: the same design cuts the same six, or a redraw is a lottery.
    expect(build(six).perfCells).toEqual(model.perfCells);
    // And 0 means the lot — sixteen at this fineness.
    for (const facet of build({ ...six, perfPicked: 0 }).perfCells) expect(facet.cells).toHaveLength(16);
  });

  it('cuts and folds without taking anything off the sheet', () => {
    const folded = build({ ...BIG, perforation: 'foldout', perfWeb: 8, perfMargin: 12 });
    const solid = build({ ...BIG, perforation: 'none' });
    const flaps = wallPieces(folded).reduce((count, piece) => count + piece.flaps.length, 0);
    expect(flaps).toBeGreaterThan(0);

    // No holes anywhere on the wall, and the petals are three-point flaps.
    for (const piece of wallPieces(folded)) {
      expect(piece.holes).toEqual([]);
      for (const flap of piece.flaps) expect(flap).toHaveLength(3);
    }

    // The part weighs what it weighed before: a petal is still attached.
    expect(getPlanterStats(folded).estimatedWeight).toBe(getPlanterStats(solid).estimatedWeight);
    // But there is more cutting to do than on a plain wall.
    expect(parseFloat(getPlanterStats(folded).cutLength))
      .toBeGreaterThan(parseFloat(getPlanterStats(solid).cutLength));
    expect(getPlanterStats(folded).openArea).toContain('nothing removed');
  });

  it('gives every petal a hinge crease and an open cut, never a closed one', () => {
    const model = build({ ...BIG, perforation: 'foldout', perfWeb: 8, perfMargin: 12 });
    for (const piece of wallPieces(model)) {
      const hinges = piece.folds.filter((fold) => fold.id.startsWith('flap'));
      expect(hinges).toHaveLength(piece.flaps.length);
      // Each hinge is exactly the flap's first edge — the one left uncut.
      piece.flaps.forEach((flap, i) => {
        expect(Math.hypot(hinges[i].x1 - flap[0].x, hinges[i].y1 - flap[0].y)).toBeLessThan(1e-6);
        expect(Math.hypot(hinges[i].x2 - flap[1].x, hinges[i].y2 - flap[1].y)).toBeLessThan(1e-6);
        expect(hinges[i].kind).toBe('mountain');
      });
      // The cut starts at one hinge end and finishes at the other, so it can
      // never come back round and drop the petal out.
      for (const flap of piece.flaps) {
        const slit = flapSlit(flap as [Vec2, Vec2, Vec2], model.parameters.perfTool);
        expect(Math.hypot(slit[0].x - flap[0].x, slit[0].y - flap[0].y)).toBeLessThan(1e-6);
        const end = slit[slit.length - 1];
        expect(Math.hypot(end.x - flap[1].x, end.y - flap[1].y)).toBeLessThan(1e-6);
      }
    }
    // And the exports carry them as open runs.
    const svg = buildPlanterSvg(model, 'fold');
    expect((svg.match(/<polyline/g) ?? []).length).toBeGreaterThan(0);
  });

  it('offers every pattern family on the same rules', () => {
    for (const perforation of ['triangles', 'shards', 'dots', 'grid', 'foldout'] as const) {
      const model = build({ ...BIG, perforation, perfWeb: 8, perfMargin: 12 });
      const margin = model.parameters.perfMargin;
      expect(model.perfCells.length).toBeGreaterThan(0);
      for (const piece of wallPieces(model)) {
        // Petals are held to the same border as holes: a cut that runs up to a
        // crease weakens the fold just as much as a hole sitting next to it.
        // A petal's own hinge is a crease it sits exactly on — that is what a
        // hinge is. What has to hold is clearance from the WALL's creases.
        const creases = piece.folds.filter((fold) => !fold.id.startsWith('flap'));
        for (const hole of [...piece.holes, ...piece.flaps]) {
          for (const point of hole) {
            expect(insideRing(point, piece.outline)).toBe(true);
            for (const fold of creases) {
              expect(toSegment(point, { x: fold.x1, y: fold.y1 }, { x: fold.x2, y: fold.y2 }))
                .toBeGreaterThanOrEqual(margin - 0.05);
            }
          }
        }
      }
      expect(buildPlanterDxf(model)).not.toMatch(/NaN/);
    }
  });

  it('dissolves the pattern into a solid base instead of stopping at a line', () => {
    // The panel the reference shows: dense at the top, thinning down, gone by
    // the foot. Measured as area per facet against the facet's own height.
    const fade = build({ ...BIG, perfSkirt: 0, perfFade: 600, perfDensity: 3, perfWeb: 6, perfMargin: 12 });
    const stride = fade.parameters.sides + 1;
    const heightOf = (triangle: number) => {
      const zs = fade.triangles[triangle].v.map((id) => fade.vertices[Math.floor(id / stride)][id % stride].z);
      return (Math.min(...zs) + Math.max(...zs)) / 2;
    };
    const byHeight = fade.perfCells
      .map((facet) => ({ z: heightOf(facet.triangle), area: facet.cells.reduce((sum, cell) => sum + polygonAreaOf(cell), 0) }))
      .sort((a, b) => a.z - b.z);
    expect(byHeight.length).toBeGreaterThan(4);
    const low = byHeight[0].area;
    const high = byHeight[byHeight.length - 1].area;
    expect(low).toBeLessThan(high * 0.6);

    // And without the fade the same pot is even from the skirt up.
    const flatOut = build({ ...BIG, perfSkirt: 0, perfFade: 0, perfDensity: 3, perfWeb: 6, perfMargin: 12 });
    const areas = flatOut.perfCells.map((facet) => facet.cells.reduce((sum, cell) => sum + polygonAreaOf(cell), 0));
    expect(Math.min(...areas)).toBeGreaterThan(Math.max(...areas) * 0.6);
  });

  it('refuses to open a wall with nothing behind it', () => {
    const open = getPlanterChecks(build({ ...LIT, liner: false }));
    expect(open.find((check) => check.id === 'perf-liner')?.severity).toBe('error');
    expect(getPlanterChecks(build(LIT)).some((check) => check.id === 'perf-liner')).toBe(false);
  });

  it('still wants a liner behind a cut-and-fold wall', () => {
    // Nothing left the sheet, but the openings are just as open.
    const open = getPlanterChecks(build({ ...BIG, perforation: 'foldout', liner: false }));
    expect(open.find((check) => check.id === 'perf-liner')?.severity).toBe('error');
  });

  it('says so rather than silently cutting nothing', () => {
    const none = build({ ...LIT, perfSkirt: 2000 });
    expect(none.perfCells).toEqual([]);
    expect(getPlanterChecks(none).some((check) => check.id === 'perf-empty')).toBe(true);
  });

  it('cuts one facet and stamps it round, so every side carries the same pattern', () => {
    const model = build(LIT);
    const { sides } = model.parameters;
    const perBand = sides * 2;
    const byTriangle = new Map(model.perfCells.map((facet) => [facet.triangle, facet.cells]));

    // Within a band every side is the same triangle turned round the axis, so
    // the cut-outs on it are congruent — same count, same cell areas, in the
    // same order. Anything else means a side got its own layout.
    for (const facet of model.perfCells) {
      const band = Math.floor(facet.triangle / perBand);
      const parity = facet.triangle % 2;
      const first = byTriangle.get(band * perBand + parity);
      if (!first) continue;
      expect(facet.cells).toHaveLength(first.length);
      facet.cells.forEach((cell, index) => {
        expect(cell).toHaveLength(first[index].length);
        // Areas to a thousandth of a percent. They are not bit-identical: the
        // facets they sit on come off the unfolder a few microns apart on any
        // wall that is not perfectly developable, and the stamp follows the
        // facet it lands on rather than pretending otherwise.
        const area = polygonAreaOf(first[index]);
        expect(Math.abs(polygonAreaOf(cell) - area) / area).toBeLessThan(1e-3);
      });
    }
  });

  it('will not stamp one facet onto a facet of a different shape', () => {
    // A rectangle's long side and its end are not congruent. Squeezing one
    // pattern onto the other would scale the border at the creases by whatever
    // the squeeze was, so each shape gets its own layout — which shows up as
    // the two carrying different cell areas.
    const model = build({
      ...LIT, footprint: 'rectangle', style: 'prism', rows: 2,
      topWidth: 700, topLength: 280, bottomWidth: 640, bottomLength: 240,
    });
    const perBand = model.parameters.sides * 2;
    const areaOf = (triangle: number) => (model.perfCells.find((facet) => facet.triangle === triangle)?.cells ?? [])
      .reduce((sum, cell) => sum + polygonAreaOf(cell), 0);
    const band = Math.floor((model.perfCells[0]?.triangle ?? 0) / perBand);
    const longSide = areaOf(band * perBand);
    const shortSide = areaOf(band * perBand + 2);
    expect(longSide).toBeGreaterThan(0);
    expect(shortSide).toBeGreaterThan(0);
    expect(Math.abs(longSide - shortSide)).toBeGreaterThan(1);
  });

  it('drops the cells the cutter cannot enter instead of drawing them', () => {
    // A fine subdivision on this facet leaves cells smaller than the web that
    // has to surround them — nothing is drawn, and the reason is on the list.
    const crowded = build({ ...LIT, perfDensity: 8 });
    expect(crowded.perfDropped).toBeGreaterThan(0);
    expect(crowded.perfCells.reduce((count, facet) => count + facet.cells.length, 0))
      .toBeLessThan(crowded.parameters.sides * crowded.parameters.rows * 2 * 64);
    const said = getPlanterChecks(crowded).map((check) => check.id);
    expect(said.includes('perf-tool') || said.includes('perf-empty')).toBe(true);
  });
});

describe('soil liner', () => {
  it('arrives as two more parts, and only when it is asked for', () => {
    expect(build().pieces.map((piece) => piece.id)).not.toContain('liner-wall');
    const model = build(LIT);
    expect(model.pieces.map((piece) => piece.id)).toEqual(['wall', 'base', 'rim', 'liner-wall', 'liner-base']);
    expect(model.liner).not.toBeNull();
  });

  it('clears the wall by the cavity at every height', () => {
    // On a straight-ringed pot the wall between two rings really is the
    // straight line between them, so this measures the true gap rather than an
    // estimate of it.
    const cavity = 28;
    const model = build({
      style: 'prism', sides: 8, topDiameter: 420, bottomDiameter: 300, height: 520, rows: 2,
      liner: true, cavity,
    });
    const liner = model.liner as NonNullable<PlanterModel['liner']>;
    const { sides, rows } = model.parameters;

    let tightest = Infinity;
    for (let k = 0; k < rows; k += 1) {
      for (let step = 0; step <= 20; step += 1) {
        const u = step / 20;
        const z = model.vertices[k][0].z + (model.vertices[k + 1][0].z - model.vertices[k][0].z) * u;
        if (z > liner.height + 1e-6) continue;
        // Against the INSIDE of the wall — the face the box actually meets. Read
        // off the outside, a stated gap would be short by one thickness all round.
        const inner = model.solid.inner;
        const section = Array.from({ length: sides }, (_, i) => ({
          x: inner[k][i].x + (inner[k + 1][i].x - inner[k][i].x) * u,
          y: inner[k][i].y + (inner[k + 1][i].y - inner[k][i].y) * u,
        }));
        for (const corner of liner.section) {
          expect(insideRing(corner, section)).toBe(true);
          tightest = Math.min(tightest, toRing(corner, section));
        }
      }
    }
    // Sized to hit the target: looser wastes soil volume, tighter is a gap the
    // strip and its wiring do not fit through.
    expect(tightest).toBeGreaterThanOrEqual(cavity - 0.01);
    expect(tightest).toBeLessThan(cavity + 1);
  });

  it('stops below the mouth so the collar covers the soil line', () => {
    const model = build(LIT);
    const liner = model.liner as NonNullable<PlanterModel['liner']>;
    expect(liner.height).toBeLessThan(model.parameters.height);
    expect(liner.height).toBeGreaterThan(model.parameters.height * 0.5);
    expect(liner.mouthGap).toBeGreaterThanOrEqual(model.parameters.cavity - 0.01);
  });

  it('develops exactly, because it is a prism', () => {
    const model = build(LIT);
    const liner = model.liner as NonNullable<PlanterModel['liner']>;
    const wall = model.pieces.find((piece) => piece.id === 'liner-wall') as PlanterPiece;
    const corners = wall.folds.filter((fold) => fold.id.startsWith('liner-corner'));
    expect(corners).toHaveLength(model.parameters.sides - 1);
    for (const fold of corners) {
      // A prism's corner creases all run the full height, all parallel.
      expect(Math.hypot(fold.x2 - fold.x1, fold.y2 - fold.y1)).toBeCloseTo(liner.height, 6);
      expect(fold.x1).toBeCloseTo(fold.x2, 6);
    }
    // The blank is exactly as long as the box is round.
    const perimeter = liner.section.reduce((sum, point, i) => {
      const next = liner.section[(i + 1) % liner.section.length];
      return sum + Math.hypot(next.x - point.x, next.y - point.y);
    }, 0);
    expect(Math.max(...corners.map((fold) => fold.x1))).toBeLessThan(perimeter);
  });

  it('drills both floors so the cavity never becomes the sump', () => {
    const model = build(LIT);
    expect(model.pieces.find((piece) => piece.id === 'liner-base')?.holes.length).toBeGreaterThan(0);
    expect(model.pieces.find((piece) => piece.id === 'base')?.holes.length).toBeGreaterThan(0);
    // Nothing is drilled into a pot that is planted directly.
    expect(build().pieces.find((piece) => piece.id === 'base')?.holes).toEqual([]);
    for (const id of ['base', 'liner-base']) {
      const piece = model.pieces.find((item) => item.id === id) as PlanterPiece;
      for (const hole of piece.holes) {
        for (const point of hole) expect(insideRing(point, piece.outline)).toBe(true);
      }
    }
  });

  it('quotes the box the soil actually goes in, not the shell around it', () => {
    const model = build(LIT);
    const liner = model.liner as NonNullable<PlanterModel['liner']>;
    expect(liner.litres).toBeLessThan(planterVolumeLitres(model));
    expect(getPlanterStats(model).volume).toBe(`≈ ${liner.litres.toFixed(1)} L`);
    expect(getPlanterStats(build()).volume).toBe(`≈ ${planterVolumeLitres(build()).toFixed(1)} L`);
  });

  it('says there is no room rather than building a box that will not go in', () => {
    const model = build({ sides: 6, topDiameter: 160, bottomDiameter: 150, height: 300, liner: true, cavity: 120 });
    expect(model.liner).toBeNull();
    expect(model.pieces.map((piece) => piece.id)).not.toContain('liner-wall');
    expect(getPlanterChecks(model).find((check) => check.id === 'liner-fit')?.severity).toBe('error');
  });
});

describe('solar panel', () => {
  it('cuts a window in the collar that stays inside the collar band', () => {
    const model = build(LIT);
    const rim = model.pieces.find((piece) => piece.id === 'rim') as PlanterPiece;
    expect(rim.holes).toHaveLength(2);
    const [opening, window] = rim.holes;
    for (const point of window) {
      expect(insideRing(point, rim.outline)).toBe(true);
      // Clear of the planting hole, or the panel overhangs into it.
      expect(insideRing(point, opening)).toBe(false);
    }
    // Cut under the panel's own size, so the panel beds onto a lip.
    const span = Math.max(...window.map(
      (a) => Math.max(...window.map((b) => Math.hypot(a.x - b.x, a.y - b.y))),
    ));
    expect(span).toBeLessThan(Math.hypot(model.parameters.solarWidth, model.parameters.solarLength));
  });

  it('cuts nothing when the collar cannot carry the panel, and says why', () => {
    const model = build({ ...LIT, rimWidth: 30 });
    expect(model.pieces.find((piece) => piece.id === 'rim')?.holes).toHaveLength(1);
    const check = getPlanterChecks(model).find((item) => item.id === 'solar-fit');
    expect(check?.severity).toBe('warning');
    expect(check?.detail).toContain('86 mm');
  });

  it('leaves the collar alone when no panel was asked for', () => {
    expect(build({ ...LIT, solar: false }).pieces.find((piece) => piece.id === 'rim')?.holes).toHaveLength(1);
  });
});

describe('LED strip', () => {
  const ids = (model: PlanterModel) => getPlanterChecks(model).map((check) => check.id);

  it('leaves a design that never asked for a strip completely alone', () => {
    const plain = build();
    expect(plain.parameters.led).toBe('none');
    expect(plain.lighting).toBeNull();
    const stats = getPlanterStats(plain);
    expect(stats.lighting).toBeUndefined();
    expect(stats.power).toBeUndefined();
    expect(stats.runtime).toBeUndefined();
    expect(ids(plain).some((id) => id.startsWith('led-'))).toBe(false);
  });

  it('measures the run off the liner it is stuck to, not off the pot', () => {
    const model = build({ ...LIT, led: '3000k' });
    const light = model.lighting!;
    const liner = model.liner!;
    const round = liner.section.reduce(
      (sum, point, i, all) => sum + Math.hypot(all[(i + 1) % all.length].x - point.x, all[(i + 1) % all.length].y - point.y),
      0,
    );
    expect(light.length).toBeCloseTo(round, 6);
    // And the count follows the strip that was actually specified.
    expect(light.leds).toBe(Math.round((light.length / 1000) * 60));
  });

  it('adds a run without lengthening the pot', () => {
    const one = build({ ...LIT, led: '3000k', ledRuns: 1 }).lighting!;
    const three = build({ ...LIT, led: '3000k', ledRuns: 3 }).lighting!;
    expect(three.length).toBeCloseTo(one.length * 3, 6);
    // The count follows the strip rather than the run: emitters come whole, so
    // three runs of 43.3 is 130 and not three times a rounded 43.
    expect(three.leds).toBe(Math.round((three.length / 1000) * 60));
    // And the draw follows the emitters, for the same reason — so what has to
    // hold across runs is the watts each one costs, not a multiple of the total.
    expect(three.peakWatts / three.leds).toBeCloseTo(one.peakWatts / one.leds, 9);
  });

  it('charges for density without moving the strip', () => {
    const sparse = build({ ...LIT, led: '3000k', ledDensity: 30 }).lighting!;
    const dense = build({ ...LIT, led: '3000k', ledDensity: 144 }).lighting!;
    expect(dense.length).toBeCloseTo(sparse.length, 6);
    expect(dense.leds).toBeGreaterThan(sparse.leds * 4);
    expect(dense.peakWatts).toBeGreaterThan(sparse.peakWatts * 4);
  });

  it('keeps the three whites electrically identical and the addressable one not', () => {
    const whites = (['3000k', '6000k', '10000k'] as const).map((led) => build({ ...LIT, led }).lighting!);
    for (const white of whites) {
      expect(white.volts).toBe(12);
      expect(white.addressable).toBe(false);
      expect(white.peakWatts).toBeCloseTo(whites[0].peakWatts, 9);
      expect(white.feeds).toBe(1);
    }
    // What differs between them is the light, not the load.
    expect(whites[0].kelvin).toBe(3000);
    expect(whites[2].kelvin).toBe(10000);
    expect(whites[1].lumens).toBeGreaterThan(whites[2].lumens);

    const rgb = build({ ...LIT, led: 'ws2812' }).lighting!;
    expect(rgb.volts).toBe(5);
    expect(rgb.addressable).toBe(true);
    // Three dice per pixel against one white one: a different animal on the
    // same length of tape, which is the whole reason the budget is computed.
    expect(rgb.peakWatts).toBeGreaterThan(whites[0].peakWatts * 3);
    expect(rgb.amps).toBeGreaterThan(whites[0].amps * 3);
  });

  it('sizes the supply above the flat-out draw, never against the dimmed one', () => {
    for (const led of ['3000k', 'ws2812'] as const) {
      for (const ledRuns of [1, 4]) {
        const light = build({ ...LIT, led, ledRuns, ledBrightness: 10 }).lighting!;
        expect(light.supply).toBeGreaterThanOrEqual(light.peakWatts * 1.2);
        expect(light.watts).toBeLessThan(light.peakWatts);
        expect(light.amps).toBeCloseTo(light.peakWatts / light.volts, 9);
      }
    }
  });

  it('asks for more feed points as the run gets longer, and sooner at 5 V', () => {
    const long = { ...LIT, ledRuns: 6, topDiameter: 900, bottomDiameter: 860, rimWidth: 120 };
    const white = build({ ...long, led: '6000k' }).lighting!;
    const rgb = build({ ...long, led: 'ws2812' }).lighting!;
    expect(rgb.length).toBeCloseTo(white.length, 6);
    expect(rgb.feeds).toBeGreaterThan(white.feeds);
    expect(ids(build({ ...long, led: 'ws2812' }))).toContain('led-feed');
    expect(ids(build({ ...long, led: 'ws2812' }))).toContain('led-data');
  });

  it('says so when the strip has no box to sit on and no way out', () => {
    const naked = build({ ...LIT, led: '3000k', liner: false, perforation: 'none' });
    expect(ids(naked)).toContain('led-liner');
    expect(ids(naked)).toContain('led-dark');
    // It still costs what it costs — the run is quoted off the wall instead.
    expect(naked.lighting!.length).toBeGreaterThan(0);
  });

  it('knows a panel that was never cut brings in nothing', () => {
    // The collar is too narrow for the panel, so no window was cut — and a
    // panel that is not in the pot cannot charge it.
    const model = build({ ...LIT, led: '3000k', rimWidth: 30 });
    expect(model.pieces.find((piece) => piece.id === 'rim')?.holes).toHaveLength(1);
    expect(model.lighting!.harvest).toBe(0);
    expect(model.lighting!.runtime).toBe(0);
    expect(ids(model)).toContain('led-mains');
    expect(ids(model)).not.toContain('led-solar');
  });

  it('tells a pot it cannot run all night by how much, and what would fix it', () => {
    const model = build({ ...LIT, led: 'ws2812', ledBrightness: 100, ledHours: 10 });
    const light = model.lighting!;
    expect(light.harvest).toBeGreaterThan(0);
    expect(light.runtime).toBeLessThan(10);
    const check = getPlanterChecks(model).find((item) => item.id === 'led-solar');
    expect(check?.severity).toBe('warning');
    // The remedy is quoted as a bigger panel than the one fitted.
    const bigger = /about (\d+) . (\d+) mm of panel/.exec(check?.detail ?? '');
    expect(bigger).not.toBeNull();
    expect(Number(bigger![1])).toBeGreaterThan(model.parameters.solarWidth);
  });

  it('turns the one-click pot down to what its own panel carries', () => {
    const fitted = litPlanter({ ...DEFAULT_PLANTER });
    expect(fitted.led).toBe('3000k');
    const model = buildPlanterModel(fitted);
    const light = model.lighting!;
    expect(light.harvest).toBeGreaterThan(0);
    expect(light.runtime).toBeGreaterThanOrEqual(fitted.ledHours - 0.05);
    expect(getPlanterChecks(model).filter((check) => check.id.startsWith('led-'))).toEqual([]);
    // And it never claims more than the panel: this is a small panel on a collar.
    expect(fitted.ledBrightness).toBeLessThan(100);
  });

  it('keeps a strip the caller already chose when the kit is refitted', () => {
    expect(litPlanter({ ...DEFAULT_PLANTER, led: 'ws2812' }).led).toBe('ws2812');
    expect(litPlanter({ ...DEFAULT_PLANTER, led: '10000k' }).led).toBe('10000k');
  });

  it('carries the strip into the shop notes and the stats, and off again', () => {
    const model = build({ ...LIT, led: '6000k' });
    const svg = buildPlanterSvg(model, 'Test');
    expect(svg).toContain('6000K daylight');
    expect(svg).toContain('Supply 12 V');
    const stats = getPlanterStats(model);
    expect(stats.lighting).toContain('6000K daylight');
    expect(stats.power).toContain('at 12 V');
    expect(stats.runtime).toContain('Wh/day');

    const dark = build({ ...LIT, led: 'none' });
    expect(buildPlanterSvg(dark, 'Test')).not.toContain('Supply 12 V');
    expect(getPlanterStats(dark).power).toBeUndefined();
  });

  it('clamps every electrical lever to something orderable', () => {
    const wild = normalizePlanter({
      ...DEFAULT_PLANTER,
      led: 'halogen' as never,
      ledDensity: 47,
      ledRuns: 99,
      ledBrightness: Number.NaN,
      ledHours: -3,
    });
    expect(wild.led).toBe('none');
    // Strips are sold at 30, 60 and 144 a metre — 47 is not a strip.
    expect(wild.ledDensity).toBe(60);
    expect(wild.ledRuns).toBe(6);
    expect(wild.ledBrightness).toBe(60);
    // A magnitude, like every other size here: a minus sign is a typo, not a
    // request for negative hours.
    expect(wild.ledHours).toBe(3);
    expect(normalizePlanter({ ...DEFAULT_PLANTER, ledHours: Number.NaN }).ledHours).toBe(6);
    for (const led of ['3000k', '6000k', '10000k', 'ws2812'] as const) {
      expect(normalizePlanter({ ...DEFAULT_PLANTER, led }).led).toBe(led);
    }
    expect(normalizePlanter({ ...DEFAULT_PLANTER, ledDensity: 120 }).ledDensity).toBe(144);
    expect(normalizePlanter({ ...DEFAULT_PLANTER, ledDensity: 40 }).ledDensity).toBe(30);
  });
});

describe('effect modes and where the strip sits', () => {
  const ids = (model: PlanterModel) => getPlanterChecks(model).map((check) => check.id);
  const RGB = { ...LIT, led: 'ws2812' } as Partial<PlanterParameters>;

  it('charges a mode for what it actually lights, and the driver for everything', () => {
    const solid = build({ ...RGB, ledEffect: 'static' }).lighting!;
    const comet = build({ ...RGB, ledEffect: 'comet' }).lighting!;

    // The wiring, the fuse and the driver still have to survive white.
    expect(comet.peakWatts).toBeCloseTo(solid.peakWatts, 9);
    expect(comet.amps).toBeCloseTo(solid.amps, 9);
    expect(comet.supply).toBe(solid.supply);
    // The night is paid for by what is lit, and a comet lights very little.
    expect(comet.watts).toBeLessThan(solid.watts * 0.25);
    expect(comet.demand).toBeLessThan(solid.demand);
    expect(comet.runtime).toBeGreaterThan(solid.runtime * 4);
    expect(comet.duty).toBeCloseTo(getLedEffect('comet').duty, 9);
  });

  it('ignores the mode on a white strip, which has only one state', () => {
    const warm = build({ ...LIT, led: '3000k', ledEffect: 'police' }).lighting!;
    expect(warm.effect).toBe('static');
    expect(warm.duty).toBe(1);
  });

  it('will not run a mode with nothing to drive it, and says so', () => {
    const orphan = build({ ...RGB, ledEffect: 'rainbow', ledController: 'none' });
    // Forced back to one colour, so the budget does not quietly assume a duty
    // that this pot has no way of producing.
    expect(orphan.lighting!.effect).toBe('static');
    expect(orphan.lighting!.duty).toBe(1);
    expect(ids(orphan)).toContain('led-controller');
    expect(ids(build({ ...RGB, ledEffect: 'rainbow', ledController: 'wled' }))).not.toContain('led-controller');
    // A controller is only wasted on a strip that has no pixels to address.
    expect(ids(build({ ...LIT, led: '6000k', ledController: 'none' }))).not.toContain('led-controller');
  });

  it('measures a different circuit for each mounting', () => {
    const tapered = { ...RGB, topDiameter: 520, bottomDiameter: 300, rimWidth: 60 };
    const rim = build({ ...tapered, ledPosition: 'rim' }).lighting!;
    const wall = build({ ...tapered, ledPosition: 'wall' }).lighting!;
    const foot = build({ ...tapered, ledPosition: 'foot' }).lighting!;

    // Three sections of the same pot, and on a taper they are not close.
    expect(rim.position).toBe('rim');
    expect(rim.length).toBeGreaterThan(foot.length * 1.1);
    expect(new Set([rim.length, wall.length, foot.length]).size).toBe(3);
    // More strip is more pixels is more current — the budget follows the run.
    expect(rim.leds).toBeGreaterThan(foot.leds);
    expect(rim.peakWatts).toBeGreaterThan(foot.peakWatts);
  });

  it('warns that the bottom mounting is where the water goes, and only that one', () => {
    expect(ids(build({ ...RGB, ledPosition: 'foot' }))).toContain('led-wet');
    expect(ids(build({ ...RGB, ledPosition: 'rim' }))).not.toContain('led-wet');
    expect(ids(build({ ...RGB, ledPosition: 'wall' }))).not.toContain('led-wet');
  });

  it('tells the workshop where to stick it and what to load on the controller', () => {
    const notes = buildPlanterSvg(
      build({ ...RGB, ledPosition: 'rim', ledEffect: 'comet', ledController: 'wled' }), 'Test',
    );
    expect(notes).toContain('under the collar, facing down');
    expect(notes).toContain('WLED controller');
    expect(notes).toContain('Comet');

    const plain = buildPlanterSvg(build({ ...RGB, ledEffect: 'static' }), 'Test');
    expect(plain).toContain('on the liner face, facing the cut-outs');
    expect(plain).not.toContain('Comet');
  });

  it('leaves no cut line touched by any of it', () => {
    // The whole point: the mode is programmed at the bench, so twenty modes are
    // twenty controllers and exactly one drawing.
    const reference = buildPlanterDxf(build({ ...RGB, ledEffect: 'static' }));
    for (const spec of LED_EFFECTS) {
      for (const ledSpeed of [5, 100]) {
        expect(buildPlanterDxf(build({ ...RGB, ledEffect: spec.id, ledSpeed }))).toBe(reference);
      }
    }
    expect(buildPlanterDxf(build({ ...RGB, ledColor: '#ff0000' }))).toBe(reference);
    // Where it is mounted does not cut anything either — it is a channel bonded
    // in after the fact, not a feature in the sheet.
    for (const ledPosition of ['rim', 'wall', 'foot'] as const) {
      expect(buildPlanterDxf(build({ ...RGB, ledPosition }))).toBe(reference);
    }
  });

  it('clamps the mode, the speed, the colour and the mounting', () => {
    const wild = normalizePlanter({
      ...DEFAULT_PLANTER,
      ledEffect: 'disco' as never,
      ledSpeed: Number.NaN,
      ledColor: 'rebeccapurple' as never,
      ledController: 'clapper' as never,
      ledPosition: 'lid' as never,
    });
    expect(wild.ledEffect).toBe('static');
    expect(wild.ledSpeed).toBe(50);
    expect(wild.ledColor).toBe('#28d8ff');
    expect(wild.ledController).toBe('wled');
    expect(wild.ledPosition).toBe('wall');
    expect(normalizePlanter({ ...DEFAULT_PLANTER, ledColor: '#AbC123' }).ledColor).toBe('#AbC123');
    expect(normalizePlanter({ ...DEFAULT_PLANTER, ledSpeed: 900 }).ledSpeed).toBe(100);
    for (const spec of LED_EFFECTS) {
      expect(normalizePlanter({ ...DEFAULT_PLANTER, ledEffect: spec.id }).ledEffect).toBe(spec.id);
    }
  });
});

describe('lighting as a whole', () => {
  it('ships lit presets that clear fabrication', () => {
    const lit = PLANTER_PRESETS.filter((preset) => preset.category === 'lit');
    expect(lit.length).toBeGreaterThanOrEqual(3);
    for (const preset of lit) {
      const model = build(preset.parameters);
      expect(model.liner).not.toBeNull();
      expect(model.perfCells.length).toBeGreaterThan(0);
      expect(getPlanterChecks(model).filter((check) => check.severity === 'error')).toEqual([]);
      // The panel window actually got cut on every one of them.
      expect(model.pieces.find((piece) => piece.id === 'rim')?.holes).toHaveLength(2);
    }
  });

  it('clamps every lighting lever to something buildable', () => {
    const wild = normalizePlanter({
      ...DEFAULT_PLANTER,
      perfDensity: 99, perfWeb: -400, perfMargin: Number.NaN, perfTool: 0, perfOpening: Number.NaN,
      perfSkirt: -50, perfPicked: Number.NaN, perfFade: Number.NEGATIVE_INFINITY, perfLift: Number.NaN,
      cavity: 1e9, solarWidth: 0, solarLength: Number.POSITIVE_INFINITY,
    });
    expect(wild.perfDensity).toBe(8);
    expect(wild.perfWeb).toBe(60);
    expect(wild.perfOpening).toBe(18);
    expect(wild.perfPicked).toBe(0);
    expect(wild.perfLift).toBe(32);
    expect(wild.perfFade).toBe(0);
    expect(normalizePlanter({ ...DEFAULT_PLANTER, perforation: 'chevrons' as never }).perforation).toBe('none');
    for (const family of ['triangles', 'shards', 'dots', 'grid', 'foldout'] as const) {
      expect(normalizePlanter({ ...DEFAULT_PLANTER, perforation: family }).perforation).toBe(family);
    }
    // Non-finite falls back to the default rather than to the floor, or a design
    // saved before these existed would arrive with a 5 mm border beside a fold.
    expect(wild.perfMargin).toBe(22);
    expect(wild.perfTool).toBe(1);
    expect(wild.perfSkirt).toBe(50);
    expect(wild.cavity).toBe(200);
    expect(wild.solarWidth).toBe(30);
    expect(wild.solarLength).toBe(70);
  });

  it('survives the lighting corners without producing NaN geometry', () => {
    const corners: Partial<PlanterParameters>[] = [
      { ...LIT, sides: 3, rows: 1, perfDensity: 8 },
      { ...LIT, sides: 12, rows: 8, perfDensity: 1, perfSkirt: 0 },
      { ...LIT, footprint: 'rectangle', topWidth: 60, topLength: 4000 },
      { ...LIT, construction: 'banded', bulge: 60, rows: 8 },
      { ...LIT, perfTool: 20, perfWeb: 60, perfMargin: 120 },
      { ...LIT, height: 60, topDiameter: 60, bottomDiameter: 60, cavity: 6 },
      { ...LIT, twist: 180, bulge: -45, construction: 'banded' },
    ];
    for (const corner of corners) {
      const model = build(corner);
      const cells = model.perfCells.flatMap((facet) => facet.cells).flat();
      expect(cells.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
      expect(buildPlanterDxf(model)).not.toMatch(/NaN/);
      expect(buildPlanterSvg(model, 'corner')).not.toMatch(/NaN/);
      for (const check of getPlanterChecks(model)) expect(check.detail).not.toMatch(/NaN|undefined/);
      if (model.liner) {
        expect(Number.isFinite(model.liner.litres)).toBe(true);
        expect(model.liner.inradius).toBeGreaterThan(0);
      }
    }
  });
});

describe('stone cladding', () => {
  const ids = (model: PlanterModel) => getPlanterChecks(model).map((check) => check.id);
  const JERUSALEM = 'yellow_stone_wall';

  it('leaves a design that never asked for stone completely alone', () => {
    const plain = build();
    expect(plain.parameters.stone).toBe('none');
    expect(plain.stone).toBeNull();
    const stats = getPlanterStats(plain);
    expect(stats.stone).toBeUndefined();
    expect(stats.coat).toBeUndefined();
    expect(ids(plain).some((id) => id.startsWith('stone-'))).toBe(false);
    expect(buildPlanterSvg(plain, 'Diamond')).not.toContain('PAINT');
  });

  /**
   * The one that matters.
   *
   * The pot is folded before anybody opens a tin, so the file the cutter gets
   * cannot possibly depend on what the pot is painted. If this ever fails, the
   * studio has started sending the workshop a different part over a finish.
   */
  it('never moves a cut line, whatever is painted on it', () => {
    const base = { ...DEFAULT_PLANTER, perforation: 'triangles', liner: true } as Partial<PlanterParameters>;
    const reference = buildPlanterDxf(build(base));

    for (const stone of STONE_MATERIALS) {
      expect(buildPlanterDxf(build({ ...base, stone: stone.id })), stone.id).toBe(reference);
    }
    for (let stoneCoat = 0; stoneCoat <= MAX_COAT_MM; stoneCoat += 0.5) {
      expect(buildPlanterDxf(build({ ...base, stone: JERUSALEM, stoneCoat })), String(stoneCoat)).toBe(reference);
    }
    for (const stoneSeal of STONE_SEALS) {
      expect(buildPlanterDxf(build({ ...base, stone: JERUSALEM, stoneSeal })), stoneSeal).toBe(reference);
    }
    for (const stoneRelief of [0, 100]) {
      for (const stoneTone of [0, 100]) {
        expect(buildPlanterDxf(build({
          ...base, stone: JERUSALEM, stoneRelief, stoneTone, stoneTint: '#c3cdd6',
        }))).toBe(reference);
      }
    }
  });

  it('measures the coat off the pot it is actually painting', () => {
    const coat = build({ stone: JERUSALEM, stoneCoat: 6 }).stone!;
    expect(coat.code).toBe('ST124');
    // Wall plus collar on a half-metre pot: a real fraction of a square metre.
    expect(coat.areaM2).toBeGreaterThan(0.2);
    expect(coat.areaM2).toBeLessThan(3);
    expect(coat.litres).toBeCloseTo(coat.areaM2 * 6 * 0.6, 6);
    expect(coat.kg).toBeCloseTo(coat.litres * 1.55, 6);
    expect(coat.keepOut).toBe(6);
    expect(coat.reliefRun).toBeGreaterThan(0);

    // A bigger pot is more of everything. Nothing here is a fixed number.
    const bigger = build({ stone: JERUSALEM, stoneCoat: 6, height: 900, topDiameter: 700 }).stone!;
    expect(bigger.areaM2).toBeGreaterThan(coat.areaM2);
    expect(bigger.kg).toBeGreaterThan(coat.kg);
    expect(bigger.hours).toBeGreaterThan(coat.hours);
  });

  it('shows no more relief than the build pays for', () => {
    expect(build({ stone: JERUSALEM, stoneCoat: 8, stoneRelief: 100 }).stone!.reliefMm).toBeCloseTo(8, 6);
    expect(build({ stone: JERUSALEM, stoneCoat: 8, stoneRelief: 50 }).stone!.reliefMm).toBeCloseTo(4, 6);
    expect(build({ stone: JERUSALEM, stoneCoat: 0, stoneRelief: 100 }).stone!.reliefMm).toBe(0);
  });

  it('holds the ten-millimetre ceiling whatever arrives', () => {
    expect(normalizePlanter({ ...DEFAULT_PLANTER, stoneCoat: 40 }).stoneCoat).toBe(MAX_COAT_MM);
    expect(normalizePlanter({ ...DEFAULT_PLANTER, stoneCoat: -4 }).stoneCoat).toBe(4);
    expect(normalizePlanter({ ...DEFAULT_PLANTER, stoneCoat: Number.NaN }).stoneCoat).toBe(6);
    expect(build({ stone: JERUSALEM, stoneCoat: 999 }).stone!.coatMm).toBe(MAX_COAT_MM);
  });

  it('opens a design saved against a stone the shop no longer keeps', () => {
    const gone = build({ stone: 'granite_from_mars', stoneCoat: 5 });
    expect(gone.parameters.stone).toBe('none');
    expect(gone.stone).toBeNull();
    expect(normalizePlanter({ ...DEFAULT_PLANTER, stoneSeal: 'lacquer' as never }).stoneSeal).toBe('matte');
    expect(normalizePlanter({ ...DEFAULT_PLANTER, stoneTint: 'red' }).stoneTint).toBe('#ffffff');
  });

  it('says when the render has closed the holes the wall was cut for', () => {
    const open = { ...DEFAULT_PLANTER, perforation: 'triangles', liner: true, stone: JERUSALEM } as Partial<PlanterParameters>;
    const thin = build({ ...open, stoneCoat: 1 });
    const thick = build({ ...open, stoneCoat: MAX_COAT_MM });

    expect(thin.stone!.throat).toBeGreaterThan(0);
    expect(thick.stone!.throat).toBeLessThan(thin.stone!.throat);
    expect(ids(thick)).toContain('stone-perf');
    const shut = getPlanterChecks(thick).find((check) => check.id === 'stone-perf')!;
    expect(shut.severity).toBe(thick.stone!.throat <= 0 ? 'error' : 'warning');
    // A solid wall has no openings to lose, so the check has nothing to say.
    expect(ids(build({ stone: JERUSALEM, stoneCoat: MAX_COAT_MM }))).not.toContain('stone-perf');
  });

  it('weighs the coat against the panel carrying it', () => {
    expect(ids(build({ stone: JERUSALEM, stoneCoat: 1 }))).not.toContain('stone-weight');
    const heavy = build({ stone: JERUSALEM, stoneCoat: MAX_COAT_MM });
    expect(ids(heavy)).toContain('stone-weight');
    expect(getPlanterChecks(heavy).find((check) => check.id === 'stone-weight')!.title)
      .toContain(heavy.stone!.kg.toFixed(1));
  });

  it('warns about the creases only once there is enough render to crack', () => {
    expect(ids(build({ stone: JERUSALEM, stoneCoat: 1 }))).not.toContain('stone-crease');
    expect(ids(build({ stone: JERUSALEM, stoneCoat: 6 }))).toContain('stone-crease');
  });

  it('sends the painter a card the cutter never sees', () => {
    const svg = buildPlanterSvg(build({ stone: JERUSALEM, stoneCoat: 6, stoneSeal: 'satin' }), 'Diamond');
    expect(svg).toContain('PAINT');
    expect(svg).toContain('ST124');
    expect(svg).toContain('Jerusalem Gold');
    expect(svg).toContain('satin sealer');
    // And it carries the part nobody can specify: the glaze belongs to whoever
    // painted it, and two pots are never the same.
    expect(svg).toContain('no two pots match');
  });

  it('reports the stone and what painting it costs, in the stats', () => {
    const stats = getPlanterStats(build({ stone: JERUSALEM, stoneCoat: 6 }));
    expect(stats.stone).toContain('ST124');
    expect(stats.stone).toContain('6 mm');
    expect(stats.coat).toMatch(/coats · [\d.]+ L · [\d.]+ kg · [\d.]+ h · \d+ days?/);
  });

  it('says every one of its warnings in Hebrew too', () => {
    const model = build({
      ...DEFAULT_PLANTER, perforation: 'triangles', liner: true, led: '3000k',
      stone: JERUSALEM, stoneCoat: MAX_COAT_MM,
    });
    const english = getPlanterChecks(model).filter((check) => check.id.startsWith('stone-'));
    expect(english.length).toBeGreaterThan(2);
    const hebrew = checksHe(english, model);
    for (const [i, check] of hebrew.entries()) {
      expect(check.title, check.id).not.toBe(english[i].title);
      expect(check.detail, check.id).not.toBe(english[i].detail);
      expect(/[֐-׿]/.test(check.title), check.id).toBe(true);
      expect(/[֐-׿]/.test(check.detail), check.id).toBe(true);
    }
    // And every stone on the shelf has a Hebrew name to show under its chip.
    for (const stone of STONE_MATERIALS) expect(STONE_HE[stone.id], stone.id).toBeTruthy();
  });
});

describe('direct UV printing', () => {
  const ids = (model: PlanterModel) => getPlanterChecks(model).map((check) => check.id);
  const printed: Partial<PlanterParameters> = { print: 'triangles', printPalette: 'carnival' };

  it('leaves a design that never asked to be printed completely alone', () => {
    const plain = build();
    expect(plain.parameters.print).toBe('none');
    expect(plain.print).toBeNull();
    const stats = getPlanterStats(plain);
    expect(stats.print).toBeUndefined();
    expect(stats.ink).toBeUndefined();
    expect(ids(plain).some((id) => id.startsWith('print-'))).toBe(false);
    expect(buildPlanterSvg(plain, 'Diamond')).not.toContain('PRINT — direct UV');
  });

  it('cuts the same file whatever is printed on it', () => {
    // The mill is finished with the panel before the bed has seen it. This is
    // the same promise the stone finish makes, and it is the reason a print can
    // be specified this late at all.
    const base = { ...DEFAULT_PLANTER, perforation: 'triangles', liner: true } as PlanterParameters;
    const reference = buildPlanterDxf(build(base));

    for (const printRule of PRINT_RULES) {
      expect(buildPlanterDxf(build({ ...base, ...printed, printRule })), printRule).toBe(reference);
    }
    for (const printPalette of [...PRINT_PALETTES.map((p) => p.id), CUSTOM_PALETTE]) {
      expect(buildPlanterDxf(build({ ...base, ...printed, printPalette })), printPalette).toBe(reference);
    }
    for (let printGrout = 0; printGrout <= MAX_GROUT; printGrout += 0.5) {
      expect(buildPlanterDxf(build({ ...base, ...printed, printGrout })), String(printGrout)).toBe(reference);
    }
    for (const printSeed of [0, 1, 7, 999]) {
      expect(buildPlanterDxf(build({ ...base, ...printed, printSeed })), String(printSeed)).toBe(reference);
    }
    for (const printTones of [2, 4, 6]) {
      for (const printShade of [0, 100]) {
        expect(buildPlanterDxf(build({ ...base, ...printed, printTones, printShade }))).toBe(reference);
      }
    }
    expect(buildPlanterDxf(build({ ...base, print: 'image', printOverlay: false }))).toBe(reference);
  });

  it('gives every facet exactly one colour, in the model’s own order', () => {
    const model = build({ ...printed, sides: 8, rows: 3 });
    expect(model.print!.fills).toHaveLength(model.triangles.length);
    for (const hex of model.print!.fills) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(model.print!.colours).toBe(new Set(model.print!.fills).size);
    // Flat by default, like the catalogue pot: the palette's tones and nothing
    // between them. Shading is relief added on request, and it is the one
    // lever that turns four colours into forty on the print card.
    expect(model.print!.colours).toBeLessThanOrEqual(model.parameters.printTones);
    expect(build({ ...printed, printShade: 60 }).print!.colours)
      .toBeGreaterThan(model.parameters.printTones);
  });

  it('holds the ink off the creases, and charges the area for it', () => {
    const tight = build({ ...printed, printGrout: 0 });
    const wide = build({ ...printed, printGrout: 6 });
    expect(tight.print!.areaM2).toBeGreaterThan(wide.print!.areaM2);
    // The facets themselves do not change — only how much of them is inked.
    expect(tight.print!.facetM2).toBeCloseTo(wide.print!.facetM2, 6);
    expect(wide.print!.groutRun).toBeGreaterThan(0);
    expect(wide.print!.areaM2).toBeLessThan(wide.print!.facetM2);
  });

  it('takes the milled openings out of the inked area', () => {
    const solid = build({ ...printed, perforation: 'none' });
    const open = build({ ...printed, perforation: 'triangles', perfDensity: 3, liner: true });
    expect(open.perfCells.length).toBeGreaterThan(0);
    expect(open.print!.areaM2).toBeLessThan(solid.print!.areaM2);
  });

  it('bounds every lever a saved design can arrive with', () => {
    const wild = normalizePlanter({
      ...DEFAULT_PLANTER,
      print: 'spray-can' as never,
      printPalette: 'palette_from_mars',
      printRule: 'airbrush' as never,
      printSeed: Number.NaN,
      printTones: 99,
      printShade: -40,
      printGrout: 999,
      printColors: ['#ff0000', 'not a colour'],
      printImage: 'javascript:alert(1)',
      printFit: 'squash' as never,
      printOverlayInk: 'white',
      printOverlayDensity: 400,
    });
    expect(wild.print).toBe('none');
    expect(wild.printPalette).toBe(PRINT_PALETTES[0].id);
    expect(wild.printRule).toBe('scatter');
    expect(wild.printSeed).toBe(1);
    expect(wild.printTones).toBe(MAX_PRINT_TONES);
    // Negatives are folded rather than floored, as everywhere else here: a
    // slider that arrives at -40 meant 40 of something.
    expect(wild.printShade).toBe(40);
    expect(wild.printGrout).toBe(MAX_GROUT);
    expect(wild.printColors).toHaveLength(6);
    expect(wild.printColors[0]).toBe('#ff0000');
    expect(wild.printColors[1]).toBe(DEFAULT_PRINT_COLOURS[1]);
    // Anything that is not a PNG or a JPEG data URL is not artwork, and this
    // string ends up inside a file the shop is handed.
    expect(wild.printImage).toBe('');
    expect(wild.printFit).toBe('cover');
    expect(wild.printOverlayInk).toBe('#ffffff');
    expect(wild.printOverlayDensity).toBe(100);
    expect(normalizePlanter({ ...DEFAULT_PLANTER, printImage: 'data:image/png;base64,AAAB' }).printImage)
      .toBe('data:image/png;base64,AAAB');
  });

  it('writes a print file registered to the cut file', () => {
    const model = build({ ...printed, sides: 8, printGrout: 2 });
    const svg = buildPlanterPrintSvg(model, 'Diamond');
    // Same sheet, same millimetres, same origin — that is what lets the
    // operator register to the outline the mill has already cut.
    expect(svg).toContain(`width="${model.sheet.width.toFixed(2)}mm"`);
    expect(svg).toContain('PRINT — direct UV');
    expect(svg).toContain('id="artwork"');
    expect(svg).toContain('id="registration"');
    // No background: white in this file is white ink, not paper.
    expect(svg).not.toContain('fill="white"');
    for (const hex of new Set(model.print!.fills)) expect(svg).toContain(`fill="${hex}"`);
  });

  it('masks the artwork out of every hole that was milled through it', () => {
    const open = build({ ...printed, perforation: 'triangles', perfDensity: 3, liner: true });
    const svg = buildPlanterPrintSvg(open, 'Diamond');
    expect(svg).toContain('<mask id="panel"');
    // One black knockout per cut-out, plus the collar's own holes.
    const knockouts = (svg.match(/fill="#000000"/g) ?? []).length;
    expect(knockouts).toBeGreaterThanOrEqual(open.perfCells.reduce((n, f) => n + f.cells.length, 0));
  });

  it('lands an imported image on the wall and nowhere else', () => {
    const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
    const model = build({ print: 'image', printImage: pixel, printFit: 'contain' });
    const svg = buildPlanterPrintSvg(model, 'Diamond');
    expect(svg).toContain('<image');
    expect(svg).toContain(pixel);
    expect(svg).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(svg).toContain('clip-path="url(#facets)"');
    // A raster has no per-facet colour to quote, and guessing one would be a
    // number the shop could not use.
    expect(model.print!.fills).toHaveLength(0);
    expect(model.print!.colours).toBe(0);
  });

  it('prints the drawing on the pot, carrying the pot’s own numbers', () => {
    const model = build({ ...printed, printOverlay: true, printOverlayDensity: 100 });
    const svg = buildPlanterPrintSvg(model, 'Diamond');
    expect(svg).toContain('id="drafting"');
    expect(svg).toContain('DXF.TLV');
    // The callouts are measurements of this pot, not decoration: the mouth
    // diameter on the drawing is the mouth diameter of the pot.
    const mouth = Math.hypot(
      model.vertices[model.parameters.rows][0].x, model.vertices[model.parameters.rows][0].y,
    ) * 2;
    expect(svg).toContain(`⌀${mouth.toFixed(0)}`);
    expect(buildPlanterPrintSvg(build({ ...printed, printOverlay: false }), 'Diamond'))
      .not.toContain('id="drafting"');
  });

  it('refuses to have the print buried under the render', () => {
    const both = build({ ...printed, stone: 'yellow_stone_wall', stoneCoat: 6 });
    const clash = getPlanterChecks(both).find((check) => check.id === 'print-stone')!;
    expect(clash).toBeTruthy();
    expect(clash.severity).toBe('error');
    expect(ids(build(printed))).not.toContain('print-stone');
  });

  it('will not let a printed panel be folded hot without saying so', () => {
    // Cut from acrylic, not merely quoted against it: the stock is part of the
    // design now, so a pot that cannot be V-grooved is built that way from the
    // start and every other number on it agrees.
    const model = build({ ...printed, material: 'acrylic-3', sides: 4, rows: 1 });
    expect(model.groove.heatBent).toBe(true);
    expect(getPlanterChecks(model).map((c) => c.id)).toContain('print-heat');
    expect(ids(build({ ...printed, sides: 4, rows: 1 }))).not.toContain('print-heat');
  });

  it('says when the nest will not go on the bed in one pass', () => {
    const big = build({
      ...printed, sides: 12, rows: 4, topDiameter: 900, bottomDiameter: 800, height: 1200,
      sheetWidth: 3000, sheetHeight: 3000,
    });
    expect(big.print!.tiles).toBeGreaterThan(1);
    expect(ids(big)).toContain('print-bed');
    expect(ids(build(printed))).not.toContain('print-bed');
  });

  it('says when ink is being carried straight over a fold', () => {
    expect(ids(build({ ...printed, printGrout: 0 }))).toContain('print-grout');
    expect(ids(build({ ...printed, printGrout: DEFAULT_GROUT }))).not.toContain('print-grout');
  });

  it('says when there is no image to print', () => {
    expect(ids(build({ print: 'image', printImage: '' }))).toContain('print-image');
  });

  it('reports the artwork and what printing it costs, in the stats', () => {
    const stats = getPlanterStats(build({ ...printed, printRule: 'ramp' }));
    expect(stats.print).toContain('Carnival');
    expect(stats.print).toContain('Gradient');
    expect(stats.ink).toMatch(/\d passes? · [\d.]+ m2 · \d+ ml · \d+ min/);
  });

  it('says every one of its warnings in Hebrew too', () => {
    const model = build({
      ...printed, printGrout: 0, print: 'image', printImage: '',
      stone: 'yellow_stone_wall', stoneCoat: 6, perforation: 'triangles', liner: true,
    });
    const english = getPlanterChecks(model).filter((check) => check.id.startsWith('print-'));
    expect(english.length).toBeGreaterThan(2);
    const hebrew = checksHe(english, model);
    for (const [i, check] of hebrew.entries()) {
      expect(check.title, check.id).not.toBe(english[i].title);
      expect(check.detail, check.id).not.toBe(english[i].detail);
      expect(/[֐-׿]/.test(check.title), check.id).toBe(true);
      expect(/[֐-׿]/.test(check.detail), check.id).toBe(true);
    }
  });
});
