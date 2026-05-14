/* Floating alignment toolbar shown when 2+ nodes are selected. Calls the
   host's `onApply(op)` for each click. ops: left/right/centerH/top/bottom/
   middleV/distH/distV. */

import { tr } from './i18n.js';

const OPS = [
  { id: 'left',    i18n: 'align_left',    icon: 'M4 3v18M9 6h11M9 12h7M9 18h11' },
  { id: 'centerH', i18n: 'align_center_h', icon: 'M12 3v18M5 6h14M7 12h10M6 18h12' },
  { id: 'right',   i18n: 'align_right',   icon: 'M20 3v18M4 6h11M8 12h7M4 18h11' },
  { id: '|',       kind: 'sep' },
  { id: 'top',     i18n: 'align_top',     icon: 'M3 4h18M6 9v11M12 9v7M18 9v11' },
  { id: 'middleV', i18n: 'align_middle_v', icon: 'M3 12h18M6 5v14M12 7v10M18 5v14' },
  { id: 'bottom',  i18n: 'align_bottom',  icon: 'M3 20h18M6 4v11M12 8v7M18 4v11' },
  { id: '|',       kind: 'sep' },
  { id: 'distH',   i18n: 'distribute_horizontal', icon: 'M3 4v16M21 4v16M8 8h2v8H8zM14 8h2v8h-2z' },
  { id: 'distV',   i18n: 'distribute_vertical',   icon: 'M4 3h16M4 21h16M8 8v2h8V8zM8 14v2h8v-2z' },
];

export class AlignFloater {
  constructor(opts) {
    this.viewport = opts.viewport;
    this.getSelection = opts.getSelection || (() => []);
    this.getNode = opts.getNode || (() => null);
    this.onApply = opts.onApply || (() => {});
    this._build();
    document.addEventListener('selection:changed', () => this.refresh());
    window.addEventListener('resize', () => this.refresh());
  }

  _build() {
    const wrap = document.createElement('div');
    wrap.className = 'align-floater';
    wrap.style.display = 'none';
    const svgNs = 'http://www.w3.org/2000/svg';
    for (const op of OPS) {
      if (op.kind === 'sep') {
        const s = document.createElement('span');
        s.className = 'align-floater-sep';
        wrap.appendChild(s);
        continue;
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'align-floater-btn';
      b.dataset.i18n = op.i18n;
      b.title = tr(op.i18n);
      b.setAttribute('aria-label', tr(op.i18n));
      const s = document.createElementNS(svgNs, 'svg');
      s.setAttribute('viewBox', '0 0 24 24');
      s.setAttribute('width', '16');
      s.setAttribute('height', '16');
      const p = document.createElementNS(svgNs, 'path');
      p.setAttribute('d', op.icon);
      p.setAttribute('stroke', 'currentColor');
      p.setAttribute('stroke-width', '1.4');
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke-linecap', 'round');
      p.setAttribute('stroke-linejoin', 'round');
      s.appendChild(p);
      b.appendChild(s);
      b.addEventListener('click', () => this.onApply(op.id));
      wrap.appendChild(b);
    }
    document.body.appendChild(wrap);
    this.el = wrap;
    document.addEventListener('i18n:changed', () => {
      this.el.querySelectorAll('button[data-i18n]').forEach((b) => {
        b.title = tr(b.dataset.i18n);
        b.setAttribute('aria-label', tr(b.dataset.i18n));
      });
    });
  }

  refresh() {
    const ids = this.getSelection();
    if (!ids || ids.length < 2) { this.el.style.display = 'none'; return; }
    const nodes = ids.map((id) => this.getNode(id)).filter(Boolean);
    if (nodes.length < 2) { this.el.style.display = 'none'; return; }
    let minX = Infinity, minY = Infinity;
    for (const n of nodes) {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
    }
    const t = (window.__viewer && window.__viewer.getTransform) ? window.__viewer.getTransform() : { scale: 1, panX: 0, panY: 0 };
    const sx = minX * t.scale + t.panX;
    const sy = minY * t.scale + t.panY;
    const left = Math.max(80, Math.min(window.innerWidth - 240, sx));
    const top = Math.max(70, Math.min(window.innerHeight - 60, sy - 50));
    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
    this.el.style.display = 'flex';
  }
}
