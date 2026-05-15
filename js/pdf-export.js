/* PDF investigation report generator. Builds a multi-page document with a
   cover, table of contents, per-node detail pages, and a bookmarks appendix.
   Uses the vendored jsPDF v2.5.2 UMD bundle loaded via index.html — the
   global `jspdf` namespace is accessed lazily so the module can be imported
   before the library finishes parsing. */

import { tr } from './i18n.js';
import { absoluteImageUrl } from './api-client.js';

const PAPER_SIZES = { a4: 'a4', letter: 'letter' };
const DEFAULT_PAPER = 'a4';
const MARGIN = 48;
const LINE_HEIGHT = 14;
const MAX_IMAGE_WIDTH = 400;

function nowFilenameStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function getJsPdfCtor() {
  try {
    if (typeof window === 'undefined') return null;
    const ns = window.jspdf || (window.jsPDF ? { jsPDF: window.jsPDF } : null);
    if (!ns) return null;
    return ns.jsPDF || null;
  } catch (e) {
    void e;
    return null;
  }
}

function isImageNode(n) {
  if (!n) return false;
  if (n.kind === 'block' || n.kind === 'image') return true;
  if (typeof n.file === 'string' && /\.(png|jpe?g|webp|gif|bmp)(\?.*)?$/i.test(n.file)) return true;
  if (typeof n.mime === 'string' && /^image\//i.test(n.mime)) return true;
  return false;
}

function isTransformNode(n) {
  return !!(n && n.kind === 'transform');
}

function labelOf(n) {
  if (!n) return '';
  return (typeof n.label === 'string' && n.label.trim()) ? n.label.trim()
    : (typeof n.title === 'string' && n.title.trim()) ? n.title.trim()
    : (typeof n.slug === 'string' && n.slug.trim()) ? n.slug.trim()
    : n.id || '';
}

function tryNodeBranchId(n) {
  if (!n || !Array.isArray(n.branches) || !n.branches.length) return null;
  return n.branches[0];
}

function fetchImageAsDataUrl(url) {
  return new Promise((resolve) => {
    if (!url) { resolve(null); return; }
    const target = absoluteImageUrl(url);
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const ratio = img.naturalHeight / Math.max(1, img.naturalWidth);
          const w = Math.min(MAX_IMAGE_WIDTH * 2, img.naturalWidth);
          const h = Math.round(w * ratio);
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          const data = canvas.toDataURL('image/jpeg', 0.78);
          resolve({ dataUrl: data, w, h });
        } catch (e) {
          resolve(null);
          void e;
        }
      };
      img.onerror = () => resolve(null);
      img.src = target;
    } catch (e) {
      void e;
      resolve(null);
    }
  });
}

class PdfBuilder {
  constructor(jsPdfCtor, opts) {
    const fmt = PAPER_SIZES[opts.paperSize] || PAPER_SIZES[DEFAULT_PAPER];
    this.doc = new jsPdfCtor({ unit: 'pt', format: fmt });
    this.pageW = this.doc.internal.pageSize.getWidth();
    this.pageH = this.doc.internal.pageSize.getHeight();
    this.cursorY = MARGIN;
    this.maxY = this.pageH - MARGIN;
    this.opts = opts;
  }

  newPage() {
    this.doc.addPage();
    this.cursorY = MARGIN;
  }

  ensureRoom(needed) {
    if (this.cursorY + needed > this.maxY) this.newPage();
  }

  writeHeading(text, size) {
    if (!text) return;
    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(size || 18);
    this.ensureRoom((size || 18) + 4);
    this.doc.text(String(text), MARGIN, this.cursorY);
    this.cursorY += (size || 18) + 8;
    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(11);
  }

  writeParagraph(text, opts) {
    if (text == null) return;
    const o = opts || {};
    this.doc.setFont('helvetica', o.bold ? 'bold' : 'normal');
    this.doc.setFontSize(o.size || 11);
    const innerWidth = this.pageW - MARGIN * 2;
    const lines = this.doc.splitTextToSize(String(text), innerWidth);
    for (const line of lines) {
      this.ensureRoom(LINE_HEIGHT);
      this.doc.text(line, MARGIN, this.cursorY);
      this.cursorY += LINE_HEIGHT;
    }
  }

