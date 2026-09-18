/**
 * Stone and rock cladding — the catalogue the painters work from, and the
 * arithmetic of a coat that goes on by hand.
 *
 * This is a finish, not a cut. Every pot is painted after it is folded, by a
 * person, with a trowel and a brush, so nothing in this module may ever reach
 * a cut line — the DXF is byte-identical whatever is picked here, and there is
 * a test that says so. What it does decide is what the painter is told: which
 * stone, how thick to build it, how many passes that is, how much render to mix,
 * how long it takes, and what the build costs the pot in weight and in daylight
 * through its cut-outs.
 *
 * The catalogue is DXF-STONE's, unchanged: forty materials on the stone trade's
 * own taxonomy of {type} — {trade name} — {finish}, codes ST101 to ST140. The
 * Hebrew names live in the i18n layer, as they do everywhere else here.
 */

export type StoneFamily = 'raw' | 'dark' | 'marble' | 'sandstone' | 'wall' | 'moss' | 'concrete' | 'slate';

/** Shelf order: the rough natural faces first, the built and cast ones last. */
export const STONE_FAMILIES: StoneFamily[] = [
  'raw', 'dark', 'sandstone', 'marble', 'wall', 'moss', 'slate', 'concrete',
];

export interface PlanterStoneMaterial {
  /** Texture folder under public/media/stone, and the id stored on a design. */
  id: string;
  /** Catalogue code, ST101 upwards — what a shop order says. */
  code: string;
  family: StoneFamily;
  /** Geological origin: Limestone, Basalt, Granite. */
  type: string;
  /** What the quarry sells it as. */
  trade: string;
  /** What was done to the surface: split-face, flamed, tobzeh. */
  finish: string;
  /**
   * How wide one repeat of this stone is in the real world (mm).
   *
   * This is the number that decides whether a pot reads as stone or as
   * wallpaper. A 600 mm ashlar block on a 300 mm pot gives one block and a
   * believable boulder; the same block tiled at 60 mm gives gravel.
   */
  tileMm: number;
  /** The material's average colour — the chip, and what shows before the maps land. */
  tone: string;
}

