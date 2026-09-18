'use client';

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, OrbitControls } from '@react-three/drei';
import { Download, Grid3x3, Maximize2, Pause, Play, RotateCcw, Rotate3D, Search, SlidersHorizontal } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { CheckList, NumberField, SliderField } from '@/components/controls';
import PlanterStudio, { type StudioStatus } from '@/components/PlanterStudio';
import { CameraRig, StudioLights } from '@/components/three-stage';
import { getPattern, PATTERNS } from '@/lib/patterns';
import { chainFoldLines } from '@/lib/polyline';
import {
  buildFoldLines, DEFAULT_PARAMETERS, getCellDimensions, getFabricationChecks, getFoldedGrid, getFoldMechanics,
  getMaterial, getPatternStats, MATERIALS,
} from '@/lib/pattern-engine';
import type { FoldKind, FoldLine, MaterialId, PatternCategory, PatternId, PatternParameters } from '@/lib/types';

const CATEGORIES: { id: PatternCategory | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'geometric', label: 'Geometric' },
  { id: 'origami', label: 'Origami' },
  { id: 'architectural', label: 'Architectural' },
  { id: 'custom', label: 'Custom' },
];

type ViewAngle = 'iso' | 'top' | 'front' | 'back' | 'left' | 'right' | 'bottom';

/** Directions only — the distance is fitted to the panel and the viewport. */
const VIEW_DIRS: Record<ViewAngle, [number, number, number]> = {
  iso: [0.5, 0.42, 1], top: [0, 1, 0.04], front: [0, 0, 1], back: [0, 0, -1],
  left: [-1, 0.05, 0], right: [1, 0.05, 0], bottom: [0, -1, 0.04],
};

const VIEW_LABELS: { id: ViewAngle; label: string }[] = [
  { id: 'iso', label: 'ISO' }, { id: 'top', label: 'TOP' }, { id: 'front', label: 'FRT' },
  { id: 'back', label: 'BCK' }, { id: 'left', label: 'LFT' }, { id: 'right', label: 'RGT' }, { id: 'bottom', label: 'BTM' },
];

/** Longest edge of the sheet, in world units. Every other 3D dimension derives from this. */
const PANEL_FIT = 5.6;
/** Segments per crease when draping it over the folded surface. */
const CREASE_SEGMENTS = 6;

// Origami notation: mountain solid, valley dashed, cut dash-dot. Hue is the fast
// read on screen; the dash is what survives a greyscale shop printout, and it is
// the only cue a colourblind operator gets.
const STROKE: Record<FoldKind, { dash?: string; weight: number; thumbWeight: number }> = {
  mountain: { weight: 1.6, thumbWeight: 1.1 },
  valley: { dash: '7 4', weight: 1.4, thumbWeight: 1 },
  cut: { dash: '9 3 2 3', weight: 1, thumbWeight: 0.7 },
};

function foldColor(kind: FoldKind): string {
  return kind === 'mountain' ? '#ff5f8f' : kind === 'valley' ? '#57d7e8' : '#6b7085';
}

/** Fit the sheet into a box without distorting it — a drawing to scale, or it is not a drawing. */
function fitPanel(panelWidth: number, panelHeight: number, boxWidth: number, boxHeight: number) {
  const scale = Math.min(boxWidth / panelWidth, boxHeight / panelHeight);
  const width = panelWidth * scale;
  const height = panelHeight * scale;
  return { scale, width, height, offsetX: (boxWidth - width) / 2, offsetY: (boxHeight - height) / 2 };
}

// ---------------------------------------------------------------------------
// 3D
// ---------------------------------------------------------------------------

