/**
 * Direct UV printing — the artwork, and what it costs to put on a panel.
 *
 * The running order on the floor is mill, then print, then fold, and that order
 * decides everything in this module. The panel arrives at the printer already
 * grooved and already cut, so the artwork is not a wrapper drawn on a pot: it
 * is a flat file in the same millimetres as the DXF, registered to parts that
 * are already lying there. What goes down is ink on aluminium, a few microns
 * of it, cured hard by the lamp in the same pass.
 *
 * Two consequences run through the whole thing:
 *
 * 1. Ink does not fold. A UV film is a rigid varnish, and carried across a
 *    V-groove it crazes along the crease the first time the panel is bent —
 *    and a crease is the most visible line on the part. So the ink is pulled
 *    back from every fold and every cut edge, and what is left bare reads as
 *    a grout line between tiles. That is why filling by triangle is the right
 *    pattern for this process and not merely a nice one: the facets are
 *    exactly the regions that never bend, and the colour changes land on the
 *    creases, where the eye already expects a line.
 * 2. Nothing here moves a cut line. The pot is milled before it is printed, so
 *    the flat file is byte-identical whatever is chosen below — there is a
 *    test that says so, the same one the stone finish has.
 *
 * The colour generator is deterministic on purpose. A design that came back
 * from a customer has to print the same colours it was approved in, so every
 * rule is a pure function of the facet and one integer seed — reroll the seed
 * and you get another pot, keep it and you get this one, on any machine.
 */

import type { Vec2, Vec3 } from './types';

/**
 * What is printed.
 *
 * `triangles` is the generator: one flat colour per facet, straight off the
 * pot's own triangulation. `image` lands a customer's own PNG or JPG across
 * the developed wall — the net IS the print layout, so what the printer gets
 * is the file they sent, positioned. `none` leaves the panel in whatever
 * finish the sheet came in, which is every pot the catalogue shipped before
 * the printer arrived, so it is the default.
 */
export type PlanterPrint = 'none' | 'triangles' | 'image';

export const PRINT_MODES: PlanterPrint[] = ['none', 'triangles', 'image'];

/**
 * How a colour is chosen for each facet.
 *
 * All six read the same palette and differ only in what they ask about the
 * facet: where it is, which way it faces, or nothing at all.
 */
export type PlanterPrintRule =
  /** Nothing at all — a seeded draw per facet. Shattered glass. */
  | 'scatter'
  /** Where it is up the pot: the palette as a gradient from foot to mouth. */
  | 'ramp'
  /** Where it is round the pot: the palette walks the columns and climbs. */
  | 'around'
  /** Which way it faces: one palette used as light and shade, cut-gem style. */
  | 'facet'
  /** Smooth noise over the wall — patches that cross several facets. */
  | 'noise'
  /** The two triangles of every quad take opposite ends of the palette. */
  | 'harlequin';

export const PRINT_RULES: PlanterPrintRule[] = [
  'scatter', 'ramp', 'around', 'facet', 'noise', 'harlequin',
];

/** What each rule is called on a drawing. The Hebrew studio has its own copy. */
export const PRINT_RULE_NAMES: Record<PlanterPrintRule, string> = {
  scatter: 'Scatter',
  ramp: 'Gradient',
  around: 'Spiral',
  facet: 'Cut gem',
  noise: 'Patches',
  harlequin: 'Harlequin',
};

/** How an imported image is fitted to the developed wall. */
export type PlanterPrintFit = 'cover' | 'contain' | 'stretch';

export const PRINT_FITS: PlanterPrintFit[] = ['cover', 'contain', 'stretch'];

// ---------------------------------------------------------------------------
// The palettes
// ---------------------------------------------------------------------------

export interface PlanterPrintPalette {
  id: string;
  /** English name; the Hebrew studio has its own copy in the i18n layer. */
  name: string;
  /**
   * Six colours, light to dark.
   *
   * The order is load-bearing: `ramp` reads it as a gradient and `facet` reads
   * it as light and shade, so a palette shuffled out of order stops being a
   * gradient and starts being a mess. Six is enough for both and few enough
   * that a pot still reads as one object.
   */
  colours: string[];
}

