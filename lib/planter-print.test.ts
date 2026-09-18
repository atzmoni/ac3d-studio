import { describe, expect, it } from 'vitest';
import {
  CUSTOM_PALETTE, DEFAULT_GROUT, DEFAULT_PRINT_COLOURS, facetLight, insetTriangle, isHex,
  luminance, MAX_GROUT, MAX_PRINT_TONES, paletteById, paletteColours, paletteName, PRINT_BED,
  PRINT_FITS, PRINT_MODES, PRINT_PALETTES, PRINT_RULE_NAMES, PRINT_RULES, printInkMl, printKg,
  printMinutes, printPasses, printTiles, shadeHex, toneIndex, triangleArea, trianglePerimeter,
  triangleFills, type PlanterPrintRule, type PrintFacet, type PrintOptions,
} from './planter-print';
import type { Vec2 } from './types';

const HEX = /^#[0-9a-f]{6}$/i;

/** A wall of `sides` × `rows` facets, numbered the way the engine numbers them. */
const wall = (sides = 6, rows = 3): PrintFacet[] => {
  const facets: PrintFacet[] = [];
  for (let band = 0; band < rows; band += 1) {
    for (let facet = 0; facet < sides * 2; facet += 1) {
      const column = Math.floor(facet / 2);
      const up = facet % 2 === 0;
      const angle = ((column + 0.5) / sides) * Math.PI * 2;
      facets.push({
        index: band * sides * 2 + facet,
        band,
        column,
        up,
        height: (band + (up ? 0.33 : 0.67)) / rows,
        around: column / sides,
        normal: { x: Math.cos(angle), y: Math.sin(angle), z: up ? 0.2 : -0.2 },
      });
    }
  }
  return facets;
};

const options = (over: Partial<PrintOptions> = {}): PrintOptions => ({
  rule: 'scatter',
  colours: PRINT_PALETTES[0].colours,
  tones: 4,
  seed: 1,
  shade: 0,
  ...over,
});

describe('the palettes', () => {
  it('gives every palette six colours, once each, and a name', () => {
    expect(PRINT_PALETTES.length).toBeGreaterThanOrEqual(12);
    expect(new Set(PRINT_PALETTES.map((p) => p.id)).size).toBe(PRINT_PALETTES.length);
    for (const palette of PRINT_PALETTES) {
      expect(palette.colours, palette.id).toHaveLength(MAX_PRINT_TONES);
      expect(new Set(palette.colours).size, palette.id).toBe(MAX_PRINT_TONES);
      expect(palette.name.length, palette.id).toBeGreaterThan(2);
      for (const hex of palette.colours) expect(hex, palette.id).toMatch(HEX);
    }
  });

  it('opens on a palette that exists, and falls back to one rather than to nothing', () => {
    expect(paletteById(PRINT_PALETTES[0].id)).not.toBeNull();
    expect(paletteById('palette_from_mars')).toBeNull();
    expect(paletteColours('palette_from_mars', [])).toEqual(PRINT_PALETTES[0].colours);
    expect(paletteName('palette_from_mars')).toBe(PRINT_PALETTES[0].name);
  });

  it('reads the designer’s own six when the custom shelf is picked', () => {
    const mine = ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666'];
    expect(paletteColours(CUSTOM_PALETTE, mine)).toEqual(mine);
    // An empty custom shelf still has to print something.
    expect(paletteColours(CUSTOM_PALETTE, [])).toEqual(PRINT_PALETTES[0].colours);
    expect(paletteName(CUSTOM_PALETTE)).not.toBe(PRINT_PALETTES[0].name);
    for (const hex of DEFAULT_PRINT_COLOURS) expect(hex).toMatch(HEX);
  });

  it('names every rule and every mode it offers', () => {
    expect(PRINT_MODES).toEqual(['none', 'triangles', 'image']);
    expect(PRINT_FITS).toEqual(['cover', 'contain', 'stretch']);
    for (const rule of PRINT_RULES) expect(PRINT_RULE_NAMES[rule], rule).toBeTruthy();
  });
});

