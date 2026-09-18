import type { FoldKind, FoldLine, PatternDefinition, PatternParameters } from './types';

/** Sign of the fold at a grid corner (+1 rises, -1 falls) — drives the 3D fold. */
export type SignFn = (row: number, column: number) => 1 | -1;

export interface PatternSpec extends PatternDefinition {
  sign: SignFn;
  lines: (p: PatternParameters) => FoldLine[];
}

const checker: SignFn = (r, c) => ((r + c) % 2 === 0 ? 1 : -1);
const hStripes: SignFn = (r) => (r % 2 === 0 ? 1 : -1);
const vStripes: SignFn = (_r, c) => (c % 2 === 0 ? 1 : -1);
const blocks2x2: SignFn = (r, c) => ((Math.floor(r / 2) + Math.floor(c / 2)) % 2 === 0 ? 1 : -1);
const offsetStripes: SignFn = (r, c) => ((r + Math.floor(c / 2)) % 2 === 0 ? 1 : -1);

const M: FoldKind = 'mountain';
const V: FoldKind = 'valley';
const foldKind = (r: number, c: number): FoldKind => ((r + c) % 2 === 0 ? M : V);

function cuts(rows: number, cols: number, w: number, h: number): FoldLine[] {
  const lines: FoldLine[] = [];
  for (let r = 0; r <= rows; r += 1) lines.push({ id: `cut-h${r}`, x1: 0, y1: (r * h) / rows, x2: w, y2: (r * h) / rows, kind: 'cut' });
  for (let c = 0; c <= cols; c += 1) lines.push({ id: `cut-v${c}`, x1: (c * w) / cols, y1: 0, x2: (c * w) / cols, y2: h, kind: 'cut' });
  return lines;
}

/** Both diagonals of every cell; `sameKind` makes both diagonals share the cell's fold direction. */
function diagBoth(rows: number, cols: number, w: number, h: number, sameKind = false): FoldLine[] {
  const lines: FoldLine[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const x = (c * w) / cols;
      const y = (r * h) / rows;
      const x2 = x + w / cols;
      const y2 = y + h / rows;
      const k = foldKind(r, c);
      lines.push({ id: `da${r}-${c}`, x1: x, y1: y, x2: x2, y2: y2, kind: k });
      lines.push({ id: `db${r}-${c}`, x1: x2, y1: y, x2: x, y2: y2, kind: sameKind ? k : k === M ? V : M });
    }
  }
  return lines;
}

/** One diagonal per cell pointing toward the 2×2 block center (pinwheel / swirl). */
function pinwheelDiags(rows: number, cols: number, w: number, h: number): FoldLine[] {
  const lines: FoldLine[] = [];
  const cw = w / cols;
  const ch = h / rows;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const x = c * cw;
      const y = r * ch;
      const toCenter = ((r % 2) * 2 + (c % 2)) % 4; // 0 TL, 1 TR, 2 BL, 3 BR cell within its block
      const kinds = foldKind(r, c);
      if (toCenter === 0) lines.push({ id: `pw${r}-${c}`, x1: x, y1: y, x2: x + cw, y2: y + ch, kind: kinds });
      else if (toCenter === 1) lines.push({ id: `pw${r}-${c}`, x1: x + cw, y1: y, x2: x, y2: y + ch, kind: kinds });
      else if (toCenter === 2) lines.push({ id: `pw${r}-${c}`, x1: x, y1: y + ch, x2: x + cw, y2: y, kind: kinds });
      else lines.push({ id: `pw${r}-${c}`, x1: x + cw, y1: y + ch, x2: x, y2: y, kind: kinds });
    }
  }
  return lines;
}

/** Parallel fold lines along one axis, alternating mountain/valley. */
function stripes(axis: 'h' | 'v', count: number, w: number, h: number): FoldLine[] {
  const lines: FoldLine[] = [];
  for (let i = 0; i <= count; i += 1) {
    const kind: FoldKind = i % 2 === 0 ? M : V;
    if (axis === 'h') lines.push({ id: `st-h${i}`, x1: 0, y1: (i * h) / count, x2: w, y2: (i * h) / count, kind });
    else lines.push({ id: `st-v${i}`, x1: (i * w) / count, y1: 0, x2: (i * w) / count, y2: h, kind });
  }
  return lines;
}

