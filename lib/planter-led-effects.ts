/**
 * What an addressable strip does with its pixels.
 *
 * This is the one part of the lighting kit that never touches a cut line. The
 * flat file is identical whichever mode is chosen — the mode lives in the
 * controller, and what it changes here is the preview, the power budget and the
 * line in the shop notes that tells whoever flashes the controller what to load.
 *
 * Every mode is a pure function of where a pixel is and what time it is, so the
 * preview and the numbers can never disagree: `u` runs 0–1 the long way round
 * the pot, `v` runs 0–1 from the foot to the rim, and `t` is seconds that have
 * already been scaled by the speed the studio is set to. Nothing in here knows
 * about three.js, React or Hebrew.
 *
 * The mode list is deliberately the same twenty the neon configurator offers,
 * under the same names: somebody who has seen one of these products should not
 * have to learn a second vocabulary for the other.
 */

const frac = (value: number): number => value - Math.floor(value);
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export type PlanterLedEffect =
  | 'static' | 'chase' | 'rainbow' | 'breathe' | 'twinkle' | 'wipe' | 'fire'
  | 'strobe' | 'comet' | 'theater' | 'pulse' | 'wave' | 'scanner' | 'sparkle'
  | 'gradient' | 'blink' | 'decay' | 'bounce' | 'ripple' | 'flicker' | 'police';

/**
 * Where the strip is mounted, and therefore which way the light leaves it.
 *
 * Not a detail: it decides how long the strip is, how the wall is lit and how
 * hard the thing is to service. `rim` tucks it up under the collar facing down,
 * which grazes the wall from above and can be reached from the top without
 * disturbing the planting. `foot` stands it on the base facing up, which throws
 * the light the other way and puts it where the water ends up. `wall` bonds it
 * to the outside face of the soil box looking straight at the cut-outs, which
 * is the brightest of the three and the one that comes out with the box.
 */
export type PlanterLedPosition = 'rim' | 'wall' | 'foot';

/**
 * How much of the strip's light reaches height `v`, 0–1.
 *
 * A strip aimed along the wall lights what is near it and gives up further
 * away; one aimed at the wall lights all of it. This is the difference between
 * three renders that would otherwise be identical, and it is the same falloff
 * the mounting note describes, so the two cannot disagree.
 */
export function ledThrow(position: PlanterLedPosition, v: number): number {
  if (position === 'rim') return 0.26 + 0.74 * clamp01(v);
  if (position === 'foot') return 0.26 + 0.74 * (1 - clamp01(v));
  return 1;
}

export interface LedEffectSpec {
  id: PlanterLedEffect;
  /** What it is called on a drawing and in the English studio. */
  name: string;
  /**
   * Average share of full output the mode actually burns, 0–1.
   *
   * A chase lights a third of the strip at a time and a comet rather less; a
   * solid colour lights all of it. This is what a night actually costs, so it
   * scales the running draw, the battery and the solar runtime — and it is
   * deliberately kept away from `peakWatts`, the supply and the wiring, which
   * still have to survive every pixel coming on white at once. A driver sized
   * for a comet is a driver that browns out the first time somebody asks the
   * controller for white.
   */
  duty: number;
  /** How fast this one wants to run, relative to the speed slider. */
  tempo: number;
}

/** In the order the toolbar shows them, matching the neon configurator. */
export const LED_EFFECTS: LedEffectSpec[] = [
  { id: 'static', name: 'Solid colour', duty: 1, tempo: 0 },
  { id: 'chase', name: 'Colour chase', duty: 0.34, tempo: 1 },
  { id: 'rainbow', name: 'Flowing rainbow', duty: 1, tempo: 0.5 },
  { id: 'breathe', name: 'Breathe', duty: 0.5, tempo: 0.4 },
  { id: 'twinkle', name: 'Twinkle', duty: 0.3, tempo: 1.2 },
  { id: 'wipe', name: 'Wipe', duty: 0.5, tempo: 0.45 },
  { id: 'fire', name: 'Fire', duty: 0.45, tempo: 2.2 },
  { id: 'strobe', name: 'Strobe', duty: 0.12, tempo: 6 },
  { id: 'comet', name: 'Comet', duty: 0.18, tempo: 1 },
  { id: 'theater', name: 'Stage lights', duty: 0.34, tempo: 3 },
  { id: 'pulse', name: 'Heartbeat', duty: 0.3, tempo: 1 },
  { id: 'wave', name: 'Wave', duty: 0.5, tempo: 0.6 },
  { id: 'scanner', name: 'Scanner', duty: 0.2, tempo: 0.8 },
  { id: 'sparkle', name: 'Sparkle', duty: 0.22, tempo: 3 },
  { id: 'gradient', name: 'Colour fade', duty: 1, tempo: 0.3 },
  { id: 'blink', name: 'Blink', duty: 0.5, tempo: 1.5 },
  { id: 'decay', name: 'Decay', duty: 0.35, tempo: 0.7 },
  { id: 'bounce', name: 'Bounce', duty: 0.25, tempo: 1.4 },
  { id: 'ripple', name: 'Ripples', duty: 0.45, tempo: 0.9 },
  { id: 'flicker', name: 'Flicker', duty: 0.7, tempo: 5 },
  { id: 'police', name: 'Police', duty: 0.5, tempo: 2.5 },
];