/** The palette built from the designer's own six colours. */
export const CUSTOM_PALETTE = 'custom';

export const PRINT_PALETTES: PlanterPrintPalette[] = [
  // The catalogue pot: six saturated colours that hold their own against each
  // other, so neighbouring facets read as two tiles rather than as one tile
  // with a shadow on it. This is the palette the studio opens on, and the only
  // one where the ordering is a walk round the wheel rather than down the
  // values — `ramp` and `facet` on it give a rainbow, which is the point.
  { id: 'carnival', name: 'Carnival', colours: ['#f0a830', '#e0b02c', '#2bb5a0', '#2e9e5b', '#2f6fb5', '#c8324a'] },
  { id: 'harlequin', name: 'Harlequin', colours: ['#e8c63f', '#e2743a', '#c8324a', '#8a5fb5', '#2f6fb5', '#2e8f6b'] },
  // Image two: one hue, six values. The drafting overlay is what this one is
  // for — white line work on navy is a blueprint, and on anything else it is
  // just a pattern.
  { id: 'blueprint', name: 'Blueprint', colours: ['#c9d6e4', '#8fa5bd', '#5c7595', '#3c5474', '#243c5a', '#16263c'] },
  { id: 'desert', name: 'Desert sand', colours: ['#efe0c6', '#dcc096', '#c59a6b', '#a9764b', '#835739', '#573727'] },
  { id: 'jerusalem', name: 'Jerusalem stone', colours: ['#f5ead6', '#e5d2ab', '#ccb286', '#b09063', '#8c6e47', '#5e4930'] },
  { id: 'mediterranean', name: 'Mediterranean', colours: ['#f3f7f9', '#d0e4ed', '#8fc2d8', '#4b93b8', '#2b6484', '#153a52'] },
  { id: 'olive', name: 'Olive and pine', colours: ['#eef0dd', '#cbd4a4', '#9bb06c', '#6d8b45', '#45602f', '#27401f'] },
  { id: 'citrus', name: 'Citrus grove', colours: ['#fdf2bf', '#ffd45e', '#f7a325', '#e4642a', '#b8371f', '#6f2416'] },
  { id: 'sunset', name: 'Sunset', colours: ['#ffe2b8', '#ffb168', '#ff7a5c', '#e0455f', '#96306a', '#4a1f57'] },
  { id: 'basalt', name: 'Basalt', colours: ['#e6e7e8', '#b8bbbe', '#878c90', '#5a6064', '#383d41', '#1b1e21'] },
  { id: 'mono', name: 'Monochrome', colours: ['#ffffff', '#dcdcdc', '#b0b0b0', '#7a7a7a', '#454545', '#101010'] },
  { id: 'bauhaus', name: 'Bauhaus', colours: ['#f2efe6', '#e3b505', '#d1462f', '#2a6f97', '#5b6068', '#1d1d1b'] },
  { id: 'pastel', name: 'Pastel', colours: ['#fbe8e7', '#f6d7e7', '#ded9f3', '#cde6ef', '#d7edd8', '#f4efd6'] },
  { id: 'neon', name: 'Neon', colours: ['#2ef0a7', '#2ec5ff', '#a24bff', '#ff2e88', '#ff9f1c', '#0b0f1a'] },
  { id: 'copper', name: 'Copper and brass', colours: ['#f6e3c5', '#e0b269', '#c98b3c', '#a45f2b', '#7a3f22', '#4a2718'] },
];

export const paletteById = (id: string): PlanterPrintPalette | null =>
  PRINT_PALETTES.find((palette) => palette.id === id) ?? null;

/** What a palette is called on a drawing — including the one with no catalogue name. */
export const paletteName = (id: string): string =>
  (id === CUSTOM_PALETTE ? 'Custom colours' : paletteById(id)?.name ?? PRINT_PALETTES[0].name);

