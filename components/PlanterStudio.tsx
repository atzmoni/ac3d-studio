'use client';

import { ContactShadows, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import { Download, Image as ImageIcon, Lightbulb, Maximize2, Mountain, Pause, Play, Printer, RotateCcw, Rotate3D, Search, Shuffle, SlidersHorizontal } from 'lucide-react';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { CheckList, NumberField, PatternPicker, SliderField, type PatternOption } from '@/components/controls';
import { netUv, useArtworkTexture, wallNetBox, type ArtworkLook } from '@/components/planter-artwork';
import { useStoneMaterial, type StoneLook } from '@/components/planter-stone-material';
import { CameraRig, StudioLights } from '@/components/three-stage';
import { buildFoldTree, cornersAt, internalEdges, type FoldTree } from '@/lib/fold-tree';
import { getMaterial, MATERIALS } from '@/lib/pattern-engine';
import { solidSkin } from '@/lib/planter-solid';
import { draftMarks } from '@/lib/planter-drafting';
import {
  buildPlanterDxf, buildPlanterModel, buildPlanterPrintSvg, buildPlanterSvg, collarColour,
  DEFAULT_PLANTER, FOLD_COLORS, getPlanterChecks, getPlanterStats, isLitPlanter, LED_CONTROLLERS,
  grooveLayerSummary, LED_DENSITIES, ledGlow, LED_POSITIONS, LEDS, litPlanter, placedGeometry, planterSplit,
  unlitPlanter, V_BITS,
} from '@/lib/planter-engine';
import { getLedEffect, hexToHsl, ledThrow, LED_BASE_COLOURS, LED_EFFECTS, pixelColor } from '@/lib/planter-led-effects';
import { barycentric, flapSlit, type Triangle2 } from '@/lib/planter-perforation';
import {
  CUSTOM_PALETTE, insetTriangle, MAX_GROUT, MAX_PRINT_TONES, paletteColours, paletteName,
  PRINT_FITS, PRINT_MODES, PRINT_PALETTES, PRINT_RULE_NAMES, PRINT_RULES,
} from '@/lib/planter-print';
import {
  MAX_COAT_MM, SEAL_NAMES, stoneById, stoneName, STONE_FAMILIES, STONE_MATERIALS, STONE_SEALS,
  STONE_TINTS,
} from '@/lib/planter-stone';
import {
  backdropById, finishById, gradientTexture, PLANTER_BACKDROPS, PLANTER_FINISHES,
  type PlanterBackdrop, type PlanterFinish,
} from '@/lib/planter-finishes';
import { BLANK_PLANTER, getPlanterStyle, PLANTER_CATEGORIES, PLANTER_PRESETS, PLANTER_STYLES } from '@/lib/planter-styles';
import type {
  FoldKind, MaterialId, PlanterCategory, PlanterConstruction, PlanterFace, PlanterFootprint, PlanterLed,
  PlanterLedController, PlanterLedPosition, PlanterModel, PlanterParameters, PlanterPerforation,
  PlanterPiece, PlanterPrint, PlanterPrintFit, PlanterPrintRule, PlanterStyleId, Vec2, Vec3,
} from '@/lib/types';

type ViewAngle = 'iso' | 'front' | 'top' | 'hero';

const VIEW_DIRS: Record<ViewAngle, [number, number, number]> = {
  iso: [0.72, 0.46, 1], front: [0, 0.12, 1], top: [0, 1, 0.05],
  // A steep three-quarter angle, well above the pot rather than level with
  // it — the "high" view, for reading the mouth and the facet layout at once.
  hero: [0.5, 0.92, 0.55],
};
const VIEW_LABELS: { id: ViewAngle; label: string }[] = [
  { id: 'iso', label: 'ISO' }, { id: 'front', label: 'FRT' }, { id: 'top', label: 'TOP' }, { id: 'hero', label: 'HERO' },
];

/** Longest dimension of the assembled pot, in world units. Everything else derives from this. */
const POT_FIT = 3.4;

/** What each print mode is called on the control. */
const PRINT_MODE_LABELS: Record<string, string> = {
  none: 'No print', triangles: 'Facet generator', image: 'Imported image',
};

/** The inks the drafting layer is kept in — white on a dark palette, and back. */
const DRAFT_INKS = ['#ffffff', '#0d1220', '#d9c9a8', '#8fc2d8'];

/**
 * The most a supplied image may weigh.
 *
 * It is written whole into the exported print file, so this is not a memory
 * limit — it is the size of the thing the shop has to open at the other end.
 */
const MAX_ARTWORK_BYTES = 12 * 1024 * 1024;

const STROKE_DASH: Record<FoldKind, string | undefined> = {
  mountain: undefined, valley: '7 4', cut: '9 3 2 3',
};

/** What the shared shell needs from whichever workspace is on screen. */
export interface StudioStatus {
  blocking: boolean;
  readout: string[];
}

// ---------------------------------------------------------------------------
// 3D
// ---------------------------------------------------------------------------

/**
 * The cut-out sizes, biggest opening first.
 *
 * Labelled by how big the holes come out, not by the subdivision underneath —
 * the two run opposite ways, and "size" is the thing anybody actually has an
 * opinion about. The full range stays on the slider below for the shop.
 */
const PERF_SIZES: PatternOption[] = [
  { density: 0, label: 'Solid' },
  { density: 1, label: 'Huge' },
  { density: 2, label: 'Large' },
  { density: 3, label: 'Medium' },
  { density: 4, label: 'Small' },
  { density: 6, label: 'Fine' },
];

/** The light coming through the wall, in the warm white these strips actually are. */

interface ShellPiece {
  tree: FoldTree;
  crease: { tri: number; corners: [number, number] }[];
  /**
   * Each triangle's three vertex ids. The solid builder reads them to tell a
   * crease from a cut edge: an edge with a neighbour is grooved and keeps its
   * skin, and an edge without one shows the thickness of the stock.
   */
  ids: [number, number, number][];
  /** Where this piece's triangles start in the model's own triangle list. */
  from: number;
  /**
   * Each triangle's corners in the developed net, as 0-1 across the wall's own
   * box. Not a contrivance: the panel is printed flat, so the net is the
   * artwork's own coordinate system, and these are the print file's
   * millimetres normalised. See `planter-artwork.ts`.
   */
  uv: [number, number][][];
  /**
   * The wall's cut-outs, held as corner weights against the facet they sit on.
   * A facet is rigid, so the same weights rebuild each cut-out at any stage of
   * the fold — the pattern rides the wall up out of the flat net instead of
   * being laid out again for every frame.
   */
  cut: { tri: number; cells: [number, number, number][][]; flaps: [number, number, number][][] }[];
}

/**
 * A fold-tree world position is stored internally as (worldX, worldZ, worldY)
 * — the third slot, always exactly 0 in a piece's flat state, is what has to
 * land on the ground, and the ground here is the Y = 0 plane — so it is read
 * back with Y and Z swapped.
 */
const toWorld = (p: THREE.Vector3) => new THREE.Vector3(p.x, p.z, p.y);

/**
 * What the automatic split costs this design, in the terms somebody ordering it
 * cares about: how many blanks come off the sheet and how many rivet lines go
 * between them. Reads the wall as it is actually being built, so it says "one
 * blank" for a shape that never needed cutting rather than promising a split it
 * is not going to make.
 */
const splitNote = (model: PlanterModel): string => {
  const parts = model.parts.length;
  if (parts === 1) return 'This pot develops whole, so it still comes off as one blank with no rivet line at all.';
  const bands = model.parts
    .map((part) => (part.from === part.to ? `${part.from + 1}` : `${part.from + 1}–${part.to + 1}`))
    .join(' · ');
  return `${parts} parts (bands ${bands}), ${parts - 1} rivet ${parts === 2 ? 'line' : 'lines'}.`;
};

/**
 * The pot folds up out of its own flat net as a chain of hinge rotations, one
 * chain per physical part: the whole wall when it is cut from one blank, or one
 * chain per riveted part when it is not, because those are genuinely separate
 * pieces of metal. A hinge chain keeps every facet perfectly rigid and keeps it
 * attached to its neighbour throughout, which a straight-line vertex move
 * cannot: that always stretches material on the way, and for a piece nested
 * apart from its neighbours on the cutting sheet it makes the pot look like it
 * assembles out of scattered debris rather than folding shut.
 *
 * One chain per part is also what makes the preview readable as a drawing. A
 * chain can only come apart at its own edges, so the lines that open on screen
 * are exactly the lines the cutter parts, and every crease inside a chain stays
 * shut — which is what a grooved line does. Ask one chain to span a wall that
 * does not develop and it cannot honour that: the hinges stop being isometries,
 * facets drift apart mid-fold, and the preview shows the wall splitting along
 * rings the file only ever asked to be scored.
 */
function usePlanterShell(model: PlanterModel) {
  return useMemo(() => {
    const { sides, rows, height } = model.parameters;
    const stride = sides + 1;
    const inParts = model.parts.length > 1;
    const span = Math.max(
      height,
      ...model.vertices.map((ring) => Math.hypot(ring[0].x, ring[0].y) * 2),
      // A one-blank net can be much wider than the pot itself, so the camera has
      // to size for it. A wall in parts no longer positions itself on the sheet
      // at all (see below), so the nest width is irrelevant to its scale.
      inParts ? 0 : model.sheet.width,
    );
    const scale = POT_FIT / span;
    const netCx = model.sheet.width / 2;
    const netCy = model.sheet.height / 2;

    // Fold-tree points are (worldX, worldZ, worldY) — see `toWorld`.
    const builtOf = (id: number): Vec3 => {
      const s = model.vertices[Math.floor(id / stride)][id % stride];
      return { x: s.x * scale, y: -s.y * scale, z: s.z * scale };
    };

    // Cut-outs arrive in sheet coordinates, and so does `flatByBand` — so the
    // weights are worked out there, in the one frame both are already in, and
    // the shell's own scaling never has to touch them.
    const sheetOf = (band: number, id: number): Vec2 =>
      model.flatByBand[band][Math.floor(id / stride) - band][id % stride];
    const cutByTriangle = new Map<number, {
      cells: [number, number, number][][]; flaps: [number, number, number][][];
    }>();
    for (const facet of model.perfCells) {
      const band = Math.floor(facet.triangle / (sides * 2));
      const corners = model.triangles[facet.triangle].v.map((id) => sheetOf(band, id)) as Triangle2;
      const weigh = (ring: Vec2[]) => ring.map((point) => barycentric(corners, point));
      cutByTriangle.set(facet.triangle, { cells: facet.cells.map(weigh), flaps: facet.flaps.map(weigh) });
    }
    /** The cut-outs on one piece, indexed by the triangle's place within it. */
    const cutsFor = (from: number, count: number) => Array.from({ length: count }, (_, j) => ({
      tri: j,
      cells: cutByTriangle.get(from + j)?.cells ?? [],
      flaps: cutByTriangle.get(from + j)?.flaps ?? [],
    })).filter((entry) => entry.cells.length > 0 || entry.flaps.length > 0);

    // The artwork's frame. Worked out once, here, so the UVs on the mesh and
    // the canvas the print is drawn into are laid out against the same box.
    const netBox = wallNetBox(model);
    const uvOf = (band: number, id: number): [number, number] =>
      netUv(model.flatByBand[band][Math.floor(id / stride) - band][id % stride], netBox);

    const pieces: ShellPiece[] = [];
    if (inParts) {
      // A wall cut from one blank keeps every band in the flat frame the unfolded
      // net put it in. A wall in parts does not: its parts generally land far
      // from each other on the nested cutting sheet, so each one instead starts
      // flat directly beneath the spot it will occupy once built — only the hinge
      // chain's own curl carries it the rest of the way.
      for (const part of model.parts) {
        const first = part.from * sides * 2;
        const count = (part.to - part.from + 1) * sides * 2;
        const ids = model.triangles.slice(first, first + count).map((t) => t.v);
        // A ring inside a part is shared by the bands either side of it, and the
        // net holds it once per band. Either copy reads the same point, so the
        // lower band's is taken and only the part's topmost ring comes from above.
        const bandOf = (id: number) => Math.min(Math.max(Math.floor(id / stride), part.from), part.to);
        const solidPts = model.vertices.slice(part.from, part.to + 2).flat();
        const targetX = (solidPts.reduce((sum, p) => sum + p.x, 0) / solidPts.length) * scale;
        const targetZ = -(solidPts.reduce((sum, p) => sum + p.y, 0) / solidPts.length) * scale;
        const flatPts = [
          ...model.flatByBand.slice(part.from, part.to + 1).map((band) => band[0]).flat(),
          ...model.flatByBand[part.to][1],
        ];
        const flatCx = flatPts.reduce((sum, p) => sum + p.x, 0) / flatPts.length;
        const flatCy = flatPts.reduce((sum, p) => sum + p.y, 0) / flatPts.length;
        const flatOf = (id: number): Vec2 => {
          const band = bandOf(id);
          const p = model.flatByBand[band][Math.floor(id / stride) - band][id % stride];
          return { x: (p.x - flatCx) * scale + targetX, y: -(p.y - flatCy) * scale + targetZ };
        };
        const triangles = ids.map(([a, b, c]) => ({
          flat: [flatOf(a), flatOf(b), flatOf(c)] as [Vec2, Vec2, Vec2],
          built: [builtOf(a), builtOf(b), builtOf(c)] as [Vec3, Vec3, Vec3],
        }));
        const tree = buildFoldTree(triangles, ids, { x: targetX, y: targetZ });
        pieces.push({
          tree,
          ids,
          crease: internalEdges(ids),
          cut: cutsFor(first, count),
          from: first,
          uv: ids.map((tri) => tri.map((id) => uvOf(bandOf(id), id)) as [number, number][]),
        });
      }
    } else {
      const ids = model.triangles.map((t) => t.v);
      const flatOf = (id: number): Vec2 => {
        const ring = Math.floor(id / stride);
        const band = Math.min(ring, rows - 1);
        const p = model.flatByBand[band][ring - band][id % stride];
        return { x: (p.x - netCx) * scale, y: -(p.y - netCy) * scale };
      };
      const triangles = ids.map(([a, b, c]) => ({
        flat: [flatOf(a), flatOf(b), flatOf(c)] as [Vec2, Vec2, Vec2],
        built: [builtOf(a), builtOf(b), builtOf(c)] as [Vec3, Vec3, Vec3],
      }));
      const flatPts = triangles.flatMap((t) => t.flat);
      const pivot = {
        x: flatPts.reduce((sum, p) => sum + p.x, 0) / flatPts.length,
        y: flatPts.reduce((sum, p) => sum + p.y, 0) / flatPts.length,
      };
      const tree = buildFoldTree(triangles, ids, pivot);
      pieces.push({
        tree,
        ids,
        crease: internalEdges(ids),
        cut: cutsFor(0, model.triangles.length),
        from: 0,
        uv: ids.map((tri) => tri.map((id) => uvOf(Math.min(Math.floor(id / stride), rows - 1), id)) as [number, number][]),
      });
    }

    const shape = (points: { x: number; y: number }[], hole?: { x: number; y: number }[]) => {
      const path = new THREE.Shape();
      const cx = points.reduce((sum, point) => sum + point.x, 0) / points.length;
      const cy = points.reduce((sum, point) => sum + point.y, 0) / points.length;
      points.forEach((point, i) => {
        const x = (point.x - cx) * scale;
        const y = (point.y - cy) * scale;
        if (i === 0) path.moveTo(x, y); else path.lineTo(x, y);
      });
      path.closePath();
      if (hole && hole.length > 2) {
        const ring = new THREE.Path();
        hole.forEach((point, i) => {
          const x = (point.x - cx) * scale;
          const y = (point.y - cy) * scale;
          if (i === 0) ring.moveTo(x, y); else ring.lineTo(x, y);
        });
        ring.closePath();
        path.holes.push(ring);
      }
      return new THREE.ShapeGeometry(path);
    };

    // A banded wall contributes one piece per band ahead of the plates, so the
    // plates are found by id rather than by a fixed index.
    const basePiece = model.pieces.find((piece) => piece.id === 'base') as PlanterPiece;
    const rimPiece = model.pieces.find((piece) => piece.id === 'rim') as PlanterPiece;
    const base = shape(basePiece.outline);
    const rim = shape(rimPiece.outline, rimPiece.holes[0]);
    // ShapeGeometry is drawn in XY. Both plates lie flat in both states, so both
    // get the same quarter turn and only their position has to move.
    base.rotateX(-Math.PI / 2);
    rim.rotateX(-Math.PI / 2);

    const planeExtent = (piece: PlanterPiece) => Math.hypot(piece.width, piece.height) / 2;

    // The camera has to frame both ends of the fold, so the radius is read
    // straight off the flat (t = 0) and built (t = 1) corner positions rather
    // than estimated from the sheet — which no longer positions the pieces at all.
    let extent = 0;
    const flatBox = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (const piece of pieces) {
      for (const tParam of [0, 1]) {
        for (const tri of cornersAt(piece.tree, tParam)) {
          for (const raw of tri) {
            const p = toWorld(raw);
            extent = Math.max(extent, Math.hypot(p.x, p.z), Math.abs(p.y));
            if (tParam === 0) {
              flatBox.minX = Math.min(flatBox.minX, p.x);
              flatBox.maxX = Math.max(flatBox.maxX, p.x);
              flatBox.minZ = Math.min(flatBox.minZ, p.z);
              flatBox.maxZ = Math.max(flatBox.maxZ, p.z);
            }
          }
        }
      }
    }

    // Laid out flat, the plates are separate parts and have to read as separate
    // parts: stacked on the wall's own footprint they just hide inside it. They
    // sit in a row beside the wall blank and travel to the axis as the fold runs.
    const baseHalf = (basePiece.width / 2) * scale;
    const rimHalf = (rimPiece.width / 2) * scale;
    const gap = Math.max(baseHalf, rimHalf, POT_FIT * 0.1) * 0.35;
    const wallRight = Number.isFinite(flatBox.maxX) ? flatBox.maxX : 0;
    const alongZ = Number.isFinite(flatBox.minZ) ? (flatBox.minZ + flatBox.maxZ) / 2 : 0;
    const baseX = wallRight + gap + baseHalf;
    const rimX = baseX + baseHalf + gap + rimHalf;
    extent = Math.max(extent, Math.hypot(rimX + rimHalf, alongZ + rimHalf));

    // What a plant standing in the opening has to clear is the largest circle
    // that fits it — the hole's inradius, not its corner-to-corner span.
    const hole = rimPiece.holes[0] ?? [];
    const holeCentre = {
      x: hole.reduce((sum, point) => sum + point.x, 0) / (hole.length || 1),
      y: hole.reduce((sum, point) => sum + point.y, 0) / (hole.length || 1),
    };
    let opening = Infinity;
    for (let i = 0; i < hole.length; i += 1) {
      const a = hole[i];
      const b = hole[(i + 1) % hole.length];
      const span = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const drop = Math.abs((b.x - a.x) * (a.y - holeCentre.y) - (a.x - holeCentre.x) * (b.y - a.y)) / span;
      opening = Math.min(opening, drop);
    }

    // The soil box, as the box it is: a prism standing on the pot's floor, with
    // its own floor closed. Built from the liner's real section rather than a
    // cylinder, so a rectangular pot gets a rectangular box.
    let liner: THREE.BufferGeometry | null = null;
    if (model.liner) {
      const path = new THREE.Shape();
      model.liner.section.forEach((point, i) => {
        const x = point.x * scale;
        const y = point.y * scale;
        if (i === 0) path.moveTo(x, y); else path.lineTo(x, y);
      });
      path.closePath();
      liner = new THREE.ExtrudeGeometry(path, { depth: model.liner.height * scale, bevelEnabled: false });
      // Extrusion runs along +Z; a quarter turn stands it up on the floor.
      liner.rotateX(-Math.PI / 2);
    }

    return {
      pieces, scale, base, rim, liner,
      baseFlat: new THREE.Vector3(baseX, 0, alongZ),
      baseBuilt: new THREE.Vector3(0, 0.001, 0),
      rimFlat: new THREE.Vector3(rimX, 0, alongZ),
      rimBuilt: new THREE.Vector3(0, height * scale, 0),
      openingRadius: (Number.isFinite(opening) ? opening : 0) * scale,
      radius: Math.max(POT_FIT, extent, planeExtent(basePiece) * scale, planeExtent(rimPiece) * scale) * 1.15,
    };
  }, [model]);
}

type PlantId = 'none' | 'tropical' | 'lowpoly';

const PLANT_OPTIONS: { id: PlantId; label: string }[] = [
  { id: 'none', label: 'No planting' },
  { id: 'tropical', label: 'Indoor pot plant' },
  { id: 'lowpoly', label: 'Low-poly plant' },
];

const PLANT_MODELS: Record<Exclude<PlantId, 'none'>, { obj: string; mtl: string }> = {
  tropical: { obj: '/models/plant-tropical/plant.obj', mtl: '/models/plant-tropical/plant.mtl' },
  lowpoly: { obj: '/models/plant-lowpoly/plant.obj', mtl: '/models/plant-lowpoly/plant.mtl' },
};

/**
 * Each source file models its OWN little pot along with the foliage — this
 * planter already has one, so that geometry is dropped by material name,
 * leaving just the plant to stand in the actual collar.
 */
const PLANT_EXCLUDE_MATERIALS: Record<Exclude<PlantId, 'none'>, string[]> = {
  // Material.006 is a near-zero-depth plane roughly 3x taller than the actual
  // leaves (measured off the raw OBJ) — a backdrop card, not plant geometry.
  // Left in, its outlier height dominates the bounding box the auto-scale
  // measures, which is why the plant first rendered as a thin dark spike.
  tropical: ['IDP_Pot', 'IDP_ground', 'Material.006'],
  lowpoly: ['Material'],
};

/**
 * Cut the excluded materials' triangles out of a multi-material geometry,
 * rebuilding the vertex buffers so the bounding box (and everything else)
 * reflects only what remains. A source model often carries its pot and its
 * foliage as geometry GROUPS on one single mesh rather than as separate
 * objects, so dropping the whole mesh whenever any one of its materials is
 * excluded would take the foliage down with it — this keeps the mesh and
 * removes only the triangle ranges that belong to an excluded material.
 * `computeBoundingBox` reads every vertex in the position buffer regardless
 * of which triangles reference it, so a plain index trim is not enough: the
 * unwanted vertices have to be gone from the buffers themselves.
 */
function trimGeometry(
  geometry: THREE.BufferGeometry, keepGroups: { start: number; count: number; materialIndex: number }[],
  materials: THREE.Material[],
): { geometry: THREE.BufferGeometry; materials: THREE.Material[] } {
  const oldIndex = geometry.index;
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  const remap = new Map<number, number>();
  const newPositions: number[] = [];
  const newNormals: number[] = [];
  const newUvs: number[] = [];
  const newIndices: number[] = [];
  const newGroups: { start: number; count: number; materialIndex: number }[] = [];
  const materialRemap = new Map<number, number>();
  const keptMaterials: THREE.Material[] = [];

  const vertexOf = (oldVertex: number) => {
    let mapped = remap.get(oldVertex);
    if (mapped === undefined) {
      mapped = newPositions.length / 3;
      remap.set(oldVertex, mapped);
      newPositions.push(position.getX(oldVertex), position.getY(oldVertex), position.getZ(oldVertex));
      if (normal) newNormals.push(normal.getX(oldVertex), normal.getY(oldVertex), normal.getZ(oldVertex));
      if (uv) newUvs.push(uv.getX(oldVertex), uv.getY(oldVertex));
    }
    return mapped;
  };

  for (const g of keepGroups) {
    if (!materialRemap.has(g.materialIndex)) {
      materialRemap.set(g.materialIndex, keptMaterials.length);
      keptMaterials.push(materials[g.materialIndex]);
    }
    const start = newIndices.length;
    for (let i = g.start; i < g.start + g.count; i += 1) {
      newIndices.push(vertexOf(oldIndex ? oldIndex.getX(i) : i));
    }
    newGroups.push({ start, count: g.count, materialIndex: materialRemap.get(g.materialIndex) as number });
  }

  const trimmed = new THREE.BufferGeometry();
  trimmed.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
  if (normal) trimmed.setAttribute('normal', new THREE.Float32BufferAttribute(newNormals, 3));
  if (uv) trimmed.setAttribute('uv', new THREE.Float32BufferAttribute(newUvs, 2));
  trimmed.setIndex(newIndices);
  for (const g of newGroups) trimmed.addGroup(g.start, g.count, g.materialIndex);
  return { geometry: trimmed, materials: keptMaterials };
}

/**
 * A real leaf model standing in the collar opening, loaded from the asset
 * files under /public/models. Each source file was modelled at its own
 * arbitrary scale, so the model is measured once loaded and rescaled to a
 * height proportional to the collar it is standing in — a small pot gets a
 * small plant, not whatever size the source happened to be modelled at — then
 * re-centred so its own base sits exactly on the collar, not floating above
 * or buried below it.
 */
function PlantModel({ id, radius }: { id: Exclude<PlantId, 'none'>; radius: number }) {
  const { obj, mtl } = PLANT_MODELS[id];
  const materials = useLoader(MTLLoader, mtl);
  const raw = useLoader(OBJLoader, obj, (loader) => {
    materials.preload();
    loader.setMaterials(materials);
  });

  const object = useMemo(() => {
    const model = raw.clone(true);
    const exclude = new Set(PLANT_EXCLUDE_MATERIALS[id]);
    const dropped: THREE.Object3D[] = [];
    model.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const geometry = mesh.geometry as THREE.BufferGeometry;
      const groups = geometry.groups;

      if (mats.length > 1 && groups && groups.length > 0) {
        const keepGroups = groups.filter((g) => !exclude.has(mats[g.materialIndex ?? 0]?.name ?? ''))
          .map((g) => ({ start: g.start, count: g.count, materialIndex: g.materialIndex ?? 0 }));
        if (keepGroups.length === 0) { dropped.push(mesh); return; }
        if (keepGroups.length < groups.length) {
          const trimmed = trimGeometry(geometry, keepGroups, mats);
          mesh.geometry = trimmed.geometry;
          mesh.material = trimmed.materials;
        }
      } else if (mats.some((m) => exclude.has(m.name))) {
        dropped.push(mesh);
        return;
      }

      for (const m of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshPhongMaterial[]) {
        // A leaf or frond plane is drawn one-sided in the source file; seen
        // from the far side it would otherwise vanish.
        m.side = THREE.DoubleSide;
        if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
      }
    });
    dropped.forEach((mesh) => mesh.parent?.remove(mesh));

    // A houseplant's foliage typically stands several times the height of its
    // own pot, but how far it SPREADS varies a lot by species — a spiky
    // upright plant is nothing like a bushy one whose fronds reach out wider
    // than the pot itself. Scaling by height alone sized the wide-spreading
    // model in the report several times too big, its fronds off the edge of
    // the frame. Fitting BOTH the height and the footprint against the collar
    // and taking whichever is tighter is what a "contain" fit means for a
    // plant: never wider than the pot can carry, whatever its species is.
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const targetHeight = radius * 6.5;
    const targetSpread = radius * 4;
    const byHeight = size.y > 1e-6 ? targetHeight / size.y : 1;
    const footprint = Math.max(size.x, size.z);
    const bySpread = footprint > 1e-6 ? targetSpread / footprint : 1;
    model.scale.setScalar(Math.min(byHeight, bySpread));

    const settled = new THREE.Box3().setFromObject(model);
    const centre = settled.getCenter(new THREE.Vector3());
    model.position.x -= centre.x;
    model.position.z -= centre.z;
    model.position.y -= settled.min.y;
    return model;
  }, [raw, radius, id]);

  return <primitive object={object} />;
}

