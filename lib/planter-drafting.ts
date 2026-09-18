/**
 * The drawing, printed on the thing it is a drawing of.
 *
 * A second print layer, over the flat facet colours: protractor circles on the
 * net's own vertices, angle arcs, a right-triangle glyph on the facets, and
 * dimension callouts. On a blueprint palette it reads as a blueprint; on the
 * carnival one it reads as a schoolroom model of a solid.
 *
 * The whole point is that none of it is decoration invented for the pot. Every
 * number on it is this pot's own: the diameter callout at a vertex is that
 * ring's real across-corners diameter, the R beside a facet is that facet's
 * own shortest edge. What is printed on the object is the drawing that made
 * it — which is the one thing a folded panel can carry that a moulded pot
 * cannot.
 *
 * Two consumers, one description. The marks come out as plain geometry in
 * sheet millimetres, and two small renderers put them on: the print file draws
 * them as SVG, the preview draws them into a canvas that is then mapped onto
 * the wall through the net's own UVs. Neither renderer knows anything about
 * pots, and the generator knows nothing about either — so what the preview
 * shows and what the bed prints cannot drift apart.
 */

import type { PlanterModel, Vec2 } from './types';

export type DraftMark =
  | { kind: 'circle'; x: number; y: number; r: number; dashed?: boolean }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; dashed?: boolean }
  /** Angles are radians, measured the usual way and swept anticlockwise. */
  | { kind: 'arc'; x: number; y: number; r: number; from: number; to: number }
  | { kind: 'path'; points: Vec2[]; closed: boolean }
  /** Anchored at its left end, baseline at y, and always upright on the sheet. */
  | { kind: 'text'; x: number; y: number; size: number; text: string };

export interface DraftOptions {
  /** How much of the net carries a mark, 0 to 1. */
  density: number;
  /** The one integer that decides which vertices and facets get one. */
  seed: number;
  /** Line weight (mm). */
  weight: number;
}

export const DEFAULT_DRAFT: DraftOptions = { density: 0.55, seed: 1, weight: 0.6 };

function hashUnit(a: number, b: number): number {
  let h = Math.imul(a ^ 0x27d4eb2d, 0x165667b1) ^ Math.imul(b + 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 0) % 100000) / 100000;
}

const dist = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.y - a.y);

/**
 * Every mark on the net, in sheet millimetres.
 *
 * Nothing is clipped here: the marks are laid over the whole developed wall as
 * one drawing, and the facets cut it up when it is printed. That is what makes
 * a circle run across three tiles and stop at the grout, which is what a
 * drawing folded into a solid actually does.
 */
