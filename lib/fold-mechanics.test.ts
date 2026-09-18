import { describe, expect, it } from 'vitest';
import {
  buildFoldLines, DEFAULT_PARAMETERS, getFabricationChecks, getFoldedGrid, getFoldMechanics, getMaterial, getPatternStats,
} from './pattern-engine';
import { PATTERNS } from './patterns';
import type { PatternId, PatternParameters } from './types';

const base = { ...DEFAULT_PARAMETERS };
const acp = getMaterial('acp-4');
const ALL_IDS = PATTERNS.map((pattern) => pattern.id);
const GRIDS = [{ rows: 1, columns: 1 }, { rows: 2, columns: 3 }, { rows: 5, columns: 4 }, { rows: 12, columns: 12 }];

describe('sheet invariants', () => {
  // A crease outside the sheet is a toolpath that routes off the material, and a
  // zero-length one is a plunge that cuts nothing. Neither may ever ship.
  it.each(ALL_IDS)('%s keeps every crease inside the panel with real length', (id) => {
    for (const grid of GRIDS) {
      const parameters = { ...base, ...grid };
      const lines = buildFoldLines(id, parameters);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(Math.min(line.x1, line.x2)).toBeGreaterThanOrEqual(-1e-6);
        expect(Math.max(line.x1, line.x2)).toBeLessThanOrEqual(parameters.panelWidth + 1e-6);
        expect(Math.min(line.y1, line.y2)).toBeGreaterThanOrEqual(-1e-6);
        expect(Math.max(line.y1, line.y2)).toBeLessThanOrEqual(parameters.panelHeight + 1e-6);
        expect(Math.hypot(line.x2 - line.x1, line.y2 - line.y1)).toBeGreaterThan(1e-6);
      }
      expect(new Set(lines.map((line) => line.id)).size).toBe(lines.length);
    }
  });

  it.each(ALL_IDS)('%s emits no coincident creases that would be cut twice', (id) => {
    const keys = buildFoldLines(id, { ...base, rows: 5, columns: 4 }).map((line) => {
      const a = `${line.x1.toFixed(4)},${line.y1.toFixed(4)}`;
      const b = `${line.x2.toFixed(4)},${line.y2.toFixed(4)}`;
      return a < b ? `${a}|${b}` : `${b}|${a}`;
    });
    expect(new Set(keys).size).toBe(keys.length);
  });

  // getFoldMechanics probes one row and one column to decide which axes fold.
  // That shortcut is only exact while every sign field stays separable.
  it.each(ALL_IDS)('%s has a separable sign field', (id) => {
    const { sign } = PATTERNS.find((pattern) => pattern.id === id)!;
    for (let r = 0; r <= 8; r += 1) {
      for (let c = 0; c <= 8; c += 1) {
        expect(sign(r, c) !== sign(r, c + 1)).toBe(sign(0, c) !== sign(0, c + 1));
        expect(sign(r, c) !== sign(r + 1, c)).toBe(sign(r, 0) !== sign(r + 1, 0));
      }
    }
  });
});

describe('fold kinematics', () => {
  // The accordion pleats along the 2400 mm axis only: 6 rows of 400 mm pitch.
  const pleat = (overrides: Partial<PatternParameters>) => getFoldMechanics('accordion', { ...base, ...overrides }, acp);

  it('conserves edge length — a folded facet is never stretched', () => {
    const mechanics = pleat({ foldProgress: 100 });
    const projected = mechanics.foldedHeight / 6;
    expect(Math.hypot(projected, 2 * mechanics.amplitude)).toBeCloseTo(400, 6);
  });

  it('contracts only across the axis that folds', () => {
    const mechanics = pleat({ foldProgress: 100 });
    expect(mechanics.foldsAlongY).toBe(true);
    expect(mechanics.foldsAlongX).toBe(false);
    expect(mechanics.foldedWidth).toBeCloseTo(base.panelWidth, 6);
    expect(mechanics.foldedHeight).toBeCloseTo(6 * Math.sqrt(400 ** 2 - 100 ** 2), 6);
    expect(mechanics.contractionX).toBeCloseTo(0, 6);
    expect(mechanics.contractionY).toBeGreaterThan(0);
  });

  it('is flat and full size at zero progress, then deepens monotonically', () => {
    expect(pleat({ foldProgress: 0 }).foldedHeight).toBeCloseTo(base.panelHeight, 6);
    expect(pleat({ foldProgress: 0 }).bendAngle).toBe(0);
    const spans = [0, 25, 50, 75, 100].map((foldProgress) => pleat({ foldProgress }).foldedHeight);
    for (let i = 1; i < spans.length; i += 1) expect(spans[i]).toBeLessThan(spans[i - 1]);
  });

  it('derives the bend angle from the rise over the pitch', () => {
    // rise = 2 × 50 mm over a 400 mm pitch → 2·asin(0.25).
    expect(pleat({ foldProgress: 100 }).bendAngle).toBeCloseTo((2 * Math.asin(0.25) * 180) / Math.PI, 6);
    // A crease folded flat back on itself is a 180° bend.
    expect(pleat({ targetHeight: 200, foldProgress: 100 }).bendAngle).toBeCloseTo(180, 6);
  });

  it('caps the fold at the depth the flat sheet can supply', () => {
    expect(pleat({}).maxTargetHeight).toBe(200);                                   // one axis: half the 400 mm pitch
    expect(getFoldMechanics('diamond-fold', base, acp).maxTargetHeight).toBe(100); // both axes: half the 200 mm pitch
    expect(pleat({ targetHeight: 200 }).feasible).toBe(true);
    expect(pleat({ targetHeight: 201 }).feasible).toBe(false);
  });

  it('sizes the V-groove from the material and the bit', () => {
    const groove = pleat({ vBitAngle: 90 });
    expect(groove.grooveDepth).toBeCloseTo(4 - 1.2, 6);   // thickness less the residual skin
    expect(groove.grooveWidth).toBeCloseTo(2 * 2.8, 6);   // a 90° bit opens to twice its depth
    expect(pleat({ vBitAngle: 60 }).grooveWidth).toBeLessThan(groove.grooveWidth);
    expect(groove.requiredBitAngle).toBeCloseTo(groove.bendAngle, 6);
  });

  it('never reports a folded panel larger than the sheet it was cut from', () => {
    for (const pattern of PATTERNS) {
      for (const foldProgress of [0, 40, 100]) {
        const mechanics = getFoldMechanics(pattern.id, { ...base, foldProgress }, acp);
        expect(mechanics.foldedWidth).toBeLessThanOrEqual(base.panelWidth + 1e-6);
        expect(mechanics.foldedHeight).toBeLessThanOrEqual(base.panelHeight + 1e-6);
        expect(Number.isFinite(mechanics.bendAngle)).toBe(true);
      }
    }
  });
});

