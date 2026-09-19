import { getMaterial } from './pattern-engine';
import {
  barycentric, drainRing, flapSlit, foldFacet, gridFacet, perforateFacet, roundedRect,
  scatterFacet, shardFacet,
  type PerforationSpec, type Triangle2,
} from './planter-perforation';
import { draftMarks, draftSvg } from './planter-drafting';
import { getLedEffect, LED_EFFECTS } from './planter-led-effects';
import {
  CUSTOM_PALETTE, DEFAULT_GROUT, DEFAULT_PRINT_COLOURS, insetTriangle, isHex, MAX_GROUT,
  MAX_PRINT_TONES, paletteById, paletteColours, paletteName, PRINT_BED, PRINT_FITS, PRINT_MODES,
  PRINT_PALETTES, PRINT_RULE_NAMES, PRINT_RULES, printInkMl, printKg, printMinutes, printPasses,
  printTiles, triangleArea, triangleFills, type PrintFacet,
} from './planter-print';
import {
  coatCoats, coatDays, coatHours, coatKeepOut, coatKg, coatLitres, coatPasses, coatThroat,
  MAX_COAT_MM, SEAL_NAMES, stoneById, stoneName, STONE_SEALS,
} from './planter-stone';
import { getPlanterStyle } from './planter-styles';
import { chainFoldLines, simplifyPolyline, type Polyline } from './polyline';
import type {
  FabricationCheck, FoldKind, FoldLine, MaterialSpec, PlanterConstruction, PlanterGroove, PlanterLed,
  PlanterLedController, PlanterLedEffect, PlanterLedPosition, PlanterLighting, PlanterLiner,
  PlanterFace, PlanterModel, PlanterParameters, PlanterPerfCells, PlanterPerforation, PlanterPiece,
  PlanterPrintJob, PlanterStats, PlanterStoneCoat, PlanterWallPart,
  Vec2, Vec3,
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
/** The collar keeps at least this much opening, however wide the rim is set (mm). */
const MIN_OPENING = 15;
/**
 * Slip the base plate needs past the inside of the wall to actually drop in (mm).
 *
 * Small, because it is a fit and not a gap — the plate lands on the foot tabs
 * and the wall closes round it. Too much and the pot leaks soil at the floor.
 */
const BASE_FIT = 0.6;
/**
 * Steepest mitre the inside face is allowed to be pushed out to.
 *
 * Offsetting a surface inward runs away at a sharp corner: the mitre length is
 * the thickness over the cosine of the half-angle, so a crease approaching 180
 * degrees of bend sends the inside corner to infinity. Real stock does not do
 * that — it bottoms out when the groove shuts. 3 caps the run-out at three
 * thicknesses, well past anything a fold this side of a hem reaches.
 */
const MITRE_LIMIT = 3;
/**
 * How much edge mismatch a blank may carry and still be called foldable (mm).
 *
 * The stock does not stretch, so the honest figure is zero and everything above
 * it is a gap somebody closes by force on the bench. This is the width of the
 * rivet's own slop, which is what lets a tenth of a millimetre pass without a
 * warning; `planWallParts` cuts to stay under it, and the development check
 * fires above it, so the two can never disagree about what is buildable.
 */
export const DEVELOPMENT_TOLERANCE = 0.8;
/** The construction modes that exist, for guarding a design loaded from anywhere. */
const CONSTRUCTIONS: PlanterConstruction[] = ['single-sheet', 'split', 'banded'];

// --- Lighting ---------------------------------------------------------------

/** Headroom between the liner's rim and the pot's mouth, so the collar hides it (mm). */
const LINER_HEADROOM = 12;
/** What an LED strip on its channel, plus the wiring behind it, actually needs (mm). */
const STRIP_CLEARANCE = 14;
/** Lip the solar panel beds onto — the window is cut this much smaller all round (mm). */
const SOLAR_LIP = 6;
/** Material kept between the panel window and the collar's own edges (mm). */
const SOLAR_EDGE = 8;
/** Drain holes per floor, and how big they are (mm). */
// --- The electrical side ----------------------------------------------------
// Catalogue numbers for strip that is actually on the shelf, kept here rather
// than in the UI so the drawing, the checks and the screen quote one source.

/**
 * Per emitter, not per metre: the density is a parameter, and a 2835 in a
 * 60/m strip draws exactly what the same 2835 draws in a 120/m one. The whites
 * are one product in three phosphors, so they draw the same and differ only in
 * what comes out — and the far ends of the range are the inefficient ones,
 * because a deep warm phosphor loses to Stokes shift and a 10000K one is
 * running the blue pump hard with little phosphor to convert it.
 */
const LED_SPECS: Record<Exclude<PlanterLed, 'none'>, {
  kelvin: number; volts: number; watts: number; lumens: number; addressable: boolean;
  /** Feed spacing before the far end goes visibly dim (mm). */ feed: number;
  /** What the preview glows. */ glow: string;
}> = {
  '3000k': { kelvin: 3000, volts: 12, watts: 0.08, lumens: 90, addressable: false, feed: 5000, glow: '#ffc46b' },
  '6000k': { kelvin: 6000, volts: 12, watts: 0.08, lumens: 100, addressable: false, feed: 5000, glow: '#f4f8ff' },
  '10000k': { kelvin: 10000, volts: 12, watts: 0.08, lumens: 78, addressable: false, feed: 5000, glow: '#9fd0ff' },
  // 60 mA at 5 V with all three dice lit, which is what "white" costs on one of
  // these. A metre of 60/m WS2812B flat out is 18 W, and that is why it is fed
  // every metre instead of every five.
  ws2812: { kelvin: 0, volts: 5, watts: 0.3, lumens: 60, addressable: true, feed: 1000, glow: '#7ad8ff' },
};

/** Drivers that exist. Anything computed gets rounded up to one of these. */
const SUPPLY_SIZES = [6, 12, 18, 24, 36, 60, 100, 150, 200];

/** Small panel efficiency — mono or poly under glass, nothing exotic. */
const PANEL_EFFICIENCY = 0.17;
/**
 * Peak sun hours a day, averaged over the year and shaded for the honest case:
 * a pot on a balcony, its panel horizontal and dusty, in December as well as in
 * June. Tel Aviv gives well over 6 in summer; sizing on that number builds a
 * light that dies every winter.
 */
const SUN_HOURS = 4.2;
/** Controller plus battery round trip. Nothing gets stored for free. */
const CHARGE_EFFICIENCY = 0.7;
/** An 18650 at 3.7 V, 2600 mAh — and only 80% of it, so the cell lasts a season. */
const CELL_WH = 3.7 * 2.6 * 0.8;

const DRAIN_HOLES = 6;
const DRAIN_DIAMETER = 14;

export const DEFAULT_PLANTER: PlanterParameters = {
  style: 'diamond',
  footprint: 'polygon',
  construction: 'single-sheet',
  material: 'acp-4',
  // Every crease grooved with the bit it needs. Fit a real one and the checks
  // start saying which creases it can and cannot close.
  vBitAngle: 0,
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
  // One thickness of the house sheet plus its working fit — the smallest inset
  // that actually drops through the hole it is cut for. `normalizePlanter` holds
  // the floor for every other stock.
  baseInset: 4.6,
  baseTab: 18,
  rimTab: 18,
  // Every lighting lever starts off: a pot that was solid yesterday cuts the
  // same file today, and the option has to be asked for to change anything.
  perforation: 'none',
  perfDensity: 2,
  perfOpening: 18,
  perfPicked: 0,
  perfLift: 32,
  perfWeb: 14,
  perfMargin: 22,
  perfTool: 6,
  perfSkirt: 70,
  perfFade: 0,
  liner: false,
  cavity: 22,
  solar: false,
  solarWidth: 110,
  solarLength: 70,
  led: 'none',
  ledDensity: 60,
  ledRuns: 1,
  ledBrightness: 60,
  ledHours: 6,
  ledEffect: 'static',
  ledSpeed: 50,
  ledColor: '#28d8ff',
  ledController: 'wled',
  ledPosition: 'wall',
  // Unpainted, like every other finish lever: picking a stone is a decision
  // somebody makes, not something a pot arrives with.
  stone: 'none',
  stoneCoat: 6,
  stoneRelief: 100,
  stoneTone: 35,
  stoneTint: '#ffffff',
  stoneSeal: 'matte',
  // Nothing printed, for the same reason nothing is painted: a panel that came
  // off the mill bare yesterday comes off bare today, and the file is the same
  // file. Everything below is what the generator opens on once it is asked for.
  print: 'none',
  printPalette: 'carnival',
  printRule: 'scatter',
  printSeed: 1,
  printTones: 6,
  printShade: 0,
  printGrout: DEFAULT_GROUT,
  printWhite: true,
  printVarnish: true,
  printColors: DEFAULT_PRINT_COLOURS,
  printImage: '',
  printFit: 'cover',
  printOverlay: true,
  printOverlayInk: '#ffffff',
  printOverlayDensity: 55,
  sheetWidth: 1220,
  sheetHeight: 2440,
  assembly: 100,
};

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}

/**
 * A magnitude with a fallback. `clamp` floors anything non-finite at `min`,
 * which is the right answer for a slider that has always existed and the wrong
 * one for a field added later: a design saved before the lighting options
 * arrives here with them undefined, and flooring the web at 2 mm would quietly
 * hand it a wall with no material left between the cut-outs.
 */
function size(value: number, fallback: number, min: number, max: number): number {
  return clamp(Number.isFinite(value) ? Math.abs(value) : fallback, min, max);
}

/** The nearest value on a list of the sizes a thing is actually sold in. */
function snap(value: number, steps: number[]): number {
  return steps.reduce((best, step) => (Math.abs(step - value) < Math.abs(best - value) ? step : best), steps[0]);
}

