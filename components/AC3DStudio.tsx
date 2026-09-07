'use client';

import { Canvas, useFrame } from '@react-three/fiber';
import { AlertTriangle, Box, Check, Download, Grid3X3, Layers3, Maximize2, MousePointer2, Rotate3D, Settings2, SlidersHorizontal, Sparkles, ZoomIn, ZoomOut } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { buildFoldLines, DEFAULT_PARAMETERS, getMaterial, getMaterialWarning, getPatternStats, MATERIALS } from '@/lib/pattern-engine';
import type { MaterialId, PatternParameters } from '@/lib/types';

const patternDefinition = {
  name: 'Diamond Fold',
  description: 'A repeating geometric system that creates a faceted, raised surface for architectural panels.',
  applications: ['Facade', 'Backdrop', 'Signage'],
};

function FoldedPanel({ parameters, materialId }: { parameters: PatternParameters; materialId: MaterialId }) {
  const material = getMaterial(materialId);
  const group = useRef<THREE.Group>(null);
  const geometry = useMemo(() => {
    const rows = parameters.rows;
    const columns = parameters.columns;
    const width = 5.9;
    const height = 3.8;
    const vertices: number[] = [];
    const indices: number[] = [];
    const cellW = width / columns;
    const cellH = height / rows;
    const lift = (parameters.targetHeight / 50) * 0.48 * (parameters.foldProgress / 100);

    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < columns; x += 1) {
        const x0 = -width / 2 + x * cellW;
        const y0 = -height / 2 + y * cellH;
        const x1 = x0 + cellW;
        const y1 = y0 + cellH;
        const flip = (x + y) % 2 === 0 ? 1 : -1;
        const add = (px: number, py: number, z: number) => vertices.push(px, py, z);
        add(x0, y0, 0); add(x1, y0, 0); add(x1, y1, 0); add(x0, y1, 0);
        add((x0 + x1) / 2, (y0 + y1) / 2, lift * flip);
        const base = (y * columns + x) * 5;
        indices.push(base, base + 1, base + 4, base, base + 4, base + 3, base + 1, base + 2, base + 4, base + 2, base + 3, base + 4);
      }
    }
    const result = new THREE.BufferGeometry();
    result.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    result.setIndex(indices);
    result.computeVertexNormals();
    return result;
  }, [parameters.columns, parameters.rows, parameters.targetHeight, parameters.foldProgress]);

  useFrame(({ clock }) => {
    if (group.current) {
      group.current.rotation.y = Math.sin(clock.getElapsedTime() * 0.18) * 0.13;
      group.current.rotation.x = -0.24;
    }
  });

  return (
    <group ref={group} position={[0, 0.1, 0]}>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial color={material.color} roughness={0.32} metalness={materialId.includes('acp') || materialId === 'steel-2' ? 0.72 : 0.12} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={geometry} scale={[1.002, 1.002, 1.002]}>
        <meshBasicMaterial color={material.accent} wireframe transparent opacity={0.23} />
      </mesh>
    </group>
  );
}

function ThreePreview({ parameters, materialId }: { parameters: PatternParameters; materialId: MaterialId }) {
  return (
    <Canvas className="three-canvas" camera={{ position: [0, 1.2, 7], fov: 36 }} shadows dpr={[1, 2]}>
      <color attach="background" args={['#f5f7fa']} />
      <ambientLight intensity={1.6} />
      <directionalLight position={[-4, 6, 5]} intensity={4.2} castShadow shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[5, -2, 1]} intensity={1.5} color="#9db7ff" />
      <FoldedPanel parameters={parameters} materialId={materialId} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.1, 0]} receiveShadow>
        <planeGeometry args={[20, 20]} />
        <shadowMaterial opacity={0.13} />
      </mesh>
    </Canvas>
  );
}

