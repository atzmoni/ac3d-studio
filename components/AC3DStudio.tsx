'use client';

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { AlertTriangle, Check, Download, Maximize2, Rotate3D, Settings2, SlidersHorizontal, Sparkles, ZoomIn, ZoomOut } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { buildFoldLines, DEFAULT_PARAMETERS, getFoldedCornerHeight, getMaterial, getMaterialWarning, getPatternStats, MATERIALS } from '@/lib/pattern-engine';
import type { MaterialId, PatternParameters } from '@/lib/types';

const patternDefinition = {
  name: 'Diamond Fold',
  description: 'A repeating geometric system that creates a faceted, raised surface for architectural panels.',
  applications: ['Facade', 'Backdrop', 'Signage'],
};

function FoldedPanel({ parameters, materialId, autoRotate, panelRef }: { parameters: PatternParameters; materialId: MaterialId; autoRotate: React.MutableRefObject<boolean>; panelRef: React.MutableRefObject<THREE.Group | null> }) {
  const material = getMaterial(materialId);
  const group = useRef<THREE.Group | null>(null) as React.MutableRefObject<THREE.Group | null>;
  const prefersReducedMotion = useMemo(() => (typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false), []);
  const geometry = useMemo(() => {
    const rows = parameters.rows;
    const columns = parameters.columns;
    const width = 5.9;
    const height = 3.8;
    const cellW = width / columns;
    const cellH = height / rows;
    const targetHeight = parameters.targetHeight;
    const invertFolds = parameters.invertFolds;
    const progress = parameters.foldProgress / 100;
    const heightScale = (0.245 / 50) * height; // world units per mm at panel height
    const positions: number[] = [];
    const colors: number[] = [];
    const cornerHeight = (r: number, c: number) => getFoldedCornerHeight(r, c, targetHeight, invertFolds, progress) * heightScale;
    const pushVertex = (x: number, y: number, z: number, tint: number[]) => {
      positions.push(x, y, z);
      colors.push(tint[0], tint[1], tint[2]);
    };

    // Each cell folds along its diagonals: the four corners come from the
    // height field, the shared diagonal ridge sits at 0 — matching the 2D
    // crease pattern exactly. Facets are color-tinted by fold direction.
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < columns; c += 1) {
        const x0 = -width / 2 + c * cellW;
        const y0 = -height / 2 + r * cellH;
        const x1 = x0 + cellW;
        const y1 = y0 + cellH;
        const zTL = cornerHeight(r, c);
        const zTR = cornerHeight(r, c + 1);
        const zBR = cornerHeight(r + 1, c + 1);
        const zBL = cornerHeight(r + 1, c);
        const rising = zTR >= 0 ? [0.28, 0.10, 0.06] : [0.10, 0.16, 0.34]; // warm ridge vs cool valley tint
        const corners = [
          { x: x0, y: y0, z: zTL }, { x: x1, y: y0, z: zTR },
          { x: x1, y: y1, z: zBR }, { x: x0, y: y1, z: zBL },
        ];
        const cx = (x0 + x1) / 2;
        const cy = (y0 + y1) / 2;
        for (let i = 0; i < 4; i += 1) {
          const a = corners[i];
          const b = corners[(i + 1) % 4];
          pushVertex(cx, cy, 0, rising);
          pushVertex(a.x, a.y, a.z, rising);
          pushVertex(b.x, b.y, b.z, rising);
        }
      }
    }
    const result = new THREE.BufferGeometry();
    result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    result.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    result.computeVertexNormals();
    return result;
  }, [parameters.columns, parameters.rows, parameters.targetHeight, parameters.foldProgress, parameters.invertFolds]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <group ref={(node) => { group.current = node; if (panelRef) panelRef.current = node; }} position={[0, 0.1, 0]}>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial color={material.color} vertexColors roughness={0.32} metalness={materialId.includes('acp') || materialId === 'steel-2' ? 0.72 : 0.12} flatShading side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={geometry} scale={[1.002, 1.002, 1.002]}>
        <meshBasicMaterial color={material.accent} wireframe transparent opacity={0.23} />
      </mesh>
    </group>
  );
}

