'use client';

/**
 * The studio as an application window rather than a section of a web page.
 *
 * A CAD tool tells you three things without being asked: what document you have
 * open, whether it is valid, and what it measures. So this shell gives the
 * workspace a command bar across the top (document name, units, scale, live
 * validity, the two exports) and a status bar across the bottom that reads the
 * model's measurements straight across, the way a modeller's status line does.
 * Between them the workspace fills the window exactly — no page scroll, every
 * panel scrolling inside its own frame.
 *
 * The panels themselves are unchanged: this is chrome around `PlanterStudioHe`,
 * not a second copy of it.
 */

import { ArrowRight, Download, FileBox, Maximize2, Minimize2, Printer, Ruler } from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { StudioStatus } from '@/components/garden/PlanterStudioHe';

const PlanterStudioHe = dynamic(() => import('@/components/garden/PlanterStudioHe'), {
  ssr: false,
  loading: () => <div className="cad-boot">טוען את הסטודיו…</div>,
});

export default function StudioWorkspace() {
  const [status, setStatus] = useState<StudioStatus>({ blocking: false, readout: [] });
  const [full, setFull] = useState(false);
  const shell = useRef<HTMLDivElement>(null);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void shell.current?.requestFullscreen().catch(() => {});
  }, []);

  useEffect(() => {
    const sync = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  // Ctrl/⌘+S is muscle memory in every CAD tool, and the browser's own "save
  // page" is never what someone means while a model is open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      (event.shiftKey ? status.exportDxf : status.exportSvg)?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [status.exportSvg, status.exportDxf]);

  return (
    <div className="cad" dir="rtl" lang="he" ref={shell}>
      <header className="cad-bar">
        <div className="cad-bar-group">
          <Link className="cad-back" href="/planter">
            <ArrowRight size={15} aria-hidden="true" />
            <span>לאתר</span>
          </Link>
          <span className="cad-sep" aria-hidden="true" />
          <span className="cad-doc">
            <FileBox size={15} aria-hidden="true" />
            <b>{status.fileStem ?? 'planter'}</b>
          </span>
        </div>

        <div className="cad-bar-group cad-readout tech-data">
          <span><Ruler size={13} aria-hidden="true" /> מ״מ</span>
          <span className="cad-sep" aria-hidden="true" />
          <span>1:1</span>
          {status.readout.map((item) => (
            <span key={item}><span className="cad-sep" aria-hidden="true" />{item}</span>
          ))}
        </div>

        <div className="cad-bar-group">
          <p className={`cad-state ${status.blocking ? 'blocked' : 'ok'}`}>
            <i aria-hidden="true" />
            {status.blocking ? 'לא ניתן לייצור' : 'מוכן לכרסום'}
          </p>
          <span className="cad-sep" aria-hidden="true" />
          <button className="cad-action" onClick={() => status.exportSvg?.()} disabled={!status.exportSvg}>
            <Download size={14} aria-hidden="true" /> SVG
          </button>
          <button className="cad-action" onClick={() => status.exportDxf?.()} disabled={!status.exportDxf}>
            <Download size={14} aria-hidden="true" /> DXF
          </button>
          {/* The third file, and only once there is one: a pot that is not
              printed has no artwork, and a disabled button that never enables
              is noise on the bar. */}
          {status.exportPrint && (
            <button className="cad-action" onClick={() => status.exportPrint?.()}>
              <Printer size={14} aria-hidden="true" /> הדפסה
            </button>
          )}
          <button className="cad-icon" onClick={toggleFullscreen} aria-label={full ? 'יציאה ממסך מלא' : 'מסך מלא'} title={full ? 'יציאה ממסך מלא' : 'מסך מלא'}>
            {full ? <Minimize2 size={15} aria-hidden="true" /> : <Maximize2 size={15} aria-hidden="true" />}
          </button>
        </div>
      </header>

      <main className="cad-body">
        <div className="workspace garden-workspace cad-grid">
          <PlanterStudioHe onStatus={setStatus} />
        </div>
      </main>

      <footer className="cad-status tech-data">
        {(status.measures ?? []).map((item) => (
          <span key={item.label}>
            <em>{item.label}</em>
            <b>{item.value}</b>
          </span>
        ))}
        <span className="cad-status-hint">Ctrl+S · SVG &nbsp;|&nbsp; Ctrl+Shift+S · DXF</span>
      </footer>
    </div>
  );
}
