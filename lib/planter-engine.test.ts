import { describe, expect, it } from 'vitest';
import {
  buildPlanterDxf, buildPlanterModel, buildPlanterSvg, DEFAULT_PLANTER, getPlanterChecks,
  getPlanterStats, normalizePlanter, planterVolumeLitres,
} from './planter-engine';
import { BLANK_PLANTER, PLANTER_CATEGORIES, PLANTER_PRESETS, PLANTER_STYLES } from './planter-styles';
import { getMaterial } from './pattern-engine';
import type { PlanterModel, PlanterParameters, PlanterPiece, Vec2 } from './types';

const acp = getMaterial('acp-4');
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
    expect(getPlanterChecks(model, acp).map((check) => check.id)).toContain('development');
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
    expect(getPlanterChecks(model, acp).map((check) => check.id)).not.toContain('development');
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
    expect(planterVolumeLitres(model)).toBeCloseTo((400 * 300 * 500) / 1_000_000, 6);
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
    expect(box(0) - box(10)).toBeCloseTo(20, 6);
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
    // A regular hexagon of circumradius r has area 3√3/2 · r².
    const expected = (((3 * Math.sqrt(3)) / 2) * 200 * 200 * 500) / 1_000_000;
    expect(planterVolumeLitres(model)).toBeCloseTo(expected, 6);
  });

  it('counts two facets per side per band, and the parts on the sheet', () => {
    expect(getPlanterStats(build({ sides: 6, rows: 3 }), acp).facets).toBe(36);
    expect(getPlanterStats(build({ rows: 4, construction: 'single-sheet' }), acp).pieces).toBe(3);
    expect(getPlanterStats(build({ rows: 4, construction: 'banded' }), acp).pieces).toBe(6);
  });

  it('flags a net that will not fit the stock sheet', () => {
    const model = build({ topDiameter: 900, bottomDiameter: 800, height: 1400, sheetWidth: 600, sheetHeight: 600 });
    expect(getPlanterChecks(model, acp).find((check) => check.id === 'sheet-fit')?.severity).toBe('error');
  });

  it('flags a collar that would close over the planting hole', () => {
    expect(getPlanterChecks(build({ topDiameter: 300, rimWidth: 140 }), acp).map((check) => check.id)).toContain('rim-width');
  });

  it('flags rivet tabs too short to land a rivet clear of the fold', () => {
    const ids = getPlanterChecks(build({ construction: 'banded', rows: 3, jointTab: 8 }), acp).map((check) => check.id);
    expect(ids).toContain('joint-tab');
    expect(getPlanterChecks(build({ construction: 'banded', rows: 3, jointTab: 25 }), acp).map((c) => c.id)).not.toContain('joint-tab');
  });

  it('clears a stock design outright', () => {
    const model = build({ style: 'prism', sides: 6, topDiameter: 400, bottomDiameter: 340, height: 500, rows: 1 });
    expect(getPlanterChecks(model, acp)).toEqual([expect.objectContaining({ id: 'ready', severity: 'info' })]);
  });

  it('gives every check enough detail to act on', () => {
    for (const preset of everyPreset) {
      for (const check of getPlanterChecks(build(preset.parameters), acp)) {
        expect(check.detail.length).toBeGreaterThan(20);
      }
    }
  });
});

describe('output', () => {
  it('writes millimetre-true SVG carrying the fold notation', () => {
    const model = build();
    const svg = buildPlanterSvg(model, acp, 'Diamond Relief');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toMatch(/width="[\d.]+mm" height="[\d.]+mm"/);
    expect(svg).toContain('Solid = mountain');
    // One closed contour per piece, plus one more for the collar's opening.
    expect((svg.match(/<polygon /g) ?? []).length).toBe(model.pieces.length + 1);
  });

  it('says in the file which way the pot is built', () => {
    expect(buildPlanterSvg(build({ construction: 'banded', rows: 4 }), acp, 'Crystal')).toContain('3 riveted ring joints');
    expect(buildPlanterSvg(build({ construction: 'single-sheet' }), acp, 'Crystal')).toContain('Single-sheet build');
  });

  it('writes DXF R12 with a layer per fold kind', () => {
    const dxf = buildPlanterDxf(build());
    for (const layer of ['CUT', 'MOUNTAIN', 'VALLEY']) expect(dxf).toContain(`\n${layer}\n`);
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true);
    expect(dxf).not.toMatch(/NaN|Infinity/);
  });

  it('writes every run as one entity instead of a line per segment', () => {
    // The reported case: a net exported segment by segment lands on the machine
    // as hundreds of separate curves, and the cutter lifts between every one.
    const dxf = buildPlanterDxf(build({ construction: 'single-sheet', sides: 6, rows: 3 }));
    expect(dxf).not.toContain('\nLINE\n');
    expect(dxf).toContain('\nPOLYLINE\n');
    const svg = buildPlanterSvg(build({ construction: 'single-sheet', sides: 6, rows: 3 }), acp, 'Diamond Relief');
    expect(svg).not.toMatch(/<line /);
  });

  it('closes each part\'s outline in the file, not by hand afterwards', () => {
    const model = build();
    const dxf = buildPlanterDxf(model);
    // Bit 1 of group 70 is the closed flag; every piece contributes one outline.
    const closed = dxf.match(/\nPOLYLINE\n8\n[A-Z]+\n66\n1\n70\n1\n/g) ?? [];
    expect(closed.length).toBeGreaterThanOrEqual(model.pieces.length);
    expect(buildPlanterSvg(model, acp, 'Diamond Relief')).toContain('<polygon');
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