  writeFieldLine(label, value) {
    if (value == null || value === '') return;
    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(10);
    const labelText = `${label}: `;
    const lw = this.doc.getTextWidth(labelText);
    this.ensureRoom(LINE_HEIGHT);
    this.doc.text(labelText, MARGIN, this.cursorY);
    this.doc.setFont('helvetica', 'normal');
    const innerWidth = this.pageW - MARGIN * 2 - lw;
    const lines = this.doc.splitTextToSize(String(value), innerWidth);
    if (lines.length === 0) { this.cursorY += LINE_HEIGHT; return; }
    this.doc.text(lines[0], MARGIN + lw, this.cursorY);
    this.cursorY += LINE_HEIGHT;
    for (let i = 1; i < lines.length; i++) {
      this.ensureRoom(LINE_HEIGHT);
      this.doc.text(lines[i], MARGIN, this.cursorY);
      this.cursorY += LINE_HEIGHT;
    }
  }

  writeDivider() {
    this.ensureRoom(8);
    this.doc.setDrawColor(180);
    this.doc.line(MARGIN, this.cursorY, this.pageW - MARGIN, this.cursorY);
    this.cursorY += 12;
  }

  drawTransformBox(input, method, output) {
    const innerWidth = this.pageW - MARGIN * 2;
    const rowH = 24;
    const boxH = rowH * 3 + 6;
    this.ensureRoom(boxH);
    const x = MARGIN;
    const y = this.cursorY;
    this.doc.setDrawColor(120);
    this.doc.rect(x, y, innerWidth, boxH);
    this.doc.line(x, y + rowH, x + innerWidth, y + rowH);
    this.doc.line(x, y + rowH * 2, x + innerWidth, y + rowH * 2);
    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(10);
    this.doc.text(`IN: ${input || ''}`, x + 6, y + 16);
    this.doc.text(`METHOD: ${method || '→'}`, x + 6, y + rowH + 16);
    this.doc.text(`OUT: ${output || ''}`, x + 6, y + rowH * 2 + 16);
    this.cursorY += boxH + 10;
  }

  async drawImage(url) {
    if (!url) return;
    const data = await fetchImageAsDataUrl(url);
    if (!data || !data.dataUrl) return;
    const innerWidth = this.pageW - MARGIN * 2;
    const targetW = Math.min(MAX_IMAGE_WIDTH, innerWidth);
    const targetH = Math.round(targetW * (data.h / Math.max(1, data.w)));
    this.ensureRoom(targetH + 8);
    try {
      this.doc.addImage(data.dataUrl, 'JPEG', MARGIN, this.cursorY, targetW, targetH);
      this.cursorY += targetH + 10;
    } catch (e) {
      console.warn('[pdf-export] addImage failed', e);
    }
  }

  save(filename) {
    this.doc.save(filename);
  }
}

