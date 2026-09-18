/**
 * Stand-in artwork for the storefront's photo slots.
 *
 * The shop has photographs coming, and `components/garden/media.ts` is where
 * they land. Until they do, every plate on the page is empty, which makes an
 * internal run impossible to read: you cannot judge a layout against grey
 * rectangles. So this script fills the gaps — and fills them with the product
 * rather than with decoration.
 *
 * Every pot drawn here is built by the same `buildPlanterModel` the studio and
 * the DXF export run on: real rings, real triangulation, real facets. The
 * pictures are illustrations, plainly, but they are illustrations OF the
 * catalogue, so a tile that looks wrong is telling you something true about the
 * geometry. Nothing here invents a product that cannot be cut.
 *
 * Output: `public/media/generated/*.svg` plus the manifest that indexes them.
 * Re-run with:  npx vite-node scripts/render-garden-media.ts
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { buildPlanterModel, DEFAULT_PLANTER, placedGeometry } from '../lib/planter-engine';
import { PLANTER_PRESETS } from '../lib/planter-styles';
import type { PlanterParameters, Vec2, Vec3 } from '../lib/types';

// ---------------------------------------------------------------------------
// Palette — the storefront's tokens, repeated here because an SVG written to
// disk cannot read a CSS custom property.
// ---------------------------------------------------------------------------

const LEAF = '#3f8f3a';
const LEAF_DEEP = '#235c26';
const LIME = '#9ed94f';
const SAGE = '#d9e6d2';
const INK = '#22301f';
const PAPER = '#fbfdfa';

/** The four finishes the range is shot in, plus the mirrors and the neutrals. */
const FINISH = {
  gold: '#e8c26a',
  silver: '#e7ebef',
  slate: '#5a5f63',
  blue: '#4a7ab0',
  green: '#3f9145',
  yellow: '#e0ac33',
  red: '#cf3b32',
  terracotta: '#c4633c',
  bottle: '#1f4a3a',
  sand: '#d9c9a8',
};

// ---------------------------------------------------------------------------
// Small kit: colour, vectors, deterministic noise
// ---------------------------------------------------------------------------

type RGB = [number, number, number];

function toRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function toHex(c: RGB): string {
  return `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const WHITE: RGB = [255, 255, 255];
/** Shadows fall towards a deep green-black rather than neutral grey — it keeps
 *  the metal sitting in a garden rather than in a studio void. */
const DARK: RGB = [14, 26, 18];

/**
 * Luminance to colour. The ramp bends at 0.62 so the base colour lands where
 * the eye expects the object's "true" colour to be — on the facets turned
 * squarely to the light, not on the ones facing away from it.
 *
 * How far the lit end travels towards white is what separates a mirror from
 * paint: polished metal really does blow out to white, but a matte red that
 * does the same just looks pink.
 */
function shade(base: RGB, lum: number, metal: number): RGB {
  const l = Math.max(0, Math.min(1.35, lum));
  if (l < 0.62) return mix(mix(base, DARK, 0.66), base, l / 0.62);
  return mix(base, mix(base, WHITE, 0.38 + metal * 0.38), Math.min(1, (l - 0.62) / 0.42));
}

const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
function unit(v: Vec3): Vec3 {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

/** Seeded, so a re-run produces identical files and a diff means a real change. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const n1 = (v: number) => v.toFixed(1);

// ---------------------------------------------------------------------------
// Projecting a planter
// ---------------------------------------------------------------------------

interface Face {
  pts: Vec2[];
  depth: number;
  lum: number;
  spec: number;
  front: boolean;
}

interface PotGeometry {
  faces: Face[];
  /** Mouth and foot rings, projected — the mouth carries the soil and the plant. */
  rim: Vec2[];
  foot: Vec2[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  heightMM: number;
}

function preset(id: string): PlanterParameters {
  const found = PLANTER_PRESETS.find((item) => item.id === id);
  if (!found) throw new Error(`unknown preset: ${id}`);
  return { ...DEFAULT_PLANTER, ...found.parameters };
}

/**
 * One pot, rotated into view and lit.
 *
 * Painter's algorithm over the engine's own triangles, flat-shaded — because
 * the facets *are* flat. The product is folded sheet, and the hard step from
 * one facet to the next is the thing worth showing.
 */
function potGeometry(parameters: PlanterParameters, azDeg: number, elDeg: number): PotGeometry {
  const model = buildPlanterModel(parameters);
  const p = model.parameters;
  const stride = p.sides + 1;
  const rings = model.vertices;
  const mid = p.height / 2;

  const az = (azDeg * Math.PI) / 180;
  const el = (elDeg * Math.PI) / 180;
  const ca = Math.cos(az);
  const sa = Math.sin(az);
  const ce = Math.cos(el);
  const se = Math.sin(el);

  let span = 0;
  for (const ring of rings) {
    for (const v of ring) span = Math.max(span, Math.hypot(v.x, v.y, v.z - mid));
  }
  // Far enough back that the perspective is a hint of one rather than a fisheye.
  const dist = span * 3.6;

  /** Spin about the vertical; the tilt is applied by the projection itself. */
  const spin = (v: Vec3): Vec3 => ({ x: v.x * ca + v.y * sa, y: -v.x * sa + v.y * ca, z: v.z - mid });

  const cam = rings.map((ring) => ring.map((v) => {
    const r = spin(v);
    const depth = r.y * ce - r.z * se;
    const k = dist / (dist + depth);
    return { x: r.x * k, y: -(r.z * ce + r.y * se) * k, depth };
  }));

  // Lights live in the camera's frame, not the world's, so the highlight stays
  // on the same shoulder of the pot whatever azimuth a tile is shot from.
  const view: Vec3 = { x: 0, y: -ce, z: se };
  const key = unit({ x: -0.52, y: -0.66, z: 0.54 });
  const fill = unit({ x: 0.8, y: -0.22, z: 0.1 });
  const half = unit(add(key, view));

  const at = (id: number) => cam[Math.floor(id / stride)][id % stride];
  const faces: Face[] = [];
  for (const tri of model.triangles) {
    const rn: Vec3 = {
      x: tri.normal.x * ca + tri.normal.y * sa,
      y: -tri.normal.x * sa + tri.normal.y * ca,
      z: tri.normal.z,
    };
    const front = dot(rn, view) > 0;
    // A back-facing triangle is still visible — through the mouth, as the
    // inside of the far wall. What you see there is its other side.
    const n: Vec3 = front ? rn : { x: -rn.x, y: -rn.y, z: -rn.z };
    const lum = front
      ? 0.13 + 0.8 * Math.max(0, dot(n, key)) + 0.2 * Math.max(0, dot(n, fill)) + 0.15 * (0.5 + 0.5 * n.z)
      : 0.05 + 0.14 * (0.5 + 0.5 * n.z);
    const corners = tri.v.map(at);
    faces.push({
      pts: corners.map((c) => ({ x: c.x, y: c.y })),
      depth: (corners[0].depth + corners[1].depth + corners[2].depth) / 3,
      lum,
      spec: front ? Math.pow(Math.max(0, dot(n, half)), 26) : 0,
      front,
    });
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const ring of cam) {
    for (const c of ring) {
      minX = Math.min(minX, c.x);
      maxX = Math.max(maxX, c.x);
      minY = Math.min(minY, c.y);
      maxY = Math.max(maxY, c.y);
    }
  }

  return {
    faces,
    rim: cam[cam.length - 1].map((c) => ({ x: c.x, y: c.y })),
    foot: cam[0].map((c) => ({ x: c.x, y: c.y })),
    minX,
    maxX,
    minY,
    maxY,
    heightMM: p.height,
  };
}

// ---------------------------------------------------------------------------
// Planting
// ---------------------------------------------------------------------------

type PlantKind = 'none' | 'grass' | 'leafy' | 'trailing';

const GREENS = ['#2f7a2c', '#3f8f3a', '#56a83f', '#78c24a', '#1f5c22'];

/** A filled sliver — a stroke cannot taper, and a blade of grass must. */
function blade(x0: number, y0: number, dx: number, h: number, w: number, fill: string): string {
  const tipX = x0 + dx;
  const tipY = y0 - h;
  const cx = x0 + dx * 0.25;
  const cy = y0 - h * 0.62;
  return `<path d="M${n1(x0 - w)},${n1(y0)} Q${n1(cx - w * 0.6)},${n1(cy)} ${n1(tipX)},${n1(tipY)} `
    + `Q${n1(cx + w * 0.6)},${n1(cy)} ${n1(x0 + w)},${n1(y0)} Z" fill="${fill}"/>`;
}

