import type { PlanterLedEffect, PlanterLedPosition } from './planter-led-effects';
import type { PlanterPrint, PlanterPrintFit, PlanterPrintRule } from './planter-print';
import type { PlanterStoneSeal } from './planter-stone';

/** The animation modes and the mounting positions live with the maths that draws them. */
export type { PlanterLedEffect, PlanterLedPosition };
/** The print modes live with the generator that draws them. */
export type { PlanterPrint, PlanterPrintFit, PlanterPrintRule };
/** The sealer lives with the catalogue, so the roughness it implies stays beside it. */
export type { PlanterStoneSeal };

/**
 * What drives the strip.
 *
 * An addressable strip with no controller is an expensive way to light one
 * colour: the modes are the controller's, not the tape's. WLED is the firmware
 * these effects are named after, and the one that puts them on a phone.
 */
export type PlanterLedController = 'none' | 'ir' | 'wled';

export type MaterialId = 'acp-4' | 'acp-3' | 'acrylic-3' | 'steel-2' | 'cardboard-2';

export type FoldKind = 'mountain' | 'valley' | 'cut';

export type PatternCategory = 'geometric' | 'origami' | 'architectural' | 'custom';

export type PatternId =
  | 'diamond-fold'
  | 'box-pleat'
  | 'accordion'
  | 'fan'
  | 'pinwheel'
  | 'yoshimura'
  | 'miura'
  | 'herringbone'
  | 'waterbomb'
  | 'chevron'
  | 'zigzag'
  | 'cross-pleat'
  | 'corrugation'
  | 'pyramid'
  | 'triangle'
  | 'diagonal-grid'
  | 'staggered'
  | 'swirl'
  | 'honeycomb'
  | 'wave'
  | 'chevron-arch';

export interface PatternParameters {
  panelWidth: number;
  panelHeight: number;
  targetHeight: number;
  rows: number;
  columns: number;
  vBitAngle: number;
  foldProgress: number;
  invertFolds: boolean;
}

export interface MaterialSpec {
  id: MaterialId;
  name: string;
  shortName: string;
  thickness: number;
  color: string;
  accent: string;
  minRadius: number;
  maxBendAngle: number;
  grooveDepth: string;
  recommendedCell: number;
  /** Wall left under a V-groove so the fold still hinges instead of snapping (mm). */
  residualSkin: number;
  /** kg per mm³ — drives the weight estimate. */
  density: number;
  /** V-grooving is only viable when the crease can be sharp; acrylic must be heat-bent. */
  foldMethod: 'v-groove' | 'heat-bend';
  /** PBR response in the 3D preview. Metalness is physical: 0 or 1, nothing between. */
  metalness: 0 | 1;
  roughness: number;
}

export interface PatternDefinition {
  id: PatternId;
  name: string;
  subtitle: string;
  category: PatternCategory;
  tags: string[];
  description: string;
  applications: string[];
  difficulty: 'Low' | 'Medium' | 'High';
  recommendedMaterial: MaterialId;
}

export interface FoldLine {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: FoldKind;
}

export type CheckSeverity = 'error' | 'warning' | 'info';

export interface FabricationCheck {
  id: string;
  severity: CheckSeverity;
  title: string;
  detail: string;
}

/**
 * Fold state resolved against the real sheet: how far the panel has closed, the
 * footprint it occupies once folded, and the V-groove that produces it.
 */
export interface FoldMechanics {
  /** Peak height of the fold at the current progress (mm). */
  amplitude: number;
  cellWidth: number;
  cellHeight: number;
  /** Dihedral bend across a crease, per axis (degrees). 0 where the axis stays flat. */
  bendAngleX: number;
  bendAngleY: number;
  /** The governing bend — what the material and the V-bit have to survive. */
  bendAngle: number;
  /** Deepest fold this grid admits before the facets would have to stretch (mm). */
  maxTargetHeight: number;
  foldsAlongX: boolean;
  foldsAlongY: boolean;
  /** False once targetHeight exceeds what the flat sheet can supply. */
  feasible: boolean;
  /** Footprint after folding — always ≤ the flat sheet (mm). */
  foldedWidth: number;
  foldedHeight: number;
  /** Take-up per axis, 0 = no contraction, 0.2 = the panel lost a fifth of its span. */
  contractionX: number;
  contractionY: number;
  grooveDepth: number;
  grooveWidth: number;
  /** V-bit that closes flush at this bend angle (degrees). */
  requiredBitAngle: number;
}