function strippedBody(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/`{1,3}/g, '').replace(/\*\*/g, '').replace(/\*/g, '').replace(/^#+\s*/gm, '');
}

function groupNodesByBranch(allNodes, branches, includeOrphans) {
  const groups = [];
  const idToBranchEntry = new Map();
  for (const b of branches) idToBranchEntry.set(b.id, { branch: b, nodes: [] });
  const orphans = { branch: { id: '__orphan__', label: tr('pdf_export_no_branch') }, nodes: [] };
  for (const n of allNodes) {
    if (!n || !n.id) continue;
    const bid = tryNodeBranchId(n);
    if (bid && idToBranchEntry.has(bid)) {
      idToBranchEntry.get(bid).nodes.push(n);
    } else if (includeOrphans) {
      orphans.nodes.push(n);
    }
  }
  for (const entry of idToBranchEntry.values()) {
    if (entry.nodes.length) groups.push(entry);
  }
  if (includeOrphans && orphans.nodes.length) groups.push(orphans);
  return groups;
}

export async function generatePdfReport(opts) {
  const o = opts || {};
  const jsPdfCtor = getJsPdfCtor();
  if (!jsPdfCtor) throw new Error(tr('pdf_export_unavailable'));
  const nodesMap = o.nodes instanceof Map ? o.nodes : new Map();
  const edgesMap = o.edges instanceof Map ? o.edges : new Map();
  const branches = Array.isArray(o.branches) ? o.branches : [];
  const canvasId = o.canvasId || 'main';
  const includeImages = o.includeImages !== false;
  const includeOrphans = o.includeOrphans !== false;
  const paperSize = PAPER_SIZES[o.paperSize] ? o.paperSize : DEFAULT_PAPER;
  const allNodes = Array.from(nodesMap.values()).filter((n) => n && n.type !== 'group' && n.kind !== 'group');
  const allEdges = Array.from(edgesMap.values());
  const bookmarked = allNodes.filter((n) => n && n.bookmarked);
  const builder = new PdfBuilder(jsPdfCtor, { paperSize });
  builder.writeHeading(tr('pdf_export_title'), 22);
  builder.writeParagraph(`Canvas ID: ${canvasId}`);
  builder.writeParagraph(`Date: ${new Date().toISOString().slice(0, 10)}`);
  builder.writeParagraph(tr('pdf_export_summary_nodes', { n: allNodes.length }));
  builder.writeParagraph(tr('pdf_export_summary_edges', { n: allEdges.length }));
  builder.writeParagraph(tr('pdf_export_summary_branches', { n: branches.length }));
  builder.writeParagraph(tr('pdf_export_summary_bookmarks', { n: bookmarked.length }));
  builder.newPage();
  builder.writeHeading(tr('pdf_export_section_toc'), 18);
  const groups = groupNodesByBranch(allNodes, branches, includeOrphans);
  for (const grp of groups) {
    builder.writeHeading(grp.branch.label || grp.branch.id || '', 13);
    for (const n of grp.nodes) {
      builder.writeParagraph(`• ${labelOf(n)}`);
    }
  }
  const incomingMap = new Map();
  const outgoingMap = new Map();
  for (const e of allEdges) {
    if (!e || !e.fromNode || !e.toNode) continue;
    if (!outgoingMap.has(e.fromNode)) outgoingMap.set(e.fromNode, []);
    if (!incomingMap.has(e.toNode)) incomingMap.set(e.toNode, []);
    outgoingMap.get(e.fromNode).push(e);
    incomingMap.get(e.toNode).push(e);
  }
  for (const grp of groups) {
    for (const n of grp.nodes) {
      builder.newPage();
      builder.writeHeading(labelOf(n), 16);
      if (n.status) builder.writeFieldLine(tr('pdf_export_status'), String(n.status));
      if (Array.isArray(n.tags) && n.tags.length) builder.writeFieldLine(tr('pdf_export_tags'), n.tags.join(', '));
      if (n.verification) builder.writeFieldLine(tr('pdf_export_verification'), n.verification);
      if (n.source_url) builder.writeFieldLine(tr('pdf_export_source'), n.source_url);
      if (n.tool) builder.writeFieldLine(tr('pdf_export_tool'), n.tool);
      builder.writeDivider();
      if (isTransformNode(n)) {
        builder.drawTransformBox(n.input || '', n.method || '', n.output || '');
      }
      if (typeof n.text === 'string' && n.text.trim()) {
        builder.writeParagraph(strippedBody(n.text));
      }
      if (includeImages && isImageNode(n) && typeof n.file === 'string' && n.file) {
        await builder.drawImage(n.file);
      }
      const inc = incomingMap.get(n.id) || [];
      const out = outgoingMap.get(n.id) || [];
      if (inc.length) {
        builder.writeFieldLine(tr('pdf_export_incoming'), inc.map((e) => {
          const peer = nodesMap.get(e.fromNode);
          const lab = (e.label && typeof e.label.text === 'string' && e.label.text) ? `[${e.label.text}] ` : '';
          return `${lab}${labelOf(peer) || e.fromNode}`;
        }).join('; '));
      }
      if (out.length) {
        builder.writeFieldLine(tr('pdf_export_outgoing'), out.map((e) => {
          const peer = nodesMap.get(e.toNode);
          const lab = (e.label && typeof e.label.text === 'string' && e.label.text) ? `[${e.label.text}] ` : '';
          return `${lab}${labelOf(peer) || e.toNode}`;
        }).join('; '));
      }
    }
  }
  if (bookmarked.length) {
    builder.newPage();
    builder.writeHeading(tr('pdf_export_section_bookmarks'), 18);
    for (const n of bookmarked) {
      builder.writeParagraph(`★ ${labelOf(n)}`);
      if (typeof n.text === 'string' && n.text.trim()) {
        builder.writeParagraph(strippedBody(n.text).slice(0, 600));
      }
      builder.writeDivider();
    }
  }
  const filename = `investigation-report-${nowFilenameStamp()}.pdf`;
  builder.save(filename);
  return filename;
}

export function openPdfExportDialog(opts) {
  const o = opts || {};
  if (!getJsPdfCtor()) {
    if (typeof o.onToast === 'function') o.onToast(tr('pdf_export_unavailable'), 'error');
    return;
  }
  let overlay = document.getElementById('pdf-export-overlay');
  if (overlay) overlay.remove();
  overlay = document.createElement('div');
  overlay.id = 'pdf-export-overlay';
  overlay.className = 'pdf-export-overlay';
  overlay.innerHTML = `
    <div class="pdf-export-box">
      <div class="pdf-export-head">
        <h2>${tr('pdf_export_title')}</h2>
        <button type="button" class="pdf-export-close" aria-label="close">&times;</button>
      </div>
      <div class="pdf-export-body">
        <label class="pdf-export-row">
          <input type="checkbox" id="pdf-opt-images" checked>
          <span>${tr('pdf_export_include_images')}</span>
        </label>
        <label class="pdf-export-row">
          <input type="checkbox" id="pdf-opt-orphans" checked>
          <span>${tr('pdf_export_include_orphans')}</span>
        </label>
        <label class="pdf-export-row">
          <span>${tr('pdf_export_paper_size')}</span>
          <select id="pdf-opt-paper">
            <option value="a4">A4</option>
            <option value="letter">Letter</option>
          </select>
        </label>
      </div>
      <div class="pdf-export-foot">
        <button type="button" class="pdf-export-cancel">${tr('pdf_export_cancel')}</button>
        <button type="button" class="pdf-export-generate">${tr('pdf_export_generate')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => { try { overlay.remove(); } catch (e) { void e; } };
  overlay.querySelector('.pdf-export-close').addEventListener('click', close);
  overlay.querySelector('.pdf-export-cancel').addEventListener('click', close);
  overlay.querySelector('.pdf-export-generate').addEventListener('click', async () => {
    const includeImages = overlay.querySelector('#pdf-opt-images').checked;
    const includeOrphans = overlay.querySelector('#pdf-opt-orphans').checked;
    const paperSize = overlay.querySelector('#pdf-opt-paper').value || DEFAULT_PAPER;
    close();
    if (typeof o.onToast === 'function') o.onToast(tr('pdf_export_generating'));
    try {
      const filename = await generatePdfReport({
        nodes: o.getNodes ? o.getNodes() : new Map(),
        edges: o.getEdges ? o.getEdges() : new Map(),
        branches: o.getBranches ? o.getBranches() : [],
        canvasId: o.canvasId || 'main',
        includeImages,
        includeOrphans,
        paperSize,
      });
      if (typeof o.onToast === 'function') o.onToast(tr('pdf_export_done'));
      void filename;
    } catch (e) {
      const msg = (e && e.message) ? e.message : 'error';
      if (typeof o.onToast === 'function') o.onToast(tr('pdf_export_failed', { error: msg }), 'error');
    }
  });
}