function Planting({ id, radius }: { id: PlantId; radius: number }) {
  if (id === 'none' || radius <= 0) return null;
  return (
    <Suspense fallback={null}>
      <PlantModel id={id} radius={radius} />
    </Suspense>
  );
}

/** What each strip is for, in one line. The kelvin number alone says nothing. */
const LED_COPY: Record<PlanterLed, { short: string; note: string }> = {
  none: { short: 'None', note: 'The cavity is left empty — lamp it later if you want to.' },
  '3000k': { short: '3000K', note: 'The one a garden wants after dark: it lands warm on render, wood and planting, and it is the end of the range insects care least about. This is the default.' },
  '6000k': { short: '6000K', note: 'Neutral white that holds colour honestly — right for a shopfront or for photography, too cold for somewhere people sit.' },
  '10000k': { short: '10000K', note: 'The blue end. It reads as moonlight on metal and gives the least useful light per watt — an effect rather than a lamp.' },
  ws2812: { short: 'WS2812', note: 'Not white at all: RGB with a controller in every LED, at 5 V. Each one is addressed on its own, so it can chase, wave or hold a colour per facet — and its power budget is a different animal.' },
};

/**
 * The dot on each strip's button. The whites are the colour the preview glows
 * at; the addressable one has no single colour, so it shows the whole wheel —
 * which is also the honest answer to what it does.
 */
/** Where the strip goes, and what that costs you. */
const LED_POSITION_COPY: Record<PlanterLedPosition, { name: string; note: string }> = {
  rim: {
    name: 'Top — under the collar',
    note: 'The strip goes into a channel under the collar, facing down. It grazes the wall from above, so the upper cut-outs are the bright ones and they fade toward the foot — and it can be re-lamped from the top without lifting the soil box out.',
  },
  wall: {
    name: 'On the box — facing the cut-outs',
    note: 'Bonded to the outside face of the soil box, looking straight at the openings. The brightest of the three and the most even up the height — but it comes out with the box.',
  },
  foot: {
    name: 'Bottom — facing up',
    note: 'Standing on the base plate facing up, so the light washes the wall from below and the lower cut-outs are the strongest. It is also where the water ends up: IP65 tape, sealed joints and spacers over the drain holes.',
  },
};

/** Best first: the one that actually runs these modes leads the row. */
const LED_CONTROLLER_ORDER: PlanterLedController[] = ['wled', 'ir', 'none'];

const ledSwatch = (led: PlanterLed): React.CSSProperties => (led === 'ws2812'
  ? { background: 'conic-gradient(from 0deg, #ff5555, #ffd24d, #4dff88, #4dd2ff, #b46bff, #ff5555)', boxShadow: '0 0 8px rgba(122,216,255,0.75)' }
  : { background: ledGlow(led), boxShadow: `0 0 8px ${ledGlow(led)}` });


