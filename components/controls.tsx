'use client';

import { AlertTriangle, Info, XCircle } from 'lucide-react';
import { useId, useMemo } from 'react';
import {
  flapSlit, foldFacet, gridFacet, perforateFacet, scatterFacet, shardFacet,
  type PerforationSpec, type Triangle2,
} from '@/lib/planter-perforation';
import type { FabricationCheck, Vec2 } from '@/lib/types';

export function NumberField({ label, value, suffix, onChange, min, max }: {
  label: string; value: number; suffix: string; onChange: (value: number) => void; min?: number; max?: number;
}) {
  const id = useId();
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}><span>{label}</span><strong>{suffix}</strong></label>
      <input id={id} type="number" value={value} min={min} max={max} onChange={(event) => onChange(Number(event.target.value) || 0)} />
    </div>
  );
}

export function SliderField({ label, value, min, max, step, suffix, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}><span>{label}</span></label>
      <div className="range-wrap">
        <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
        <span className="range-value tech-data">{value}{suffix}</span>
      </div>
    </div>
  );
}

/**
 * One facet, drawn with the pattern the button would cut into it.
 *
 * Drawn by the generator itself rather than by hand, so the swatch cannot come
 * to disagree with the wall: pick the one that looks right and the wall gets
 * exactly that, subdivision for subdivision and rounded corner for rounded
 * corner. The numbers are in swatch units, proportioned like a real facet.
 */
const SWATCH_FACET: Triangle2 = [{ x: 3, y: 33 }, { x: 37, y: 33 }, { x: 20, y: 4 }];

const subpath = (points: { x: number; y: number }[]) =>
  `M${points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join('L')}Z`;

/** Which generator draws a swatch, by the same names the parameters use. */
const SWATCH_PATTERN: Record<string, (tri: Triangle2, spec: PerforationSpec) => {
  cells: Vec2[][]; flaps?: Triangle2[];
}> = {
  triangles: perforateFacet, shards: shardFacet, dots: scatterFacet, grid: gridFacet,
  foldout: foldFacet,
};

export function PatternSwatch({ density, opening = 0.18, family = 'triangles', picked = 0 }: {
  density: number; opening?: number; family?: string; picked?: number;
}) {
  // One path, even-odd filled: the cells are subpaths inside the facet, so they
  // punch through it and the button's own background shows where the wall is
  // open. Drawing them as filled marks instead would show the pattern the wrong
  // way round — solid where the wall is a hole.
  const d = useMemo(() => {
    if (density < 1) return { face: subpath(SWATCH_FACET), slits: '' };
    const draw = SWATCH_PATTERN[family] ?? perforateFacet;
    const { cells, flaps } = draw(SWATCH_FACET, { density, opening, picked, web: 1.2, margin: 2.4, tool: 0.7 });
    return {
      face: [SWATCH_FACET, ...cells].map(subpath).join(''),
      // A petal is not a hole. Filling its outline would show a void where the
      // wall is still solid, so the swatch draws the two edges that are really
      // severed and leaves the third — the hinge — alone.
      slits: (flaps ?? []).map((flap) => `M${flapSlit(flap, 0.7)
        .map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join('L')}`).join(''),
    };
  }, [density, opening, family, picked]);

  return (
    <svg className="swatch" viewBox="0 0 40 37" aria-hidden="true">
      <path className="swatch-face" d={d.face} fillRule="evenodd" />
      {d.slits && <path className="swatch-slit" d={d.slits} />}
    </svg>
  );
}

export interface PatternOption {
  /** Facet subdivision. 0 is the "leave it solid" button. */
  density: number;
  label: string;
}

/**
 * The size picker for the cut-outs. Each button is the pattern it produces,
 * biggest opening first, so the row reads as a set of sizes rather than as a
 * number whose direction has to be learned.
 */
export function PatternPicker({ label, value, options, opening, family, picked, onChange }: {
  label: string;
  value: number;
  options: PatternOption[];
  /** The share of each cell being cut, 0–1, so the swatch shows what you get. */
  opening: number;
  /** Which pattern family the swatches should draw. */
  family?: string;
  /** Cells cut per facet, so the swatch shows "six of the thirty-six" too. */
  picked?: number;
  onChange: (density: number) => void;
}) {
  return (
    <div className="pattern-picker" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          type="button"
          key={option.density}
          className={`pattern-option ${value === option.density ? 'active' : ''}`}
          aria-pressed={value === option.density}
          onClick={() => onChange(option.density)}
        >
          <PatternSwatch density={option.density} opening={opening} family={family} picked={picked} />
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

const CHECK_ICON = { error: XCircle, warning: AlertTriangle, info: Info } as const;

export function CheckList({ checks }: { checks: FabricationCheck[] }) {
  return (
    <ul className="check-list">
      {checks.map((check) => {
        const Icon = CHECK_ICON[check.severity];
        return (
          <li key={check.id} className={`check check-${check.severity}`}>
            <Icon size={14} aria-hidden="true" />
            <div><strong>{check.title}</strong><p>{check.detail}</p></div>
          </li>
        );
      })}
    </ul>
  );
}