function useFoldedGeometry(patternId: PatternId, parameters: PatternParameters) {
  return useMemo(() => {
    const grid = getFoldedGrid(patternId, parameters);
    const rows = Math.max(1, Math.floor(parameters.rows));
    const columns = Math.max(1, Math.floor(parameters.columns));
    const panelWidth = Math.max(1, Math.abs(parameters.panelWidth));
    const panelHeight = Math.max(1, Math.abs(parameters.panelHeight));
    const scale = PANEL_FIT / Math.max(panelWidth, panelHeight);

    // The 2D drawing uses SVG convention (y grows downward); three.js is y-up.
    // Negating y here keeps row 0 at the top of both panes instead of mirroring
    // the model against the drawing sitting next to it.
    const nodeX = (c: number) => grid.xs[c] * scale;
    const nodeY = (r: number) => -grid.ys[r] * scale;
    const nodeZ = (r: number, c: number) => grid.heights[r][c] * scale;

    const positions: number[] = [];
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < columns; c += 1) {
        // Counter-clockwise in world space, so the face normals point at the camera.
        const corners = [
          [nodeX(c), nodeY(r), nodeZ(r, c)],
          [nodeX(c), nodeY(r + 1), nodeZ(r + 1, c)],
          [nodeX(c + 1), nodeY(r + 1), nodeZ(r + 1, c + 1)],
          [nodeX(c + 1), nodeY(r), nodeZ(r, c + 1)],
        ];
        // The cell centre is the mean of its corners. Pinning it to zero punches a
        // cone through every cell whose corners share a height — a quarter of the
        // cells in the pinwheel and swirl grids.
        const centreX = (corners[0][0] + corners[2][0]) / 2;
        const centreY = (corners[0][1] + corners[2][1]) / 2;
        const centreZ = corners.reduce((sum, corner) => sum + corner[2], 0) / 4;
        for (let i = 0; i < 4; i += 1) {
          const a = corners[i];
          const b = corners[(i + 1) % 4];
          positions.push(centreX, centreY, centreZ, a[0], a[1], a[2], b[0], b[1], b[2]);
        }
      }
    }
    const surface = new THREE.BufferGeometry();
    surface.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    surface.computeVertexNormals();

    // Drape each crease over the folded surface rather than leaving it flat in the
    // unfolded plane, so the overlay reads as creases on the model.
    const { cellWidth, cellHeight } = getCellDimensions(parameters);
    const onSurface = (x: number, y: number): [number, number, number] => {
      const gx = Math.min(Math.max(x / cellWidth, 0), columns);
      const gy = Math.min(Math.max(y / cellHeight, 0), rows);
      const c = Math.min(Math.floor(gx), columns - 1);
      const r = Math.min(Math.floor(gy), rows - 1);
      const fx = gx - c;
      const fy = gy - r;
      const h = grid.heights;
      const top = h[r][c] * (1 - fx) + h[r][c + 1] * fx;
      const bottom = h[r + 1][c] * (1 - fx) + h[r + 1][c + 1] * fx;
      return [
        (grid.xs[c] + (grid.xs[c + 1] - grid.xs[c]) * fx) * scale,
        -(grid.ys[r] + (grid.ys[r + 1] - grid.ys[r]) * fy) * scale,
        (top * (1 - fy) + bottom * fy) * scale,
      ];
    };

    const creasePositions: number[] = [];
    const creaseColors: number[] = [];
    for (const line of buildFoldLines(patternId, parameters)) {
      const tint = new THREE.Color(foldColor(line.kind)).convertSRGBToLinear();
      let previous = onSurface(line.x1, line.y1);
      for (let step = 1; step <= CREASE_SEGMENTS; step += 1) {
        const t = step / CREASE_SEGMENTS;
        const next = onSurface(line.x1 + (line.x2 - line.x1) * t, line.y1 + (line.y2 - line.y1) * t);
        creasePositions.push(previous[0], previous[1], previous[2], next[0], next[1], next[2]);
        creaseColors.push(tint.r, tint.g, tint.b, tint.r, tint.g, tint.b);
        previous = next;
      }
    }
    const creases = new THREE.BufferGeometry();
    creases.setAttribute('position', new THREE.Float32BufferAttribute(creasePositions, 3));
    creases.setAttribute('color', new THREE.Float32BufferAttribute(creaseColors, 3));

    const halfWidth = (grid.foldedWidth / 2) * scale;
    const halfHeight = (grid.foldedHeight / 2) * scale;
    const halfDepth = Math.max(...grid.heights.flat().map(Math.abs), 1) * scale;
    return {
      surface,
      creases,
      radius: Math.max(0.5, Math.hypot(halfWidth, halfHeight, halfDepth)),
      groundY: -halfHeight - halfDepth - 0.25,
    };
  }, [patternId, parameters]);
}