function leaf(x0: number, y0: number, angle: number, len: number, wid: number, fill: string): string {
  const a = (angle * Math.PI) / 180;
  const tx = x0 + Math.cos(a) * len;
  const ty = y0 + Math.sin(a) * len;
  const mx = x0 + Math.cos(a) * len * 0.5;
  const my = y0 + Math.sin(a) * len * 0.5;
  const nx = -Math.sin(a) * wid;
  const ny = Math.cos(a) * wid;
  return `<path d="M${n1(x0)},${n1(y0)} Q${n1(mx + nx)},${n1(my + ny)} ${n1(tx)},${n1(ty)} `
    + `Q${n1(mx - nx)},${n1(my - ny)} ${n1(x0)},${n1(y0)} Z" fill="${fill}"/>`;
}

/**
 * Coordinates here are already in output units — the pot has been placed.
 *
 * Split in two because the pot is painted between them: what grows out of the
 * soil is behind the front wall, and what spills over the lip hangs in front of
 * it. Drawing the whole plant in one pass loses the trailing vines entirely.
 */
interface Planting {
  behind: string;
  front: string;
}

function planting(kind: PlantKind, cx: number, cy: number, rx: number, ry: number, potH: number, seed: number): Planting {
  if (kind === 'none') return { behind: '', front: '' };
  const rand = rng(seed);
  const behind: string[] = [];
  const front: string[] = [];
  const pick = () => GREENS[Math.floor(rand() * GREENS.length)];

  if (kind === 'grass') {
    const count = 14;
    for (let i = 0; i < count; i += 1) {
      const t = (i + 0.5) / count;
      const x = cx + (t * 2 - 1) * rx * 0.78;
      const y = cy + Math.cos((t * 2 - 1) * 1.4) * ry * 0.3;
      behind.push(blade(x, y, (t * 2 - 1) * rx * 0.42 + (rand() - 0.5) * rx * 0.24,
        rx * (0.72 + rand() * 0.66), rx * 0.05, pick()));
    }
    return { behind: behind.join(''), front: '' };
  }

  // A rosette: a handful of leaves fanned off a short cluster of stems. Lengths
  // stay inside the mouth's own radius — a leaf twice as wide as the pot reads
  // as a scale error, not as a lush plant.
  const leaves = kind === 'trailing' ? 7 : 8;
  for (let i = 0; i < leaves; i += 1) {
    const t = i / (leaves - 1);
    const angle = -152 + t * 124 + (rand() - 0.5) * 12;
    const len = rx * (0.52 + rand() * 0.38);
    const x = cx + (t * 2 - 1) * rx * 0.32;
    const y = cy - ry * 0.1 + (rand() - 0.5) * ry * 0.28;
    const rad = (angle * Math.PI) / 180;
    behind.push(`<path d="M${n1(x)},${n1(y)} L${n1(x + Math.cos(rad) * len * 0.45)},${n1(y + Math.sin(rad) * len * 0.45)}" `
      + `stroke="${LEAF_DEEP}" stroke-width="${n1(rx * 0.04)}" fill="none"/>`);
    behind.push(leaf(x, y, angle, len, len * 0.27, pick()));
  }

  if (kind === 'trailing') {
    // How far a vine falls is a fraction of the POT's height. The mouth's
    // vertical radius is foreshortened almost to nothing at these camera
    // angles, so scaling the drop by it leaves the vines sticking out sideways.
    for (const side of [-1, 1]) {
      const x = cx + side * rx * 0.72;
      const y = cy + ry * 0.15;
      const drop = potH * 0.6;
      front.push(`<path d="M${n1(x)},${n1(y)} C${n1(x + side * rx * 0.34)},${n1(y + drop * 0.34)} `
        + `${n1(x - side * rx * 0.2)},${n1(y + drop * 0.7)} ${n1(x + side * rx * 0.18)},${n1(y + drop)}" `
        + `stroke="${LEAF}" stroke-width="${n1(rx * 0.05)}" fill="none" stroke-linecap="round"/>`);
      for (let i = 1; i <= 5; i += 1) {
        const t = i / 5.6;
        front.push(leaf(
          x + side * rx * 0.24 * Math.sin(t * 3.4) + side * rx * 0.06,
          y + drop * t,
          side > 0 ? 34 : 146,
          rx * 0.34,
          rx * 0.13,
          pick(),
        ));
      }
    }
  }
  return { behind: behind.join(''), front: front.join('') };
}