export interface PatternStats {
  totalLines: number;
  mountainLines: number;
  valleyLines: number;
  panelArea: string;
  grooveLength: string;
  estimatedWeight: string;
  /** Folded footprint at the current fold progress, e.g. "1073 × 2147 mm". */
  foldedSize: string;
}

// ---------------------------------------------------------------------------
// Planters — folded ACM pots developed from a single sheet
// ---------------------------------------------------------------------------

export type PlanterStyleId = 'prism' | 'ripple' | 'crystal' | 'diamond' | 'star' | 'spiral';

export type PlanterCategory = 'box' | 'faceted' | 'banded' | 'column' | 'lit';

/** A regular polygon mouth, or a rectangle with its own width and length. */
export type PlanterFootprint = 'polygon' | 'rectangle';

/**
 * How the wall is made. `single-sheet` folds the whole tube from one blank, which
 * only works for surfaces that have a flat net. `banded` cuts one strip per band
 * and rivets them together, which works for any profile — a bulge included —
 * because a single strip always develops exactly.
 */
export type PlanterConstruction = 'single-sheet' | 'banded';

/**
 * What is milled through the wall for the light to come out of. `none` leaves
 * the wall solid, which is every pot the catalogue shipped before lighting was
 * an option — so it is the default, and turning it off restores the old file
 * exactly.
 *
 * `triangles` subdivides each facet and cuts the whole lattice; `shards`
 * scatters half-square triangles on a grid, most of it left empty; `dots`
 * scatters mixed discs; `grid` lays out an even staggered field of equal ones.
 * `foldout` is the odd one: it cuts petals on two edges and leaves them hinged
 * on the third, so nothing leaves the sheet at all and the opening is made by
 * bending them out by hand. All five obey the same border at the creases and
 * the same web between openings — they differ only in what they do inside it.
 */
export type PlanterPerforation = 'none' | 'triangles' | 'shards' | 'dots' | 'grid' | 'foldout';

/**
 * What is actually in the cavity.
 *
 * The three whites are the same strip in three phosphors and draw the same
 * current; what changes is the light. 3000K is the one a garden wants after
 * dark — it lands warm on render, wood and planting, and it does not attract
 * insects the way the cold end does. 6000K reads as daylight and holds a
 * colour photograph. 10000K is the ice-blue end: it looks like moonlight on
 * metal, it gives the least useful light per watt, and it is a deliberate
 * effect rather than a lamp. `ws2812` is not white at all — it is an
 * addressable RGB strip, one controller per LED, at 5V, and everything about
 * its power budget is different.
 */
export type PlanterLed = 'none' | '3000k' | '6000k' | '10000k' | 'ws2812';

/**
 * A stone from the catalogue, by its texture id, or `none` for an unpainted pot.
 *
 * Deliberately a plain string rather than a union of the forty ids: the
 * catalogue is data loaded from a folder of textures, and pinning it into the
 * type system would mean editing this file every time the shop buys a new
 * stone. `stoneById` returns null for anything it does not know, and the engine
 * treats that exactly as `none`.
 */
export type PlanterStoneId = string;

export interface PlanterParameters {
  style: PlanterStyleId;
  footprint: PlanterFootprint;
  construction: PlanterConstruction;
  /** Facets around the pot. 6 is the commercial staple; a rectangle is always 4. */
  sides: number;
  /** Rectangle footprint only — the mouth, across the flats (mm). */
  topWidth: number;
  topLength: number;
  /** Rectangle footprint only — the foot, across the flats (mm). */
  bottomWidth: number;
  bottomLength: number;
  /** Rivet tab folded in along each ring joint, banded construction only (mm). */
  jointTab: number;
  /** Across-corners diameter of the top ring (mm). */
  topDiameter: number;
  /** Across-corners diameter of the bottom ring (mm). */
  bottomDiameter: number;
  height: number;
  /** Horizontal facet bands stacked up the wall. */
  rows: number;
  /** Mid-height radius swell as a percentage. This is Gaussian curvature: any
   * non-zero value means no exact flat net exists, and the checks say so. */
  bulge: number;
  /** Total rotation from bottom ring to top ring (degrees). */
  twist: number;
  /** How strongly band heights alternate (%). Deepens the facet rhythm without
   * bending the wall out of the developable family the way a radius offset would. */
  rhythm: number;
  /** Glue/rivet tab on the closing seam (mm). */
  tabWidth: number;
  /** Width of the top collar that hides the liner (mm). */
  rimWidth: number;
  /** Base plate shrink so it drops inside the wall (mm). */
  baseInset: number;
  /** Rivet tab folded in from the foot edge, for the base plate to land on (mm). */
  baseTab: number;
  /** Rivet tab folded in from the mouth edge, for the collar to land on (mm). */
  rimTab: number;

