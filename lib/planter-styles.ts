import type { PlanterCategory, PlanterPreset, PlanterStyleSpec } from './types';

/**
 * A planter wall is a stack of regular polygon or rectangular rings. A style says
 * two things: how far each ring is rotated past the one below it, which decides
 * whether the facets come out as quads, diamonds or a spiral; and how the band
 * heights alternate, which decides how deep the rhythm reads.
 *
 * Neither lever bends the wall out of shape. Moving a ring in or out radially
 * would — it leaves Gaussian curvature at every vertex it touches, and a curved
 * surface has no flat net at all. Taper, stagger, twist and band height are the
 * four things a single blank can do, so they are the four things a style is
 * allowed to change; curvature is left to the `bulge` parameter, which needs
 * banded construction to be buildable.
 */
export const PLANTER_STYLES: PlanterStyleSpec[] = [
  {
    id: 'prism', name: 'Straight Facet', subtitle: 'Clean prism or frustum',
    description: 'Rings stay aligned, so every side is one flat quad — the crisp tapered pot that reads as solid stone.',
    difficulty: 'Low', applications: ['Lobby', 'Retail', 'Balcony'],
    offsetStep: 0, band: () => 0, recommendedRows: 1, recommendedMaterial: 'acp-4',
  },
  {
    id: 'crystal', name: 'Crystal Facet', subtitle: 'Even triangulated skin',
    description: 'Every ring staggers half a facet, breaking the wall into the triangulated low-poly skin the category is built on.',
    difficulty: 'Medium', applications: ['Showroom', 'Entrance'],
    offsetStep: 0.5, band: () => 0, recommendedRows: 2, recommendedMaterial: 'acp-4',
  },
  {
    id: 'diamond', name: 'Diamond Relief', subtitle: 'Tall and short bands',
    description: 'Half-facet stagger with the bands alternating tall and short, quilting the wall into pronounced diamonds.',
    difficulty: 'Medium', applications: ['Lobby', 'Showroom', 'Retail'],
    offsetStep: 0.5, band: (index) => (index % 2 === 0 ? 1 : -1), recommendedRows: 4, recommendedMaterial: 'acp-4',
  },
  {
    id: 'ripple', name: 'Ripple Band', subtitle: 'Fine horizontal ribbing',
    description: 'Many shallow staggered bands over a sharp height rhythm — the wall ribs horizontally and catches raking light.',
    difficulty: 'Medium', applications: ['Hotel', 'Corridor'],
    offsetStep: 0.5, band: (index) => (index % 2 === 0 ? -1 : 1), recommendedRows: 6, recommendedMaterial: 'acp-3',
  },
  {
    id: 'spiral', name: 'Spiral Facet', subtitle: 'Quarter-stagger twist',
    description: 'Each ring steps a quarter facet round, winding the creases up the wall without any taper doing the work.',
    difficulty: 'High', applications: ['Showroom', 'Hotel'],
    offsetStep: 0.25, band: () => 0, recommendedRows: 4, recommendedMaterial: 'acp-3',
  },
  {
    id: 'star', name: 'Star Facet', subtitle: 'Three-step rotation',
    description: 'A third of a facet per ring over a strong height rhythm, so the creases chase each other round in a starburst.',
    difficulty: 'High', applications: ['Art piece', 'Entrance'],
    offsetStep: 1 / 3, band: (index) => (index % 2 === 0 ? 1 : -0.6), recommendedRows: 3, recommendedMaterial: 'acp-3',
  },
];

export function getPlanterStyle(id: string): PlanterStyleSpec {
  return PLANTER_STYLES.find((style) => style.id === id) ?? PLANTER_STYLES[0];
}

export const PLANTER_CATEGORIES: { id: PlanterCategory | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'box', label: 'Box' },
  { id: 'faceted', label: 'Faceted' },
  { id: 'banded', label: 'Banded' },
  { id: 'column', label: 'Column' },
];

/**
 * Stock designs, sized the way these pots actually ship: 280–720 mm tall, a
 * footprint that clears a standard nursery liner, and a net that nests inside one
 * 1220 × 2440 mm sheet. Every one of them develops flat with no stretch — the
 * rhythm designs run straight-walled because a height rhythm is free on a straight
 * wall and fights a taper, and the bulged ones are banded because a curved wall has
 * no single-blank net at all.
 */