export function draftMarks(model: PlanterModel, options: DraftOptions = DEFAULT_DRAFT): DraftMark[] {
  const { sides, rows, height } = model.parameters;
  const stride = sides + 1;
  const perBand = sides * 2;
  const density = Math.max(0, Math.min(1, options.density));
  if (density <= 0) return [];

  const planar = (band: number, id: number): Vec2 =>
    model.flatByBand[band][Math.floor(id / stride) - band][id % stride];
  /**
   * A ring's copy in the net. Rings are shared in a single-sheet wall and
   * doubled in a banded one; the lower band's copy is the one drawn on.
   */
  const netVertex = (ring: number, column: number): Vec2 =>
    planar(Math.min(ring, rows - 1), ring * stride + column);

  // One length scale for the whole drawing, taken from the facets themselves:
  // a mark sized off the pot would be lost on a wide one and cover a narrow
  // one, and a mark sized per facet would make every band a different drawing.
  const spans: number[] = [];
  const facetCorners = (index: number) => {
    const band = Math.floor(index / perBand);
    return model.triangles[index].v.map((id) => planar(band, id)) as [Vec2, Vec2, Vec2];
  };
  for (let index = 0; index < model.triangles.length; index += 1) {
    const c = facetCorners(index);
    spans.push(Math.min(dist(c[0], c[1]), dist(c[1], c[2]), dist(c[2], c[0])));
  }
  spans.sort((a, b) => a - b);
  const unit = spans[Math.floor(spans.length / 2)] || 60;
  const marks: DraftMark[] = [];

  // --- The protractors, on the net's own vertices ---------------------------
  // A vertex is where four to six facets meet, so a circle centred on one is
  // cut into that many arcs by the grout: the drawing crosses the creases and
  // the creases break it, which is the whole look.
  for (let ring = 0; ring <= rows; ring += 1) {
    for (let column = 0; column <= sides; column += 1) {
      if (hashUnit(ring * 97 + column, options.seed) > density * 0.72) continue;
      const centre = netVertex(ring, column);
      const solid = model.vertices[ring][column % sides];
      const r = unit * (0.55 + 0.35 * hashUnit(ring * 31 + column * 7, options.seed + 11));

      marks.push({ kind: 'circle', x: centre.x, y: centre.y, r });
      marks.push({ kind: 'circle', x: centre.x, y: centre.y, r: r * 0.42, dashed: true });

      // The ticks. Twelve of them, clock-face style, drawn from the rim inwards.
      const ticks = 12;
      for (let i = 0; i < ticks; i += 1) {
        const angle = (i / ticks) * Math.PI * 2;
        const inner = r * (i % 3 === 0 ? 0.72 : 0.86);
        marks.push({
          kind: 'line',
          x1: centre.x + Math.cos(angle) * inner, y1: centre.y + Math.sin(angle) * inner,
          x2: centre.x + Math.cos(angle) * r, y2: centre.y + Math.sin(angle) * r,
        });
      }

      // One swept arc with its own centre lines — the angle being measured.
      const from = hashUnit(ring + column * 13, options.seed + 3) * Math.PI * 2;
      const sweep = (0.3 + 0.35 * hashUnit(column + ring * 17, options.seed + 5)) * Math.PI;
      marks.push({ kind: 'arc', x: centre.x, y: centre.y, r: r * 0.62, from, to: from + sweep });
      for (const angle of [from, from + sweep]) {
        marks.push({
          kind: 'line',
          x1: centre.x, y1: centre.y,
          x2: centre.x + Math.cos(angle) * r * 0.62, y2: centre.y + Math.sin(angle) * r * 0.62,
          dashed: true,
        });
      }

      // The callout. This ring's real across-corners diameter, in the form a
      // drawing writes it — which is also the number on the shop order.
      const diameter = Math.hypot(solid.x, solid.y) * 2;
      marks.push({
        kind: 'text',
        x: centre.x + r * 0.15, y: centre.y + r * 1.18,
        size: unit * 0.13,
        text: `⌀ ${diameter.toFixed(diameter < 100 ? 1 : 0)}`,
      });
    }
  }

  // --- The facet glyphs -----------------------------------------------------
  for (let index = 0; index < model.triangles.length; index += 1) {
    if (hashUnit(index * 53 + 7, options.seed + 23) > density * 0.6) continue;
    const corners = facetCorners(index);
    const centre = {
      x: (corners[0].x + corners[1].x + corners[2].x) / 3,
      y: (corners[0].y + corners[1].y + corners[2].y) / 3,
    };
    const size = unit * 0.3;

    // A right-triangle symbol, with the square-corner tick every drawing puts
    // in it. Sized to read at arm's length and no larger.
    const a = { x: centre.x - size * 0.62, y: centre.y - size * 0.42 };
    const b = { x: centre.x + size * 0.62, y: centre.y - size * 0.42 };
    const c = { x: centre.x - size * 0.62, y: centre.y + size * 0.62 };
    marks.push({ kind: 'path', points: [a, b, c], closed: true });
    const tick = size * 0.2;
    marks.push({
      kind: 'path',
      points: [
        { x: a.x + tick, y: a.y },
        { x: a.x + tick, y: a.y + tick },
        { x: a.x, y: a.y + tick },
      ],
      closed: false,
    });

    // And what it is a drawing of: this facet's own shortest edge, written the
    // way the fold drawings write one.
    const edge = Math.min(dist(corners[0], corners[1]), dist(corners[1], corners[2]), dist(corners[2], corners[0]));
    marks.push({
      kind: 'text',
      x: centre.x + size * 0.85, y: centre.y + size * 0.1,
      size: unit * 0.12,
      text: `R ${edge.toFixed(0)}`,
    });
  }

  // --- The title block ------------------------------------------------------
  // One line, on the facet nearest the middle of the net, saying what the pot
  // in your hands is. The only mark that is about the whole pot rather than
  // about one facet of it.
  let best = 0;
  let bestGap = Infinity;
  for (let index = 0; index < model.triangles.length; index += 1) {
    const c = facetCorners(index);
    const cx = (c[0].x + c[1].x + c[2].x) / 3;
    const cy = (c[0].y + c[1].y + c[2].y) / 3;
    const gap = Math.hypot(cx - model.sheet.width / 2, cy - model.sheet.height / 2);
    if (gap < bestGap) { bestGap = gap; best = index; }
  }
  const title = facetCorners(best);
  const mouth = Math.hypot(model.vertices[rows][0].x, model.vertices[rows][0].y) * 2;
  marks.push({
    kind: 'text',
    x: (title[0].x + title[1].x + title[2].x) / 3 - unit * 0.62,
    y: (title[0].y + title[1].y + title[2].y) / 3 - unit * 0.45,
    size: unit * 0.12,
    text: `DXF.TLV  ${sides}×${rows}  ⌀${mouth.toFixed(0)}×${Math.round(height)}`,
  });

  return marks;
}