function PatternSvg({ parameters }: { parameters: PatternParameters }) {
  const lines = buildFoldLines(parameters);
  const viewWidth = 300;
  const viewHeight = 460;
  return (
    <svg viewBox={`0 0 ${viewWidth} ${viewHeight}`} role="img" aria-label="Diamond Fold crease pattern">
      <rect x="8" y="8" width="284" height="444" rx="2" fill="#fbfcfe" stroke="#778396" strokeWidth="1.2" />
      <g transform="translate(8 8) scale(.2367 .1803)">
        {lines.map((line) => {
          const stroke = line.kind === 'mountain' ? '#315efb' : line.kind === 'valley' ? '#ed7066' : '#98a2b0';
          return <line key={line.id} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke={stroke} strokeWidth={line.kind === 'cut' ? 4 : 6} strokeDasharray={line.kind === 'cut' ? '12 10' : undefined} vectorEffect="non-scaling-stroke" opacity={line.kind === 'cut' ? .75 : .9} />;
        })}
      </g>
      <g fill="#a7afbc" fontFamily="monospace" fontSize="7">
        <text x="10" y="466">0</text><text x="136" y="466">600</text><text x="265" y="466">1200 mm</text>
        <text x="1" y="13">0</text><text x="0" y="237">1200</text><text x="0" y="450">2400</text>
      </g>
    </svg>
  );
}

function NumberField({ label, value, suffix, onChange, min, max }: { label: string; value: number; suffix: string; onChange: (value: number) => void; min?: number; max?: number }) {
  return <div className="field"><label className="field-label"><span>{label}</span><strong>{suffix}</strong></label><input type="number" value={value} min={min} max={max} onChange={(event) => onChange(Number(event.target.value) || 0)} /></div>;
}