  // --- Lighting -------------------------------------------------------------
  // A lit pot is three parts working together and they only make sense as a
  // set: the wall is opened up so light can leave, an inner box keeps the soil
  // off the lamp, and a panel in the collar charges the thing. Each is still
  // its own switch, because a liner is worth fitting on its own and a solid
  // pot can still carry a panel.

  /** Cut-out pattern milled through the wall. `none` keeps the wall solid. */
  perforation: PlanterPerforation;
  /**
   * Facet subdivision: 1 cuts one triangle per facet, 8 cuts sixty-four. Note
   * that finer is not brighter — the web between cells is a fixed width, so
   * more cells means more web and less open wall.
   */
  perfDensity: number;
  /**
   * How much of each lattice cell is actually cut away (% of its area).
   *
   * This is the lever that decides how much material leaves the sheet, and it
   * is separate from `perfDensity` on purpose: density says how many marks the
   * wall carries, this says how much of the panel survives them. A composite
   * panel gets its stiffness from its skins, and a decorative cut-out has to
   * stay decorative — small openings in a mostly solid wall.
   */
  perfOpening: number;
  /**
   * Cut only this many of each facet's cells — "six of the thirty-six". 0 cuts
   * the lot. Triangle lattice only; the scattered families set their own count.
   */
  perfPicked: number;
  /**
   * How far the cut-and-fold petals are bent out, in degrees.
   *
   * The flat file is the same whatever this says — the bending is done by hand
   * at the bench — so this drives the preview and the note that goes out with
   * the drawing, and nothing else.
   */
  perfLift: number;
  /** Solid web left between neighbouring cut-outs (mm). */
  perfWeb: number;
  /** Solid border kept at every crease and cut edge (mm). */
  perfMargin: number;
  /** Cutter diameter (mm) — every internal corner is drawn at its radius. */
  perfTool: number;
  /** Wall kept solid from the foot up, so the load path stays closed (mm). */
  perfSkirt: number;
  /**
   * How far above the skirt the pattern takes to come in fully (mm).
   *
   * 0 gives a uniform wall that starts abruptly at the skirt line. Anything
   * else dissolves it: full pattern at the top, thinning down through the
   * middle, gone by the time it reaches the solid base. The panel then reads as
   * one piece with weather on it rather than as a perforated panel stuck on top
   * of a plain one, and the material stays where the pot carries its load.
   */
  perfFade: number;
  /** Inner box holding the soil, separating it from the light cavity. */
  liner: boolean;
  /** Gap between the liner and the wall — where the strip and its wiring run (mm). */
  cavity: number;
  /** Solar panel let into the collar. */
  solar: boolean;
  /** The panel's outside size (mm). The window is cut smaller, by the bedding lip. */
  solarWidth: number;
  solarLength: number;

  /** Which strip runs in the cavity. `none` leaves the pot to be lamped later. */
  led: PlanterLed;
  /** Emitters per metre of strip — 30, 60 or 144. Drives both draw and grain. */
  ledDensity: number;
  /** Turns of strip stacked up the cavity. One is a wash from the bottom; more is even. */
  ledRuns: number;
  /**
   * What share of full output the pot is actually run at (%).
   *
   * A garden light at 100% is a floodlight and eats its battery by midnight.
   * This is the lever that decides the power budget, so it is a parameter and
   * not a preview setting: the driver, the battery and the panel are all sized
   * from it.
   */
  ledBrightness: number;
  /** Hours after dark the pot is meant to stay lit — what the battery is sized for. */
  ledHours: number;
  /**
   * What the pixels do. Addressable strips only — a white strip has one state,
   * and pretending otherwise on the drawing would be a lie to the workshop.
   *
   * No cut line moves with this. It is programmed into the controller at the
   * bench, so the flat file is the same in every mode.
   */
  ledEffect: PlanterLedEffect;
  /** How fast the mode runs (%), against its own natural tempo. */
  ledSpeed: number;
  /** The colour the modes that use one are built around, as `#rrggbb`. */
  ledColor: string;
  /** What runs the strip. Without one, only a fixed colour is on offer. */
  ledController: PlanterLedController;
  /** Where the strip is mounted, and which way it throws its light. */
  ledPosition: PlanterLedPosition;