// ---------------------------------------------------------------------------
// Painting a pot into a box
// ---------------------------------------------------------------------------

interface PotShot {
  presetId: string;
  base: string;
  metal: number;
  az: number;
  el: number;
  plant?: PlantKind;
  seed?: number;
}

interface Placement {
  scale: number;
  tx: number;
  ty: number;
}

/** Fit a pot inside a box, standing on its floor, aspect preserved. */
function fitPot(g: PotGeometry, box: { x: number; y: number; w: number; h: number }): Placement {
  const scale = Math.min(box.w / (g.maxX - g.minX), box.h / (g.maxY - g.minY));
  return {
    scale,
    tx: box.x + box.w / 2 - ((g.minX + g.maxX) / 2) * scale,
    ty: box.y + box.h - g.maxY * scale,
  };
}

function paintPot(g: PotGeometry, shot: PotShot, place: Placement, shadow = true): string {
  const base = toRgb(shot.base);
  const { scale, tx, ty } = place;
  const map = (p: Vec2) => `${n1(tx + p.x * scale)},${n1(ty + p.y * scale)}`;
  // Every polygon is stroked in its own fill: adjacent triangles otherwise show
  // a hairline of background through the antialiasing seam between them.
  const poly = (pts: Vec2[], fill: string) =>
    `<polygon points="${pts.map(map).join(' ')}" fill="${fill}" stroke="${fill}" stroke-width="0.7"/>`;

  const paint = (f: Face) => {
    let c = shade(base, f.lum, shot.metal);
    if (f.spec > 0) c = mix(c, WHITE, f.spec * (0.25 + shot.metal * 0.7));
    return poly(f.pts, toHex(c));
  };

  const out: string[] = [];
  const centroid = (pts: Vec2[]) =>
    pts.reduce((a, p) => ({ x: a.x + p.x / pts.length, y: a.y + p.y / pts.length }), { x: 0, y: 0 });

  if (shadow) {
    const c = centroid(g.foot);
    const blot = g.foot.map((p) => ({ x: c.x + (p.x - c.x) * 1.34, y: c.y + (p.y - c.y) * 1.34 }));
    out.push(`<g filter="url(#soft)" opacity="0.26">${poly(blot, '#2c3d2a')}</g>`);
  }

  const back = g.faces.filter((f) => !f.front).sort((a, b) => b.depth - a.depth);
  const front = g.faces.filter((f) => f.front).sort((a, b) => b.depth - a.depth);
  out.push(...back.map(paint));

  // Soil, sunk a little below the collar so the mouth reads as an opening
  // rather than as a lid.
  const rimC = centroid(g.rim);
  const potH = (g.maxY - g.minY) * scale;
  const soil = g.rim.map((p) => ({ x: rimC.x + (p.x - rimC.x) * 0.93, y: rimC.y + (p.y - rimC.y) * 0.93 }));
  out.push(`<g transform="translate(0,${n1(potH * 0.022)})">${poly(soil, '#3a2f24')}</g>`);

  let spill = '';
  if (shot.plant && shot.plant !== 'none') {
    const xs = g.rim.map((p) => p.x);
    const ys = g.rim.map((p) => p.y);
    const grown = planting(
      shot.plant,
      tx + rimC.x * scale,
      ty + rimC.y * scale + potH * 0.022,
      ((Math.max(...xs) - Math.min(...xs)) * scale) / 2,
      ((Math.max(...ys) - Math.min(...ys)) * scale) / 2,
      potH,
      shot.seed ?? 7,
    );
    out.push(grown.behind);
    spill = grown.front;
  }

  out.push(...front.map(paint));
  out.push(spill);
  // The cut edge of the sheet, catching the light along the mouth.
  out.push(`<polyline points="${g.rim.map(map).join(' ')}" fill="none" `
    + `stroke="${toHex(mix(base, WHITE, 0.55))}" stroke-width="1.1" stroke-linejoin="round"/>`);
  return out.join('');
}

// ---------------------------------------------------------------------------
// Document scaffolding
// ---------------------------------------------------------------------------

const DEFS = '<defs>'
  + '<filter id="soft" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="9"/></filter>'
  + `<radialGradient id="ground" cx="50%" cy="62%" r="72%"><stop offset="0%" stop-color="${PAPER}"/>`
  + `<stop offset="100%" stop-color="${SAGE}"/></radialGradient>`
  + '</defs>';