describe('colour arithmetic', () => {
  it('knows a colour from anything else', () => {
    expect(isHex('#a1b2c3')).toBe(true);
    expect(isHex('#ABC')).toBe(false);
    expect(isHex('red')).toBe(false);
    expect(isHex(undefined)).toBe(false);
  });

  it('scales a colour without leaving sRGB', () => {
    expect(shadeHex('#808080', 1)).toBe('#808080');
    expect(shadeHex('#808080', 0.5)).toBe('#404040');
    // Clamped at both ends: a scaled colour is still a colour.
    expect(shadeHex('#ffffff', 4)).toBe('#ffffff');
    expect(shadeHex('#101010', -2)).toBe('#000000');
    expect(shadeHex('not a colour', 0.5)).toBe('not a colour');
  });

  it('reads white as bright and black as dark', () => {
    expect(luminance('#ffffff')).toBeCloseTo(1, 5);
    expect(luminance('#000000')).toBeCloseTo(0, 5);
    expect(luminance('#2f6fb5')).toBeLessThan(luminance('#f0a830'));
  });

  it('lights a facet by which way it faces, and only between 0 and 1', () => {
    for (const normal of [{ x: 1, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 0 }]) {
      const lit = facetLight(normal);
      expect(lit).toBeGreaterThanOrEqual(0);
      expect(lit).toBeLessThanOrEqual(1);
    }
    // The key light comes from above and to one side, so a facet facing it is
    // brighter than the one facing away.
    expect(facetLight({ x: 0.38, y: -0.66, z: 0.65 }))
      .toBeGreaterThan(facetLight({ x: -0.38, y: 0.66, z: -0.65 }));
  });
});

describe('the generator', () => {
  const facets = wall();

  it('gives every facet a colour, in the order the facets came in', () => {
    for (const rule of PRINT_RULES) {
      const fills = triangleFills(facets, options({ rule }));
      expect(fills, rule).toHaveLength(facets.length);
      for (const hex of fills) expect(hex, rule).toMatch(HEX);
    }
  });

  it('prints the same pot twice', () => {
    for (const rule of PRINT_RULES) {
      expect(triangleFills(facets, options({ rule })), rule)
        .toEqual(triangleFills(facets, options({ rule })));
    }
  });

  it('rerolls into another pot when the seed moves, for the rules that draw', () => {
    for (const rule of ['scatter', 'noise'] as PlanterPrintRule[]) {
      expect(triangleFills(facets, options({ rule, seed: 1 })), rule)
        .not.toEqual(triangleFills(facets, options({ rule, seed: 2 })));
    }
    // And leaves the ones that measure the facet alone: a gradient is a
    // gradient whatever integer is on the seed field.
    for (const rule of ['ramp', 'around', 'facet', 'harlequin'] as PlanterPrintRule[]) {
      expect(triangleFills(facets, options({ rule, seed: 1 })), rule)
        .toEqual(triangleFills(facets, options({ rule, seed: 77 })));
    }
  });

  it('leaves the bands below alone when a band is added on top', () => {
    // The whole reason the draw is a hash of the facet index rather than the
    // n-th value of a stream: a pot that came back approved must not re-colour
    // itself throughout because somebody added a row.
    const three = triangleFills(wall(6, 3), options());
    const four = triangleFills(wall(6, 4), options());
    expect(four.slice(0, three.length)).toEqual(three);
  });

  it('never reaches past the tones in play', () => {
    for (const rule of PRINT_RULES) {
      for (const tones of [2, 3, 4, 5, 6]) {
        const used = new Set(facets.map((facet) => toneIndex(facet, options({ rule, tones }))));
        for (const index of used) {
          expect(index, `${rule}/${tones}`).toBeGreaterThanOrEqual(0);
          expect(index, `${rule}/${tones}`).toBeLessThan(tones);
        }
      }
    }
  });

  it('asks for at least two colours however few it is given', () => {
    const single = facets.map((facet) => toneIndex(facet, options({ rule: 'scatter', tones: 1 })));
    expect(Math.max(...single)).toBe(1);
  });

  it('runs a gradient from the foot to the mouth', () => {
    const tall = wall(6, 6);
    const ramp = tall.map((facet) => toneIndex(facet, options({ rule: 'ramp', tones: 6 })));
    const perBand = 12;
    // Both ends of the palette are reached, at the ends of the pot. Not by the
    // first and last facet, though: the two triangles of a quad are staggered
    // half a step apart on purpose, so the boundary between two colours
    // zigzags along the facets instead of running round the pot as a stripe.
    expect(ramp.slice(0, perBand)).toContain(0);
    expect(ramp.slice(-perBand)).toContain(5);
    // Never backwards: each band reaches at least as far along the palette as
    // the one under it.
    for (let band = 1; band < 6; band += 1) {
      const below = Math.max(...ramp.slice((band - 1) * perBand, band * perBand));
      const here = Math.max(...ramp.slice(band * perBand, (band + 1) * perBand));
      expect(here, `band ${band}`).toBeGreaterThanOrEqual(below);
    }
  });

  it('puts the two triangles of a quad at opposite ends for harlequin', () => {
    const [up, down] = facets.slice(0, 2)
      .map((facet) => toneIndex(facet, options({ rule: 'harlequin', tones: 4 })));
    expect(up + down).toBe(3);
  });

  it('shades a fill without taking it out of the palette’s world', () => {
    const flat = triangleFills(facets, options({ shade: 0 }));
    const lit = triangleFills(facets, options({ shade: 100 }));
    expect(lit).not.toEqual(flat);
    for (let i = 0; i < flat.length; i += 1) {
      expect(lit[i]).toMatch(HEX);
      // Shading is relief, not repainting: it may not blow a colour out or
      // take it to black.
      expect(luminance(lit[i])).toBeGreaterThan(luminance(flat[i]) * 0.5 - 0.02);
      expect(luminance(lit[i])).toBeLessThan(luminance(flat[i]) * 1.3 + 0.02);
    }
  });
});

