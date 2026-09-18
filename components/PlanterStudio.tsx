'use client';

import { ContactShadows, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import { Download, Maximize2, Pause, Play, RotateCcw, Rotate3D, Search, SlidersHorizontal } from 'lucide-react';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { CheckList, NumberField, SliderField } from '@/components/controls';
import { CameraRig, StudioLights } from '@/components/three-stage';
import { buildFoldTree, cornersAt, internalEdges, type FoldTree } from '@/lib/fold-tree';
import { getMaterial, MATERIALS } from '@/lib/pattern-engine';
import {
  buildPlanterDxf, buildPlanterModel, buildPlanterSvg, DEFAULT_PLANTER, FOLD_COLORS,
  getPlanterChecks, getPlanterStats, placedGeometry,
} from '@/lib/planter-engine';
import {
  backdropById, finishById, gradientTexture, PLANTER_BACKDROPS, PLANTER_FINISHES,
  type PlanterBackdrop, type PlanterFinish,
} from '@/lib/planter-finishes';
import { BLANK_PLANTER, getPlanterStyle, PLANTER_CATEGORIES, PLANTER_PRESETS, PLANTER_STYLES } from '@/lib/planter-styles';
import type {
  FoldKind, MaterialId, PlanterCategory, PlanterConstruction, PlanterFootprint, PlanterModel,
  PlanterParameters, PlanterPiece, PlanterStyleId, Vec2, Vec3,
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

interface ShellPiece {
  tree: FoldTree;
  crease: { tri: number; corners: [number, number] }[];
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
        pieces.push({ tree, crease: internalEdges(ids) });
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
      pieces.push({ tree, crease: internalEdges(ids) });
    }

    const shape = (points: { x: number; y: number }[], hole?: { cx: number; cy: number; r: number }) => {
      const path = new THREE.Shape();
      const cx = points.reduce((sum, point) => sum + point.x, 0) / points.length;
      const cy = points.reduce((sum, point) => sum + point.y, 0) / points.length;
      points.forEach((point, i) => {
        const x = (point.x - cx) * scale;
        const y = (point.y - cy) * scale;
        if (i === 0) path.moveTo(x, y); else path.lineTo(x, y);
      });
      path.closePath();
      if (hole) {
        const ring = new THREE.Path();
        ring.absarc((hole.cx - cx) * scale, (hole.cy - cy) * scale, hole.r * scale, 0, Math.PI * 2, true);
        path.holes.push(ring);
      }
      return new THREE.ShapeGeometry(path);
    };

    // A banded wall contributes one piece per band ahead of the plates, so the
    // plates are found by id rather than by a fixed index.
    const basePiece = model.pieces.find((piece) => piece.id === 'base') as PlanterPiece;
    const rimPiece = model.pieces.find((piece) => piece.id === 'rim') as PlanterPiece;
    const base = shape(basePiece.outline);
    const rim = shape(rimPiece.outline, rimPiece.circles[0]);
    // ShapeGeometry is drawn in XY. Both plates lie flat in both states, so both
    // get the same quarter turn and only their position has to move.
    base.rotateX(-Math.PI / 2);
    rim.rotateX(-Math.PI / 2);

    // Both plates already sit on the pot's own axis once built, so they start
    // flat right there too and simply rise or drop into place — not off at
    // whatever corner of the cutting sheet the nester happened to land them.
    const planeExtent = (piece: PlanterPiece) => Math.hypot(piece.width, piece.height) / 2;

    // The camera has to frame both ends of the fold, so the radius is read
    // straight off the flat (t = 0) and built (t = 1) corner positions rather
    // than estimated from the sheet — which no longer positions the pieces at all.
    let extent = 0;
    for (const piece of pieces) {
      for (const tParam of [0, 1]) {
        for (const tri of cornersAt(piece.tree, tParam)) {
          for (const raw of tri) {
            const p = toWorld(raw);
            extent = Math.max(extent, Math.hypot(p.x, p.z), Math.abs(p.y));
          }
        }
      }
    }

    return {
      pieces, scale, base, rim,
      baseFlat: new THREE.Vector3(0, 0, 0),
      baseBuilt: new THREE.Vector3(0, 0.001, 0),
      rimFlat: new THREE.Vector3(0, 0, 0),
      rimBuilt: new THREE.Vector3(0, height * scale, 0),
      openingRadius: (rimPiece.circles[0]?.r ?? 0) * scale,
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

  const { wall, creases } = useMemo(() => {
    const pos: number[] = [];
    const creaseData: number[] = [];
    for (const piece of shell.pieces) {
      const corners = cornersAt(piece.tree, t).map((tri) => tri.map(toWorld));
      for (const tri of corners) for (const p of tri) pos.push(p.x, p.y, p.z);
      for (const edge of piece.crease) {
        const a = corners[edge.tri][edge.corners[0]];
        const b = corners[edge.tri][edge.corners[1]];
        creaseData.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }

    const surface = new THREE.BufferGeometry();
    surface.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    surface.computeVertexNormals();

    const lines = new THREE.BufferGeometry();
    lines.setAttribute('position', new THREE.BufferAttribute(new Float32Array(creaseData), 3));

    return { wall: surface, creases: lines };
  }, [shell, t]);

  // Each geometry gets its own cleanup. Sharing one effect would dispose buffers
  // that are still mounted every time only the assembly slider moves.
  useEffect(() => () => { wall.dispose(); }, [wall]);
  useEffect(() => () => { creases.dispose(); }, [creases]);
  useEffect(() => () => { shell.base.dispose(); }, [shell.base]);
  useEffect(() => () => { shell.rim.dispose(); }, [shell.rim]);

  useFrame((_, delta) => {
    if (group.current && autoRotate.current) group.current.rotation.y += delta * 0.22;
  });

  return (
    <group ref={group}>
      <mesh geometry={wall} frustumCulled={false}>
        <meshStandardMaterial
          color={wallColor} metalness={finish.metalness} roughness={finish.roughness}
          side={THREE.DoubleSide} flatShading
        />
      </mesh>
      <mesh geometry={shell.base} position={shell.baseFlat.clone().lerp(shell.baseBuilt, t)} frustumCulled={false}>
        <meshStandardMaterial color={accentColor} metalness={finish.metalness} roughness={finish.roughness} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={shell.rim} position={shell.rimFlat.clone().lerp(shell.rimBuilt, t)} frustumCulled={false}>
        <meshStandardMaterial color={accentColor} metalness={finish.metalness} roughness={finish.roughness} side={THREE.DoubleSide} />
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
        {pieces.map((piece) => {
          const { outline, folds, circles } = placedGeometry(piece);
          return (
            <g key={piece.id}>
              <polygon
                points={outline.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ')}
                fill="rgba(120,132,168,0.09)"
                stroke={FOLD_COLORS.cut} strokeWidth={weight} strokeDasharray={STROKE_DASH.cut}
              />
              {circles.map((circle, i) => (
                <circle
                  key={i} cx={circle.cx} cy={circle.cy} r={circle.r}
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

export default function PlanterStudio({ onStatus }: { onStatus?: (status: StudioStatus) => void }) {
  const [parameters, setParameters] = useState<PlanterParameters>(
    () => ({ ...DEFAULT_PLANTER, ...PLANTER_PRESETS[0].parameters }),
  );
  const [presetId, setPresetId] = useState(PLANTER_PRESETS[0].id);
  const [materialId, setMaterialId] = useState<MaterialId>('acp-4');
  const [finishId, setFinishId] = useState(PLANTER_FINISHES[2].id);
  const [customColor, setCustomColor] = useState('#c0392b');
  const [backdropId, setBackdropId] = useState(PLANTER_BACKDROPS[0].id);
  const [plant, setPlant] = useState<PlantId>('none');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<PlanterCategory | 'all'>('all');
  const [view, setView] = useState<ViewAngle>('hero');
  const [playing, setPlaying] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);

  const material = getMaterial(materialId);
  const finish = finishById(finishId);
  const backdrop = backdropById(backdropId);
  const style = getPlanterStyle(parameters.style);
  const model = useMemo(() => buildPlanterModel(parameters), [parameters]);
  const stats = useMemo(() => getPlanterStats(model, material), [model, material]);
  const checks = useMemo(() => getPlanterChecks(model, material), [model, material]);
  const blocking = checks.some((check) => check.severity === 'error');

  const filtered = PLANTER_PRESETS.filter((preset) =>
    (category === 'all' || preset.category === category)
    && (search.trim() === '' || `${preset.name} ${preset.note}`.toLowerCase().includes(search.trim().toLowerCase())));

  const update = useCallback(<K extends keyof PlanterParameters>(key: K, value: PlanterParameters[K]) => {
    setParameters((current) => ({ ...current, [key]: value }));
  }, []);

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

  const readout = `${parameters.footprint === 'rectangle' ? 'Rectangle' : `${parameters.sides} sides`} · ${parameters.rows} ${parameters.rows === 1 ? 'band' : 'bands'}${parameters.construction === 'banded' ? ' · banded' : ''}`;
  useEffect(() => {
    onStatus?.({ blocking, readout: [material.shortName, readout] });
  }, [onStatus, blocking, material.shortName, readout]);

  const fileStem = `dxf-ac3d-planter-${presetId}-${parameters.sides}s-${Math.round(parameters.height)}mm`;

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
            <button className={`pill ${parameters.construction === 'banded' ? 'active' : ''}`} aria-pressed={parameters.construction === 'banded'} onClick={() => update('construction', 'banded' as PlanterConstruction)}>Banded (riveted)</button>
          </div>
          <p className="footnote">
            {parameters.construction === 'banded'
              ? 'Each band is its own strip, riveted ring to ring — the only way to build a bulged or waisted wall.'
              : 'The whole wall folds from one blank. Fine for taper, stagger, twist and rhythm; a bulge needs banded.'}
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
            {Math.abs(parameters.bulge) > 0.5 && parameters.construction !== 'banded'
              ? 'A bulge is curvature — switch to banded construction to build it'
              : `Develops flat to ${model.developmentError.toFixed(2)} mm`}
          </p>
        </div>

        <div className="sidebar-section">
          <div className="panel-title">Fittings <span>Assembly</span></div>
          <SliderField label="Seam tab" value={parameters.tabWidth} min={0} max={80} step={1} suffix="mm" onChange={(value) => update('tabWidth', value)} />
          {parameters.construction === 'banded' && (
            <SliderField label="Joint tab" value={parameters.jointTab} min={0} max={80} step={1} suffix="mm" onChange={(value) => update('jointTab', value)} />
          )}
          <SliderField label="Collar width" value={parameters.rimWidth} min={10} max={160} step={1} suffix="mm" onChange={(value) => update('rimWidth', value)} />
          <SliderField label="Base inset" value={parameters.baseInset} min={0} max={20} step={1} suffix="mm" onChange={(value) => update('baseInset', value)} />
          <SliderField label="Base tab" value={parameters.baseTab} min={0} max={60} step={1} suffix="mm" onChange={(value) => update('baseTab', value)} />
          <SliderField label="Collar tab" value={parameters.rimTab} min={0} max={60} step={1} suffix="mm" onChange={(value) => update('rimTab', value)} />
          <p className="field-hint tech-data">Planting hole {stats.topOpening} ⌀</p>
        </div>

        <div className="sidebar-section">
          <div className="panel-title">Material <span>Stock</span></div>
          <div className="select-wrap">
            <label className="sr-only" htmlFor="planter-material">Material</label>
            <select id="planter-material" value={materialId} onChange={(event) => setMaterialId(event.target.value as MaterialId)}>
              {MATERIALS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </div>
          <NumberField label="Sheet width" value={parameters.sheetWidth} suffix="mm" min={300} max={6000} onChange={(value) => update('sheetWidth', value)} />
          <NumberField label="Sheet height" value={parameters.sheetHeight} suffix="mm" min={300} max={6000} onChange={(value) => update('sheetHeight', value)} />
          <dl className="spec-list tech-data">
            <div><dt>Thickness</dt><dd>{material.thickness} mm</dd></div>
            <div><dt>Max. bend</dt><dd>{material.maxBendAngle}°</dd></div>
            <div><dt>Method</dt><dd>{material.foldMethod === 'v-groove' ? 'V-groove' : 'Heat bend'}</dd></div>
          </dl>
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
          <div className="panel-title">Export <span>1 : 1 scale</span></div>
          <button className="export-button" onClick={() => download(`${fileStem}.svg`, buildPlanterSvg(model, material, style.name), 'image/svg+xml')}>
            <Download size={13} aria-hidden="true" /> Export SVG
          </button>
          <button className="export-button export-secondary" onClick={() => download(`${fileStem}.dxf`, buildPlanterDxf(model), 'image/vnd.dxf')}>
            <Download size={13} aria-hidden="true" /> Export DXF
          </button>
          <p className="footnote">
            {model.sheets > 1
              ? `Wall, base plate and collar nested across ${model.sheets} stock sheets. The DXF keeps CUT, MOUNTAIN and VALLEY on separate layers — groove the reverse face.`
              : 'Wall, base plate and collar nested on one sheet. The DXF keeps CUT, MOUNTAIN and VALLEY on separate layers — groove the reverse face.'}
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
          <p className="viewport-footnote">Both ends of the slider are real geometry at 1:1. The walk between them moves each corner in a straight line — it shows the assembly, not the forming.</p>
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
          <div className="svg-viewport"><PlanterNet model={model} /></div>
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
              {style.recommendedMaterial === materialId
                ? `${material.shortName} is the recommended stock for ${style.name}.`
                : `${style.name} is usually cut from ${getMaterial(style.recommendedMaterial).shortName}.`}
            </p>
          </div>
        </section>
      </aside>
    </>
  );
}