function doc(w: number, h: number, body: string, background = 'url(#ground)'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img">`
    + DEFS
    + (background === 'none' ? '' : `<rect width="${w}" height="${h}" fill="${background}"/>`)
    + body
    + '</svg>';
}

const files: Record<string, string> = {};
const emit = (key: string, svg: string) => { files[key] = svg; };

/** One pot, alone, on a tile. */
function potPlate(key: string, w: number, h: number, shot: PotShot, background?: string, inset = 0.12): void {
  const g = potGeometry(preset(shot.presetId), shot.az, shot.el);
  // A planted pot gives up some of its own height: what grows out of it has to
  // fit in the tile too, and the pot still has to stand on the same floor.
  const room = shot.plant && shot.plant !== 'none' ? 0.74 : 1;
  const full = h * (1 - inset * 2);
  const box = { x: w * inset, y: h * inset + full * (1 - room), w: w * (1 - inset * 2), h: full * room };
  emit(key, doc(w, h, paintPot(g, shot, fitPot(g, box)), background));
}

// ---------------------------------------------------------------------------
// The slots
// ---------------------------------------------------------------------------

/** Catalogue tiles — square, near-white, unplanted: this is the object itself. */
const SHOP: { id: string; base: string; metal: number; az: number }[] = [
  { id: 'hex-diamond-500', base: FINISH.gold, metal: 1, az: 18 },
  { id: 'box-smooth-500', base: FINISH.bottle, metal: 0.15, az: 34 },
  { id: 'hex-crystal-500', base: FINISH.silver, metal: 1, az: 12 },
  { id: 'octa-column', base: FINISH.slate, metal: 0.55, az: 22 },
  { id: 'hex-barrel', base: FINISH.terracotta, metal: 0.2, az: 16 },
  { id: 'box-trough', base: FINISH.green, metal: 0.2, az: 40 },
  { id: 'hex-twist', base: FINISH.red, metal: 0.25, az: 26 },
  { id: 'hex-low-bowl', base: FINISH.sand, metal: 0.2, az: 20 },
];

for (const item of SHOP) {
  potPlate(`product-${item.id}`, 600, 600, {
    presetId: item.id, base: item.base, metal: item.metal, az: item.az, el: 17,
  });
}

/** The three the page leads with — taller crop, planted, on sage. */
const FEATURED: { id: string; base: string; metal: number; az: number; plant: PlantKind }[] = [
  { id: 'hex-diamond-500', base: FINISH.gold, metal: 1, az: 20, plant: 'leafy' },
  { id: 'hex-crystal-tall', base: FINISH.silver, metal: 1, az: 14, plant: 'grass' },
  { id: 'box-crystal', base: FINISH.red, metal: 0.3, az: 32, plant: 'trailing' },
];

FEATURED.forEach((item, index) => {
  potPlate(`featured-${item.id}`, 640, 800, {
    presetId: item.id, base: item.base, metal: item.metal, az: item.az, el: 15,
    plant: item.plant, seed: 31 + index * 7,
  }, '#dfeada', 0.14);
});

/** Category thumbnails — small, flat ground, has to read at 64px. */
const CATEGORY: { id: string; base: string; metal: number }[] = [
  { id: 'hex-crystal-500', base: FINISH.silver, metal: 1 },
  { id: 'penta-crystal', base: FINISH.blue, metal: 0.25 },
  { id: 'tri-facet', base: FINISH.yellow, metal: 0.25 },
  { id: 'hex-barrel', base: FINISH.terracotta, metal: 0.2 },
  { id: 'hex-waisted', base: FINISH.bottle, metal: 0.2 },
  { id: 'octa-barrel', base: FINISH.slate, metal: 0.5 },
];

for (const item of CATEGORY) {
  potPlate(`cat-${item.id}`, 240, 240, {
    presetId: item.id, base: item.base, metal: item.metal, az: 22, el: 18,
  }, SAGE, 0.1);
}

/** Instagram — the grid wants colour more than it wants detail. */
const INSTA: { id: string; base: string; metal: number; az: number; plant: PlantKind; bg: string }[] = [
  { id: 'hex-diamond-500', base: FINISH.blue, metal: 0.25, az: 24, plant: 'leafy', bg: '#eaf2e6' },
  { id: 'hex-twist', base: FINISH.yellow, metal: 0.25, az: 44, plant: 'none', bg: '#dfeada' },
  { id: 'octa-column', base: FINISH.green, metal: 0.2, az: 10, plant: 'none', bg: '#eef6ea' },
  { id: 'hex-low-bowl', base: FINISH.red, metal: 0.25, az: 30, plant: 'grass', bg: '#e3eedd' },
  { id: 'box-crystal', base: FINISH.silver, metal: 1, az: 38, plant: 'none', bg: '#eaf2e6' },
  { id: 'hex-crystal-500', base: FINISH.terracotta, metal: 0.2, az: 16, plant: 'trailing', bg: '#dfeada' },
];