/** Colours a palette actually offers, with the designer's own six as one of them. */
export function paletteColours(id: string, custom: string[]): string[] {
  if (id === CUSTOM_PALETTE) return custom.length > 0 ? custom : PRINT_PALETTES[0].colours;
  return (paletteById(id) ?? PRINT_PALETTES[0]).colours;
}

/** Every palette carries six, and no rule may ask for more than it has. */
export const MAX_PRINT_TONES = 6;

/** What a fresh custom palette opens on — the brand's own, and editable. */
export const DEFAULT_PRINT_COLOURS = ['#1f4a3a', '#3f9145', '#d9c9a8', '#c4633c', '#2b6484', '#17181c'];

// ---------------------------------------------------------------------------
// Colour arithmetic
// ---------------------------------------------------------------------------

const HEX = /^#[0-9a-f]{6}$/i;

export const isHex = (value: unknown): boolean => HEX.test(String(value));

const toRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16),
];

const byte = (value: number): string =>
  Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, '0');

/** Scale a colour's brightness, staying in sRGB and staying a colour. */
export function shadeHex(hex: string, factor: number): string {
  if (!isHex(hex)) return hex;
  const [r, g, b] = toRgb(hex);
  return '#' + byte(r * factor) + byte(g * factor) + byte(b * factor);
}

/**
 * Relative luminance, for deciding what to write ON a colour.
 *
 * The shop sheet labels facets with their own colour, and a label has to be
 * readable on a neon yellow and on a basalt black alike.
 */
export function luminance(hex: string): number {
  if (!isHex(hex)) return 1;
  const [r, g, b] = toRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// ---------------------------------------------------------------------------
// The generator
// ---------------------------------------------------------------------------

/** One facet, as much of it as a colour rule is allowed to know about. */
export interface PrintFacet {
  /** Index into the model's own triangle list — what keeps the draw stable. */
  index: number;
  /** Band up the pot, 0 at the foot. */
  band: number;
  /** Column round the pot, 0 at the seam. */
  column: number;
  /** The upward-pointing triangle of its quad, or the other one. */
  up: boolean;
  /** Centroid height, 0 at the foot ring and 1 at the mouth. */
  height: number;
  /** Centroid angle round the pot, 0 to 1 from the seam. */
  around: number;
  /** Outward normal in the pot's own frame, z up. */
  normal: Vec3;
}

export interface PrintOptions {
  rule: PlanterPrintRule;
  /** Light to dark, six at most — `paletteColours` gives one. */
  colours: string[];
  /** How many of them are in play, 2 upwards. */
  tones: number;
  seed: number;
  /** How much of the facet's own light and shade is mixed in (%). */
  shade: number;
}

/**
 * The studio's key light, in the pot's own frame.
 *
 * The `facet` rule shades against this, and the preview lights the pot from
 * roughly the same quarter — so a pot that reads as a cut gem on screen reads
 * as one in a garden, which is the entire point of shading by facet rather
 * than by position.
 */
const KEY_LIGHT: Vec3 = { x: 0.38, y: -0.66, z: 0.65 };

const unit = (v: Vec3): Vec3 => {
  const length = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
};

const KEY = unit(KEY_LIGHT);

/** How square-on a facet faces the key light, 0 (away) to 1 (straight at it). */
export function facetLight(normal: Vec3): number {
  const n = unit(normal);
  return Math.min(1, Math.max(0, 0.5 + 0.5 * (n.x * KEY.x + n.y * KEY.y + n.z * KEY.z)));
}

/**
 * A stable draw for one facet.
 *
 * Deliberately a hash of the facet's own index and the seed rather than the
 * n-th value of a stream: a stream renumbers every facet the moment a band is
 * added, so a pot approved in one set of colours would come back from a
 * one-band edit in a different set throughout. A hash only changes the pot
 * where the pot changed.
 */
function hashUnit(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x165667b1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2545f491);
  h ^= h >>> 13;
  return ((h >>> 0) % 100000) / 100000;
}

