/**
 * Vector PDF export of drawing sheets.
 *
 * Sheets are already SVG in paper millimetres, so each one is parsed and drawn
 * onto a jsPDF page by svg2pdf.js — lines stay vectors and text stays real,
 * selectable text. Both libraries are imported dynamically so they only load
 * (as their own chunk) when someone actually exports. Browser only.
 */
import { SHEET_SIZES, type SheetSize } from '../docs/sheets';

export async function exportSheetsPdf(svgStrings: string[], size: SheetSize, meta: { title?: string; author?: string } = {}): Promise<Blob> {
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import('jspdf'), import('svg2pdf.js')]);
  const { w, h } = SHEET_SIZES[size];
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [w, h], compress: true });
  pdf.setProperties({ title: meta.title ?? 'Drawing set', author: meta.author ?? '', creator: 'Plinth' });
  const parser = new DOMParser();
  // svg2pdf measures text via the DOM, so each sheet is briefly attached off-screen.
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;width:0;height:0;overflow:hidden;';
  document.body.appendChild(host);
  try {
    for (let i = 0; i < svgStrings.length; i++) {
      if (i > 0) pdf.addPage([w, h], 'landscape');
      const parsed = parser.parseFromString(svgStrings[i], 'image/svg+xml');
      const err = parsed.querySelector('parsererror');
      if (err) throw new Error(`Sheet ${i + 1} is not valid SVG: ${err.textContent ?? ''}`);
      const el = document.importNode(parsed.documentElement, true) as unknown as SVGSVGElement;
      host.appendChild(el);
      await svg2pdf(el, pdf, { x: 0, y: 0, width: w, height: h });
      host.removeChild(el);
    }
  } finally {
    host.remove();
  }
  return pdf.output('blob');
}
