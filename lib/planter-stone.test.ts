import { describe, expect, it } from 'vitest';
import {
  coatCoats, coatDays, coatHours, coatKeepOut, coatKg, coatLitres, coatPasses, coatThroat,
  MAX_COAT_MM, SEAL_NAMES, SEAL_REFLECTION, SEAL_ROUGHNESS, stoneById, stoneName,
  STONE_FAMILIES, STONE_MATERIALS, STONE_SEALS, STONE_TINTS,
} from './planter-stone';

const HEX = /^#[0-9a-f]{6}$/i;

describe('stone catalogue', () => {
  it('carries the whole DXF-STONE shelf, once each', () => {
    expect(STONE_MATERIALS).toHaveLength(40);
    expect(new Set(STONE_MATERIALS.map((s) => s.id)).size).toBe(40);
    expect(new Set(STONE_MATERIALS.map((s) => s.code)).size).toBe(40);
  });

  it('keeps the trade codes in one unbroken run from ST101', () => {
    const codes = STONE_MATERIALS.map((s) => s.code).sort();
    expect(codes[0]).toBe('ST101');
    expect(codes[codes.length - 1]).toBe('ST140');
    codes.forEach((code, i) => expect(code).toBe(`ST${101 + i}`));
  });

  it('gives every stone a colour to fall back on and a real-world tile size', () => {
    for (const stone of STONE_MATERIALS) {
      expect(stone.tone, stone.id).toMatch(HEX);
      // Small enough that a pot shows the stone, big enough that it is not gravel.
      expect(stone.tileMm, stone.id).toBeGreaterThanOrEqual(250);
      expect(stone.tileMm, stone.id).toBeLessThanOrEqual(700);
    }
  });

  it('files every stone under a family that exists, and fills every family', () => {
    const used = new Set(STONE_MATERIALS.map((s) => s.family));
    for (const family of used) expect(STONE_FAMILIES, family).toContain(family);
    for (const family of STONE_FAMILIES) expect(used, family).toContain(family);
  });

  it('names a stone the way a stone yard writes it', () => {
    const jerusalem = stoneById('yellow_stone_wall');
    expect(jerusalem).not.toBeNull();
    expect(stoneName(jerusalem!)).toBe('Limestone — Jerusalem Gold — Tobzeh');
  });

  it('treats an unknown stone as no stone rather than as a crash', () => {
    expect(stoneById('none')).toBeNull();
    expect(stoneById('granite_from_mars')).toBeNull();
    expect(stoneById('')).toBeNull();
  });

  it('offers washes that are colours, starting with the one that is not', () => {
    expect(STONE_TINTS[0]).toBe('#ffffff');
    for (const hex of STONE_TINTS) expect(hex).toMatch(HEX);
  });
});

describe('the coat', () => {
  it('stops at ten millimetres', () => {
    expect(MAX_COAT_MM).toBe(10);
  });

  it('counts passes by what one pass of render actually leaves', () => {
    expect(coatPasses(0)).toBe(0);
    expect(coatPasses(2)).toBe(1);
    expect(coatPasses(3)).toBe(2);
    expect(coatPasses(10)).toBe(4);
    // Never fewer passes for a deeper build.
    for (let mm = 0; mm <= MAX_COAT_MM; mm += 0.5) {
      expect(coatPasses(mm + 0.5)).toBeGreaterThanOrEqual(coatPasses(mm));
    }
  });

  it('always adds a primer, a glaze and a sealer to the build passes', () => {
    for (const mm of [0, 1, 4, 10]) expect(coatCoats(mm)).toBe(coatPasses(mm) + 3);
    // A colour-only pot is still three passes of somebody's time.
    expect(coatCoats(0)).toBe(3);
  });

  it('mixes render for the hollows as well as the peaks, and not for both', () => {
    // A square metre at a millimetre is a litre, less what the texture is not.
    expect(coatLitres(1, 1)).toBeCloseTo(0.6, 6);
    expect(coatLitres(2, 5)).toBeCloseTo(6, 6);
    expect(coatLitres(1, 0)).toBe(0);
    expect(coatKg(1, 10)).toBeCloseTo(0.6 * 10 * 1.55, 6);
  });

  it('charges the glaze more bench time than the build it sits on', () => {
    // One pass of render over a square metre against the wash that follows it.
    expect(coatHours(1, 2) - coatHours(1, 0)).toBeLessThan(2);
    expect(coatHours(1, 10)).toBeGreaterThan(coatHours(1, 0));
    // Twice the pot is twice the work; the rates are per square metre.
    expect(coatHours(2, 6)).toBeCloseTo(2 * coatHours(1, 6), 6);
  });

  it('will not promise more than two build passes in a day', () => {
    expect(coatDays(0)).toBe(1);
    expect(coatDays(2.5)).toBe(2);
    expect(coatDays(10)).toBe(3);
    for (let mm = 0; mm <= MAX_COAT_MM; mm += 0.5) expect(coatDays(mm)).toBeGreaterThanOrEqual(1);
  });

  it('keeps the build off a crease by its own thickness', () => {
    expect(coatKeepOut(0)).toBe(0);
    expect(coatKeepOut(6)).toBe(6);
    expect(coatKeepOut(-3)).toBe(0);
  });

  it('takes the coat off both sides of an opening, and says when that closes it', () => {
    expect(coatThroat(20, 0)).toBe(20);
    expect(coatThroat(20, 6)).toBe(8);
    // Ten millimetres either side of a nineteen millimetre hole is no hole.
    expect(coatThroat(19, 10)).toBeLessThan(0);
  });
});

describe('the sealer', () => {
  it('specifies all three, and each of them completely', () => {
    expect(STONE_SEALS).toHaveLength(3);
    for (const seal of STONE_SEALS) {
      const [low, high] = SEAL_ROUGHNESS[seal];
      expect(low, seal).toBeGreaterThan(0);
      expect(high, seal).toBeGreaterThan(low);
      expect(high, seal).toBeLessThanOrEqual(1);
      expect(SEAL_REFLECTION[seal], seal).toBeGreaterThan(0);
      expect(SEAL_NAMES[seal], seal).toBeTruthy();
    }
  });

  it('runs matte through satin to wet, drier to wetter, in that order', () => {
    expect(SEAL_ROUGHNESS.matte[0]).toBeGreaterThan(SEAL_ROUGHNESS.satin[0]);
    expect(SEAL_ROUGHNESS.satin[0]).toBeGreaterThan(SEAL_ROUGHNESS.wet[0]);
    expect(SEAL_REFLECTION.wet).toBeGreaterThan(SEAL_REFLECTION.satin);
    expect(SEAL_REFLECTION.satin).toBeGreaterThan(SEAL_REFLECTION.matte);
  });
});