  // --- Natural stone texture ------------------------------------------------
  // A finish, applied by a person after the pot is folded. Nothing below moves
  // a cut line, and nothing below is optional at the bench either: a coat has
  // a thickness, and a thickness has a weight, a drying time and an opinion
  // about how much light still gets through the wall.

  /** Which stone the pot is painted as. `none` leaves it in its own finish. */
  stone: PlanterStoneId;
  /**
   * How proud the texture is built off the panel, at its high points (mm).
   *
   * Capped at 10. This is a real thickness of real render carried by a folded
   * composite panel, so it is a fabrication parameter and not a preview one:
   * the weight, the passes, the days and what is left of every cut-out all come
   * off it, and the preview is only allowed to show as much relief as it buys.
   */
  stoneCoat: number;
  /**
   * How much of the built thickness actually reads as relief (%).
   *
   * The same 8 mm can be laid as a shallow weathered face or as a deep split
   * boulder. 100 works the full build; lower floats it flatter for a dressed
   * or sawn stone, where the depth is in the colour rather than the surface.
   */
  stoneRelief: number;
  /** How far the hand-mixed batch drifts across one pot (%). 0 is a machine finish. */
  stoneTone: number;
  /** The wash the painters mix into the glaze, as `#rrggbb`. White leaves the stone alone. */
  stoneTint: string;
  /** The last pass — and outdoors, the only thing between the render and the rain. */
  stoneSeal: PlanterStoneSeal;

  // --- Direct UV printing ---------------------------------------------------
  // The other finish, and the other half of the shop: a flatbed prints the
  // panel flat, after the mill and before the fold. Nothing below moves a cut
  // line either — but unlike the stone coat, all of it is a FILE. What the
  // printer is handed is artwork in the same millimetres as the DXF, laid on
  // the facets that were just grooved.

  /** What is printed: nothing, the triangle generator, or an imported image. */
  print: PlanterPrint;
  /** Which shelf of colours the generator draws from. `custom` reads `printColors`. */
  printPalette: string;
  /** How a colour is chosen for each facet. */
  printRule: PlanterPrintRule;
  /**
   * The one integer that makes this pot this pot.
   *
   * Every rule is a pure function of the facet and this number, so a design
   * approved last month prints the same colours today. Rerolling it is the
   * "generate another" button, and it is the only thing that button touches.
   */
  printSeed: number;
  /** How many of the palette's colours are in play, 2 upwards. */
  printTones: number;
  /** How much of each facet's own light and shade is mixed into its fill (%). */
  printShade: number;
  /**
   * How far the ink is held back from every crease and cut edge (mm).
   *
   * A fabrication number, not a styling one: UV ink is a rigid film, and a
   * film carried across a V-groove crazes along it the first time the panel is
   * folded. What is left bare reads as a grout line between tiles.
   */
  printGrout: number;
  /** White underbase pass — without it, colour on polished aluminium is a tint. */
  printWhite: boolean;
  /** Varnish pass. What decides matte or gloss, and what takes the UV outdoors. */
  printVarnish: boolean;
  /** The designer's own six colours, used when `printPalette` is `custom`. */
  printColors: string[];
  /** The imported artwork as a data URL, or empty. PNG and JPEG only. */
  printImage: string;
  /** How that artwork is fitted to the developed wall. */
  printFit: PlanterPrintFit;
  /**
   * The drafting layer: the pot's own drawing, printed over the fills.
   *
   * Protractor circles on the net's vertices, angle arcs, a right-triangle
   * glyph per facet, and callouts carrying this pot's real diameters and edge
   * lengths. A second pass on the bed, and the layer that turns a coloured
   * solid into a drawing of one.
   */
  printOverlay: boolean;
  /** What the drafting is printed in, as `#rrggbb`. White on a dark palette. */
  printOverlayInk: string;
  /** How much of the net carries a mark (%). */
  printOverlayDensity: number;

  sheetWidth: number;
  sheetHeight: number;
  /** 0 = flat net, 100 = assembled pot. Preview only. */
  assembly: number;
}