/** Smooth value noise, so a patch crosses several facets instead of one. */
function noise2(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const ease = (t: number) => t * t * (3 - 2 * t);
  const ex = ease(x - ix);
  const ey = ease(y - iy);
  const at = (gx: number, gy: number) => hashUnit(Math.imul(gx, 73856093) ^ Math.imul(gy, 19349663), seed);
  const top = at(ix, iy) * (1 - ex) + at(ix + 1, iy) * ex;
  const bottom = at(ix, iy + 1) * (1 - ex) + at(ix + 1, iy + 1) * ex;
  return top * (1 - ey) + bottom * ey;
}

/** Which colour of the palette a rule lands on, 0 upwards. */
export function toneIndex(facet: PrintFacet, options: PrintOptions): number {
  const tones = Math.max(2, Math.min(Math.round(options.tones), options.colours.length));
  const last = tones - 1;
  const hold = (value: number) => Math.max(0, Math.min(last, value));

  switch (options.rule) {
    case 'ramp':
      // Half a step of stagger between the two triangles of a quad, so the
      // boundary between two colours zigzags along the facets instead of
      // running round the pot as a printed stripe — which is what a folded
      // wall is for.
      return hold(Math.round(facet.height * last + (facet.up ? 0.35 : -0.35)));
    case 'around':
      return (facet.column + facet.band) % tones;
    case 'facet':
      return hold(Math.round((1 - facetLight(facet.normal)) * last));
    case 'noise':
      // Between two and three repeats round the pot and about one a band up
      // it: big enough that a patch is a patch, small enough that a tall pot
      // is not one colour.
      return hold(Math.floor(noise2(facet.around * 2.4, facet.height * 3.2, options.seed) * tones));
    case 'harlequin': {
      const step = (facet.column + facet.band) % tones;
      return facet.up ? step : last - step;
    }
    case 'scatter':
    default:
      return hold(Math.floor(hashUnit(facet.index, options.seed) * tones));
  }
}

/**
 * The colour each facet is printed in.
 *
 * One pass, pure, and in the model's own triangle order — which is what lets
 * the preview, the print file and the shop's colour list all quote the same
 * colours without any of them re-deriving anything.
 */
export function triangleFills(facets: PrintFacet[], options: PrintOptions): string[] {
  const shade = Math.max(0, Math.min(1, options.shade / 100));
  return facets.map((facet) => {
    const colour = options.colours[toneIndex(facet, options)] ?? options.colours[0];
    if (shade <= 0) return colour.toLowerCase();
    // Never to black and never blown out: the shading is there to give a flat
    // fill some relief, and a facet that has gone to black has stopped being
    // the colour that was approved.
    const factor = 1 + shade * (0.62 + 0.62 * facetLight(facet.normal) - 1);
    return shadeHex(colour, factor).toLowerCase();
  });
}

// ---------------------------------------------------------------------------
// Keeping the ink off the creases
// ---------------------------------------------------------------------------

/**
 * How far the ink stays back from every fold and every cut edge (mm).
 *
 * The default is a millimetre and a half, which is about what a V-groove opens
 * up on 4 mm composite plus the registration the bed is good for. Zero is
 * allowed — a panel that is printed and never folded, or one the shop is
 * willing to see craze — and the notes say what that costs.
 */
export const DEFAULT_GROUT = 1.5;
export const MAX_GROUT = 8;

export const triangleArea = (t: [Vec2, Vec2, Vec2]): number =>
  Math.abs((t[1].x - t[0].x) * (t[2].y - t[0].y) - (t[2].x - t[0].x) * (t[1].y - t[0].y)) / 2;

export const trianglePerimeter = (t: [Vec2, Vec2, Vec2]): number =>
  Math.hypot(t[1].x - t[0].x, t[1].y - t[0].y)
  + Math.hypot(t[2].x - t[1].x, t[2].y - t[1].y)
  + Math.hypot(t[0].x - t[2].x, t[0].y - t[2].y);

