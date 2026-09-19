
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
  /**
   * How far the crease turns, in degrees — 0 is flat, 90 is a square corner.
   *
   * This is what decides which V-bit the line needs, because a groove of
   * included angle a shuts on itself after turning exactly a. Optional because
   * the panel patterns fold on a grid and state one bend for the whole sheet;
   * a planter bends a different amount at every crease, so there it is always
   * set.
   */
  bend?: number;
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
// Geometry
// ---------------------------------------------------------------------------

export interface Vec2 { x: number; y: number }
export interface Vec3 { x: number; y: number; z: number }