export interface PlanterStyleSpec {
  id: PlanterStyleId;
  name: string;
  subtitle: string;
  description: string;
  difficulty: 'Low' | 'Medium' | 'High';
  applications: string[];
  /** Angular stagger added per band, in sector fractions. 0 keeps rings aligned (quad facets); 0.5 triangulates them. */
  offsetStep: number;
  /** Signed height weight for band b, scaled by the `rhythm` parameter. Heights are
   * free to vary without introducing curvature; radii are not. */
  band: (band: number, rows: number) => number;
  recommendedRows: number;
  recommendedMaterial: MaterialId;
}

export interface PlanterPreset {
  id: string;
  name: string;
  note: string;
  category: PlanterCategory;
  parameters: Partial<PlanterParameters> & { style: PlanterStyleId };
}

export interface Vec2 { x: number; y: number }
export interface Vec3 { x: number; y: number; z: number }

/** A closed outline plus the creases inside it — one physical part off the sheet. */
export interface PlanterPiece {
  id: string;
  label: string;
  /** Placement of the piece inside the nested sheet layout (mm). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Where this piece's local frame sits in the coordinates it was built in —
   * what turns a construction coordinate into a sheet coordinate. */
  origin: Vec2;
  /** Local coordinates, closed implicitly (last point joins the first). */
  outline: Vec2[];
  folds: FoldLine[];
  /** Cut-outs — the collar's planting hole. Closed like `outline`. */
  holes: Vec2[][];
  /**
   * Cut-and-fold petals. Three points each, the two ends of the hinge first and
   * the free tip last. These are NOT holes: the cut runs from one end of the
   * hinge round the tip to the other and stops, the hinge itself is a crease in
   * `folds`, and the petal stays attached to the sheet.
   */
  flaps: Vec2[][];
}

/**
 * The soil box and the gap it leaves around itself.
 *
 * The liner is a plain prism, not a copy of the pot: it has to clear a wall
 * that may taper, twist, stagger and bulge, and the largest shape guaranteed to
 * do that at every height is a straight one sized on the pot's tightest
 * section. A straight liner inside a tapered pot also leaves the cavity widest
 * at the top, which is where the driver and the battery want to live — dry, and
 * as far from the drain as the pot allows.
 */
export interface PlanterLiner {
  /** Distance from the axis to the liner's flat faces (mm). */
  inradius: number;
  /** The liner's section in the pot's own frame (mm). */
  section: Vec2[];
  /** How far up the pot the liner runs (mm). */
  height: number;
  /**
   * The gap measured at the liner's own rim (mm). The liner is sized so the
   * tightest gap anywhere is exactly `cavity`, so this is the other end of the
   * range: on a pot that widens as it rises it is where the driver and the
   * battery go, and on one that narrows it is simply `cavity` again.
   */
  mouthGap: number;
  /** Soil the liner holds (litres) — what the pot actually plants, once fitted. */
  litres: number;
}

/**
 * The electrical side of a lit pot: what is in the cavity, what it draws, and
 * whether the panel on the collar can actually keep it running.
 *
 * Everything here is derived — the strip's length comes off the liner it is
 * stuck to, the draw comes off the length, and the panel's harvest comes off
 * the window already cut in the collar. Nothing in this block changes a cut
 * line; it is the specification that goes to whoever wires the thing, and the
 * honest answer to "how long will it stay on".
 */
export interface PlanterLighting {
  led: PlanterLed;
  /** Colour temperature in kelvin. 0 on an addressable strip, which has no single one. */
  kelvin: number;
  /** One controller per LED, so the strip runs an animation rather than a level. */
  addressable: boolean;
  /** Strip voltage — 12 V for the whites, 5 V for WS2812. */
  volts: number;
  /** Strip actually needed, all runs together (mm). */
  length: number;
  /** Turns of strip round the cavity. */
  runs: number;
  /** Emitters on that strip. */
  leds: number;
  /** Draw flat out (W) — what the driver has to survive. */
  peakWatts: number;
  /** Draw at the brightness set (W) — what the battery actually pays for. */
  watts: number;
  /** Current at the strip's own voltage, flat out (A). */
  amps: number;
  /** Light it puts out at the brightness set (lm). */
  lumens: number;
  /** The mode the controller runs, and the share of full output it averages. */
  effect: PlanterLedEffect;
  duty: number;
  /** Where it is mounted — which is what set `length`. */
  position: PlanterLedPosition;
  /**
   * Points the strip has to be fed at so the far end is not dimmer than the
   * near one. A 5 V addressable strip drops visibly within a metre; a 12 V
   * white one will carry five.
   */
  feeds: number;
  /** Driver to specify (W), with the usual fifth of headroom. */
  supply: number;
  /** What the panel on the collar brings in on an average day (Wh). 0 with no panel. */
  harvest: number;
  /** What the pot asks for over `ledHours` (Wh). */
  demand: number;
  /** Hours a day's harvest actually buys at this brightness. */
  runtime: number;
  /** Battery the night needs (Wh), at a sane depth of discharge. */
  battery: number;
  /** That battery in 18650 cells, which is what these are built from. */
  cells: number;
}

