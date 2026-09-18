import { describe, expect, it } from 'vitest';
import {
  getLedEffect, hexToHsl, hslToRgb, LED_BASE_COLOURS, LED_EFFECTS, ledThrow, pixelColor, pixelSeed,
  type Hsl, type PlanterLedEffect,
} from './planter-led-effects';

const BASE: Hsl = [0.52, 0.95, 0.55];
/** A coarse sweep of the pot and of the clock — enough to catch a mode misbehaving. */
const SAMPLES: [number, number][] = [];
for (let u = 0; u < 1; u += 0.125) for (let v = 0; v <= 1; v += 0.25) SAMPLES.push([u, v]);
const TIMES = [0, 0.13, 0.37, 0.5, 0.94, 1.7, 4.2, 17.3];
const ALL = LED_EFFECTS.map((spec) => spec.id);

describe('effect catalogue', () => {
  it('offers the same twenty modes as the neon configurator, plus a solid colour', () => {
    expect(ALL).toHaveLength(21);
    expect(new Set(ALL).size).toBe(21);
    expect(ALL[0]).toBe('static');
  });

  it('gives every mode an honest duty and a tempo', () => {
    for (const spec of LED_EFFECTS) {
      expect(spec.duty).toBeGreaterThan(0);
      expect(spec.duty).toBeLessThanOrEqual(1);
      expect(spec.tempo).toBeGreaterThanOrEqual(0);
    }
    // A solid colour is every pixel, all the time, and it does not move.
    expect(getLedEffect('static').duty).toBe(1);
    expect(getLedEffect('static').tempo).toBe(0);
    // A strobe is mostly off, so it is the cheapest thing on the list.
    expect(getLedEffect('strobe').duty).toBeLessThan(getLedEffect('chase').duty);
  });

  it('falls back to a solid colour rather than throwing on an unknown mode', () => {
    expect(getLedEffect('disco' as PlanterLedEffect).id).toBe('static');
  });
});

describe('pixel colour', () => {
  it('stays inside the gamut for every mode, everywhere, at every time', () => {
    for (const effect of ALL) {
      for (const [u, v] of SAMPLES) {
        for (const t of TIMES) {
          const rgb = pixelColor(effect, u, v, t, BASE);
          expect(rgb).toHaveLength(3);
          for (const channel of rgb) {
            expect(Number.isFinite(channel)).toBe(true);
            expect(channel).toBeGreaterThanOrEqual(0);
            expect(channel).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it('holds a solid colour still however long you watch it', () => {
    const first = pixelColor('static', 0.3, 0.6, 0, BASE);
    for (const t of TIMES) {
      expect(pixelColor('static', 0.3, 0.6, t, BASE)).toEqual(first);
    }
  });

  it('actually animates every mode that claims to', () => {
    for (const spec of LED_EFFECTS) {
      if (spec.tempo === 0) continue;
      // Somewhere on the pot, this mode looks different at a different moment.
      const moves = SAMPLES.some(([u, v]) => TIMES.some((t) => {
        const now = pixelColor(spec.id, u, v, 0, BASE);
        const later = pixelColor(spec.id, u, v, t, BASE);
        return now.some((channel, i) => Math.abs(channel - later[i]) > 0.02);
      }));
      expect(moves, `${spec.id} never changes`).toBe(true);
    }
  });

  it('gives the pot more than one colour at a time where the mode is about place', () => {
    // A chase, a comet and a scanner are patterns in space: at any instant the
    // near side and the far side of the pot must not match, or it is a lamp.
    for (const effect of ['chase', 'comet', 'scanner', 'rainbow', 'police'] as const) {
      const spread = SAMPLES.map(([u, v]) => pixelColor(effect, u, v, 0.3, BASE).join(','));
      expect(new Set(spread).size, effect).toBeGreaterThan(1);
    }
  });

  it('builds the colour modes on the colour picked and the spectrum ones on the spectrum', () => {
    const warm: Hsl = [0.08, 0.95, 0.55];
    const cold: Hsl = [0.55, 0.95, 0.55];
    const differs = (effect: PlanterLedEffect) => SAMPLES.some(([u, v]) => {
      const a = pixelColor(effect, u, v, 0.2, warm);
      const b = pixelColor(effect, u, v, 0.2, cold);
      return a.some((channel, i) => Math.abs(channel - b[i]) > 0.05);
    });
    for (const effect of ['static', 'chase', 'comet', 'breathe', 'wave'] as const) {
      expect(differs(effect), effect).toBe(true);
    }
    // A rainbow is the whole wheel; asking it for a base colour is meaningless.
    expect(differs('rainbow')).toBe(false);
  });

  it('keeps fire on the warm side of the wheel', () => {
    for (const [u, v] of SAMPLES) {
      for (const t of TIMES) {
        const [r, g, b] = pixelColor('fire', u, v, t, BASE);
        expect(r).toBeGreaterThanOrEqual(g - 1e-9);
        expect(g).toBeGreaterThanOrEqual(b - 1e-9);
      }
    }
  });

  it('gives each pixel its own steady luck, so twinkling is not just noise', () => {
    const a = pixelSeed(0.3, 0.7);
    expect(pixelSeed(0.3, 0.7)).toBe(a);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
    expect(pixelSeed(0.31, 0.7)).not.toBe(a);
  });
});

describe('colour conversion', () => {
  it('round-trips every base colour on the toolbar', () => {
    for (const hex of LED_BASE_COLOURS) {
      const [r, g, b] = hslToRgb(hexToHsl(hex));
      const back = `#${[r, g, b].map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`;
      expect(back).toBe(hex);
    }
  });

  it('renders a half-typed colour as something rather than as black', () => {
    const [h, s, l] = hexToHsl('#12');
    expect(Number.isFinite(h + s + l)).toBe(true);
    expect(l).toBeGreaterThan(0);
  });

  it('handles grey, where hue is undefined', () => {
    expect(hexToHsl('#808080')[1]).toBe(0);
    expect(hslToRgb([0, 0, 0.5])).toEqual([0.5, 0.5, 0.5]);
  });
});

describe('where the strip is mounted', () => {
  it('throws its light the way it is pointed', () => {
    // Under the collar facing down: brightest at the rim, faint at the foot.
    expect(ledThrow('rim', 1)).toBeGreaterThan(ledThrow('rim', 0));
    // On the base facing up: the other way round.
    expect(ledThrow('foot', 0)).toBeGreaterThan(ledThrow('foot', 1));
    // Facing the wall from the soil box: the same everywhere.
    expect(ledThrow('wall', 0)).toBe(ledThrow('wall', 1));
    expect(ledThrow('rim', 1)).toBeCloseTo(ledThrow('foot', 0), 9);
  });

  it('never goes dark and never goes over full', () => {
    for (const position of ['rim', 'wall', 'foot'] as const) {
      for (let v = -0.5; v <= 1.5; v += 0.1) {
        const reach = ledThrow(position, v);
        expect(reach).toBeGreaterThan(0);
        expect(reach).toBeLessThanOrEqual(1);
      }
    }
  });
});