describe('the grout', () => {
  const triangle: [Vec2, Vec2, Vec2] = [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 0, y: 90 }];

  it('measures a triangle the way a triangle is measured', () => {
    expect(triangleArea(triangle)).toBeCloseTo(5400, 6);
    expect(trianglePerimeter(triangle)).toBeCloseTo(360, 6);
  });

  it('leaves the facet alone when nothing is held back', () => {
    expect(insetTriangle(triangle, 0)).toEqual(triangle);
  });

  it('takes the same distance off all three edges', () => {
    const inked = insetTriangle(triangle, 5) as [Vec2, Vec2, Vec2];
    expect(inked).not.toBeNull();
    // This triangle's inradius is 30, so a 5 mm hold-back leaves a similar
    // triangle at five sixths — exactly, which is the point of insetting about
    // the incentre rather than by pulling the corners in.
    expect(triangleArea(inked)).toBeCloseTo(5400 * (25 / 36), 6);
    expect(trianglePerimeter(inked)).toBeCloseTo(360 * (5 / 6), 6);
  });

  it('leaves a facet bare rather than printing a sliver of it', () => {
    expect(insetTriangle(triangle, 30)).toBeNull();
    expect(insetTriangle(triangle, 40)).toBeNull();
    expect(insetTriangle([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }], 1)).toBeNull();
  });

  it('holds the ink back by default, and caps how far it can be pushed', () => {
    expect(DEFAULT_GROUT).toBeGreaterThan(0);
    expect(DEFAULT_GROUT).toBeLessThan(MAX_GROUT);
  });
});

describe('the machine', () => {
  it('takes a standard composite sheet in one pass, either way round', () => {
    expect(PRINT_BED).toEqual({ width: 2500, height: 1300 });
    expect(printTiles(1220, 2440)).toBe(1);
    expect(printTiles(2440, 1220)).toBe(1);
  });

  it('tiles a nest the bed cannot take whole', () => {
    expect(printTiles(3000, 1200)).toBe(2);
    expect(printTiles(5000, 2600)).toBeGreaterThanOrEqual(4);
    expect(printTiles(0, 0)).toBe(0);
  });

  it('counts one pass per head: white, colour, varnish', () => {
    expect(printPasses(false, false)).toBe(1);
    expect(printPasses(true, false)).toBe(2);
    expect(printPasses(true, true)).toBe(3);
  });

  it('charges for the ink it actually lays down', () => {
    expect(printInkMl(0, true, true)).toBe(0);
    expect(printInkMl(-4, true, true)).toBe(0);
    // White is the expensive pass, and the run scales with the area.
    expect(printInkMl(1, true, false)).toBeGreaterThan(printInkMl(1, false, false) * 2);
    expect(printInkMl(2, true, true)).toBeCloseTo(printInkMl(1, true, true) * 2, 6);
  });

  it('charges for the bed even when there is almost nothing on it', () => {
    // Setup does not scale with the artwork: a tiny pot still has to be
    // loaded, registered and squared.
    expect(printMinutes(0, 3, 1)).toBeGreaterThan(0);
    expect(printMinutes(1, 3, 2)).toBeGreaterThan(printMinutes(1, 3, 1));
    expect(printMinutes(2, 1, 1)).toBeGreaterThan(printMinutes(1, 1, 1));
  });

  it('weighs the film, and weighs almost nothing', () => {
    expect(printKg(1, 3)).toBeGreaterThan(0);
    expect(printKg(1, 3)).toBeLessThan(0.1);
    expect(printKg(0, 3)).toBe(0);
  });
});
