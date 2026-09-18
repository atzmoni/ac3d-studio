import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import type { DraftMark } from '@/lib/planter-drafting';
import type { PlanterModel, Vec2 } from '@/lib/types';

/**
 * The print, on the preview.
 *
 * A folded pot has no sensible UV unwrap — which is why the stone finish is
 * sampled triplanar and never unwrapped at all. The print is the one thing on
 * this pot that does have one, and it is not a compromise: the panel is
 * printed FLAT, so the developed net is not merely a good unwrap, it is the
 * artwork's own coordinate system. A pixel at (x, y) on the net is the pixel
 * the head lays down at (x, y) on the bed.
 *
 * So the preview does what the bed does. The imported image and the drafting
 * layer are drawn into one canvas in net millimetres, and the wall carries UVs
 * taken straight off `flatByBand`. What you turn round on screen is the print
 * file wrapped onto the solid it folds into, not an impression of it.
 */

export interface ArtworkBox { minX: number; minY: number; maxX: number; maxY: number }

/**
 * The developed wall's own box in sheet millimetres.
 *
 * The wall alone, not the nest: the base and the collar are separate parts
 * printed flat, and fitting a customer's photograph to the bounding box of a
 * nest would put most of it on parts nobody ever sees.
 */
export function wallNetBox(model: PlanterModel): ArtworkBox {
  const box: ArtworkBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const band of model.flatByBand) {
    for (const ring of band) {
      for (const point of ring) {
        box.minX = Math.min(box.minX, point.x);
        box.minY = Math.min(box.minY, point.y);
        box.maxX = Math.max(box.maxX, point.x);
        box.maxY = Math.max(box.maxY, point.y);
      }
    }
  }
  if (!Number.isFinite(box.minX)) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return box;
}

/** Net millimetres to the 0–1 the wall's UV attribute carries. */
export const netUv = (point: Vec2, box: ArtworkBox): [number, number] => [
  (point.x - box.minX) / Math.max(box.maxX - box.minX, 1e-6),
  (point.y - box.minY) / Math.max(box.maxY - box.minY, 1e-6),
];

export interface ArtworkLook {
  /** The imported artwork as a data URL, or empty for none. */
  image: string;
  fit: 'cover' | 'contain' | 'stretch';
  /** The drafting layer. Empty when it is switched off. */
  marks: DraftMark[];
  ink: string;
  /** Line weight, in the same millimetres as the marks. */
  weight: number;
  box: ArtworkBox;
}

/** Pixels per millimetre, and the largest canvas we are willing to build. */
const MAX_TEXTURE = 2048;

function drawMarks(ctx: CanvasRenderingContext2D, look: ArtworkLook, px: number, height: number) {
  const { marks, box } = look;
  // Net y runs up the sheet and a canvas y runs down it, so the flip happens
  // once, here, and every mark below is drawn in plain net millimetres.
  const X = (x: number) => (x - box.minX) * px;
  const Y = (y: number) => height - (y - box.minY) * px;

  ctx.strokeStyle = look.ink;
  ctx.fillStyle = look.ink;
  ctx.lineWidth = Math.max(1, look.weight * px);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const mark of marks) {
    ctx.setLineDash('dashed' in mark && mark.dashed ? [look.weight * 6 * px, look.weight * 4 * px] : []);
    ctx.beginPath();
    switch (mark.kind) {
      case 'circle':
        ctx.arc(X(mark.x), Y(mark.y), mark.r * px, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case 'line':
        ctx.moveTo(X(mark.x1), Y(mark.y1));
        ctx.lineTo(X(mark.x2), Y(mark.y2));
        ctx.stroke();
        break;
      case 'arc':
        // The flip turns an anticlockwise sweep into a clockwise one, so the
        // angles are negated and the arc is drawn the same way round it was
        // described — otherwise every arc takes the long route.
        ctx.arc(X(mark.x), Y(mark.y), mark.r * px, -mark.from, -mark.to, true);
        ctx.stroke();
        break;
      case 'path':
        mark.points.forEach((point, i) => {
          if (i === 0) ctx.moveTo(X(point.x), Y(point.y)); else ctx.lineTo(X(point.x), Y(point.y));
        });
        if (mark.closed) ctx.closePath();
        ctx.stroke();
        break;
      case 'text':
      default:
        ctx.setLineDash([]);
        ctx.font = `${Math.max(7, mark.size * px)}px ui-monospace, monospace`;
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(mark.text, X(mark.x), Y(mark.y));
        break;
    }
  }
  ctx.setLineDash([]);
}

/** Where a picture lands on the net, in canvas pixels, for each of the three fits. */
function imageBox(
  image: HTMLImageElement, fit: ArtworkLook['fit'], width: number, height: number,
): [number, number, number, number] {
  if (fit === 'stretch' || image.width <= 0 || image.height <= 0) return [0, 0, width, height];
  const scale = fit === 'cover'
    ? Math.max(width / image.width, height / image.height)
    : Math.min(width / image.width, height / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  return [(width - w) / 2, (height - h) / 2, w, h];
}

/**
 * One canvas texture carrying everything printed over the flat fills.
 *
 * Transparent wherever nothing is printed, so it sits over the facet colours
 * as a decal rather than replacing them — white line work cannot be done by
 * multiplying a base colour, and multiplying is all one material can do.
 *
 * Nothing suspends. The pot renders with its fills from the first frame and
 * the artwork drops in once the image has decoded; suspending would blank the
 * whole viewport — pot, plant and backdrop — every time somebody picked a
 * different file.
 */
export function useArtworkTexture(look: ArtworkLook | null): THREE.CanvasTexture | null {
  const [loaded, setLoaded] = useState<HTMLImageElement | null>(null);
  const source = look?.image ?? '';

  useEffect(() => {
    if (!source) { setLoaded(null); return undefined; }
    let live = true;
    const image = new Image();
    image.onload = () => { if (live) setLoaded(image); };
    image.onerror = () => { if (live) setLoaded(null); };
    image.src = source;
    return () => { live = false; };
  }, [source]);

  const texture = useMemo(() => {
    if (!look || typeof document === 'undefined') return null;
    if (look.marks.length === 0 && !loaded) return null;

    const spanX = Math.max(look.box.maxX - look.box.minX, 1);
    const spanY = Math.max(look.box.maxY - look.box.minY, 1);
    const px = Math.min(2, MAX_TEXTURE / Math.max(spanX, spanY));
    const width = Math.max(2, Math.round(spanX * px));
    const height = Math.max(2, Math.round(spanY * px));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    if (loaded) ctx.drawImage(loaded, ...imageBox(loaded, look.fit, width, height));
    if (look.marks.length > 0) drawMarks(ctx, look, px, height);

    const made = new THREE.CanvasTexture(canvas);
    made.colorSpace = THREE.SRGBColorSpace;
    made.anisotropy = 8;
    // The net is the whole artwork; anything outside it is bare panel, and a
    // repeated edge pixel there would read as a smear off the end of the wall.
    made.wrapS = THREE.ClampToEdgeWrapping;
    made.wrapT = THREE.ClampToEdgeWrapping;
    return made;
  }, [look, loaded]);

  useEffect(() => () => { texture?.dispose(); }, [texture]);

  return texture;
}