/**
 * Base colours worth one click.
 *
 * Six that an addressable strip renders cleanly and that suit a pot after dark
 * — the picker beside them takes anything else. Saturated primaries are here
 * because that is what these emitters are actually good at; a pastel asks the
 * strip for a mix it renders as a wash.
 */
export const LED_BASE_COLOURS = ['#28d8ff', '#ff3b6b', '#ffc46b', '#5dff8f', '#b46bff', '#ffffff'];

const BY_ID = new Map(LED_EFFECTS.map((spec) => [spec.id, spec]));

/** The mode's spec, falling back to a solid colour for anything unrecognised. */
export const getLedEffect = (id: PlanterLedEffect): LedEffectSpec => BY_ID.get(id) ?? LED_EFFECTS[0];

export type Rgb = [number, number, number];
/** Hue, saturation, lightness, each 0–1. */
export type Hsl = [number, number, number];

/**
 * A stable pseudo-random value for a pixel, 0–1.
 *
 * The twinkling modes need each pixel to keep its own character between frames
 * — a pixel that redraws its luck sixty times a second is not twinkling, it is
 * noise. Hashing the position rather than counting pixels also means the effect
 * survives a change to the cut-out pattern without rearranging itself.
 */
export function pixelSeed(u: number, v: number): number {
  return frac(Math.sin(u * 127.1 + v * 311.7) * 43758.5453);
}

/** HSL to RGB, all channels 0–1. */
export function hslToRgb([h, s, l]: Hsl): Rgb {
  const light = clamp01(l);
  const saturation = clamp01(s);
  if (saturation <= 0) return [light, light, light];
  const q = light < 0.5 ? light * (1 + saturation) : light + saturation - light * saturation;
  const p = 2 * light - q;
  const channel = (offset: number) => {
    const shifted = frac(h + offset);
    if (shifted < 1 / 6) return p + (q - p) * 6 * shifted;
    if (shifted < 1 / 2) return q;
    if (shifted < 2 / 3) return p + (q - p) * (2 / 3 - shifted) * 6;
    return p;
  };
  return [channel(1 / 3), channel(0), channel(-1 / 3)];
}

/** `#rrggbb` to HSL, so a mode can shift the hue of the colour that was picked. */
export function hexToHsl(hex: string): Hsl {
  const clean = String(hex).replace('#', '').trim();
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  // A half-typed colour out of a text field is not a reason to render black.
  if (!Number.isFinite(r + g + b)) return [0.5, 0.95, 0.55];

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const span = max - min;
  if (span < 1e-6) return [0, 0, l];
  const s = l > 0.5 ? span / (2 - max - min) : span / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / span + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / span + 2) / 6;
  else h = ((r - g) / span + 4) / 6;
  return [h, s, l];
}

/** Dim a colour without washing it out — lightness scales, saturation holds. */
const dim = ([h, s, l]: Hsl, level: number): Hsl => [h, s, l * clamp01(level)];

/**
 * One pixel of one mode at one instant, as RGB 0–1.
 *
 * `u` is the way round the pot, `v` the way up it, `t` seconds already scaled
 * by the studio's speed. `base` is the colour that was picked, which the modes
 * that are about a colour use and the modes that are about the spectrum ignore.
 */