export const STONE_MATERIALS: PlanterStoneMaterial[] = [
  { id: 'rock_face_03', code: 'ST101', family: 'raw', type: 'Limestone', trade: 'Ankar Quarry', finish: 'Split-face', tileMm: 360, tone: '#8c8275' },
  { id: 'rock_face_04', code: 'ST102', family: 'raw', type: 'Granite', trade: 'Cliff Grey', finish: 'Split-face Seam Face', tileMm: 430, tone: '#8f8577' },
  { id: 'rock_surface', code: 'ST103', family: 'raw', type: 'Limestone', trade: 'Desert Shell', finish: 'Natural Surface', tileMm: 290, tone: '#7f7a72' },
  { id: 'rock_boulder_cracked', code: 'ST104', family: 'raw', type: 'Granite', trade: 'Fractured Grey', finish: 'Weathered & Worn', tileMm: 480, tone: '#8a8076' },
  { id: 'rock_boulder_dry', code: 'ST105', family: 'raw', type: 'Sandstone', trade: 'Dry Wadi', finish: 'Natural & Weathered', tileMm: 480, tone: '#95897a' },
  { id: 'rock_06', code: 'ST106', family: 'raw', type: 'Limestone', trade: 'Coarse Quarry', finish: 'Flamed', tileMm: 340, tone: '#847c72' },
  { id: 'rock_08', code: 'ST107', family: 'raw', type: 'Slate', trade: 'Strata Grey', finish: 'Split-face End Grain', tileMm: 340, tone: '#7d766d' },
  { id: 'worn_rock_natural_01', code: 'ST108', family: 'raw', type: 'Limestone', trade: 'Aged Ivory', finish: 'Weathered & Worn', tileMm: 380, tone: '#8b8479' },
  { id: 'seaside_rock', code: 'ST109', family: 'raw', type: 'Limestone', trade: 'Coastal Grey', finish: 'Natural & Weathered', tileMm: 360, tone: '#8d8478' },
  { id: 'tiger_rock', code: 'ST110', family: 'raw', type: 'Quartzite', trade: 'Tiger Stripe', finish: 'Natural Surface', tileMm: 310, tone: '#9a8a72' },
  { id: 'dark_rock', code: 'ST111', family: 'dark', type: 'Basalt', trade: 'Golan Black', finish: 'Flamed & Brushed', tileMm: 360, tone: '#4a4744' },
  { id: 'dark_rock_02', code: 'ST112', family: 'dark', type: 'Basalt', trade: 'Volcanic Charcoal', finish: 'Sand Blasted', tileMm: 380, tone: '#514e4a' },
  { id: 'gray_rocks', code: 'ST113', family: 'dark', type: 'Granite', trade: 'Steel Grey', finish: 'Flamed', tileMm: 340, tone: '#6e6c69' },
  { id: 'quarry_wall', code: 'ST114', family: 'dark', type: 'Limestone', trade: 'Quarry Face', finish: 'Split-face', tileMm: 530, tone: '#7a746b' },
  { id: 'quarry_wall_02', code: 'ST115', family: 'dark', type: 'Limestone', trade: 'Quarry Seam', finish: 'Sawn & Flamed', tileMm: 530, tone: '#726d66' },
  { id: 'marble_rock_01', code: 'ST116', family: 'marble', type: 'Marble', trade: 'Raw Carrara', finish: 'Natural Surface', tileMm: 340, tone: '#b5b0a8' },
  { id: 'marble_rock_02', code: 'ST117', family: 'marble', type: 'Marble', trade: 'Silver Vein', finish: 'Split-face & Tumbled', tileMm: 340, tone: '#bdb8b0' },
  { id: 'marble_rock_03', code: 'ST118', family: 'marble', type: 'Marble', trade: 'Graphite', finish: 'Sand Blasted', tileMm: 340, tone: '#8d8a86' },
  { id: 'marble_cliff_02', code: 'ST119', family: 'marble', type: 'Marble', trade: 'Alpine Cliff', finish: 'Natural & Weathered', tileMm: 600, tone: '#a8a49d' },
  { id: 'red_sandstone_wall', code: 'ST120', family: 'sandstone', type: 'Sandstone', trade: 'Petra Red', finish: 'Natural Surface', tileMm: 430, tone: '#a4735a' },
  { id: 'old_sandstone_02', code: 'ST121', family: 'sandstone', type: 'Sandstone', trade: 'Ancient Ochre', finish: 'Weathered & Worn', tileMm: 380, tone: '#a9977c' },
  { id: 'large_sandstone_blocks', code: 'ST122', family: 'sandstone', type: 'Sandstone', trade: 'Herod Block', finish: 'Ashlar', tileMm: 620, tone: '#b0a184' },
  { id: 'mossy_sandstone', code: 'ST123', family: 'sandstone', type: 'Sandstone', trade: 'Mossy Wadi', finish: 'Natural & Weathered', tileMm: 410, tone: '#8f8a68' },
  { id: 'yellow_stone_wall', code: 'ST124', family: 'sandstone', type: 'Limestone', trade: 'Jerusalem Gold', finish: 'Tobzeh', tileMm: 480, tone: '#c2ab86' },
  { id: 'seaworn_sandstone_brick', code: 'ST125', family: 'sandstone', type: 'Sandstone', trade: 'Kurkar', finish: 'Weathered & Worn', tileMm: 460, tone: '#b3a68e' },
  { id: 'stone_wall_02', code: 'ST126', family: 'wall', type: 'Fieldstone', trade: 'Field Grey', finish: 'Rubble', tileMm: 580, tone: '#8b857b' },
  { id: 'stone_wall_04', code: 'ST127', family: 'wall', type: 'Fieldstone', trade: 'Village Mix', finish: 'Fieldstone Wall Run', tileMm: 580, tone: '#948d82' },
  { id: 'rustic_stone_wall', code: 'ST128', family: 'wall', type: 'Limestone', trade: 'Rustic Cream', finish: 'Roughly Rectangular', tileMm: 530, tone: '#8e877c' },
  { id: 'stacked_stone_wall', code: 'ST129', family: 'wall', type: 'Slate', trade: 'Stacked Grey', finish: 'Ledgestone', tileMm: 480, tone: '#7f7a72' },
  { id: 'castle_wall_slates', code: 'ST130', family: 'wall', type: 'Bluestone', trade: 'Fortress', finish: 'Ashlar', tileMm: 620, tone: '#8a877f' },
  { id: 'medieval_blocks_05', code: 'ST131', family: 'wall', type: 'Limestone', trade: 'Crusader', finish: 'Ashlar', tileMm: 620, tone: '#948c7e' },
  { id: 'japanese_stone_wall', code: 'ST132', family: 'wall', type: 'Granite', trade: 'Kyoto Grey', finish: 'Stacked Bond', tileMm: 580, tone: '#7c7973' },
  { id: 'lichen_rock', code: 'ST133', family: 'moss', type: 'Granite', trade: 'Lichen Grey', finish: 'Natural & Weathered', tileMm: 360, tone: '#8b8a6f' },
  { id: 'mossy_rock', code: 'ST134', family: 'moss', type: 'Limestone', trade: 'Moss Quarry', finish: 'Natural & Weathered', tileMm: 360, tone: '#6f7854' },
  { id: 'rock_pitted_mossy', code: 'ST135', family: 'moss', type: 'Limestone', trade: 'Pitted Moss', finish: 'Weathered & Worn', tileMm: 340, tone: '#7b7d61' },
  { id: 'concrete_layers', code: 'ST136', family: 'concrete', type: 'Concrete', trade: 'Board Formed', finish: 'Natural Surface', tileMm: 480, tone: '#9d9a95' },
  { id: 'cracked_concrete', code: 'ST137', family: 'concrete', type: 'Concrete', trade: 'Weathered Cast', finish: 'Weathered & Worn', tileMm: 480, tone: '#a5a29c' },
  { id: 'rough_concrete', code: 'ST138', family: 'concrete', type: 'Concrete', trade: 'Brut', finish: 'Sand Blasted', tileMm: 480, tone: '#9b9892' },
  { id: 'slate_floor_02', code: 'ST139', family: 'slate', type: 'Slate', trade: 'Welsh Black', finish: 'Natural Cleft', tileMm: 430, tone: '#6a6864' },
  { id: 'mixed_rock_tiles', code: 'ST140', family: 'slate', type: 'Quartzite', trade: 'Mosaic Mix', finish: 'Mosaic', tileMm: 480, tone: '#87817a' },];