/** Per-row zigzag (V's), optionally mirrored per row, used by yoshimura / chevron / herringbone. */
function chevrons(rows: number, cols: number, w: number, h: number, mirror = false): FoldLine[] {
  const lines: FoldLine[] = [];
  const cw = w / cols;
  const ch = h / rows;
  for (let r = 0; r < rows; r += 1) {
    const y = r * ch;
    const kind: FoldKind = r % 2 === 0 ? M : V;
    const forward = !(mirror && r % 2 === 1);
    for (let c = 0; c < cols; c += 1) {
      const x = c * cw;
      lines.push({
        id: `ch${r}-${c}-a`, x1: forward ? x : x + cw, y1: y, x2: x + cw / 2, y2: y + ch, kind,
      });
      lines.push({
        id: `ch${r}-${c}-b`, x1: x + cw / 2, y1: y + ch, x2: forward ? x + cw : x, y2: y, kind,
      });
    }
  }
  return lines;
}

/** Center spokes of every cell (pyramid grid). */
function spokes(rows: number, cols: number, w: number, h: number): FoldLine[] {
  const lines: FoldLine[] = [];
  const cw = w / cols;
  const ch = h / rows;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const x = c * cw;
      const y = r * ch;
      const cx = x + cw / 2;
      const cy = y + ch / 2;
      const k = foldKind(r, c);
      const corners = [[x, y], [x + cw, y], [x + cw, y + ch], [x, y + ch]] as const;
      corners.forEach(([px, py], i) => lines.push({ id: `sp${r}-${c}-${i}`, x1: cx, y1: cy, x2: px, y2: py, kind: k }));
    }
  }
  return lines;
}

/** Full-width parallel diagonals of one slope, alternating fold direction. */
function longDiagonals(rows: number, cols: number, w: number, h: number, both = false): FoldLine[] {
  const lines: FoldLine[] = [];
  const ch = h / rows;
  for (let i = -1; i <= rows; i += 1) {
    const kind: FoldKind = Math.abs(i) % 2 === 0 ? M : V;
    const y0 = i * ch;
    const y1 = y0 + ch;
    lines.push({ id: `ld${i}`, x1: 0, y1: y0, x2: w, y2: y1, kind });
    if (both) lines.push({ id: `ldx${i}`, x1: 0, y1: y1, x2: w, y2: y0, kind: kind === M ? V : M });
  }
  return lines;
}

/** Horizontal fold stripes with alternating phase per column (staggered pleat). */
function staggered(rows: number, cols: number, w: number, h: number): FoldLine[] {
  const lines: FoldLine[] = [];
  const cw = w / cols;
  const ch = h / rows;
  for (let r = 0; r <= rows; r += 1) {
    const kind: FoldKind = r % 2 === 0 ? M : V;
    const offset = r % 2 === 1 ? cw / 2 : 0;
    if (offset > 0) lines.push({ id: `sg${r}-0`, x1: 0, y1: r * ch, x2: offset, y2: r * ch, kind });
    for (let c = 0; c < cols; c += 1) {
      const x = c * cw + offset;
      lines.push({ id: `sg${r}-${c + 1}`, x1: x, y1: r * ch, x2: Math.min(x + cw, w), y2: r * ch, kind });
    }
  }
  return lines;
}

/** Zigzag horizontal lines (honeycomb / wave approximations). */
function zigzagRows(rows: number, cols: number, w: number, h: number): FoldLine[] {
  const lines: FoldLine[] = [];
  const cw = w / cols;
  const ch = h / rows;
  for (let r = 0; r <= rows; r += 1) {
    const y = r * ch;
    const kind: FoldKind = r % 2 === 0 ? M : V;
    for (let c = 0; c < cols; c += 1) {
      const x = c * cw;
      const dy = r % 2 === 1 ? ch / 4 : -ch / 4;
      lines.push({ id: `zr${r}-${c}`, x1: x, y1: y + dy, x2: x + cw, y2: y - dy, kind });
    }
  }
  return lines;
}