INSTA.forEach((item, index) => {
  potPlate(`insta-${index + 1}`, 400, 400, {
    presetId: item.id, base: item.base, metal: item.metal, az: item.az, el: 16,
    plant: item.plant, seed: 101 + index * 13,
  }, item.bg, 0.1);
});

// --- the range band --------------------------------------------------------
// One shared scale across all six, because the whole point of this picture is
// that the same geometry runs from a tabletop bowl to an entrance column.
{
  const w = 1280;
  const h = 720;
  const row: { id: string; base: string; metal: number; plant: PlantKind }[] = [
    { id: 'hex-low-bowl', base: FINISH.yellow, metal: 0.25, plant: 'grass' },
    { id: 'hex-diamond-500', base: FINISH.red, metal: 0.25, plant: 'none' },
    { id: 'box-smooth-500', base: FINISH.blue, metal: 0.25, plant: 'leafy' },
    { id: 'hex-crystal-500', base: FINISH.green, metal: 0.25, plant: 'none' },
    { id: 'hex-crystal-tall', base: FINISH.blue, metal: 0.25, plant: 'none' },
    { id: 'octa-column', base: FINISH.red, metal: 0.25, plant: 'grass' },
  ];
  const geoms = row.map((item) => potGeometry(preset(item.id), 20, 14));
  const floor = h * 0.9;
  const tallest = Math.max(...geoms.map((g) => g.maxY - g.minY));
  const widest = geoms.reduce((sum, g) => sum + (g.maxX - g.minX), 0);
  // Fit the tallest to the band, then make sure the row still fits across it.
  const scale = Math.min((h * 0.72) / tallest, (w * 0.84) / widest);
  const gap = (w * 0.92 - widest * scale) / (row.length + 1);

  const body: string[] = [`<rect x="0" y="${n1(floor)}" width="${w}" height="${n1(h - floor)}" fill="${SAGE}" opacity="0.55"/>`];
  let cursor = w * 0.04 + gap;
  geoms.forEach((g, index) => {
    const place: Placement = { scale, tx: cursor - g.minX * scale, ty: floor - g.maxY * scale };
    body.push(paintPot(g, {
      presetId: row[index].id, base: row[index].base, metal: row[index].metal,
      az: 20, el: 14, plant: row[index].plant, seed: 200 + index * 5,
    }, place));
    cursor += (g.maxX - g.minX) * scale + gap;
  });
  emit('rangeColours', doc(w, h, body.join(''), PAPER));
}