export const PLANTER_PRESETS: PlanterPreset[] = [
  // --- Box: rectangular footprints, smooth or lightly faceted ---------------
  {
    id: 'box-smooth-500', name: 'Smooth Box 500', note: '400 × 300 mm mouth, plain tapered sides', category: 'box',
    parameters: {
      style: 'prism', footprint: 'rectangle', rows: 1, height: 500,
      topWidth: 400, topLength: 300, bottomWidth: 320, bottomLength: 240,
    },
  },
  {
    id: 'box-cube-400', name: 'Cube 400', note: 'Straight-sided cube, no taper at all', category: 'box',
    parameters: {
      style: 'prism', footprint: 'rectangle', rows: 1, height: 400,
      topWidth: 400, topLength: 400, bottomWidth: 400, bottomLength: 400,
    },
  },
  {
    id: 'box-trough', name: 'Long Trough', note: '900 mm run for a balcony rail', category: 'box',
    parameters: {
      style: 'prism', footprint: 'rectangle', rows: 1, height: 380,
      topWidth: 900, topLength: 300, bottomWidth: 840, bottomLength: 250,
    },
  },
  {
    id: 'box-twist', name: 'Box Twist', note: 'Square box wrung 20° top to bottom', category: 'box',
    parameters: {
      style: 'prism', footprint: 'rectangle', rows: 1, height: 520, twist: 20,
      topWidth: 380, topLength: 380, bottomWidth: 300, bottomLength: 300,
    },
  },
  {
    id: 'box-crystal', name: 'Box Crystal', note: 'Square pot with a faceted waist', category: 'box',
    parameters: {
      style: 'crystal', footprint: 'rectangle', rows: 2, height: 520,
      topWidth: 400, topLength: 400, bottomWidth: 300, bottomLength: 300,
    },
  },
  {
    id: 'square-taper-500', name: 'Square Taper 500', note: '400 mm mouth on a 500 mm body', category: 'box',
    parameters: { style: 'prism', sides: 4, topDiameter: 566, bottomDiameter: 410, height: 500, rows: 1 },
  },

  // --- Faceted: regular polygon walls folded from one blank -----------------
  {
    id: 'hex-diamond-500', name: 'Hex Diamond 500', note: 'Six-sided quilted pot, the catalogue hero', category: 'faceted',
    parameters: { style: 'diamond', sides: 6, topDiameter: 340, bottomDiameter: 340, height: 500, rows: 4, rhythm: 32 },
  },
  {
    id: 'hex-crystal-500', name: 'Hex Crystal 500', note: 'Even facets, gentle taper', category: 'faceted',
    parameters: { style: 'crystal', sides: 6, topDiameter: 380, bottomDiameter: 310, height: 500, rows: 3 },
  },
  {
    id: 'hex-twist', name: 'Hex Twist', note: 'One crease per side, wrung round 26°', category: 'faceted',
    parameters: { style: 'prism', sides: 6, topDiameter: 350, bottomDiameter: 250, height: 560, rows: 1, twist: 26 },
  },
  {
    id: 'hex-plain', name: 'Hex Plain', note: 'Flat-sided tapered hexagon', category: 'faceted',
    parameters: { style: 'prism', sides: 6, topDiameter: 380, bottomDiameter: 290, height: 480, rows: 1 },
  },
  {
    id: 'penta-crystal', name: 'Penta Crystal', note: 'Five-sided faceted planter', category: 'faceted',
    parameters: { style: 'crystal', sides: 5, topDiameter: 420, bottomDiameter: 300, height: 500, rows: 2 },
  },
  {
    id: 'hex-star', name: 'Hex Star', note: 'Creases chase round in a starburst', category: 'faceted',
    parameters: { style: 'star', sides: 6, topDiameter: 330, bottomDiameter: 330, height: 520, rows: 3, rhythm: 28 },
  },
  {
    id: 'hex-low-bowl', name: 'Hex Low Bowl', note: 'Wide and low, for tabletop greenery', category: 'faceted',
    parameters: { style: 'diamond', sides: 6, topDiameter: 400, bottomDiameter: 400, height: 280, rows: 2, rhythm: 25 },
  },
  {
    id: 'tri-facet', name: 'Tri Facet', note: 'Three-sided sculptural planter', category: 'faceted',
    parameters: { style: 'prism', sides: 3, topDiameter: 560, bottomDiameter: 400, height: 520, rows: 1, twist: 18 },
  },

  // --- Banded: strips riveted ring to ring, so the wall is free to curve ----
  {
    id: 'hex-barrel', name: 'Hex Barrel', note: 'Bulged waist — only a banded build holds it', category: 'banded',
    parameters: {
      style: 'crystal', construction: 'banded', sides: 6, height: 500, rows: 4, bulge: 20,
      topDiameter: 360, bottomDiameter: 330,
    },
  },
  {
    id: 'hex-waisted', name: 'Hex Waisted', note: 'Pinched middle, four riveted bands', category: 'banded',
    parameters: {
      style: 'crystal', construction: 'banded', sides: 6, height: 540, rows: 4, bulge: -22,
      topDiameter: 380, bottomDiameter: 360,
    },
  },
  {
    id: 'octa-barrel', name: 'Octa Barrel', note: 'Eight-sided belly over five bands', category: 'banded',
    parameters: {
      style: 'crystal', construction: 'banded', sides: 8, height: 520, rows: 5, bulge: 24,
      topDiameter: 340, bottomDiameter: 320,
    },
  },
  {
    id: 'box-barrel', name: 'Box Barrel', note: 'Rectangular pot with a swelled middle', category: 'banded',
    parameters: {
      style: 'prism', construction: 'banded', footprint: 'rectangle', rows: 4, height: 500, bulge: 18,
      topWidth: 380, topLength: 300, bottomWidth: 340, bottomLength: 260,
    },
  },
  {
    id: 'hex-diamond-barrel', name: 'Diamond Barrel', note: 'Quilted facets over a bulged profile', category: 'banded',
    parameters: {
      style: 'diamond', construction: 'banded', sides: 6, height: 520, rows: 4, rhythm: 30, bulge: 16,
      topDiameter: 340, bottomDiameter: 320,
    },
  },

  // --- Column: tall and slim ------------------------------------------------
  {
    id: 'hex-crystal-tall', name: 'Hex Crystal Tall', note: 'Tapered low-poly column', category: 'column',
    parameters: { style: 'crystal', sides: 6, topDiameter: 360, bottomDiameter: 230, height: 620, rows: 2 },
  },
  {
    id: 'octa-column', name: 'Octa Column', note: 'Slim eight-sided entrance column', category: 'column',
    parameters: { style: 'crystal', sides: 8, topDiameter: 300, bottomDiameter: 240, height: 720, rows: 4 },
  },
  {
    id: 'hex-spiral', name: 'Hex Spiral', note: 'Creases wind a quarter facet per band', category: 'column',
    parameters: { style: 'spiral', sides: 6, topDiameter: 350, bottomDiameter: 280, height: 560, rows: 4 },
  },
  {
    id: 'octa-ripple', name: 'Octa Ripple', note: 'Eight sides ribbed into fine bands', category: 'column',
    parameters: { style: 'ripple', sides: 8, topDiameter: 310, bottomDiameter: 310, height: 520, rows: 6, rhythm: 34 },
  },
  {
    id: 'hex-ripple', name: 'Hex Ripple', note: 'Ribbed hexagon, five shallow bands', category: 'column',
    parameters: { style: 'ripple', sides: 6, topDiameter: 330, bottomDiameter: 330, height: 540, rows: 5, rhythm: 30 },
  },
];

/** The neutral starting point behind the library's "Start from scratch" card. */
export const BLANK_PLANTER: PlanterPreset = {
  id: 'blank', name: 'Start from scratch', note: 'A plain 400 × 300 × 500 mm box to build on', category: 'box',
  parameters: {
    style: 'prism', footprint: 'rectangle', construction: 'single-sheet', rows: 1,
    height: 500, topWidth: 400, topLength: 300, bottomWidth: 400, bottomLength: 300,
    twist: 0, bulge: 0, rhythm: 0,
  },
};
