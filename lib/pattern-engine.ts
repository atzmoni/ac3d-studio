import type { FoldLine, MaterialSpec, PatternParameters, PatternStats } from './types';

export const MATERIALS: MaterialSpec[] = [
  {
    id: 'acp-4', name: 'Aluminum Composite 4mm', shortName: 'ACP 4 mm', thickness: 4,
    color: '#d7dce4', accent: '#8d99aa', minRadius: 4, maxBendAngle: 120,
    grooveDepth: '2.5–3.0 mm', recommendedCell: 150, risk: 'low',
  },
  {
    id: 'acp-3', name: 'Aluminum Composite 3mm', shortName: 'ACP 3 mm', thickness: 3,
    color: '#bcc6d4', accent: '#6d7b8e', minRadius: 3, maxBendAngle: 120,
    grooveDepth: '2.0–2.5 mm', recommendedCell: 120, risk: 'low',
  },
  {
    id: 'acrylic-3', name: 'Acrylic 3mm', shortName: 'Acrylic 3 mm', thickness: 3,
    color: '#b9d7e8', accent: '#61a2c2', minRadius: 8, maxBendAngle: 90,
    grooveDepth: '1.5–2.0 mm', recommendedCell: 180, risk: 'medium',
  },
  {
    id: 'steel-2', name: 'Brushed Steel 2mm', shortName: 'Steel 2 mm', thickness: 2,
    color: '#aeb7bd', accent: '#65717b', minRadius: 2, maxBendAngle: 135,
    grooveDepth: '1.0–1.5 mm', recommendedCell: 100, risk: 'low',
  },
  {
    id: 'cardboard-2', name: 'Architectural Cardboard 2mm', shortName: 'Cardboard 2 mm', thickness: 2,
    color: '#c7a783', accent: '#916b45', minRadius: 1, maxBendAngle: 160,
    grooveDepth: '0.8–1.0 mm', recommendedCell: 80, risk: 'high',
  },
];

export const DEFAULT_PARAMETERS: PatternParameters = {
  panelWidth: 1200,
  panelHeight: 2400,
  targetHeight: 50,
  rows: 6,
  columns: 6,
  cellSize: 150,
  vBitAngle: 90,
  foldProgress: 40,
  invertFolds: false,
};

export function getMaterial(id: string): MaterialSpec {
  return MATERIALS.find((material) => material.id === id) ?? MATERIALS[0];
}

export function buildFoldLines(parameters: PatternParameters): FoldLine[] {
  const { rows, columns, panelWidth, panelHeight, invertFolds } = parameters;
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

export function getPatternStats(parameters: PatternParameters): PatternStats {
  const lines = buildFoldLines(parameters);
  const mountainLines = lines.filter((line) => line.kind === 'mountain').length;
  const valleyLines = lines.filter((line) => line.kind === 'valley').length;
  const area = (parameters.panelWidth * parameters.panelHeight) / 1_000_000;
  const grooveLength = lines.filter((line) => line.kind !== 'cut').reduce((sum, line) => sum + Math.hypot(line.x2 - line.x1, line.y2 - line.y1), 0) / 1000;
  const volume = parameters.panelWidth * parameters.panelHeight * 0.004;
  return {
    totalLines: lines.length,
    mountainLines,
    valleyLines,
    panelArea: `${area.toFixed(2)} m²`,
    grooveLength: `${grooveLength.toFixed(1)} m`,
    estimatedWeight: `${(volume * 2.7).toFixed(1)} kg`,
  };
}

export function getMaterialWarning(parameters: PatternParameters, material: MaterialSpec): string | null {
  if (parameters.cellSize < material.recommendedCell * 0.7) {
    return `Cell size is below ${Math.round(material.recommendedCell * 0.7)} mm — intersection points may crack during grooving.`;
  }
  if (parameters.targetHeight > material.maxBendAngle) {
    return `Target height exceeds the recommended bend envelope for ${material.shortName}.`;
  }
  return null;
}