/**
 * The pot's skin.
 *
 * One material for the wall, the petals, the base and the collar, because a
 * hand-applied render does not stop at a part boundary — the painter works the
 * assembled pot. Without a stone picked this falls back to the flat finish,
 * where the collar and base do read a shade darker than the wall.
 */
function Skin({ stone, print, color, finish, flat = true }: {
  stone: THREE.MeshStandardMaterial | null; color: string; finish: PlanterFinish; flat?: boolean;
  /** Set on a printed wall: the fills arrive per vertex, so the material only
   *  has to stop tinting them a second time. */
  print?: { roughness: number } | null;
}) {
  if (stone) return <primitive object={stone} attach="material" />;
  if (print) {
    return (
      <meshStandardMaterial
        key="printed"
        color="#ffffff" vertexColors metalness={0} roughness={print.roughness}
        side={THREE.DoubleSide} flatShading={flat}
      />
    );
  }
  return (
    <meshStandardMaterial
      color={color} metalness={finish.metalness} roughness={finish.roughness}
      side={THREE.DoubleSide} flatShading={flat}
    />
  );
}

function PlanterMesh({ model, finish, customColor, plant, assembly, autoRotate }: {
  model: PlanterModel; finish: PlanterFinish; customColor: string; plant: PlantId; assembly: number;
  autoRotate: React.MutableRefObject<boolean>;
}) {
  const shell = usePlanterShell(model);
  const group = useRef<THREE.Group>(null);
  const t = assembly / 100;
  const wallColor = finish.custom ? customColor : finish.color;
  // A shade darker, so the base plate and collar read as separate parts from
  // the wall rather than melting into one flat-coloured shape.
  const accentColor = useMemo(() => `#${new THREE.Color(wallColor).multiplyScalar(0.86).getHexString()}`, [wallColor]);
  // What the stock looks like where it was cut or grooved, rather than where it
  // was finished. A composite panel is two bright skins round a dark core and a
  // painted one is only painted on the face that shows — so a sawn edge and the
  // back of the sheet are the material's own colour, never the pot's.
  const coreColor = model.material.accent;
  // What comes through the openings. The three whites are one colour each; an
  // addressable strip has no single colour at all, so the mesh carries its own
  // per-facet tint and the material only has to stop tinting it a second time.
  const addressable = model.parameters.led === 'ws2812';
  const lightColor = addressable ? '#ffffff' : ledGlow(model.parameters.led);
  // The mode as the model resolved it, not as the toolbar shows it: a strip
  // with no controller is held at one colour whatever was picked, and the
  // preview has to agree with the power budget about that.
  const effect = model.lighting?.effect ?? 'static';
  const baseHsl = useMemo(() => hexToHsl(model.parameters.ledColor), [model.parameters.ledColor]);
  // Each mode has a speed it wants to run at; the slider scales that rather
  // than replacing it, so a strobe stays a strobe and a breath stays a breath.
  const tempo = getLedEffect(effect).tempo * (0.25 + (model.parameters.ledSpeed / 100) * 1.75);
  const phase = useRef(0);
  // Where the strip sits decides which openings are the bright ones, and that
  // is the whole visible difference between the three mountings.
  const position = model.parameters.ledPosition;
  // The stone, if one is painted on. `reliefMm` comes from the engine rather
  // than from the slider, so the preview can never show deeper relief than the
  // coat the shop was told to build.
  const stoneLook = useMemo<StoneLook | null>(() => {
    const picked = stoneById(model.parameters.stone);
    if (!picked) return null;
    return {
      stone: picked,
      scale: shell.scale,
      reliefMm: model.stone?.reliefMm ?? 0,
      toneVariation: model.parameters.stoneTone / 100,
      tint: model.parameters.stoneTint,
      seal: model.parameters.stoneSeal,
    };
  }, [model, shell.scale]);
  const stoneSkin = useStoneMaterial(stoneLook);


  // The print. `fills` is the engine's own array, in triangle order, so the pot
  // on screen is painted from exactly what the print file fills — there is no
  // second opinion about which colour lands on which facet.
  const fills = model.print?.fills ?? [];
  const artwork = useArtworkTexture(useMemo<ArtworkLook | null>(() => {
    if (!model.print) return null;
    const p = model.parameters;
    const weight = Math.max(0.3, p.printGrout * 0.4);
    const marks = p.printOverlay && p.printOverlayDensity > 0
      ? draftMarks(model, { density: p.printOverlayDensity / 100, seed: p.printSeed, weight })
      : [];
    return {
      image: p.print === 'image' ? p.printImage : '',
      fit: p.printFit,
      marks,
      ink: p.printOverlayInk,
      weight,
      box: wallNetBox(model),
    };
  }, [model]));

  const { wall, back, edges, creases, cutouts, petals, pixelU, pixelV, tinted } = useMemo(() => {
    const pos: number[] = [];
    const uvs: number[] = [];
    const paint: number[] = [];
    const creaseData: number[] = [];
    const cutData: number[] = [];
    // Where each cut-out sits on the pot, one entry per vertex: `cutU` the way
    // round it and `cutY` the height it is at, still in world units. An
    // addressable mode is a function of exactly those two and the time, so
    // carrying them on the geometry is what lets the effect animate every frame
    // without the pot being rebuilt underneath it.
    const cutU: number[] = [];
    const cutY: number[] = [];
    const petalData: number[] = [];
    // The back of the panel and the material on show at every parted edge.
    const backData: number[] = [];
    const rimData: number[] = [];
    // The stock, and the cut in it, brought into the viewport's own units. The
    // pot is drawn to fit the frame whatever size it is, so a thickness in
    // millimetres has to travel with it or the wall would read as 4 mm thick on
    // a 300 mm pot and paper-thin on a 900 mm one.
    const skin = model.solid.thickness * shell.scale;
    const cut = {
      depth: model.groove.depth * shell.scale,
      width: model.groove.width * shell.scale,
      skin: model.groove.skin * shell.scale,
    };
    // The petals only stand up once the pot does: they are bent by hand after
    // the wall is folded, so they open over the last of the fold.
    const lift = ((model.parameters.perfLift * Math.PI) / 180) * Math.max(0, Math.min(1, (t - 0.6) / 0.4));

    for (const piece of shell.pieces) {
      const corners = cornersAt(piece.tree, t).map((tri) => tri.map(toWorld));
      corners.forEach((tri, index) => {
        for (const p of tri) pos.push(p.x, p.y, p.z);
        // The net's own coordinates, carried up onto the folded pot with the
        // facet they belong to — the print does not move when the pot closes.
        for (const [u, v] of piece.uv[index] ?? []) uvs.push(u, v);
        const hex = fills[piece.from + index];
        if (hex) {
          const colour = new THREE.Color(hex);
          for (let corner = 0; corner < 3; corner += 1) paint.push(colour.r, colour.g, colour.b);
        }
      });
      // The same facets given their thickness: a back face one skin behind the
      // front, a V cut into it along every crease, and a band of material at
      // every edge the cutter parted. Rebuilt as the fold runs, so the groove
      // is seen open on the flat blank and shut on the finished pot.
      const solid = solidSkin(corners, piece.ids, skin, cut);
      backData.push(...solid.inner);
      rimData.push(...solid.rim);

      for (const edge of piece.crease) {
        const a = corners[edge.tri][edge.corners[0]];
        const b = corners[edge.tri][edge.corners[1]];
        creaseData.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }

      for (const facet of piece.cut) {
        const [a, b, c] = corners[facet.tri];
        // Proud of the facet by a hair, along its own normal. The wall here is
        // a solid skin rather than a skin with holes in it — what these panels
        // show is the light arriving through the openings, which is what a lit
        // pot actually looks like from outside — and without the offset they
        // would fight the wall for the same depth.
        const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a))
          .normalize().multiplyScalar(0.0035);
        const at = ([u, v, w]: [number, number, number]) => ({
          x: a.x * u + b.x * v + c.x * w + normal.x,
          y: a.y * u + b.y * v + c.y * w + normal.y,
          z: a.z * u + b.z * v + c.z * w + normal.z,
        });
        // One opening is one pixel of the effect, so it takes one position:
        // splitting a cell's own triangles across the pattern would cut a
        // cut-out in half down a line that is not there on the wall.
        const place = (middle: { x: number; y: number; z: number }, times: number) => {
          const round = Math.atan2(middle.z, middle.x) / (Math.PI * 2) + 0.5;
          for (let i = 0; i < times * 3; i += 1) { cutU.push(round); cutY.push(middle.y); }
        };
        const middleOf = (corners3: [number, number, number][]) => at([
          corners3.reduce((sum, point) => sum + point[0], 0) / corners3.length,
          corners3.reduce((sum, point) => sum + point[1], 0) / corners3.length,
          corners3.reduce((sum, point) => sum + point[2], 0) / corners3.length,
        ]);

        for (const cell of facet.cells) {
          // A cell is convex, so a fan from its first corner triangulates it.
          const first = at(cell[0]);
          const fan = Math.max(0, cell.length - 2);
          for (let i = 1; i + 1 < cell.length; i += 1) {
            const second = at(cell[i]);
            const third = at(cell[i + 1]);
            cutData.push(first.x, first.y, first.z, second.x, second.y, second.z, third.x, third.y, third.z);
          }
          if (fan > 0) place(middleOf(cell), fan);
        }

        for (const flap of facet.flaps) {
          // The opening the petal bends out of, lit from inside like any other.
          const hingeA = at(flap[0]);
          const hingeB = at(flap[1]);
          const tip = at(flap[2]);
          cutData.push(hingeA.x, hingeA.y, hingeA.z, hingeB.x, hingeB.y, hingeB.z, tip.x, tip.y, tip.z);
          place(middleOf(flap), 1);

          // And the petal itself, turned about its hinge — Rodrigues, with the
          // sign chosen by which way it actually sends the tip. Guessing from
          // the winding would be wrong on half the facets.
          const axis = new THREE.Vector3(hingeB.x - hingeA.x, hingeB.y - hingeA.y, hingeB.z - hingeA.z).normalize();
          const arm = new THREE.Vector3(tip.x - hingeA.x, tip.y - hingeA.y, tip.z - hingeA.z);
          const out = new THREE.Vector3(normal.x, normal.y, normal.z);
          const turn = (angle: number) => arm.clone().applyAxisAngle(axis, angle);
          const away = turn(lift).sub(arm).dot(out) >= 0 ? lift : -lift;
          const bent = turn(away).add(new THREE.Vector3(hingeA.x, hingeA.y, hingeA.z));
          petalData.push(
            hingeA.x, hingeA.y, hingeA.z,
            hingeB.x, hingeB.y, hingeB.z,
            bent.x, bent.y, bent.z,
          );
        }
      }
    }

    const surface = new THREE.BufferGeometry();
    surface.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    if (uvs.length * 3 === pos.length * 2) {
      surface.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
    }
    // Only when every facet got one: a partly painted wall would show the
    // missing ones as black rather than as unprinted panel.
    if (paint.length === pos.length) {
      surface.setAttribute('color', new THREE.BufferAttribute(new Float32Array(paint), 3));
    }
    surface.computeVertexNormals();

    const lines = new THREE.BufferGeometry();
    lines.setAttribute('position', new THREE.BufferAttribute(new Float32Array(creaseData), 3));

    // Height is only meaningful against the pot it is on, and the pot changes
    // size as the assembly slider moves, so it is normalised here rather than
    // against anything fixed.
    const low = cutY.length > 0 ? Math.min(...cutY) : 0;
    const high = cutY.length > 0 ? Math.max(...cutY) : 1;
    const span = high - low > 1e-6 ? high - low : 1;
    const pixelU = new Float32Array(cutU);
    const pixelV = Float32Array.from(cutY, (y) => (y - low) / span);

    const openings = new THREE.BufferGeometry();
    openings.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cutData), 3));
    // Every strip is tinted per vertex, not only the addressable one: the
    // mounting falloff is a gradient up the wall, and a material colour is one
    // value for the whole mesh. For a white strip this bakes once and never
    // moves; for an addressable one it is frame zero of the mode, so the pot is
    // already in it rather than flashing white for a frame.
    const tinted = cutData.length > 0 && pixelU.length * 3 === cutData.length;
    if (tinted) {
      const glow = new THREE.Color(ledGlow(model.parameters.led));
      const tint = new Float32Array(cutData.length);
      for (let i = 0; i < pixelU.length; i += 1) {
        const reach = ledThrow(position, pixelV[i]);
        const [r, g, b] = addressable
          ? pixelColor(effect, pixelU[i], pixelV[i], 0, baseHsl)
          : [glow.r, glow.g, glow.b];
        tint[i * 3] = r * reach; tint[i * 3 + 1] = g * reach; tint[i * 3 + 2] = b * reach;
      }
      openings.setAttribute('color', new THREE.BufferAttribute(tint, 3));
    }

    const bent = new THREE.BufferGeometry();
    bent.setAttribute('position', new THREE.BufferAttribute(new Float32Array(petalData), 3));
    bent.computeVertexNormals();

    // Flat-shaded on purpose, both of them. The back of a composite panel is
    // mill-finish aluminium and a cut edge is a sawn core: neither is smooth,
    // and averaging normals across a groove wall would round off the one thing
    // these are here to show.
    const back = new THREE.BufferGeometry();
    back.setAttribute('position', new THREE.BufferAttribute(new Float32Array(backData), 3));
    back.computeVertexNormals();

    const edges = new THREE.BufferGeometry();
    edges.setAttribute('position', new THREE.BufferAttribute(new Float32Array(rimData), 3));
    edges.computeVertexNormals();

    return { wall: surface, back, edges, creases: lines, cutouts: openings, petals: bent, pixelU, pixelV, tinted };
  }, [shell, t, model.parameters.perfLift, model.parameters.led, addressable, effect, baseHsl, position, fills]);

  // Each geometry gets its own cleanup. Sharing one effect would dispose buffers
  // that are still mounted every time only the assembly slider moves.
  useEffect(() => () => { wall.dispose(); }, [wall]);
  useEffect(() => () => { back.dispose(); }, [back]);
  useEffect(() => () => { edges.dispose(); }, [edges]);
  useEffect(() => () => { creases.dispose(); }, [creases]);
  useEffect(() => () => { cutouts.dispose(); }, [cutouts]);
  useEffect(() => () => { petals.dispose(); }, [petals]);
  useEffect(() => () => { shell.liner?.dispose(); }, [shell.liner]);
  useEffect(() => () => { shell.base.dispose(); }, [shell.base]);
  useEffect(() => () => { shell.rim.dispose(); }, [shell.rim]);

  useFrame((_, delta) => {
    if (group.current && autoRotate.current) group.current.rotation.y += delta * 0.22;

    // The effect runs on the geometry that is already there: one pass over the
    // colour buffer a frame, nothing rebuilt. A solid colour has no tempo and
    // is left exactly as it was baked.
    if (!addressable || tempo <= 0) return;
    const tint = cutouts.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (!tint || tint.count !== pixelU.length) return;
    phase.current += delta * tempo;
    for (let i = 0; i < pixelU.length; i += 1) {
      const reach = ledThrow(position, pixelV[i]);
      const [r, g, b] = pixelColor(effect, pixelU[i], pixelV[i], phase.current, baseHsl);
      tint.setXYZ(i, r * reach, g * reach, b * reach);
    }
    tint.needsUpdate = true;
  });

  // A cured UV film is what you are actually looking at on a printed pot, and
  // the varnish pass is the whole difference between a matte one and a wet one.
  const printSkin = useMemo(
    () => (wall.getAttribute('color') ? { roughness: model.parameters.printVarnish ? 0.26 : 0.62 } : null),
    [wall, model.parameters.printVarnish],
  );
  // The collar is printed flat, in the palette's darkest tone — the frame round
  // the artwork, and the first thing seen from above.
  const plateColor = model.print ? collarColour(model.parameters) : accentColor;

  return (
    <group ref={group}>
      <mesh geometry={wall} frustumCulled={false}>
        <Skin stone={stoneSkin} print={printSkin} color={wallColor} finish={finish} />
      </mesh>
      {/* The back of the panel, with the V-grooves cut into it, and the material
          on show at every edge the cutter parted. Together these are the whole
          difference between a pot and a picture of a surface: the mouth and the
          foot stop being infinitely sharp, the seam reads as two edges meeting
          rather than one line, and the groove is visibly open on the flat blank
          and visibly shut once the fold has run. */}
      <mesh geometry={back} frustumCulled={false}>
        <meshStandardMaterial
          color={coreColor} metalness={finish.metalness} roughness={0.78}
          side={THREE.DoubleSide} flatShading
        />
      </mesh>
      <mesh geometry={edges} frustumCulled={false}>
        <meshStandardMaterial
          color={coreColor} metalness={finish.metalness} roughness={0.84}
          side={THREE.DoubleSide} flatShading
        />
      </mesh>
      {/* The drafting layer, and an imported image — everything printed OVER
          the fills. A decal on the same facets rather than a second colour in
          the same material: white line work cannot be had by multiplying a
          base colour, and multiplying is all one material can do. */}
      {artwork && (
        <mesh geometry={wall} frustumCulled={false} renderOrder={1}>
          <meshStandardMaterial
            map={artwork} transparent depthWrite={false}
            metalness={0} roughness={model.parameters.printVarnish ? 0.26 : 0.62}
            side={THREE.DoubleSide}
            polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2}
          />
        </mesh>
      )}
      {/* The light arriving through the wall. Unlit by the scene — it is a
          source, not a surface, so it holds its colour whatever the studio
          lighting and the finish are doing around it. */}
      <mesh geometry={cutouts} frustumCulled={false} renderOrder={1}>
        {/* Keyed on the strip: turning vertex colours on needs a fresh material,
            because three.js only recompiles the shader when one is built. */}
        <meshBasicMaterial
          key={tinted ? 'tinted' : 'plain'}
          color={tinted ? '#ffffff' : lightColor} vertexColors={tinted}
          side={THREE.DoubleSide} toneMapped={false}
        />
      </mesh>
      {/* The petals, still part of the wall and still in its material — they
          were never removed from it, only bent out of its plane. */}
      <mesh geometry={petals} frustumCulled={false} renderOrder={2}>
        <Skin stone={stoneSkin} print={printSkin} color={wallColor} finish={finish} />
      </mesh>
      {/* The soil box, opaque and matte, dropped in as the pot closes — it is
          fitted last on the bench too. */}
      {shell.liner && t > 0.62 && (
        <mesh geometry={shell.liner} frustumCulled={false}>
          <meshStandardMaterial
            color="#26282f" metalness={0} roughness={0.92} side={THREE.DoubleSide}
            transparent opacity={Math.min(1, (t - 0.62) / 0.28)}
          />
        </mesh>
      )}
      <mesh geometry={shell.base} position={shell.baseFlat.clone().lerp(shell.baseBuilt, t)} frustumCulled={false}>
        <Skin stone={stoneSkin} color={plateColor} finish={finish} flat={false} />
      </mesh>
      <mesh geometry={shell.rim} position={shell.rimFlat.clone().lerp(shell.rimBuilt, t)} frustumCulled={false}>
        <Skin stone={stoneSkin} color={plateColor} finish={finish} flat={false} />
      </mesh>
      <lineSegments geometry={creases} frustumCulled={false} renderOrder={2}>
        <lineBasicMaterial color="#12121a" transparent opacity={0.55} />
      </lineSegments>
      {/* The planting only makes sense once the collar is basically in place —
          it grows in over the last stretch of the slider rather than popping in. */}
      <group position={shell.rimFlat.clone().lerp(shell.rimBuilt, t)} scale={Math.max(0, Math.min(1, (t - 0.55) / 0.45))}>
        <Planting id={plant} radius={shell.openingRadius} />
      </group>
    </group>
  );
}

