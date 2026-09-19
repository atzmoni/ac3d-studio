'use client';

import { AlertTriangle, Info, XCircle } from 'lucide-react';
import { useId, useMemo } from 'react';
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
