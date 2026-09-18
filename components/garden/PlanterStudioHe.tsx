'use client';

import { ContactShadows, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import { Download, Image as ImageIcon, Lightbulb, Maximize2, Mountain, Palette, Pause, Play, Printer, RotateCcw, Rotate3D, Ruler, Search, Shuffle, SlidersHorizontal } from 'lucide-react';
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
import { draftMarks } from '@/lib/planter-drafting';
import {
  buildPlanterDxf, buildPlanterModel, buildPlanterPrintSvg, buildPlanterSvg, collarColour,
  DEFAULT_PLANTER, FOLD_COLORS, getPlanterChecks, getPlanterStats, isLitPlanter, LED_CONTROLLERS,
  LED_DENSITIES, ledGlow, LED_POSITIONS, LEDS, litPlanter, placedGeometry, unlitPlanter,
} from '@/lib/planter-engine';
import { getLedEffect, hexToHsl, ledThrow, LED_BASE_COLOURS, LED_EFFECTS, pixelColor } from '@/lib/planter-led-effects';
import { barycentric, flapSlit, type Triangle2 } from '@/lib/planter-perforation';
import {
  CUSTOM_PALETTE, insetTriangle, MAX_GROUT, MAX_PRINT_TONES, paletteColours, PRINT_MODES,
  PRINT_FITS, PRINT_PALETTES, PRINT_RULES,
} from '@/lib/planter-print';
import {
  MAX_COAT_MM, stoneById, stoneName, STONE_FAMILIES, STONE_MATERIALS, STONE_SEALS, STONE_TINTS,
} from '@/lib/planter-stone';
import {
  backdropById, finishById, gradientTexture, PLANTER_BACKDROPS, PLANTER_FINISHES,
  type PlanterBackdrop, type PlanterFinish,
} from '@/lib/planter-finishes';
import { BLANK_PLANTER, getPlanterStyle, PLANTER_CATEGORIES, PLANTER_PRESETS, PLANTER_STYLES } from '@/lib/planter-styles';
import {
  BACKDROP_HE, CATEGORY_HE, checksHe, DIFFICULTY_HE, FINISH_HE, LED_CONTROLLER_HE,
  LED_EFFECT_HE, LED_HE, LED_POSITION_HE, materialNameHe, PRINT_FIT_HE, PRINT_MODE_HE,
  PRINT_PALETTE_HE, PRINT_RULE_HE, STONE_FAMILY_HE, STONE_HE, STONE_SEAL_HE,
  materialShortHe, PRESET_HE, STYLE_HE, unitsHe,
} from '@/lib/planter-i18n-he';
import type {
  FoldKind, MaterialId, PlanterCategory, PlanterConstruction, PlanterFootprint, PlanterLed,
  PlanterLedController, PlanterModel, PlanterParameters, PlanterPerforation, PlanterPiece,
  PlanterPrint, PlanterPrintFit, PlanterPrintRule, PlanterStyleId, Vec2, Vec3,
} from '@/lib/types';

type ViewAngle = 'iso' | 'front' | 'top' | 'hero';

const VIEW_DIRS: Record<ViewAngle, [number, number, number]> = {
  iso: [0.72, 0.46, 1], front: [0, 0.12, 1], top: [0, 1, 0.05],
  // A steep three-quarter angle, well above the pot rather than level with
  // it — the "high" view, for reading the mouth and the facet layout at once.
  hero: [0.5, 0.92, 0.55],
};
const VIEW_LABELS: { id: ViewAngle; label: string }[] = [
  { id: 'iso', label: 'איזו' }, { id: 'front', label: 'חזית' }, { id: 'top', label: 'על' }, { id: 'hero', label: 'זווית' },
];

/**
 * The control column holds eight groups, and the preset library alone is taller
 * than the column. Stacked in one scroll, everything below it — the dimensions,
 * the colours, the export — is invisible until you scroll past twenty-five
 * cards, so the studio reads as a catalogue with no tools. These tabs put every
 * group one click from the top instead.
 */
type StudioTab = 'library' | 'shape' | 'light' | 'stone' | 'print' | 'finish' | 'export';

const STUDIO_TABS: { id: StudioTab; label: string; icon: typeof Search }[] = [
  { id: 'library', label: 'ספרייה', icon: Search },
  { id: 'shape', label: 'מידות', icon: Ruler },
  { id: 'light', label: 'תאורה', icon: Lightbulb },
  { id: 'stone', label: 'אבן וסלע', icon: Mountain },
  { id: 'print', label: 'הדפסת UV', icon: Printer },
  { id: 'finish', label: 'גימור', icon: Palette },
  { id: 'export', label: 'ייצוא', icon: Download },
];

/**
 * The cut-out sizes, biggest opening first.
 *
 * Labelled by how big the holes come out, not by the subdivision underneath —
 * the two run opposite ways, and "size" is the thing anybody actually has an
 * opinion about. The full range stays on the slider below for the shop.
 */
const PERF_SIZES: PatternOption[] = [
  { density: 0, label: 'ללא' },
  { density: 1, label: 'ענק' },
  { density: 2, label: 'גדול' },
  { density: 3, label: 'בינוני' },
  { density: 4, label: 'קטן' },
  { density: 6, label: 'עדין' },
];

/** The light coming through the wall, in the warm white these strips actually are. */

/**
 * One-click colours, in the finishes the catalogue is actually photographed in.
 * They drive the same free-colour finish the picker below them does — they are
 * shortcuts into it, not a separate material.
 */
const QUICK_COLOURS: { name: string; hex: string }[] = [
  { name: 'ירוק עלה', hex: '#3f9145' },
  { name: 'כחול', hex: '#4a7ab0' },
  { name: 'צהוב', hex: '#e0ac33' },
  { name: 'אדום', hex: '#cf3b32' },
  { name: 'טרקוטה', hex: '#c4633c' },
  { name: 'חול', hex: '#d9c9a8' },
  { name: 'אפור בזלת', hex: '#5a5f63' },
  { name: 'ירוק בקבוק', hex: '#1f4a3a' },
];

/** Longest dimension of the assembled pot, in world units. Everything else derives from this. */
const POT_FIT = 3.4;

const STROKE_DASH: Record<FoldKind, string | undefined> = {
  mountain: undefined, valley: '7 4', cut: '9 3 2 3',
};

/**
 * What the shell around this workspace needs from it.
 *
 * `blocking` and `readout` are all the storefront band shows. The CAD shell on
 * /planter/studio draws a full status bar and a command bar, so it also needs
 * the measurements and a way to fire the two exports without reaching into the
 * panel — hence `measures` and the two callbacks, all optional so a plain
 * embed can ignore them.
 */
export interface StudioStatus {
  blocking: boolean;
  readout: string[];
  measures?: { label: string; value: string }[];
  fileStem?: string;
  exportSvg?: () => void;
  exportDxf?: () => void;
  /** Only offered once something is actually printed on the pot. */
  exportPrint?: (() => void) | null;
}

/**
 * The most a supplied image may weigh.
 *
 * It is written whole into the exported print file, so this is not a memory
 * limit — it is the size of the thing the shop has to open at the other end.
 */
const MAX_ARTWORK_BYTES = 12 * 1024 * 1024;

// ---------------------------------------------------------------------------
// 3D
// ---------------------------------------------------------------------------

interface ShellPiece {
  tree: FoldTree;
  crease: { tri: number; corners: [number, number] }[];
  /** Where this piece's triangles start in the model's own triangle list. */
  from: number;
  /**
   * Each triangle's corners in the developed net, as 0–1 across the wall's own
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
 * The pot folds up out of its own flat net as a chain of hinge rotations, one
 * chain per physical piece — the whole wall in single-sheet construction,
 * since it really is cut from one blank, or one chain per riveted band in
 * banded construction, since those are genuinely separate strips. A hinge
 * chain keeps every facet perfectly rigid and keeps it attached to its
 * neighbour throughout, which a straight-line vertex move cannot: that always
 * stretches material on the way, and for a piece nested apart from its
 * neighbours on the cutting sheet it makes the pot look like it assembles out
 * of scattered debris rather than folding shut.
 */
function usePlanterShell(model: PlanterModel) {
  return useMemo(() => {
    const { sides, rows, height, construction } = model.parameters;
    const stride = sides + 1;
    const banded = construction === 'banded';
    const span = Math.max(
      height,
      ...model.vertices.map((ring) => Math.hypot(ring[0].x, ring[0].y) * 2),
      // A single-sheet net can be much wider than the pot itself, so the camera
      // has to size for it. A banded net no longer positions itself on the sheet
      // at all (see below), so the nest width is irrelevant to its scale.
      banded ? 0 : model.sheet.width,
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
    if (banded) {
      // Single-sheet construction folds from one connected blank, so every band
      // shares the same flat frame the unfolded net puts it in. Banded
      // construction cuts each band as its own separate part, which generally
      // lands far from its neighbours on the nested cutting sheet, so each band
      // instead starts flat directly beneath the spot it will occupy once
      // built — only the hinge chain's own curl carries it the rest of the way.
      for (let band = 0; band < rows; band += 1) {
        const ids = model.triangles.slice(band * sides * 2, (band + 1) * sides * 2).map((t) => t.v);
        const solidPts = [...model.vertices[band], ...model.vertices[band + 1]];
        const targetX = (solidPts.reduce((sum, p) => sum + p.x, 0) / solidPts.length) * scale;
        const targetZ = -(solidPts.reduce((sum, p) => sum + p.y, 0) / solidPts.length) * scale;
        const flatPts = [...model.flatByBand[band][0], ...model.flatByBand[band][1]];
        const flatCx = flatPts.reduce((sum, p) => sum + p.x, 0) / flatPts.length;
        const flatCy = flatPts.reduce((sum, p) => sum + p.y, 0) / flatPts.length;
        const flatOf = (id: number): Vec2 => {
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
          crease: internalEdges(ids),
          cut: cutsFor(band * sides * 2, sides * 2),
          from: band * sides * 2,
          uv: ids.map(([a, b, c]) => [uvOf(band, a), uvOf(band, b), uvOf(band, c)]),
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
    // Two extents. `extent` spans both ends of the fold, which is what the flat
    // net needs; `builtExtent` spans the assembled pot alone. The camera frames
    // the built one, because a single-sheet net is several times wider than the
    // pot it folds into, and framing on it leaves the pot a small object adrift
    // in a mostly empty viewport — the wrong default for a design tool.
    let extent = 0;
    let builtExtent = 0;
    const flatBox = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (const piece of pieces) {
      for (const tParam of [0, 1]) {
        for (const tri of cornersAt(piece.tree, tParam)) {
          for (const raw of tri) {
            const p = toWorld(raw);
            extent = Math.max(extent, Math.hypot(p.x, p.z), Math.abs(p.y));
            if (tParam === 1) builtExtent = Math.max(builtExtent, Math.hypot(p.x, p.z), Math.abs(p.y));
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
      radius: Math.max(builtExtent, planeExtent(basePiece) * scale, planeExtent(rimPiece) * scale) * 1.2,
      netRadius: Math.max(POT_FIT, extent, planeExtent(basePiece) * scale, planeExtent(rimPiece) * scale) * 1.15,
    };
  }, [model]);
}

type PlantId = 'none' | 'tropical' | 'lowpoly';

const PLANT_OPTIONS: { id: PlantId; label: string }[] = [
  { id: 'none', label: 'בלי שתילה' },
  { id: 'tropical', label: 'צמח בית בעציץ' },
  { id: 'lowpoly', label: 'צמח לואו־פולי' },
];

/** How far the plant sits below the collar, as a share of the pot's height. */
const PLANT_DEFAULT_LIFT = -10;

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
function PlantModel({ id, radius, sizePct }: { id: Exclude<PlantId, 'none'>; radius: number; sizePct: number }) {
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
    // The contain-fit above is the sensible default; "size" is the user
    // overriding it, because how big a plant should look in a pot is a matter
    // of taste that no fit rule decides for them.
    model.scale.setScalar(Math.min(byHeight, bySpread) * (sizePct / 100));

    const settled = new THREE.Box3().setFromObject(model);
    const centre = settled.getCenter(new THREE.Vector3());
    model.position.x -= centre.x;
    model.position.z -= centre.z;
    model.position.y -= settled.min.y;
    return model;
  }, [raw, radius, id, sizePct]);

  return <primitive object={object} />;
}

function Planting({ id, radius, lift, size }: { id: PlantId; radius: number; lift: number; size: number }) {
  if (id === 'none' || radius <= 0) return null;
  return (
    <Suspense fallback={null}>
      <group position={[0, lift, 0]}>
        <PlantModel id={id} radius={radius} sizePct={size} />
      </group>
    </Suspense>
  );
}

/**
 * The dot on each strip's button. The whites are the colour the preview glows
 * at; the addressable one has no single colour, so it shows the whole wheel —
 * which is also the honest answer to what it does.
 */
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

function PlanterMesh({ model, finish, customColor, plant, plantLift, plantSize, assembly, autoRotate }: {
  model: PlanterModel; finish: PlanterFinish; customColor: string; plant: PlantId;
  plantLift: number; plantSize: number; assembly: number;
  autoRotate: React.MutableRefObject<boolean>;
}) {
  const shell = usePlanterShell(model);
  const group = useRef<THREE.Group>(null);
  const t = assembly / 100;
  const wallColor = finish.custom ? customColor : finish.color;
  // A shade darker, so the base plate and collar read as separate parts from
  // the wall rather than melting into one flat-coloured shape.
  const accentColor = useMemo(() => `#${new THREE.Color(wallColor).multiplyScalar(0.86).getHexString()}`, [wallColor]);
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


  // The print. `fills` is the engine's own array, in triangle order, so the
  // pot on screen is painted from exactly what the print file fills — there is
  // no second opinion about which colour lands on which facet.
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

  const { wall, creases, cutouts, petals, pixelU, pixelV, tinted } = useMemo(() => {
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

    return { wall: surface, creases: lines, cutouts: openings, petals: bent, pixelU, pixelV, tinted };
  }, [shell, t, model.parameters.perfLift, model.parameters.led, addressable, effect, baseHsl, position, fills]);

  // Each geometry gets its own cleanup. Sharing one effect would dispose buffers
  // that are still mounted every time only the assembly slider moves.
  useEffect(() => () => { wall.dispose(); }, [wall]);
  useEffect(() => () => { creases.dispose(); }, [creases]);
  useEffect(() => () => { cutouts.dispose(); }, [cutouts]);
  useEffect(() => () => { petals.dispose(); }, [petals]);
  useEffect(() => () => { shell.base.dispose(); }, [shell.base]);
  useEffect(() => () => { shell.rim.dispose(); }, [shell.rim]);
  useEffect(() => () => { shell.liner?.dispose(); }, [shell.liner]);

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
  // The collar is printed flat, in the palette's darkest tone — the frame
  // round the artwork, and the first thing seen from above.
  const plateColor = model.print ? collarColour(model.parameters) : accentColor;

  return (
    <group ref={group}>
      <mesh geometry={wall} frustumCulled={false}>
        <Skin stone={stoneSkin} print={printSkin} color={wallColor} finish={finish} />
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
        {/* The plant model's own origin is the underside of its root ball, so
            with no offset it stands ON the collar instead of IN the pot. The
            default lift sinks it a tenth of the pot's height; the slider takes
            it from there. */}
        <Planting
          id={plant}
          radius={shell.openingRadius}
          lift={(plantLift / 100) * shell.rimBuilt.y}
          size={plantSize}
        />
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

function PlanterPreview({ model, finish, customColor, plant, plantLift, plantSize, backdrop, assembly, view, viewportRef }: {
  model: PlanterModel; finish: PlanterFinish; customColor: string; plant: PlantId; backdrop: PlanterBackdrop;
  plantLift: number; plantSize: number;
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
        <button className="icon-button" aria-label="איפוס התצוגה" title="איפוס התצוגה" onClick={() => { autoRotate.current = true; setResetKey((key) => key + 1); }}><Rotate3D size={13} /></button>
        <button className="icon-button" aria-label="מסך מלא" title="מסך מלא" onClick={toggleFullscreen}><Maximize2 size={13} /></button>
      </div>
      <Canvas
        className="three-canvas"
        camera={{ fov: 34 }}
        dpr={[1, 1.75]}
        // alpha:true is not cosmetic here. ContactShadows renders its depth pass
        // into a render target with the renderer's own clear alpha, so with an
        // opaque context every texel the shadow never touches comes back opaque
        // and the shadow plane paints as a solid quad across the floor. The
        // backdrop sphere still fills the frame, so nothing shows through.
        gl={{ antialias: true, alpha: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.15 }}
      >
        <Backdrop backdrop={backdrop} radius={shell.radius} />
        <StudioLights />
        <PlanterMesh
          model={model} finish={finish} customColor={customColor} plant={plant}
          plantLift={plantLift} plantSize={plantSize} assembly={assembly} autoRotate={autoRotate}
        />
        {/* Sized from the pot, never from a constant. The shadow map is a fixed
            number of pixels spread over "scale" world units, so a plate many
            times wider than the object it shadows leaves the pot covering a
            handful of texels — which resolves as a hard black silhouette
            instead of a soft contact shadow. "far" likewise has to clear the
            pot's own height and little more. */}
        <ContactShadows
          position={[0, -0.002, 0]}
          opacity={backdrop.shadow}
          scale={shell.radius * 1.8}
          blur={2.6}
          far={shell.radius * 1.3}
        />
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
function PlanterNet({ model, thumb = false }: { model: PlanterModel; thumb?: boolean }) {
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
    </svg>
  );
}

function PresetThumb({ parameters }: { parameters: PlanterParameters }) {
  const model = useMemo(() => buildPlanterModel(parameters), [parameters]);
  return <PlanterNet model={model} thumb />;
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

export default function PlanterStudioHe({ onStatus }: { onStatus?: (status: StudioStatus) => void }) {
  const [parameters, setParameters] = useState<PlanterParameters>(
    () => ({ ...DEFAULT_PLANTER, ...PLANTER_PRESETS[0].parameters }),
  );
  const [presetId, setPresetId] = useState(PLANTER_PRESETS[0].id);
  const [materialId, setMaterialId] = useState<MaterialId>('acp-4');
  // The shop's own catalogue photography is gold mirror, and the storefront
  // around this studio is bright, so the pot opens in the brand's finish
  // rather than in the dark studio's neutral matte.
  const [finishId, setFinishId] = useState(PLANTER_FINISHES[1].id);
  const [customColor, setCustomColor] = useState('#c0392b');
  const [backdropId, setBackdropId] = useState(PLANTER_BACKDROPS[1].id);
  const [plant, setPlant] = useState<PlantId>('none');
  const [plantLift, setPlantLift] = useState(PLANT_DEFAULT_LIFT);
  const [plantSize, setPlantSize] = useState(100);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<PlanterCategory | 'all'>('all');
  const [tab, setTab] = useState<StudioTab>('library');
  const [stoneFamily, setStoneFamily] = useState<string>('all');
  /** Set when "תאיר אותי" had to widen the collar to land the panel on it. */
  const [collarNote, setCollarNote] = useState<string | null>(null);
  /** The pattern family to come back to when the wall is switched on again. */
  const [family, setFamilyState] = useState<PlanterPerforation>('triangles');
  const [view, setView] = useState<ViewAngle>('hero');
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

  const material = getMaterial(materialId);
  const finish = finishById(finishId);
  const backdrop = backdropById(backdropId);
  const style = getPlanterStyle(parameters.style);
  const model = useMemo(() => buildPlanterModel(parameters), [parameters]);
  const stats = useMemo(() => getPlanterStats(model, material), [model, material]);
  const checks = useMemo(() => checksHe(getPlanterChecks(model, material), model, material), [model, material]);
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

  const filtered = PLANTER_PRESETS.filter((preset) => {
    const he = PRESET_HE[preset.id];
    const haystack = `${he?.name ?? preset.name} ${he?.note ?? preset.note} ${preset.name}`.toLowerCase();
    return (category === 'all' || preset.category === category)
      && (search.trim() === '' || haystack.includes(search.trim().toLowerCase()));
  });

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
    const lit = litPlanter(parameters);
    // שני אלה הם הכפתור שמשנה מספרים שמישהו אחר קבע, ולכן שניהם נאמרים בקול.
    // מחולל שמרחיב צווארון או מנמיך תאורה בשקט מפסיק להיות מחולל שסומכים עליו.
    setCollarNote([
      lit.rimWidth > parameters.rimWidth + 0.5
        ? `הצווארון הורחב מ־${Math.round(parameters.rimWidth)} ל־${Math.round(lit.rimWidth)} מ״מ, כדי שהפאנל יישב עליו`
        : '',
      lit.ledBrightness < 100
        ? `ההפעלה כוילה ל־${Math.round(lit.ledBrightness)}% — זה מה שהפאנל הזה מחזיק ${Math.round(lit.ledHours)} שעות`
        : '',
    ].filter(Boolean).join(' · ') || null);
    setParameters(lit);
    setTab('light');
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
      setArtworkNote('רק PNG או JPG. הקובץ הזה לא נטען.');
      return;
    }
    if (file.size > MAX_ARTWORK_BYTES) {
      setArtworkNote(`הקובץ שוקל ${(file.size / 1e6).toFixed(1)} מ״ב והמגבלה היא ${MAX_ARTWORK_BYTES / 1e6} מ״ב — הוא נכנס שלם לתוך קובץ ההדפסה, וקובץ כבד מדי כבר לא נפתח בצד השני.`);
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setArtworkNote('קריאת הקובץ נכשלה.');
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
          `${probe.width}×${probe.height} פיקסלים על פריסה ברוחב ${Math.round(acrossMm)} מ״מ — ${Math.round(dpi)} DPI`
          + (dpi < 150 ? ' · מתחת ל־150 DPI ההדפסה תיראה מרוחה' : ' · מספיק לדפוס'),
        );
      };
      probe.onerror = () => setArtworkNote('הקובץ נטען אבל לא נפתח כתמונה.');
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

  const readout = `${parameters.footprint === 'rectangle' ? 'מלבן' : `${parameters.sides} צלעות`} · ${parameters.rows} ${parameters.rows === 1 ? 'חישוק' : 'חישוקים'}${parameters.construction === 'banded' ? ' · בחישוקים' : ''}`;
  const fileStem = `dxf-tlv-planter-${presetId}-${parameters.sides}s-${Math.round(parameters.height)}mm`;

  const exportSvg = useCallback(
    () => download(`${fileStem}.svg`, buildPlanterSvg(model, material, style.name), 'image/svg+xml'),
    [fileStem, model, material, style.name],
  );
  const exportDxf = useCallback(
    () => download(`${fileStem}.dxf`, buildPlanterDxf(model), 'image/vnd.dxf'),
    [fileStem, model],
  );
  const exportPrint = useCallback(
    () => download(`${fileStem}-print.svg`, buildPlanterPrintSvg(model, style.name), 'image/svg+xml'),
    [fileStem, model, style.name],
  );

  // The CAD shell's status bar reads these straight across, so they are built
  // here where the model is, rather than recomputed against a copy of it.
  const measures = useMemo(() => [
    { label: 'פאות', value: String(stats.facets) },
    { label: 'קיפול תלול', value: `${model.maxBend.toFixed(0)}°` },
    { label: 'שגיאת פרישה', value: `${model.developmentError.toFixed(2)} מ״מ` },
    { label: 'גיליון', value: unitsHe(stats.sheetUsage) },
    { label: 'חיתוך', value: unitsHe(stats.cutLength) },
    { label: 'חריצה', value: unitsHe(stats.creaseLength) },
    { label: 'משקל', value: unitsHe(stats.estimatedWeight) },
    { label: 'קיבולת', value: unitsHe(stats.volume) },
  ], [stats, model.maxBend, model.developmentError]);

  useEffect(() => {
    onStatus?.({
      blocking,
      readout: [materialShortHe(material.id), readout],
      measures,
      fileStem,
      exportSvg,
      exportDxf,
      exportPrint: job ? exportPrint : null,
    });
  }, [onStatus, blocking, material.id, readout, measures, fileStem, exportSvg, exportDxf, exportPrint, job]);

  return (
    <>
      <aside className="panel left-panel">
        <div className="studio-tabs" role="tablist" aria-label="כלי העריכה">
          {STUDIO_TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={`studio-tab ${tab === item.id ? 'active' : ''}`}
              onClick={() => setTab(item.id)}
            >
              <item.icon size={14} aria-hidden="true" />
              {item.label}
            </button>
          ))}
        </div>

        {tab === 'library' && (
        <div className="sidebar-section">
          <div className="panel-title">ספריית אדניות <span className="tech-data">{filtered.length}/{PLANTER_PRESETS.length}</span></div>
          <div className="pattern-search">
            <Search size={13} aria-hidden="true" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="חיפוש אדנית…" aria-label="חיפוש אדניות" />
          </div>
          <div className="category-pills" role="group" aria-label="סינון לפי קטגוריה">
            {PLANTER_CATEGORIES.map((item) => (
              <button key={item.id} className={`pill ${category === item.id ? 'active' : ''}`} aria-pressed={category === item.id} onClick={() => setCategory(item.id)}>{CATEGORY_HE[item.id] ?? item.label}</button>
            ))}
          </div>
          <div className="pattern-grid">
            <button
              className={`pattern-card pattern-card-blank ${presetId === BLANK_PLANTER.id ? 'selected' : ''}`}
              aria-pressed={presetId === BLANK_PLANTER.id}
              onClick={startFromScratch}
            >
              <span className="pattern-thumb"><PresetThumb parameters={{ ...DEFAULT_PLANTER, ...BLANK_PLANTER.parameters }} /></span>
              <strong>{PRESET_HE[BLANK_PLANTER.id]?.name ?? BLANK_PLANTER.name}</strong>
              <span className="pattern-meta"><i className="difficulty-dot" />{PRESET_HE[BLANK_PLANTER.id]?.note ?? BLANK_PLANTER.note}</span>
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
                  <strong>{PRESET_HE[preset.id]?.name ?? preset.name}</strong>
                  <span className="pattern-meta">
                    <i className="difficulty-dot" />
                    {merged.footprint === 'rectangle' ? `${Math.round(merged.topWidth)}×${Math.round(merged.topLength)}` : `${merged.sides} צלעות`} · {Math.round(merged.height)} מ״מ
                  </span>
                </button>
              );
            })}
            {filtered.length === 0 && <p className="empty-library">אין אדנית שמתאימה ל־„{search}”</p>}
          </div>
          <p className="footnote">בחרו דגם, ואז עברו ללשונית „מידות" כדי לשנות כל מידה, או ל„גימור" כדי לבחור גוון וחומר.</p>
        </div>
        )}

        {tab === 'shape' && (<>
        <div className="sidebar-section">
          <div className="panel-title">סגנון הדופן <span>{DIFFICULTY_HE[style.difficulty] ?? style.difficulty}</span></div>
          <div className="select-wrap">
            <label className="sr-only" htmlFor="planter-style">סגנון הדופן</label>
            <select id="planter-style" value={parameters.style} onChange={(event) => update('style', event.target.value as PlanterStyleId)}>
              {PLANTER_STYLES.map((item) => <option key={item.id} value={item.id}>{STYLE_HE[item.id]?.name ?? item.name} — {STYLE_HE[item.id]?.subtitle ?? item.subtitle}</option>)}
            </select>
          </div>
          <p className="footnote">{STYLE_HE[style.id]?.description ?? style.description}</p>
        </div>

        <div className="sidebar-section">
          <div className="panel-title">בסיס ובנייה <SlidersHorizontal size={13} aria-hidden="true" /></div>
          <div className="category-pills" role="group" aria-label="צורת הבסיס">
            <button className={`pill ${parameters.footprint === 'polygon' ? 'active' : ''}`} aria-pressed={parameters.footprint === 'polygon'} onClick={() => update('footprint', 'polygon' as PlanterFootprint)}>מצולע</button>
            <button className={`pill ${parameters.footprint === 'rectangle' ? 'active' : ''}`} aria-pressed={parameters.footprint === 'rectangle'} onClick={() => update('footprint', 'rectangle' as PlanterFootprint)}>מלבן / תיבה</button>
          </div>
          <div className="category-pills" role="group" aria-label="שיטת הבנייה">
            <button className={`pill ${parameters.construction === 'single-sheet' ? 'active' : ''}`} aria-pressed={parameters.construction === 'single-sheet'} onClick={() => update('construction', 'single-sheet' as PlanterConstruction)}>פריסה אחת</button>
            <button className={`pill ${parameters.construction === 'banded' ? 'active' : ''}`} aria-pressed={parameters.construction === 'banded'} onClick={() => update('construction', 'banded' as PlanterConstruction)}>חישוקים (מסומררים)</button>
          </div>
          <p className="footnote">
            {parameters.construction === 'banded'
              ? 'כל חישוק הוא רצועה בפני עצמה, מסומררת טבעת לטבעת — הדרך היחידה לבנות דופן נפוחה או מותניים.'
              : 'כל הדופן מתקפלת מפריסה אחת. מתאים לחידוד, הסטה, פיתול ומקצב; נפיחות מחייבת חישוקים.'}
          </p>
        </div>

        <div className="sidebar-section">
          <div className="panel-title">מידות האדנית <SlidersHorizontal size={13} aria-hidden="true" /></div>
          {parameters.footprint === 'rectangle' ? (
            <>
              <NumberField label="רוחב הפתח" value={parameters.topWidth} suffix=" מ״מ" min={60} max={4000} onChange={(value) => update('topWidth', value)} />
              <NumberField label="אורך הפתח" value={parameters.topLength} suffix=" מ״מ" min={60} max={4000} onChange={(value) => update('topLength', value)} />
              <NumberField label="רוחב הבסיס" value={parameters.bottomWidth} suffix=" מ״מ" min={60} max={4000} onChange={(value) => update('bottomWidth', value)} />
              <NumberField label="אורך הבסיס" value={parameters.bottomLength} suffix=" מ״מ" min={60} max={4000} onChange={(value) => update('bottomLength', value)} />
            </>
          ) : (
            <>
              <NumberField label="⌀ עליון בין הפינות" value={parameters.topDiameter} suffix=" מ״מ" min={60} max={1500} onChange={(value) => update('topDiameter', value)} />
              <NumberField label="⌀ בסיס בין הפינות" value={parameters.bottomDiameter} suffix=" מ״מ" min={60} max={1500} onChange={(value) => update('bottomDiameter', value)} />
              <SliderField label="מספר צלעות" value={parameters.sides} min={3} max={12} onChange={(value) => update('sides', value)} />
            </>
          )}
          <NumberField label="גובה" value={parameters.height} suffix=" מ״מ" min={60} max={2000} onChange={(value) => update('height', value)} />
          <SliderField label="חישוקי פאות" value={parameters.rows} min={1} max={8} onChange={(value) => update('rows', value)} />
          <SliderField label="מקצב חישוקים" value={parameters.rhythm} min={0} max={60} step={2} suffix="%" onChange={(value) => update('rhythm', value)} />
          <SliderField label="פיתול" value={parameters.twist} min={-90} max={90} step={2} suffix="°" onChange={(value) => update('twist', value)} />
          <SliderField label="נפיחות" value={parameters.bulge} min={-45} max={60} step={1} suffix="%" onChange={(value) => update('bulge', value)} />
          <p className="field-hint tech-data">
            {Math.abs(parameters.bulge) > 0.5 && parameters.construction !== 'banded'
              ? 'נפיחות היא עקמומיות — עבור לבנייה בחישוקים כדי לבנות אותה'
              : `נפרשת שטוח עד ${model.developmentError.toFixed(2)} מ״מ`}
          </p>
        </div>

        <div className="sidebar-section">
          <div className="panel-title">אביזרי חיבור <span>הרכבה</span></div>
          <SliderField label="לשונית תפר" value={parameters.tabWidth} min={0} max={80} step={1} suffix=" מ״מ" onChange={(value) => update('tabWidth', value)} />
          {parameters.construction === 'banded' && (
            <SliderField label="לשונית חיבור" value={parameters.jointTab} min={0} max={80} step={1} suffix=" מ״מ" onChange={(value) => update('jointTab', value)} />
          )}
          <SliderField label="רוחב הצווארון" value={parameters.rimWidth} min={10} max={160} step={1} suffix=" מ״מ" onChange={(value) => update('rimWidth', value)} />
          <SliderField label="שקיעת הבסיס" value={parameters.baseInset} min={0} max={20} step={1} suffix=" מ״מ" onChange={(value) => update('baseInset', value)} />
          <SliderField label="לשונית בסיס" value={parameters.baseTab} min={0} max={60} step={1} suffix=" מ״מ" onChange={(value) => update('baseTab', value)} />
          <SliderField label="לשונית צווארון" value={parameters.rimTab} min={0} max={60} step={1} suffix=" מ״מ" onChange={(value) => update('rimTab', value)} />
          <p className="field-hint tech-data">פתח שתילה {unitsHe(stats.topOpening)}</p>
        </div>
        </>)}

        {tab === 'light' && (<>
        <div className="sidebar-section">
          <div className="panel-title">תאורה סולארית <Lightbulb size={13} aria-hidden="true" /></div>
          <button type="button" className={`light-me ${lit ? 'on' : ''}`} onClick={lit ? lightOff : lightUp}>
            <Lightbulb size={16} aria-hidden="true" />
            {lit ? 'כבה את התאורה' : 'תאיר אותי'}
          </button>
          <p className="footnote">
            {lit
              ? `הערכה מורכבת על העיצוב הזה: תיבה פנימית שמפרידה בין האדמה לחלל התאורה, חריצים בדפנות שהאור יוצא דרכם, פאנל סולרי בצווארון${light ? `, ופס ${LED_HE[light.led].short} בחלל` : ''}.`
              : 'לחיצה אחת מוסיפה את הערכה כולה לאדנית שעל השולחן — תיבה פנימית להפרדת האדמה מחלל התאורה, חריצים מכורסמים בדפנות, פאנל סולרי בצווארון ופס לד לבן חם בחלל. כל המידות, עד עוצמת ההפעלה, נמדדות מהעיצוב עצמו.'}
          </p>
          {collarNote && <p className="field-hint tech-data">{collarNote}</p>}
        </div>

        {lit && (<>
        <div className="sidebar-section">
          <div className="panel-title">סוג התאורה <span>פס לד</span></div>
          <div className="category-pills" role="group" aria-label="סוג התאורה">
            {LEDS.map((id) => (
              <button
                key={id}
                type="button"
                className={`pill led ${parameters.led === id ? 'active' : ''}`}
                aria-pressed={parameters.led === id}
                onClick={() => update('led', id)}
              >
                <i className="led-dot" style={ledSwatch(id)} aria-hidden="true" />
                {LED_HE[id].short}
              </button>
            ))}
          </div>
          <p className="footnote">{LED_HE[parameters.led].note}</p>
          <div className="category-pills" role="group" aria-label="מיקום הפס">
            {LED_POSITIONS.map((id) => (
              <button
                key={id}
                type="button"
                className={`pill ${parameters.ledPosition === id ? 'active' : ''}`}
                aria-pressed={parameters.ledPosition === id}
                onClick={() => update('ledPosition', id)}
              >{LED_POSITION_HE[id].name}</button>
            ))}
          </div>
          <p className="footnote">{LED_POSITION_HE[parameters.ledPosition].note}</p>
          <div className="category-pills" role="group" aria-label="צפיפות הנורות">
            {LED_DENSITIES.map((step) => (
              <button
                key={step}
                type="button"
                className={`pill ${parameters.ledDensity === step ? 'active' : ''}`}
                aria-pressed={parameters.ledDensity === step}
                onClick={() => update('ledDensity', step)}
              >{step} נורות/מ׳</button>
            ))}
          </div>
          <SliderField label="טבעות פס בחלל" value={parameters.ledRuns} min={1} max={6} step={1} onChange={(value) => update('ledRuns', value)} />
          <SliderField label="עוצמת הפעלה" value={parameters.ledBrightness} min={5} max={100} step={5} suffix="%" onChange={(value) => update('ledBrightness', value)} />
          <SliderField label="שעות אחרי החשכה" value={parameters.ledHours} min={1} max={14} step={1} suffix=" ש׳" onChange={(value) => update('ledHours', value)} />
          <p className="field-hint tech-data">
            {light
              ? `${light.leds} נורות על ${(light.length / 1000).toFixed(2)} מ׳ פס · ${light.watts.toFixed(1)} וואט בהפעלה, ${light.peakWatts.toFixed(1)} וואט מלא`
              : 'לא נבחר פס — החלל נשאר ריק'}
          </p>
          <p className="footnote">
            צפיפות גבוהה יותר היא קו אור רציף במקום שרשרת נקודות — ומושכת פי כמה חשמל, כי כל נורה מושכת את שלה. הפס נדבק לפאה החיצונית של התיבה הפנימית ומביט אל החריצים; טבעת אחת שוטפת מלמטה, שתיים ומעלה מאירות אחיד לכל הגובה.
          </p>
        </div>

        {parameters.led === 'ws2812' && (
        <div className="sidebar-section">
          <div className="panel-title">מצב אפקט <span>{LED_EFFECT_HE[parameters.ledEffect]}</span></div>
          <p className="footnote">כל פיקסל נשלט בנפרד. האפקט מקיף את האדנית, חריץ אחרי חריץ.</p>
          <div className="category-pills" role="group" aria-label="מצב אפקט">
            {LED_EFFECTS.map((mode) => (
              <button
                key={mode.id}
                type="button"
                className={`pill ${parameters.ledEffect === mode.id ? 'active' : ''}`}
                aria-pressed={parameters.ledEffect === mode.id}
                onClick={() => update('ledEffect', mode.id)}
              >{LED_EFFECT_HE[mode.id]}</button>
            ))}
          </div>
          <SliderField label="מהירות" value={parameters.ledSpeed} min={5} max={100} step={5} suffix="%" onChange={(value) => update('ledSpeed', value)} />
          <div className="led-colours" role="group" aria-label="צבע הבסיס">
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
              aria-label="צבע חופשי" onChange={(event) => update('ledColor', event.target.value)}
            />
          </div>
          <div className="category-pills" role="group" aria-label="בקר">
            {LED_CONTROLLER_ORDER.map((id) => (
              <button
                key={id}
                type="button"
                className={`pill ${parameters.ledController === id ? 'active' : ''}`}
                aria-pressed={parameters.ledController === id}
                onClick={() => update('ledController', id)}
              >{LED_CONTROLLER_HE[id]}</button>
            ))}
          </div>
          <p className="field-hint tech-data">
            {light && light.effect !== 'static'
              ? `המצב מדליק בממוצע ${Math.round(light.duty * 100)}% מהפס — לפי זה מחושבים הסוללה וזמן ההפעלה. השנאי עדיין מחושב לכל הפיקסלים בלבן מלא.`
              : 'צבע קבוע — הפס דולק במלואו כל הזמן.'}
          </p>
          <p className="footnote">
            האפקט יושב בבקר, לא בלוח. קובץ החיתוך זהה בכל מצב — מה שמשתנה כאן זה מה שנטען לבקר, וכמה חשמל הוא באמת שותה.
          </p>
        </div>
        )}

        {light && (
        <div className="sidebar-section">
          <div className="panel-title">מפרט חשמלי <span>{light.volts} וולט</span></div>
          <dl className="spec-list tech-data">
            <div><dt>אורך הפס</dt><dd>{(light.length / 1000).toFixed(2)} מ׳ · {light.runs} {light.runs === 1 ? 'טבעת' : 'טבעות'}</dd></div>
            <div><dt>נורות</dt><dd>{light.leds} × {LED_HE[light.led].short}</dd></div>
            <div><dt>צריכה</dt><dd>{light.watts.toFixed(1)} וואט · {light.peakWatts.toFixed(1)} מלא</dd></div>
            <div><dt>זרם</dt><dd>{light.amps.toFixed(2)} אמפר ב־{light.volts} וולט</dd></div>
            <div><dt>ספק מומלץ</dt><dd>{light.volts} וולט · {light.supply} וואט</dd></div>
            <div><dt>נקודות הזנה</dt><dd>{light.feeds} · {light.addressable ? 'דאטה בנקודה אחת' : 'זוג חוטים'}</dd></div>
            <div><dt>פלט אור</dt><dd>≈ {Math.round(light.lumens)} לומן</dd></div>
            <div><dt>קציר סולרי</dt><dd>{light.harvest > 0 ? `${light.harvest.toFixed(1)} ואט־שעה ליום` : 'אין פאנל בצווארון'}</dd></div>
            <div><dt>זמן הפעלה</dt><dd>{light.harvest > 0 ? `${light.runtime.toFixed(1)} שעות מטעינה של יום` : 'מהרשת או מסוללה'}</dd></div>
            <div><dt>סוללה ללילה</dt><dd>{light.battery.toFixed(1)} ואט־שעה · {light.cells} × 18650</dd></div>
          </dl>
          <p className="footnote">
            הספק מחושב עם מרווח של 20% מעל הצריכה המלאה — ספק שרץ בתקרה שלו מתחמם ומתקצר. הזרם והלומנים נמדדים בלבן מלא; מה שכתוב ב„צריכה" הוא מה שהאדנית הזו באמת מושכת ב־{Math.round(parameters.ledBrightness)}%. קציר סולרי מחושב לפי {Math.round(parameters.solarWidth)} × {Math.round(parameters.solarLength)} מ״מ פאנל אופקי ביום ממוצע בישראל, כולל הפסדי טעינה — לא לפי יום קיץ.
          </p>
        </div>
        )}

        <div className="sidebar-section">
          <div className="panel-title">תבנית החריצה <span>כרסום</span></div>
          <div className="category-pills" role="group" aria-label="תבנית החריצה">
            <button
              className={`pill ${parameters.perforation === 'triangles' ? 'active' : ''}`}
              aria-pressed={parameters.perforation === 'triangles'}
              onClick={() => setFamily('triangles')}
            >משולשים</button>
            <button
              className={`pill ${parameters.perforation === 'dots' ? 'active' : ''}`}
              aria-pressed={parameters.perforation === 'dots'}
              onClick={() => setFamily('dots')}
            >נקודות</button>
            <button
              className={`pill ${parameters.perforation === 'shards' ? 'active' : ''}`}
              aria-pressed={parameters.perforation === 'shards'}
              onClick={() => setFamily('shards')}
            >רסיסים</button>
            <button
              className={`pill ${parameters.perforation === 'grid' ? 'active' : ''}`}
              aria-pressed={parameters.perforation === 'grid'}
              onClick={() => setFamily('grid')}
            >רשת</button>
            <button
              className={`pill ${parameters.perforation === 'foldout' ? 'active' : ''}`}
              aria-pressed={parameters.perforation === 'foldout'}
              onClick={() => setFamily('foldout')}
            >חיתוך וכיפול</button>
          </div>
          <PatternPicker
            label="גודל החריצים"
            value={parameters.perforation === 'none' ? 0 : parameters.perfDensity}
            options={PERF_SIZES}
            opening={parameters.perfOpening / 100}
            family={parameters.perforation}
            picked={parameters.perfPicked}
            onChange={setCutSize}
          />
          <SliderField
            label="כמה חומר יוצא" value={parameters.perfOpening} min={4} max={90} step={2} suffix="%"
            onChange={(value) => update('perfOpening', value)}
          />
          <p className="field-hint tech-data">
            {stats.openArea
              ? `${Math.round(model.perfOpenArea * 100)}% מהדופן פתוח · ${cutOuts} ${parameters.perforation === 'foldout' ? 'עלים · בלי הסרת חומר' : 'חריצים'}`
              : 'הדופן נשארת אטומה'}
          </p>
          <p className="footnote">
            {({
              dots: 'נקודות בקטרים מעורבים, מפוזרות אוטומטית בתוך כל פאה — הגדולות יורדות ראשונות והקטנות ממלאות ביניהן. הפיזור זהה בכל הרצה, כך שמה שאישרת הוא מה שייחתך. ',
              shards: 'רסיסים — משולשים ישרי־זווית על רשת, כל אחד מסובב אקראית ורוב הרשת נשארת ריקה, כך שהרשת עצמה אף פעם לא נראית. ',
              grid: 'רשת חורים אחידה, שורה מוסטת ביחס לשורה — הניקוב התעשייתי הפשוט, טוב לפאות שלא אמורות למשוך את העין. ',
              triangles: 'חריצה בתבנית משולשים שנגזרת מהמשולשים של הדופן עצמה. ',
              foldout: 'חיתוך וכיפול — עלי כותרת שנחתכים בשתי צלעות ונשארים מחוברים בשלישית. שום דבר לא יוצא מהלוח: הוא שוקל בסוף בדיוק כמו בהתחלה, והפתח נוצר מהכיפוף עצמו. ',
            } as Record<string, string>)[parameters.perforation] ?? ''}
            כל חריץ נחתך בתוך פאה אחת ולעולם לא חוצה קו קיפול. שתי ידיות נפרדות: <b>כמה חומר יוצא</b> קובע כמה מהלוח נחתך, ו<b>עדינות התבנית</b> קובעת לכמה חלקים הוא מתחלק. אלובונד נושא את העומס בשתי שכבות אלומיניום דקות, ולכן חריצה דקורטיבית נשארת נמוכה — הדופן צריכה להישאר דופן.
          </p>
        </div>

        <div className="sidebar-section">
          <div className="panel-title">כרסום <span>מידות בית המלאכה</span></div>
          <SliderField label="עדינות התבנית" value={parameters.perfDensity} min={1} max={8} step={1} onChange={(value) => update('perfDensity', value)} />
          {parameters.perforation === 'triangles' && (
            <>
              <SliderField
                label="כמה משולשים לחתוך" value={parameters.perfPicked} min={0}
                max={parameters.perfDensity * parameters.perfDensity} step={1}
                onChange={(value) => update('perfPicked', value)}
              />
              <p className="field-hint tech-data">
                {parameters.perfPicked > 0
                  ? `${parameters.perfPicked} מתוך ${parameters.perfDensity * parameters.perfDensity} משולשים בכל פאה`
                  : `כל ${parameters.perfDensity * parameters.perfDensity} המשולשים בכל פאה`}
              </p>
            </>
          )}
          <SliderField label="רווח בין חריצים" value={parameters.perfWeb} min={3} max={40} step={1} suffix=" מ״מ" onChange={(value) => update('perfWeb', value)} />
          <SliderField label="שוליים מקו הקיפול" value={parameters.perfMargin} min={5} max={80} step={1} suffix=" מ״מ" onChange={(value) => update('perfMargin', value)} />
          <SliderField label="קוטר הכרסום" value={parameters.perfTool} min={1} max={20} step={1} suffix=" מ״מ" onChange={(value) => update('perfTool', value)} />
          <SliderField label="שוליים אטומים מלמטה" value={parameters.perfSkirt} min={0} max={Math.round(parameters.height)} step={5} suffix=" מ״מ" onChange={(value) => update('perfSkirt', value)} />
          <SliderField label="גובה האפקט — זרימה" value={parameters.perfFade} min={0} max={Math.round(parameters.height)} step={5} suffix=" מ״מ" onChange={(value) => update('perfFade', value)} />
          {parameters.perforation === 'foldout' && (
            <>
              <SliderField label="זווית הכיפוף" value={parameters.perfLift} min={0} max={90} step={1} suffix="°" onChange={(value) => update('perfLift', value)} />
              <p className="field-hint tech-data">
                הכיפוף ידני — קובץ החיתוך זהה בכל זווית. המחוון כאן הוא לתצוגה ולהערה שיוצאת עם השרטוט.
              </p>
            </>
          )}
          <p className="field-hint tech-data">
            {parameters.perfFade > 0
              ? `בסיס מלא, והתבנית נכנסת בהדרגה לאורך ${Math.round(parameters.perfFade)} מ״מ מעל השוליים`
              : 'התבנית מתחילה בבת אחת בקו השוליים'}
          </p>
          <p className="field-hint tech-data">
            פינות מעוגלות לרדיוס {(parameters.perfTool / 2).toFixed(1)} מ״מ — בדיוק מה שהכרסום משאיר
            {model.perfDropped > 0 ? ` · ${model.perfDropped} תאים נשארו אטומים` : ''}
          </p>
        </div>

        <div className="sidebar-section">
          <div className="panel-title">תיבה פנימית <span>הפרדת אדמה</span></div>
          <SliderField label="חלל התאורה" value={parameters.cavity} min={6} max={60} step={1} suffix=" מ״מ" onChange={(value) => update('cavity', value)} />
          <p className="field-hint tech-data">
            {model.liner
              ? `תיבה בגובה ${Math.round(model.liner.height)} מ״מ · מכילה ${model.liner.litres.toFixed(1)} ליטר אדמה · הרווח ${Math.round(parameters.cavity)}–${Math.round(model.liner.mouthGap)} מ״מ`
              : 'אין מקום לתיבה בחלל הזה — הצר את החלל או הרחב את האדנית'}
          </p>
          <p className="footnote">
            התיבה היא מנסרה פשוטה שעומדת על רצפת האדנית. האדמה נכנסת לתוכה, פס הלד רץ בחלל שמסביבה, ושתי הרצפות מנוקבות לניקוז כדי שהמים לא יישארו בחלל התאורה.
          </p>
        </div>

        <div className="sidebar-section">
          <div className="panel-title">פאנל סולרי <span>בצווארון</span></div>
          <NumberField label="רוחב הפאנל" value={parameters.solarWidth} suffix=" מ״מ" min={30} max={600} onChange={(value) => update('solarWidth', value)} />
          <NumberField label="אורך הפאנל" value={parameters.solarLength} suffix=" מ״מ" min={30} max={600} onChange={(value) => update('solarLength', value)} />
          <p className="field-hint tech-data">
            {panelCut
              ? `החלון נחתך ${Math.round(parameters.solarWidth) - 12} × ${Math.round(parameters.solarLength) - 12} מ״מ — הפאנל נדבק מלמטה ויושב על השוליים`
              : `לא נחתך חלון — הצווארון צריך להיות לפחות ${Math.ceil(parameters.solarLength + 16)} מ״מ`}
          </p>
        </div>
        </>)}
        </>)}

        {tab === 'print' && (<>
        <div className="sidebar-section">
          <div className="panel-title">הדפסת UV ישירה <span>אחרי הכרסום, לפני הכיפוף</span></div>
          <p className="field-hint">
            הלוח מגיע למדפסת כשהוא כבר מחורץ וחתוך, ועדיין שטוח. העיצוב הוא קובץ באותם
            מילימטרים של ה־DXF, רשום לקווי החיתוך שהמכונה כבר עשתה. הפאות הן בדיוק
            השטחים שלא מתקפלים — ולכן מילוי לפי משולשים הוא לא רק יפה כאן, הוא מה
            ששורד את הכיפוף.
          </p>
          <div className="category-pills" role="group" aria-label="מה מודפס">
            {PRINT_MODES.map((id) => (
              <button
                key={id}
                type="button"
                className={`pill ${parameters.print === id ? 'active' : ''}`}
                aria-pressed={parameters.print === id}
                onClick={() => update('print', id as PlanterPrint)}
              >{PRINT_MODE_HE[id].name}</button>
            ))}
          </div>
          <p className="footnote">{PRINT_MODE_HE[parameters.print].note}</p>
        </div>

        {parameters.print === 'triangles' && (
        <div className="sidebar-section">
          <div className="panel-title">מחולל הצבעים <span>כלל המילוי</span></div>
          <div className="category-pills" role="group" aria-label="כלל המילוי">
            {PRINT_RULES.map((id) => (
              <button
                key={id}
                type="button"
                className={`pill ${parameters.printRule === id ? 'active' : ''}`}
                aria-pressed={parameters.printRule === id}
                onClick={() => update('printRule', id as PlanterPrintRule)}
              >{PRINT_RULE_HE[id].name}</button>
            ))}
          </div>
          <p className="footnote">{PRINT_RULE_HE[parameters.printRule].note}</p>
          <button className="action-btn" style={{ marginTop: 'var(--space-4)' }} onClick={reroll}>
            <Shuffle size={12} aria-hidden="true" /> הגרל מחדש · זרע {parameters.printSeed}
          </button>
          <p className="field-hint tech-data">
            הזרע הוא מספר אחד, ולפיו נקבע הכול. אותו זרע נותן אותה אדנית בכל מחשב ובכל
            יום — אדנית שאושרה מודפסת בדיוק בצבעים שאושרו.
          </p>
        </div>
        )}

        {parameters.print === 'triangles' && (
        <div className="sidebar-section">
          <div className="panel-title">פלטה <span className="tech-data">{model.print?.colours ?? 0} צבעים</span></div>
          <div className="stone-grid" role="group" aria-label="פלטות">
            {[...PRINT_PALETTES.map((p) => p.id), CUSTOM_PALETTE].map((id) => {
              const colours = paletteColours(id, parameters.printColors).slice(0, parameters.printTones);
              const stops = colours.map((hex, i) => `${hex} ${(i / colours.length) * 100}%, ${hex} ${((i + 1) / colours.length) * 100}%`);
              return (
                <button
                  key={id}
                  type="button"
                  className={`stone-chip ${parameters.printPalette === id ? 'active' : ''}`}
                  style={{ backgroundImage: `linear-gradient(135deg, ${stops.join(', ')})` }}
                  aria-pressed={parameters.printPalette === id}
                  title={PRINT_PALETTE_HE[id] ?? id}
                  onClick={() => update('printPalette', id)}
                >
                  <span className="stone-name">{PRINT_PALETTE_HE[id] ?? id}</span>
                  <span className="stone-code">{colours.length} גוונים</span>
                </button>
              );
            })}
          </div>
          {parameters.printPalette === CUSTOM_PALETTE && (
            <div className="led-colours" role="group" aria-label="הצבעים שלי" style={{ marginTop: 'var(--space-4)' }}>
              {parameters.printColors.map((hex, index) => (
                <input
                  key={index}
                  type="color"
                  className="led-colour picker"
                  value={hex}
                  aria-label={`צבע ${index + 1}`}
                  onChange={(event) => update(
                    'printColors',
                    parameters.printColors.map((old, i) => (i === index ? event.target.value : old)),
                  )}
                />
              ))}
            </div>
          )}
          <SliderField
            label="כמה גוונים בשימוש" value={parameters.printTones} min={2} max={MAX_PRINT_TONES} step={1}
            onChange={(value) => update('printTones', value)}
          />
          <div className="category-pills" role="group" aria-label="אפקט זוויות">
            <button
              type="button"
              className={`pill ${parameters.printShade > 0 ? 'active' : ''}`}
              aria-pressed={parameters.printShade > 0}
              onClick={() => update('printShade', shadeLevel)}
            >אפקט זוויות</button>
            <button
              type="button"
              className={`pill ${parameters.printShade === 0 ? 'active' : ''}`}
              aria-pressed={parameters.printShade === 0}
              onClick={() => update('printShade', 0)}
            >בלי</button>
          </div>
          {parameters.printShade > 0 && (
            <SliderField
              label="עוצמת האפקט" value={parameters.printShade} min={5} max={100} step={5} suffix="%"
              onChange={(value) => { setShadeLevel(value); update('printShade', value); }}
            />
          )}
          <p className="field-hint tech-data">
            {parameters.printShade > 0
              ? `כל פאה מוכהה או מוארת לפי הכיוון שהיא פונה אליו — ${model.print?.colours ?? 0} צבעים בקובץ במקום ${parameters.printTones}`
              : 'צבע שטוח לכל פאה, בלי הצללה — בדיוק כמו באדנית הקטלוג'}
          </p>
        </div>
        )}

        {parameters.print === 'image' && (
        <div className="sidebar-section">
          <div className="panel-title">קובץ עיצוב <span>PNG · JPG</span></div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg"
            className="sr-only"
            onChange={(event) => loadArtwork(event.target.files?.[0] ?? null)}
          />
          <button className="export-button" onClick={() => fileRef.current?.click()}>
            <ImageIcon size={13} aria-hidden="true" /> {parameters.printImage ? 'החלף קובץ' : 'טען PNG או JPG'}
          </button>
          {parameters.printImage && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={parameters.printImage}
                alt="העיצוב שנטען"
                style={{ width: '100%', borderRadius: 'var(--radius-2)', marginTop: 'var(--space-4)', display: 'block' }}
              />
              <button className="action-btn" style={{ marginTop: 'var(--space-3)' }} onClick={() => update('printImage', '')}>
                <RotateCcw size={12} aria-hidden="true" /> הסר את הקובץ
              </button>
            </>
          )}
          {artworkNote && <p className="field-hint tech-data">{artworkNote}</p>}
          <div className="category-pills" role="group" aria-label="התאמה לפריסה" style={{ marginTop: 'var(--space-4)' }}>
            {PRINT_FITS.map((id) => (
              <button
                key={id}
                type="button"
                className={`pill ${parameters.printFit === id ? 'active' : ''}`}
                aria-pressed={parameters.printFit === id}
                onClick={() => update('printFit', id as PlanterPrintFit)}
              >{PRINT_FIT_HE[id]}</button>
            ))}
          </div>
          <p className="footnote">
            התמונה נפרסת על הפריסה של הדופן, לא על האדנית — וזה אותו דבר, כי ההדפסה נעשית
            שטוח. פיקסל שנוחת על פאה כאן הוא הפיקסל שעומד על הפאה הזו אחרי הקיפול.
          </p>
        </div>
        )}

        {parameters.print !== 'none' && (<>
        <div className="sidebar-section">
          <div className="panel-title">שכבת שרטוט <span>הרישום על האדנית</span></div>
          <div className="category-pills" role="group" aria-label="שכבת שרטוט">
            <button
              type="button"
              className={`pill ${parameters.printOverlay ? 'active' : ''}`}
              aria-pressed={parameters.printOverlay}
              onClick={() => update('printOverlay', true)}
            >עם שרטוט</button>
            <button
              type="button"
              className={`pill ${!parameters.printOverlay ? 'active' : ''}`}
              aria-pressed={!parameters.printOverlay}
              onClick={() => update('printOverlay', false)}
            >בלי</button>
          </div>
          <p className="footnote">
            מד־זווית על כל צומת של הפריסה, קשתות, סמל משולש ישר־זווית על הפאות, וחיוויים —
            והמספרים הם של האדנית הזו: הקוטר שליד צומת הוא הקוטר האמיתי של החישוק שם,
            וה־R שליד פאה הוא הצלע הקצרה שלה. מה שמודפס על העצם הוא השרטוט שלפיו הוא נעשה.
          </p>
          {parameters.printOverlay && (
            <>
              <SliderField
                label="צפיפות הסימונים" value={parameters.printOverlayDensity} min={0} max={100} step={5} suffix="%"
                onChange={(value) => update('printOverlayDensity', value)}
              />
              <div className="led-colours" role="group" aria-label="צבע השרטוט">
                {['#ffffff', '#0d1220', '#d9c9a8', '#8fc2d8'].map((hex) => (
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
                  aria-label="צבע חופשי לשרטוט"
                  onChange={(event) => update('printOverlayInk', event.target.value)}
                />
              </div>
            </>
          )}
        </div>

        <div className="sidebar-section">
          <div className="panel-title">הדפסה בפועל <span>מה המכונה עושה</span></div>
          <SliderField
            label="פוגה מקווי הקיפול" value={parameters.printGrout} min={0} max={MAX_GROUT} step={0.5} suffix=" מ״מ"
            onChange={(value) => update('printGrout', value)}
          />
          <p className="field-hint tech-data">
            {parameters.printGrout > 0
              ? `הדיו נעצר ${parameters.printGrout.toFixed(1)} מ״מ לפני כל קיפול וכל קצה חתוך — ${(model.print?.groutRun ?? 0).toFixed(2)} מ׳ של קיפול נשארים חשופים, ונקראים כפוגה בין אריחים`
              : 'הדיו עובר ישר מעל החריצים. שכבת UV מוקשה נסדקת בדיוק שם, בקו הכי נראה לעין על האדנית'}
          </p>
          <div className="category-pills" role="group" aria-label="מעברי הדפסה">
            <button
              type="button"
              className={`pill ${parameters.printWhite ? 'active' : ''}`}
              aria-pressed={parameters.printWhite}
              onClick={() => update('printWhite', !parameters.printWhite)}
            >בסיס לבן</button>
            <button
              type="button"
              className={`pill ${parameters.printVarnish ? 'active' : ''}`}
              aria-pressed={parameters.printVarnish}
              onClick={() => update('printVarnish', !parameters.printVarnish)}
            >לכה</button>
          </div>
          <p className="footnote">
            {parameters.printWhite
              ? 'בסיס לבן מתחת לצבע — בלעדיו CMYK שקוף נקרא כגוון על המתכת ולא כצבע שאושר.'
              : 'בלי בסיס לבן: הצבע יושב ישר על הלוח ומשתנה עם הזווית. אפקט לגיטימי, חצי מהדיו — אבל לא הפלטה שעל המסך.'}
            {' '}
            {parameters.printVarnish ? 'הלכה היא המעבר האחרון, והיא זו שמחזיקה את ההדפסה בחוץ.' : 'בלי לכה ההדפסה חשופה לשמש ולשפשוף.'}
          </p>
          {job && (
            <dl className="spec-list tech-data">
              <div><dt>עיצוב</dt><dd>{job.mode === 'image' ? PRINT_MODE_HE.image.name : `${PRINT_RULE_HE[parameters.printRule].name} · ${PRINT_PALETTE_HE[parameters.printPalette] ?? parameters.printPalette}`}</dd></div>
              {job.mode === 'triangles' && <div><dt>צבעים</dt><dd>{job.colours}</dd></div>}
              <div><dt>שטח מודפס</dt><dd>{job.areaM2.toFixed(2)} מ״ר</dd></div>
              <div><dt>מעברים</dt><dd>{job.passes}</dd></div>
              <div><dt>דיו</dt><dd>{Math.round(job.inkMl)} מ״ל</dd></div>
              <div><dt>זמן מכונה</dt><dd>{Math.round(job.minutes)} דקות</dd></div>
              <div><dt>משטח ההדפסה</dt><dd>{job.tiles === 1 ? 'מעבר אחד' : `${job.tiles} אריחים`}</dd></div>
              {job.dropped > 0 && <div><dt>פאות חשופות</dt><dd>{job.dropped}</dd></div>}
            </dl>
          )}
          <button className="export-button" style={{ marginTop: 'var(--space-4)' }} onClick={exportPrint}>
            <Download size={13} aria-hidden="true" /> ייצוא קובץ הדפסה
          </button>
          <p className="footnote">
            קובץ ההדפסה יוצא באותו גודל ובאותה נקודת אפס של קובץ החיתוך, עם שכבת רישום
            במג׳נטה שלא מודפסת — מניחים את הלוח המכורסם על המשטח, מיישרים לקו החיתוך שלו,
            ומדפיסים.
          </p>
        </div>
        </>)}
        </>)}

        {tab === 'finish' && (<>
        <div className="sidebar-section">
          <div className="panel-title">חומר <span>גיליון גלם</span></div>
          <div className="select-wrap">
            <label className="sr-only" htmlFor="planter-material">חומר</label>
            <select id="planter-material" value={materialId} onChange={(event) => setMaterialId(event.target.value as MaterialId)}>
              {MATERIALS.map((item) => <option key={item.id} value={item.id}>{materialNameHe(item.id)}</option>)}
            </select>
          </div>
          <NumberField label="רוחב הגיליון" value={parameters.sheetWidth} suffix=" מ״מ" min={300} max={6000} onChange={(value) => update('sheetWidth', value)} />
          <NumberField label="גובה הגיליון" value={parameters.sheetHeight} suffix=" מ״מ" min={300} max={6000} onChange={(value) => update('sheetHeight', value)} />
          <dl className="spec-list tech-data">
            <div><dt>עובי</dt><dd>{material.thickness} מ״מ</dd></div>
            <div><dt>קיפול מרבי</dt><dd>{material.maxBendAngle}°</dd></div>
            <div><dt>שיטה</dt><dd>{material.foldMethod === 'v-groove' ? 'חריץ V' : 'כיפוף בחום'}</dd></div>
          </dl>
        </div>

        <div className="sidebar-section">
          <div className="panel-title">גימור ותפאורה <span>תצוגה מקדימה</span></div>
          <div className="finish-swatches" role="group" aria-label="גימור פני השטח">
            {PLANTER_FINISHES.map((item) => (
              <button
                key={item.id}
                className={`finish-swatch ${finishId === item.id ? 'active' : ''}`}
                style={{ background: item.custom ? customColor : item.color }}
                aria-pressed={finishId === item.id}
                aria-label={FINISH_HE[item.id] ?? item.name}
                title={FINISH_HE[item.id] ?? item.name}
                onClick={() => setFinishId(item.id)}
              />
            ))}
          </div>
          <div className="quick-colours" role="group" aria-label="גוונים מהירים">
            {QUICK_COLOURS.map((swatch) => (
              <button
                key={swatch.hex}
                type="button"
                className={`quick-colour ${finish.custom && customColor.toLowerCase() === swatch.hex ? 'active' : ''}`}
                style={{ background: swatch.hex }}
                title={swatch.name}
                aria-label={swatch.name}
                aria-pressed={finish.custom && customColor.toLowerCase() === swatch.hex}
                onClick={() => { setCustomColor(swatch.hex); setFinishId('custom'); }}
              />
            ))}
          </div>
          {finish.custom && (
            <div className="color-input-row">
              <input
                type="color" id="planter-custom-color" value={customColor}
                onChange={(event) => setCustomColor(event.target.value)}
              />
              <label htmlFor="planter-custom-color">{FINISH_HE[finish.id] ?? finish.name} — בחר כל גוון</label>
            </div>
          )}
          <p className="footnote">{FINISH_HE[finish.id] ?? finish.name} — חומר הייצור שלמעלה הוא זה שקובע עובי, רדיוס כיפוף ומשקל.</p>
          <div className="category-pills" role="group" aria-label="תפאורה">
            {PLANTER_BACKDROPS.map((item) => (
              <button key={item.id} className={`pill ${backdropId === item.id ? 'active' : ''}`} aria-pressed={backdropId === item.id} onClick={() => setBackdropId(item.id)}>{BACKDROP_HE[item.id] ?? item.name}</button>
            ))}
          </div>
          <div className="select-wrap" style={{ marginTop: 'var(--space-4)' }}>
            <label className="sr-only" htmlFor="planter-planting">שתילה</label>
            <select id="planter-planting" value={plant} onChange={(event) => setPlant(event.target.value as PlantId)}>
              {PLANT_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </div>
          {plant !== 'none' && (
            <>
              <SliderField label="גובה הצמח" value={plantLift} min={-45} max={30} step={1} suffix="%" onChange={setPlantLift} />
              <SliderField label="גודל הצמח" value={plantSize} min={40} max={200} step={5} suffix="%" onChange={setPlantSize} />
              <button
                className="action-btn"
                style={{ marginTop: 'var(--space-4)' }}
                onClick={() => { setPlantLift(PLANT_DEFAULT_LIFT); setPlantSize(100); }}
              >
                <RotateCcw size={12} aria-hidden="true" /> איפוס הצמח
              </button>
              <p className="field-hint tech-data">ערך שלילי שוקע את הצמח לתוך האדנית, חיובי מרים אותו מעל הצווארון.</p>
            </>
          )}
        </div>
        </>)}

        {tab === 'stone' && (<>
        <div className="sidebar-section">
          <div className="panel-title">טקסטורה טבעית <span>אבן וסלע</span></div>
          <p className="field-hint">
            ארבעים אבנים מהקטלוג של DXF-STONE, בצביעה ידנית ואומנותית של אנשי הצוות — אחרי
            הקיפול, על האדנית המורכבת. שום קו חיתוך לא זז בגלל מה שנבחר כאן: הקובץ השטוח
            יוצא זהה בית־בית עם אבן ובלעדיה.
          </p>
          <div className="category-pills" role="group" aria-label="משפחת אבן">
            <button
              type="button"
              className={`pill ${stoneFamily === 'all' ? 'active' : ''}`}
              aria-pressed={stoneFamily === 'all'}
              onClick={() => setStoneFamily('all')}
            >הכול</button>
            {STONE_FAMILIES.map((id) => (
              <button
                key={id}
                type="button"
                className={`pill ${stoneFamily === id ? 'active' : ''}`}
                aria-pressed={stoneFamily === id}
                onClick={() => setStoneFamily(id)}
              >{STONE_FAMILY_HE[id] ?? id}</button>
            ))}
          </div>
          <div className="stone-grid" role="group" aria-label="קטלוג האבנים">
            <button
              type="button"
              className={`stone-chip bare ${parameters.stone === 'none' ? 'active' : ''}`}
              aria-pressed={parameters.stone === 'none'}
              onClick={() => update('stone', 'none')}
            >
              <span className="stone-name">בלי אבן</span>
              <span className="stone-code">גימור הלוח</span>
            </button>
            {stoneShelf.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`stone-chip ${parameters.stone === item.id ? 'active' : ''}`}
                style={{ backgroundColor: item.tone, backgroundImage: `url(/media/stone/${item.id}/chip.jpg)` }}
                aria-pressed={parameters.stone === item.id}
                title={STONE_HE[item.id] ?? stoneName(item)}
                onClick={() => update('stone', item.id)}
              >
                <span className="stone-name">{STONE_HE[item.id] ?? stoneName(item)}</span>
                <span className="stone-code">{item.code} · אריח {item.tileMm} מ״מ</span>
              </button>
            ))}
          </div>
        </div>

        {coat && (<>
        <div className="sidebar-section">
          <div className="panel-title">הציפוי <span>עד {MAX_COAT_MM} מ״מ</span></div>
          <SliderField
            label="עובי הציפוי" value={parameters.stoneCoat} min={0} max={MAX_COAT_MM} step={0.5} suffix=" מ״מ"
            onChange={(value) => update('stoneCoat', value)}
          />
          <p className="field-hint tech-data">
            {parameters.stoneCoat > 0
              ? `${coat.passes} ${coat.passes === 1 ? 'מעבר טיח' : 'מעברי טיח'} · ${coat.coats} שכבות · ${coat.days} ${coat.days === 1 ? 'יום עבודה' : 'ימי עבודה'}`
              : 'צבע בלבד, בלי בנייה — כל האבן יושבת בלאסור'}
          </p>
          <SliderField
            label="עומק התבליט" value={parameters.stoneRelief} min={0} max={100} step={5} suffix="%"
            onChange={(value) => update('stoneRelief', value)}
          />
          <p className="field-hint tech-data">
            התצוגה מראה {coat.reliefMm.toFixed(1)} מ״מ של תבליט — בדיוק מה שהבנייה קונה, לא יותר
          </p>
          <SliderField
            label="שינוי גוון בין אצוות" value={parameters.stoneTone} min={0} max={100} step={5} suffix="%"
            onChange={(value) => update('stoneTone', value)}
          />
          <div className="led-colours" role="group" aria-label="גוון הלאסור">
            {STONE_TINTS.map((hex) => (
              <button
                key={hex}
                type="button"
                className={`led-colour ${parameters.stoneTint.toLowerCase() === hex ? 'active' : ''}`}
                style={{ background: hex }}
                title={hex === '#ffffff' ? 'בלי שטיפה — האבן כפי שצולמה' : hex}
                aria-label={hex}
                aria-pressed={parameters.stoneTint.toLowerCase() === hex}
                onClick={() => update('stoneTint', hex)}
              />
            ))}
            <input
              type="color" className="led-colour picker" value={parameters.stoneTint}
              aria-label="שטיפה חופשית" onChange={(event) => update('stoneTint', event.target.value)}
            />
          </div>
          <div className="category-pills" role="group" aria-label="אטים">
            {STONE_SEALS.map((id) => (
              <button
                key={id}
                type="button"
                className={`pill ${parameters.stoneSeal === id ? 'active' : ''}`}
                aria-pressed={parameters.stoneSeal === id}
                onClick={() => update('stoneSeal', id)}
              >{STONE_SEAL_HE[id].name}</button>
            ))}
          </div>
          <p className="footnote">{STONE_SEAL_HE[parameters.stoneSeal].note}</p>
        </div>

        <div className="sidebar-section">
          <div className="panel-title">כרטיס צבע <span>{coat.code}</span></div>
          <dl className="spec-list tech-data">
            <div><dt>אבן</dt><dd>{STONE_HE[coat.stone] ?? coat.stone}</dd></div>
            <div><dt>שטח לצביעה</dt><dd>{coat.areaM2.toFixed(2)} מ״ר · דופן וצווארון</dd></div>
            <div><dt>שכבות</dt><dd>{coat.coats} · מתוכן {coat.passes} בנייה</dd></div>
            <div><dt>טיח לערבב</dt><dd>{coat.litres.toFixed(1)} ליטר</dd></div>
            <div><dt>תוספת משקל</dt><dd>{coat.kg.toFixed(1)} ק״ג</dd></div>
            <div><dt>זמן שולחן</dt><dd>{coat.hours.toFixed(1)} שעות · {coat.days} {coat.days === 1 ? 'יום' : 'ימים'}</dd></div>
            <div><dt>מרחק מקיפול</dt><dd>{coat.keepOut.toFixed(0)} מ״מ · {coat.reliefRun.toFixed(2)} מ׳ קיפולים</dd></div>
            <div>
              <dt>חריצים אחרי צבע</dt>
              <dd>{coat.opening > 0
                ? `${coat.opening.toFixed(0)} ← ${Math.max(0, coat.throat).toFixed(0)} מ״מ`
                : 'דופן אטומה'}</dd>
            </div>
            <div><dt>אטים</dt><dd>{STONE_SEAL_HE[coat.seal].name}</dd></div>
          </dl>
          <p className="footnote">
            הלאסור הוא של הצַבָּע: הוא מוציא את הבליטות, מציף שטיפה לתוך השקעים, ומחליט איפה
            בדיוק האדנית הזו בלתה. אין שתי אדניות זהות, וזה לא פגם — זה מה שקונים.
          </p>
        </div>
        </>)}
        </>)}

        {tab === 'export' && (
        <div className="sidebar-section">
          <div className="panel-title">ייצוא <span>קנה מידה 1:1</span></div>
          <button className="export-button" onClick={exportSvg}>
            <Download size={13} aria-hidden="true" /> ייצוא SVG
          </button>
          <button className="export-button export-secondary" onClick={exportDxf}>
            <Download size={13} aria-hidden="true" /> ייצוא DXF
          </button>
          {job && (
            <button className="export-button export-secondary" onClick={exportPrint}>
              <Printer size={13} aria-hidden="true" /> ייצוא קובץ הדפסה
            </button>
          )}
          <p className="footnote">
            {model.sheets > 1
              ? `הדופן, לוח הבסיס והצווארון מקוננים על פני ${model.sheets} גיליונות. ה־DXF שומר את CUT, MOUNTAIN ו־VALLEY בשכבות נפרדות — חורצים מהצד האחורי.`
              : 'הדופן, לוח הבסיס והצווארון מקוננים על גיליון אחד. ה־DXF שומר את CUT, MOUNTAIN ו־VALLEY בשכבות נפרדות — חורצים מהצד האחורי.'}
          </p>
          <dl className="spec-list tech-data">
            <div><dt>גיליון מקונן</dt><dd>{unitsHe(stats.sheetUsage)}</dd></div>
            <div><dt>אורך חיתוך</dt><dd>{unitsHe(stats.cutLength)}</dd></div>
            <div><dt>אורך חריצה</dt><dd>{unitsHe(stats.creaseLength)}</dd></div>
            <div><dt>משקל משוער</dt><dd>{unitsHe(stats.estimatedWeight)}</dd></div>
          </dl>
        </div>
        )}
      </aside>

      <div className="main-stage">
        <section className="panel viewport three-viewport" ref={viewportRef}>
          <div className="viewport-header">
            <div className="viewport-heading">
              <h2>הרכבה</h2>
              <p className="tech-data">{stats.facets} פאות · קיפול תלול ביותר {model.maxBend.toFixed(0)}° · מכילה {unitsHe(stats.volume)}</p>
            </div>
            <div className="view-presets" role="group" aria-label="זווית מצלמה">
              {VIEW_LABELS.map((item) => (
                <button key={item.id} className={`preset-pill ${view === item.id ? 'active' : ''}`} aria-pressed={view === item.id} onClick={() => setView(item.id)}>{item.label}</button>
              ))}
            </div>
          </div>
          <div className="fold-control-bar">
            <label className="fold-readout" htmlFor="planter-assembly"><span>מורכב</span><b className="tech-data">{Math.round(parameters.assembly)}%</b></label>
            <input id="planter-assembly" type="range" min="0" max="100" value={parameters.assembly} onChange={(event) => update('assembly', Number(event.target.value))} />
            <div className="fold-actions">
              <button className="action-btn" onClick={() => setPlaying((value) => !value)} disabled={reducedMotion} title={reducedMotion ? 'מושבת כל עוד המערכת מבקשת פחות תנועה' : undefined}>
                {playing ? <Pause size={12} aria-hidden="true" /> : <Play size={12} aria-hidden="true" />} {playing ? 'עצור' : 'נגן'}
              </button>
              <button className="action-btn" onClick={() => { setPlaying(false); update('assembly', 100); }}><RotateCcw size={12} aria-hidden="true" /> איפוס</button>
            </div>
          </div>
          <PlanterPreview
            model={model} finish={finish} customColor={customColor} plant={plant} backdrop={backdrop}
            plantLift={plantLift} plantSize={plantSize}
            assembly={parameters.assembly} view={view} viewportRef={viewportRef}
          />
          <p className="viewport-footnote">שני קצות המחוון הם גאומטריה אמיתית בקנה מידה 1:1. המעבר ביניהם מזיז כל פינה בקו ישר — הוא מראה את ההרכבה, לא את הכיפוף עצמו.</p>
        </section>
      </div>

      <aside className="right-column">
        <section className="panel viewport two-d">
          <div className="viewport-header">
            <div className="viewport-heading">
              <h2>גיליון הכרסום</h2>
              <p className="tech-data">{unitsHe(stats.sheetUsage)} מקונן · גלם {parameters.sheetWidth} × {parameters.sheetHeight} מ״מ</p>
            </div>
          </div>
          <div className="svg-viewport"><PlanterNet model={model} /></div>
          <div className="view-legend">
            <span><svg width="22" height="7" aria-hidden="true"><line x1="0" y1="3.5" x2="22" y2="3.5" stroke={FOLD_COLORS.mountain} strokeWidth="2" /></svg>הר</span>
            <span><svg width="22" height="7" aria-hidden="true"><line x1="0" y1="3.5" x2="22" y2="3.5" stroke={FOLD_COLORS.valley} strokeWidth="2" strokeDasharray="7 4" /></svg>עמק</span>
            <span><svg width="22" height="7" aria-hidden="true"><line x1="0" y1="3.5" x2="22" y2="3.5" stroke={FOLD_COLORS.cut} strokeWidth="2" strokeDasharray="9 3 2 3" /></svg>חיתוך</span>
          </div>
        </section>

        <section className="panel right-panel">
          <div className="info-hero">
            <h1>{STYLE_HE[style.id]?.name ?? style.name}</h1>
            <p>{STYLE_HE[style.id]?.subtitle ?? style.subtitle}</p>
            <p className="hero-desc">{STYLE_HE[style.id]?.description ?? style.description}</p>
            <div className="tag-row">{(STYLE_HE[style.id]?.applications ?? style.applications).map((use) => <span className="tag" key={use}>{use}</span>)}</div>
          </div>

          <div className="info-section">
            <h3>בדיקת ייצור</h3>
            <CheckList checks={checks} />
          </div>

          <div className="info-section">
            <h3>האדנית</h3>
            <div className="stat-grid tech-data">
              <div><div className="stat-label">{model.parameters.footprint === 'rectangle' ? 'בסיס × חישוקים' : 'צלעות × חישוקים'}</div><div className="stat-value">{model.parameters.footprint === 'rectangle' ? 'מלבן' : model.parameters.sides}×{model.parameters.rows}</div></div>
              <div><div className="stat-label">פאות</div><div className="stat-value">{stats.facets}</div></div>
              <div><div className="stat-label">גובה</div><div className="stat-value">{Math.round(parameters.height)}<em>מ״מ</em></div></div>
              <div><div className="stat-label">{model.parameters.footprint === 'rectangle' ? 'הרחב ביותר ר × א' : '⌀ הרחב ביותר'}</div><div className="stat-value">{stats.footprint.replace(' mm', '')}<em>מ״מ</em></div></div>
              <div><div className="stat-label">פתח שתילה</div><div className="stat-value">{stats.topOpening.replace(' mm', '')}<em>מ״מ</em></div></div>
              <div><div className="stat-label">קיבולת</div><div className="stat-value">{stats.volume.replace('≈ ', '').replace(' L', '')}<em>ליטר</em></div></div>
            </div>
          </div>

          <div className="info-section">
            <h3>הגיליון</h3>
            <div className="stat-grid tech-data">
              <div><div className="stat-label">גודל מקונן</div><div className="stat-value">{Math.ceil(model.sheet.width)}×{Math.ceil(model.sheet.height)}<em>מ״מ</em></div></div>
              <div><div className="stat-label">גיליונות גלם</div><div className="stat-value">{stats.sheets}</div></div>
              <div><div className="stat-label">משקל משוער</div><div className="stat-value">{unitsHe(stats.estimatedWeight)}</div></div>
              <div><div className="stat-label">אורך חיתוך</div><div className="stat-value">{unitsHe(stats.cutLength)}</div></div>
              <div><div className="stat-label">אורך חריצה</div><div className="stat-value">{unitsHe(stats.creaseLength)}</div></div>
              <div><div className="stat-label">קיפול תלול ביותר</div><div className="stat-value">{model.maxBend.toFixed(0)}<em>°</em></div></div>
              <div><div className="stat-label">שגיאת פרישה</div><div className="stat-value">{model.developmentError.toFixed(2)}<em>מ״מ</em></div></div>
            </div>
          </div>

          <div className="info-section">
            <h3>החומר</h3>
            <div className="recommendation">
              <span className="material-swatch" style={{ background: `linear-gradient(135deg, ${material.color}, ${material.accent})` }} />
              <div>
                <strong>{materialNameHe(material.id)}</strong>
                <span className="tech-data">{material.thickness} מ״מ · r{material.minRadius} · ≤{material.maxBendAngle}°</span>
              </div>
            </div>
            <p className="footnote">
              {style.recommendedMaterial === materialId
                ? `${materialShortHe(material.id)} הוא הגלם המומלץ ל${STYLE_HE[style.id]?.name ?? style.name}.`
                : `${STYLE_HE[style.id]?.name ?? style.name} נחתך בדרך כלל מ${materialShortHe(style.recommendedMaterial)}.`}
            </p>
          </div>
        </section>
      </aside>
    </>
  );
}
