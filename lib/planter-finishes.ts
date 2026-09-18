import * as THREE from 'three';

/**
 * The pot's surface finish for the 3D preview only — independent of the
 * fabrication `MaterialId`, which stays about the stock sheet (thickness,
 * bend radius, groove depth). A shop panel can be painted or mirror-polished
 * in any of these regardless of what it is cut from.
 */
export interface PlanterFinish {
  id: string;
  name: string;
  metalness: number;
  roughness: number;
  color: string;
  /** True for the one entry whose colour the user picks freely. */
  custom?: boolean;
}

export const PLANTER_FINISHES: PlanterFinish[] = [
  { id: 'silver-mirror', name: 'Silver mirror', metalness: 1, roughness: 0.08, color: '#e7ebef' },
  { id: 'gold-mirror', name: 'Gold mirror', metalness: 1, roughness: 0.1, color: '#e8c26a' },
  { id: 'silver-matte', name: 'Silver matte', metalness: 0.9, roughness: 0.42, color: '#c7ccd2' },
  { id: 'white-matte', name: 'White matte', metalness: 0, roughness: 0.48, color: '#eef1f3' },
  { id: 'black-matte', name: 'Black matte', metalness: 0, roughness: 0.46, color: '#17181c' },
  { id: 'custom', name: 'Custom colour', metalness: 0.2, roughness: 0.4, color: '#c0392b', custom: true },
];

export const finishById = (id: string): PlanterFinish => PLANTER_FINISHES.find((f) => f.id === id) ?? PLANTER_FINISHES[0];

/** A photo backdrop for the 3D preview — the room the pot is shot in. */
export interface PlanterBackdrop {
  id: string;
  name: string;
  top: string;
  bottom: string;
  /** Contact-shadow strength that reads right against this backdrop. */
  shadow: number;
}

export const PLANTER_BACKDROPS: PlanterBackdrop[] = [
  { id: 'studio-dark', name: 'Dark studio', top: '#242832', bottom: '#0a0b10', shadow: 0.55 },
  { id: 'studio-light', name: 'Light studio', top: '#f1f3f6', bottom: '#c9ced5', shadow: 0.3 },
  { id: 'sky', name: 'Outdoor', top: '#5f8fd0', bottom: '#dbe6f0', shadow: 0.4 },
];

export const backdropById = (id: string): PlanterBackdrop => PLANTER_BACKDROPS.find((b) => b.id === id) ?? PLANTER_BACKDROPS[0];

/** A vertical two-tone gradient, for the visible backdrop behind the pot. */
export function gradientTexture(backdrop: PlanterBackdrop): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, backdrop.top);
  gradient.addColorStop(0.55, backdrop.top);
  gradient.addColorStop(0.85, backdrop.bottom);
  gradient.addColorStop(1, backdrop.bottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 4, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
