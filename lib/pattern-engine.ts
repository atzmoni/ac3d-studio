import { getPattern } from './patterns';
import type {
  FabricationCheck, FoldLine, FoldMechanics, MaterialSpec, PatternId, PatternParameters, PatternStats,
} from './types';

export const MATERIALS: MaterialSpec[] = [
  {
    id: 'acp-4', name: 'Aluminum Composite 4mm', shortName: 'ACP 4 mm', thickness: 4,
    color: '#d7dce4', accent: '#8d99aa', minRadius: 4, maxBendAngle: 120,
    grooveDepth: '2.5–3.0 mm', recommendedCell: 150,
    residualSkin: 1.2, density: 1.375e-6, foldMethod: 'v-groove',
    metalness: 0, roughness: 0.35,
  },
  {
    id: 'acp-3', name: 'Aluminum Composite 3mm', shortName: 'ACP 3 mm', thickness: 3,
    color: '#bcc6d4', accent: '#6d7b8e', minRadius: 3, maxBendAngle: 120,
    grooveDepth: '2.0–2.5 mm', recommendedCell: 120,
    residualSkin: 0.8, density: 1.5e-6, foldMethod: 'v-groove',
    metalness: 0, roughness: 0.38,
  },
  {
    id: 'acrylic-3', name: 'Acrylic 3mm', shortName: 'Acrylic 3 mm', thickness: 3,
    color: '#b9d7e8', accent: '#61a2c2', minRadius: 8, maxBendAngle: 90,
    grooveDepth: '1.5–2.0 mm', recommendedCell: 180,
    residualSkin: 1.2, density: 1.19e-6, foldMethod: 'heat-bend',
    metalness: 0, roughness: 0.08,
  },
  {
    id: 'steel-2', name: 'Brushed Steel 2mm', shortName: 'Steel 2 mm', thickness: 2,
    color: '#aeb7bd', accent: '#65717b', minRadius: 2, maxBendAngle: 135,
    grooveDepth: '1.0–1.5 mm', recommendedCell: 100,
    residualSkin: 0.7, density: 7.85e-6, foldMethod: 'v-groove',
    metalness: 1, roughness: 0.42,
  },
  {
    id: 'cardboard-2', name: 'Architectural Cardboard 2mm', shortName: 'Cardboard 2 mm', thickness: 2,
    color: '#c7a783', accent: '#916b45', minRadius: 1, maxBendAngle: 160,
    grooveDepth: '0.8–1.0 mm', recommendedCell: 80,
    residualSkin: 1.1, density: 0.68e-6, foldMethod: 'v-groove',
    metalness: 0, roughness: 0.9,
  },
];

export const DEFAULT_PARAMETERS: PatternParameters = {
  panelWidth: 1200,
  panelHeight: 2400,
  targetHeight: 50,
  rows: 6,
  columns: 6,
  vBitAngle: 90,
  foldProgress: 40,
  invertFolds: false,
};

const DEG = 180 / Math.PI;

export function getMaterial(id: string): MaterialSpec {
  return MATERIALS.find((material) => material.id === id) ?? MATERIALS[0];
}

/** Grid counts are user-editable and arrive as raw numbers — never trust them straight. */
function normalize(parameters: PatternParameters): PatternParameters {
  return {
    ...parameters,
    rows: Math.max(1, Math.floor(parameters.rows)),
    columns: Math.max(1, Math.floor(parameters.columns)),
    panelWidth: Math.max(1, Math.abs(parameters.panelWidth)),
    panelHeight: Math.max(1, Math.abs(parameters.panelHeight)),
  };
}

export function getCellDimensions(parameters: PatternParameters): { cellWidth: number; cellHeight: number } {
  const safe = normalize(parameters);
  return { cellWidth: safe.panelWidth / safe.columns, cellHeight: safe.panelHeight / safe.rows };
}

/**
 * Corner height of the fold surface at fold-progress `t` (0 = flat, 1 = fully
 * folded): the pattern's sign field (checkerboard, stripes, blocks…) times the
 * target height. `invertFolds` flips the whole field.
 */
export function getFoldedCornerHeight(patternId: PatternId, row: number, column: number, targetHeight: number, invertFolds: boolean, progress: number): number {
  const sign = getPattern(patternId).sign(row, column);
  return (invertFolds ? -sign : sign) * targetHeight * progress;
}

// ---------------------------------------------------------------------------
// Crease geometry
// ---------------------------------------------------------------------------

const EPSILON = 1e-6;

/**
 * Liang–Barsky clip of a crease against the sheet. Anything a generator lets
 * spill past the panel edge would otherwise be routed off the material.
 */
