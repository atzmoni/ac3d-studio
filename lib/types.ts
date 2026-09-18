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

export type PlanterCategory = 'box' | 'faceted' | 'banded' | 'column';

/** A regular polygon mouth, or a rectangle with its own width and length. */
export type PlanterFootprint = 'polygon' | 'rectangle';

/**
 * How the wall is made. `single-sheet` folds the whole tube from one blank, which
 * only works for surfaces that have a flat net. `banded` cuts one strip per band
 * and rivets them together, which works for any profile — a bulge included —
 * because a single strip always develops exactly.
 */
export type PlanterConstruction = 'single-sheet' | 'banded';

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
}

export interface PlanterStats {
  facets: number;
  creaseLength: string;
  cutLength: string;
  sheetUsage: string;
  estimatedWeight: string;
  /** Enclosed volume of the pot in litres — how much soil it holds. */
  volume: string;
  topOpening: string;
  footprint: string;
  pieces: number;
  sheets: number;
}