export interface CameraControlsHandle {
  zoomBy: (factor: number) => void;
  reset: () => void;
}

const CameraControls = forwardRef<CameraControlsHandle>(function CameraControls(_, ref) {
  const camera = useThree((state) => state.camera);
  const defaultPosition = useMemo(() => camera.position.clone(), [camera]);

  useImperativeHandle(ref, () => ({
    zoomBy: (factor: number) => {
      camera.position.multiplyScalar(factor);
      camera.lookAt(0, 0.1, 0);
    },
    reset: () => {
      camera.position.copy(defaultPosition);
      camera.lookAt(0, 0.1, 0);
    },
  }), [camera, defaultPosition]);

  return null;
});

function ThreePreview({ parameters, materialId, viewportRef }: { parameters: PatternParameters; materialId: MaterialId; viewportRef: React.RefObject<HTMLDivElement> }) {
  const cameraControls = useRef<CameraControlsHandle>(null);
  const autoRotate = useRef(true);
  const panelRef = useRef<THREE.Group | null>(null) as React.MutableRefObject<THREE.Group | null>;
  const stopAutoRotate = () => {
    autoRotate.current = false;
    if (panelRef.current) panelRef.current.rotation.y = 0;
  };

  const toggleFullscreen = () => {
    const element = viewportRef.current?.closest('.viewport');
    if (document.fullscreenElement) void document.exitFullscreen();
    else if (element) void element.requestFullscreen().catch(() => { /* fullscreen blocked */ });
  };

  return (
    <>
      <div className="three-tools">
        <button className="icon-button" aria-label="Zoom in" onClick={() => cameraControls.current?.zoomBy(0.85)}><ZoomIn size={13} /></button>
        <button className="icon-button" aria-label="Zoom out" onClick={() => cameraControls.current?.zoomBy(1.18)}><ZoomOut size={13} /></button>
        <button className="icon-button" aria-label="Reset view" onClick={() => cameraControls.current?.reset()}><Rotate3D size={13} /></button>
        <button className="icon-button" aria-label="Fullscreen" onClick={toggleFullscreen}><Maximize2 size={13} /></button>
      </div>
      <Canvas className="three-canvas" camera={{ position: [0, 1.2, 7], fov: 36 }} shadows dpr={[1, 2]}>
        <color attach="background" args={['#f5f7fa']} />
        <ambientLight intensity={1.6} />
        <directionalLight position={[-4, 6, 5]} intensity={4.2} castShadow shadow-mapSize={[1024, 1024]} />
        <directionalLight position={[5, -2, 1]} intensity={1.5} color="#9db7ff" />
        <FoldedPanel parameters={parameters} materialId={materialId} autoRotate={autoRotate} panelRef={panelRef} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.1, 0]} receiveShadow>
          <planeGeometry args={[20, 20]} />
          <shadowMaterial opacity={0.13} />
        </mesh>
        <CameraControls ref={cameraControls} />
        <OrbitControls enablePan={false} minDistance={2.5} maxDistance={16} onStart={stopAutoRotate} />
      </Canvas>
    </>
  );
}