/** Per-cell midlines (waterbomb cross). */
function midlines(rows: number, cols: number, w: number, h: number): FoldLine[] {
  const lines: FoldLine[] = [];
  const cw = w / cols;
  const ch = h / rows;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const x = c * cw;
      const y = r * ch;
      const k = foldKind(r, c);
      lines.push({ id: `ml-h${r}-${c}`, x1: x, y1: y + ch / 2, x2: x + cw, y2: y + ch / 2, kind: k });
      lines.push({ id: `ml-v${r}-${c}`, x1: x + cw / 2, y1: y, x2: x + cw / 2, y2: y + ch, kind: k === M ? V : M });
    }
  }
  return lines;
}

export const PATTERNS: PatternSpec[] = [
  {
    id: 'diamond-fold', name: 'Diamond Fold', subtitle: 'Classic raised diamond grid', category: 'geometric',
    tags: ['CNC', '-3D', 'ACM'], description: 'Repeating diamonds that lift into a faceted raised surface — the architectural staple.',
    applications: ['Facade', 'Backdrop', 'Signage'], difficulty: 'Medium', recommendedMaterial: 'acp-4', sign: checker,
    lines: (p) => [...cuts(p.rows, p.columns, p.panelWidth, p.panelHeight), ...diagBoth(p.rows, p.columns, p.panelWidth, p.panelHeight)],
  },
  {
    id: 'box-pleat', name: 'Box Pleat', subtitle: 'Grid of raised boxes', category: 'geometric',
    tags: ['CNC', '-3D', 'ACM'], description: 'Perpendicular pleats forming crisp box-like cells across the panel.',
    applications: ['Facade', 'Soffit'], difficulty: 'Medium', recommendedMaterial: 'acp-3', sign: checker,
    lines: (p) => [...cuts(p.rows, p.columns, p.panelWidth, p.panelHeight), ...diagBoth(p.rows, p.columns, p.panelWidth, p.panelHeight, true)],
  },
  {
    id: 'accordion', name: 'Accordion', subtitle: 'Vertical corrugation', category: 'geometric',
    tags: ['CNC', '-3D'], description: 'Parallel horizontal folds that corrugate the panel edge-to-edge.',
    applications: ['Soffit', 'Screens'], difficulty: 'Low', recommendedMaterial: 'steel-2', sign: hStripes,
    lines: (p) => stripes('h', p.rows, p.panelWidth, p.panelHeight),
  },
  {
    id: 'fan', name: 'Fan Fold', subtitle: 'Horizontal corrugation', category: 'geometric',
    tags: ['CNC', '-3D'], description: 'Vertical fold lines creating a fan-like accordion surface.',
    applications: ['Backdrop', 'Screens'], difficulty: 'Low', recommendedMaterial: 'steel-2', sign: vStripes,
    lines: (p) => stripes('v', p.columns, p.panelWidth, p.panelHeight),
  },
  {
    id: 'pinwheel', name: 'Pinwheel', subtitle: 'Rotating block folds', category: 'origami',
    tags: ['-3D', 'Exp'], description: 'Folds that spin around each 2×2 block into a pinwheel relief.',
    applications: ['Showroom', 'Art panel'], difficulty: 'High', recommendedMaterial: 'acrylic-3', sign: blocks2x2,
    lines: (p) => [...cuts(p.rows, p.columns, p.panelWidth, p.panelHeight), ...pinwheelDiags(p.rows, p.columns, p.panelWidth, p.panelHeight)],
  },
  {
    id: 'yoshimura', name: 'Yoshimura', subtitle: 'Triangulated zigzag', category: 'origami',
    tags: ['-3D', 'Exp'], description: 'Diamond zigzag rows — the classic column-buckling fold.',
    applications: ['Columns', 'Screens'], difficulty: 'Medium', recommendedMaterial: 'cardboard-2', sign: checker,
    lines: (p) => [...stripes('h', p.rows, p.panelWidth, p.panelHeight), ...chevrons(p.rows, p.columns, p.panelWidth, p.panelHeight)],
  },
  {
    id: 'miura', name: 'Miura-ori', subtitle: 'Offset parallelogram fold', category: 'origami',
    tags: ['-3D', 'Exp'], description: 'The foldable parallelogram tessellation — compresses in both directions.',
    applications: ['Screens', 'Deployables'], difficulty: 'High', recommendedMaterial: 'cardboard-2', sign: offsetStripes,
    lines: (p) => [...longDiagonals(p.rows, p.columns, p.panelWidth, p.panelHeight), ...stripes('v', p.columns, p.panelWidth, p.panelHeight)],
  },
  {
    id: 'herringbone', name: 'Herringbone', subtitle: 'Alternating chevron weave', category: 'origami',
    tags: ['-3D', 'Exp'], description: 'Chevron rows flipping direction — a woven herringbone relief.',
    applications: ['Facade', 'Backdrop'], difficulty: 'Medium', recommendedMaterial: 'acrylic-3', sign: checker,
    lines: (p) => chevrons(p.rows, p.columns, p.panelWidth, p.panelHeight, true),
  },
  {
    id: 'waterbomb', name: 'Waterbomb', subtitle: 'Dense folded grid', category: 'origami',
    tags: ['-3D', 'Exp'], description: 'Grid, diagonals and midlines — the densest classic fold base.',
    applications: ['Art panel', 'Showroom'], difficulty: 'High', recommendedMaterial: 'cardboard-2', sign: checker,
    lines: (p) => [...cuts(p.rows, p.columns, p.panelWidth, p.panelHeight), ...diagBoth(p.rows, p.columns, p.panelWidth, p.panelHeight), ...midlines(p.rows, p.columns, p.panelWidth, p.panelHeight)],
  },
  {
    id: 'chevron', name: 'Chevron', subtitle: 'Ridged V profile', category: 'geometric',
    tags: ['CNC', '-3D', 'ACM'], description: 'Continuous V ridges in a single direction across the panel.',
    applications: ['Soffit', 'Signage'], difficulty: 'Low', recommendedMaterial: 'acp-4', sign: checker,
    lines: (p) => [...cuts(p.rows, p.columns, p.panelWidth, p.panelHeight), ...chevrons(p.rows, p.columns, p.panelWidth, p.panelHeight)],
  },
  {
    id: 'zigzag', name: 'Zigzag', subtitle: 'Parallel diagonal pleats', category: 'geometric',
    tags: ['CNC', '-3D'], description: 'Full-width diagonal pleats alternating fold direction.',
    applications: ['Facade', 'Backdrop'], difficulty: 'Low', recommendedMaterial: 'acp-3', sign: checker,
    lines: (p) => longDiagonals(p.rows, p.columns, p.panelWidth, p.panelHeight),
  },
  {
    id: 'cross-pleat', name: 'Cross Pleat', subtitle: 'Cross-hatched fold grid', category: 'geometric',
    tags: ['CNC', '-3D', 'ACM'], description: 'Grid folds cross-hatched with diagonals for a dense relief.',
    applications: ['Facade', 'Soffit'], difficulty: 'Medium', recommendedMaterial: 'acp-3', sign: checker,
    lines: (p) => [...stripes('h', p.rows, p.panelWidth, p.panelHeight), ...stripes('v', p.columns, p.panelWidth, p.panelHeight), ...diagBoth(p.rows, p.columns, p.panelWidth, p.panelHeight)],
  },
  {
    id: 'corrugation', name: 'Corrugation', subtitle: 'Biaxial fold grid', category: 'geometric',
    tags: ['CNC', '-3D'], description: 'Horizontal and vertical folds forming a biaxial corrugation.',
    applications: ['Soffit', 'Screens'], difficulty: 'Low', recommendedMaterial: 'steel-2', sign: hStripes,
    lines: (p) => [...stripes('h', p.rows, p.panelWidth, p.panelHeight), ...stripes('v', p.columns, p.panelWidth, p.panelHeight)],
  },
  {
    id: 'pyramid', name: 'Pyramid Grid', subtitle: 'Raised cell peaks', category: 'geometric',
    tags: ['CNC', '-3D', 'ACM'], description: 'Every cell lifts to a pyramid peak from its center.',
    applications: ['Facade', 'Showroom'], difficulty: 'Medium', recommendedMaterial: 'acp-4', sign: checker,
    lines: (p) => [...cuts(p.rows, p.columns, p.panelWidth, p.panelHeight), ...spokes(p.rows, p.columns, p.panelWidth, p.panelHeight)],
  },
  {
    id: 'triangle', name: 'Triangle Grid', subtitle: 'Triangular tessellation', category: 'geometric',
    tags: ['-3D', 'Exp'], description: 'Zigzag rows and columns breaking the panel into triangles.',
    applications: ['Art panel', 'Backdrop'], difficulty: 'Medium', recommendedMaterial: 'acrylic-3', sign: checker,
    lines: (p) => [...chevrons(p.rows, p.columns, p.panelWidth, p.panelHeight), ...stripes('v', p.columns, p.panelWidth, p.panelHeight)],
  },
  {
    id: 'diagonal-grid', name: 'Diagonal Grid', subtitle: 'X lattice', category: 'geometric',
    tags: ['CNC', '-3D'], description: 'Crossing full-width diagonals forming an X lattice.',
    applications: ['Facade', 'Screens'], difficulty: 'Medium', recommendedMaterial: 'steel-2', sign: checker,
    lines: (p) => longDiagonals(p.rows, p.columns, p.panelWidth, p.panelHeight, true),
  },
  {
    id: 'staggered', name: 'Staggered Pleat', subtitle: 'Offset fold rows', category: 'custom',
    tags: ['-3D', 'Exp'], description: 'Horizontal pleats whose joints stagger column to column.',
    applications: ['Backdrop', 'Art panel'], difficulty: 'Medium', recommendedMaterial: 'cardboard-2', sign: offsetStripes,
    lines: (p) => staggered(p.rows, p.columns, p.panelWidth, p.panelHeight),
  },
  {
    id: 'swirl', name: 'Swirl', subtitle: 'Block pinwheel relief', category: 'custom',
    tags: ['-3D', 'Exp'], description: 'Dense pinwheel folds around every block with a cut frame.',
    applications: ['Showroom', 'Signage'], difficulty: 'High', recommendedMaterial: 'acrylic-3', sign: blocks2x2,
    lines: (p) => [...cuts(p.rows, p.columns, p.panelWidth, p.panelHeight), ...pinwheelDiags(p.rows, p.columns, p.panelWidth, p.panelHeight), ...spokes(p.rows, p.columns, p.panelWidth, p.panelHeight)],
  },
  {
    id: 'honeycomb', name: 'Honeycomb', subtitle: 'Hexagonal weave', category: 'architectural',
    tags: ['-3D', 'Exp'], description: 'Offset zigzag rows suggesting a hexagonal cellular weave.',
    applications: ['Facade', 'Backdrop'], difficulty: 'Medium', recommendedMaterial: 'acp-3', sign: offsetStripes,
    lines: (p) => [...zigzagRows(p.rows, p.columns, p.panelWidth, p.panelHeight), ...stripes('v', p.columns, p.panelWidth, p.panelHeight)],
  },
  {
    id: 'wave', name: 'Wave', subtitle: 'Sawtooth surface', category: 'architectural',
    tags: ['CNC', '-3D'], description: 'Horizontal sawtooth ridges rolling across the panel.',
    applications: ['Facade', 'Soffit'], difficulty: 'Low', recommendedMaterial: 'acp-4', sign: hStripes,
    lines: (p) => [...stripes('h', p.rows, p.panelWidth, p.panelHeight), ...zigzagRows(p.rows, p.columns, p.panelWidth, p.panelHeight)],
  },
  {
    id: 'chevron-arch', name: 'Facade Chevron', subtitle: 'Mirrored architectural V', category: 'architectural',
    tags: ['CNC', '-3D', 'ACM'], description: 'Mirrored chevron bands on a cut grid — a bold facade rhythm.',
    applications: ['Facade', 'Entrance'], difficulty: 'Medium', recommendedMaterial: 'acp-4', sign: checker,
    lines: (p) => [...cuts(p.rows, p.columns, p.panelWidth, p.panelHeight), ...chevrons(p.rows, p.columns, p.panelWidth, p.panelHeight, true)],
  },
];

export function getPattern(id: string): PatternSpec {
  return PATTERNS.find((pattern) => pattern.id === id) ?? PATTERNS[0];
}