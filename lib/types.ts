export type PatternId = 'diamond-fold';

export type MaterialId = 'acp-4' | 'acp-3' | 'acrylic-3' | 'steel-2' | 'cardboard-2';

export type FoldKind = 'mountain' | 'valley' | 'cut';

export interface PatternParameters {
  panelWidth: number;
  panelHeight: number;
  targetHeight: number;
  rows: number;
  columns: number;
  cellSize: number;
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
  risk: 'low' | 'medium' | 'high';
}

export interface PatternDefinition {
  id: PatternId;
  name: string;
  category: string;
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

export interface PatternStats {
  totalLines: number;
  mountainLines: number;
  valleyLines: number;
  panelArea: string;
  grooveLength: string;
  estimatedWeight: string;
}
