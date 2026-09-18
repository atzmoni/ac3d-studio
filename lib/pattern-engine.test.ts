import { describe, expect, it } from 'vitest';
import { buildFoldLines, DEFAULT_PARAMETERS, getFoldedCornerHeight, getMaterial, getMaterialWarning, getPatternStats } from './pattern-engine';
import { PATTERNS } from './patterns';

const base = { ...DEFAULT_PARAMETERS };
const acp = getMaterial('acp-4');

describe('pattern registry', () => {
  it('exposes 21 patterns across all five categories', () => {
    expect(PATTERNS).toHaveLength(21);
    const categories = new Set(PATTERNS.map((p) => p.category));
    expect(categories).toEqual(new Set(['geometric', 'origami', 'architectural', 'custom']));
  });

  it('every pattern produces finite lines with unique ids, even at zero grid counts', () => {
    for (const pattern of PATTERNS) {
      const lines = buildFoldLines(pattern.id, { ...base, rows: 0, columns: 0 });
      expect(lines.length).toBeGreaterThan(0);
      const ids = new Set(lines.map((l) => l.id));
      expect(ids.size).toBe(lines.length);
      for (const line of lines) {
        expect([line.x1, line.y1, line.x2, line.y2].every(Number.isFinite)).toBe(true);
      }
    }
  });
});

describe('fold pattern', () => {
  it.each([
    { rows: 1, columns: 1, lines: 6, cuts: 4, mountains: 1, valleys: 1 },
    { rows: 4, columns: 4, lines: 42, cuts: 10, mountains: 16, valleys: 16 },
  ])('diamond produces $lines lines for a $rows×$columns grid', ({ rows, columns, lines, cuts, mountains, valleys }) => {
    const result = buildFoldLines('diamond-fold', { ...base, rows, columns });
    expect(result.filter((l) => l.kind === 'cut')).toHaveLength(cuts);
    expect(result.filter((l) => l.kind === 'mountain')).toHaveLength(mountains);
    expect(result.filter((l) => l.kind === 'valley')).toHaveLength(valleys);
    expect(result).toHaveLength(lines);
  });

  it('inverts every mountain/valley kind when invertFolds is set', () => {
    const kinds = (invertFolds: boolean) => buildFoldLines('diamond-fold', { ...base, rows: 2, columns: 2, invertFolds }).filter((l) => l.kind !== 'cut').map((l) => l.kind);
    expect(kinds(true)).toEqual(kinds(false).map((k) => (k === 'mountain' ? 'valley' : 'mountain')));
  });
});

describe('fold geometry', () => {
  it.each([
    { row: 0, column: 0, height: 50 },  // even parity rises
    { row: 1, column: 1, height: 50 },
    { row: 0, column: 1, height: -50 }, // odd parity falls
    { row: 1, column: 0, height: -50 },
  ])('puts diamond corner ($row,$column) at $height mm at full fold', ({ row, column, height }) => {
    expect(getFoldedCornerHeight('diamond-fold', row, column, 50, false, 1)).toBe(height);
  });

  it('flips the checkerboard when invertFolds is set', () => {
    expect(getFoldedCornerHeight('diamond-fold', 0, 0, 50, true, 1)).toBe(-50);
    expect(getFoldedCornerHeight('diamond-fold', 0, 1, 50, true, 1)).toBe(50);
  });

  it('scales linearly with fold progress and is flat at 0%', () => {
    expect(getFoldedCornerHeight('diamond-fold', 0, 0, 50, false, 0)).toBe(0);
    expect(getFoldedCornerHeight('diamond-fold', 0, 0, 50, false, 0.4)).toBe(20);
  });

  it('uses a stripe sign field for the accordion pattern', () => {
    expect(getFoldedCornerHeight('accordion', 0, 3, 50, false, 1)).toBe(50);
    expect(getFoldedCornerHeight('accordion', 1, 3, 50, false, 1)).toBe(-50);
  });
});

describe('material warning', () => {
  it('is silent at the recommended defaults', () => {
    expect(getMaterialWarning(base, acp)).toBeNull();
  });

  it.each([
    { name: 'a dense grid below the recommended cell size', params: { rows: 12, columns: 12 }, match: /Cell size \(100 mm\) is below the recommended 105 mm/i },
    { name: 'an extreme target height on a dense grid', params: { rows: 12, columns: 12, targetHeight: 600 }, match: /below the recommended/i },
  ])('warns for $name', ({ params, match }) => {
    expect(getMaterialWarning({ ...base, ...params }, acp)).toMatch(match);
  });

  it.each([
    { name: 'a deep fold on a wide cell pitch', params: { targetHeight: 200, rows: 2, columns: 2 } },
    { name: 'degenerate zero grid counts', params: { rows: 0, columns: 0 } },
  ])('does not warn for $name', ({ params }) => {
    expect(getMaterialWarning({ ...base, ...params }, acp)).toBeNull();
  });
});

describe('pattern stats', () => {
  it('matches the fold-line counts and grows groove length with the grid', () => {
    const coarse = getPatternStats('diamond-fold', base, acp);
    const dense = getPatternStats('diamond-fold', { ...base, rows: 8, columns: 8 }, acp);
    expect(coarse.totalLines).toBe(buildFoldLines('diamond-fold', base).length);
    expect(coarse.mountainLines + coarse.valleyLines).toBeGreaterThan(0);
    expect(parseFloat(dense.grooveLength)).toBeGreaterThan(parseFloat(coarse.grooveLength));
  });

  it('estimates weight from the selected material', () => {
    const acpWeight = parseFloat(getPatternStats('diamond-fold', base, acp).estimatedWeight);
    const cardboardWeight = parseFloat(getPatternStats('diamond-fold', base, getMaterial('cardboard-2')).estimatedWeight);
    expect(cardboardWeight).toBeLessThan(acpWeight);
  });
});