// --- the hero --------------------------------------------------------------
// The net behind the pot, because that pairing IS the pitch: one flat sheet,
// one folded body. Drawn from the same nesting the DXF ships.
{
  const w = 800;
  const h = 1000;
  const params = preset('hex-diamond-500');
  const model = buildPlanterModel(params);
  const body: string[] = [];

  const netScale = Math.min((w * 1.02) / model.sheet.width, (h * 0.58) / model.sheet.height);
  const netX = w * 0.5 - (model.sheet.width * netScale) / 2;
  const netY = h * 0.11;

  const net: string[] = [];
  for (const piece of model.pieces) {
    const geo = placedGeometry(piece);
    const px = (p: Vec2) => `${n1(netX + p.x * netScale)},${n1(netY + p.y * netScale)}`;
    net.push(`<polygon points="${geo.outline.map(px).join(' ')}" fill="none" stroke="${INK}" stroke-width="1.1"/>`);
    for (const hole of geo.holes) {
      net.push(`<polygon points="${hole.map(px).join(' ')}" fill="none" stroke="${INK}" stroke-width="1.1"/>`);
    }
    for (const fold of geo.folds) {
      const colour = fold.kind === 'mountain' ? LEAF : fold.kind === 'valley' ? LIME : INK;
      const dash = fold.kind === 'valley' ? ' stroke-dasharray="7 5"' : '';
      net.push(`<line x1="${n1(netX + fold.x1 * netScale)}" y1="${n1(netY + fold.y1 * netScale)}" `
        + `x2="${n1(netX + fold.x2 * netScale)}" y2="${n1(netY + fold.y2 * netScale)}" `
        + `stroke="${colour}" stroke-width="0.8"${dash}/>`);
    }
  }
  body.push(`<g opacity="0.4" transform="rotate(-7 ${w / 2} ${n1(h * 0.34)})">${net.join('')}</g>`);

  const g = potGeometry(params, 22, 16);
  body.push(paintPot(g, { presetId: 'hex-diamond-500', base: FINISH.gold, metal: 1, az: 22, el: 16, plant: 'leafy', seed: 9 },
    fitPot(g, { x: w * 0.16, y: h * 0.3, w: w * 0.68, h: h * 0.55 })));

  // A RAL fan, reduced to the four chips the range is shot in.
  [FINISH.blue, FINISH.green, FINISH.yellow, FINISH.red].forEach((chip, index) => {
    body.push(`<rect x="${n1(w * 0.07 + index * 46)}" y="${n1(h * 0.905)}" width="38" height="54" rx="6" fill="${chip}"/>`);
  });
  body.push(`<text x="${n1(w * 0.94)}" y="${n1(h * 0.948)}" text-anchor="end" font-family="monospace" `
    + `font-size="20" fill="${INK}" opacity="0.62">1:1 · V-GROOVE</text>`);
  emit('hero', doc(w, h, body.join('')));
}

// --- the contact badge -----------------------------------------------------
// Not a portrait. Inventing a face for a real business is worse than a mark.
{
  const s = 400;
  const body = `<circle cx="${s / 2}" cy="${s / 2}" r="${s / 2}" fill="${LEAF_DEEP}"/>`
    + `<circle cx="${s / 2}" cy="${s / 2}" r="${n1(s * 0.37)}" fill="none" stroke="${LIME}" stroke-width="3" opacity="0.5"/>`
    + `<text x="${s / 2}" y="${n1(s * 0.47)}" text-anchor="middle" font-family="monospace" font-size="52" letter-spacing="2" fill="#ffffff">DXF</text>`
    + `<text x="${s / 2}" y="${n1(s * 0.64)}" text-anchor="middle" font-family="monospace" font-size="52" letter-spacing="2" fill="${LIME}">TLV</text>`;
  emit('contact', doc(s, s, body, 'none'));
}

// --- blog plates -----------------------------------------------------------
// Diagrams, not photographs: each one draws the thing its post is about.

/** 01 — what an ACM sheet actually is, in section, and what a V-groove does to it. */
{
  const w = 720;
  const h = 480;
  const x = 120;
  const width = 480;
  const y = 200;
  const body = [
    `<rect x="${x}" y="${y}" width="${width}" height="14" fill="#b9c2c8"/>`,
    `<rect x="${x}" y="${y + 14}" width="${width}" height="36" fill="${INK}" opacity="0.72"/>`,
    `<rect x="${x}" y="${y + 50}" width="${width}" height="14" fill="#d5dce1"/>`,
    `<line x1="${x - 34}" y1="${y}" x2="${x - 34}" y2="${y + 64}" stroke="${LEAF}" stroke-width="2"/>`,
    `<line x1="${x - 42}" y1="${y}" x2="${x - 26}" y2="${y}" stroke="${LEAF}" stroke-width="2"/>`,
    `<line x1="${x - 42}" y1="${y + 64}" x2="${x - 26}" y2="${y + 64}" stroke="${LEAF}" stroke-width="2"/>`,
    `<text x="${x - 52}" y="${y + 42}" text-anchor="end" font-family="monospace" font-size="24" fill="${INK}">4 mm</text>`,
    `<path d="M${x + 290},${y + 64} l24,-46 l24,46 Z" fill="${PAPER}"/>`,
    `<path d="M${x + 290},${y + 64} l24,-46 l24,46" fill="none" stroke="${LEAF}" stroke-width="2.6"/>`,
    `<text x="${x + 314}" y="${y + 104}" text-anchor="middle" font-family="monospace" font-size="20" fill="${LEAF}">V 90°</text>`,
    `<text x="${x}" y="${y - 44}" font-family="monospace" font-size="21" fill="${INK}" opacity="0.6">ALU / PE CORE / ALU</text>`,
  ].join('');
  emit('post-1', doc(w, h, body, PAPER));
}