/** A photographed room behind the pot, built once per backdrop choice. */
function Backdrop({ backdrop, radius }: { backdrop: PlanterBackdrop; radius: number }) {
  const texture = useMemo(() => gradientTexture(backdrop), [backdrop]);
  useEffect(() => () => texture.dispose(), [texture]);
  // `CameraRig` sets the far clip plane from this same `radius` (about 9.7x it,
  // for this camera's fov) — sized well inside that, or the sphere is clipped
  // away and the backdrop silently does nothing.
  return (
    <mesh scale={radius * 5}>
      <sphereGeometry args={[1, 24, 16]} />
      <meshBasicMaterial map={texture} side={THREE.BackSide} depthWrite={false} fog={false} toneMapped={false} />
    </mesh>
  );
}

function PlanterPreview({ model, finish, customColor, plant, backdrop, assembly, view, viewportRef }: {
  model: PlanterModel; finish: PlanterFinish; customColor: string; plant: PlantId; backdrop: PlanterBackdrop;
  assembly: number; view: ViewAngle; viewportRef: React.RefObject<HTMLDivElement>;
}) {
  const autoRotate = useRef(true);
  const controls = useRef<any>(null);
  const [resetKey, setResetKey] = useState(0);
  const shell = usePlanterShell(model);
  const target = useMemo<[number, number, number]>(
    () => [0, model.parameters.height * shell.scale * 0.45, 0],
    [model.parameters.height, shell.scale],
  );

  const toggleFullscreen = () => {
    const element = viewportRef.current?.closest('.viewport');
    if (document.fullscreenElement) void document.exitFullscreen();
    else if (element) void (element as HTMLElement).requestFullscreen().catch(() => {});
  };

  return (
    <>
      <div className="three-tools">
        <button className="icon-button" aria-label="Reset view" title="Reset view" onClick={() => { autoRotate.current = true; setResetKey((key) => key + 1); }}><Rotate3D size={13} /></button>
        <button className="icon-button" aria-label="Fullscreen" title="Fullscreen" onClick={toggleFullscreen}><Maximize2 size={13} /></button>
      </div>
      <Canvas
        className="three-canvas"
        camera={{ fov: 34 }}
        dpr={[1, 1.75]}
        gl={{ antialias: true, alpha: false, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.15 }}
      >
        <Backdrop backdrop={backdrop} radius={shell.radius} />
        <StudioLights />
        <PlanterMesh model={model} finish={finish} customColor={customColor} plant={plant} assembly={assembly} autoRotate={autoRotate} />
        <ContactShadows position={[0, -0.002, 0]} opacity={backdrop.shadow} scale={POT_FIT * 3} blur={2.4} far={3} />
        <CameraRig direction={VIEW_DIRS[view]} radius={shell.radius} resetKey={resetKey} controls={controls} target={target} />
        <OrbitControls
          ref={controls}
          enablePan
          screenSpacePanning
          enableDamping
          dampingFactor={0.1}
          minDistance={shell.radius * 0.6}
          maxDistance={shell.radius * 8}
          onStart={() => { autoRotate.current = false; }}
        />
      </Canvas>
    </>
  );
}

// ---------------------------------------------------------------------------
// 2D
// ---------------------------------------------------------------------------

/**
 * The nested sheet, drawn to scale inside the stock it has to come out of. A
 * thumbnail drops the stock and the loose plates and shows the wall net alone —
 * at card size the creases are the only thing that tells two designs apart.
 */
