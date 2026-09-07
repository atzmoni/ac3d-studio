import type { FoldLine, MaterialSpec, PatternParameters, PatternStats } from './types';

export const MATERIALS: MaterialSpec[] = [
  {
    id: 'acp-4', name: 'Aluminum Composite 4mm', shortName: 'ACP 4 mm', thickness: 4,
    color: '#d7dce4', accent: '#8d99aa', minRadius: 4, maxBendAngle: 120,
    grooveDepth: '2.5–3.0 mm',    recommendedCell: 150,
  },
  {
    id: 'acp-3', name: 'Aluminum Composite 3mm', shortName: 'ACP 3 mm', thickness: 3,
    color: '#bcc6d4', accent: '#6d7b8e', minRadius: 3, maxBendAngle: 120,
    grooveDepth: '2.0–2.5 mm',    recommendedCell: 120,
  },
  {
    id: 'acrylic-3', name: 'Acrylic 3mm', shortName: 'Acrylic 3 mm', thickness: 3,
    color: '#b9d7e8', accent: '#61a2c2', minRadius: 8, maxBendAngle: 90,
    grooveDepth: '1.5–2.0 mm',    recommendedCell: 180,
  },
  {
    id: 'steel-2', name: 'Brushed Steel 2mm', shortName: 'Steel 2 mm', thickness: 2,
    color: '#aeb7bd', accent: '#65717b', minRadius: 2, maxBendAngle: 135,
    grooveDepth: '1.0–1.5 mm',    recommendedCell: 100,
  },
  {
    id: 'cardboard-2', name: 'Architectural Cardboard 2mm', shortName: 'Cardboard 2 mm', thickness: 2,
    color: '#c7a783', accent: '#916b45', minRadius: 1, maxBendAngle: 160,
    grooveDepth: '0.8–1.0 mm',    recommendedCell: 80,
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

export function getMaterial(id: string): MaterialSpec {
  return MATERIALS.find((material) => material.id === id) ?? MATERIALS[0];
}

export function getCellDimensions(parameters: PatternParameters): { cellWidth: number; cellHeight: number } {
  const rows = Math.max(1, Math.floor(parameters.rows));
  const columns = Math.max(1, Math.floor(parameters.columns));
  return { cellWidth: parameters.panelWidth / columns, cellHeight: parameters.panelHeight / rows };
}

/**
 * Height of a panel corner at full fold for the Diamond Fold pattern.
 * Even (row+column) corners rise, odd corners fall — the checkerboard of
 * peaks and valleys; the diagonal ridge between a peak and a valley stays
 * at 0, which is what the crease pattern encodes. `invertFolds` flips it.
 */
/**
 * Height of a panel corner at fold-progress `t` (0 = flat, 1 = fully folded)
 * for the Diamond Fold pattern: even (row+column) corners rise, odd corners
 * fall — the checkerboard of peaks and valleys whose diagonal ridges stay at
 * 0, matching the crease pattern. `invertFolds` flips the checkerboard.
 */
export function getFoldedCornerHeight(row: number, column: number, targetHeight: number, invertFolds: boolean, progress: number): number {
  const parity = (row + column) % 2 === 0 ? 1 : -1;
  return (invertFolds ? -parity : parity) * targetHeight * progress;
}

export function buildFoldLines(parameters: PatternParameters): FoldLine[] {
  const rows = Math.max(1, Math.floor(parameters.rows));
  const columns = Math.max(1, Math.floor(parameters.columns));
  const { panelWidth, panelHeight, invertFolds } = parameters;
  const lines: FoldLine[] = [];
  const cellWidth = panelWidth / columns;
  const cellHeight = panelHeight / rows;

  for (let row = 0; row <= rows; row += 1) {
    lines.push({ id: `horizontal-${row}`, x1: 0, y1: row * cellHeight, x2: panelWidth, y2: row * cellHeight, kind: 'cut' });
  }
  for (let column = 0; column <= columns; column += 1) {
    lines.push({ id: `vertical-${column}`, x1: column * cellWidth, y1: 0, x2: column * cellWidth, y2: panelHeight, kind: 'cut' });
  }
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = column * cellWidth;
      const y = row * cellHeight;
      const isMountain = (row + column) % 2 === 0;
      const kind = (isMountain !== invertFolds) ? 'mountain' : 'valley';
      lines.push({ id: `diag-a-${row}-${column}`, x1: x, y1: y, x2: x + cellWidth, y2: y + cellHeight, kind });
      lines.push({ id: `diag-b-${row}-${column}`, x1: x + cellWidth, y1: y, x2: x, y2: y + cellHeight, kind: kind === 'mountain' ? 'valley' : 'mountain' });
    }
  }
  return lines;
}

export function getPatternStats(parameters: PatternParameters, material: MaterialSpec): PatternStats {
  const lines = buildFoldLines(parameters);
  const mountainLines = lines.filter((line) => line.kind === 'mountain').length;
  const valleyLines = lines.filter((line) => line.kind === 'valley').length;
  const area = (parameters.panelWidth * parameters.panelHeight) / 1_000_000;
  const grooveLength = lines.filter((line) => line.kind !== 'cut').reduce((sum, line) => sum + Math.hypot(line.x2 - line.x1, line.y2 - line.y1), 0) / 1000;
  const volume = parameters.panelWidth * parameters.panelHeight * material.thickness;
  const densityKgPerMm3 = material.id.startsWith('acp') ? 2.7e-6 : material.id === 'steel-2' ? 7.85e-6 : material.id === 'acrylic-3' ? 1.19e-6 : 0.68e-6;
  return {
    totalLines: lines.length,
    mountainLines,
    valleyLines,
    panelArea: `${area.toFixed(2)} m²`,
    grooveLength: `${grooveLength.toFixed(1)} m`,
    estimatedWeight: `${(volume * densityKgPerMm3).toFixed(1)} kg`,
  };
}

export function getMaterialWarning(parameters: PatternParameters, material: MaterialSpec): string | null {
  const { cellWidth, cellHeight } = getCellDimensions(parameters);
  const shortestCellEdge = Math.min(cellWidth, cellHeight);
  const minimumCell = material.recommendedCell * 0.7;
  if (shortestCellEdge < minimumCell) {
    return `Cell size (${Math.round(shortestCellEdge)} mm) is below the recommended ${Math.round(minimumCell)} mm for ${material.shortName} — intersections may crack during grooving.`;
  }
  return null;
}