export const stoneById = (id: string): PlanterStoneMaterial | null => STONE_MATERIALS.find((stone) => stone.id === id) ?? null;

/** The trade's own three-part name, assembled the way a stone yard writes it. */
export const stoneName = (stone: PlanterStoneMaterial): string => stone.type + ' \u2014 ' + stone.trade + ' \u2014 ' + stone.finish;

// ---------------------------------------------------------------------------
// The coat
// ---------------------------------------------------------------------------

/**
 * The thickest build the shop will take on (mm).
 *
 * Past this a hand-applied render stops behaving like a skin on a panel and
 * starts behaving like a slab stuck to one: it cracks off the creases when the
 * pot is carried, and it puts more weight on the composite than the composite
 * was folded to hold. The slider stops here and so does the preview's relief.
 */
export const MAX_COAT_MM = 10;

/** Build one pass of acrylic stone render reliably leaves once it has gone off (mm). */
const BUILD_PER_PASS = 2.5;
/**
 * Share of the build volume that is actually render.
 *
 * A stone texture is peaks and hollows, not a slab: measured to its high points
 * a 10 mm build averages nearer six. Mixing to the peak height would send the
 * shop half as much material again as it can use before the batch goes off.
 */
const RELIEF_FILL = 0.6;
/** Acrylic-modified stone render, mixed and cured (g/cm3). */
const COAT_DENSITY = 1.55;

/** Coverage rates, by hand, on a faceted pot rather than a flat wall (m2/h). */
const RATE_PRIME = 3;
const RATE_BUILD = 0.8;
/**
 * The glaze is the slowest pass and the reason this finish is worth buying: the
 * painter picks out the high points, floats a wash into the hollows, and decides
 * where this particular pot has been weathered. It cannot be hurried and it is
 * never twice the same.
 */