/**
 * The stone coat as the shop has to buy and build it.
 *
 * All of it is derived from the painted area and one thickness, and none of it
 * touches the drawing — the pot is folded first and painted afterwards, which
 * is exactly why a coat can be this thick without the flat file knowing. What
 * the numbers are for is the other half of the job: how much render to mix, how
 * many days to promise, what the pot ends up weighing, and whether the openings
 * that were cut for light are still open once the render is on them.
 */
export interface PlanterStoneCoat {
  /** The catalogue id painted, and its code for the order. */
  stone: PlanterStoneId;
  code: string;
  /** Build at the high points (mm) — the parameter everything else falls out of. */
  coatMm: number;
  /** Relief the preview is allowed to show (mm), never more than the build. */
  reliefMm: number;
  /** Outside faces the painter covers (m2): the wall and the collar, less what is cut away. */
  areaM2: number;
  /** Render passes needed to reach the build. */
  passes: number;
  /** Every pass, primer and glaze and sealer included. */
  coats: number;
  /** Render to mix for one pot (L). */
  litres: number;
  /** What the cured coat adds to the pot (kg). */
  kg: number;
  /** Bench time, all passes (h). */
  hours: number;
  /** Working days start to sealed, drying included. */
  days: number;
  /** How far the build stays off each side of a crease (mm). */
  keepOut: number;
  /** Crease that has to be kept clear at that width (m). 0 on a pot with no perforation to save. */
  reliefRun: number;
  /** A typical cut-out before the render goes on (mm across). 0 when the wall is solid. */
  opening: number;
  /** And what is left of it afterwards (mm). Negative means the coat closed it. */
  throat: number;
  /** The sealer specified. */
  seal: PlanterStoneSeal;
}

/**
 * The print as the shop has to run it.
 *
 * Every number is measured off the nested parts, after the mill has finished
 * with them — which is the order the job actually happens in. What it is for
 * is the half of the work the cut file cannot carry: which colour goes on
 * which facet, how much ink that is, how many passes over the bed, whether the
 * nest even fits on the bed in one piece, and how much bare panel is left
 * along the creases so the ink survives being folded.
 */
export interface PlanterPrintJob {
  mode: PlanterPrint;
  /**
   * One colour per model triangle, in `PlanterModel.triangles` order.
   *
   * The single source for all three consumers — the preview paints from it,
   * the print file fills from it, and the shop's colour list counts it — so
   * none of them can quietly disagree about what was approved. Empty in image
   * mode, where the artwork is a raster and the facets have no colour of
   * their own.
   */
  fills: string[];
  /** Distinct colours on the pot. What a proof has to match. */
  colours: number;
  /** Panel the ink actually covers, grout and cut-outs already taken off (m2). */
  areaM2: number;
  /** Panel the artwork would cover with no grout at all (m2). */
  facetM2: number;
  /** How far the ink is held off each crease and cut edge (mm). */
  grout: number;
  /** Crease on the printed parts that stays bare because of it (m). */
  groutRun: number;
  /** Facets left bare because the grout swallowed them whole. */
  dropped: number;
  white: boolean;
  varnish: boolean;
  /** Passes over the bed: white, colour, varnish. */
  passes: number;
  /** Ink for one pot, every pass together (ml). */
  inkMl: number;
  /** What the cured film adds to the pot (kg). */
  kg: number;
  /** Bed time for one pot, setup included (minutes). */
  minutes: number;
  /** The bed the nest has to go on (mm). */
  bed: { width: number; height: number };
  /** Print tiles the nest needs. 1 is one pass and no join. */
  tiles: number;
}