describe('folded grid', () => {
  it('spans the folded footprint, centred on the origin', () => {
    const grid = getFoldedGrid('accordion', { ...base, foldProgress: 100 });
    expect(grid.xs).toHaveLength(base.columns + 1);
    expect(grid.ys).toHaveLength(base.rows + 1);
    expect(grid.ys[0]).toBeCloseTo(-grid.ys[base.rows], 6);
    expect(grid.ys[base.rows] - grid.ys[0]).toBeCloseTo(grid.foldedHeight, 6);
    expect(grid.heights).toHaveLength(base.rows + 1);
    expect(grid.heights[0]).toHaveLength(base.columns + 1);
  });

  it('collapses to the flat sheet at zero fold', () => {
    const grid = getFoldedGrid('diamond-fold', { ...base, foldProgress: 0 });
    expect(grid.foldedWidth).toBeCloseTo(base.panelWidth, 6);
    expect(grid.heights.flat().every((z) => z === 0)).toBe(true);
  });
});

describe('fabrication checks', () => {
  const ids = (overrides: Partial<PatternParameters>, materialId = 'acp-4', patternId: PatternId = 'diamond-fold') =>
    getFabricationChecks(patternId, { ...base, ...overrides }, getMaterial(materialId)).map((check) => check.id);

  it('blocks a fold deeper than the sheet can supply', () => {
    expect(ids({ targetHeight: 150 })).toContain('unfoldable');
    expect(getFabricationChecks('diamond-fold', { ...base, targetHeight: 150 }, acp)[0].severity).toBe('error');
  });

  it('blocks a bend past the material limit', () => {
    // 100 mm deep on a 200 mm pitch folds the crease right over: a 180° bend on a 120° material.
    expect(ids({ targetHeight: 100, foldProgress: 100 })).toContain('bend-angle');
  });

  it('flags a V-bit that cannot close the fold, and one that leaves a gap', () => {
    expect(ids({ vBitAngle: 20 })).toContain('bit-too-narrow');
    expect(ids({ vBitAngle: 90 })).toContain('bit-too-wide');
    expect(ids({ vBitAngle: 20, targetHeight: 1 })).not.toContain('bit-too-narrow');
  });

  it('routes acrylic away from V-grooving entirely', () => {
    const acrylic = ids({}, 'acrylic-3');
    expect(acrylic).toContain('heat-bend');
    expect(acrylic).not.toContain('bit-too-wide'); // there is no groove to size
  });

  it('reports a clean bill when nothing is wrong', () => {
    const checks = getFabricationChecks('accordion', { ...base, targetHeight: 40, foldProgress: 100, vBitAngle: 25 }, acp);
    expect(checks.map((check) => check.id)).toEqual(['ready']);
    expect(checks[0].detail).toMatch(/Folds down to \d+ . \d+ mm/);
  });

  it('always returns at least one actionable check, whatever the inputs', () => {
    for (const pattern of PATTERNS) {
      for (const materialId of ['acp-4', 'acrylic-3', 'steel-2', 'cardboard-2']) {
        const checks = getFabricationChecks(pattern.id, { ...base, rows: 0, columns: 0 }, getMaterial(materialId));
        expect(checks.length).toBeGreaterThan(0);
        expect(checks.every((check) => check.title && check.detail)).toBe(true);
      }
    }
  });
});

describe('folded reporting', () => {
  it('reports the folded footprint alongside the flat sheet', () => {
    expect(getPatternStats('accordion', { ...base, foldProgress: 0 }, acp).foldedSize).toContain('1200');
    expect(getPatternStats('accordion', { ...base, foldProgress: 100 }, acp).foldedSize).toContain('2324'); // 6 × √(400² − 100²)
  });

  it('weighs ACP as a composite, not as solid aluminium', () => {
    // 1200 × 2400 mm of 4 mm ACP is ~5.5 kg/m² → ~15.8 kg, not the ~31 kg of a solid billet.
    expect(parseFloat(getPatternStats('diamond-fold', base, acp).estimatedWeight)).toBeCloseTo(15.8, 1);
  });
});