export function pixelColor(
  effect: PlanterLedEffect,
  u: number,
  v: number,
  t: number,
  base: Hsl,
): Rgb {
  const [hue, saturation] = base;
  const lit: Hsl = [hue, saturation, Math.max(0.55, base[2])];
  const seed = pixelSeed(u, v);

  switch (effect) {
    case 'rainbow':
      // The spectrum laid round the pot and turned. One full cycle per lap, so
      // every side is a different colour and the seam never shows.
      return hslToRgb([frac(u + t), 0.95, 0.58]);

    case 'gradient': {
      // The same idea held down to a band either side of the colour picked, so
      // it reads as one colour breathing through its neighbours.
      const drift = Math.sin((u - t) * Math.PI * 2) * 0.12;
      return hslToRgb([frac(hue + drift), saturation, 0.58]);
    }

    case 'chase': {
      // Six lit blocks running round. Off is not black: an unlit pixel beside a
      // lit one still catches light through the same opening.
      return hslToRgb(dim(lit, frac(u * 6 - t) < 0.34 ? 1 : 0.07));
    }

    case 'theater': {
      // Every third pixel, stepping one place at a time — the marquee.
      const step = Math.floor(t * 3) % 3;
      return hslToRgb(dim(lit, (Math.floor(u * 24) + step) % 3 === 0 ? 1 : 0.05));
    }

    case 'comet': {
      // A head with a tail decaying behind it, once round per cycle.
      return hslToRgb(dim(lit, Math.exp(-frac(t - u) * 7)));
    }

    case 'scanner': {
      // Larson: a head sweeping there and back rather than wrapping round.
      const head = 0.5 - 0.5 * Math.cos(t * Math.PI * 2);
      const gap = Math.abs(u - head);
      const reach = Math.min(gap, 1 - gap);
      return hslToRgb(dim(lit, Math.exp(-(reach * reach) * 160)));
    }

    case 'bounce': {
      // A block thrown up the wall and falling back, with the pause at the top.
      const height = Math.abs(Math.sin(t * Math.PI));
      return hslToRgb(dim(lit, Math.abs(v - height) < 0.14 ? 1 : 0.05));
    }

    case 'wave':
      // A swell climbing the pot, so the pattern reads foot to rim rather than
      // round it — on a tall planter that is the more natural direction.
      return hslToRgb(dim(lit, 0.12 + 0.88 * (0.5 + 0.5 * Math.sin((v * 1.6 - t) * Math.PI * 2))));

    case 'ripple': {
      // Rings leaving a point that drifts round the pot, as if something keeps
      // being dropped into it.
      const source = frac(t * 0.13);
      const gap = Math.abs(u - source);
      const reach = Math.min(gap, 1 - gap);
      const distance = Math.hypot(reach * 2, v - 0.5);
      return hslToRgb(dim(lit, 0.1 + 0.9 * Math.max(0, Math.sin((distance * 5 - t) * Math.PI * 2))));
    }

    case 'wipe': {
      // A front sweeping round, painting a new hue behind it each pass.
      const pass = Math.floor(t);
      const done = u < frac(t);
      return hslToRgb([frac(hue + (done ? pass + 1 : pass) * 0.17), saturation, 0.58]);
    }

    case 'breathe':
      return hslToRgb(dim(lit, 0.08 + 0.92 * (0.5 - 0.5 * Math.cos(t * Math.PI * 2))));

    case 'pulse': {
      // Two quick beats and a rest, which is what a heart actually does.
      const beat = frac(t);
      const level = Math.exp(-beat * 14) + 0.65 * Math.exp(-Math.abs(beat - 0.22) * 18);
      return hslToRgb(dim(lit, Math.min(1, level)));
    }

    case 'blink':
      return hslToRgb(dim(lit, frac(t) < 0.5 ? 1 : 0.04));

    case 'strobe':
      // Hard on, hard off, and mostly off — the only mode here that is a flash
      // rather than a fade.
      return hslToRgb(dim(lit, frac(t) < 0.12 ? 1 : 0));

    case 'decay':
      // Full, then falling away to nothing, then full again.
      return hslToRgb(dim(lit, Math.exp(-frac(t) * 3.2)));

    case 'twinkle': {
      // Each pixel keeps its own phase, so they come up and go down out of step.
      const phase = frac(t * 0.5 + seed);
      return hslToRgb(dim(lit, 0.06 + 0.94 * Math.pow(Math.max(0, Math.sin(phase * Math.PI)), 3)));
    }

    case 'sparkle': {
      // A dim wash with the occasional white grain on top of it.
      const strike = frac(t * 0.7 + seed * 7.3);
      const flash = strike > 0.94 ? (strike - 0.94) / 0.06 : 0;
      const [r, g, b] = hslToRgb(dim(lit, 0.16));
      return [Math.min(1, r + flash), Math.min(1, g + flash), Math.min(1, b + flash)];
    }

    case 'flicker': {
      // A tube on its way out: mostly there, dropping out at random. The time
      // is quantised so it stutters rather than shimmers.
      const jitter = pixelSeed(seed, Math.floor(t * 12) / 12);
      return hslToRgb(dim(lit, 0.45 + 0.55 * jitter));
    }

    case 'fire': {
      // Hot and bright low down, cooling and thinning as it rises. The palette
      // runs red through amber and never reaches the green side of the wheel,
      // which is the difference between a fire and a fairground.
      const lick = pixelSeed(u * 3, Math.floor(t * 4) / 4 + v);
      const heat = clamp01((1 - v) * 0.85 + lick * 0.45 - 0.15);
      return hslToRgb([0.02 + heat * 0.09, 1, 0.12 + heat * 0.46]);
    }

    case 'police': {
      // Two halves, red and blue, swapping — and dark between the swaps, which
      // is what makes it read as a beacon rather than as two lamps.
      const swapped = frac(t) < 0.5;
      const side = u < 0.5;
      return hslToRgb([side === swapped ? 0 : 0.62, 1, frac(t * 4) < 0.55 ? 0.55 : 0.05]);
    }

    case 'static':
    default:
      return hslToRgb(lit);
  }
}