function FoldedPanel({ patternId, parameters, materialId, autoRotate, showWireframe }: {
  patternId: PatternId; parameters: PatternParameters; materialId: MaterialId;
  autoRotate: React.MutableRefObject<boolean>; showWireframe: boolean;
}) {
  const material = getMaterial(materialId);
  const group = useRef<THREE.Group>(null);
  const { surface, creases, groundY } = useFoldedGeometry(patternId, parameters);

  // Each geometry gets its own cleanup. Sharing one effect keyed on both disposes
  // the still-mounted crease buffers every time only the fold progress changes.
  useEffect(() => () => surface.dispose(), [surface]);
  useEffect(() => () => creases.dispose(), [creases]);

  useFrame(({ clock }) => {
    if (group.current) {
      group.current.rotation.y = autoRotate.current ? Math.sin(clock.getElapsedTime() * 0.18) * 0.22 : 0;
    }
  });

  return (
    <>
      <group ref={group} rotation={[-0.12, 0, 0]}>
        <mesh geometry={surface} frustumCulled={false}>
          <meshStandardMaterial
            color={material.color}
            metalness={material.metalness}
            roughness={material.roughness}
            envMapIntensity={material.metalness === 1 ? 1.1 : 0.9}
            flatShading
            side={THREE.DoubleSide}
            polygonOffset
            polygonOffsetFactor={1}
            polygonOffsetUnits={1}
          />
        </mesh>
        {showWireframe && (
          <mesh geometry={surface} frustumCulled={false}>
            <meshBasicMaterial color={material.accent} wireframe transparent opacity={0.22} depthWrite={false} />
          </mesh>
        )}
        <lineSegments geometry={creases} frustumCulled={false} renderOrder={2}>
          <lineBasicMaterial vertexColors transparent opacity={0.95} depthWrite={false} />
        </lineSegments>
      </group>
      <ContactShadows position={[0, groundY, 0]} scale={PANEL_FIT * 2.2} resolution={1024} blur={2.6} opacity={0.5} far={4} />
    </>
  );
}

function ThreePreview({ patternId, parameters, materialId, viewportRef, view }: {
  patternId: PatternId; parameters: PatternParameters; materialId: MaterialId;
  viewportRef: React.RefObject<HTMLDivElement>; view: ViewAngle;
}) {
  const autoRotate = useRef(true);
  const controls = useRef<any>(null);
  const [resetKey, setResetKey] = useState(0);
  const [showWireframe, setShowWireframe] = useState(false);
  const { radius } = useFoldedGeometry(patternId, parameters);

  const toggleFullscreen = () => {
    const element = viewportRef.current?.closest('.viewport');
    if (document.fullscreenElement) void document.exitFullscreen();
    else if (element) void (element as HTMLElement).requestFullscreen().catch(() => {});
  };

  return (
    <>
      <div className="three-tools">
        <button className={`icon-button ${showWireframe ? 'active' : ''}`} aria-label="Toggle facet wireframe" aria-pressed={showWireframe} onClick={() => setShowWireframe((value) => !value)} title="Toggle facet wireframe"><Grid3x3 size={13} /></button>
        <button className="icon-button" aria-label="Reset view" title="Reset view" onClick={() => { autoRotate.current = true; setResetKey((key) => key + 1); }}><Rotate3D size={13} /></button>
        <button className="icon-button" aria-label="Fullscreen" title="Fullscreen" onClick={toggleFullscreen}><Maximize2 size={13} /></button>
      </div>
      <Canvas
        className="three-canvas"
        camera={{ fov: 34 }}
        dpr={[1, 1.75]}
        gl={{ antialias: true, alpha: false, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.15 }}
      >
        <color attach="background" args={['#0d0d13']} />
        <StudioLights />
        <FoldedPanel patternId={patternId} parameters={parameters} materialId={materialId} autoRotate={autoRotate} showWireframe={showWireframe} />
        <CameraRig direction={VIEW_DIRS[view]} radius={radius} resetKey={resetKey} controls={controls} />
        <OrbitControls
          ref={controls}
          enablePan
          screenSpacePanning
          enableDamping
          dampingFactor={0.1}
          minDistance={radius * 1.1}
          maxDistance={radius * 8}
          onStart={() => { autoRotate.current = false; }}
        />
      </Canvas>
    </>
  );
}