function PlanterNet({ model, thumb = false, face = 'groove' }: {
  model: PlanterModel; thumb?: boolean; face?: PlanterFace;
}) {
  const { sheetWidth, sheetHeight } = model.parameters;
  // The net is turned onto the stock whichever way round it fits, so the stock
  // outline has to follow it rather than the other way about.
  const landscape = model.sheet.width > model.sheet.height;
  const stock = {
    width: landscape ? Math.max(sheetWidth, sheetHeight) : Math.min(sheetWidth, sheetHeight),
    height: landscape ? Math.min(sheetWidth, sheetHeight) : Math.max(sheetWidth, sheetHeight),
  };
  const wallPieces = model.pieces.filter((piece) => piece.id === 'wall' || piece.id.startsWith('band-'));
  // A thumbnail cares about the wall's shape, not where the nester landed it on
  // the stock sheet, so a banded design's strips are stacked compactly instead of
  // drawn at their (possibly far apart) nested position.
  const gap = Math.max(...wallPieces.map((piece) => piece.width)) * 0.05;
  let stackY = 0;
  const stacked = wallPieces.map((piece) => {
    const placed = { ...piece, x: 0, y: stackY };
    stackY += piece.height + gap;
    return placed;
  });
  const pieces = thumb ? stacked : model.pieces;
  // Only on the real sheet: a thumbnail restacks the bands to show the wall's
  // shape, and the facets would then be drawn where the parts no longer are.
  const printFills = useMemo(() => {
    const fills = model.print?.fills ?? [];
    if (thumb || fills.length === 0) return [];
    const stride = model.parameters.sides + 1;
    const perBand = model.parameters.sides * 2;
    return model.triangles.flatMap((triangle, index) => {
      const band = Math.floor(index / perBand);
      const flat = triangle.v.map(
        (id) => model.flatByBand[band][Math.floor(id / stride) - band][id % stride],
      ) as [Vec2, Vec2, Vec2];
      const inked = insetTriangle(flat, model.parameters.printGrout);
      return inked ? [{ index, points: inked, fill: fills[index] }] : [];
    });
  }, [model, thumb]);
  const width = thumb ? Math.max(...stacked.map((piece) => piece.width)) : Math.max(model.sheet.width, stock.width);
  const height = thumb ? stackY - gap : Math.max(model.sheet.height, stock.height);
  const weight = (thumb ? 0.006 : 0.0016) * Math.max(width, height);
  // The same reflection the exported file gets, in the same axis, so what is on
  // screen is what lands on the machine — including which hand the part is.
  const mirror = face === 'groove';
  const axis = thumb ? width : model.sheet.width;

  return (
    <svg
      viewBox={`${-weight} ${-weight} ${width + weight * 2} ${height + weight * 2}`}
      className={thumb ? 'thumb-svg' : undefined}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden={thumb}
    >
      <g transform={`translate(0,${height}) scale(1,-1)`} fill="none" strokeLinejoin="round" strokeLinecap="round">
        {!thumb && (
          <rect
            x="0" y="0" width={stock.width} height={stock.height}
            stroke="#2a2d3d" strokeWidth={weight} strokeDasharray={`${weight * 12} ${weight * 8}`}
          />
        )}
        {/* Everything on the board, reflected together when the drawing is for
            the groove face — including the artwork, which is on the far side
            from there and so really does read backwards. The stock stays outside
            this group: the sheet is what the parts are reflected inside, and a
            frame that moved with them would be describing a different sheet. */}
        <g transform={mirror ? `translate(${axis},0) scale(-1,1)` : undefined}>
        {/* The print, under the tool paths. The milling sheet and the print
            file are the same sheet in the same millimetres — that is the whole
            reason the artwork can be laid out on facets at all — so the one
            drawing carries both, with the ink already pulled back from every
            crease the cutter is about to put in. */}
        {!thumb && printFills.length > 0 && (
          <g id="print">
            {printFills.map((tile) => (
              <polygon
                key={tile.index}
                points={tile.points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ')}
                fill={tile.fill}
              />
            ))}
          </g>
        )}
        {pieces.map((piece) => {
          const { outline, folds, holes, flaps } = placedGeometry(piece);
          return (
            <g key={piece.id}>
              <polygon
                points={outline.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ')}
                fill="rgba(120,132,168,0.09)"
                stroke={FOLD_COLORS.cut} strokeWidth={weight} strokeDasharray={STROKE_DASH.cut}
              />
              {holes.map((hole, i) => (
                <polygon
                  key={i} points={hole.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ')}
                  fill="var(--surface-0, #0d0f16)"
                  stroke={FOLD_COLORS.cut} strokeWidth={weight} strokeDasharray={STROKE_DASH.cut}
                />
              ))}
              {flaps.map((flap, i) => (
                <polyline
                  key={`flap-${i}`}
                  points={flapSlit(flap as Triangle2, model.parameters.perfTool)
                    .map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ')}
                  fill="none"
                  stroke={FOLD_COLORS.cut} strokeWidth={weight} strokeDasharray={STROKE_DASH.cut}
                />
              ))}
              {folds.map((fold) => (
                <line
                  key={fold.id} x1={fold.x1} y1={fold.y1} x2={fold.x2} y2={fold.y2}
                  stroke={FOLD_COLORS[fold.kind]}
                  strokeWidth={weight * (thumb ? 0.7 : 0.85)}
                  strokeDasharray={thumb ? undefined : STROKE_DASH[fold.kind]}
                />
              ))}
            </g>
          );
        })}
        </g>
      </g>
    </svg>
  );
}

function PresetThumb({ parameters }: { parameters: PlanterParameters }) {
  const model = useMemo(() => buildPlanterModel(parameters), [parameters]);
  // A catalogue card is a picture of the pot, not a drawing for the bed, so it
  // is read the way the pot is read.
  return <PlanterNet model={model} thumb face="outside" />;
}

// ---------------------------------------------------------------------------

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function PlanterStudio({ onStatus }: { onStatus?: (status: StudioStatus) => void }) {
  const [parameters, setParameters] = useState<PlanterParameters>(
    () => ({ ...DEFAULT_PLANTER, ...PLANTER_PRESETS[0].parameters }),
  );
  const [presetId, setPresetId] = useState(PLANTER_PRESETS[0].id);

  const [finishId, setFinishId] = useState(PLANTER_FINISHES[2].id);
  const [customColor, setCustomColor] = useState('#c0392b');
  const [backdropId, setBackdropId] = useState(PLANTER_BACKDROPS[0].id);
  const [plant, setPlant] = useState<PlantId>('none');
  const [stoneFamily, setStoneFamily] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<PlanterCategory | 'all'>('all');
  const [view, setView] = useState<ViewAngle>("hero");
  /**
   * Which face the flat drawing is read on — and exported on, because the screen
   * has to show what the file carries or the toggle is worse than not having it.
   * Starts on the groove face: that is the one the board presents to the cutter,
   * and the outside view is the one that has to be asked for.
   */
  const [face, setFace] = useState<PlanterFace>("groove");
  /** Set when "Light me up" had to widen the collar to land the panel on it. */
  const [collarNote, setCollarNote] = useState<string | null>(null);
  /** The pattern family to come back to when the wall is switched on again. */
  const [family, setFamilyState] = useState<PlanterPerforation>('triangles');
  const [playing, setPlaying] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  /** What the last import did — the resolution it landed at, or why it did not. */
  const [artworkNote, setArtworkNote] = useState<string | null>(null);
  /**
   * The facet-angle effect's level, remembered while it is switched off.
   *
   * Off is `printShade: 0` and nothing else, because the engine has one lever
   * for this and a second one would be a second opinion about it. So the level
   * lives here instead — switch the effect back on and it comes back where it
   * was rather than at a default nobody chose.
   */
  const [shadeLevel, setShadeLevel] = useState(35);
  const viewportRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const finish = finishById(finishId);
  const backdrop = backdropById(backdropId);
  const style = getPlanterStyle(parameters.style);
  const model = useMemo(() => buildPlanterModel(parameters), [parameters]);
  // Read back off the model rather than kept beside it. The stock is a design
  // parameter now, so the pot's own thickness and the one quoted in the panel
  // are the same number by construction and cannot drift apart.
  const material = model.material;
  const stats = useMemo(() => getPlanterStats(model), [model]);
  const checks = useMemo(() => getPlanterChecks(model), [model]);
  const blocking = checks.some((check) => check.severity === 'error');
  const lit = isLitPlanter(parameters);
  const coat = model.stone;
  const job = model.print;
  const stoneShelf = useMemo(
    () => (stoneFamily === 'all' ? STONE_MATERIALS : STONE_MATERIALS.filter((item) => item.family === stoneFamily)),
    [stoneFamily],
  );
  const cutOuts = model.perfCells.reduce(
    (count, facet) => count + facet.cells.length + facet.flaps.length, 0,
  );
  // The collar carries two holes once the panel fits: the planting hole, and
  // the window. One means the panel was asked for and could not be landed.
  const panelCut = (model.pieces.find((piece) => piece.id === 'rim')?.holes.length ?? 0) > 1;
  const light = model.lighting;

  const filtered = PLANTER_PRESETS.filter((preset) =>
    (category === 'all' || preset.category === category)
    && (search.trim() === '' || `${preset.name} ${preset.note}`.toLowerCase().includes(search.trim().toLowerCase())));

  const update = useCallback(<K extends keyof PlanterParameters>(key: K, value: PlanterParameters[K]) => {
    setParameters((current) => ({ ...current, [key]: value }));
  }, []);

  /**
   * One click, on whatever is already on the bench.
   *
   * Everything the kit needs is measured off the design rather than typed in,
   * so this works on a pot somebody drew ten minutes ago without their having
   * to know that a panel wants a wide collar or that the cavity has to clear
   * the wall. The one thing it can change behind your back is the collar, and
   * that gets said out loud rather than done quietly.
   */
  const lightUp = useCallback(() => {
    const next = litPlanter(parameters);
    // Both of these are the button redrawing somebody else's numbers, so both
    // are said out loud. Silently widening a collar or turning a strip down is
    // how a generator stops being trusted.
    setCollarNote([
      next.rimWidth > parameters.rimWidth + 0.5
        ? `Collar widened from ${Math.round(parameters.rimWidth)} to ${Math.round(next.rimWidth)} mm, to seat the panel`
        : '',
      next.ledBrightness < 100
        ? `Strip set to ${Math.round(next.ledBrightness)}%, which is what this panel carries through ${Math.round(next.ledHours)} h`
        : '',
    ].filter(Boolean).join(' · ') || null);
    setParameters(next);
  }, [parameters]);

  const lightOff = useCallback(() => {
    setCollarNote(null);
    setParameters((current) => unlitPlanter(current));
  }, []);

  /**
   * The toolbar picks the size; 0 is the button that leaves the wall solid.
   * Picking a size on a solid wall turns the pattern back on in whichever
   * family was last chosen, so the row never feels like a dead control.
   */
  const setCutSize = useCallback((density: number) => {
    setParameters((current) => (density === 0
      ? { ...current, perforation: 'none' as const }
      : {
        ...current,
        perforation: current.perforation === 'none' ? family : current.perforation,
        perfDensity: density,
      }));
  }, [family]);

  const setFamily = useCallback((next: PlanterPerforation) => {
    setFamilyState(next);
    setParameters((current) => ({ ...current, perforation: next }));
  }, []);

  /**
   * Another pot, same design.
   *
   * The seed is the whole of the draw, so this is the only thing the button
   * touches — the palette, the rule and every dimension stay exactly as they
   * were, and the same number will bring this pot back.
   */
  const reroll = useCallback(() => {
    setParameters((current) => ({ ...current, printSeed: Math.floor(Math.random() * 999_999) }));
  }, []);

  /**
   * A customer's own artwork, read in the browser and never sent anywhere.
   *
   * It is kept as a data URL because that is what ends up inside the exported
   * print file: one self-contained SVG the shop can drop on a RIP, with no
   * second file to lose. That is also why the size is capped — the file has to
   * stay openable at the other end.
   */
  const loadArtwork = useCallback((file: File | null) => {
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) {
      setArtworkNote('PNG or JPEG only — that file was not loaded.');
      return;
    }
    if (file.size > MAX_ARTWORK_BYTES) {
      setArtworkNote(`That file is ${(file.size / 1e6).toFixed(1)} MB and the limit is ${MAX_ARTWORK_BYTES / 1e6} MB — it goes whole into the print file, and one that heavy stops opening at the other end.`);
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setArtworkNote('The file could not be read.');
    reader.onload = () => {
      const url = String(reader.result ?? '');
      setParameters((current) => ({ ...current, print: 'image', printImage: url }));
      // What the shop actually needs to know about a supplied image: not how
      // many pixels it has, but how many it has per millimetre of pot.
      const probe = new Image();
      probe.onload = () => {
        const box = wallNetBox(model);
        const acrossMm = Math.max(box.maxX - box.minX, 1);
        const dpi = probe.width / (acrossMm / 25.4);
        setArtworkNote(
          `${probe.width}×${probe.height} px across ${Math.round(acrossMm)} mm of net — ${Math.round(dpi)} DPI`
          + (dpi < 150 ? ' · under 150 DPI it will print soft' : ' · enough for print'),
        );
      };
      probe.onerror = () => setArtworkNote('The file loaded but did not open as an image.');
      probe.src = url;
    };
    reader.readAsDataURL(file);
  }, [model]);

  const startFromScratch = useCallback(() => {
    setPresetId(BLANK_PLANTER.id);
    setParameters({ ...DEFAULT_PLANTER, ...BLANK_PLANTER.parameters });
    setPlaying(false);
  }, []);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  // Frame-locked, so assembly plays at a real rate and stops with the tab.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const elapsed = (now - last) / 1000;
      last = now;
      setParameters((current) => {
        const next = current.assembly + elapsed * 34;
        return { ...current, assembly: next >= 100 ? 0 : next };
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  useEffect(() => { if (reducedMotion) setPlaying(false); }, [reducedMotion]);

  const readout = `${parameters.footprint === 'rectangle' ? 'Rectangle' : `${parameters.sides} sides`} · ${parameters.rows} ${parameters.rows === 1 ? 'band' : 'bands'}${model.parts.length > 1 ? ` · ${model.parts.length} parts` : ''}`;
  useEffect(() => {
    onStatus?.({ blocking, readout: [material.shortName, readout] });
  }, [onStatus, blocking, material.shortName, readout]);

  const fileStem = `dxf-ac3d-planter-${presetId}-${parameters.sides}s-${Math.round(parameters.height)}mm`;
  // In the name, because a DXF is geometry and carries no note saying which way
  // round it is. Two files that cut mirror-image parts must not share a name.
  const faceStem = `${fileStem}-${face === 'groove' ? 'mirrored-groove' : 'outside'}`;

  return (
    <>
      <aside className="panel left-panel">
        <div className="sidebar-section">
          <div className="panel-title">Planter library <span className="tech-data">{filtered.length}/{PLANTER_PRESETS.length}</span></div>
          <div className="pattern-search">
            <Search size={13} aria-hidden="true" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search planters…" aria-label="Search planters" />
          </div>
          <div className="category-pills" role="group" aria-label="Filter by category">
            {PLANTER_CATEGORIES.map((item) => (
              <button key={item.id} className={`pill ${category === item.id ? 'active' : ''}`} aria-pressed={category === item.id} onClick={() => setCategory(item.id)}>{item.label}</button>
            ))}
          </div>
          <div className="pattern-grid">
            <button
              className={`pattern-card pattern-card-blank ${presetId === BLANK_PLANTER.id ? 'selected' : ''}`}
              aria-pressed={presetId === BLANK_PLANTER.id}
              onClick={startFromScratch}
            >
              <span className="pattern-thumb"><PresetThumb parameters={{ ...DEFAULT_PLANTER, ...BLANK_PLANTER.parameters }} /></span>
              <strong>{BLANK_PLANTER.name}</strong>
              <span className="pattern-meta"><i className="difficulty-dot" />{BLANK_PLANTER.note}</span>
            </button>
            {filtered.map((preset) => {
              const merged = { ...DEFAULT_PLANTER, ...preset.parameters };
              return (
                <button
                  key={preset.id}
                  className={`pattern-card difficulty-${getPlanterStyle(preset.parameters.style).difficulty.toLowerCase()} ${preset.id === presetId ? 'selected' : ''}`}
                  aria-pressed={preset.id === presetId}
                  onClick={() => { setPresetId(preset.id); setParameters(merged); setPlaying(false); }}
                >
                  <span className="pattern-thumb"><PresetThumb parameters={merged} /></span>
                  <strong>{preset.name}</strong>
                  <span className="pattern-meta">
                    <i className="difficulty-dot" />
                    {merged.footprint === 'rectangle' ? `${Math.round(merged.topWidth)}×${Math.round(merged.topLength)}` : `${merged.sides} sides`} · {Math.round(merged.height)} mm
                  </span>
                </button>
              );
            })}
            {filtered.length === 0 && <p className="empty-library">No planters match “{search}”</p>}
          </div>
        </div>

        <div className="sidebar-section">
          <div className="panel-title">Wall style <span>{style.difficulty}</span></div>
          <div className="select-wrap">
            <label className="sr-only" htmlFor="planter-style">Wall style</label>
            <select id="planter-style" value={parameters.style} onChange={(event) => update('style', event.target.value as PlanterStyleId)}>
              {PLANTER_STYLES.map((item) => <option key={item.id} value={item.id}>{item.name} — {item.subtitle}</option>)}
            </select>
          </div>
          <p className="footnote">{style.description}</p>
        </div>

        <div className="sidebar-section">
          <div className="panel-title">Footprint &amp; build <SlidersHorizontal size={13} aria-hidden="true" /></div>
          <div className="category-pills" role="group" aria-label="Footprint">
            <button className={`pill ${parameters.footprint === 'polygon' ? 'active' : ''}`} aria-pressed={parameters.footprint === 'polygon'} onClick={() => update('footprint', 'polygon' as PlanterFootprint)}>Polygon</button>
            <button className={`pill ${parameters.footprint === 'rectangle' ? 'active' : ''}`} aria-pressed={parameters.footprint === 'rectangle'} onClick={() => update('footprint', 'rectangle' as PlanterFootprint)}>Rectangle / box</button>
          </div>
          <div className="category-pills" role="group" aria-label="Construction">
            <button className={`pill ${parameters.construction === 'single-sheet' ? 'active' : ''}`} aria-pressed={parameters.construction === 'single-sheet'} onClick={() => update('construction', 'single-sheet' as PlanterConstruction)}>Single sheet</button>
            <button className={`pill ${parameters.construction === 'split' ? 'active' : ''}`} aria-pressed={parameters.construction === 'split'} onClick={() => update('construction', 'split' as PlanterConstruction)}>Split (auto)</button>
            <button className={`pill ${parameters.construction === 'banded' ? 'active' : ''}`} aria-pressed={parameters.construction === 'banded'} onClick={() => update('construction', 'banded' as PlanterConstruction)}>Banded (riveted)</button>
          </div>
          <p className="footnote">
            {parameters.construction === 'banded'
              ? 'Each band is its own strip, riveted ring to ring — always works, and usually a rivet line or two more than the pot needs.'
              : parameters.construction === 'split'
                ? `Cuts only the rings that carry the curvature; the rest stay creases. ${splitNote(model)}`
                : 'The whole wall folds from one blank. Fine for taper, stagger, twist and rhythm; curvature needs a split.'}
          </p>
        </div>

        <div className="sidebar-section">
          <div className="panel-title">Pot dimensions <SlidersHorizontal size={13} aria-hidden="true" /></div>
          {parameters.footprint === 'rectangle' ? (
            <>
              <NumberField label="Mouth width" value={parameters.topWidth} suffix="mm" min={60} max={4000} onChange={(value) => update('topWidth', value)} />
              <NumberField label="Mouth length" value={parameters.topLength} suffix="mm" min={60} max={4000} onChange={(value) => update('topLength', value)} />
              <NumberField label="Foot width" value={parameters.bottomWidth} suffix="mm" min={60} max={4000} onChange={(value) => update('bottomWidth', value)} />
              <NumberField label="Foot length" value={parameters.bottomLength} suffix="mm" min={60} max={4000} onChange={(value) => update('bottomLength', value)} />
            </>
          ) : (
            <>
              <NumberField label="Top ⌀ across corners" value={parameters.topDiameter} suffix="mm" min={60} max={1500} onChange={(value) => update('topDiameter', value)} />
              <NumberField label="Foot ⌀ across corners" value={parameters.bottomDiameter} suffix="mm" min={60} max={1500} onChange={(value) => update('bottomDiameter', value)} />
              <SliderField label="Sides" value={parameters.sides} min={3} max={12} onChange={(value) => update('sides', value)} />
            </>
          )}
          <NumberField label="Height" value={parameters.height} suffix="mm" min={60} max={2000} onChange={(value) => update('height', value)} />
          <SliderField label="Facet bands" value={parameters.rows} min={1} max={8} onChange={(value) => update('rows', value)} />
          <SliderField label="Band rhythm" value={parameters.rhythm} min={0} max={60} step={2} suffix="%" onChange={(value) => update('rhythm', value)} />
          <SliderField label="Twist" value={parameters.twist} min={-90} max={90} step={2} suffix="°" onChange={(value) => update('twist', value)} />
          <SliderField label="Bulge" value={parameters.bulge} min={-45} max={60} step={1} suffix="%" onChange={(value) => update('bulge', value)} />
          <p className="field-hint tech-data">
            {model.developmentError > 0.8
              ? `${model.developmentError.toFixed(1)} mm of stretch — Split builds this in ${planterSplit(model).length} parts`
              : `Develops flat to ${model.developmentError.toFixed(2)} mm`}
          </p>
        </div>

        <div className="sidebar-section">
          <div className="panel-title">Fittings <span>Assembly</span></div>
          <SliderField label="Seam tab" value={parameters.tabWidth} min={0} max={80} step={1} suffix="mm" onChange={(value) => update('tabWidth', value)} />
          {model.joints > 0 && (
            <SliderField label="Joint tab" value={parameters.jointTab} min={0} max={80} step={1} suffix="mm" onChange={(value) => update('jointTab', value)} />
          )}
          <SliderField label="Collar width" value={parameters.rimWidth} min={10} max={160} step={1} suffix="mm" onChange={(value) => update('rimWidth', value)} />
          <SliderField label="Base inset" value={parameters.baseInset} min={0} max={20} step={1} suffix="mm" onChange={(value) => update('baseInset', value)} />
          <SliderField label="Base tab" value={parameters.baseTab} min={0} max={60} step={1} suffix="mm" onChange={(value) => update('baseTab', value)} />
          <SliderField label="Collar tab" value={parameters.rimTab} min={0} max={60} step={1} suffix="mm" onChange={(value) => update('rimTab', value)} />
          <p className="field-hint tech-data">Planting hole {stats.topOpening}</p>
        </div>

        <div className="sidebar-section">
          <div className="panel-title">Solar lighting <Lightbulb size={13} aria-hidden="true" /></div>
          <button type="button" className={`light-me ${lit ? 'on' : ''}`} onClick={lit ? lightOff : lightUp}>
            <Lightbulb size={16} aria-hidden="true" />
            {lit ? 'Turn the lighting off' : 'Light me up'}
          </button>
          <p className="footnote">
            {lit
              ? `The kit is fitted to this design: an inner box separating the soil from the light cavity, cut-outs milled through the wall for the light to leave by, a panel window in the collar${light ? `, and a ${LED_COPY[light.led].short} strip in the cavity` : ''}.`
              : 'One click fits the whole kit to the pot on the bench — an inner box separating the soil from the light cavity, cut-outs milled through the wall, a panel window in the collar and a warm white strip in the cavity. Every dimension, down to what it is run at, is measured off the design itself.'}
          </p>
          {collarNote && <p className="field-hint tech-data">{collarNote}</p>}
        </div>

        {lit && (<>
        <div className="sidebar-section">
          <div className="panel-title">LED strip <span>what is in the cavity</span></div>
          <div className="category-pills" role="group" aria-label="LED strip">
            {LEDS.map((id) => (
              <button
                key={id}
                type="button"
                className={`pill led ${parameters.led === id ? 'active' : ''}`}
                aria-pressed={parameters.led === id}
                onClick={() => update('led', id)}
              >
                <i className="led-dot" style={ledSwatch(id)} aria-hidden="true" />
                {LED_COPY[id].short}
              </button>
            ))}
          </div>
          <p className="footnote">{LED_COPY[parameters.led].note}</p>
          <div className="category-pills" role="group" aria-label="Strip position">
            {LED_POSITIONS.map((id) => (
              <button
                key={id}
                type="button"
                className={`pill ${parameters.ledPosition === id ? 'active' : ''}`}
                aria-pressed={parameters.ledPosition === id}
                onClick={() => update('ledPosition', id)}
              >{LED_POSITION_COPY[id].name}</button>
            ))}
          </div>
          <p className="footnote">{LED_POSITION_COPY[parameters.ledPosition].note}</p>
          <div className="category-pills" role="group" aria-label="LED density">
            {LED_DENSITIES.map((step) => (
              <button
                key={step}
                type="button"
                className={`pill ${parameters.ledDensity === step ? 'active' : ''}`}
                aria-pressed={parameters.ledDensity === step}
                onClick={() => update('ledDensity', step)}
              >{step}/m</button>
            ))}
          </div>
          <SliderField label="Runs round the cavity" value={parameters.ledRuns} min={1} max={6} step={1} onChange={(value) => update('ledRuns', value)} />
          <SliderField label="Run at" value={parameters.ledBrightness} min={5} max={100} step={5} suffix="%" onChange={(value) => update('ledBrightness', value)} />
          <SliderField label="Hours after dark" value={parameters.ledHours} min={1} max={14} step={1} suffix=" h" onChange={(value) => update('ledHours', value)} />
          <p className="field-hint tech-data">
            {light
              ? `${light.leds} emitters on ${(light.length / 1000).toFixed(2)} m of strip · ${light.watts.toFixed(1)} W as set, ${light.peakWatts.toFixed(1)} W flat out`
              : 'No strip specified — the cavity is left empty'}
          </p>
          <p className="footnote">
            A denser strip reads as a line of light rather than a string of dots, and costs proportionally more current — every emitter draws its own. The strip bonds to the outside face of the liner and looks at the cut-outs: one run washes up from the bottom, two or more light the full height evenly.
          </p>
        </div>

        {parameters.led === 'ws2812' && (
        <div className="sidebar-section">
          <div className="panel-title">Effect mode <span>{getLedEffect(parameters.ledEffect).name}</span></div>
          <p className="footnote">Every pixel is addressed on its own. The effect runs round the pot, cut-out after cut-out.</p>
          <div className="category-pills" role="group" aria-label="Effect mode">
            {LED_EFFECTS.map((mode) => (
              <button
                key={mode.id}
                type="button"
                className={`pill ${parameters.ledEffect === mode.id ? 'active' : ''}`}
                aria-pressed={parameters.ledEffect === mode.id}
                onClick={() => update('ledEffect', mode.id)}
              >{mode.name}</button>
            ))}
          </div>
          <SliderField label="Speed" value={parameters.ledSpeed} min={5} max={100} step={5} suffix="%" onChange={(value) => update('ledSpeed', value)} />
          <div className="led-colours" role="group" aria-label="Base colour">
            {LED_BASE_COLOURS.map((hex) => (
              <button
                key={hex}
                type="button"
                className={`led-colour ${parameters.ledColor.toLowerCase() === hex ? 'active' : ''}`}
                style={{ background: hex }}
                title={hex}
                aria-label={hex}
                aria-pressed={parameters.ledColor.toLowerCase() === hex}
                onClick={() => update('ledColor', hex)}
              />
            ))}
            <input
              type="color" className="led-colour picker" value={parameters.ledColor}
              aria-label="Any colour" onChange={(event) => update('ledColor', event.target.value)}
            />
          </div>
          <div className="category-pills" role="group" aria-label="Controller">
            {LED_CONTROLLER_ORDER.map((id) => (
              <button
                key={id}
                type="button"
                className={`pill ${parameters.ledController === id ? 'active' : ''}`}
                aria-pressed={parameters.ledController === id}
                onClick={() => update('ledController', id)}
              >{LED_CONTROLLERS[id]}</button>
            ))}
          </div>
          <p className="field-hint tech-data">
            {light && light.effect !== 'static'
              ? `The mode averages ${Math.round(light.duty * 100)}% of the strip lit — that is what the battery and the runtime are sized on. The driver is still sized for every pixel white.`
              : 'Solid colour — the strip is fully lit the whole time.'}
          </p>
          <p className="footnote">
            The mode lives in the controller, not in the panel. The cut file is identical in every one of them — what changes here is what gets loaded onto the controller, and how much power it actually drinks.
          </p>
        </div>
        )}

        {light && (
        <div className="sidebar-section">
          <div className="panel-title">Electrical <span>{light.volts} V</span></div>
          <dl className="spec-list tech-data">
            <div><dt>Strip</dt><dd>{(light.length / 1000).toFixed(2)} m · {light.runs} {light.runs === 1 ? 'run' : 'runs'}</dd></div>
            <div><dt>Emitters</dt><dd>{light.leds} × {LED_COPY[light.led].short}</dd></div>
            <div><dt>Draw</dt><dd>{light.watts.toFixed(1)} W · {light.peakWatts.toFixed(1)} W flat out</dd></div>
            <div><dt>Current</dt><dd>{light.amps.toFixed(2)} A at {light.volts} V</dd></div>
            <div><dt>Supply</dt><dd>{light.volts} V · {light.supply} W</dd></div>
            <div><dt>Feed points</dt><dd>{light.feeds} · {light.addressable ? 'data at one' : 'two wires'}</dd></div>
            <div><dt>Output</dt><dd>≈ {Math.round(light.lumens)} lm</dd></div>
            <div><dt>Solar harvest</dt><dd>{light.harvest > 0 ? `${light.harvest.toFixed(1)} Wh/day` : 'no panel in the collar'}</dd></div>
            <div><dt>Runs for</dt><dd>{light.harvest > 0 ? `${light.runtime.toFixed(1)} h on a day's charge` : 'mains or pack'}</dd></div>
            <div><dt>Night battery</dt><dd>{light.battery.toFixed(1)} Wh · {light.cells} × 18650</dd></div>
          </dl>
          <p className="footnote">
            The supply carries a fifth over the flat-out draw — one run at its own ceiling gets hot and dies early. Current and lumens are quoted at full white; Draw is what this pot actually pulls at {Math.round(parameters.ledBrightness)}%. Harvest assumes a {Math.round(parameters.solarWidth)} × {Math.round(parameters.solarLength)} mm panel lying flat on an average day, charging losses included — not a summer one.
          </p>
        </div>
        )}

        <div className="sidebar-section">
          <div className="panel-title">Cut-out pattern <span>milled</span></div>
          <div className="category-pills" role="group" aria-label="Cut-out pattern">
            <button
              className={`pill ${parameters.perforation === 'triangles' ? 'active' : ''}`}
              aria-pressed={parameters.perforation === 'triangles'}
              onClick={() => setFamily('triangles')}
            >Triangles</button>
            <button
              className={`pill ${parameters.perforation === 'dots' ? 'active' : ''}`}
              aria-pressed={parameters.perforation === 'dots'}
              onClick={() => setFamily('dots')}
            >Scattered dots</button>
            <button
              className={`pill ${parameters.perforation === 'shards' ? 'active' : ''}`}
              aria-pressed={parameters.perforation === 'shards'}
              onClick={() => setFamily('shards')}
            >Shards</button>
            <button
              className={`pill ${parameters.perforation === 'grid' ? 'active' : ''}`}
              aria-pressed={parameters.perforation === 'grid'}
              onClick={() => setFamily('grid')}
            >Hole grid</button>
            <button
              className={`pill ${parameters.perforation === 'foldout' ? 'active' : ''}`}
              aria-pressed={parameters.perforation === 'foldout'}
              onClick={() => setFamily('foldout')}
            >Cut &amp; fold</button>
          </div>
          <PatternPicker
            label="Cut-out size"
            value={parameters.perforation === 'none' ? 0 : parameters.perfDensity}
            options={PERF_SIZES}
            opening={parameters.perfOpening / 100}
            family={parameters.perforation}
            picked={parameters.perfPicked}
            onChange={setCutSize}
          />
          <SliderField
            label="Material removed" value={parameters.perfOpening} min={4} max={90} step={2} suffix="%"
            onChange={(value) => update('perfOpening', value)}
          />
          <p className="field-hint tech-data">
            {cutOuts > 0 ? `${Math.round(model.perfOpenArea * 100)}% open · ${cutOuts} cut-outs` : 'Wall left solid'}
          </p>
          <p className="footnote">
            {({
              dots: 'Mixed diameters scattered automatically across each facet — the large discs land first and the small ones fill in around them. The scatter is the same on every run, so what you approved is what gets cut. ',
              shards: 'Right triangles on a grid, each turned at random and most of the grid left empty, so the grid underneath never shows. ',
              grid: 'An even field of equal holes, staggered row to row — the plain industrial perforation, good on facets that should not pull the eye. ',
              triangles: 'A triangle lattice cut from the same triangles the wall itself is made of. ',
              foldout: 'Cut and fold — petals severed on two edges and left hinged on the third. Nothing leaves the sheet: the part weighs the same as it did before, and the opening is made by the bend itself. ',
            } as Record<string, string>)[parameters.perforation] ?? ''}
            Every cut-out is laid out inside one facet and never crosses a crease. Two separate levers:
            <b> material removed</b> decides how much of the panel is cut, <b>pattern fineness</b> decides
            how many pieces it is cut into. Composite carries its load in two thin skins, so a decorative
            cut-out stays low — the wall has to stay a wall.
          </p>
        </div>

        <div className="sidebar-section">
          <div className="panel-title">Milling <span>shop dimensions</span></div>
          <SliderField label="Pattern fineness" value={parameters.perfDensity} min={1} max={8} step={1} onChange={(value) => update('perfDensity', value)} />
          {parameters.perforation === 'triangles' && (
            <>
              <SliderField
                label="Triangles cut" value={parameters.perfPicked} min={0}
                max={parameters.perfDensity * parameters.perfDensity} step={1}
                onChange={(value) => update('perfPicked', value)}
              />
              <p className="field-hint tech-data">
                {parameters.perfPicked > 0
                  ? `${parameters.perfPicked} of ${parameters.perfDensity * parameters.perfDensity} triangles per facet`
                  : `all ${parameters.perfDensity * parameters.perfDensity} triangles per facet`}
              </p>
            </>
          )}
          <SliderField label="Web between cut-outs" value={parameters.perfWeb} min={3} max={40} step={1} suffix=" mm" onChange={(value) => update('perfWeb', value)} />
          <SliderField label="Border at the creases" value={parameters.perfMargin} min={5} max={80} step={1} suffix=" mm" onChange={(value) => update('perfMargin', value)} />
          <SliderField label="Cutter diameter" value={parameters.perfTool} min={1} max={20} step={1} suffix=" mm" onChange={(value) => update('perfTool', value)} />
          <SliderField label="Solid skirt at the foot" value={parameters.perfSkirt} min={0} max={Math.round(parameters.height)} step={5} suffix=" mm" onChange={(value) => update('perfSkirt', value)} />
          <SliderField label="Dissolve height" value={parameters.perfFade} min={0} max={Math.round(parameters.height)} step={5} suffix=" mm" onChange={(value) => update('perfFade', value)} />
          {parameters.perforation === 'foldout' && (
            <>
              <SliderField label="Bend angle" value={parameters.perfLift} min={0} max={90} step={1} suffix="°" onChange={(value) => update('perfLift', value)} />
              <p className="field-hint tech-data">
                Bent by hand — the cut file is identical at any angle. This drives the preview and the note that ships with the drawing.
              </p>
            </>
          )}
          <p className="field-hint tech-data">
            {parameters.perfFade > 0
              ? `Solid base, pattern arriving over ${Math.round(parameters.perfFade)} mm above the skirt`
              : 'Pattern starts abruptly at the skirt line'}
          </p>
          <p className="field-hint tech-data">
            Corners drawn at {(parameters.perfTool / 2).toFixed(1)} mm — exactly what the mill leaves
            {model.perfDropped > 0 ? ` · ${model.perfDropped} cells left solid` : ''}
          </p>
        </div>

        <div className="sidebar-section">
          <div className="panel-title">Inner box <span>soil barrier</span></div>
          <SliderField label="Light cavity" value={parameters.cavity} min={6} max={60} step={1} suffix=" mm" onChange={(value) => update('cavity', value)} />
          <p className="field-hint tech-data">
            {model.liner
              ? `${Math.round(model.liner.height)} mm tall · holds ${model.liner.litres.toFixed(1)} L of soil · gap ${Math.round(parameters.cavity)}–${Math.round(model.liner.mouthGap)} mm`
              : 'No room for a box at this cavity — narrow it, or widen the pot'}
          </p>
          <p className="footnote">
            The box is a plain prism standing on the pot&apos;s floor. Soil goes in it, the strip runs in the
            cavity around it, and both floors are drilled to drain so water never sits in the light cavity.
          </p>
        </div>

        <div className="sidebar-section">
          <div className="panel-title">Solar panel <span>in the collar</span></div>
          <NumberField label="Panel width" value={parameters.solarWidth} suffix=" mm" min={30} max={600} onChange={(value) => update('solarWidth', value)} />
          <NumberField label="Panel length" value={parameters.solarLength} suffix=" mm" min={30} max={600} onChange={(value) => update('solarLength', value)} />
          <p className="field-hint tech-data">
            {panelCut
              ? `Window cut ${Math.round(parameters.solarWidth) - 12} × ${Math.round(parameters.solarLength) - 12} mm — the panel beds from beneath and sits on the lip`
              : `No window cut — the collar needs at least ${Math.ceil(parameters.solarLength + 16)} mm`}
          </p>
        </div>
        </>)}

        <div className="sidebar-section">
          <div className="panel-title">Material <span>Stock</span></div>
          <div className="select-wrap">
            <label className="sr-only" htmlFor="planter-material">Material</label>
            <select id="planter-material" value={parameters.material} onChange={(event) => update("material", event.target.value as MaterialId)}>
              {MATERIALS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </div>
          <NumberField label="Sheet width" value={parameters.sheetWidth} suffix="mm" min={300} max={6000} onChange={(value) => update('sheetWidth', value)} />
          <NumberField label="Sheet height" value={parameters.sheetHeight} suffix="mm" min={300} max={6000} onChange={(value) => update('sheetHeight', value)} />
          <dl className="spec-list tech-data">
            <div><dt>Thickness</dt><dd>{material.thickness} mm</dd></div>
            <div><dt>Max. bend</dt><dd>{material.maxBendAngle}°</dd></div>
            <div><dt>Method</dt><dd>{material.foldMethod === 'v-groove' ? 'V-groove' : 'Heat bend'}</dd></div>
            <div><dt>Holds</dt><dd>{model.solid.litres.toFixed(1)} L</dd></div>
          </dl>
          <p className="field-hint">
            {`Measured inside the wall and off the floor. A shell with no thickness would have promised ${model.solid.surfaceLitres.toFixed(1)} L — ${((model.solid.surfaceLitres / model.solid.litres - 1) * 100).toFixed(1)}% more than it holds.`}
          </p>
        </div>

        <div className="sidebar-section">
          <div className="panel-title">Groove <span>the bit and the fold</span></div>
          {model.groove.heatBent ? (
            <p className="field-hint">
              {`${material.shortName} is never grooved — every crease is bent hot over a ${material.minRadius} mm former, so there is no bit to fit.`}
            </p>
          ) : (<>
            <div className="category-pills" role="group" aria-label="V-bit">
              {V_BITS.map((bit) => (
                <button
                  key={bit}
                  type="button"
                  className={`pill ${parameters.vBitAngle === bit ? 'active' : ''}`}
                  aria-pressed={parameters.vBitAngle === bit}
                  onClick={() => update('vBitAngle', bit)}
                >
                  {bit === 0 ? 'Auto' : `${bit}°`}
                </button>
              ))}
            </div>
            <dl className="spec-list tech-data">
              <div><dt>Groove depth</dt><dd>{model.groove.depth.toFixed(1)} mm</dd></div>
              <div><dt>Width at the back</dt><dd>{model.groove.width.toFixed(1)} mm</dd></div>
              <div><dt>Skin left</dt><dd>{model.groove.skin.toFixed(1)} mm</dd></div>
              <div><dt>Steepest crease</dt><dd>{model.maxBend.toFixed(0)}°</dd></div>
            </dl>
            <p className="field-hint">
              {parameters.vBitAngle === 0
                ? `A groove shuts on itself after turning through its own included angle, so the bit IS the fold rather than a setting beside it. On Auto each crease gets the angle it needs and the DXF layer name carries it: ${grooveLayerSummary(model)}.`
                : `One ${parameters.vBitAngle}° bit for the whole job. A groove shuts after turning through its own angle, so this bit makes a ${parameters.vBitAngle}° fold and nothing else — the checks say which creases it misses.`}
            </p>
          </>)}
        </div>

        <div className="sidebar-section">
          <div className="panel-title">Finish &amp; scene <span>Preview</span></div>
          <div className="finish-swatches" role="group" aria-label="Surface finish">
            {PLANTER_FINISHES.map((item) => (
              <button
                key={item.id}
                className={`finish-swatch ${finishId === item.id ? 'active' : ''}`}
                style={{ background: item.custom ? customColor : item.color }}
                aria-pressed={finishId === item.id}
                aria-label={item.name}
                title={item.name}
                onClick={() => setFinishId(item.id)}
              />
            ))}
          </div>
          {finish.custom && (
            <div className="color-input-row">
              <input
                type="color" id="planter-custom-color" value={customColor}
                onChange={(event) => setCustomColor(event.target.value)}
              />
              <label htmlFor="planter-custom-color">{finish.name} — pick any colour</label>
            </div>
          )}
          <p className="footnote">{finish.name} — the fabrication material above still decides thickness, bend radius and weight.</p>
          <div className="category-pills" role="group" aria-label="Backdrop">
            {PLANTER_BACKDROPS.map((item) => (
              <button key={item.id} className={`pill ${backdropId === item.id ? 'active' : ''}`} aria-pressed={backdropId === item.id} onClick={() => setBackdropId(item.id)}>{item.name}</button>
            ))}
          </div>
          <div className="select-wrap" style={{ marginTop: 'var(--space-4)' }}>
            <label className="sr-only" htmlFor="planter-planting">Planting</label>
            <select id="planter-planting" value={plant} onChange={(event) => setPlant(event.target.value as PlantId)}>
              {PLANT_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </div>
        </div>

        <div className="sidebar-section">
          <div className="panel-title">Natural texture <Mountain size={13} aria-hidden="true" /></div>
          <p className="field-hint">
            Forty stones from the DXF-STONE catalogue, painted on by hand after the pot is
            folded. Nothing here moves a cut line — the flat file exports byte for byte the
            same with a stone on it and without one.
          </p>
          <div className="category-pills" role="group" aria-label="Stone family">
            <button
              type="button"
              className={`pill ${stoneFamily === 'all' ? 'active' : ''}`}
              aria-pressed={stoneFamily === 'all'}
              onClick={() => setStoneFamily('all')}
            >All</button>
            {STONE_FAMILIES.map((id) => (
              <button
                key={id}
                type="button"
                className={`pill ${stoneFamily === id ? 'active' : ''}`}
                aria-pressed={stoneFamily === id}
                onClick={() => setStoneFamily(id)}
              >{id}</button>
            ))}
          </div>
          <div className="stone-grid" role="group" aria-label="Stone catalogue">
            <button
              type="button"
              className={`stone-chip bare ${parameters.stone === 'none' ? 'active' : ''}`}
              aria-pressed={parameters.stone === 'none'}
              onClick={() => update('stone', 'none')}
            >
              <span className="stone-name">No stone</span>
              <span className="stone-code">panel finish</span>
            </button>
            {stoneShelf.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`stone-chip ${parameters.stone === item.id ? 'active' : ''}`}
                style={{ backgroundColor: item.tone, backgroundImage: `url(/media/stone/${item.id}/chip.jpg)` }}
                aria-pressed={parameters.stone === item.id}
                title={stoneName(item)}
                onClick={() => update('stone', item.id)}
              >
                <span className="stone-name">{stoneName(item)}</span>
                <span className="stone-code">{item.code} · {item.tileMm} mm tile</span>
              </button>
            ))}
          </div>
        </div>

        {coat && (<>
        <div className="sidebar-section">
          <div className="panel-title">The coat <span>{MAX_COAT_MM} mm ceiling</span></div>
          <SliderField
            label="Build thickness" value={parameters.stoneCoat} min={0} max={MAX_COAT_MM} step={0.5} suffix=" mm"
            onChange={(value) => update('stoneCoat', value)}
          />
          <p className="field-hint tech-data">
            {parameters.stoneCoat > 0
              ? `${coat.passes} render ${coat.passes === 1 ? 'pass' : 'passes'} · ${coat.coats} coats · ${coat.days} working ${coat.days === 1 ? 'day' : 'days'}`
              : 'Colour only, no build — all of the stone is in the glaze'}
          </p>
          <SliderField
            label="Relief worked" value={parameters.stoneRelief} min={0} max={100} step={5} suffix="%"
            onChange={(value) => update('stoneRelief', value)}
          />
          <p className="field-hint tech-data">
            Preview shows {coat.reliefMm.toFixed(1)} mm of relief — exactly what the build buys, never more
          </p>
          <SliderField
            label="Batch drift" value={parameters.stoneTone} min={0} max={100} step={5} suffix="%"
            onChange={(value) => update('stoneTone', value)}
          />
          <div className="led-colours" role="group" aria-label="Glaze wash">
            {STONE_TINTS.map((hex) => (
              <button
                key={hex}
                type="button"
                className={`led-colour ${parameters.stoneTint.toLowerCase() === hex ? 'active' : ''}`}
                style={{ background: hex }}
                title={hex === '#ffffff' ? 'No wash — the stone as photographed' : hex}
                aria-label={hex}
                aria-pressed={parameters.stoneTint.toLowerCase() === hex}
                onClick={() => update('stoneTint', hex)}
              />
            ))}
            <input
              type="color" className="led-colour picker" value={parameters.stoneTint}
              aria-label="Custom wash" onChange={(event) => update('stoneTint', event.target.value)}
            />
          </div>
          <div className="category-pills" role="group" aria-label="Sealer">
            {STONE_SEALS.map((id) => (
              <button
                key={id}
                type="button"
                className={`pill ${parameters.stoneSeal === id ? 'active' : ''}`}
                aria-pressed={parameters.stoneSeal === id}
                onClick={() => update('stoneSeal', id)}
              >{SEAL_NAMES[id]}</button>
            ))}
          </div>
        </div>

        <div className="sidebar-section">
          <div className="panel-title">Paint card <span>{coat.code}</span></div>
          <dl className="spec-list tech-data">
            <div><dt>Stone</dt><dd>{stoneName(stoneById(coat.stone) ?? STONE_MATERIALS[0])}</dd></div>
            <div><dt>Painted area</dt><dd>{coat.areaM2.toFixed(2)} m² · wall and collar</dd></div>
            <div><dt>Coats</dt><dd>{coat.coats} · {coat.passes} of them build</dd></div>
            <div><dt>Render to mix</dt><dd>{coat.litres.toFixed(1)} L</dd></div>
            <div><dt>Weight added</dt><dd>{coat.kg.toFixed(1)} kg</dd></div>
            <div><dt>Bench time</dt><dd>{coat.hours.toFixed(1)} h · {coat.days} {coat.days === 1 ? 'day' : 'days'}</dd></div>
            <div><dt>Crease keep-out</dt><dd>{coat.keepOut.toFixed(0)} mm · {coat.reliefRun.toFixed(2)} m of crease</dd></div>
            <div>
              <dt>Cut-outs after paint</dt>
              <dd>{coat.opening > 0
                ? `${coat.opening.toFixed(0)} → ${Math.max(0, coat.throat).toFixed(0)} mm`
                : 'solid wall'}</dd>
            </div>
            <div><dt>Sealer</dt><dd>{SEAL_NAMES[coat.seal]}</dd></div>
          </dl>
          <p className="footnote">
            The glaze is the painter&apos;s own — they pull out the high points, float a wash
            into the hollows and decide where this particular pot has weathered. No two match,
            and they are not meant to.
          </p>
        </div>
        </>)}

        <div className="sidebar-section">
          <div className="panel-title">Direct UV print <span>after the mill, before the fold</span></div>
          <p className="field-hint">
            The panel reaches the bed already grooved and already cut, and still flat. The
            artwork is a file in the same millimetres as the DXF, registered to the outline the
            mill has just made. The facets are exactly the regions that never bend — which is
            why filling by triangle is not merely a nice pattern here, it is the one that
            survives the fold.
          </p>
          <div className="category-pills" role="group" aria-label="What is printed">
            {PRINT_MODES.map((id) => (
              <button
                key={id}
                type="button"
                className={`pill ${parameters.print === id ? 'active' : ''}`}
                aria-pressed={parameters.print === id}
                onClick={() => update('print', id as PlanterPrint)}
              >{PRINT_MODE_LABELS[id]}</button>
            ))}
          </div>
        </div>

        {parameters.print === 'triangles' && (<>
        <div className="sidebar-section">
          <div className="panel-title">Colour generator <span>{PRINT_RULE_NAMES[parameters.printRule]}</span></div>
          <div className="category-pills" role="group" aria-label="Fill rule">
            {PRINT_RULES.map((id) => (
              <button
                key={id}
                type="button"
                className={`pill ${parameters.printRule === id ? 'active' : ''}`}
                aria-pressed={parameters.printRule === id}
                onClick={() => update('printRule', id as PlanterPrintRule)}
              >{PRINT_RULE_NAMES[id]}</button>
            ))}
          </div>
          <button className="action-btn" style={{ marginTop: 'var(--space-4)' }} onClick={reroll}>
            <Shuffle size={12} aria-hidden="true" /> Roll again · seed {parameters.printSeed}
          </button>
          <p className="field-hint tech-data">
            The seed is one integer and it decides the whole draw. The same seed gives the same
            pot on any machine on any day, so a design approved last month prints in the colours
            it was approved in.
          </p>
        </div>

        <div className="sidebar-section">
          <div className="panel-title">Palette <span className="tech-data">{job?.colours ?? 0} colours</span></div>
          <div className="stone-grid" role="group" aria-label="Palettes">
            {[...PRINT_PALETTES.map((item) => item.id), CUSTOM_PALETTE].map((id) => {
              const colours = paletteColours(id, parameters.printColors).slice(0, parameters.printTones);
              const stops = colours.map((hex, i) => `${hex} ${(i / colours.length) * 100}%, ${hex} ${((i + 1) / colours.length) * 100}%`);
              return (
                <button
                  key={id}
                  type="button"
                  className={`stone-chip ${parameters.printPalette === id ? 'active' : ''}`}
                  style={{ backgroundImage: `linear-gradient(135deg, ${stops.join(', ')})` }}
                  aria-pressed={parameters.printPalette === id}
                  title={paletteName(id)}
                  onClick={() => update('printPalette', id)}
                >
                  <span className="stone-name">{paletteName(id)}</span>
                  <span className="stone-code">{colours.length} tones</span>
                </button>
              );
            })}
          </div>
          {parameters.printPalette === CUSTOM_PALETTE && (
            <div className="led-colours" role="group" aria-label="My colours" style={{ marginTop: 'var(--space-4)' }}>
              {parameters.printColors.map((hex, index) => (
                <input
                  key={index}
                  type="color"
                  className="led-colour picker"
                  value={hex}
                  aria-label={`Colour ${index + 1}`}
                  onChange={(event) => update(
                    'printColors',
                    parameters.printColors.map((was, i) => (i === index ? event.target.value : was)),
                  )}
                />
              ))}
            </div>
          )}
          <SliderField
            label="Tones in play" value={parameters.printTones} min={2} max={MAX_PRINT_TONES} step={1}
            onChange={(value) => update('printTones', value)}
          />
          <div className="category-pills" role="group" aria-label="Angle effect">
            <button
              type="button"
              className={`pill ${parameters.printShade > 0 ? 'active' : ''}`}
              aria-pressed={parameters.printShade > 0}
              onClick={() => update('printShade', shadeLevel)}
            >Angle effect</button>
            <button
              type="button"
              className={`pill ${parameters.printShade === 0 ? 'active' : ''}`}
              aria-pressed={parameters.printShade === 0}
              onClick={() => update('printShade', 0)}
            >Off</button>
          </div>
          {parameters.printShade > 0 && (
            <SliderField
              label="Strength" value={parameters.printShade} min={5} max={100} step={5} suffix="%"
              onChange={(value) => { setShadeLevel(value); update('printShade', value); }}
            />
          )}
          <p className="field-hint tech-data">
            {parameters.printShade > 0
              ? `Each facet lightened or darkened by the way it faces — ${job?.colours ?? 0} colours in the file instead of ${parameters.printTones}`
              : 'Flat colour per facet, no shading. The catalogue pot.'}
          </p>
        </div>
        </>)}

        {parameters.print === 'image' && (
        <div className="sidebar-section">
          <div className="panel-title">Artwork file <span>PNG · JPG</span></div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg"
            className="sr-only"
            onChange={(event) => loadArtwork(event.target.files?.[0] ?? null)}
          />
          <button className="export-button" onClick={() => fileRef.current?.click()}>
            <ImageIcon size={13} aria-hidden="true" /> {parameters.printImage ? 'Replace file' : 'Load a PNG or JPG'}
          </button>
          {parameters.printImage && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={parameters.printImage}
                alt="Loaded artwork"
                style={{ width: '100%', borderRadius: 'var(--radius-2)', marginTop: 'var(--space-4)', display: 'block' }}
              />
              <button className="action-btn" style={{ marginTop: 'var(--space-3)' }} onClick={() => update('printImage', '')}>
                <RotateCcw size={12} aria-hidden="true" /> Remove it
              </button>
            </>
          )}
          {artworkNote && <p className="field-hint tech-data">{artworkNote}</p>}
          <div className="category-pills" role="group" aria-label="Fit" style={{ marginTop: 'var(--space-4)' }}>
            {PRINT_FITS.map((id) => (
              <button
                key={id}
                type="button"
                className={`pill ${parameters.printFit === id ? 'active' : ''}`}
                aria-pressed={parameters.printFit === id}
                onClick={() => update('printFit', id as PlanterPrintFit)}
              >{id}</button>
            ))}
          </div>
          <p className="footnote">
            The image is laid across the developed wall rather than round the pot, and those are
            the same thing here, because the printing happens flat. A pixel that lands on a facet
            in the net is the pixel standing on that facet once it is folded.
          </p>
        </div>
        )}

        {job && (<>
        <div className="sidebar-section">
          <div className="panel-title">Drafting layer <span>the drawing, on the pot</span></div>
          <div className="category-pills" role="group" aria-label="Drafting layer">
            <button
              type="button"
              className={`pill ${parameters.printOverlay ? 'active' : ''}`}
              aria-pressed={parameters.printOverlay}
              onClick={() => update('printOverlay', true)}
            >With drafting</button>
            <button
              type="button"
              className={`pill ${!parameters.printOverlay ? 'active' : ''}`}
              aria-pressed={!parameters.printOverlay}
              onClick={() => update('printOverlay', false)}
            >Without</button>
          </div>
          <p className="footnote">
            A protractor on every vertex of the net, swept arcs, a right-triangle glyph per facet
            and dimension callouts — and the numbers are the pot&apos;s own. The diameter beside a
            vertex is that ring&apos;s real diameter; the R beside a facet is its own shortest
            edge. What is printed on the object is the drawing that made it.
          </p>
          {parameters.printOverlay && (
            <>
              <SliderField
                label="Mark density" value={parameters.printOverlayDensity} min={0} max={100} step={5} suffix="%"
                onChange={(value) => update('printOverlayDensity', value)}
              />
              <div className="led-colours" role="group" aria-label="Drafting ink">
                {DRAFT_INKS.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    className={`led-colour ${parameters.printOverlayInk.toLowerCase() === hex ? 'active' : ''}`}
                    style={{ background: hex }}
                    title={hex}
                    aria-label={hex}
                    aria-pressed={parameters.printOverlayInk.toLowerCase() === hex}
                    onClick={() => update('printOverlayInk', hex)}
                  />
                ))}
                <input
                  type="color" className="led-colour picker" value={parameters.printOverlayInk}
                  aria-label="Custom drafting ink"
                  onChange={(event) => update('printOverlayInk', event.target.value)}
                />
              </div>
            </>
          )}
        </div>

        <div className="sidebar-section">
          <div className="panel-title">On the bed <span>{job.passes} {job.passes === 1 ? 'pass' : 'passes'}</span></div>
          <SliderField
            label="Grout off the creases" value={parameters.printGrout} min={0} max={MAX_GROUT} step={0.5} suffix=" mm"
            onChange={(value) => update('printGrout', value)}
          />
          <p className="field-hint tech-data">
            {parameters.printGrout > 0
              ? `Ink stops ${parameters.printGrout.toFixed(1)} mm short of every crease and cut edge — ${job.groutRun.toFixed(2)} m of crease left bare, reading as grout between tiles`
              : 'Ink carried straight over the grooves. A cured UV film crazes exactly there, along the most visible line on the pot.'}
          </p>
          <div className="category-pills" role="group" aria-label="Passes">
            <button
              type="button"
              className={`pill ${parameters.printWhite ? 'active' : ''}`}
              aria-pressed={parameters.printWhite}
              onClick={() => update('printWhite', !parameters.printWhite)}
            >White base</button>
            <button
              type="button"
              className={`pill ${parameters.printVarnish ? 'active' : ''}`}
              aria-pressed={parameters.printVarnish}
              onClick={() => update('printVarnish', !parameters.printVarnish)}
            >Varnish</button>
          </div>
          <dl className="spec-list tech-data">
            <div><dt>Artwork</dt><dd>{job.mode === 'image' ? 'Imported image' : `${PRINT_RULE_NAMES[parameters.printRule]} · ${paletteName(parameters.printPalette)}`}</dd></div>
            {job.mode === 'triangles' && <div><dt>Colours</dt><dd>{job.colours}</dd></div>}
            <div><dt>Inked area</dt><dd>{job.areaM2.toFixed(2)} m²</dd></div>
            <div><dt>Ink</dt><dd>{Math.round(job.inkMl)} ml</dd></div>
            <div><dt>Bed time</dt><dd>{Math.round(job.minutes)} min</dd></div>
            <div><dt>Bed</dt><dd>{job.tiles === 1 ? 'one pass' : `${job.tiles} tiles`} · {job.bed.width} × {job.bed.height} mm</dd></div>
            {job.dropped > 0 && <div><dt>Facets left bare</dt><dd>{job.dropped}</dd></div>}
          </dl>
        </div>
        </>)}

        <div className="sidebar-section">
          <div className="panel-title">Export <span>1 : 1 scale</span></div>
          <button className="export-button" onClick={() => download(`${faceStem}.svg`, buildPlanterSvg(model, style.name, face), 'image/svg+xml')}>
            <Download size={13} aria-hidden="true" /> Export SVG
          </button>
          <button className="export-button export-secondary" onClick={() => download(`${faceStem}.dxf`, buildPlanterDxf(model, face), 'image/vnd.dxf')}>
            <Download size={13} aria-hidden="true" /> Export DXF
          </button>
          {job && (
            <button className="export-button export-secondary" onClick={() => download(`${fileStem}-print.svg`, buildPlanterPrintSvg(model, style.name), 'image/svg+xml')}>
              <Printer size={13} aria-hidden="true" /> Export print artwork
            </button>
          )}
          <div className="category-pills" role="group" aria-label="Sheet face">
            <button
              className={`pill ${face === 'groove' ? 'active' : ''}`} aria-pressed={face === 'groove'}
              onClick={() => setFace('groove')}
            >
              Groove face (mirrored)
            </button>
            <button
              className={`pill ${face === 'outside' ? 'active' : ''}`} aria-pressed={face === 'outside'}
              onClick={() => setFace('outside')}
            >
              Outside face
            </button>
          </div>
          <p className="footnote">
            {face === 'groove'
              ? 'Drawn and exported mirrored, for the groove face: the board lies on the bed decorative side down, because the V-groove cuts through the back skin and the front skin is the hinge. This is what the cutter sees.'
              : 'Drawn and exported as the pot is seen from outside — for reading and signing off, not for the bed. Mirror it before cutting or every part comes off handed the wrong way: the twist winds the other way and the face that should show ends up inside.'}
          </p>
          <p className="footnote">
            {model.sheets > 1
              ? `Wall, base plate and collar nested across ${model.sheets} stock sheets. The DXF keeps CUT, MOUNTAIN and VALLEY on separate layers.`
              : 'Wall, base plate and collar nested on one sheet. The DXF keeps CUT, MOUNTAIN and VALLEY on separate layers.'}
            {' '}The print file is always the outside face — the ink goes on the side that shows — so never match it to the cut file.
          </p>
        </div>
      </aside>

      <div className="main-stage">
        <section className="panel viewport three-viewport" ref={viewportRef}>
          <div className="viewport-header">
            <div className="viewport-heading">
              <h2>Assembly</h2>
              <p className="tech-data">{stats.facets} facets · steepest crease {model.maxBend.toFixed(0)}° · holds {stats.volume}</p>
            </div>
            <div className="view-presets" role="group" aria-label="Camera preset">
              {VIEW_LABELS.map((item) => (
                <button key={item.id} className={`preset-pill ${view === item.id ? 'active' : ''}`} aria-pressed={view === item.id} onClick={() => setView(item.id)}>{item.label}</button>
              ))}
            </div>
          </div>
          <div className="fold-control-bar">
            <label className="fold-readout" htmlFor="planter-assembly"><span>Built</span><b className="tech-data">{Math.round(parameters.assembly)}%</b></label>
            <input id="planter-assembly" type="range" min="0" max="100" value={parameters.assembly} onChange={(event) => update('assembly', Number(event.target.value))} />
            <div className="fold-actions">
              <button className="action-btn" onClick={() => setPlaying((value) => !value)} disabled={reducedMotion} title={reducedMotion ? 'Disabled while your system requests reduced motion' : undefined}>
                {playing ? <Pause size={12} aria-hidden="true" /> : <Play size={12} aria-hidden="true" />} {playing ? 'Pause' : 'Play'}
              </button>
              <button className="action-btn" onClick={() => { setPlaying(false); update('assembly', 100); }}><RotateCcw size={12} aria-hidden="true" /> Reset</button>
            </div>
          </div>
          <PlanterPreview
            model={model} finish={finish} customColor={customColor} plant={plant} backdrop={backdrop}
            assembly={parameters.assembly} view={view} viewportRef={viewportRef}
          />
          <p className="viewport-footnote">
            {model.groove.heatBent
              ? `Real geometry at 1:1, on ${model.solid.thickness} mm stock. Every facet stays rigid the whole way — this is a hinge chain, not corners walking in straight lines. This material is bent hot rather than grooved, so there is no groove to show. Cut-outs are drawn on the wall rather than bored through it.`
              : `Real geometry at 1:1, on ${model.solid.thickness} mm stock with a ${model.groove.depth.toFixed(1)} mm groove in the back. Every facet stays rigid the whole way — this is a hinge chain, not corners walking in straight lines — and the groove is open on the flat blank and shut by the end. Cut-outs are drawn on the wall rather than bored through it.`}
          </p>
        </section>
      </div>

      <aside className="right-column">
        <section className="panel viewport two-d">
          <div className="viewport-header">
            <div className="viewport-heading">
              <h2>Cutting sheet</h2>
              <p className="tech-data">{stats.sheetUsage} nested · stock {parameters.sheetWidth} × {parameters.sheetHeight} mm</p>
            </div>
          </div>
          <div className="svg-viewport"><PlanterNet model={model} face={face} /></div>
          <div className="view-legend">
            <span><svg width="22" height="7" aria-hidden="true"><line x1="0" y1="3.5" x2="22" y2="3.5" stroke={FOLD_COLORS.mountain} strokeWidth="2" /></svg>Mountain</span>
            <span><svg width="22" height="7" aria-hidden="true"><line x1="0" y1="3.5" x2="22" y2="3.5" stroke={FOLD_COLORS.valley} strokeWidth="2" strokeDasharray="7 4" /></svg>Valley</span>
            <span><svg width="22" height="7" aria-hidden="true"><line x1="0" y1="3.5" x2="22" y2="3.5" stroke={FOLD_COLORS.cut} strokeWidth="2" strokeDasharray="9 3 2 3" /></svg>Cut</span>
          </div>
        </section>

        <section className="panel right-panel">
          <div className="info-hero">
            <h1>{style.name}</h1>
            <p>{style.subtitle}</p>
            <p className="hero-desc">{style.description}</p>
            <div className="tag-row">{style.applications.map((use) => <span className="tag" key={use}>{use}</span>)}</div>
          </div>

          <div className="info-section">
            <h3>Fabrication check</h3>
            <CheckList checks={checks} />
          </div>

          <div className="info-section">
            <h3>Pot</h3>
            <div className="stat-grid tech-data">
              <div><div className="stat-label">{model.parameters.footprint === 'rectangle' ? 'Footprint × bands' : 'Sides × bands'}</div><div className="stat-value">{model.parameters.footprint === 'rectangle' ? 'Rect' : model.parameters.sides}×{model.parameters.rows}</div></div>
              <div><div className="stat-label">Facets</div><div className="stat-value">{stats.facets}</div></div>
              <div><div className="stat-label">Height</div><div className="stat-value">{Math.round(parameters.height)}<em>mm</em></div></div>
              <div><div className="stat-label">{model.parameters.footprint === 'rectangle' ? 'Widest W × L' : 'Widest ⌀'}</div><div className="stat-value">{stats.footprint.replace(' mm', '')}<em>mm</em></div></div>
              <div><div className="stat-label">Planting hole</div><div className="stat-value">{stats.topOpening.replace(' mm', '')}<em>mm</em></div></div>
              <div><div className="stat-label">Holds</div><div className="stat-value">{stats.volume.replace('≈ ', '').replace(' L', '')}<em>L</em></div></div>
            </div>
          </div>

          <div className="info-section">
            <h3>Sheet</h3>
            <div className="stat-grid tech-data">
              <div><div className="stat-label">Nested size</div><div className="stat-value">{Math.ceil(model.sheet.width)}×{Math.ceil(model.sheet.height)}<em>mm</em></div></div>
              <div><div className="stat-label">Stock sheets</div><div className="stat-value">{stats.sheets}</div></div>
              <div><div className="stat-label">Est. weight</div><div className="stat-value">{stats.estimatedWeight}</div></div>
              <div><div className="stat-label">Cut run</div><div className="stat-value">{stats.cutLength}</div></div>
              <div><div className="stat-label">Groove run</div><div className="stat-value">{stats.creaseLength}</div></div>
              <div><div className="stat-label">Steepest crease</div><div className="stat-value">{model.maxBend.toFixed(0)}<em>°</em></div></div>
              <div><div className="stat-label">Develop. error</div><div className="stat-value">{model.developmentError.toFixed(2)}<em>mm</em></div></div>
            </div>
          </div>

          <div className="info-section">
            <h3>Material</h3>
            <div className="recommendation">
              <span className="material-swatch" style={{ background: `linear-gradient(135deg, ${material.color}, ${material.accent})` }} />
              <div>
                <strong>{material.name}</strong>
                <span className="tech-data">{material.thickness} mm · r{material.minRadius} · ≤{material.maxBendAngle}°</span>
              </div>
            </div>
            <p className="footnote">
              {style.recommendedMaterial === parameters.material
                ? `${material.shortName} is the recommended stock for ${style.name}.`
                : `${style.name} is usually cut from ${getMaterial(style.recommendedMaterial).shortName}.`}
            </p>
          </div>
        </section>
      </aside>
    </>
  );
}