function PatternSvg({ parameters }: { parameters: PatternParameters }) {
  const lines = buildFoldLines(parameters);
  const viewWidth = 300;
  const viewHeight = 460;
  const ticksX = buildTicks(parameters.panelWidth);
  const ticksY = buildTicks(parameters.panelHeight);
  return (
    <svg viewBox={`0 0 ${viewWidth} ${viewHeight}`} role="img" aria-label="Diamond Fold crease pattern">
      <rect x="8" y="8" width="284" height="444" rx="2" fill="#fbfcfe" stroke="#778396" strokeWidth="1.2" />
      <g transform="translate(8 8) scale(.2367 .1803)">
        {lines.map((line) => (
          <line key={line.id} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke={foldColor(line.kind)} strokeWidth={line.kind === 'cut' ? 4 : 6} strokeDasharray={line.kind === 'cut' ? '12 10' : undefined} vectorEffect="non-scaling-stroke" opacity={line.kind === 'cut' ? .75 : .9} />
        ))}
      </g>
      <g fill="#a7afbc" fontFamily="monospace" fontSize="7">
        {ticksX.map((tick) => <text key={tick.value} x={8 + (tick.value / parameters.panelWidth) * 284} y="466" textAnchor="middle">{tick.label}</text>)}
        {ticksY.map((tick) => <text key={tick.value} x="1" y={8 + (tick.value / parameters.panelHeight) * 444} dominantBaseline="middle">{tick.label}</text>)}
      </g>
    </svg>
  );
}

function buildTicks(total: number): { value: number; label: string }[] {
  if (!Number.isFinite(total) || total <= 0) return [{ value: 0, label: '0' }];
  const targetDivisions = 4;
  const rawStep = total / targetDivisions;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  const niceStep = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  const ticks: { value: number; label: string }[] = [];
  for (let v = 0; v <= total; v += niceStep) {
    ticks.push({ value: v, label: String(Math.round(v)) });
  }
  if (ticks[ticks.length - 1].value !== total) ticks.push({ value: total, label: String(total) });
  return ticks;
}

function foldColor(kind: 'mountain' | 'valley' | 'cut'): string {
  return kind === 'mountain' ? '#2455d6' : kind === 'valley' ? '#df624f' : '#768195';
}

function NumberField({ label, value, suffix, onChange, min, max }: { label: string; value: number; suffix: string; onChange: (value: number) => void; min?: number; max?: number }) {
  return <div className="field"><label className="field-label"><span>{label}</span><strong>{suffix}</strong></label><input type="number" value={value} min={min} max={max} onChange={(event) => onChange(Number(event.target.value) || 0)} /></div>;
}