/** Every field is slider- or keyboard-driven, so nothing downstream may assume a sane value. */
export function normalizePlanter(parameters: PlanterParameters): PlanterParameters {
  const span = (value: number) => clamp(Math.abs(value), 60, 4000);
  // Resolved before the rest, because the stock decides what some of the other
  // fields are even allowed to be. A design saved before the field existed
  // arrives with it undefined and gets the house sheet.
  const material = getMaterial(parameters.material);
  return {
    ...parameters,
    material: material.id,
    // 0 is the auto bit — every crease grooved with the angle it needs. Anything
    // else is one real bit, and 20-170 is the range one can be ground to.
    vBitAngle: parameters.vBitAngle > 0 ? clamp(parameters.vBitAngle, 20, 170) : 0,
    // A saved design predates whatever construction modes exist today, so an
    // unknown one falls back to the single blank rather than planning a split
    // nobody asked for.
    construction: CONSTRUCTIONS.includes(parameters.construction) ? parameters.construction : 'single-sheet',
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
    // Floored at one thickness plus a working fit, and the slider does not get
    // a say: the plate is inset from the OUTSIDE of the foot ring, so anything
    // less than the wall is thick describes a plate that cannot pass the hole
    // it is meant to drop through. On 4 mm stock a 3 mm inset is 1 mm of steel
    // short of fitting, and nothing about the drawing would have said so.
    baseInset: clamp(Math.abs(parameters.baseInset), material.thickness + BASE_FIT, 40),
    baseTab: clamp(Math.abs(parameters.baseTab), 0, 60),
    rimTab: clamp(Math.abs(parameters.rimTab), 0, 60),
    perforation: PERFORATIONS.includes(parameters.perforation) ? parameters.perforation : 'none',
    perfDensity: Math.round(size(parameters.perfDensity, 2, 1, 8)),
    perfOpening: size(parameters.perfOpening, 18, 4, 90),
    perfPicked: Math.round(size(parameters.perfPicked, 0, 0, 64)),
    perfLift: size(parameters.perfLift, 32, 0, 90),
    perfWeb: size(parameters.perfWeb, 14, 3, 60),
    perfMargin: size(parameters.perfMargin, 22, 5, 120),
    perfTool: size(parameters.perfTool, 6, 1, 20),
    perfSkirt: size(parameters.perfSkirt, 70, 0, 2000),
    perfFade: size(parameters.perfFade, 0, 0, 2000),
    liner: parameters.liner === true,
    cavity: size(parameters.cavity, 22, 6, 200),
    solar: parameters.solar === true,
    solarWidth: size(parameters.solarWidth, 110, 30, 600),
    solarLength: size(parameters.solarLength, 70, 30, 600),
    led: LEDS.includes(parameters.led) ? parameters.led : 'none',
    // Snapped rather than clamped: 30, 60 and 144 are the strips that exist,
    // and a power budget quoted off 47 LEDs a metre is a budget for nothing.
    ledDensity: snap(size(parameters.ledDensity, 60, 30, 144), LED_DENSITIES),
    ledRuns: Math.round(size(parameters.ledRuns, 1, 1, 6)),
    ledBrightness: size(parameters.ledBrightness, 60, 5, 100),
    ledHours: size(parameters.ledHours, 6, 1, 14),
    ledEffect: EFFECT_IDS.includes(parameters.ledEffect) ? parameters.ledEffect : 'static',
    ledSpeed: size(parameters.ledSpeed, 50, 5, 100),
    // A colour is either six hex digits or it is not a colour.
    ledColor: /^#[0-9a-f]{6}$/i.test(String(parameters.ledColor)) ? parameters.ledColor : '#28d8ff',
    ledController: CONTROLLERS.includes(parameters.ledController) ? parameters.ledController : 'wled',
    ledPosition: POSITIONS.includes(parameters.ledPosition) ? parameters.ledPosition : 'wall',
    // An unknown id is an unpainted pot, not a crash: the catalogue is a folder
    // of textures, and a design saved against a stone the shop has since
    // dropped has to still open.
    stone: stoneById(parameters.stone) ? parameters.stone : 'none',
    // The cap the shop set, enforced here rather than at the slider — a design
    // arriving from a saved file or a URL gets the same 10 mm ceiling.
    stoneCoat: size(parameters.stoneCoat, 6, 0, MAX_COAT_MM),
    stoneRelief: size(parameters.stoneRelief, 100, 0, 100),
    stoneTone: size(parameters.stoneTone, 35, 0, 100),
    stoneTint: /^#[0-9a-f]{6}$/i.test(String(parameters.stoneTint)) ? parameters.stoneTint : '#ffffff',
    stoneSeal: STONE_SEALS.includes(parameters.stoneSeal) ? parameters.stoneSeal : 'matte',
    print: PRINT_MODES.includes(parameters.print) ? parameters.print : 'none',
    // An unknown palette opens on the first one rather than on nothing, for the
    // same reason an unknown stone opens unpainted: a design saved against a
    // shelf the shop has since re-cut still has to open.
    printPalette: parameters.printPalette === CUSTOM_PALETTE || paletteById(parameters.printPalette)
      ? parameters.printPalette
      : PRINT_PALETTES[0].id,
    printRule: PRINT_RULES.includes(parameters.printRule) ? parameters.printRule : 'scatter',
    // Whole, and bounded: the seed is an identity, not a measurement, and one
    // that arrives as 1e21 from a mangled URL has to still name a pot.
    printSeed: Math.round(size(parameters.printSeed, 1, 0, 999_999)),
    printTones: Math.round(size(parameters.printTones, MAX_PRINT_TONES, 2, MAX_PRINT_TONES)),
    printShade: size(parameters.printShade, 0, 0, 100),
    printGrout: size(parameters.printGrout, DEFAULT_GROUT, 0, MAX_GROUT),
    printWhite: parameters.printWhite !== false,
    printVarnish: parameters.printVarnish !== false,
    // Always six, always colours. A short or dirty list is filled from the
    // house palette slot by slot rather than rejected, so a half-edited custom
    // shelf still prints something the shop can mix.
    printColors: Array.from({ length: DEFAULT_PRINT_COLOURS.length }, (_, i) => {
      const picked = Array.isArray(parameters.printColors) ? parameters.printColors[i] : undefined;
      return isHex(picked) ? String(picked).toLowerCase() : DEFAULT_PRINT_COLOURS[i];
    }),
    // Only what a flatbed RIP will actually take, and only as a data URL: this
    // string ends up inside an exported file, so a stray `javascript:` or a
    // remote link would leave the shop holding artwork that is not artwork.
    printImage: /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(String(parameters.printImage ?? ''))
      ? parameters.printImage
      : '',
    printFit: PRINT_FITS.includes(parameters.printFit) ? parameters.printFit : 'cover',
    printOverlay: parameters.printOverlay !== false,
    printOverlayInk: isHex(parameters.printOverlayInk) ? parameters.printOverlayInk : '#ffffff',
    printOverlayDensity: size(parameters.printOverlayDensity, 55, 0, 100),
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
const add3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale3 = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
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

// ---------------------------------------------------------------------------
// Thickness
// ---------------------------------------------------------------------------

/**
 * The inside face of the wall — every vertex pushed in by one thickness.
 *
 * Pushing a corner in is not the same as pushing a face in. Offset two facets
 * that meet at a crease and the offset copies no longer touch: each has moved
 * along its own normal, and at the crease they cross. The corner that is
 * actually there is where they cross, which is further in than one thickness by
 * exactly one over the cosine of the half-angle — the mitre. Ignore it and the
 * inside of every crease is drawn with a notch out of it and the wall reads as
 * thinner at the corners than it is anywhere else, which is backwards.
 *
 * The distance is taken against the DEEPEST incident facet rather than the
 * average, so the result is never closer than one thickness to any face it
 * belongs to: a wall may come out a hair heavy at an awkward corner, never
 * thinner than the stock it is cut from.
 */
function innerVertices(rings: Vec3[][], triangles: Triangle[], stride: number, thickness: number): Vec3[][] {
  const sides = stride - 1;
  const at = (id: number) => rings[Math.floor(id / stride)][id % stride];
  // Column `sides` repeats column 0 at the seam, so the two ids are one physical
  // corner and have to be mitred as one — otherwise the seam gets two different
  // inside corners and the wall splits open along it.
  const key = (id: number) => `${Math.floor(id / stride)}:${(id % stride) % sides}`;
  const acc = new Map<string, { sum: Vec3; faces: Vec3[] }>();

  for (const triangle of triangles) {
    const [a, b, c] = triangle.v;
    for (const [self, u, v] of [[a, b, c], [b, c, a], [c, a, b]] as [number, number, number][]) {
      // Angle-weighted, so a sliver facet does not pull the corner round as hard
      // as the broad one beside it does.
      const e1 = sub(at(u), at(self));
      const e2 = sub(at(v), at(self));
      const l1 = Math.hypot(e1.x, e1.y, e1.z);
      const l2 = Math.hypot(e2.x, e2.y, e2.z);
      if (l1 < EPSILON || l2 < EPSILON) continue;
      const weight = Math.acos(clamp(dot(e1, e2) / (l1 * l2), -1, 1));
      const entry = acc.get(key(self)) ?? { sum: { x: 0, y: 0, z: 0 }, faces: [] };
      entry.sum = add3(entry.sum, scale3(triangle.normal, weight));
      entry.faces.push(triangle.normal);
      acc.set(key(self), entry);
    }
  }

  return rings.map((ring, k) => ring.map((point, i) => {
    const entry = acc.get(`${k}:${i % sides}`);
    if (!entry || thickness <= 0) return { ...point };
    const n = unit(entry.sum);
    if (Math.hypot(n.x, n.y, n.z) < 0.5) return { ...point };
    const grip = entry.faces.reduce((worst, face) => Math.min(worst, dot(n, face)), 1);
    const reach = thickness / Math.max(grip, 1 / MITRE_LIMIT);
    return { x: point.x - n.x * reach, y: point.y - n.y * reach, z: point.z - n.z * reach };
  }));
}

/** Volume enclosed by a stack of rings, summed frustum by frustum (mm3). */
function enclosedVolume(rings: Vec3[][], sides: number, rows: number): number {
  let volume = 0;
  for (let k = 0; k < rows; k += 1) {
    const lower = Math.abs(polygonArea(flatten(rings[k], sides)));
    const upper = Math.abs(polygonArea(flatten(rings[k + 1], sides)));
    const rise = rings[k + 1][0].z - rings[k][0].z;
    volume += (rise / 3) * (lower + upper + Math.sqrt(lower * upper));
  }
  return volume;
}

/**
 * The biggest circle that fits the tightest facet on the wall, as a radius.
 *
 * The honest measure of "how much room is there between one crease and the
 * next", and the reason it is a circle rather than an edge length: a long thin
 * sliver and a squat triangle can have the same longest edge and nothing else
 * in common. A ribbed eight-sided column has facets a fraction of the size a
 * one-band box has, so anything sized off the pot instead of off this swallows
 * them whole.
 */
function facetInradius(triangles: Triangle[], rings: Vec3[][], stride: number): number {
  return triangles.reduce((smallest, triangle) => {
    const [a, b, c] = triangle.v.map((id) => rings[Math.floor(id / stride)][id % stride]);
    const sides = [dist3(a, b), dist3(b, c), dist3(c, a)];
    const half = (sides[0] + sides[1] + sides[2]) / 2;
    const area = Math.sqrt(Math.max(0, half * (half - sides[0]) * (half - sides[1]) * (half - sides[2])));
    return Math.min(smallest, half > EPSILON ? area / half : 0);
  }, Infinity);
}

/** Narrowest way across a ring — what a root ball has to pass, not its diagonal. */
function ringInradius(ring: Vec2[]): number {
  const cx = ring.reduce((sum, p) => sum + p.x, 0) / (ring.length || 1);
  const cy = ring.reduce((sum, p) => sum + p.y, 0) / (ring.length || 1);
  let least = Infinity;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const span = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    least = Math.min(least, Math.abs((b.x - a.x) * (a.y - cy) - (a.x - cx) * (b.y - a.y)) / span);
  }
  return Number.isFinite(least) ? least : 0;
}

/**
 * What the V-bit does at every crease.
 *
 * Depth is fixed by the stock: cut down to the residual skin and no further,
 * because that skin is the hinge and cutting through it leaves two parts
 * instead of a fold. Width follows from the depth and the bit, and the bit is
 * either the one fitted for the job or — at 0 — whatever each crease needs,
 * in which case the widest cut on the drawing is the one the steepest crease asks
 * for. Acrylic is not grooved at all: it crazes at a sharp crease and is bent
 * hot over a former instead, so there the cut is nothing and the fold is a radius.
 */
function planterGroove(material: MaterialSpec, bit: number, maxBend: number): PlanterGroove {
  const heatBent = material.foldMethod === "heat-bend";
  const depth = heatBent ? 0 : Math.max(0, material.thickness - material.residualSkin);
  const angle = clamp(bit > 0 ? bit : maxBend, 1, 179);
  return {
    depth,
    width: heatBent ? 0 : 2 * depth * Math.tan((angle / 2) / DEG),
    skin: heatBent ? material.thickness : Math.min(material.thickness, material.residualSkin),
    bit,
    // A V-groove does not fold to a point: it folds over whatever is left under
    // it. A heat bend folds over the former, which is a bigger radius on purpose.
    radius: heatBent ? material.minRadius : Math.min(material.thickness, material.residualSkin),
    heatBent,
  };
}

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
 * Flatten bands `from`..`to` as one blank, returning one row per ring it touches —
 * `from` up to `to + 1` — in that blank's own frame.
 *
 * The lowest band is walked as a strip, so it comes out exactly: a frustum fans
 * into an arc, a staggered band into a zigzag, with no assumption that the foot
 * edge is straight. Every band above it hangs each facet off the ring edge below,
 * which keeps the ring creases exact and stops the closure error of a
 * non-developable run piling up at the seam: it stays spread thinly across the
 * band, where `segmentError` reports it.
 */
function unfoldSegment(unfolder: Unfolder, from: number, to: number): Vec2[][] {
  const { triangles, sides, rows } = unfolder;
  const stride = sides + 1;
  const flat: (Vec2 | null)[] = new Array((rows + 1) * stride).fill(null);

  unfoldStrip(unfolder, from, flat, true);
  for (let k = from + 1; k <= to; k += 1) {
    for (let i = 0; i < sides; i += 1) placeCorner(unfolder, flat, triangles[(k * sides + i) * 2]);
    for (let i = 0; i < sides; i += 1) placeCorner(unfolder, flat, triangles[((k * sides + i) * 2) + 1]);
  }

  const grid: Vec2[][] = [];
  for (let k = from; k <= to + 1; k += 1) {
    grid.push(Array.from({ length: stride }, (_, i) => flat[k * stride + i] ?? { x: 0, y: 0 }));
  }
  return grid;
}

/**
 * The worst gap, in mm, between an edge of the solid pot and the same edge in a
 * development of bands `from`..`to`.
 *
 * Zero means that run of bands folds exactly out of one blank. Anything else is
 * material the blank would have to find from somewhere as it closed, and the
 * stock this shop cuts does not stretch. So this is not a quality score to be
 * traded off against something else: it is the test of whether the part can be
 * made at all.
 */
function segmentError(unfolder: Unfolder, from: number, to: number): number {
  const { rings, triangles, sides } = unfolder;
  const stride = sides + 1;
  const at = (id: number) => rings[Math.floor(id / stride)][id % stride];
  const grid = unfoldSegment(unfolder, from, to);
  const flat = (id: number) => grid[Math.floor(id / stride) - from][id % stride];

  let worst = 0;
  for (let k = from; k <= to; k += 1) {
    for (let t = 0; t < sides * 2; t += 1) {
      const [a, b, c] = triangles[k * sides * 2 + t].v;
      for (const [p, q] of [[a, b], [b, c], [c, a]] as [number, number][]) {
        worst = Math.max(worst, Math.abs(dist2(flat(p), flat(q)) - dist3(at(p), at(q))));
      }
    }
  }
  return worst;
}

/**
 * Which runs of bands are cut as separate blanks, low to high and inclusive at
 * both ends. A single entry spanning every band is a wall that folds out of one
 * sheet; each extra entry is one more riveted ring joint.
 *
 * Curvature on this wall lives at the ring joints. A vertex on a ring in the
 * middle of a blank is ringed by its own facets, so whatever angle defect the
 * design left there has nowhere to go and the blank cannot close. Cut that ring
 * and the same vertices land on an edge of two smaller blanks, free to open by
 * exactly the defect — which is why a single band always develops, every one of
 * its vertices being on its boundary.
 *
 * So `split` walks up the wall taking the longest run that still develops inside
 * `DEVELOPMENT_TOLERANCE` and cuts only where the next band would break it.
 * Extending a run can only add mismatch — the facets already placed do not move
 * when another band is hung off them — so the greedy run is the longest one
 * available, and taking the longest run every time gives the fewest parts that
 * exist. `banded` cuts every joint whether it carries curvature or not: always
 * safe, and on a gently curved wall two or three rivet lines more than the pot
 * actually needs.
 */
function planWallParts(unfolder: Unfolder, construction: PlanterConstruction): PlanterWallPart[] {
  const { rows } = unfolder;
  if (construction === 'banded') return Array.from({ length: rows }, (_, k) => ({ from: k, to: k }));
  if (construction !== 'split') return [{ from: 0, to: rows - 1 }];

  const parts: PlanterWallPart[] = [];
  for (let from = 0; from < rows;) {
    let to = from;
    while (to + 1 < rows && segmentError(unfolder, from, to + 1) <= DEVELOPMENT_TOLERANCE) to += 1;
    parts.push({ from, to });
    from = to + 1;
  }
  return parts;
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
  id: string, label: string, outline: Vec2[], folds: FoldLine[], holes: Vec2[][],
  flaps: Vec2[][] = [],
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
    holes: holes.map((hole) => hole.map((point) => ({ x: point.x - origin.x, y: point.y - origin.y }))),
    flaps: flaps.map((flap) => flap.map((point) => ({ x: point.x - origin.x, y: point.y - origin.y }))),
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
 * How far a tab is cut back at each end.
 *
 * Tabs that fold in to lie in one plane — the foot's under the base plate, the
 * mouth's under the collar — all arrive in that plane together, and at every
 * corner of the ring two neighbours want the same material. Mitring each back by
 * `w · tan(π/n)` lands them on the corner bisector, meeting instead of fighting;
 * `TAB_RELIEF` on top is the gap they need to clear each other coming down.
 *
 * A tab that folds against the wall above it instead lands on its own facet, so
 * a neighbour on the next facet is already out of its way — that one only needs
 * the clearance, which is what `TAB_RELIEF` alone gives.
 */
function mitreRelief(width: number, sides: number): number {
  return width * Math.tan(Math.PI / Math.max(3, sides)) + TAB_RELIEF;
}

/**
 * Rivet tabs along a ring joint, walked in the direction `line` is given in. One
 * tab per segment rather than a single flange: a staggered ring develops as a
 * zigzag, and a flange can only fold along a straight line — so each segment gets
 * its own tab, cut back at both ends by `relief` so neighbours clear each other
 * as they fold in.
 */
function jointTabs(line: Vec2[], body: Vec2[], width: number, relief: number): { outline: Vec2[]; folds: Vec2[][] } {
  if (width <= 0.5) return { outline: line.slice(), folds: [] };
  const outline: Vec2[] = [];
  const folds: Vec2[][] = [];

  for (let i = 0; i < line.length - 1; i += 1) {
    const a = line[i];
    const b = line[i + 1];
    const length = dist2(a, b) || EPSILON;
    // Whatever the corner asks for, the tab has to survive it.
    const cut = Math.min(relief, length * 0.45);
    const dirX = (b.x - a.x) / length;
    const dirY = (b.y - a.y) / length;
    let nx = -dirY;
    let ny = dirX;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (nx * (body[i].x - mid.x) + ny * (body[i].y - mid.y) > 0) { nx = -nx; ny = -ny; }
    outline.push(a);
    outline.push({ x: a.x + nx * width + dirX * cut, y: a.y + ny * width + dirY * cut });
    outline.push({ x: b.x + nx * width - dirX * cut, y: b.y + ny * width - dirY * cut });
    folds.push([a, b]);
  }
  outline.push(line[line.length - 1]);
  return { outline, folds };
}

/**
 * A run of creases that all turn through the same angle.
 *
 * Every one of these is a tab or a plate edge, and a tab is folded square so it
 * has something to rivet through — so unless told otherwise the bend is 90, and
 * the drawing can name a bit for these lines exactly as it does for the wall.
 */
function creaseLines(prefix: string, pairs: Vec2[][], kind: FoldKind, bend = 90): FoldLine[] {
  return pairs.map(([a, b], i) => ({ id: `${prefix}-${i}`, kind, bend, x1: a.x, y1: a.y, x2: b.x, y2: b.y }));
}

/**
 * One run of bands as one blank: the outline the cutter follows, the creases the
 * V-bit grooves inside it, and nothing in between. A run that covers the whole
 * wall is the tube slit open, every ring joint a crease; a shorter run stops at a
 * ring that the design's curvature will not let a blank cross, and that ring
 * becomes a cut edge with a rivet tab on it.
 *
 * Which is the distinction that matters when reading the drawing: a line inside
 * this outline is grooved and stays attached, and the only lines the cutter parts
 * are the outline itself. The foot and mouth are not left as plain cut edges
 * either — the base plate and the collar are separate pieces, and without a tab
 * folding in to meet them there is nothing to rivet or glue either one to.
 */
function wallPartPiece(
  parameters: PlanterParameters, part: PlanterWallPart, parts: number, rings: Vec2[][],
  edges: WallEdge[], cells: Vec2[][], flaps: Vec2[][],
): PlanterPiece {
  const { sides, rows, tabWidth, jointTab, baseTab, rimTab } = parameters;
  const { from, to } = part;
  const stride = sides + 1;
  const top = rings.length - 1;
  const ringOf = (id: number) => Math.floor(id / stride);
  const point = (id: number) => rings[ringOf(id) - from][id % stride];

  // Crease ids are the drawing's layer names, so a wall that came off one blank
  // keeps the unqualified names it has always had, and a wall in parts qualifies
  // every name with the band its part starts at — two parts can carry the same
  // crease of the same facet, and the two are not the same line.
  const whole = parts === 1;
  const tag = whole ? '' : `-${from}`;

  // The bottom part's foot is the wall's actual foot, not an internal joint — tab
  // it inward with `baseTab` so the base plate has something to land on. A part
  // that starts higher up leaves its foot plain: the part below already carries
  // the tab that this one rivets to.
  const foot = from === 0
    ? jointTabs(rings[0], rings[1], baseTab, mitreRelief(baseTab, sides))
    : { outline: rings[0].slice(), folds: [] as Vec2[][] };
  const outline: Vec2[] = [...foot.outline];
  const folds: FoldLine[] = [...creaseLines(`foot${tag}`, foot.folds, 'valley')];

  // Up the right-hand seam. The top ring is left off — the joint below walks it
  // back the other way.
  for (let k = 1; k < top; k += 1) outline.push(rings[k][sides]);

  // The top part's mouth is likewise the wall's actual mouth: tabbed with
  // `rimTab` so the collar has something to land on, rather than left bare. A
  // distinct id prefix from here on — it rivets to the collar, not to a
  // neighbouring part, so it is not one of the wall's internal `joints`.
  // The mouth's tabs fold down into the collar's plane alongside each other, so
  // they mitre; an internal ring joint's fold against the part above, each onto
  // its own facet, so they only have to clear each other's thickness.
  const isMouth = to === rows - 1;
  const joint = isMouth
    ? jointTabs(rings[top], rings[top - 1], rimTab, mitreRelief(rimTab, sides))
    : jointTabs(rings[top], rings[top - 1], jointTab, TAB_RELIEF);
  outline.push(...joint.outline.slice().reverse());
  folds.push(...creaseLines(whole ? 'mouth' : `${isMouth ? 'rim' : 'joint'}-${from}`, joint.folds, 'valley'));

  const tab = seamTab(rings.map((ring) => ring[0]), rings.map((ring) => ring[1]), tabWidth);
  if (tab.outline.length > 0) {
    outline.push(...tab.outline);
    folds.push(...creaseLines(`tab${tag}`, tab.folds, 'valley'));
  } else {
    for (let k = top - 1; k >= 1; k -= 1) outline.push(rings[k][0]);
  }

  // Creases inside this part only. Its own two ring edges are cut lines, so a
  // fold drawn along one of them would be a fold across a rivet line — which is
  // exactly the line the preview must not be able to open.
  folds.push(...edges
    .filter((edge) => edge.kind !== 'cut' && edge.bend > FLAT_CREASE)
    .filter((edge) => {
      const low = ringOf(edge.a);
      const high = ringOf(edge.b);
      if (low < from || high > to + 1) return false;
      return !(low === high && (low === from || low === to + 1));
    })
    // The angle rides on the line itself, not only in a summary. A drawing that
    // says "fold here" without saying how far cannot be sent to a tool: the bit
    // has to match the bend or the groove never shuts on itself, and on a
    // planter every crease bends a different amount.
    .map((edge, n) => ({
      id: `${whole ? 'wall' : `band${from}`}-${n}`, kind: edge.kind, bend: edge.bend,
      x1: point(edge.a).x, y1: point(edge.a).y, x2: point(edge.b).x, y2: point(edge.b).y,
    })));

  // Each petal hinges on its own crease, bent out by hand after cutting.
  folds.push(...creaseLines(`flap${tag}`, flaps.map((flap) => [flap[0], flap[1]]), 'mountain'));

  const label = whole
    ? 'Wall — fold up'
    : from === to ? `Band ${from + 1} / ${rows}` : `Bands ${from + 1}–${to + 1} / ${rows}`;
  return finishPiece(whole ? 'wall' : `band-${from}`, label, outline, folds, cells, flaps);
}

function basePiece(parameters: PlanterParameters, rings: Vec3[][], drained: boolean): PlanterPiece {
  const foot = flatten(rings[0], parameters.sides);
  const plate = insetConvex(foot, parameters.baseInset);
  // Planted directly, this floor is drilled on site to suit whatever goes in
  // it. Under a liner it is the bottom of a sealed cavity, and water arriving
  // from the liner's own drain holes has to be able to leave the pot — so the
  // holes are cut here, wider than the liner's so a blocked one above cannot
  // turn the light cavity into the sump.
  const drains = drained
    ? drainRing(centroid(plate), inradius(plate) * 0.62, DRAIN_HOLES, DRAIN_DIAMETER + 4)
    : [];
  return finishPiece('base', 'Base plate', plate, [], drains);
}

/**
 * The window the solar panel shows through, milled into the collar.
 *
 * It is cut `SOLAR_LIP` smaller than the panel all round, so the panel beds up
 * under the collar and sits on that lip instead of dropping through — which is
 * also what keeps the weather out of the joint. The cable goes down the same
 * window, into the cavity, so nothing else has to be cut for it.
 *
 * Returns null when the collar cannot carry the panel. Cutting it anyway would
 * take the collar out at its narrowest point, so the honest answer is to cut
 * nothing and let the checks say why.
 */
/** Does the panel's own body land on a collar band `band` wide, on a flat `edge` long? */
function solarFits(parameters: PlanterParameters, edge: number, band: number): boolean {
  return parameters.solarWidth + SOLAR_EDGE * 2 <= edge
    && parameters.solarLength + SOLAR_EDGE * 2 <= band;
}

/** The collar band and its longest flat — what the panel has to fit inside. */
function collarBand(parameters: PlanterParameters, rings: Vec3[][]): { band: number; edge: number } {
  const mouth = flatten(rings[parameters.rows], parameters.sides);
  const edgeOf = (i: number) => dist2(mouth[i], mouth[(i + 1) % mouth.length]);
  return {
    band: Math.min(parameters.rimWidth, Math.max(0, inradius(mouth) - MIN_OPENING)),
    edge: mouth.reduce((longest, _, i) => Math.max(longest, edgeOf(i)), 0),
  };
}

function solarWindow(parameters: PlanterParameters, mouth: Vec2[], band: number): Vec2[] | null {
  const across = parameters.solarWidth - SOLAR_LIP * 2;
  const along = parameters.solarLength - SOLAR_LIP * 2;
  if (across <= 0 || along <= 0) return null;

  // The panel goes on the collar's longest flat: on a rectangle that is a long
  // side rather than an end, and on a regular polygon they are all alike.
  let best = 0;
  const edgeOf = (i: number) => dist2(mouth[i], mouth[(i + 1) % mouth.length]);
  for (let i = 1; i < mouth.length; i += 1) if (edgeOf(i) > edgeOf(best)) best = i;

  const a = mouth[best];
  const b = mouth[(best + 1) % mouth.length];
  const edge = edgeOf(best) || EPSILON;
  // What has to fit is the panel, not the window. The panel beds up under the
  // collar, so its whole body lands on that band — a window sized to clear
  // while the panel it carries overhangs the opening is no use to anybody.
  if (!solarFits(parameters, edge, band)) return null;

  const direction = { x: (b.x - a.x) / edge, y: (b.y - a.y) / edge };
  const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const centre = centroid(mouth);
  let nx = -direction.y;
  let ny = direction.x;
  if (nx * (centre.x - middle.x) + ny * (centre.y - middle.y) < 0) { nx = -nx; ny = -ny; }

  return roundedRect(
    { x: middle.x + nx * (band / 2), y: middle.y + ny * (band / 2) },
    direction, across, along, parameters.perfTool / 2,
  );
}

function rimPiece(parameters: PlanterParameters, rings: Vec3[][]): PlanterPiece {
  const mouth = flatten(rings[parameters.rows], parameters.sides);
  // The opening follows the mouth it is cut from — a hexagonal pot gets a
  // hexagonal hole, a rectangular one a rectangular hole — so the collar reads as
  // one band of even width rather than a round hole punched through a polygon.
  // Width is measured in from the flats, which is where that band runs narrowest.
  const inset = Math.min(parameters.rimWidth, Math.max(0, inradius(mouth) - MIN_OPENING));
  // The planting hole stays hole 0: the stats and the preview both read the
  // opening off it by index, and the panel window is an extra, not a swap.
  const holes = [insetConvex(mouth, inset)];
  if (parameters.solar) {
    const window = solarWindow(parameters, mouth, inset);
    if (window) holes.push(window);
  }
  return finishPiece('rim', 'Top collar', mouth, [], holes);
}

// ---------------------------------------------------------------------------
// Lighting
// ---------------------------------------------------------------------------

/**
 * How big the soil box can be, and how much room it leaves around itself.
 *
 * The box is a plain prism on the pot's own footprint — see `PlanterLiner` for
 * why it is not a second copy of the pot — so the only thing to decide is how
 * far to scale that footprint down. Every facet of the wall is a plane, and a
 * vertical prism clears a plane over some stretch of height if it clears it at
 * the one end of that stretch the plane leans away from. Taking the tightest
 * answer over every facet is the largest box that keeps `cavity` all the way
 * round, all the way up.
 *
 * Working off the facet's plane rather than the facet itself is a shade
 * stricter than it strictly has to be on a staggered wall, where the plane
 * carries on past the triangle that generated it. Strict is the right way to be
 * wrong about a gap that a live cable has to run through.
 */
function measureLiner(
  parameters: PlanterParameters, rings: Vec3[][], triangles: Triangle[], stride: number,
): PlanterLiner | null {
  const { sides, height, rimTab, cavity } = parameters;
  // The rim stops below the mouth tabs, so the collar covers the soil line and
  // the box is never part of the silhouette.
  const top = Math.max(height * 0.4, height - (rimTab + LINER_HEADROOM));
  const profile = flatten(rings[0], sides);
  const at = (id: number) => rings[Math.floor(id / stride)][id % stride];
  const support = (poly: Vec2[], nx: number, ny: number) =>
    poly.reduce((best, point) => Math.max(best, point.x * nx + point.y * ny), -Infinity);

  const faces: { d: number; nx: number; ny: number; nz: number; worst: number }[] = [];
  for (const triangle of triangles) {
    const normal = triangle.normal;
    if (Math.hypot(normal.x, normal.y) < EPSILON) continue;
    const heights = triangle.v.map((id) => at(id).z);
    const low = Math.max(0, Math.min(...heights));
    const high = Math.min(top, Math.max(...heights));
    if (high < low) continue;
    const point = at(triangle.v[0]);
    faces.push({
      d: normal.x * point.x + normal.y * point.y + normal.z * point.z,
      nx: normal.x, ny: normal.y, nz: normal.z,
      worst: normal.z > 0 ? high : low,
    });
  }

  let scale = Infinity;
  for (const face of faces) {
    const reach = support(profile, face.nx, face.ny);
    if (reach <= EPSILON) continue;
    scale = Math.min(scale, (face.d - face.nz * face.worst - cavity) / reach);
  }
  if (!Number.isFinite(scale) || scale <= 0) return null;

  const section = profile.map((point) => ({ x: point.x * scale, y: point.y * scale }));
  let mouthGap = Infinity;
  for (const face of faces) {
    if (Math.abs(face.worst - top) > EPSILON) continue;
    mouthGap = Math.min(mouthGap, face.d - face.nz * top - support(section, face.nx, face.ny));
  }

  return {
    inradius: inradius(section),
    section,
    height: top,
    mouthGap: Number.isFinite(mouthGap) ? mouthGap : cavity,
    litres: (Math.abs(polygonArea(section)) * top) / 1_000_000,
  };
}

/**
 * The soil box as parts: a wall and a floor.
 *
 * A prism develops to a rectangle with a crease at every corner, so this needs
 * no unfolding and carries no development error — which is the whole reason the
 * box is a prism. It closes on the same kind of seam tab the pot's wall uses
 * and lands on its floor through the same kind of fold-in tabs, so it is built
 * on the bench exactly the way the pot around it is.
 */
function linerPieces(parameters: PlanterParameters, liner: PlanterLiner): PlanterPiece[] {
  const { sides, tabWidth, baseTab, baseInset } = parameters;
  const { section, height } = liner;

  const run: number[] = [0];
  for (let i = 0; i < sides; i += 1) run.push(run[i] + dist2(section[i], section[(i + 1) % sides]));
  const below = run.map((x) => ({ x, y: 0 }));
  const above = run.map((x) => ({ x, y: height }));

  const foot = jointTabs(below, above, baseTab, mitreRelief(baseTab, sides));
  const outline: Vec2[] = [...foot.outline];
  const folds: FoldLine[] = [...creaseLines('liner-foot', foot.folds, 'valley')];

  // Up the right-hand seam and back along the rim, which stays a plain cut edge
  // — nothing lands on it, and a tab there would show above the soil.
  for (let i = sides; i >= 0; i -= 1) outline.push(above[i]);

  const tab = seamTab([below[0], above[0]], [below[1], above[1]], tabWidth);
  outline.push(...tab.outline);
  folds.push(...creaseLines('liner-tab', tab.folds, 'valley'));

  folds.push(...creaseLines(
    'liner-corner',
    run.slice(1, sides).map((x) => [{ x, y: 0 }, { x, y: height }]),
    'mountain',
  ));

  const floor = insetConvex(section, baseInset);
  return [
    finishPiece('liner-wall', 'Liner wall — fold up', outline, folds, []),
    finishPiece('liner-base', 'Liner floor', floor, [],
      drainRing(centroid(floor), inradius(floor) * 0.55, DRAIN_HOLES, DRAIN_DIAMETER)),
  ];
}

interface WallPerforation {
  /** Cut-outs per triangle, indexed like `triangles`, in construction coordinates. */
  cells: Vec2[][][];
  /** Cut-and-fold petals per triangle, hinge ends first. */
  flaps: Vec2[][][];
  dropped: number;
  /** Share of the wall's area opened up, 0–1. */
  openArea: number;
}

/**
 * How closely two facets have to agree before one's pattern is stamped onto the
 * other (mm). Two hundredths: a good router holds about ±0.05 mm on a long
 * move, so facets that agree this closely are the same facet as far as the
 * machine is concerned, and the pattern they share is drawn to within less than
 * the cutter's own accuracy of the pattern each would have been given alone.
 */
/**
 * The strip, its draw, and whether the panel on the collar can carry it.
 *
 * Everything is measured off the pot rather than assumed: the run length comes
 * from the box the strip is bonded to, the LED count from that length and the
 * strip's own density, and the harvest from the panel that was actually let
 * into the collar. A panel that did not fit brings in nothing, which is the
 * point — a light that cannot charge is worth knowing about before it is cut.
 *
 * Note the two wattages. `peakWatts` is what the driver and the wiring have to
 * survive; `watts` is what the pot is actually run at, and it is the one the
 * battery and the panel are sized against. Quoting one number for both is how
 * solar garden lights end up dark by ten o'clock.
 */
function measureLighting(
  parameters: PlanterParameters,
  rings: Vec3[][],
  liner: PlanterLiner | null,
  panelCut: boolean,
): PlanterLighting | null {
  if (parameters.led === 'none') return null;
  const spec = LED_SPECS[parameters.led];

  // Where it is mounted is what it is long. These are three different circuits
  // round three different sections of the same pot, and on anything tapered
  // they are not close: a rim run round a wide mouth can be half as long again
  // as a foot run round a narrow base.
  const mouth = flatten(rings[parameters.rows], parameters.sides);
  const foot = insetConvex(flatten(rings[0], parameters.sides), STRIP_CLEARANCE);
  const wall = liner
    // Bonded to the outside face of the soil box, looking at the cut-outs.
    ? liner.section
    // With no box it has no face of its own, so it is quoted round the foot.
    : foot;
  const path = parameters.ledPosition === 'rim'
    // Tucked up inside the collar, facing down — the line the collar's own
    // opening is cut on, which is where the channel lands.
    ? insetConvex(mouth, parameters.rimWidth)
    : parameters.ledPosition === 'foot' ? foot : wall;
  const length = perimeter(path) * parameters.ledRuns;
  const leds = Math.round((length / 1000) * parameters.ledDensity);

  const peakWatts = leds * spec.watts;
  const level = parameters.ledBrightness / 100;
  // Every pixel on at the brightness set — what the eye sees when the mode has
  // them all lit, and the honest basis for a lumen figure.
  const full = peakWatts * level;

  // A mode only exists where something is driving the pixels one by one. A
  // white strip has a single state, and an addressable one with no controller
  // is an expensive way to light one colour; both average full output. Where a
  // mode is running, it lights a share of the strip at a time, and that share
  // is what the night actually costs.
  const effect: PlanterLedEffect = spec.addressable && parameters.ledController !== 'none'
    ? parameters.ledEffect
    : 'static';
  const duty = getLedEffect(effect).duty;
  const watts = full * duty;
  const wanted = peakWatts * 1.2;
  const demand = watts * parameters.ledHours;
  // The pack is lithium at 3.7 V and the strip is not, so everything between
  // them goes through a converter. 85% is what a decent small boost gives.
  const battery = demand / 0.85;
  const harvest = panelCut
    ? ((parameters.solarWidth * parameters.solarLength) / 1_000_000)
      * 1000 * PANEL_EFFICIENCY * SUN_HOURS * CHARGE_EFFICIENCY
    : 0;

  return {
    led: parameters.led,
    kelvin: spec.kelvin,
    addressable: spec.addressable,
    volts: spec.volts,
    length,
    runs: parameters.ledRuns,
    leds,
    peakWatts,
    watts,
    amps: peakWatts / spec.volts,
    lumens: full * spec.lumens,
    effect,
    duty,
    position: parameters.ledPosition,
    feeds: Math.max(1, Math.ceil(length / spec.feed)),
    supply: SUPPLY_SIZES.find((size) => size >= wanted) ?? Math.ceil(wanted),
    harvest,
    demand,
    runtime: watts > EPSILON ? harvest / watts : 0,
    battery,
    cells: Math.ceil(battery / CELL_WH),
  };
}

/** What each strip is called on a drawing. The Hebrew studio has its own copy. */
export const LED_NAMES: Record<PlanterLed, string> = {
  none: 'No strip',
  '3000k': '3000K warm white',
  '6000k': '6000K daylight',
  '10000k': '10000K ice',
  ws2812: 'WS2812 addressable RGB',
};

/** What drives the pixels, said plainly on a drawing. */
export const LED_CONTROLLERS: Record<PlanterLedController, string> = {
  none: 'no controller — one fixed colour',
  ir: 'IR remote controller',
  wled: 'WLED controller, driven from a phone',
};

/** Where the strip goes, and which way it faces, for a drawing. */
export const LED_POSITION_NAMES: Record<PlanterLedPosition, string> = {
  rim: 'under the collar, facing down',
  wall: 'on the liner face, facing the cut-outs',
  foot: 'on the base, facing up',
};

/** The colour the preview should glow, per strip. Addressable has no one colour. */
export const ledGlow = (led: PlanterLed): string => (led === 'none' ? '#ffc46b' : LED_SPECS[led].glow);

/**
 * What painting this pot in stone actually comes to.
 *
 * Measured off the drawing and nothing else: the faces a painter can reach, the
 * openings already cut in them, and one thickness. It is called last, after the
 * parts are nested and the perforation is on them, because every number here is
 * a consequence of the pot rather than an input to it — and because the coat
 * goes on after the folding, which is the whole reason it may be this thick.
 */
function measureStone(
  parameters: PlanterParameters,
  pieces: PlanterPiece[],
): PlanterStoneCoat | null {
  const stone = stoneById(parameters.stone);
  if (!stone) return null;

  // The wall and the collar. The base sits on the ground and the liner sits in
  // the soil; nobody paints either, and quoting them would send the shop a
  // third more render than it can use.
  const wall = pieces.filter((piece) => piece.id === 'wall' || piece.id.startsWith('band-'));
  const painted = [...wall, ...pieces.filter((piece) => piece.id === 'rim')];
  const areaMm2 = painted.reduce(
    (sum, piece) => sum + Math.abs(polygonArea(piece.outline))
      - piece.holes.reduce((cut, hole) => cut + Math.abs(polygonArea(hole)), 0),
    0,
  );
  const areaM2 = areaMm2 / 1_000_000;
  const coatMm = parameters.stoneCoat;

  // Crease on the painted parts. This is what has to be kept clear of the
  // build, and on a pot with three bands it is metres of it.
  const creaseMm = painted.reduce((sum, piece) => sum + piece.folds.reduce(
    (run, fold) => run + Math.hypot(fold.x2 - fold.x1, fold.y2 - fold.y1), 0,
  ), 0);

  // A typical opening, taken as the circle of the same area — the one honest
  // way to ask how wide these are across five families that draw five different
  // shapes. Petals count: a bent-out petal leaves a hole behind it just the
  // same, and the render closes that hole exactly as readily.
  let openMm2 = 0;
  let cuts = 0;
  for (const piece of wall) {
    for (const hole of piece.holes) { openMm2 += Math.abs(polygonArea(hole)); cuts += 1; }
    for (const flap of piece.flaps) { openMm2 += Math.abs(polygonArea(flap)); cuts += 1; }
  }
  const opening = cuts > 0 ? 2 * Math.sqrt((openMm2 / cuts) / Math.PI) : 0;

  return {
    stone: stone.id,
    code: stone.code,
    coatMm,
    reliefMm: coatMm * (parameters.stoneRelief / 100),
    areaM2,
    passes: coatPasses(coatMm),
    coats: coatCoats(coatMm),
    litres: coatLitres(areaM2, coatMm),
    kg: coatKg(areaM2, coatMm),
    hours: coatHours(areaM2, coatMm),
    days: coatDays(coatMm),
    keepOut: coatKeepOut(coatMm),
    reliefRun: creaseMm / 1000,
    opening,
    throat: cuts > 0 ? coatThroat(opening, coatMm) : 0,
    seal: parameters.stoneSeal,
  };
}

/**
 * Grow a convex ring outwards — the inverse of `insetConvex`, for a hole.
 *
 * The collar's planting hole is a cut edge like any other, so the ink has to
 * stay off it too, and staying off the inside of a hole means the hole gets
 * bigger. Scaling about the centroid on the ring's own inradius is exact for
 * the regular polygon the mouth actually is, and within a hair of exact for
 * the rectangle case.
 */
function growRing(points: Vec2[], amount: number): Vec2[] {
  if (amount <= EPSILON || points.length < 3) return points;
  const centre = centroid(points);
  const radius = inradius(points);
  if (radius <= EPSILON) return points;
  const ratio = (radius + amount) / radius;
  return points.map((point) => ({
    x: centre.x + (point.x - centre.x) * ratio,
    y: centre.y + (point.y - centre.y) * ratio,
  }));
}

/**
 * What printing this pot actually comes to.
 *
 * Measured off the nested parts and the developed facets, because that is the
 * state the panel is in when it reaches the bed: milled, grooved, still flat.
 * Every number falls out of three things — the facets, one grout width and one
 * bed — and none of them is an input to the drawing, which is the whole reason
 * a print can be specified this late without the cut file knowing.
 *
 * The colours come back in the model's own triangle order and stay there. The
 * preview, the artwork file and the shop's colour count all read this one
 * array, so there is no second place for them to disagree about what was
 * approved.
 */
function measurePrint(
  parameters: PlanterParameters,
  triangles: Triangle[],
  rings: Vec3[][],
  stride: number,
  planar: (band: number, id: number) => Vec2,
  perfAreaByTriangle: number[],
  pieces: PlanterPiece[],
  sheet: { width: number; height: number },
): PlanterPrintJob | null {
  if (parameters.print === 'none') return null;

  const { sides, rows } = parameters;
  const perBand = sides * 2;
  const colours = paletteColours(parameters.printPalette, parameters.printColors);
  const tones = Math.max(2, Math.min(parameters.printTones, colours.length));
  const grout = parameters.printGrout;
  const mouthZ = rings[rows][0].z || 1;

  const facets: PrintFacet[] = triangles.map((triangle, index) => {
    const band = Math.floor(index / perBand);
    const facet = index % perBand;
    const corners = triangle.v.map((id) => rings[Math.floor(id / stride)][id % stride]);
    const cx = (corners[0].x + corners[1].x + corners[2].x) / 3;
    const cy = (corners[0].y + corners[1].y + corners[2].y) / 3;
    const cz = (corners[0].z + corners[1].z + corners[2].z) / 3;
    return {
      index,
      band,
      column: Math.floor(facet / 2),
      // The first triangle of each quad carries two corners on the ring below
      // it, so it is the one that points up the pot. See `planterTriangles`.
      up: facet % 2 === 0,
      height: Math.max(0, Math.min(1, cz / mouthZ)),
      around: Math.atan2(cy, cx) / TAU + 0.5,
      normal: triangle.normal,
    };
  });

  const fills = parameters.print === 'triangles'
    ? triangleFills(facets, {
      rule: parameters.printRule,
      colours,
      tones,
      seed: parameters.printSeed,
      shade: parameters.printShade,
    })
    : [];

  // The wall, facet by facet. Each one is pulled back from all three of its
  // edges, so what is left is the tile and what is lost is the grout — and a
  // facet the grout swallows whole is left bare rather than printed as a
  // sliver the head would only spray onto the groove.
  let facetMm2 = 0;
  let inkMm2 = 0;
  let dropped = 0;
  for (let index = 0; index < triangles.length; index += 1) {
    const band = Math.floor(index / perBand);
    const flat = triangles[index].v.map((id) => planar(band, id)) as [Vec2, Vec2, Vec2];
    const whole = triangleArea(flat);
    facetMm2 += whole;
    const inked = insetTriangle(flat, grout);
    if (!inked) { dropped += 1; continue; }
    // The cut-outs take their own area with them: there is no panel under a
    // milled opening to put ink on.
    inkMm2 += Math.max(0, triangleArea(inked) - (perfAreaByTriangle[index] ?? 0));
  }

  // The collar is printed too, in one flat colour — it is the frame round the
  // artwork and the first thing anybody sees from above. It is a ring, so the
  // grout costs it twice: once round the outside and once round the mouth.
  const collarPiece = pieces.find((piece) => piece.id === 'rim');
  if (collarPiece) {
    const ring = Math.abs(polygonArea(collarPiece.outline))
      - collarPiece.holes.reduce((cut, hole) => cut + Math.abs(polygonArea(hole)), 0);
    const edge = perimeter(collarPiece.outline)
      + collarPiece.holes.reduce((run, hole) => run + perimeter(hole), 0);
    facetMm2 += ring;
    inkMm2 += Math.max(0, ring - edge * grout);
  }

  // Crease on the printed parts. This is the run that stays bare, and the
  // reason it stays bare is the only thing on the print card that matters.
  const printed = pieces.filter(
    (piece) => piece.id === 'wall' || piece.id.startsWith('band-') || piece.id === 'rim',
  );
  const creaseMm = printed.reduce((sum, piece) => sum + piece.folds.reduce(
    (run, fold) => run + Math.hypot(fold.x2 - fold.x1, fold.y2 - fold.y1), 0,
  ), 0);

  const areaM2 = inkMm2 / 1_000_000;
  const passes = printPasses(parameters.printWhite, parameters.printVarnish);
  const tiles = printTiles(sheet.width, sheet.height);

  return {
    mode: parameters.print,
    fills,
    // An imported image has no per-facet colour to count, and guessing at one
    // from a raster nobody has opened would be a number the shop could not use.
    colours: parameters.print === 'triangles' ? new Set(fills).size : 0,
    areaM2,
    facetM2: facetMm2 / 1_000_000,
    grout,
    groutRun: creaseMm / 1000,
    dropped,
    white: parameters.printWhite,
    varnish: parameters.printVarnish,
    passes,
    inkMl: printInkMl(areaM2, parameters.printWhite, parameters.printVarnish),
    kg: printKg(areaM2, passes),
    minutes: printMinutes(areaM2, passes, tiles),
    bed: PRINT_BED,
    tiles,
  };
}

/** The one flat colour the collar is printed in — the darkest tone in play. */
export function collarColour(parameters: PlanterParameters): string {
  const colours = paletteColours(parameters.printPalette, parameters.printColors);
  const tones = Math.max(2, Math.min(parameters.printTones, colours.length));
  return colours[tones - 1];
}

const FACET_MATCH = 0.02;

/**
 * A triangle's three edge lengths, in order, bucketed at `FACET_MATCH`.
 *
 * Two facets with the same signature are congruent to that tolerance, and
 * corner 0 of one answers to corner 0 of the other — so the pattern cut for
 * either lands on the other, rounded corner for rounded corner.
 *
 * Exact congruence would be the wrong test. Facets that are exactly congruent
 * on the solid pot come off the unfolder a few microns apart whenever the wall
 * is not perfectly developable, which is most interesting walls, and keying on
 * the last bit would quietly switch the sharing off exactly where it was worth
 * having.
 */
const facetSignature = (tri: Triangle2): string => [
  dist2(tri[0], tri[1]), dist2(tri[1], tri[2]), dist2(tri[2], tri[0]),
].map((edge) => Math.round(edge / FACET_MATCH)).join('|');

/** A pattern cut once, held as corner weights so it can be stamped anywhere. */
interface Stamp {
  weights: [number, number, number][][];
  flapWeights: [number, number, number][][];
  dropped: number;
  area: number;
}

/**
 * Cut the wall open, facet by facet. The pattern itself lives in
 * `planter-perforation`; what happens here is deciding which facets get one —
 * and, where it can, cutting it only once.
 *
 * A pot's facets mostly repeat: every side of a regular section carries the
 * same triangle as the one next to it, turned round the axis. So the pattern is
 * laid out for the first facet of each distinct shape and then stamped onto the
 * rest through their corners. That is cheaper — one layout instead of one per
 * side — but the reason it is worth doing is that it makes the pattern the
 * *same* on every side by construction, rather than the same to within however
 * closely two independent layouts happen to agree.
 *
 * Stamping is only allowed between congruent facets, so the map carrying one
 * onto the other is a rigid motion. Squeeze a long facet's pattern onto a short
 * one and every promise the pattern makes — the border at the creases, the web
 * between the cells — comes out scaled by whatever the squeeze was. A footprint
 * with two different edge lengths has two different facets, and gets two
 * layouts.
 */
function perforateWall(
  parameters: PlanterParameters, triangles: Triangle[], rings: Vec3[][], stride: number,
  flatAt: (band: number, id: number) => Vec2,
): WallPerforation {
  const cells: Vec2[][][] = triangles.map(() => []);
  const flaps: Vec2[][][] = triangles.map(() => []);
  if (parameters.perforation === 'none') return { cells, flaps, dropped: 0, openArea: 0 };
  const cut = PATTERN[parameters.perforation] ?? perforateFacet;

  const spec: PerforationSpec = {
    density: parameters.perfDensity, opening: parameters.perfOpening / 100,
    web: parameters.perfWeb, margin: parameters.perfMargin, tool: parameters.perfTool,
    picked: parameters.perfPicked,
  };
  const fadeOver = parameters.perfFade;
  const at = (id: number) => rings[Math.floor(id / stride)][id % stride];
  const perBand = parameters.sides * 2;
  const stamps = new Map<string, Stamp>();
  let dropped = 0;
  let opened = 0;
  let wall = 0;

  for (let t = 0; t < triangles.length; t += 1) {
    const facet = triangles[t].v.map((id) => flatAt(Math.floor(t / perBand), id)) as Triangle2;
    wall += Math.abs(polygonArea(facet));
    // The skirt is the wall the pot stands on. A facet that dips into it is
    // left whole rather than trimmed, so the line steps facet by facet instead
    // of docking a row of them off at the knee — a cut-out sliced through by a
    // height rule is a cut-out with a corner the cutter never agreed to.
    // Without a fade the skirt is a clean line and a facet that dips into it is
    // left whole, so the edge of the pattern follows the facets rather than
    // slicing through them. With a fade there is no edge to keep tidy — the
    // pattern is already arriving at nothing by the time it reaches the skirt —
    // so a facet only drops out once it is entirely below the line.
    const dips = Math.min(...triangles[t].v.map((id) => at(id).z));
    const tops = Math.max(...triangles[t].v.map((id) => at(id).z));
    if (fadeOver > 0
      ? tops <= parameters.perfSkirt + EPSILON
      : dips < parameters.perfSkirt - EPSILON) continue;

    // With a fade running, two facets of the same shape at different heights
    // carry different amounts of pattern — so the height goes into the key, and
    // the sharing carries on round the pot where it still holds.
    const heights = triangles[t].v.map((id) => at(id).z);
    const low = Math.min(...heights);
    const high = Math.max(...heights);
    const signature = fadeOver > 0
      ? `${facetSignature(facet)}@${Math.round(low / FACET_MATCH)}:${Math.round(high / FACET_MATCH)}`
      : facetSignature(facet);

    let stamp = stamps.get(signature);
    if (!stamp) {
      // The fade is asked about points in the flat facet, so it has to get back
      // to a height: a facet is a triangle, and a point's corner weights carry
      // its height just as they carry its position.
      const fade = fadeOver > 0
        ? (point: Vec2) => {
          const [u, v, w] = barycentric(facet, point);
          const z = heights[0] * u + heights[1] * v + heights[2] * w;
          return clamp((z - parameters.perfSkirt) / fadeOver, 0, 1);
        }
        : undefined;
      const pattern = cut(facet, { ...spec, fade });
      const weigh = (ring: Vec2[]) => ring.map((point) => barycentric(facet, point));
      stamp = {
        weights: pattern.cells.map(weigh),
        flapWeights: (pattern.flaps ?? []).map(weigh),
        dropped: pattern.dropped,
        area: pattern.area,
      };
      stamps.set(signature, stamp);
    }

    const onFacet = (ring: [number, number, number][]) => ring.map(([u, v, w]) => ({
      x: facet[0].x * u + facet[1].x * v + facet[2].x * w,
      y: facet[0].y * u + facet[1].y * v + facet[2].y * w,
    }));
    cells[t] = stamp.weights.map(onFacet);
    flaps[t] = stamp.flapWeights.map(onFacet);
    dropped += stamp.dropped;
    opened += stamp.area;
  }

  return { cells, flaps, dropped, openArea: wall > EPSILON ? opened / wall : 0 };
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
// "Light me up"
// ---------------------------------------------------------------------------

/** Is any part of the lighting kit on this design? */
export const isLitPlanter = (parameters: PlanterParameters): boolean =>
  parameters.perforation !== 'none' || parameters.liner || parameters.solar || parameters.led !== 'none';

/** The cut-out families, and which generator draws each. */
const PATTERN: Record<string, typeof perforateFacet> = {
  triangles: perforateFacet, shards: shardFacet, dots: scatterFacet, grid: gridFacet,
  foldout: foldFacet,
};
const PERFORATIONS: PlanterPerforation[] = ['triangles', 'shards', 'dots', 'grid', 'foldout'];
/** The strips on the shelf, in the order the toolbar shows them. */
export const LEDS: PlanterLed[] = ['3000k', '6000k', '10000k', 'ws2812'];
/** Strips are sold at these densities and no others. */
export const LED_DENSITIES = [30, 60, 144];
const EFFECT_IDS: PlanterLedEffect[] = LED_EFFECTS.map((spec) => spec.id);
const CONTROLLERS: PlanterLedController[] = ['none', 'ir', 'wled'];
export const LED_POSITIONS: PlanterLedPosition[] = ['rim', 'wall', 'foot'];
const POSITIONS = LED_POSITIONS;

/** Cavities to try, widest first, when the one asked for will not go in. */
const CAVITY_STEPS = [22, 18, 14, 10, 6];

/**
 * Fit the whole lighting kit to a design that was drawn without one.
 *
 * This is the one-click end of the generator, so nothing here is a fixed
 * number where the pot can supply a better one. The skirt, the border and the
 * web all scale with the pot, because a 22 mm border that reads as a crisp rib
 * on a 500 mm pot swallows a 300 mm one whole. The cavity steps down until the
 * box actually fits. The collar widens only when it has to carry a panel and
 * only as far as the planting hole allows — and it is the caller's job to say
 * so on screen, because silently redrawing somebody's collar is not a feature.
 *
 * What it will not do is shrink the pot, move a crease or invent a panel size.
 * Where the design genuinely cannot take the kit, the fabrication checks say
 * which part of it could not be fitted and what to change.
 */
export function litPlanter(parameters: PlanterParameters): PlanterParameters {
  const safe = normalizePlanter(parameters);
  const rings = planterVertices(safe);
  const mouth = flatten(rings[safe.rows], safe.sides);

  // The collar has to take the panel, and the planting hole sets the ceiling.
  const room = Math.max(0, inradius(mouth) - MIN_OPENING);
  const needed = safe.solarLength + SOLAR_EDGE * 2;
  const rimWidth = clamp(Math.max(safe.rimWidth, Math.min(needed, room)), safe.rimWidth, 400);

  // A solid foot under the pattern, to carry the load and to keep splashback
  // off the openings. The line lands on a ring rather than at a fraction of the
  // height, and never on the top one: a facet that dips into the skirt is left
  // whole, so a skirt drawn across the only band there is would leave nothing
  // to cut and the button would look like it had done nothing. A one-band pot
  // gets no skirt, which is the honest answer — there is no band to spare.
  // The border and the web are proportions of the facet they are cut into, not
  // of the pot. A ribbed eight-sided column has facets a fraction of the size a
  // one-band box has, and a border sized off the pot's height swallows them
  // whole — the button then looks like it did nothing, which is how this was
  // found. Sizing off the smallest facet means the pattern survives everywhere.
  const smallestFacet = facetInradius(planterTriangles(safe, rings), rings, safe.sides + 1);

  const solidFoot = safe.height * 0.18;
  let skirt = 0;
  for (let k = 1; k < safe.rows; k += 1) {
    if (rings[k][0].z <= solidFoot) skirt = rings[k][0].z;
  }

  const lit: PlanterParameters = {
    ...safe,
    perforation: 'triangles',
    liner: true,
    solar: true,
    // Warm white, because this is a pot in a garden and not a workshop lamp:
    // 3000K lands on planting and render the way evening light does, and it is
    // the end of the range insects care least about. The other three are one
    // click away on the toolbar.
    led: safe.led === 'none' ? '3000k' : safe.led,
    rimWidth,
    // Floored, not rounded: rounding up would put the line a hair above the
    // ring it was chosen to sit on, and drop the band it was meant to keep.
    perfSkirt: Math.floor(skirt),
    perfMargin: Math.round(clamp(smallestFacet * 0.3, 8, 40)),
    perfWeb: Math.round(clamp(smallestFacet * 0.18, 6, 22)),
    // Decorative, not structural. A composite panel carries its load in its
    // skins, and the one-click path has no way of knowing what the pot will be
    // asked to hold — so it takes a little material out and leaves the wall a
    // wall. Anybody who wants more can say so on the slider.
    perfOpening: 18,
    // Dissolve over the lower half of what is left above the skirt, so the pot
    // reads as one piece: solid where it stands, pattern where it shows.
    perfFade: Math.round((safe.height - skirt) * 0.45),
  };

  // Step the cavity down until a box will actually go in. A narrower gap than
  // the strip wants is still reported, but it beats no liner at all — and with
  // the wall about to be cut open, the liner is not optional.
  // Fitted against the INSIDE of the wall, which is the face the box actually
  // meets. Measured off the outside it would be handed the wall thickness twice
  // over as free space, and a box cut to that lands hard against the skin with
  // the strip and its wiring still to go somewhere.
  const litTriangles = planterTriangles(lit, rings);
  const litInner = innerVertices(rings, litTriangles, safe.sides + 1, getMaterial(safe.material).thickness);
  const fits = (cavity: number) => measureLiner({ ...lit, cavity }, litInner, litTriangles, safe.sides + 1);
  const cavity = [safe.cavity, ...CAVITY_STEPS].find((step) => fits(step) !== null);
  const fitted: PlanterParameters = { ...lit, cavity: cavity ?? safe.cavity };

  // Last, the brightness — because only now is the strip's length known, and
  // with it what a night actually costs. A small panel on a collar is a small
  // panel: it will not run a metre of tape at full output for six hours, and
  // pretending otherwise builds a pot that is dark by ten. So the button turns
  // it down to what this panel on this collar can carry through to morning,
  // and the slider is there for anyone who would rather have it bright and
  // short, or run a cable to it. Where even the floor will not hold, the
  // brightness stops there and the solar check says what to change.
  const { band, edge } = collarBand(fitted, rings);
  const light = measureLighting({ ...fitted, ledBrightness: 100 }, rings, fits(fitted.cavity), solarFits(fitted, edge, band));
  const affordable = light && light.peakWatts > EPSILON && light.harvest > 0
    ? clamp(Math.floor(((light.harvest / fitted.ledHours) / light.peakWatts) * 100), 5, 100)
    : fitted.ledBrightness;
  return { ...fitted, ledBrightness: affordable };
}

/** Take the kit back off, leaving its settings where they were for next time. */
export const unlitPlanter = (parameters: PlanterParameters): PlanterParameters => ({
  ...parameters, perforation: 'none', liner: false, solar: false, led: 'none',
});

// ---------------------------------------------------------------------------

export function buildPlanterModel(parameters: PlanterParameters): PlanterModel {
  const safe = normalizePlanter(parameters);
  const stride = safe.sides + 1;
  const material = getMaterial(safe.material);
  // 'vertices' is the OUTSIDE face — see 'PlanterSolid'. What the pot actually
  // contains is measured on the other one.
  const vertices = planterVertices(safe);
  const triangles = planterTriangles(safe, vertices);
  const inner = innerVertices(vertices, triangles, stride, material.thickness);
  const edges = wallEdges(triangles, vertices, stride);
  const maxBend = edges.reduce((worst, edge) => (edge.kind === 'cut' ? worst : Math.max(worst, edge.bend)), 0);
  const unfolder: Unfolder = { rings: vertices, triangles, sides: safe.sides, rows: safe.rows };

  // Where the wall is cut into separate blanks, and which part each band belongs
  // to. One part is the whole tube from one sheet; more than one means rivet
  // lines, and `planWallParts` is what decides how few of those there can be.
  const parts = planWallParts(unfolder, safe.construction);
  const partOf = new Array<number>(safe.rows).fill(0);
  parts.forEach((part, p) => { for (let k = part.from; k <= part.to; k += 1) partOf[k] = p; });

  // Each part developed in its own frame, then read back band by band. Where two
  // parts meet, the ring between them exists twice — once as the top edge of the
  // part below and once as the foot of the part above — and those two copies are
  // exactly the pair of cut edges that get riveted together.
  //
  // The wall is developed before any part is cut, because the perforation is
  // laid out on the developed facets and the parts are what carry it.
  const partRings = parts.map((part) => unfoldSegment(unfolder, part.from, part.to));
  const local: Vec2[][][] = Array.from({ length: safe.rows }, (_, k) => {
    const rings = partRings[partOf[k]];
    const base = k - parts[partOf[k]].from;
    return [rings[base], rings[base + 1]];
  });

  const perBand = safe.sides * 2;
  const perf = perforateWall(
    safe, triangles, vertices, stride,
    (band, id) => local[band][Math.floor(id / stride) - band][id % stride],
  );

  const wallParts: PlanterPiece[] = parts.map((part, p) => wallPartPiece(
    safe, part, parts.length, partRings[p], edges,
    perf.cells.slice(part.from * perBand, (part.to + 1) * perBand).flat(),
    perf.flaps.slice(part.from * perBand, (part.to + 1) * perBand).flat(),
  ));

  const liner = safe.liner ? measureLiner(safe, inner, triangles, stride) : null;
  const plates = [basePiece(safe, vertices, liner !== null), rimPiece(safe, vertices)];
  if (liner) plates.push(...linerPieces(safe, liner));

  const { pieces, sheet, sheets } = nest(wallParts, plates, safe.sheetWidth, safe.sheetHeight);

  // The panel only counts once it is in the collar. A window that would not fit
  // was not cut, and a panel that was never cut in harvests nothing — so the
  // budget below is measured against the drawing rather than against the wish.
  const panelCut = (pieces.find((piece) => piece.id === 'rim')?.holes.length ?? 0) >= 2;
  const lighting = measureLighting(safe, vertices, liner, panelCut);

  // Wall parts are nested ahead of the plates, so a band's piece is still found
  // by the index of the part carrying it — which is what lets both the rings and
  // the cut-outs be lifted out of their construction frame by the same shift.
  const shiftOf = (band: number) => {
    const piece = pieces[partOf[band]];
    return { x: piece.x - piece.origin.x, y: piece.y - piece.origin.y };
  };

  // Lift each band out of its construction frame onto the sheet, so the flat net
  // and the cut layout are one drawing rather than two.
  const flatByBand = local.map((rings, k) => {
    const shift = shiftOf(k);
    return rings.map((ring) => ring.map((point) => add2(point, shift)));
  });

  const perfCells: PlanterPerfCells[] = perf.cells.flatMap((cells, t) => {
    const flaps = perf.flaps[t];
    if (cells.length === 0 && flaps.length === 0) return [];
    const shift = shiftOf(Math.floor(t / perBand));
    const lift = (rings: Vec2[][]) => rings.map((ring) => ring.map((point) => add2(point, shift)));
    return [{ triangle: t, cells: lift(cells), flaps: lift(flaps) }];
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

  // What it holds, on the face that holds it. The floor is the base plate, one
  // thickness of stock standing on the foot, and soil does not fill the plate.
  const shell = enclosedVolume(inner, safe.sides, safe.rows);
  const floor = Math.abs(polygonArea(flatten(inner[0], safe.sides))) * material.thickness;

  return {
    parameters: safe,
    material,
    solid: {
      inner,
      thickness: material.thickness,
      litres: Math.max(0, shell - floor) / 1_000_000,
      surfaceLitres: enclosedVolume(vertices, safe.sides, safe.rows) / 1_000_000,
      innerOpening: ringInradius(flatten(inner[safe.rows], safe.sides)) * 2,
      // Real, now that the liner is fitted to the inside face: the box is sized
      // so its tightest gap is exactly this. Measured off the outside, as it
      // used to be, a stated 22 mm was 18 mm of actual room on 4 mm stock.
      cavity: liner ? safe.cavity : null,
    },
    groove: planterGroove(material, safe.vBitAngle, maxBend),
    vertices,
    flatByBand,
    triangles,
    pieces,
    parts,
    sheet,
    maxBend,
    developmentError,
    joints: parts.length - 1,
    sheets,
    liner,
    lighting,
    // Last, and off the nested parts rather than the parameters: the painter
    // works on what came off the cutter, cut-outs and all.
    stone: measureStone(safe, pieces),
    // Later still. The printer takes the panel after the mill has finished
    // with it, so the artwork is measured on the developed facets — with the
    // milled openings already taken out of them, because there is no panel
    // under a hole to put ink on. A flap is not a hole: the petal stays in the
    // sheet and takes ink like the rest of the wall.
    print: measurePrint(
      safe, triangles, vertices, stride, planar,
      perf.cells.map((cells) => cells.reduce((sum, ring) => sum + Math.abs(polygonArea(ring)), 0)),
      pieces, sheet,
    ),
    perfCells,
    perfDropped: perf.dropped,
    perfOpenArea: perf.openArea,
  };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/**
 * What the pot holds (litres) — measured inside the wall, off the floor.
 *
 * Worked out once, when the model is built, because it is the inside face that
 * answers it and the inside face is part of the model. A second sum here would
 * be a second answer waiting to disagree with the first.
 */
export function planterVolumeLitres(model: PlanterModel): number {
  return model.solid.litres;
}

/**
 * Material actually left in the parts (mm2).
 *
 * Flaps are deliberately absent: a cut-and-fold petal stays attached, so the
 * part weighs exactly what it weighed before the pattern went on it.
 */
const sheetArea = (model: PlanterModel): number => model.pieces.reduce(
  (sum, piece) => sum + Math.abs(polygonArea(piece.outline))
    - piece.holes.reduce((cut, hole) => cut + Math.abs(polygonArea(hole)), 0),
  0,
);

/** What the bare panel weighs, before anybody paints anything onto it (kg). */
const sheetKg = (model: PlanterModel, material: MaterialSpec): number => sheetArea(model) * material.thickness * material.density;

/**
 * The numbers that go on the quote.
 *
 * The stock is read off the model rather than handed in beside it. It used to
 * be a second argument, which meant a caller could ask what a pot cut from 4 mm
 * composite weighs while the pot itself had been built from 2 mm steel — two
 * answers to one question, and no way for either to know it was the wrong one.
 */
export function getPlanterStats(model: PlanterModel): PlanterStats {
  const material = model.material;
  const { sides, rows } = model.parameters;
  const creaseLength = model.pieces.reduce(
    (sum, piece) => sum + piece.folds.reduce((run, fold) => run + Math.hypot(fold.x2 - fold.x1, fold.y2 - fold.y1), 0),
    0,
  );
  const runLength = (points: Vec2[]) => points.slice(1).reduce(
    (run, point, i) => run + dist2(points[i], point), 0,
  );
  const cutLength = model.pieces.reduce(
    (sum, piece) => sum + perimeter(piece.outline)
      + piece.holes.reduce((run, hole) => run + perimeter(hole), 0)
      // A petal's cut is open, so it is a run and not a perimeter.
      + piece.flaps.reduce((run, flap) => run + runLength(flapSlit(flap as Triangle2, model.parameters.perfTool)), 0),
    0,
  );
  const rimHole = model.pieces.find((piece) => piece.id === 'rim')?.holes[0];
  const opening = rimHole ? bounds(rimHole) : { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  const widest = model.vertices.reduce((best, ring) => {
    const box = bounds(flatten(ring, sides));
    const size = { width: box.maxX - box.minX, height: box.maxY - box.minY };
    return size.width * size.height > best.width * best.height ? size : best;
  }, { width: 0, height: 0 });

  const cutOuts = model.perfCells.reduce(
    (count, facet) => count + facet.cells.length + facet.flaps.length, 0,
  );
  const folded = model.parameters.perforation === 'foldout';
  // Once a liner is in, the shell is not what holds the soil — the box inside it
  // is, and quoting the shell would overstate the pot by whatever the cavity took.
  const litres = model.liner ? model.liner.litres : planterVolumeLitres(model);
  const gap = model.liner
    ? `${Math.round(model.parameters.cavity)}${model.liner.mouthGap - model.parameters.cavity > 1
      ? `–${Math.round(model.liner.mouthGap)}` : ''} mm`
    : '';

  const light = model.lighting;
  const coat = model.stone;
  const job = model.print;
  const stoneCatalogue = coat ? stoneById(coat.stone) : null;

  return {
    ...(light
      ? {
        lighting: `${LED_NAMES[light.led]} · ${model.parameters.ledDensity}/m · ${(light.length / 1000).toFixed(2)} m · ${light.leds} LEDs`,
        power: `${light.watts.toFixed(1)} W · ${light.amps.toFixed(2)} A at ${light.volts} V · ${light.supply} W driver`,
        ...(light.harvest > 0
          ? { runtime: `${light.harvest.toFixed(1)} Wh/day · runs ${light.runtime.toFixed(1)} h` }
          : {}),
      }
      : {}),
    ...(coat && stoneCatalogue
      ? {
        stone: `${coat.code} ${stoneName(stoneCatalogue)} · ${coat.coatMm.toFixed(coat.coatMm < 1 ? 1 : 0)} mm`,
        coat: `${coat.coats} coats · ${coat.litres.toFixed(1)} L · ${coat.kg.toFixed(1)} kg · ${coat.hours.toFixed(1)} h · ${coat.days} ${coat.days === 1 ? 'day' : 'days'}`,
      }
      : {}),
    ...(job
      ? {
        print: job.mode === 'triangles'
          ? `${PRINT_RULE_NAMES[model.parameters.printRule]} · ${paletteName(model.parameters.printPalette)} · ${job.colours} ${job.colours === 1 ? 'colour' : 'colours'}`
          : `Imported image · ${model.parameters.printFit}`,
        ink: `${job.passes} ${job.passes === 1 ? 'pass' : 'passes'} · ${job.areaM2.toFixed(2)} m2 · ${Math.round(job.inkMl)} ml · ${Math.round(job.minutes)} min`,
      }
      : {}),
    ...(cutOuts > 0
      ? {
        openArea: folded
          ? `${Math.round(model.perfOpenArea * 100)}% open · ${cutOuts} folded petals · nothing removed`
          : `${Math.round(model.perfOpenArea * 100)}% open · ${cutOuts} cut-outs`,
      }
      : {}),
    ...(gap ? { cavity: gap } : {}),
    facets: sides * rows * 2,
    creaseLength: `${(creaseLength / 1000).toFixed(2)} m`,
    cutLength: `${(cutLength / 1000).toFixed(2)} m`,
    sheetUsage: model.sheets > 1
      ? `${Math.ceil(model.sheet.width)} × ${Math.ceil(model.sheet.height)} mm across ${model.sheets} sheets`
      : `${Math.ceil(model.sheet.width)} × ${Math.ceil(model.sheet.height)} mm`,
    estimatedWeight: `${sheetKg(model, material).toFixed(2)} kg`,
    volume: `≈ ${litres.toFixed(1)} L`,
    topOpening: `${Math.round(opening.maxX - opening.minX)} × ${Math.round(opening.maxY - opening.minY)} mm`,
    footprint: `${Math.round(widest.width)} × ${Math.round(widest.height)} mm`,
    pieces: model.pieces.length,
    sheets: model.sheets,
  };
}

/**
 * How this wall would be cut if it were built `split`, whatever it is built as
 * now: the runs of bands that each fold out of one blank.
 *
 * It answers the only useful question about a design that will not develop. Not
 * "is it wrong" — the mismatch already says that — but what it costs to make it
 * right, counted in parts and rivet lines, before anyone changes a setting.
 */
export function planterSplit(model: PlanterModel): PlanterWallPart[] {
  const { sides, rows } = model.parameters;
  return planWallParts({ rings: model.vertices, triangles: model.triangles, sides, rows }, 'split');
}

/** Everything standing between this design and a finished pot, worst first. */
/** Everything wrong with this design, on the stock it is actually cut from. */
export function getPlanterChecks(model: PlanterModel): FabricationCheck[] {
  const material = model.material;
  const { sides, rows, sheetWidth, sheetHeight, height, rimWidth, jointTab, baseTab, rimTab } = model.parameters;
  const checks: FabricationCheck[] = [];
  const oversized = model.pieces.find((piece) => !fitsStock(piece.width, piece.height, sheetWidth, sheetHeight));

  if (oversized) {
    checks.push({
      id: 'sheet-fit', severity: 'error', title: 'A part is larger than the stock sheet',
      detail: `${oversized.label} needs ${Math.ceil(oversized.width)} × ${Math.ceil(oversized.height)} mm but the sheet is only ${sheetWidth} × ${sheetHeight} mm. Shrink the pot, drop a band, or cut the wall into parts — Split or Banded — because separate strips are far smaller than one long blank.`,
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
  // Cutting the wall at the rings that carry it sidesteps that, because a run of
  // bands with no curvature crossing it always develops.
  //
  // This is an error and not a preference. The stock does not stretch, so the
  // mismatch below is not a tolerance to be absorbed on the bench: it is the
  // amount by which the blank is the wrong size for the pot, which also makes
  // every figure measured off that blank — its area, its weight, its nest —
  // short by the same mistake.
  if (model.developmentError > DEVELOPMENT_TOLERANCE) {
    const culprit = Math.abs(model.parameters.bulge) > 0.5
      ? 'A bulged wall is curved, so no single blank folds into it.'
      : model.parameters.footprint === 'rectangle' && getPlanterStyle(model.parameters.style).offsetStep > 0
        ? 'Staggering the rings of a rectangle swings long edges onto short ones, which curves the wall. Square the footprint up or pick the Straight Facet style to keep one blank.'
        : model.parameters.rhythm > 1
          ? 'A band rhythm is free on a straight wall and fights a taper. Straighten the taper or take the rhythm down to keep one blank.'
          : 'Ease the taper or the band count to keep one blank.';
    const split = planterSplit(model);
    const cost = split.length === 1
      ? 'Switch construction to Split and it comes out as one blank after all.'
      : `Switch construction to Split: ${split.length} parts, ${split.length - 1} riveted ring ${split.length === 2 ? 'joint' : 'joints'}, every other ring still a crease.`;
    checks.push({
      id: 'development', severity: 'error',
      title: 'Facets will not lie flat without stretch',
      detail: `Developing this wall as one blank leaves ${model.developmentError.toFixed(1)} mm of edge mismatch, and the stock does not stretch — so the blank is the wrong size for the pot, and so is every figure measured off it. ${culprit} ${cost}`,
    });
  }

  if (material.foldMethod === 'heat-bend') {
    checks.push({
      id: 'heat-bend', severity: 'warning', title: `${material.shortName} cannot be V-grooved`,
      detail: `Acrylic crazes at a sharp crease. Line-bend every fold over a ${material.minRadius} mm radius former and treat the net as a bend layout, not a groove toolpath.`,
    });
  }

  // A groove shuts on itself after turning through its own included angle, so a
  // bit that is not the fold angle is a fold with no stop in it. Worth being
  // plain about which way round the failure goes, because they are different
  // jobs to fix: too wide leaves the corner soft, too narrow will not reach.
  const missed = bitMismatch(model);
  if (missed.length > 0) {
    const worst = missed[0];
    const open = worst.bit > worst.bend;
    checks.push({
      id: 'v-bit',
      severity: open ? 'warning' : 'error',
      title: open ? `A ${worst.bit}° bit will not close these folds` : `A ${worst.bit}° bit cannot reach these folds`,
      detail: open
        ? `${missed.length === 1 ? 'One crease turns' : `${missed.length} creases turn`} less than the bit is ground to — the steepest gap is a fold of ${worst.bend.toFixed(0)}° in a ${worst.bit}° groove, which bottoms out with ${(worst.bit - worst.bend).toFixed(0)}° still to go. Nothing stops the corner there, so it springs back and the seam has to hold it. Fit a ${Math.max(5, Math.round(worst.bend / 5) * 5)}° bit, or set the bit to Auto and let every crease carry its own angle on the drawing.`
        : `${missed.length === 1 ? 'One crease turns' : `${missed.length} creases turn`} further than the bit can open — a fold of ${worst.bend.toFixed(0)}° cannot be made with a ${worst.bit}° groove, because the groove runs out of angle ${(worst.bend - worst.bit).toFixed(0)}° short and the two faces meet before the panel is round. Fit a ${Math.max(5, Math.round(worst.bend / 5) * 5)}° bit, or set the bit to Auto.`,
    });
  }

  // A groove is a real width on a real facet. Take too much of one and there is
  // no flat face left between the creases — the panel stops reading as facets
  // and starts reading as a crushed tube.
  if (!model.groove.heatBent && model.groove.width > 0) {
    // Across the facet, so twice the radius: the groove has to fit between one
    // crease and the one facing it, not between a crease and the middle.
    const facet = facetInradius(model.triangles, model.vertices, sides + 1) * 2;
    if (Number.isFinite(facet) && facet > 0 && model.groove.width > facet * 0.25) {
      checks.push({
        id: 'groove-width', severity: 'warning', title: 'The groove is wide for these facets',
        detail: `A ${model.groove.width.toFixed(1)} mm groove takes ${((model.groove.width / facet) * 100).toFixed(0)}% of a ${facet.toFixed(0)} mm facet, ${model.groove.depth.toFixed(1)} mm deep on ${material.thickness} mm ${material.shortName}. Little flat face is left between one crease and the next. Fewer bands or fewer sides, a narrower bit, or thinner stock.`,
      });
    }
  }

  if (model.joints > 0 && jointTab > 0.5 && jointTab < material.thickness * 4) {
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

  // --- Lighting -------------------------------------------------------------

  const { perforation, perfWeb, perfMargin, perfTool, perfSkirt, cavity, solar } = model.parameters;
  const cutOuts = model.perfCells.reduce(
    (count, facet) => count + facet.cells.length + facet.flaps.length, 0,
  );

  if (perforation !== 'none' && !model.liner) {
    checks.push({
      id: 'perf-liner', severity: 'error', title: 'An open wall with nothing behind it',
      detail: 'Cut-outs through the wall with no liner fitted means soil against the openings: it washes out of every one of them the first time the pot is watered, and the water runs down the inside of the skin onto whatever is wired in there. Fit the liner, or leave the wall solid.',
    });
  }

  if (perforation !== 'none' && cutOuts === 0) {
    const reason = perfSkirt > height * 0.95
      ? `a ${Math.round(perfSkirt)} mm solid skirt on a ${Math.round(height)} mm pot leaves no wall above it`
      : `a ${Math.round(perfMargin)} mm border and a ${Math.round(perfWeb)} mm web use up every facet at this size`;
    checks.push({
      id: 'perf-empty', severity: 'warning', title: 'Nothing was cut',
      detail: `The wall is set to be perforated but ${reason}. Drop the skirt, narrow the border or the web, or take the density down.`,
    });
  }

  if (model.perfDropped > 0 && cutOuts > 0) {
    checks.push({
      id: 'perf-tool', severity: 'info', title: `${model.perfDropped} cut-outs left solid`,
      detail: `A ${perfTool} mm cutter cannot drop into cells that small, so they were left whole rather than drawn as a contour the tool has to gouge its way around. Take the density down or the web in to even the pattern up, or use a smaller cutter.`,
    });
  }

  if (perforation !== 'none' && perfWeb < material.thickness * 3) {
    checks.push({
      id: 'perf-web', severity: 'warning', title: 'Webs are thin for this stock',
      detail: `A ${Math.round(perfWeb)} mm web between cut-outs in ${material.thickness} mm ${material.shortName} bends under its own weight and tears at the corners. Give the web at least ${Math.ceil(material.thickness * 3)} mm.`,
    });
  }

  if (perforation !== 'none' && perfMargin < material.thickness * 5) {
    checks.push({
      id: 'perf-margin', severity: 'warning', title: 'Cut-outs crowd the creases',
      detail: `A ${Math.round(perfMargin)} mm border leaves little solid material beside a fold in ${material.thickness} mm ${material.shortName}. A groove running past a hole that close tears out into it as the fold closes. Give the border at least ${Math.ceil(material.thickness * 5)} mm.`,
    });
  }

  // A composite panel is two thin aluminium skins on a soft core, and all of its
  // stiffness is in those skins. Take much out of them and the facets start to
  // oil-can between the creases long before anything looks like it is failing —
  // so the line is drawn well below where a solid sheet would want it, and the
  // cut-out is treated as decoration rather than as structure.
  // A cut-and-fold wall keeps every gram it started with — the petal is still
  // there, bridging its own opening — so it takes a good deal more before the
  // facet goes slack. It is not free: the two severed edges are still cuts.
  const openLimit = perforation === 'foldout' ? 0.3 : 0.16;
  if (model.perfOpenArea > openLimit) {
    const heavy = model.perfOpenArea > openLimit * 1.9;
    checks.push({
      id: 'perf-open', severity: heavy ? 'error' : 'warning',
      title: heavy ? 'Too much of the wall is open' : 'The wall is losing more than decoration',
      detail: perforation === 'foldout'
        ? `${Math.round(model.perfOpenArea * 100)}% of the wall is opened up. Nothing leaves the sheet — every petal is still attached — but two of its three edges are cut, and past about a third of the area the facets go slack between the creases anyway. Take the opening down.`
        : `${Math.round(model.perfOpenArea * 100)}% of the wall is cut away. ${material.shortName} carries its load in two thin skins, and past about a sixth of the area the facets go slack between the creases. Take the opening down — it is the lever that decides how much material leaves the sheet, where the pattern fineness only decides how many pieces it leaves in.`,
    });
  }

  if (model.parameters.liner && !model.liner) {
    checks.push({
      id: 'liner-fit', severity: 'error', title: 'No room for the liner',
      detail: `A ${Math.round(cavity)} mm cavity all round leaves nothing inside this pot to build a box out of. Narrow the cavity or widen the pot.`,
    });
  }

  if (model.liner && cavity < STRIP_CLEARANCE) {
    checks.push({
      id: 'liner-cavity', severity: 'warning', title: 'The cavity is tight for a strip',
      detail: `A ${Math.round(cavity)} mm gap has to take the strip, its channel and the wiring behind it. Allow ${STRIP_CLEARANCE} mm, or run bare tape bonded straight to the skin and accept that it cannot be re-lamped.`,
    });
  }

  if (solar && (model.pieces.find((piece) => piece.id === 'rim')?.holes.length ?? 0) < 2) {
    const { band, edge } = collarBand(model.parameters, model.vertices);
    const { solarWidth, solarLength } = model.parameters;
    const short = solarLength + SOLAR_EDGE * 2 > band;
    checks.push({
      id: 'solar-fit', severity: 'warning', title: 'The panel does not fit the collar',
      detail: short
        ? `A ${Math.round(solarLength)} mm panel needs a collar at least ${Math.ceil(solarLength + SOLAR_EDGE * 2)} mm wide to bed onto, and this one is ${Math.round(band)} mm${rimWidth > band + 0.5 ? ` — the opening has already cut it back from the ${Math.round(rimWidth)} mm asked for` : ''}. No window was cut. Widen the collar, or fit a shorter panel.`
        : `A ${Math.round(solarWidth)} mm panel needs a collar flat at least ${Math.ceil(solarWidth + SOLAR_EDGE * 2)} mm long, and the longest here is ${Math.round(edge)} mm. No window was cut. Widen the pot, add sides, or fit a narrower panel.`,
    });
  }

  const light = model.lighting;
  if (light) {
    if (!model.liner) {
      checks.push({
        id: 'led-liner', severity: 'warning', title: 'The strip has nothing to stick to',
        detail: 'With no soil box the strip ends up bonded to the inside of the wall, under the soil, where it is wet all season and cannot be reached again without emptying the pot. Fit the liner: the strip belongs on its outside face, dry, looking at the cut-outs.',
      });
    }
    if (perforation === 'none') {
      checks.push({
        id: 'led-dark', severity: 'warning', title: 'The light has no way out',
        detail: `A ${LED_NAMES[light.led]} strip inside a solid wall lights the cavity and nothing else. Cut the wall — any of the pattern families will do it — or leave the strip off.`,
      });
    }
    if (light.feeds > 1) {
      checks.push({
        id: 'led-feed', severity: 'info', title: `Feed the strip at ${light.feeds} points`,
        detail: `${(light.length / 1000).toFixed(2)} m of ${light.volts} V strip drawing ${light.amps.toFixed(2)} A drops along its own copper: the far end comes up dim and, on the whites, visibly warmer than the near end. Run the supply to ${light.feeds} points spaced round the cavity — same pair of wires, joined at each.${light.addressable ? ' Data still enters once, at the first LED.' : ''}`,
      });
    }
    if (light.addressable) {
      checks.push({
        id: 'led-data', severity: 'info', title: 'Addressable needs a controller and a clean 5 V',
        detail: `${light.leds} WS2812 pixels flat out is ${light.peakWatts.toFixed(1)} W — ${light.amps.toFixed(1)} A at 5 V, which is real current in thin wire. Specify a ${light.supply} W 5 V supply, a 300–500 Ω resistor in the data line and a 1000 µF cap across the first pixel, and keep the run at ${Math.round(model.parameters.ledBrightness)}% as drawn: these are quoted at full white, and animation rarely asks for it. On a run this long the 12 V sibling, WS2815, carries five times the distance between feeds for the same pixels.`,
      });
    }
    if (light.addressable && model.parameters.ledController === 'none' && model.parameters.ledEffect !== 'static') {
      checks.push({
        id: 'led-controller', severity: 'warning', title: 'The mode has nothing to run it',
        detail: `"${getLedEffect(model.parameters.ledEffect).name}" needs something addressing the pixels one at a time, and no controller is specified — the strip can then only be held at one colour, which is a costly way to buy a white one. Specify a WLED controller for these modes from a phone, or an IR one for the modes burned into it.`,
      });
    }
    if (light.position === 'foot') {
      checks.push({
        id: 'led-wet', severity: 'warning', title: 'The strip is where the water ends up',
        detail: 'A strip standing on the base plate sits at the low point of a pot that is watered and drilled to drain. Specify IP65 tape, bed the joints and the feed in silicone, and stand it on spacers clear of the drain holes — or move it up under the collar, where it stays dry and can still be reached.',
      });
    }
    if (light.harvest <= 0) {
      checks.push({
        id: 'led-mains', severity: 'info', title: 'No panel — this one is fed from outside',
        detail: `The strip asks for ${light.demand.toFixed(1)} Wh a night at ${Math.round(model.parameters.ledBrightness)}% for ${Math.round(model.parameters.ledHours)} h. With no panel in the collar that comes from a ${light.supply} W driver on a cable, or from a pack charged indoors — about ${light.cells} 18650 ${light.cells === 1 ? 'cell' : 'cells'} a night.`,
      });
    } else if (light.runtime < model.parameters.ledHours) {
      // Panels scale by area, so the shortfall scales by its square root.
      const grow = Math.sqrt(light.demand / light.harvest);
      checks.push({
        id: 'led-solar', severity: 'warning', title: `The panel carries ${light.runtime.toFixed(1)} h, not ${Math.round(model.parameters.ledHours)}`,
        detail: `A ${Math.round(model.parameters.solarWidth)} × ${Math.round(model.parameters.solarLength)} mm panel brings in about ${light.harvest.toFixed(1)} Wh on an average day, and ${light.watts.toFixed(1)} W spends it in ${light.runtime.toFixed(1)} h. For ${Math.round(model.parameters.ledHours)} h either fit about ${Math.ceil(model.parameters.solarWidth * grow)} × ${Math.ceil(model.parameters.solarLength * grow)} mm of panel, or run the strip at ${Math.max(5, Math.floor(model.parameters.ledBrightness * light.runtime / model.parameters.ledHours))}% instead of ${Math.round(model.parameters.ledBrightness)}%.`,
      });
    }
  }

  const coat = model.stone;
  if (coat && coat.coatMm > 0) {
    const bare = sheetKg(model, material);
    // The build is carried by two aluminium skins that were folded for their own
    // weight and a bag of soil. Half as much again on the outside of them is the
    // point where the creases start to be asked a question they were not sized for.
    if (coat.kg > bare * 0.6) {
      const heavy = coat.kg > bare * 1.5;
      checks.push({
        id: 'stone-weight', severity: heavy ? 'error' : 'warning',
        title: `The coat adds ${coat.kg.toFixed(1)} kg to a ${bare.toFixed(1)} kg pot`,
        detail: `${coat.coatMm.toFixed(0)} mm of render over ${coat.areaM2.toFixed(2)} m² comes to ${coat.litres.toFixed(1)} L, and cured that is ${coat.kg.toFixed(1)} kg hanging on ${material.shortName} skins that weigh ${bare.toFixed(1)} kg themselves.${heavy ? ' At this ratio the panel is cladding rather than structure — build thinner, or put the pot on a plinth and stop carrying it by the rim.' : ' Watch the collar and the base tabs when it is lifted.'} Every millimetre off the build takes ${(coat.kg / coat.coatMm).toFixed(1)} kg off.`,
      });
    }

    // Past two thirds of the cap the render stops behaving like a skin.
    if (coat.coatMm > MAX_COAT_MM * 0.7) {
      checks.push({
        id: 'stone-thick', severity: 'warning',
        title: `${coat.coatMm.toFixed(0)} mm is near the ${MAX_COAT_MM} mm ceiling`,
        detail: `A build this deep needs ${coat.passes} passes and it will not key to itself if they are rushed — ${coat.days} working days before the sealer goes near it. It also stands ${coat.coatMm.toFixed(0)} mm proud of every edge, so the collar overhang and the base footprint both grow by that much. Most of what reads as rock is in the glaze, not the thickness.`,
      });
    }

    // Folding is the one line on the pot that moves after painting.
    if (coat.coatMm >= 3 && coat.reliefRun > 0) {
      checks.push({
        id: 'stone-crease', severity: 'info',
        title: `Keep the build ${coat.keepOut.toFixed(0)} mm off every crease`,
        detail: `${coat.reliefRun.toFixed(2)} m of crease runs under this coat. Render carried across a fold is what takes the strain when the pot flexes, and it cracks along the fold — the most visible line on the part. Run a relief line ${coat.keepOut.toFixed(0)} mm either side, let the glaze carry the colour over it, and the crease reads as a seam in the rock instead of as a fault.`,
      });
    }

    if (coat.opening > 0) {
      const shut = coat.throat <= 0;
      if (shut || coat.throat < coat.opening * 0.45) {
        checks.push({
          id: 'stone-perf', severity: shut ? 'error' : 'warning',
          title: shut
            ? 'The coat closes the cut-outs'
            : `Cut-outs come down to ${coat.throat.toFixed(0)} mm`,
          detail: `The render goes on the inside of every cut edge as well as the face, so a ${coat.opening.toFixed(0)} mm opening loses ${(2 * coat.coatMm).toFixed(0)} mm and gains ${coat.coatMm.toFixed(0)} mm of depth.${shut ? ' At this build they close entirely — the wall was cut open for nothing.' : ''} Either build to ${Math.max(0, (coat.opening * 0.45 - 0.5) / 2).toFixed(0)} mm or less, or open the cut-outs up first. Note too that a perforated wall is slower to paint than its area says: every opening is an edge to work round.`,
        });
      }
    }

    if (model.lighting && coat.opening > 0 && coat.throat > 0 && coat.coatMm >= 3) {
      checks.push({
        id: 'stone-led', severity: 'info', title: 'The render narrows the beam',
        detail: `Each opening is now a ${coat.throat.toFixed(0)} mm hole ${coat.coatMm.toFixed(0)} mm deep rather than a hole in a ${material.thickness} mm skin. Light leaves it in a tighter cone, so the wall reads as points of light rather than as a glow, and less of it reaches the ground. Wanted, usually — but size the strip for it, and chamfer the render back on the inside of each opening if you want the spread.`,
      });
    }

    if (coat.seal === 'matte') {
      checks.push({
        id: 'stone-seal', severity: 'info', title: 'Matte sealer on a watered pot',
        detail: 'Matte is the truest stone and the least protected — it breathes, and it takes a mark from hard water and from fertiliser run-off. Satin sheds both and still reads dry. Wet-look reads as rain-soaked rock permanently, which is a decision rather than a finish.',
      });
    }
  }

  const job = model.print;
  if (job) {
    // The one genuine conflict between the two finishes. Both are real, both
    // are sold, and one of them is applied on top of the other.
    if (coat && coat.coatMm > 0) {
      checks.push({
        id: 'print-stone', severity: 'error', title: 'The render is going on top of the print',
        detail: `This pot is specified both printed and clad in ${coat.code}. The print goes on at the bed, flat, before the fold; the render goes on by hand afterwards, ${coat.coatMm.toFixed(0)} mm of it, over the same faces. Nothing of the artwork survives that. Pick one — or print the pot and let the painter glaze it thin instead of building it.`,
      });
    }

    if (material.foldMethod === 'heat-bend') {
      checks.push({
        id: 'print-heat', severity: 'warning', title: `${material.shortName} is folded hot — print it after`,
        detail: `Acrylic cannot be V-grooved and folded cold: every crease is bent over a ${material.minRadius} mm former at temperature. A cured UV film taken to bending heat yellows, and at the crease itself it lifts and crazes. Either print this one after it is bent — which means printing a formed part and giving up on a flat bed — or cut it from composite, where the fold is cold and the order printed-then-folded holds.`,
      });
    }

    if (job.tiles > 1) {
      checks.push({
        id: 'print-bed', severity: 'warning', title: `The nest needs ${job.tiles} passes on the bed`,
        detail: `The parts nest into ${Math.ceil(model.sheet.width)} × ${Math.ceil(model.sheet.height)} mm and the bed is ${job.bed.width} × ${job.bed.height} mm, so the artwork is tiled. A tile boundary is a visible join and it never registers perfectly. Re-nest so the join falls between parts rather than across one, or cut the pot down to a sheet the bed takes whole.`,
      });
    }

    if (job.grout <= 0.01) {
      checks.push({
        id: 'print-grout', severity: 'warning', title: 'Ink carried straight over the creases',
        detail: `With no grout the artwork runs across ${job.groutRun.toFixed(2)} m of crease that is about to be folded. A cured UV film is rigid — it crazes along the fold, and the fold is the most visible line on the pot. Hold it back ${DEFAULT_GROUT} mm and the bare line reads as grout between tiles instead of as a crack across them.`,
      });
    } else if (job.dropped > 0) {
      checks.push({
        id: 'print-dropped', severity: 'info',
        title: `${job.dropped} ${job.dropped === 1 ? 'facet is' : 'facets are'} too small to print`,
        detail: `At ${job.grout.toFixed(1)} mm of grout on all three edges, ${job.dropped} ${job.dropped === 1 ? 'facet has' : 'facets have'} nothing left in the middle, and ${job.dropped === 1 ? 'it is' : 'they are'} left bare rather than printed as a sliver the head would spray into the groove. Fewer, larger facets — or less grout.`,
      });
    }

    if (job.mode === 'image' && !model.parameters.printImage) {
      checks.push({
        id: 'print-image', severity: 'warning', title: 'Image print with no image',
        detail: 'The pot is specified for an imported artwork and none has been loaded, so the print file comes out empty. Load a PNG or a JPEG, or switch back to the facet generator.',
      });
    }

    if (!job.white) {
      checks.push({
        id: 'print-white', severity: 'info', title: 'No white underbase',
        detail: 'CMYK is transparent ink. Laid straight onto a mill-finish or mirrored panel it reads as a tint on metal rather than as the colour that was approved, and it changes with the angle you stand at. That is a legitimate effect and it is half the ink — but it is not the palette on screen.',
      });
    }

    if (job.mode === 'triangles' && cutOuts > 0) {
      checks.push({
        id: 'print-perf', severity: 'info', title: 'The pattern is printed round the cut-outs',
        detail: `${cutOuts} openings are masked out of the artwork — there is no panel under them to take ink. The cut edges themselves stay bare to ${job.grout.toFixed(1)} mm, so each opening carries a fine unprinted border. On a lit pot that border is what the light grazes, and it reads as a bright outline after dark.`,
      });
    }
  }

  const foot = inradius(flatten(model.vertices[0], sides)) * 2;
  if (foot < height * 0.45) {
    checks.push({
      id: 'stability', severity: 'info', title: 'Tall and narrow — ballast the base',
      detail: `A ${Math.round(foot)} mm foot under a ${Math.round(height)} mm pot tips easily once the plant goes top-heavy. Weight the base plate or widen the foot.`,
    });
  }

  if (checks.length === 0) {
    const how = model.joints === 0
      ? `${rows} ${rows === 1 ? 'band' : 'bands'} from one blank`
      : `${rows} ${rows === 1 ? 'band' : 'bands'} in ${model.parts.length} riveted parts`;
    const lit = [
      cutOuts > 0 ? `${cutOuts} ${perforation === 'foldout' ? 'folded petals' : 'cut-outs'}` : '',
      model.liner ? `a ${Math.round(model.liner.height)} mm liner on a ${Math.round(cavity)} mm cavity` : '',
      solar ? 'a panel window in the collar' : '',
      model.lighting ? `${(model.lighting.length / 1000).toFixed(2)} m of ${LED_NAMES[model.lighting.led]} at ${model.lighting.watts.toFixed(1)} W` : '',
    ].filter(Boolean);
    checks.push({
      id: 'ready', severity: 'info', title: 'Cleared for fabrication',
      detail: `${sides} sides × ${how} on ${material.shortName}, steepest crease ${model.maxBend.toFixed(0)}°, nested into ${Math.ceil(model.sheet.width)} × ${Math.ceil(model.sheet.height)} mm.${lit.length > 0 ? ` Lit build: ${lit.join(', ')}.` : ''}`,
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
export function placedGeometry(piece: PlanterPiece, mirrorAbout?: number) {
  // Reflected about the nest's own right-hand edge rather than about zero, so
  // the drawing lands in exactly the box it came from: same stock, same corner,
  // same nest that already fitted — only handed the other way.
  const at = mirrorAbout === undefined
    ? (x: number, y: number) => ({ x, y })
    : (x: number, y: number) => ({ x: mirrorAbout - x, y });
  return {
    flaps: piece.flaps.map((flap) => flap.map((point) => at(point.x + piece.x, point.y + piece.y))),
    outline: piece.outline.map((point) => at(point.x + piece.x, point.y + piece.y)),
    folds: piece.folds.map((fold) => {
      const a = at(fold.x1 + piece.x, fold.y1 + piece.y);
      const b = at(fold.x2 + piece.x, fold.y2 + piece.y);
      return { ...fold, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    }),
    holes: piece.holes.map((hole) => hole.map((point) => at(point.x + piece.x, point.y + piece.y))),
  };
}

/**
 * The x a drawing for `face` is reflected in, or undefined when it is not
 * reflected at all.
 *
 * A mountain stays a mountain and a valley stays a valley through this: which
 * way a crease folds is a fact about the pot, not about which side of the board
 * you are standing on. What the reflection changes is only handedness — and
 * which face each groove is cut from, which the layer names already carry.
 */
const faceAxis = (model: PlanterModel, face: PlanterFace): number | undefined =>
  (face === 'groove' ? model.sheet.width : undefined);

const FOLD_KINDS: FoldKind[] = ['mountain', 'valley', 'cut'];

/** Dash lengths are millimetres in an export, not screen pixels as on the canvas. */
const SVG_DASH: Record<FoldKind, string> = {
  mountain: '', valley: ' stroke-dasharray="14 8"', cut: ' stroke-dasharray="18 6 4 6"',
};

/**
 * One run as one element: `polygon` where the run closes, so it arrives as a
 * closed path rather than an open one somebody has to join by hand.
 */
function svgRun(run: Polyline, kind: FoldKind): string {
  const points = run.points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
  const width = kind === 'cut' ? 0.4 : 0.3;
  return `<${run.closed ? 'polygon' : 'polyline'} points="${points}" stroke="${FOLD_COLORS[kind]}" stroke-width="${width}"${SVG_DASH[kind]}/>`;
}

/**
 * The paint card.
 *
 * A different person on a different day: the cutter is finished with the pot
 * before the painter has seen it, and none of this changes a cut line. What it
 * has to carry is everything the drawing cannot say about a coat — which stone,
 * how many passes to reach the build, what to mix, where NOT to put it, and
 * that the last pass is somebody's judgement rather than a specification.
 */
function stoneNotes(model: PlanterModel): string[] {
  const coat = model.stone;
  const stone = coat ? stoneById(coat.stone) : null;
  if (!coat || !stone) return [];
  const p = model.parameters;
  const notes: string[] = [
    `PAINT — hand-applied stone finish, after folding. Nothing on this drawing changes for it`,
    `Stone: ${coat.code} ${stoneName(stone)} — texture reference ${stone.id}, one repeat every ${stone.tileMm} mm on the pot`,
  ];
  if (coat.coatMm > 0) {
    notes.push(`Build ${coat.coatMm.toFixed(coat.coatMm < 1 ? 1 : 0)} mm at the high points over ${coat.areaM2.toFixed(2)} m2 of wall and collar: ${coat.passes} render ${coat.passes === 1 ? 'pass' : 'passes'} at no more than two a day, ${coat.coats} coats all told, about ${coat.litres.toFixed(1)} L mixed and ${coat.kg.toFixed(1)} kg on the finished pot`);
    if (coat.reliefRun > 0) notes.push(`Keep the build ${coat.keepOut.toFixed(0)} mm clear of every crease — ${coat.reliefRun.toFixed(2)} m of them. Render carried across a fold cracks along it; let the glaze take the colour over the relief line instead`);
    if (coat.opening > 0) notes.push(`Cut-outs measure about ${coat.opening.toFixed(0)} mm before paint and ${coat.throat.toFixed(0)} mm after — work the render back off each edge on the inside, or they close`);
  }
  notes.push(`Relief as approved: ${Math.round(p.stoneRelief)}% of the build worked as surface, ${Math.round(p.stoneTone)}% batch drift across the pot${p.stoneTint.toLowerCase() === '#ffffff' ? '' : ', glaze tinted ' + p.stoneTint.toUpperCase()}`);
  notes.push(`Finish with ${SEAL_NAMES[coat.seal].toLowerCase()}, one pass, after the glaze has gone off hard`);
  notes.push(`Glaze is the painter's own — no two pots match, and they are not meant to. Allow ${coat.hours.toFixed(1)} h on the bench across ${coat.days} working ${coat.days === 1 ? 'day' : 'days'}`);
  return notes;
}

/**
 * The build notes a lit pot needs and a solid one does not.
 *
 * These say the things the drawing cannot: which way round the panel goes, and
 * where in the cavity it is dry enough to put the electronics. A cut file that
 * leaves that to be guessed at gets guessed at wrong once, outdoors.
 */
function lightingNotes(model: PlanterModel): string[] {
  const { parameters: p, liner } = model;
  const cutOuts = model.perfCells.reduce(
    (count, facet) => count + facet.cells.length + facet.flaps.length, 0,
  );
  const notes: string[] = [];

  if (p.perforation === 'foldout' && cutOuts > 0) {
    notes.push(`${cutOuts} cut-and-fold petals — cut the two open edges only, DO NOT close the contour; nothing is removed from the sheet`);
    notes.push(`Bend each petal out by hand along its mountain crease, about ${Math.round(p.perfLift)}° — the flat file is the same at any angle`);
  } else if (cutOuts > 0) {
    notes.push(p.perforation === 'dots'
      ? `${cutOuts} milled discs on the wall, mixed diameters — cut them with a ${p.perfTool} mm mill or smaller`
      : `${cutOuts} milled cut-outs on the wall — corners drawn at ${p.perfTool / 2} mm, cut them with a ${p.perfTool} mm mill`);
    notes.push(`Cut-outs are ${Math.round(p.perfMargin)} mm clear of every crease and ${Math.round(p.perfWeb)} mm apart — do not groove across one`);
  }
  if (liner) {
    notes.push(`Liner: ${Math.round(liner.height)} mm tall, ${Math.round(p.cavity)} mm cavity at its tightest and ${Math.round(liner.mouthGap)} mm at the rim — strip low, driver and battery high and dry`);
    notes.push('Both floors are drilled to drain — stand the liner on spacers so the water has somewhere to go');
  }
  if (model.lighting) {
    const light = model.lighting;
    notes.push(`${LED_NAMES[light.led]} strip, ${p.ledDensity} LEDs/m: ${(light.length / 1000).toFixed(2)} m in ${light.runs} ${light.runs === 1 ? 'run' : 'runs'} round the liner, ${light.leds} emitters, ${light.peakWatts.toFixed(1)} W flat out and ${light.watts.toFixed(1)} W at the ${Math.round(p.ledBrightness)}% it is set to`);
    notes.push(({
      rim: `Mount the strip ${LED_POSITION_NAMES.rim}: a channel bonded to the collar's underside at its inner edge, ${Math.round(light.length / light.runs)} mm round. It grazes the wall from above and can be re-lamped from the top without lifting the soil box`,
      wall: `Mount the strip ${LED_POSITION_NAMES.wall}: bonded to the outside of the liner, ${Math.round(light.length / light.runs)} mm round. Brightest of the three, and it comes out with the box`,
      foot: `Mount the strip ${LED_POSITION_NAMES.foot}: standing on the base plate, ${Math.round(light.length / light.runs)} mm round, clear of the drain holes. It washes the wall upwards`,
    } as Record<string, string>)[light.position]);
    notes.push(`Supply ${light.volts} V, ${light.supply} W, fed at ${light.feeds} ${light.feeds === 1 ? 'point' : 'points'} — ${light.amps.toFixed(2)} A flat out${light.addressable ? '; data in at the first pixel only, 330 R in the line and 1000 uF across it' : ''}`);
    if (light.addressable) {
      const mode = getLedEffect(light.effect);
      notes.push(light.effect === 'static'
        ? `Controller: ${LED_CONTROLLERS[p.ledController]} — hold ${p.ledColor.toUpperCase()} on every pixel`
        : `Controller: ${LED_CONTROLLERS[p.ledController]} — run the "${mode.name}" mode at ${Math.round(p.ledSpeed)}% speed on ${p.ledColor.toUpperCase()}. It averages ${Math.round(mode.duty * 100)}% of full output, which is what the battery below is sized on; the supply above is sized for every pixel white`);
    }
    notes.push(light.harvest > 0
      ? `Panel brings in about ${light.harvest.toFixed(1)} Wh a day, which runs it ${light.runtime.toFixed(1)} h; the night as drawn wants ${light.demand.toFixed(1)} Wh — about ${light.cells} 18650 ${light.cells === 1 ? 'cell' : 'cells'}`
      : `No panel fitted: ${light.demand.toFixed(1)} Wh a night from a driver or a pack, about ${light.cells} 18650 ${light.cells === 1 ? 'cell' : 'cells'}`);
  }
  if (p.solar) {
    notes.push(`Collar window is cut ${SOLAR_LIP} mm under the ${Math.round(p.solarWidth)} × ${Math.round(p.solarLength)} mm panel all round — the panel beds from beneath and the cable drops through it`);
  }
  return notes;
}

/**
 * The print card.
 *
 * A third person again, and a third machine: the mill is finished with the
 * panel before the bed sees it, and the folder has not touched it yet. That
 * window is the whole specification, and these notes exist to say so out loud
 * — print after grooving, fold after curing, and keep the ink off the creases
 * in between, because the one thing a UV film will not do is bend.
 */
function printNotes(model: PlanterModel): string[] {
  const job = model.print;
  if (!job) return [];
  const p = model.parameters;
  const swatches = Array.from(new Set(job.fills)).map((hex) => hex.toUpperCase());
  const notes: string[] = [
    'PRINT — direct UV on a flatbed, AFTER the mill and BEFORE the fold. No cut line on this drawing changes for it',
  ];

  if (job.mode === 'triangles') {
    notes.push(`Artwork: facet fill, ${PRINT_RULE_NAMES[p.printRule]} on the ${paletteName(p.printPalette)} palette, seed ${p.printSeed}, ${job.colours} ${job.colours === 1 ? 'colour' : 'colours'}${p.printShade > 0 ? `, ${Math.round(p.printShade)}% facet shading` : ''}`);
    if (swatches.length > 0 && swatches.length <= 24) notes.push(`Colours: ${swatches.join(' ')}`);
    notes.push(`Collar printed flat in ${collarColour(p).toUpperCase()}`);
  } else {
    notes.push(`Artwork: supplied image, fitted "${p.printFit}" across the developed wall — the net IS the print layout, so what lands on a facet here is what stands on that facet once it is folded`);
  }

  notes.push(`Hold the ink ${job.grout.toFixed(1)} mm off every crease and every cut edge — ${job.groutRun.toFixed(2)} m of crease on the printed parts. A cured UV film is rigid: carried through a V-groove it crazes along the fold, and the fold is the most visible line on the pot${job.dropped > 0 ? `. ${job.dropped} ${job.dropped === 1 ? 'facet is' : 'facets are'} smaller than the grout and are left bare` : ''}`);
  notes.push(`${job.passes} ${job.passes === 1 ? 'pass' : 'passes'} over ${job.areaM2.toFixed(2)} m2${job.white ? ', white underbase first' : ', no white underbase — colour straight onto the panel reads as a tint on it'}${job.varnish ? ', varnish last' : ', no varnish'}: about ${Math.round(job.inkMl)} ml of ink and ${Math.round(job.minutes)} min on the bed`);
  notes.push(job.tiles > 1
    ? `Nest is ${Math.ceil(model.sheet.width)} × ${Math.ceil(model.sheet.height)} mm on a ${job.bed.width} × ${job.bed.height} mm bed — ${job.tiles} tiles. Set the join between parts, never across one`
    : `Nest is ${Math.ceil(model.sheet.width)} × ${Math.ceil(model.sheet.height)} mm and goes on the ${job.bed.width} × ${job.bed.height} mm bed in one pass`);
  if (p.printOverlay && p.printOverlayDensity > 0) {
    notes.push(`Drafting layer over the fills in ${p.printOverlayInk.toUpperCase()}, ${Math.round(p.printOverlayDensity)}% coverage — protractors on the net's vertices, a right-triangle glyph per facet, and callouts carrying this pot's own diameters and edge lengths. Clipped to the same facets, so it breaks at every crease`);
  }
  notes.push('Key the panel before the first pass — the lacquer on a composite skin is what the ink has to hold onto, and unkeyed it lifts at the folds first');
  notes.push('Register to the milled outline, not to the bed: the part is already cut when it arrives');
  // Said out loud because the cut file next to this one IS mirrored, and the two
  // arrive at the shop together. The ink goes on the face that shows, so this one
  // is the outside view and stays that way: print it mirrored and every facet is
  // in the wrong place as well as the wrong way round.
  notes.push('NOT mirrored — this is the outside face, the one the ink goes on. The cut file is mirrored for the groove face; do not match this to it');
  return notes;
}

/**
 * 1:1 millimetre SVG of the whole nested sheet, notation and shop notes included.
 *
 * Laid out for the groove face by default, because that is the face the board
 * presents to the cutter — see `PlanterFace`. Ask for `outside` to read the net
 * the way the finished pot reads.
 */
export function buildPlanterSvg(
  model: PlanterModel, styleName: string, face: PlanterFace = 'groove',
): string {
  const material = model.material;
  const { width, height } = model.sheet;
  const axis = faceAxis(model, face);
  const body: string[] = [];
  const annotation: string[] = [];

  for (const piece of model.pieces) {
    // Joined piece by piece: two parts that happen to touch in the nest are still
    // two parts, and running their outlines together would cut them as one.
    const { outline, folds, holes, flaps } = placedGeometry(piece, axis);
    body.push(svgRun(simplifyPolyline({ points: outline, closed: true }), 'cut'));
    for (const hole of holes) {
      body.push(svgRun(simplifyPolyline({ points: hole, closed: true }), 'cut'));
    }
    // A petal is cut on two edges only — an OPEN run that stops at the hinge.
    // Closing it would drop the petal on the floor instead of leaving it to be
    // bent out, which is the entire point of the family.
    for (const flap of flaps) {
      body.push(svgRun(simplifyPolyline({ points: flapSlit(flap as Triangle2, model.parameters.perfTool), closed: false }), 'cut'));
    }
    for (const kind of FOLD_KINDS) {
      const runs = chainFoldLines(folds.filter((fold) => fold.kind === kind));
      for (const run of runs) body.push(svgRun(run, kind));
    }
    // Labels live in a y-up group, so each is flipped back the right way round.
    //
    // A label's POSITION reflects with its part, but its glyphs must not — a
    // mirrored word is unreadable, and the operator reading it is the whole
    // reason it is on the drawing. So the anchor moves to the part's reflected
    // left-hand edge and the text itself is left alone.
    const labelX = axis === undefined ? piece.x + 6 : axis - piece.x - piece.width + 6;
    annotation.push(`<text x="${labelX.toFixed(2)}" y="${(-(piece.y + 12)).toFixed(2)}" font-size="14" fill="#9aa2b4" transform="scale(1,-1)">${piece.label}</text>`);
  }

  const notes = [
    `${styleName} planter — ${model.parameters.sides} sides, ${model.parameters.rows} bands, ${Math.round(model.parameters.height)} mm tall`,
    `Material: ${material.name} (${material.thickness} mm)`,
    model.sheets > 1
      ? `Nest spans ${model.sheets} stock sheets of ${model.parameters.sheetWidth} × ${model.parameters.sheetHeight} mm`
      : `Fits one ${model.parameters.sheetWidth} × ${model.parameters.sheetHeight} mm stock sheet`,
    model.joints > 0
      ? `${model.parts.length} wall parts: ${model.joints} riveted ring ${model.joints === 1 ? 'joint' : 'joints'}, tabs fold inward. Every other ring is a crease — groove it, do not cut it`
      : 'One wall blank: every ring is a crease, not a joint',
    face === 'groove'
      ? 'MIRRORED — drawn for the groove face. Board on the bed decorative side DOWN; this is what the cutter sees'
      : 'NOT mirrored — drawn for the outside of the pot. Mirror it before cutting, or every part comes off the table handed the wrong way',
    material.foldMethod === 'heat-bend'
      ? `Heat-bend over a ${material.minRadius} mm radius — do not V-groove`
      : `V-groove ${model.groove.depth.toFixed(1)} mm deep through the back skin, leaving ${model.groove.skin.toFixed(1)} mm — that skin is the hinge and cutting it makes two parts, not a fold`,
    ...(model.groove.heatBent ? [] : [
      model.parameters.vBitAngle > 0
        ? `One ${model.parameters.vBitAngle}° bit for the job: ${model.groove.width.toFixed(1)} mm wide at the back face. A groove shuts after turning through its own angle, so this bit makes a ${model.parameters.vBitAngle}° fold and nothing else`
        : `Bit per crease — the layer name is the angle. ${grooveLayerSummary(model)}. A groove shuts after turning through its own included angle, so the bit IS the fold`,
    ]),
    `Steepest crease ${model.maxBend.toFixed(0)}° · development error ${model.developmentError.toFixed(2)} mm`,
    'Solid = mountain · dashed = valley · dash-dot = cut',
    ...lightingNotes(model),
    ...stoneNotes(model),
    ...printNotes(model),
  ];

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width.toFixed(2)} ${height.toFixed(2)}" width="${width.toFixed(2)}mm" height="${height.toFixed(2)}mm">`
    + `<title>DXF.AC3D ${styleName} planter</title><desc>${notes.join(' | ')}</desc>`
    + '<rect width="100%" height="100%" fill="white"/>'
    + `<g transform="translate(0,${height.toFixed(2)}) scale(1,-1)" fill="none" stroke-linecap="round" stroke-linejoin="round">${body.join('')}`
    + `<g id="annotation" stroke="none">${annotation.join('')}</g></g></svg>`;
}

/**
 * 1:1 millimetre artwork for the flatbed — the print file, not the cut file.
 *
 * The same sheet, the same millimetres and the same origin as the DXF, so the
 * two land on top of each other: the operator drops the milled panel on the
 * bed, registers to its own cut outline, and prints. What is different is what
 * is IN it — filled facets instead of tool paths, and every fill already
 * pulled back from the creases the mill has just put in the panel.
 *
 * Three deliberate choices, all for the machine rather than for the eye:
 *
 * 1. No group transform. The sheet's y runs up and an SVG's runs down, and the
 *    cut file reconciles the two with one flip on a group — but a raster
 *    `<image>` inside a flipped group comes out mirrored, and a mirrored
 *    photograph on a customer's pot is the one mistake that cannot be sanded
 *    off. So the flip is applied to the coordinates and the file carries no
 *    transform at all, which is also the least a RIP can misread.
 * 2. No background. White in this file is white ink; a white rectangle behind
 *    the artwork would be a full-sheet white pass nobody asked for.
 * 3. Milled openings are masked out, not drawn over. There is no panel under a
 *    cut-out, and ink sprayed into one lands on the bed.
 */
export function buildPlanterPrintSvg(model: PlanterModel, styleName: string): string {
  const job = model.print;
  const p = model.parameters;
  const { width, height } = model.sheet;
  const stride = p.sides + 1;
  const perBand = p.sides * 2;
  const flip = (point: Vec2): Vec2 => ({ x: point.x, y: height - point.y });
  const planar = (band: number, id: number): Vec2 =>
    model.flatByBand[band][Math.floor(id / stride) - band][id % stride];
  const path = (points: Vec2[]): string =>
    points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');

  // The facets, already pulled back from their own edges. Built once: the fill
  // pass and the image's clip path are the same polygons.
  const tiles: { points: Vec2[]; fill: string }[] = [];
  for (let index = 0; index < model.triangles.length; index += 1) {
    const band = Math.floor(index / perBand);
    const flat = model.triangles[index].v.map((id) => planar(band, id)) as [Vec2, Vec2, Vec2];
    const inked = insetTriangle(flat, p.printGrout);
    if (!inked) continue;
    tiles.push({ points: inked.map(flip), fill: job?.fills[index] ?? collarColour(p) });
  }

  const collar = model.pieces.find((piece) => piece.id === 'rim');
  const collarRing = collar ? placedGeometry(collar) : null;
  // The collar is a ring: the grout takes it in from the outside and lets the
  // planting hole out by the same amount, and the two subpaths make the ring
  // by even-odd rather than by a second shape drawn over the first.
  const collarPath = collarRing
    ? [insetConvex(collarRing.outline, p.printGrout).map(flip),
      ...collarRing.holes.map((hole) => growRing(hole, p.printGrout).map(flip))]
      .map((ring) => `M ${path(ring).replace(/ /g, ' L ')} Z`)
    : [];

  // Every milled opening, knocked out of the artwork. Flaps are absent on
  // purpose: a cut-and-fold petal is still panel, and it takes ink.
  const knockouts = [
    ...model.perfCells.flatMap((facet) => facet.cells),
    ...(collarRing ? collarRing.holes : []),
  ];
  const mask = `<mask id="panel" maskUnits="userSpaceOnUse" x="0" y="0" width="${width.toFixed(2)}" height="${height.toFixed(2)}">`
    + `<rect width="${width.toFixed(2)}" height="${height.toFixed(2)}" fill="#ffffff"/>`
    + knockouts.map((ring) => `<polygon points="${path(ring.map(flip))}" fill="#000000"/>`).join('')
    + '</mask>';

  const facetClip = `<clipPath id="facets">${tiles.map((tile) => `<polygon points="${path(tile.points)}"/>`).join('')}</clipPath>`;
  const fits: Record<string, string> = { cover: 'xMidYMid slice', contain: 'xMidYMid meet', stretch: 'none' };
  let artwork = '';
  if (job?.mode === 'image' && p.printImage) {
    // The wall's own box, so the picture lands on the wall rather than on the
    // whole nest — the plates are separate parts and are printed flat.
    const corners = tiles.flatMap((tile) => tile.points);
    const box = {
      minX: Math.min(...corners.map((c) => c.x)), maxX: Math.max(...corners.map((c) => c.x)),
      minY: Math.min(...corners.map((c) => c.y)), maxY: Math.max(...corners.map((c) => c.y)),
    };
    artwork = `<g clip-path="url(#facets)"><image x="${box.minX.toFixed(2)}" y="${box.minY.toFixed(2)}" `
      + `width="${(box.maxX - box.minX).toFixed(2)}" height="${(box.maxY - box.minY).toFixed(2)}" `
      + `preserveAspectRatio="${fits[p.printFit] ?? fits.cover}" href="${p.printImage}"/></g>`;
  } else {
    artwork = tiles.map((tile) => `<polygon points="${path(tile.points)}" fill="${tile.fill}"/>`).join('');
  }
  if (collarPath.length > 0) {
    artwork += `<path d="${collarPath.join(' ')}" fill-rule="evenodd" fill="${collarColour(p)}"/>`;
  }
  // The drafting rides over the fills and is clipped to the same facets, so a
  // circle centred on a net vertex comes out as four arcs with bare grout
  // between them — the drawing broken along the creases it describes.
  if (p.printOverlay && p.printOverlayDensity > 0) {
    const marks = draftMarks(model, {
      density: p.printOverlayDensity / 100,
      seed: p.printSeed,
      weight: Math.max(0.3, p.printGrout * 0.4),
    });
    artwork += `<g clip-path="url(#facets)">${draftSvg(marks, flip, p.printOverlayInk, Math.max(0.3, p.printGrout * 0.4))}</g>`;
  }

  // What the operator lines the panel up on, and what must not be printed. A
  // magenta hairline is the trade's own convention for exactly that.
  const registration = model.pieces.map((piece) => {
    const { outline, holes } = placedGeometry(piece);
    return `<polygon points="${path(outline.map(flip))}"/>`
      + holes.map((hole) => `<polygon points="${path(hole.map(flip))}"/>`).join('');
  }).join('')
    + [[0, 0], [width, 0], [0, height], [width, height]].map(([x, y]) =>
      `<path d="M ${(x - 10).toFixed(1)} ${y.toFixed(1)} L ${(x + 10).toFixed(1)} ${y.toFixed(1)} `
      + `M ${x.toFixed(1)} ${(y - 10).toFixed(1)} L ${x.toFixed(1)} ${(y + 10).toFixed(1)}"/>`).join('');

  const notes = [
    `${styleName} planter — UV print artwork, 1:1, same origin as the cut file`,
    `Sheet ${Math.ceil(width)} × ${Math.ceil(height)} mm`,
    ...printNotes(model),
    'The magenta layer is registration only — it is the milled outline, and it does not print',
  ];

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" `
    + `viewBox="0 0 ${width.toFixed(2)} ${height.toFixed(2)}" width="${width.toFixed(2)}mm" height="${height.toFixed(2)}mm">`
    + `<title>DXF.AC3D ${styleName} planter — print artwork</title><desc>${notes.join(' | ')}</desc>`
    + `<defs>${mask}${facetClip}</defs>`
    + `<g id="artwork" mask="url(#panel)">${artwork}</g>`
    + `<g id="registration" fill="none" stroke="#ff00ff" stroke-width="0.25">${registration}</g>`
    + '</svg>';
}

const DXF_LAYERS: Record<FoldKind, { name: string; color: number }> = {
  cut: { name: 'CUT', color: 7 }, mountain: { name: 'MOUNTAIN', color: 1 }, valley: { name: 'VALLEY', color: 5 },
};

/**
 * Steps a V-bit is ground to.
 *
 * The fold angles on a faceted pot are continuous — 33.9 here, 39.2 there — and
 * a layer per distinct one would put thirty layers on a drawing with forty lines
 * on it. 5 degrees is finer than the springback of the fold itself, so snapping
 * to it costs nothing real and leaves a drawing an operator can sort by tool.
 */
const BIT_STEP = 5;

/**
 * The bits on offer, 0 being the auto bit.
 *
 * 90 and 120 are what a sign shop already owns, because a 90 makes a square box
 * and a 120 makes the obtuse corner most cladding wants. They are here for that
 * reason and not because this product needs them: a faceted pot folds far less
 * than either at most of its creases, and picking one of these is how the studio
 * gets to say so rather than letting the shop find out at the bench.
 */
export const V_BITS = [0, 45, 60, 90, 120, 135];

/**
 * The bit one crease needs.
 *
 * A groove of included angle a shuts on itself after turning through exactly a,
 * so the bit IS the fold angle — not a setting beside it. With a bit fitted for
 * the job every line gets that one; on the auto bit each line gets its own, and
 * the drawing has to carry the angle or the operator cannot act on it.
 */
export function creaseBit(model: PlanterModel, fold: FoldLine): number {
  if (fold.kind === 'cut' || model.groove.heatBent) return 0;
  if (model.parameters.vBitAngle > 0) return model.parameters.vBitAngle;
  const bend = fold.bend ?? model.maxBend;
  return Math.max(BIT_STEP, Math.round(bend / BIT_STEP) * BIT_STEP);
}

/**
 * Which bits the drawing asks for and how much of the job each one does.
 *
 * Written into the shop notes because the first thing anybody does with a
 * multi-tool drawing is work out how many setups it costs them.
 */
export function grooveLayerSummary(model: PlanterModel): string {
  const run = new Map<number, number>();
  for (const piece of model.pieces) {
    for (const fold of piece.folds) {
      const bit = creaseBit(model, fold);
      if (bit <= 0) continue;
      run.set(bit, (run.get(bit) ?? 0) + Math.hypot(fold.x2 - fold.x1, fold.y2 - fold.y1));
    }
  }
  if (run.size === 0) return 'no grooves';
  return [...run].sort((a, b) => a[0] - b[0])
    .map(([bit, mm]) => `${bit}° (${(mm / 1000).toFixed(2)} m)`).join(', ');
}

/**
 * Every crease the fitted bit cannot close, worst first.
 *
 * Fit a 90 degree bit to a fold that turns 39 and the groove bottoms out with 51
 * degrees still to go: there is no mechanical stop, the corner is held only by
 * whatever the rivets and the skin can do, and it springs. Fit one wider than
 * the fold and the bit cannot reach the angle at all. Both are silent on a
 * drawing that names no angle, which is why this exists.
 */
export function bitMismatch(model: PlanterModel, tolerance = 2): { bend: number; bit: number }[] {
  const bit = model.parameters.vBitAngle;
  if (bit <= 0 || model.groove.heatBent) return [];
  const seen = new Set<number>();
  const out: { bend: number; bit: number }[] = [];
  for (const piece of model.pieces) {
    for (const fold of piece.folds) {
      const bend = fold.bend;
      if (fold.kind === 'cut' || bend === undefined || bend <= FLAT_CREASE) continue;
      const key = Math.round(bend * 10);
      if (seen.has(key) || Math.abs(bend - bit) <= tolerance) continue;
      seen.add(key);
      out.push({ bend, bit });
    }
  }
  return out.sort((a, b) => Math.abs(b.bend - b.bit) - Math.abs(a.bend - a.bit));
}

const pair = (code: number, value: string | number): string => `${code}\n${value}\n`;

/**
 * DXF R12 — the format every router control still reads without argument. One
 * layer per fold kind, so cuts and grooves can be sent to different tools, and
 * one POLYLINE per run rather than a LINE per segment: a control treats every
 * entity as its own move, so a crease written segment by segment is cut as a row
 * of stabs. R12's POLYLINE/VERTEX/SEQEND is bulkier than a later LWPOLYLINE but
 * is what the old controls read, which is the reason to be writing R12 at all.
 *
 * Laid out for the groove face by default — see `PlanterFace`. Geometry only,
 * with no note in it saying which way round it is, so the face belongs in the
 * file name: it is the one thing a DXF cannot tell the person who opens it.
 */
export function buildPlanterDxf(model: PlanterModel, face: PlanterFace = 'groove'): string {
  const axis = faceAxis(model, face);
  // With one bit fitted, every groove goes to the same tool and the layer names
  // stay what every shop already has set up. On the auto bit the lines genuinely
  // need different tools, so each carries the angle it wants: MOUNTAIN-35 is a
  // 35 degree groove, and the operator can sort the job by tool without opening
  // a second document to find out which line is which.
  const perBit = model.parameters.vBitAngle === 0 && !model.groove.heatBent;
  const used = new Map<string, number>([[DXF_LAYERS.cut.name, DXF_LAYERS.cut.color]]);

  // 66 marks the vertices as following; bit 1 of 70 is what makes the run closed,
  // so a closed contour needs no joining up after it lands on the shop machine.
  const polyline = (layer: string, run: Polyline) => {
    let entity = pair(0, 'POLYLINE') + pair(8, layer) + pair(66, 1) + pair(70, run.closed ? 1 : 0)
      + pair(10, '0.0') + pair(20, '0.0') + pair(30, '0.0');
    for (const point of run.points) {
      entity += pair(0, 'VERTEX') + pair(8, layer)
        + pair(10, point.x.toFixed(3)) + pair(20, point.y.toFixed(3)) + pair(30, '0.0');
    }
    return entity + pair(0, 'SEQEND') + pair(8, layer);
  };

  let body = '';
  for (const piece of model.pieces) {
    // Joined piece by piece: two parts that happen to touch in the nest are still
    // two parts, and running their outlines together would cut them as one.
    const { outline, folds, holes, flaps } = placedGeometry(piece, axis);
    body += polyline(DXF_LAYERS.cut.name, simplifyPolyline({ points: outline, closed: true }));
    for (const hole of holes) {
      body += polyline(DXF_LAYERS.cut.name, simplifyPolyline({ points: hole, closed: true }));
    }
    // Open, and flagged open: a petal stays attached along its hinge.
    for (const flap of flaps) {
      body += polyline(DXF_LAYERS.cut.name, simplifyPolyline({ points: flapSlit(flap as Triangle2, model.parameters.perfTool), closed: false }));
    }
    for (const kind of FOLD_KINDS) {
      const mine = folds.filter((fold) => fold.kind === kind);
      if (mine.length === 0) continue;
      // Grouped by tool before they are joined up. Two creases that meet end to
      // end but want different bits are two runs, not one: chained together they
      // would be grooved in a single pass at whichever angle was read first.
      const byBit = new Map<number, FoldLine[]>();
      for (const fold of mine) {
        const bit = perBit ? creaseBit(model, fold) : 0;
        byBit.set(bit, [...(byBit.get(bit) ?? []), fold]);
      }
      for (const [bit, lines] of [...byBit].sort((a, b) => a[0] - b[0])) {
        const name = bit > 0 ? `${DXF_LAYERS[kind].name}-${bit}` : DXF_LAYERS[kind].name;
        used.set(name, DXF_LAYERS[kind].color);
        for (const run of chainFoldLines(lines)) body += polyline(name, run);
      }
    }
  }

  // The table is written last because only now is it known which layers the
  // drawing actually uses: a declared layer with nothing on it is a tool an
  // operator sets up for no reason.
  let out = pair(0, 'SECTION') + pair(2, 'TABLES') + pair(0, 'TABLE') + pair(2, 'LAYER') + pair(70, used.size);
  for (const [name, color] of used) {
    out += pair(0, 'LAYER') + pair(2, name) + pair(70, 0) + pair(62, color) + pair(6, 'CONTINUOUS');
  }
  out += pair(0, 'ENDTAB') + pair(0, 'ENDSEC') + pair(0, 'SECTION') + pair(2, 'ENTITIES') + body;
  return `${out}${pair(0, 'ENDSEC')}${pair(0, 'EOF')}`;
}

export { getMaterial };