/** Cut-outs on one wall facet, in the same sheet coordinates as `flatByBand`. */
export interface PlanterPerfCells {
  /** Index into `PlanterModel.triangles`. */
  triangle: number;
  /** Closed contours, last point joining the first. */
  cells: Vec2[][];
  /** Cut-and-fold petals, hinge ends first. Empty for the families that remove material. */
  flaps: Vec2[][];
}

export interface PlanterModel {
  parameters: PlanterParameters;
  /** Wall vertices in mm, z up, indexed [ring][column]; column N repeats column 0 at the seam. */
  vertices: Vec3[][];
  /**
   * The same wall developed flat, in sheet coordinates, split band by band:
   * `flatByBand[band][0]` is the ring below it and `[1]` the ring above. Bands are
   * kept apart rather than merged into one grid because banded construction puts
   * each one on its own piece — in single-sheet construction they simply meet.
   */
  flatByBand: Vec2[][][];
  triangles: { v: [number, number, number]; normal: Vec3 }[];
  pieces: PlanterPiece[];
  /** Union bounding box of the nested layout (mm). */
  sheet: { width: number; height: number };
  /** Steepest crease on the wall (degrees) — what the V-bit and the skin must survive. */
  maxBend: number;
  /** Largest mismatch between a developed edge and its 3D length (mm). 0 = exactly developable. */
  developmentError: number;
  /** Ring joints that have to be riveted — 0 for a single-sheet wall. */
  joints: number;
  /** Stock sheets the nested layout needs end to end. 1 whenever the parts share one sheet. */
  sheets: number;
  /** The soil box, when one is fitted. Null leaves the pot planted directly. */
  liner: PlanterLiner | null;
  /** The strip, its draw and its solar budget. Null when no strip is specified. */
  lighting: PlanterLighting | null;
  /** The hand-painted stone coat. Null when the pot keeps its own finish. */
  stone: PlanterStoneCoat | null;
  /** The UV print, and the colour of every facet in it. Null when nothing is printed. */
  print: PlanterPrintJob | null;
  /**
   * The wall's cut-outs, kept apart from `pieces` because they are needed in
   * two frames: `pieces[].holes` carries them in piece coordinates for the
   * cutter, and these carry them in sheet coordinates, alongside the facet they
   * were cut from, so the preview can ride them up onto the folded pot.
   */
  perfCells: PlanterPerfCells[];
  /** Cells the cutter could not enter, left solid. 0 whenever the wall is solid. */
  perfDropped: number;
  /** Share of the wall's area actually opened up, 0–1. */
  perfOpenArea: number;
}

export interface PlanterStats {
  facets: number;
  creaseLength: string;
  cutLength: string;
  sheetUsage: string;
  estimatedWeight: string;
  /**
   * How much soil it holds, in litres. Once a liner is fitted that is the
   * liner's capacity and not the shell's — the shell no longer holds the soil,
   * and quoting its volume would overstate the pot by whatever the cavity took.
   */
  volume: string;
  topOpening: string;
  footprint: string;
  pieces: number;
  sheets: number;
  /** Wall opened up by the perforation, e.g. "17% open · 96 cut-outs". Absent on a solid wall. */
  openArea?: string;
  /** Gap the LED strip runs in, e.g. "22 mm". Absent when no liner is fitted. */
  cavity?: string;
  /** The strip fitted, e.g. "3000K warm · 1.4 m · 84 LEDs". Absent when none is. */
  lighting?: string;
  /** What it draws, e.g. "6.7 W · 0.6 A at 12 V". Absent when no strip is fitted. */
  power?: string;
  /** What the panel buys, e.g. "7 Wh/day · 4.2 h". Absent without a strip and a panel. */
  runtime?: string;
  /** The stone painted, e.g. "ST124 Limestone — Jerusalem Gold · 6 mm". Absent when unpainted. */
  stone?: string;
  /** What painting it takes, e.g. "6 coats · 2.1 L · 5.4 h · 3 days". Absent when unpainted. */
  coat?: string;
  /** The artwork, e.g. "Triangles · Desert sand · 4 colours". Absent when nothing is printed. */
  print?: string;
  /** What printing it takes, e.g. "2 passes · 1.42 m2 · 37 ml · 28 min". Absent when nothing is. */
  ink?: string;
}