/** 02 — a real net, in the notation the shop reads. */
{
  const w = 720;
  const h = 480;
  const model = buildPlanterModel(preset('hex-crystal-500'));
  const scale = Math.min((w * 0.84) / model.sheet.width, (h * 0.8) / model.sheet.height);
  const ox = w / 2 - (model.sheet.width * scale) / 2;
  const oy = h / 2 - (model.sheet.height * scale) / 2;
  const body: string[] = [];
  for (const piece of model.pieces) {
    const geo = placedGeometry(piece);
    const px = (p: Vec2) => `${n1(ox + p.x * scale)},${n1(oy + p.y * scale)}`;
    body.push(`<polygon points="${geo.outline.map(px).join(' ')}" fill="#ffffff" stroke="${INK}" stroke-width="1.4"/>`);
    for (const hole of geo.holes) {
      body.push(`<polygon points="${hole.map(px).join(' ')}" fill="${PAPER}" stroke="${INK}" stroke-width="1.4"/>`);
    }
    for (const fold of geo.folds) {
      const colour = fold.kind === 'mountain' ? LEAF : fold.kind === 'valley' ? '#4a7ab0' : INK;
      const dash = fold.kind === 'valley' ? ' stroke-dasharray="8 6"' : '';
      body.push(`<line x1="${n1(ox + fold.x1 * scale)}" y1="${n1(oy + fold.y1 * scale)}" `
        + `x2="${n1(ox + fold.x2 * scale)}" y2="${n1(oy + fold.y2 * scale)}" stroke="${colour}" stroke-width="1.1"${dash}/>`);
    }
  }
  emit('post-2', doc(w, h, body.join(''), PAPER));
}

/** 03 — drainage and planting, in section. */
{
  const w = 720;
  const h = 480;
  const cx = w / 2;
  const top = 140;
  const bottom = 400;
  const halfTop = 175;
  const halfBottom = 120;
  const body: string[] = [
    `<path d="M${cx - halfTop},${top} L${cx + halfTop},${top} L${cx + halfBottom},${bottom} L${cx - halfBottom},${bottom} Z" fill="#eef3ef" stroke="${INK}" stroke-width="2.4"/>`,
    `<path d="M${cx - halfBottom + 6},${bottom - 6} L${cx + halfBottom - 6},${bottom - 6} L${cx + halfBottom - 22},${bottom - 54} L${cx - halfBottom + 22},${bottom - 54} Z" fill="#c9cfd4"/>`,
    `<path d="M${cx - halfBottom + 22},${bottom - 54} L${cx + halfBottom - 22},${bottom - 54} L${cx + halfTop - 16},${top + 36} L${cx - halfTop + 16},${top + 36} Z" fill="#6b5340"/>`,
  ];
  const rand = rng(5);
  for (let i = 0; i < 24; i += 1) {
    body.push(`<circle cx="${n1(cx - halfBottom + 16 + rand() * (halfBottom * 2 - 32))}" `
      + `cy="${n1(bottom - 52 + rand() * 42)}" r="${n1(3 + rand() * 4)}" fill="#aab2b8"/>`);
  }
  for (const dx of [-70, 0, 70]) {
    body.push(`<path d="M${cx + dx - 14},${bottom} l14,22 l14,-22" fill="none" stroke="${LEAF}" stroke-width="2.6"/>`);
  }
  const grown = planting('leafy', cx, top + 42, halfTop * 0.72, 22, bottom - top, 17);
  body.push(grown.behind, grown.front);
  emit('post-3', doc(w, h, body.join(''), PAPER));
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

const outDir = 'public/media/generated';
mkdirSync(outDir, { recursive: true });

const keys = Object.keys(files).sort();
for (const key of keys) writeFileSync(`${outDir}/${key}.svg`, files[key]);

writeFileSync('components/garden/media-generated.ts', `/**
 * GENERATED FILE — do not edit by hand.
 * Written by \`scripts/render-garden-media.ts\`; re-run that to change anything here.
 *
 * Stand-in artwork for the photo slots that have no photograph yet. Real
 * photography listed in \`MEDIA\` always wins over these — see \`media.ts\`.
 */
export const GENERATED: Record<string, string> = {
${keys.map((key) => `  '${key}': '/media/generated/${key}.svg',`).join('\n')}
};
`);

console.log(`wrote ${keys.length} plates to ${outDir}`);