export default function AC3DStudio() {
  const [parameters, setParameters] = useState<PatternParameters>(DEFAULT_PARAMETERS);
  const [materialId, setMaterialId] = useState<MaterialId>('acp-4');
  const [module, setModule] = useState<'box' | 'pattern'>('pattern');
  const material = getMaterial(materialId);
  const stats = useMemo(() => getPatternStats(parameters), [parameters]);
  const warning = getMaterialWarning(parameters, material);
  const update = <K extends keyof PatternParameters>(key: K, value: PatternParameters[K]) => setParameters((current) => ({ ...current, [key]: value }));

  const exportSvg = () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${parameters.panelWidth} ${parameters.panelHeight}"><rect width="100%" height="100%" fill="white"/>${buildFoldLines(parameters).map((line) => `<line x1="${line.x1}" y1="${line.y1}" x2="${line.x2}" y2="${line.y2}" stroke="${line.kind === 'mountain' ? '#315efb' : line.kind === 'valley' ? '#ed7066' : '#768195'}" stroke-width="${line.kind === 'cut' ? 1 : 2}" ${line.kind === 'cut' ? 'stroke-dasharray="10 8"' : ''}/>`).join('')}</svg>`;
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'ac3d-diamond-fold.svg'; anchor.click(); URL.revokeObjectURL(url);
  };

  return (
    <main className="studio-shell">
      <header className="topbar">
        <div className="brand-lockup"><div className="brand-mark">AC</div><div><div className="brand-name">AC3D <span className="brand-version">v1.0 Beta</span></div><div className="brand-subtitle">Parametric fold systems</div></div></div>
        <div className="module-switcher"><button className={`module-button ${module === 'box' ? 'active' : ''}`} onClick={() => setModule('box')}>Online Box Calculator</button><button className={`module-button ${module === 'pattern' ? 'active' : ''}`} onClick={() => setModule('pattern')}>3D Pattern Generator</button></div>
        <div className="top-actions"><div className="status"><i className="status-dot" />System ready</div><button className="icon-button" aria-label="Settings"><Settings2 size={15} /></button><div className="brand-mark" style={{ width: 29, height: 29, borderRadius: 50, fontSize: 10 }}>JD</div></div>
      </header>

      <section className="workspace">
        <aside className="panel left-panel">
          <div className="sidebar-section"><div className="panel-title">Pattern library <span>01 / 04</span></div><div className="pattern-card"><div className="pattern-thumbnail"><svg viewBox="0 0 60 48"><path d="M5 10L20 4 33 13 48 6 56 18 42 27 54 39 38 45 28 34 12 43 4 29 18 20z" fill="none" stroke="#315efb" strokeWidth="1.3"/><path d="M5 10l37 17M20 4l18 41M48 6L12 43M18 20l36 19" stroke="#ef7067" strokeWidth=".8"/></svg></div><div className="pattern-copy"><strong>Diamond Fold</strong><small>Geometric / classical<br />architectural panel</small></div></div></div>
          <div className="sidebar-section"><div className="panel-title"><span style={{ color: '#202936' }}>Folding parameters</span><SlidersHorizontal size={14} color="#a0a9b5" /></div><NumberField label="Panel width" value={parameters.panelWidth} suffix="mm" min={100} onChange={(value) => update('panelWidth', value)} /><NumberField label="Panel height" value={parameters.panelHeight} suffix="mm" min={100} onChange={(value) => update('panelHeight', value)} /><NumberField label="Target height / depth" value={parameters.targetHeight} suffix="mm" min={1} max={200} onChange={(value) => update('targetHeight', value)} /><div className="field"><label className="field-label"><span>Rows</span><strong>{parameters.rows}</strong></label><div className="range-wrap"><input type="range" min="2" max="12" value={parameters.rows} onChange={(event) => update('rows', Number(event.target.value))} /><span className="range-value">{parameters.rows}</span></div></div><div className="field"><label className="field-label"><span>Columns</span><strong>{parameters.columns}</strong></label><div className="range-wrap"><input type="range" min="2" max="12" value={parameters.columns} onChange={(event) => update('columns', Number(event.target.value))} /><span className="range-value">{parameters.columns}</span></div></div><div className="toggle-row"><span>Invert Mountain / Valley</span><button className={`toggle ${parameters.invertFolds ? 'on' : ''}`} onClick={() => update('invertFolds', !parameters.invertFolds)} aria-label="Invert folds"><span /></button></div></div>
          <div className="sidebar-section"><div className="panel-title">Material <span>Fabrication</span></div><div className="select-wrap"><select value={materialId} onChange={(event) => setMaterialId(event.target.value as MaterialId)}>{MATERIALS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><div className="material-note"><div className="note-head"><AlertTriangle size={12} />Material constraints — {material.shortName}</div><ul><li>Min. fold radius: {material.minRadius} mm</li><li>Panel thickness: {material.thickness} mm</li><li>Max. bend angle: ≤ {material.maxBendAngle}°</li><li>V-groove depth: {material.grooveDepth}</li></ul></div></div>
          <div className="sidebar-section"><div className="panel-title">Export pattern <span>1 : 1 scale</span></div><button className="export-button" onClick={exportSvg}><Download size={13} /> Export SVG</button><button className="export-button export-secondary" onClick={exportSvg}><Download size={13} /> Export PDF / DXF</button><div className="footnote" style={{ marginTop: 10 }}>Vector output is optimized for CNC routers and V-grooving machines.</div></div>
        </aside>

        <div className="main-stage">
          <section className="panel viewport"><div className="viewport-header"><div className="viewport-heading"><h2>2D Fold Pattern</h2><p>Unfolded layout · 1 : 1 technical projection</p></div><div className="view-legend"><span><i className="legend-line mountain" />Mountain</span><span><i className="legend-line valley" />Valley</span><span><i className="legend-line cut" />Cut line</span></div></div><div className="svg-viewport"><div className="ruler-top"><span>0</span><span>300</span><span>600</span><span>900</span><span>1200 mm</span></div><div className="ruler-left"><span>0</span><span>600</span><span>1200</span><span>1800</span><span>2400</span></div><PatternSvg parameters={parameters} /><div className="bottom-meta">CELL <span className="meta-strong">{Math.round(parameters.panelWidth / parameters.columns)} × {Math.round(parameters.panelHeight / parameters.rows)} mm</span></div></div></section>
          <section className="panel viewport three-viewport"><div className="viewport-header"><div className="viewport-heading"><h2>3D Preview</h2><p>Interactive fold simulation · approximate material surface</p></div><div className="mode-pill"><Sparkles size={11} color="#315efb" /> Real-time preview</div></div><ThreePreview parameters={parameters} materialId={materialId} /><div className="three-tools"><button className="icon-button" aria-label="Zoom out"><ZoomOut size={13} /></button><button className="icon-button" aria-label="Zoom in"><ZoomIn size={13} /></button><button className="icon-button" aria-label="Reset view"><Rotate3D size={13} /></button><button className="icon-button" aria-label="Fullscreen"><Maximize2 size={13} /></button></div><div className="preview-gradient" /><div className="preview-footer"><div className="preview-label"><h2>Folded surface</h2><p>Drag to orbit · scroll to zoom</p></div><div className="fold-control"><label><span>Fold progress</span><b>{parameters.foldProgress}%</b></label><input type="range" min="0" max="100" value={parameters.foldProgress} onChange={(event) => update('foldProgress', Number(event.target.value))} /></div></div></section>
        </div>

        <aside className="panel right-panel"><div className="info-hero"><h1>{patternDefinition.name}</h1><p>{patternDefinition.description}</p><div className="tag-row">{patternDefinition.applications.map((application) => <span className="tag" key={application}>{application}</span>)}</div><div className="status-badge"><Check size={11} /> ACP recommended</div></div><div className="info-section"><h3>Pattern specifications</h3><div className="stat-grid"><div><div className="stat-label">Pattern type</div><div className="stat-value">Geometric</div></div><div><div className="stat-label">Difficulty</div><div className="stat-value" style={{ color: '#c28a31' }}>● Medium</div></div><div><div className="stat-label">Rows / Columns</div><div className="stat-value">{parameters.rows} × {parameters.columns}</div></div><div><div className="stat-label">Target height</div><div className="stat-value">{parameters.targetHeight} <em>mm</em></div></div></div></div><div className="info-section"><h3>Production guidance</h3><div className="stat-grid"><div><div className="stat-label">Recommended cell</div><div className="stat-value">{material.recommendedCell} <em>mm</em></div></div><div><div className="stat-label">V-groove width</div><div className="stat-value">2.0 <em>mm</em></div></div><div><div className="stat-label">V-bit angle</div><div className="stat-value">{parameters.vBitAngle}°</div></div><div><div className="stat-label">Groove length</div><div className="stat-value">{stats.grooveLength}</div></div></div></div><div className="info-section"><h3>Material compatibility</h3><div className="recommendation"><div className="material-swatch" style={{ background: `linear-gradient(135deg, ${material.color}, ${material.accent})` }} /><div><strong>{material.name}</strong><span>{material.thickness} mm · min radius {material.minRadius} mm</span></div></div>{warning && <div className="warning" style={{ marginTop: 9 }}><AlertTriangle size={14} />{warning}</div>}</div><div className="info-section"><h3>Live statistics</h3><div className="stat-grid"><div><div className="stat-label">Mountain creases</div><div className="stat-value">{stats.mountainLines}</div></div><div><div className="stat-label">Valley creases</div><div className="stat-value">{stats.valleyLines}</div></div><div><div className="stat-label">Panel area</div><div className="stat-value">{stats.panelArea}</div></div><div><div className="stat-label">Estimated weight</div><div className="stat-value">{stats.estimatedWeight}</div></div></div>{warning && <div className="warning" style={{ marginTop: 14 }}><AlertTriangle size={14} />Small cell structures can create stress concentration at fold intersections.</div>}</div></aside>
      </section>
    </main>
  );
}