/**
 * The marks as SVG, in a frame whose y already runs down the page.
 *
 * `flip` is handed in rather than assumed, because the print file carries no
 * group transform at all — see `buildPlanterPrintSvg` for why a raster image
 * makes that non-negotiable.
 */
export function draftSvg(
  marks: DraftMark[], flip: (point: Vec2) => Vec2, ink: string, weight: number,
): string {
  const n = (value: number) => value.toFixed(2);
  const dash = ` stroke-dasharray="${n(weight * 6)} ${n(weight * 4)}"`;
  const body = marks.map((mark) => {
    switch (mark.kind) {
      case 'circle': {
        const c = flip({ x: mark.x, y: mark.y });
        return `<circle cx="${n(c.x)}" cy="${n(c.y)}" r="${n(mark.r)}"${mark.dashed ? dash : ''}/>`;
      }
      case 'line': {
        const a = flip({ x: mark.x1, y: mark.y1 });
        const b = flip({ x: mark.x2, y: mark.y2 });
        return `<line x1="${n(a.x)}" y1="${n(a.y)}" x2="${n(b.x)}" y2="${n(b.y)}"${mark.dashed ? dash : ''}/>`;
      }
      case 'arc': {
        // Flipping the page turns an anticlockwise sweep into a clockwise one,
        // so the sweep flag turns over with it — otherwise every arc comes out
        // drawn the long way round.
        const start = flip({ x: mark.x + Math.cos(mark.from) * mark.r, y: mark.y + Math.sin(mark.from) * mark.r });
        const end = flip({ x: mark.x + Math.cos(mark.to) * mark.r, y: mark.y + Math.sin(mark.to) * mark.r });
        const large = Math.abs(mark.to - mark.from) > Math.PI ? 1 : 0;
        return `<path d="M ${n(start.x)} ${n(start.y)} A ${n(mark.r)} ${n(mark.r)} 0 ${large} 0 ${n(end.x)} ${n(end.y)}"/>`;
      }
      case 'path': {
        const points = mark.points.map(flip).map((p) => `${n(p.x)},${n(p.y)}`).join(' ');
        return `<${mark.closed ? 'polygon' : 'polyline'} points="${points}"/>`;
      }
      case 'text':
      default: {
        const at = flip({ x: mark.x, y: mark.y });
        return `<text x="${n(at.x)}" y="${n(at.y)}" font-size="${n(mark.size)}" font-family="monospace" fill="${ink}" stroke="none">${mark.text}</text>`;
      }
    }
  }).join('');
  return `<g id="drafting" fill="none" stroke="${ink}" stroke-width="${weight.toFixed(2)}" `
    + `stroke-linecap="round" stroke-linejoin="round">${body}</g>`;
}