// ---------------------------------------------------------------------------
// 2D
// ---------------------------------------------------------------------------

function CreaseLines({ lines, layout, thumb }: {
  lines: FoldLine[]; layout: ReturnType<typeof fitPanel>; thumb?: boolean;
}) {
  return (
    <>
      {lines.map((line) => {
        const stroke = STROKE[line.kind];
        return (
          <line
            key={line.id}
            x1={layout.offsetX + line.x1 * layout.scale}
            y1={layout.offsetY + line.y1 * layout.scale}
            x2={layout.offsetX + line.x2 * layout.scale}
            y2={layout.offsetY + line.y2 * layout.scale}
            stroke={foldColor(line.kind)}
            strokeWidth={thumb ? stroke.thumbWeight : stroke.weight}
            strokeDasharray={stroke.dash}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            opacity={line.kind === 'cut' ? 0.75 : 0.95}
          />
        );
      })}
    </>
  );
}

function PatternSvg({ patternId, parameters }: { patternId: PatternId; parameters: PatternParameters }) {
  const viewWidth = 320;
  const viewHeight = 470;
  const margin = 32;
  const lines = buildFoldLines(patternId, parameters);
  const layout = fitPanel(parameters.panelWidth, parameters.panelHeight, viewWidth - margin * 2, viewHeight - margin * 2);
  layout.offsetX += margin;
  layout.offsetY += margin;

  return (
    <svg viewBox={`0 0 ${viewWidth} ${viewHeight}`} role="img" aria-label={`${getPattern(patternId).name} crease pattern, ${parameters.panelWidth} by ${parameters.panelHeight} millimetres`}>
      <rect x={layout.offsetX} y={layout.offsetY} width={layout.width} height={layout.height} fill="#0d0d13" stroke="#3a3f52" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      <CreaseLines lines={lines} layout={layout} />
      {/* Ticks come off the same layout the creases do, so the scale on the drawing
          is the scale of the drawing. */}
      <g className="tech-data" fill="#8d93a6" fontSize="10">
        {buildTicks(parameters.panelWidth).map((tick) => {
          const x = layout.offsetX + tick.value * layout.scale;
          return (
            <g key={`x${tick.value}`}>
              <line x1={x} y1={layout.offsetY - 6} x2={x} y2={layout.offsetY} stroke="#4b5164" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              <text x={x} y={layout.offsetY - 11} textAnchor="middle">{tick.label}</text>
            </g>
          );
        })}
        {buildTicks(parameters.panelHeight).map((tick) => {
          const y = layout.offsetY + tick.value * layout.scale;
          return (
            <g key={`y${tick.value}`}>
              <line x1={layout.offsetX - 6} y1={y} x2={layout.offsetX} y2={y} stroke="#4b5164" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              <text x={layout.offsetX - 9} y={y} textAnchor="end" dominantBaseline="middle">{tick.label}</text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

function PatternThumb({ patternId }: { patternId: PatternId }) {
  const lines = useMemo(
    () => buildFoldLines(patternId, { ...DEFAULT_PARAMETERS, rows: 4, columns: 4, panelWidth: 300, panelHeight: 220 }),
    [patternId],
  );
  const layout = fitPanel(300, 220, 294, 214);
  layout.offsetX += 3;
  layout.offsetY += 3;
  return (
    <svg viewBox="0 0 300 220" className="thumb-svg" aria-hidden="true">
      <CreaseLines lines={lines} layout={layout} thumb />
    </svg>
  );
}

function buildTicks(total: number): { value: number; label: string }[] {
  if (!Number.isFinite(total) || total <= 0) return [{ value: 0, label: '0' }];
  const rawStep = total / 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  const niceStep = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  const ticks: { value: number; label: string }[] = [];
  // Stop short of the end so the final label never collides with the panel edge.
  for (let value = 0; value <= total - niceStep * 0.4; value += niceStep) {
    ticks.push({ value, label: String(Math.round(value)) });
  }
  ticks.push({ value: total, label: String(Math.round(total)) });
  return ticks;
}



// ---------------------------------------------------------------------------

type StudioMode = 'panel' | 'planter';

const MODES: { id: StudioMode; label: string }[] = [
  { id: 'panel', label: 'Panels' }, { id: 'planter', label: 'Planters' },
];

export default function AC3DStudio() {
  const [mode, setMode] = useState<StudioMode>('panel');
  // The planter workspace owns its own parameters; the shell only needs enough of
  // its state to keep one status light and one readout honest for both modes.
  const [planterStatus, setPlanterStatus] = useState<StudioStatus>({ blocking: false, readout: [] });
  const [parameters, setParameters] = useState<PatternParameters>(DEFAULT_PARAMETERS);
  const [materialId, setMaterialId] = useState<MaterialId>('acp-4');
  const [patternId, setPatternId] = useState<PatternId>('diamond-fold');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<PatternCategory | 'all'>('all');
  const [view, setView] = useState<ViewAngle>('iso');
  const [playing, setPlaying] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);

  const pattern = getPattern(patternId);
  const material = getMaterial(materialId);
  const stats = useMemo(() => getPatternStats(patternId, parameters, material), [patternId, parameters, material]);
  const mechanics = useMemo(() => getFoldMechanics(patternId, parameters, material), [patternId, parameters, material]);
  const checks = useMemo(() => getFabricationChecks(patternId, parameters, material), [patternId, parameters, material]);
  const panelBlocking = checks.some((check) => check.severity === 'error');
  const blocking = mode === 'panel' ? panelBlocking : planterStatus.blocking;
  const readout = mode === 'panel'
    ? [material.shortName, `${parameters.rows} × ${parameters.columns}`]
    : planterStatus.readout;

  const filtered = PATTERNS.filter((item) =>
    (category === 'all' || item.category === category) &&
    (search.trim() === '' || `${item.name} ${item.subtitle} ${item.applications.join(' ')}`.toLowerCase().includes(search.trim().toLowerCase())),
  );

  const update = useCallback(<K extends keyof PatternParameters>(key: K, value: PatternParameters[K]) => {
    setParameters((current) => ({ ...current, [key]: value }));
  }, []);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  // Frame-locked, so playback runs at a real rate and stops with the tab — unlike
  // a setInterval, which keeps ticking in the background.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const elapsed = (now - last) / 1000;
      last = now;
      setParameters((current) => {
        const next = current.foldProgress + elapsed * 32;
        return { ...current, foldProgress: next >= 100 ? 0 : next };
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  useEffect(() => { if (reducedMotion) setPlaying(false); }, [reducedMotion]);

  const exportSvg = () => {
    const lines = buildFoldLines(patternId, parameters);
    // One element per continuous run, not per segment: the cutter treats every
    // element as its own move, so a crease split facet by facet is cut as a row
    // of stabs instead of one pass.
    const markup = (['mountain', 'valley', 'cut'] as FoldKind[]).flatMap((kind) => {
      // Dash lengths are in millimetres here, not screen pixels as on the canvas.
      const dash = kind === 'valley' ? ' stroke-dasharray="14 8"' : kind === 'cut' ? ' stroke-dasharray="18 6 4 6"' : '';
      return chainFoldLines(lines.filter((line) => line.kind === kind)).map((run) => {
        const points = run.points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
        return `<${run.closed ? 'polygon' : 'polyline'} points="${points}" stroke="${foldColor(kind)}" stroke-width="${kind === 'cut' ? 0.4 : 0.3}"${dash}/>`;
      });
    }).join('');
    const notes = [
      `${pattern.name} — ${parameters.panelWidth} × ${parameters.panelHeight} mm flat`,
      `Material: ${material.name} (${material.thickness} mm)`,
      material.foldMethod === 'heat-bend'
        ? `Heat-bend over a ${material.minRadius} mm radius — do not V-groove`
        : `V-groove ${mechanics.grooveDepth.toFixed(1)} mm deep × ${mechanics.grooveWidth.toFixed(1)} mm wide, ${parameters.vBitAngle}° bit`,
      `Bend ${mechanics.bendAngle.toFixed(0)}° · folds to ${Math.round(mechanics.foldedWidth)} × ${Math.round(mechanics.foldedHeight)} mm`,
      'Solid = mountain · dashed = valley · dash-dot = cut',
    ];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${parameters.panelWidth} ${parameters.panelHeight}" width="${parameters.panelWidth}mm" height="${parameters.panelHeight}mm">`
      + `<title>DXF.AC3D ${pattern.name}</title><desc>${notes.join(' | ')}</desc>`
      + '<rect width="100%" height="100%" fill="white"/>'
      + `<g fill="none" stroke-linecap="round">${markup}</g></svg>`;
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `dxf-ac3d-${patternId}-${parameters.panelWidth}x${parameters.panelHeight}.svg`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="studio-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark">DX</span>
          <span>
            <span className="brand-name">DXF.AC3D</span>
            <span className="brand-subtitle">Parametric fold systems</span>
          </span>
        </div>
        <div className="session-readout tech-data">
          <span>MM</span><i />
          <span>1:1</span>
          {readout.map((item) => <span key={item}><i />{item}</span>)}
        </div>
        <div className="top-actions">
          <div className="view-presets" role="group" aria-label="Workspace">
            {MODES.map((item) => (
              <button key={item.id} className={`preset-pill ${mode === item.id ? 'active' : ''}`} aria-pressed={mode === item.id} onClick={() => setMode(item.id)}>{item.label}</button>
            ))}
          </div>
          <p className={`status ${blocking ? 'status-blocked' : 'status-ok'}`}>
            <i className="status-dot" />{blocking ? 'Not fabricable' : 'Ready to cut'}
          </p>
        </div>
      </header>

      <section className="workspace">
        {mode === 'planter' ? <PlanterStudio onStatus={setPlanterStatus} /> : <>
        <aside className="panel left-panel">
          <div className="sidebar-section">
            <div className="panel-title">Pattern library <span className="tech-data">{filtered.length}/{PATTERNS.length}</span></div>
            <div className="pattern-search">
              <Search size={13} aria-hidden="true" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search patterns…" aria-label="Search patterns" />
            </div>
            <div className="category-pills" role="group" aria-label="Filter by category">
              {CATEGORIES.map((item) => (
                <button key={item.id} className={`pill ${category === item.id ? 'active' : ''}`} aria-pressed={category === item.id} onClick={() => setCategory(item.id)}>{item.label}</button>
              ))}
            </div>
            <div className="pattern-grid">
              {filtered.map((item) => (
                <button
                  key={item.id}
                  className={`pattern-card difficulty-${item.difficulty.toLowerCase()} ${item.id === patternId ? 'selected' : ''}`}
                  aria-pressed={item.id === patternId}
                  onClick={() => { setPatternId(item.id); setPlaying(false); }}
                >
                  <span className="pattern-thumb"><PatternThumb patternId={item.id} /></span>
                  <strong>{item.name}</strong>
                  <span className="pattern-meta"><i className="difficulty-dot" />{item.difficulty}</span>
                </button>
              ))}
              {filtered.length === 0 && <p className="empty-library">No patterns match “{search}”</p>}
            </div>
          </div>

          <div className="sidebar-section">
            <div className="panel-title">Folding parameters <SlidersHorizontal size={13} aria-hidden="true" /></div>
            <NumberField label="Panel width" value={parameters.panelWidth} suffix="mm" min={100} onChange={(value) => update('panelWidth', value)} />
            <NumberField label="Panel height" value={parameters.panelHeight} suffix="mm" min={100} onChange={(value) => update('panelHeight', value)} />
            <NumberField label="Fold depth" value={parameters.targetHeight} suffix="mm" min={1} max={400} onChange={(value) => update('targetHeight', value)} />
            <p className="field-hint tech-data">Deepest this grid allows: {Math.floor(mechanics.maxTargetHeight)} mm</p>
            <SliderField label="Rows" value={parameters.rows} min={2} max={12} onChange={(value) => update('rows', value)} />
            <SliderField label="Columns" value={parameters.columns} min={2} max={12} onChange={(value) => update('columns', value)} />
            <SliderField label="V-bit angle" value={parameters.vBitAngle} min={15} max={150} step={5} suffix="°" onChange={(value) => update('vBitAngle', value)} />
            <div className="toggle-row">
              <span id="invert-label">Invert mountain / valley</span>
              <button className={`toggle ${parameters.invertFolds ? 'on' : ''}`} role="switch" aria-checked={parameters.invertFolds} aria-labelledby="invert-label" onClick={() => update('invertFolds', !parameters.invertFolds)}><span /></button>
            </div>
          </div>

          <div className="sidebar-section">
            <div className="panel-title">Material <span>Stock</span></div>
            <div className="select-wrap">
              <label className="sr-only" htmlFor="material-select">Material</label>
              <select id="material-select" value={materialId} onChange={(event) => setMaterialId(event.target.value as MaterialId)}>
                {MATERIALS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </div>
            <dl className="spec-list tech-data">
              <div><dt>Thickness</dt><dd>{material.thickness} mm</dd></div>
              <div><dt>Min. fold radius</dt><dd>{material.minRadius} mm</dd></div>
              <div><dt>Max. bend</dt><dd>{material.maxBendAngle}°</dd></div>
              <div><dt>Method</dt><dd>{material.foldMethod === 'v-groove' ? 'V-groove' : 'Heat bend'}</dd></div>
            </dl>
          </div>

          <div className="sidebar-section">
            <div className="panel-title">Export <span>1 : 1 scale</span></div>
            <button className="export-button" onClick={exportSvg}><Download size={13} aria-hidden="true" /> Export SVG</button>
            <button className="export-button export-secondary" disabled title="DXF export is not implemented yet"><Download size={13} aria-hidden="true" /> Export PDF / DXF</button>
            <p className="footnote">Millimetre-true vector output for CNC routers and V-groovers. The line notation travels with the file.</p>
          </div>
        </aside>

        <div className="main-stage">
          <section className="panel viewport three-viewport" ref={viewportRef}>
            <div className="viewport-header">
              <div className="viewport-heading">
                <h2>Fold simulation</h2>
                <p className="tech-data">{mechanics.bendAngle.toFixed(0)}° bend · folds to {Math.round(mechanics.foldedWidth)} × {Math.round(mechanics.foldedHeight)} mm</p>
              </div>
              <div className="view-presets" role="group" aria-label="Camera preset">
                {VIEW_LABELS.map((item) => (
                  <button key={item.id} className={`preset-pill ${view === item.id ? 'active' : ''}`} aria-pressed={view === item.id} onClick={() => setView(item.id)}>{item.label}</button>
                ))}
              </div>
            </div>
            <div className="fold-control-bar">
              <label className="fold-readout" htmlFor="fold-progress"><span>Fold</span><b className="tech-data">{Math.round(parameters.foldProgress)}%</b></label>
              <input id="fold-progress" type="range" min="0" max="100" value={parameters.foldProgress} onChange={(event) => update('foldProgress', Number(event.target.value))} />
              <div className="fold-actions">
                <button className="action-btn" onClick={() => setPlaying((value) => !value)} disabled={reducedMotion} title={reducedMotion ? 'Disabled while your system requests reduced motion' : undefined}>
                  {playing ? <Pause size={12} aria-hidden="true" /> : <Play size={12} aria-hidden="true" />} {playing ? 'Pause' : 'Play'}
                </button>
                <button className="action-btn" onClick={() => { setPlaying(false); update('foldProgress', DEFAULT_PARAMETERS.foldProgress); }}><RotateCcw size={12} aria-hidden="true" /> Reset</button>
              </div>
            </div>
            <ThreePreview patternId={patternId} parameters={parameters} materialId={materialId} viewportRef={viewportRef} view={view} />
            <p className="viewport-footnote">Rigid-facet kinematics at 1:1 — no vertical exaggeration. Sheet thickness and groove kerf are not modelled.</p>
          </section>
        </div>

        <aside className="right-column">
          <section className="panel viewport two-d">
            <div className="viewport-header">
              <div className="viewport-heading">
                <h2>Crease pattern</h2>
                <p className="tech-data">{pattern.name} · flat layout · mm</p>
              </div>
            </div>
            <div className="svg-viewport"><PatternSvg patternId={patternId} parameters={parameters} /></div>
            <div className="view-legend">
              <span><svg width="22" height="7" aria-hidden="true"><line x1="0" y1="3.5" x2="22" y2="3.5" stroke="#ff5f8f" strokeWidth="2" /></svg>Mountain</span>
              <span><svg width="22" height="7" aria-hidden="true"><line x1="0" y1="3.5" x2="22" y2="3.5" stroke="#57d7e8" strokeWidth="2" strokeDasharray="7 4" /></svg>Valley</span>
              <span><svg width="22" height="7" aria-hidden="true"><line x1="0" y1="3.5" x2="22" y2="3.5" stroke="#6b7085" strokeWidth="2" strokeDasharray="9 3 2 3" /></svg>Cut</span>
            </div>
          </section>

          <section className="panel right-panel">
            <div className="info-hero">
              <h1>{pattern.name}</h1>
              <p>{pattern.subtitle}</p>
              <p className="hero-desc">{pattern.description}</p>
              <div className="tag-row">{pattern.applications.map((application) => <span className="tag" key={application}>{application}</span>)}</div>
            </div>

            <div className="info-section">
              <h3>Fabrication check</h3>
              <CheckList checks={checks} />
            </div>

            <div className="info-section">
              <h3>Fold geometry</h3>
              <div className="stat-grid tech-data">
                <div><div className="stat-label">Bend angle</div><div className="stat-value">{mechanics.bendAngle.toFixed(1)}<em>°</em></div></div>
                <div><div className="stat-label">Cell pitch</div><div className="stat-value">{Math.round(mechanics.cellWidth)}×{Math.round(mechanics.cellHeight)}<em>mm</em></div></div>
                <div><div className="stat-label">Flat sheet</div><div className="stat-value">{parameters.panelWidth}×{parameters.panelHeight}<em>mm</em></div></div>
                <div><div className="stat-label">Folded size</div><div className="stat-value">{stats.foldedSize.replace(' × ', '×').replace(' mm', '')}<em>mm</em></div></div>
                <div><div className="stat-label">Take-up X</div><div className="stat-value">{(mechanics.contractionX * 100).toFixed(1)}<em>%</em></div></div>
                <div><div className="stat-label">Take-up Y</div><div className="stat-value">{(mechanics.contractionY * 100).toFixed(1)}<em>%</em></div></div>
              </div>
            </div>

            <div className="info-section">
              <h3>Tooling</h3>
              <div className="stat-grid tech-data">
                <div><div className="stat-label">Groove depth</div><div className="stat-value">{mechanics.grooveDepth.toFixed(1)}<em>mm</em></div></div>
                <div><div className="stat-label">Groove width</div><div className="stat-value">{mechanics.grooveWidth.toFixed(1)}<em>mm</em></div></div>
                <div><div className="stat-label">V-bit fitted</div><div className="stat-value">{parameters.vBitAngle}<em>°</em></div></div>
                <div><div className="stat-label">V-bit ideal</div><div className="stat-value">{mechanics.requiredBitAngle.toFixed(0)}<em>°</em></div></div>
                <div><div className="stat-label">Groove run</div><div className="stat-value">{stats.grooveLength}</div></div>
                <div><div className="stat-label">Est. weight</div><div className="stat-value">{stats.estimatedWeight}</div></div>
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
                {pattern.recommendedMaterial === materialId
                  ? `${material.shortName} is the recommended stock for ${pattern.name}.`
                  : `${pattern.name} is usually cut from ${getMaterial(pattern.recommendedMaterial).shortName}.`}
              </p>
            </div>
          </section>
        </aside>
        </>}
      </section>
    </main>
  );
}