function clipToPanel(line: FoldLine, width: number, height: number): FoldLine | null {
  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;
  let enter = 0;
  let exit = 1;
  const edges: [number, number][] = [
    [-dx, line.x1], [dx, width - line.x1],
    [-dy, line.y1], [dy, height - line.y1],
  ];
  for (const [p, q] of edges) {
    if (Math.abs(p) < EPSILON) {
      if (q < -EPSILON) return null; // parallel to this edge and fully outside
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > exit) return null;
      if (t > enter) enter = t;
    } else {
      if (t < enter) return null;
      if (t < exit) exit = t;
    }
  }
  const clipped: FoldLine = {
    ...line,
    x1: line.x1 + enter * dx, y1: line.y1 + enter * dy,
    x2: line.x1 + exit * dx, y2: line.y1 + exit * dy,
  };
  return Math.hypot(clipped.x2 - clipped.x1, clipped.y2 - clipped.y1) < EPSILON ? null : clipped;
}

/**
 * 2D crease pattern for a pattern id; `invertFolds` swaps mountain/valley.
 * Every line is guaranteed to lie inside the sheet and to have real length —
 * generators stay expressive, this is where the fabrication invariants hold.
 */
export function buildFoldLines(patternId: PatternId, parameters: PatternParameters): FoldLine[] {
  const safe = normalize(parameters);
  const lines: FoldLine[] = [];
  for (const line of getPattern(patternId).lines(safe)) {
    const clipped = clipToPanel(line, safe.panelWidth, safe.panelHeight);
    if (!clipped) continue;
    lines.push(safe.invertFolds && clipped.kind !== 'cut'
      ? { ...clipped, kind: clipped.kind === 'mountain' ? 'valley' : 'mountain' }
      : clipped);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Fold kinematics
// ---------------------------------------------------------------------------

/**
 * Which grid axes actually fold. Every sign field in the library is separable —
 * `s(r,c) = (-1)^(f(r)+g(c))` — so whether an edge changes sign depends only on
 * the index being stepped, and probing one row / one column is exact. The test
 * suite asserts that separability so a future sign field cannot break it quietly.
 */
function foldAxes(patternId: PatternId, rows: number, columns: number): { flipsX: boolean[]; flipsY: boolean[] } {
  const sign = getPattern(patternId).sign;
  const flipsX: boolean[] = [];
  const flipsY: boolean[] = [];
  for (let c = 0; c < columns; c += 1) flipsX.push(sign(0, c) !== sign(0, c + 1));
  for (let r = 0; r < rows; r += 1) flipsY.push(sign(r, 0) !== sign(r + 1, 0));
  return { flipsX, flipsY };
}

/**
 * Projected pitch of an edge that rises `rise` mm across a flat span of `pitch`
 * mm. Sheet metal does not stretch: the flat length is what gets consumed, so
 * the folded footprint has to give ground. Returns 0 once the fold would need
 * more material than the cell has.
 */
function projectedPitch(pitch: number, rise: number): number {
  const remaining = pitch * pitch - rise * rise;
  return remaining <= 0 ? 0 : Math.sqrt(remaining);
}

/**
 * The fold resolved against the real sheet: bend angles, the footprint the
 * panel collapses to, and the V-groove that produces it.
 *
 * First-order kinematic model. It enforces edge-length conservation along the
 * grid axes, which is exact for the axis-aligned pleat families (accordion,
 * fan, corrugation, wave) and a close approximation for the tessellated ones,
 * where facet diagonals also carry part of the fold.
 */
export function getFoldMechanics(patternId: PatternId, parameters: PatternParameters, material: MaterialSpec): FoldMechanics {
  const safe = normalize(parameters);
  const { cellWidth, cellHeight } = getCellDimensions(safe);
  const amplitude = Math.abs(safe.targetHeight) * (safe.foldProgress / 100);
  const rise = 2 * amplitude; // peak-to-trough across one crease
  const { flipsX, flipsY } = foldAxes(patternId, safe.rows, safe.columns);
  const foldsAlongX = flipsX.some(Boolean);
  const foldsAlongY = flipsY.some(Boolean);

  const foldedWidth = flipsX.reduce((sum, flips) => sum + (flips ? projectedPitch(cellWidth, rise) : cellWidth), 0);
  const foldedHeight = flipsY.reduce((sum, flips) => sum + (flips ? projectedPitch(cellHeight, rise) : cellHeight), 0);

  // A crease tilts its two facets by asin(rise / pitch) each; the bend is the
  // angle swept away from flat, so it is twice that and tops out at 180°.
  const bendFor = (pitch: number, folds: boolean) => (folds ? 2 * Math.asin(Math.min(1, rise / pitch)) * DEG : 0);
  const bendAngleX = bendFor(cellWidth, foldsAlongX);
  const bendAngleY = bendFor(cellHeight, foldsAlongY);
  const bendAngle = Math.max(bendAngleX, bendAngleY);

  // Deepest fold the flat sheet can supply: the rise may not exceed the pitch.
  const limits = [foldsAlongX ? cellWidth / 2 : Infinity, foldsAlongY ? cellHeight / 2 : Infinity];
  const maxTargetHeight = Math.min(...limits);

  const grooveDepth = Math.max(0, material.thickness - material.residualSkin);
  const grooveWidth = 2 * grooveDepth * Math.tan((Math.min(179, Math.max(1, safe.vBitAngle)) / 2) / DEG);

  return {
    amplitude,
    cellWidth,
    cellHeight,
    bendAngleX,
    bendAngleY,
    bendAngle,
    maxTargetHeight,
    foldsAlongX,
    foldsAlongY,
    feasible: Math.abs(safe.targetHeight) <= maxTargetHeight,
    foldedWidth,
    foldedHeight,
    contractionX: 1 - foldedWidth / safe.panelWidth,
    contractionY: 1 - foldedHeight / safe.panelHeight,
    grooveDepth,
    grooveWidth,
    requiredBitAngle: bendAngle,
  };
}

export interface FoldedGrid {
  /** Projected node positions in mm — contracted, so the sheet is not stretched. */
  xs: number[];
  ys: number[];
  /** Node heights in mm, indexed `[row][column]`. */
  heights: number[][];
  foldedWidth: number;
  foldedHeight: number;
}

/**
 * The folded surface as a grid of nodes, ready to be turned into geometry.
 * Positions are centred on the origin so the panel closes symmetrically rather
 * than drifting toward one corner as it folds.
 */
export function getFoldedGrid(patternId: PatternId, parameters: PatternParameters): FoldedGrid {
  const safe = normalize(parameters);
  const { cellWidth, cellHeight } = getCellDimensions(safe);
  const amplitude = Math.abs(safe.targetHeight) * (safe.foldProgress / 100);
  const rise = 2 * amplitude;
  const { flipsX, flipsY } = foldAxes(patternId, safe.rows, safe.columns);

  const axis = (count: number, pitch: number, flips: boolean[]) => {
    const positions = [0];
    for (let i = 0; i < count; i += 1) {
      positions.push(positions[i] + (flips[i] ? projectedPitch(pitch, rise) : pitch));
    }
    const span = positions[count];
    return { positions: positions.map((value) => value - span / 2), span };
  };

  const x = axis(safe.columns, cellWidth, flipsX);
  const y = axis(safe.rows, cellHeight, flipsY);

  const progress = safe.foldProgress / 100;
  const heights: number[][] = [];
  for (let r = 0; r <= safe.rows; r += 1) {
    const row: number[] = [];
    for (let c = 0; c <= safe.columns; c += 1) {
      row.push(getFoldedCornerHeight(patternId, r, c, safe.targetHeight, safe.invertFolds, progress));
    }
    heights.push(row);
  }

  return { xs: x.positions, ys: y.positions, heights, foldedWidth: x.span, foldedHeight: y.span };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export function getPatternStats(patternId: PatternId, parameters: PatternParameters, material: MaterialSpec): PatternStats {
  const safe = normalize(parameters);
  const lines = buildFoldLines(patternId, safe);
  const mountainLines = lines.filter((line) => line.kind === 'mountain').length;
  const valleyLines = lines.filter((line) => line.kind === 'valley').length;
  const area = (safe.panelWidth * safe.panelHeight) / 1_000_000;
  const grooveLength = lines
    .filter((line) => line.kind !== 'cut')
    .reduce((sum, line) => sum + Math.hypot(line.x2 - line.x1, line.y2 - line.y1), 0) / 1000;
  const volume = safe.panelWidth * safe.panelHeight * material.thickness;
  const mechanics = getFoldMechanics(patternId, safe, material);
  return {
    totalLines: lines.length,
    mountainLines,
    valleyLines,
    panelArea: `${area.toFixed(2)} m²`,
    grooveLength: `${grooveLength.toFixed(1)} m`,
    estimatedWeight: `${(volume * material.density).toFixed(1)} kg`,
    foldedSize: `${Math.round(mechanics.foldedWidth)} × ${Math.round(mechanics.foldedHeight)} mm`,
  };
}

/** Shared by the legacy single-string warning and the full check list. */
function cellSizeWarning(parameters: PatternParameters, material: MaterialSpec): string | null {
  const { cellWidth, cellHeight } = getCellDimensions(parameters);
  const shortestCellEdge = Math.min(cellWidth, cellHeight);
  const minimumCell = material.recommendedCell * 0.7;
  if (shortestCellEdge < minimumCell) {
    return `Cell size (${Math.round(shortestCellEdge)} mm) is below the recommended ${Math.round(minimumCell)} mm for ${material.shortName} — intersections may crack during grooving.`;
  }
  return null;
}

export function getMaterialWarning(parameters: PatternParameters, material: MaterialSpec): string | null {
  return cellSizeWarning(parameters, material);
}

/**
 * Everything that would stop this panel coming off the router correctly, in
 * severity order. Each check is a real fabrication constraint, not a hint.
 */
export function getFabricationChecks(patternId: PatternId, parameters: PatternParameters, material: MaterialSpec): FabricationCheck[] {
  const safe = normalize(parameters);
  const mechanics = getFoldMechanics(patternId, safe, material);
  const checks: FabricationCheck[] = [];

  if (!mechanics.feasible) {
    checks.push({
      id: 'unfoldable',
      severity: 'error',
      title: 'Fold depth exceeds the sheet',
      detail: `A ${Math.round(Math.abs(safe.targetHeight))} mm fold needs more material than a ${Math.round(Math.min(mechanics.cellWidth, mechanics.cellHeight))} mm cell holds. Cap the depth at ${Math.floor(mechanics.maxTargetHeight)} mm, or use a coarser grid.`,
    });
  }

  if (mechanics.bendAngle > material.maxBendAngle + 0.5) {
    checks.push({
      id: 'bend-angle',
      severity: 'error',
      title: 'Bend angle beyond the material limit',
      detail: `This fold bends ${mechanics.bendAngle.toFixed(0)}°, past the ${material.maxBendAngle}° limit for ${material.shortName}. The skin will split along the crease.`,
    });
  }

  if (material.foldMethod === 'heat-bend') {
    checks.push({
      id: 'heat-bend',
      severity: 'warning',
      title: `${material.shortName} cannot be V-grooved`,
      detail: `Acrylic crazes at a sharp crease. Line-bend each fold over a ${material.minRadius} mm radius former — the crease pattern is the bend layout, not a groove toolpath.`,
    });
  } else if (mechanics.bendAngle > 1) {
    const bit = safe.vBitAngle;
    if (bit < mechanics.bendAngle - 1) {
      checks.push({
        id: 'bit-too-narrow',
        severity: 'warning',
        title: 'V-bit bottoms out before the fold closes',
        detail: `A ${bit}° groove shuts at ${bit}°, but this fold needs ${mechanics.bendAngle.toFixed(0)}°. Fit a ${Math.ceil(mechanics.bendAngle / 5) * 5}° bit or the panel will spring back.`,
      });
    } else if (bit > mechanics.bendAngle + 15) {
      checks.push({
        id: 'bit-too-wide',
        severity: 'info',
        title: 'Groove closes with a gap',
        detail: `A ${bit}° groove leaves ${(bit - mechanics.bendAngle).toFixed(0)}° open at a ${mechanics.bendAngle.toFixed(0)}° fold. A ${Math.max(30, Math.round(mechanics.bendAngle / 5) * 5)}° bit gives a tighter, stiffer seam.`,
      });
    }
  }

  const cellWarning = cellSizeWarning(safe, material);
  if (cellWarning) {
    checks.push({ id: 'cell-size', severity: 'warning', title: 'Cell below recommended pitch', detail: cellWarning });
  }

  const shortestCell = Math.min(mechanics.cellWidth, mechanics.cellHeight);
  if (material.foldMethod === 'v-groove' && mechanics.grooveWidth > shortestCell * 0.25) {
    checks.push({
      id: 'groove-crowding',
      severity: 'warning',
      title: 'Grooves crowd out the flats',
      detail: `A ${mechanics.grooveWidth.toFixed(1)} mm groove takes ${((mechanics.grooveWidth / shortestCell) * 100).toFixed(0)}% of a ${Math.round(shortestCell)} mm cell. Little flat face is left between creases.`,
    });
  }

  if (checks.length === 0) {
    checks.push({
      id: 'ready',
      severity: 'info',
      title: 'Cleared for fabrication',
      detail: `${mechanics.bendAngle.toFixed(0)}° bend on ${material.shortName}, ${mechanics.grooveDepth.toFixed(1)} mm deep × ${mechanics.grooveWidth.toFixed(1)} mm wide grooves. Folds down to ${Math.round(mechanics.foldedWidth)} × ${Math.round(mechanics.foldedHeight)} mm.`,
    });
  }

  return checks;
}