const RATE_GLAZE = 0.5;
const RATE_SEAL = 4;

/** Passes of render needed to reach a build, over and above primer and finish. */
export const coatPasses = (coatMm: number): number => Math.ceil(Math.max(coatMm, 0) / BUILD_PER_PASS);

/** Everything the pot goes under: primer, the build passes, the glaze, the sealer. */
export const coatCoats = (coatMm: number): number => coatPasses(coatMm) + 3;

/** Render to mix for one pot (litres). Area in m2 throughout. */
export const coatLitres = (areaM2: number, coatMm: number): number => areaM2 * Math.max(coatMm, 0) * RELIEF_FILL;

/** What that render weighs once it is on and cured (kg). */
export const coatKg = (areaM2: number, coatMm: number): number => coatLitres(areaM2, coatMm) * COAT_DENSITY;

/** Bench time for one pot, all passes together (hours). */
export function coatHours(areaM2: number, coatMm: number): number {
  const build = coatPasses(coatMm) / RATE_BUILD;
  return areaM2 * (1 / RATE_PRIME + build + 1 / RATE_GLAZE + 1 / RATE_SEAL);
}

/**
 * Working days from bare panel to sealed pot.
 *
 * Not the bench hours divided by a shift: render has to go off before the next
 * pass will key to it, which caps the day at two build passes however fast the
 * painter is. The glaze and the sealer then share a day of their own.
 */
export const coatDays = (coatMm: number): number => Math.ceil(coatPasses(coatMm) / 2) + 1;

/**
 * How far the build has to stay back from each side of a crease (mm).
 *
 * A fold is the one line on the pot that moves. Carry a 10 mm render across it
 * and the render is what takes the strain, so it cracks — and it cracks along
 * the fold, which is the most visible line on the part. The fix is a relief
 * line: the painter keeps the build off the crease by about its own thickness
 * and lets the glaze carry the colour across instead.
 */
export const coatKeepOut = (coatMm: number): number => Math.max(coatMm, 0);

/**
 * What is left of an opening once both its sides have been built up (mm).
 *
 * The coat goes on the inside of the cut edge as well as the face, so an
 * opening loses twice the build, and what is left is also that much deeper.
 * This is how a decorative perforation quietly becomes a solid wall.
 */
export const coatThroat = (openingMm: number, coatMm: number): number => openingMm - 2 * Math.max(coatMm, 0);

// ---------------------------------------------------------------------------
// The sealer
// ---------------------------------------------------------------------------

/**
 * The last pass, and the only one anybody can see the difference in from across
 * a garden. It decides how wet the stone looks, and outdoors it is also the
 * only thing between the render and the rain.
 */
export type PlanterStoneSeal = 'matte' | 'satin' | 'wet';

export const STONE_SEALS: PlanterStoneSeal[] = ['matte', 'satin', 'wet'];

/** Roughness the preview runs the stone at, low point and high point. */
export const SEAL_ROUGHNESS: Record<PlanterStoneSeal, [number, number]> = {
  matte: [0.72, 1],
  satin: [0.45, 0.88],
  wet: [0.18, 0.58],
};

/** How much the sealed surface picks up the sky and the ground around it. */
export const SEAL_REFLECTION: Record<PlanterStoneSeal, number> = {
  matte: 0.75, satin: 1.05, wet: 1.5,
};

/**
 * The washes the painters keep mixed.
 *
 * White is not a colour here, it is the absence of one: the stone comes through
 * as the quarry photographed it. The rest are the glazes that turn one stone
 * into a site's stone — a warmer sand, a greyer limestone, a pot that has been
 * standing under a pine.
 */
export const STONE_TINTS = ['#ffffff', '#f2e3c6', '#dcc9a2', '#c3cdd6', '#c6b2a0', '#a9b49a'];

/** What each sealer is called on a drawing. The Hebrew studio has its own copy. */
export const SEAL_NAMES: Record<PlanterStoneSeal, string> = {
  matte: 'Matte sealer',
  satin: 'Satin sealer',
  wet: 'Wet-look sealer',
};