/**
 * The same triangle, pulled back `by` millimetres from all three of its edges.
 *
 * Exact rather than approximate, and cheap with it: a triangle inset by a
 * constant distance is similar to itself about its incentre, scaled on its own
 * inradius by (r - by) / r. Null once the whole facet is grout — a facet too
 * small to print is better left bare than printed as a sliver.
 */
export function insetTriangle(t: [Vec2, Vec2, Vec2], by: number): [Vec2, Vec2, Vec2] | null {
  if (by <= 0) return t;
  const a = Math.hypot(t[2].x - t[1].x, t[2].y - t[1].y);
  const b = Math.hypot(t[0].x - t[2].x, t[0].y - t[2].y);
  const c = Math.hypot(t[1].x - t[0].x, t[1].y - t[0].y);
  const perimeter = a + b + c;
  if (perimeter <= 0) return null;
  const inradius = (2 * triangleArea(t)) / perimeter;
  if (inradius <= by) return null;
  const ratio = 1 - by / inradius;
  const centre = {
    x: (a * t[0].x + b * t[1].x + c * t[2].x) / perimeter,
    y: (a * t[0].y + b * t[1].y + c * t[2].y) / perimeter,
  };
  return t.map((point) => ({
    x: centre.x + (point.x - centre.x) * ratio,
    y: centre.y + (point.y - centre.y) * ratio,
  })) as [Vec2, Vec2, Vec2];
}

// ---------------------------------------------------------------------------
// The machine
// ---------------------------------------------------------------------------

/**
 * The flatbed the shop runs (mm).
 *
 * A 2.5 x 1.3 m bed, which is the common size and takes a standard
 * 1220 x 2440 composite sheet whole, lengthwise, with room to register it. A
 * nest that does not fit has to be printed in tiles, and a tile boundary is a
 * visible join, so the checks say so rather than letting it turn up on a pot.
 */
export const PRINT_BED = { width: 2500, height: 1300 };

/** Print passes over the bed, in tiles, for a nest this size. */
export function printTiles(
  width: number, height: number, bed: { width: number; height: number } = PRINT_BED,
): number {
  if (width <= 0 || height <= 0) return 0;
  const across = (w: number, h: number) => Math.ceil(width / w) * Math.ceil(height / h);
  return Math.max(1, Math.min(across(bed.width, bed.height), across(bed.height, bed.width)));
}

/**
 * Ink laid down at full coverage (ml/m2).
 *
 * CMYK at production quality is the small number; a white underbase is the
 * expensive one, and it is not optional on a dark or a mirrored panel —
 * colour printed straight onto polished aluminium is a tint on a mirror, not a
 * colour. Varnish is the third pass, and it is what decides matte or gloss.
 */
const INK_COLOUR = 9;
const INK_WHITE = 16;
const INK_VARNISH = 12;

/** What the bed actually covers in an hour, one pass, at production quality (m2/h). */
const PRINT_RATE = 12;
/** Loading, registering and squaring one panel on the bed (minutes). */
const SETUP_MINUTES = 10;

export const printPasses = (white: boolean, varnish: boolean): number =>
  1 + (white ? 1 : 0) + (varnish ? 1 : 0);

export const printInkMl = (areaM2: number, white: boolean, varnish: boolean): number =>
  Math.max(areaM2, 0) * (INK_COLOUR + (white ? INK_WHITE : 0) + (varnish ? INK_VARNISH : 0));

export const printMinutes = (areaM2: number, passes: number, tiles: number): number =>
  (Math.max(areaM2, 0) / PRINT_RATE) * 60 * passes + SETUP_MINUTES * Math.max(tiles, 1);

/**
 * What a cured UV film adds to the panel (kg), per pass.
 *
 * Micrometres of acrylate: real, weighable, and three orders of magnitude
 * under the stone coat. It is here so the two finishes answer the same
 * question in the same units instead of one of them going quiet.
 */
export const printKg = (areaM2: number, passes: number): number =>
  Math.max(areaM2, 0) * 0.012 * passes;