export default function AC3DStudio() {
  const [parameters, setParameters] = useState<PatternParameters>(DEFAULT_PARAMETERS);
  const [materialId, setMaterialId] = useState<MaterialId>('acp-4');
  const viewportRef = useRef<HTMLDivElement>(null);
  const material = getMaterial(materialId);
  const stats = useMemo(() => getPatternStats(parameters, material), [parameters, material]);
  const warning = getMaterialWarning(parameters, material);
  const update = <K extends keyof PatternParameters>(key: K, value: PatternParameters[K]) => setParameters((current) => ({ ...current, [key]: value }));

  const exportSvg = () => {
    const lines = buildFoldLines(parameters);
    const lineMarkup = lines.map((line) => `<line x1="${line.x1}" y1="${line.y1}" x2="${line.x2}" y2="${line.y2}" stroke="${foldColor(line.kind)}" stroke-width="${line.kind === 'cut' ? '0.35' : '0.2'}"${line.kind === 'cut' ? ' stroke-dasharray="6 4"' : ''}/>`).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${parameters.panelWidth} ${parameters.panelHeight}" width="${parameters.panelWidth}mm" height="${parameters.panelHeight}mm"><title>AC3D Diamond Fold — ${parameters.panelWidth} × ${parameters.panelHeight} mm</title><desc>Crease pattern: blue = mountain, red = valley, dashed gray = cut. Material: ${material.name}. V-groove depth: ${material.grooveDepth}.</desc><rect width="100%" height="100%" fill="white"/><g fill="none" stroke-linecap="round">${lineMarkup}</g></svg>`;
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'ac3d-diamond-fold.svg'; anchor.click(); URL.revokeObjectURL(url);
  };

  return (
    <main className="studio-shell">
      <header className="topbar">
        <div className="brand-lockup"><div className="brand-mark">AC</div><div><div className="brand-name">AC3D <span className="brand-version">v1.0 Beta</span></div><div className="brand-subtitle">Parametric fold systems</div></div></div>
        <div className="module-switcher"><span className="module-button active">3D Pattern Generator</span></div>
        <div className="top-actions"><div className="status"><i className="status-dot" />System ready</div><button className="icon-button" aria-label="Settings"><Settings2 size={15} /></button><div className="brand-mark" style={{ width: 29, height: 29, borderRadius: 50, fontSize: 10 }}>JD</div></div>
      </header>

      <section className="workspace">
        <aside className="panel left-panel">
          <div className="sidebar-section"><div className="panel-title">Pattern library <span>01 / 04</span></div><div className="pattern-card"><div className="pattern-thumbnail"><svg viewBox="0 0 60 48"><path d="M5 10L20 4 33 13 48 6 56 18 42 27 54 39 38 45 28 34 12 43 4 29 18 20z" fill="none" stroke="#2455d6" strokeWidth="1.3"/><path d="M5 10l37 17M20 4l18 41M48 6L12 43M18 20l36 19" stroke="#df624f" strokeWidth=".8"/></svg></div><div className="pattern-copy"><strong>Diamond Fold</strong><small>Geometric / classical<br />architectural panel</small></div></div></div>
          <div className="sidebar-section"><div className="panel-title"><span style={{ color: '#202936' }}>Folding parameters</span><SlidersHorizontal size={14} color="#a0a9b5" /></div><NumberField label="Panel width" value={parameters.panelWidth} suffix="mm" min={100} onChange={(value) => update('panelWidth', value)} /><NumberField label="Panel height" value={parameters.panelHeight} suffix="mm" min={100} onChange={(value) => update('panelHeight', value)} /><NumberField label="Target height / depth" value={parameters.targetHeight} suffix="mm" min={1} max={200} onChange={(value) => update('targetHeight', value)} /><div className="field"><label className="field-label"><span>Rows</span><strong>{parameters.rows}</strong></label><div className="range-wrap"><input type="range" min="2" max="12" value={parameters.rows} onChange={(event) => update('rows', Number(event.target.value))} /><span className="range-value">{parameters.rows}</span></div></div><div className="field"><label className="field-label"><span>Columns</span><strong>{parameters.columns}</strong></label><div className="range-wrap"><input type="range" min="2" max="12" value={parameters.columns} onChange={(event) => update('columns', Number(event.target.value))} /><span className="range-value">{parameters.columns}</span></div></div><div className="toggle-row"><span>Invert Mountain / Valley</span><button className={`toggle ${parameters.invertFolds ? 'on' : ''}`} onClick={() => update('invertFolds', !parameters.invertFolds)} aria-label="Invert folds"><span /></button></div></div>
          <div className="sidebar-section"><div className="panel-title">Material <span>Fabrication</span></div><div className="select-wrap"><select value={materialId} onChange={(event) => setMaterialId(event.target.value as MaterialId)}>{MATERIALS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><div className="material-note"><div className="note-head"><AlertTriangle size={12} />Material constraints — {material.shortName}</div><ul><li>Min. fold radius: {material.minRadius} mm</li><li>Panel thickness: {material.thickness} mm</li><li>Max. bend angle: ≤ {material.maxBendAngle}°</li><li>V-groove depth: {material.grooveDepth}</li></ul></div></div>
          <div className="sidebar-section"><div className="panel-title">Export pattern <span>1 : 1 scale</span></div><button className="export-button" onClick={exportSvg}><Download size={13} /> Export SVG</button><button className="export-button export-secondary" disabled title="DXF export is not implemented yet"><Download size={13} /> Export PDF / DXF</button><div className="footnote" style={{ marginTop: 10 }}>Vector output is optimized for CNC routers and V-grooving machines.</div></div>
        </aside>

        <div className="main-stage">
          <section className="panel viewport"><div className="viewport-header"><div className="viewport-heading"><h2>2D Fold Pattern</h2><p>Unfolded layout · 1 : 1 technical projection</p></div><div className="view-legend"><span><i className="legend-line mountain" />Mountain</span><span><i className="legend-line valley" />Valley</span><span><i className="legend-line cut" />Cut line</span></div></div><div className="svg-viewport"><div className="ruler-top">{buildTicks(parameters.panelWidth).map((tick) => <span key={tick.value}>{tick.label}</span>)}</div><div className="ruler-left">{buildTicks(parameters.panelHeight).map((tick) => <span key={tick.value}>{tick.label}</span>)}</div><PatternSvg parameters={parameters} /><div className="bottom-meta">CELL <span className="meta-strong">{Math.round(parameters.panelWidth / parameters.columns)} × {Math.round(parameters.panelHeight / parameters.rows)} mm</span></div></div></section>
          <section className="panel viewport three-viewport" ref={viewportRef}><div className="viewport-header"><div className="viewport-heading"><h2>3D Preview</h2><p>Interactive fold simulation · approximate material surface</p></div><div className="mode-pill"><Sparkles size={11} color="#2455d6" /> Real-time preview</div></div><ThreePreview parameters={parameters} materialId={materialId} viewportRef={viewportRef} /><div className="preview-gradient" /><div className="preview-footer"><div className="preview-label"><h2>Folded surface</h2><p>Drag to orbit · scroll to zoom · auto-rotates</p></div><div className="fold-control"><label><span>Fold progress</span><b>{parameters.foldProgress}%</b></label><input type="range" min="0" max="100" value={parameters.foldProgress} onChange={(event) => update('foldProgress', Number(event.target.value))} /></div></div></section>
        </div>

        <aside className="panel right-panel"><div className="info-hero"><h1>{patternDefinition.name}</h1><p>{patternDefinition.description}</p><div className="tag-row">{patternDefinition.applications.map((application) => <span className="tag" key={application}>{application}</span>)}</div><div className="status-badge"><Check size={11} /> ACP recommended</div></div><div className="info-section"><h3>Pattern specifications</h3><div className="stat-grid"><div><div className="stat-label">Pattern type</div><div className="stat-value">Geometric</div></div><div><div className="stat-label">Difficulty</div><div className="stat-value" style={{ color: '#c28a31' }}>● Medium</div></div><div><div className="stat-label">Rows / Columns</div><div className="stat-value">{parameters.rows} × {parameters.columns}</div></div><div><div className="stat-label">Target height</div><div className="stat-value">{parameters.targetHeight} <em>mm</em></div></div></div></div><div className="info-section"><h3>Production guidance</h3><div className="stat-grid"><div><div className="stat-label">Recommended cell</div><div className="stat-value">{material.recommendedCell} <em>mm</em></div></div><div><div className="stat-label">V-groove width</div><div className="stat-value">2.0 <em>mm</em></div></div><div><div className="stat-label">V-bit angle</div><div className="stat-value">{parameters.vBitAngle}°</div></div><div><div className="stat-label">Groove length</div><div className="stat-value">{stats.grooveLength}</div></div></div></div><div className="info-section"><h3>Material compatibility</h3><div className="recommendation"><div className="material-swatch" style={{ background: `linear-gradient(135deg, ${material.color}, ${material.accent})` }} /><div><strong>{material.name}</strong><span>{material.thickness} mm · min radius {material.minRadius} mm</span></div></div>{warning && <div className="warning" style={{ marginTop: 9 }}><AlertTriangle size={14} />{warning}</div>}</div><div className="info-section"><h3>Live statistics</h3><div className="stat-grid"><div><div className="stat-label">Mountain creases</div><div className="stat-value">{stats.mountainLines}</div></div><div><div className="stat-label">Valley creases</div><div className="stat-value">{stats.valleyLines}</div></div><div><div className="stat-label">Panel area</div><div className="stat-value">{stats.panelArea}</div></div><div><div className="stat-label">Estimated weight</div><div className="stat-value">{stats.estimatedWeight}</div></div></div>{warning && <div className="warning" style={{ marginTop: 14 }}><AlertTriangle size={14} />Small cell structures can create stress concentration at fold intersections.</div>}</div></aside>
      </section>
    </main>
  );
}