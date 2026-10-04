/**
 * Documentation: an automatic, always-current drawing set. Sheets are rendered
 * from the model on demand — there is nothing to "update" when the design changes.
 */
import { useEffect, useMemo, useState } from 'react';
import { Download, FileText, Loader, ZoomIn, ZoomOut, Box } from 'lucide-react';
import { useStore } from '../../state/store';
import { useBuilding, useDoc, useLevels } from '../../state/derived';
import { buildSheetSet, renderSheet, SHEET_SIZES, type SheetSize } from '../../core/docs/sheets';
import { exportDxf } from '../../core/io/dxf';
import { exportIfc } from '../../core/io/ifc';
import { Popover } from '../components';

function download(name: string, data: BlobPart, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export default function DocsSpace() {
  const doc = useDoc();
  const b = useBuilding();
  const levels = useLevels();
  const versions = useStore((s) => s.versions);
  const toast = useStore((s) => s.toast);
  const [size, setSize] = useState<SheetSize>('A3');
  const [current, setCurrent] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const revision = `R${versions[0]?.number ?? 1}`;
  const sheets = useMemo(() => buildSheetSet(doc, b, { size, revision }), [doc, b, size, revision]);
  const sheet = sheets[Math.min(current, sheets.length - 1)];
  const svg = useMemo(() => (sheet ? renderSheet(doc, sheet, b) : ''), [doc, sheet, b]);
  const slug = doc.meta.name.replace(/\W+/g, '-');

  const exportPdf = async () => {
    setBusy(true);
    try {
      const { exportSheetsPdf } = await import('../../core/io/pdf');
      const svgs = sheets.map((s) => renderSheet(doc, s, b));
      const blob = await exportSheetsPdf(svgs, size, { title: `${doc.meta.name} — drawing set ${revision}`, author: doc.meta.architect });
      download(`${slug}-${revision}.pdf`, blob, 'application/pdf');
      toast(`${sheets.length}-sheet PDF exported`);
    } catch (e) {
      console.error(e);
      toast('We couldn’t generate the PDF.', { kind: 'err' });
    } finally { setBusy(false); }
  };
  const exportDxfFor = (levelId: string) => { download(`${slug}-${b.levels[levelId].name.replace(/\W+/g, '-')}.dxf`, exportDxf(doc, b, levelId), 'application/dxf'); toast('DXF exported'); };
  const exportIfcFile = () => { download(`${slug}.ifc`, exportIfc(doc, b), 'application/x-step'); toast('IFC4 BIM model exported'); };

  useEffect(() => {
    const onSheet = (e: Event) => { const n = String((e as CustomEvent).detail); const i = sheets.findIndex((s) => s.number === n || s.number.startsWith(n)); if (i >= 0) setCurrent(i); };
    const onExport = (e: Event) => { const k = (e as CustomEvent).detail; if (k === 'pdf') void exportPdf(); if (k === 'dxf' && levels[0]) exportDxfFor(levels[0].id); if (k === 'ifc') exportIfcFile(); };
    window.addEventListener('plinth:sheet', onSheet);
    window.addEventListener('plinth:export', onExport);
    return () => { window.removeEventListener('plinth:sheet', onSheet); window.removeEventListener('plinth:export', onExport); };
  });

  const dim = SHEET_SIZES[size];
  return (
    <>
      <aside className="panel" aria-label="Sheet index">
        <div className="panel-head"><h2>Drawing set</h2><span className="chip">{revision}</span></div>
        <div className="panel-body" style={{ padding: 8 }}>
          {sheets.map((s, i) => (
            <div key={s.number} className="list-item" aria-selected={i === current} onClick={() => setCurrent(i)}>
              <FileText size={14} className="muted" />
              <span className="num" style={{ fontWeight: 600, width: 48 }}>{s.number}</span>
              <span className="grow truncate">{s.title}</span>
              <span className="tiny muted">{s.scale}</span>
            </div>
          ))}
          <div className="tiny muted" style={{ padding: '12px 8px' }}>Plans, elevations, sections, schedules and the area statement are generated from the live model. Revision follows the latest saved version.</div>
        </div>
      </aside>
      <div className="canvas-wrap" style={{ background: 'var(--bg-sunken)', overflow: 'auto' }}>
        <div className="floating row" style={{ top: 12, left: 12, padding: 4, gap: 4, position: 'sticky', display: 'inline-flex', margin: 12 }}>
          <select className="select" style={{ width: 90, height: 28 }} value={size} onChange={(e) => setSize(e.target.value as SheetSize)} aria-label="Sheet size">{(['A0', 'A1', 'A2', 'A3', 'A4'] as SheetSize[]).map((s) => <option key={s}>{s}</option>)}</select>
          <button className="btn ghost icon sm" onClick={() => setZoom(Math.max(0.5, zoom - 0.25))} aria-label="Zoom out"><ZoomOut size={15} /></button>
          <span className="small num muted" style={{ width: 40, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
          <button className="btn ghost icon sm" onClick={() => setZoom(Math.min(3, zoom + 0.25))} aria-label="Zoom in"><ZoomIn size={15} /></button>
          <span style={{ width: 1, height: 20, background: 'var(--line)' }} />
          <button className="btn sm primary" onClick={() => void exportPdf()} disabled={busy}>{busy ? <Loader size={13} className="spin" /> : <Download size={13} />} PDF set</button>
          <button className="btn sm" onClick={() => download(`${slug}-${sheet.number}.svg`, svg, 'image/svg+xml')}>SVG</button>
          <Popover anchor={<button className="btn sm">DXF</button>}>
            {(close) => <div style={{ width: 200 }}>{levels.map((l) => <button key={l.id} onClick={() => { close(); exportDxfFor(l.id); }}>{l.name}</button>)}</div>}
          </Popover>
          <button className="btn sm" onClick={exportIfcFile} title="Industry Foundation Classes (IFC4) BIM model"><Box size={13} /> IFC</button>
        </div>
        {sheet && (
          <div className="sheet-frame" style={{ width: `min(${Math.round(1100 * zoom)}px, ${zoom * 96}%)`, aspectRatio: `${dim.w} / ${dim.h}` }} dangerouslySetInnerHTML={{ __html: svg }} aria-label={`Sheet ${sheet.number} ${sheet.title}`} />
        )}
      </div>
    </>
  );
}
