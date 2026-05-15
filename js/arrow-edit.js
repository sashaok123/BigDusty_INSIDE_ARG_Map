/* Editor-only DOM helpers for the arrow layer: anchor handles on selected
   nodes, drag-to-create / drag-to-rebind, waypoint markers + double-click
   add, junction marker for branching edges, and the floating edge properties
   popover. Stateless across edges: the layer owns the edge map and feeds
   each render call into here. */

import { tr } from './i18n.js';
import { rectOf, anchorWorld, perimeterProjection, rectContains, sideFromBinding, bindingPoint } from './bindings.js';
import { buildMarkdownToolbar } from './md-toolbar.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SNAP_PX = 40;
const ANCHOR_HALO_PX = 50;

const ROUTINGS = [
  { value: 'straight',   labelKey: 'edge_routing_straight'   },
  { value: 'orthogonal', labelKey: 'edge_routing_orthogonal' },
  { value: 'manhattan',  labelKey: 'edge_routing_manhattan'  },
  { value: 'smooth',     labelKey: 'edge_routing_smooth'     },
];

const STYLES = [
  { value: 'solid',  labelKey: 'edge_style_solid'  },
  { value: 'dashed', labelKey: 'edge_style_dashed' },
  { value: 'dotted', labelKey: 'edge_style_dotted' },
];

const COLOURS = [
  { value: 'accent',   labelKey: 'arrow_colour_accent'   },
  { value: 'solved',   labelKey: 'arrow_colour_solved'   },
  { value: 'partial',  labelKey: 'arrow_colour_partial'  },
  { value: 'unsolved', labelKey: 'arrow_colour_unsolved' },
  { value: 'muted',    labelKey: 'arrow_colour_muted'    },
];

export function renderAnchorHandles(group, node, scale, onDown) {
  const r = rectOf(node);
  const sides = [
    { side: 'left',   x: r.x,             y: r.y + r.h / 2 },
    { side: 'right',  x: r.x + r.w,       y: r.y + r.h / 2 },
    { side: 'top',    x: r.x + r.w / 2,   y: r.y           },
    { side: 'bottom', x: r.x + r.w / 2,   y: r.y + r.h     },
  ];
  const radius = 6 / scale;
  for (const s of sides) {
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('cx', String(s.x));
    c.setAttribute('cy', String(s.y));
    c.setAttribute('r',  String(radius));
    c.setAttribute('class', 'arrow-anchor-handle');
    c.setAttribute('data-block', node.id);
    c.setAttribute('data-side',  s.side);
    c.style.pointerEvents = 'none';
    group.appendChild(c);
  }
}

export function renderEndpointHandle(group, edge, which, point, scale, onDown) {
  const handle = document.createElementNS(SVG_NS, 'rect');
  const size = 9 / scale;
  handle.setAttribute('x', String(point.x - size / 2));
  handle.setAttribute('y', String(point.y - size / 2));
  handle.setAttribute('width',  String(size));
  handle.setAttribute('height', String(size));
  handle.setAttribute('class', 'arrow-endpoint-handle');
  handle.setAttribute('data-edge', edge.id);
  handle.setAttribute('data-end',  which);
  handle.style.cursor = 'grab';
  handle.addEventListener('mousedown', (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    onDown(ev, edge.id, which);
  });
  group.appendChild(handle);
}

export function renderWaypointHandles(group, edge, vertices, scale, onWaypointDown, onWaypointContext) {
  if (!Array.isArray(edge.waypoints) || !edge.waypoints.length) return;
  const r = 5 / scale;
  for (let i = 0; i < edge.waypoints.length; i++) {
    const wp = edge.waypoints[i];
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('cx', String(wp.x));
    c.setAttribute('cy', String(wp.y));
    c.setAttribute('r',  String(r));
    c.setAttribute('class', 'arrow-waypoint-handle');
    c.setAttribute('data-edge', edge.id);
    c.setAttribute('data-index', String(i));
    c.style.cursor = 'grab';
    c.addEventListener('mousedown', (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      onWaypointDown(ev, edge.id, i);
    });
    c.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      onWaypointContext(ev, edge.id, i);
    });
    group.appendChild(c);
  }
  void vertices;
}

export function renderJunctionHandle(group, edge, point, scale, onDown) {
  const size = 10 / scale;
  const r = document.createElementNS(SVG_NS, 'rect');
  r.setAttribute('x', String(point.x - size / 2));
  r.setAttribute('y', String(point.y - size / 2));
  r.setAttribute('width',  String(size));
  r.setAttribute('height', String(size));
  r.setAttribute('class', 'arrow-junction-handle');
  r.setAttribute('data-edge', edge.id);
  r.style.cursor = 'move';
  r.addEventListener('mousedown', (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    onDown(ev, edge.id);
  });
  group.appendChild(r);
}

export function findSnapTarget(nodes, imgPt, scale) {
  const halo = ANCHOR_HALO_PX / (scale || 1);
  let best = null;
  let bestScore = Infinity;
  for (const n of nodes.values()) {
    if (!isBlock(n)) continue;
    const rect = rectOf(n);
    const inside = rectContains(rect, imgPt);
    const reachable = inside || pointWithinHalo(rect, imgPt, halo);
    if (!reachable) continue;
    const proj = perimeterProjection(rect, imgPt);
    const score = inside ? -1 : proj.dist;
    if (score < bestScore) {
      bestScore = score;
      best = { nodeId: n.id, point: proj.point, fixedPoint: proj.fixedPoint, dist: proj.dist };
    }
  }
  return best;
}

function pointWithinHalo(rect, pt, halo) {
  const cx = Math.max(rect.x, Math.min(pt.x, rect.x + rect.w));
  const cy = Math.max(rect.y, Math.min(pt.y, rect.y + rect.h));
  return Math.hypot(pt.x - cx, pt.y - cy) <= halo;
}

function isBlock(n) {
  return n && n.kind === 'block' && n.type === 'file';
}

export function defaultJunction(fromPt, branchPts) {
  if (!Array.isArray(branchPts) || !branchPts.length) {
    return { x: fromPt.x, y: fromPt.y };
  }
  let sx = 0;
  let sy = 0;
  for (const p of branchPts) {
    sx += p.x;
    sy += p.y;
  }
  const cx = sx / branchPts.length;
  const cy = sy / branchPts.length;
  return {
    x: (cx + fromPt.x) / 2,
    y: (cy + fromPt.y) / 2,
  };
}

function popoverLabelText(label) {
  if (label && typeof label === 'object' && typeof label.text === 'string') return label.text;
  if (typeof label === 'string') return label;
  return '';
}

function popoverLabelHasPosition(label) {
  return !!(label && typeof label === 'object' && label.position && Number.isFinite(label.position.x) && Number.isFinite(label.position.y));
}

function popoverLabelFontSize(label) {
  if (label && typeof label === 'object' && Number.isFinite(label.fontSize)) return label.fontSize;
  return 14;
}

function popoverLabelColor(label) {
  if (label && typeof label === 'object' && typeof label.color === 'string' && label.color) return label.color;
  return 'auto';
}

function popoverLabelRotation(label) {
  if (label && typeof label === 'object' && Number.isFinite(label.rotation)) return label.rotation;
  return 0;
}

const LABEL_COLOR_SWATCHES = [
  '#16181c', '#ffffff', '#e86b2e', '#2e6fe8',
  '#5fa854', '#d9c34a', '#c43d3d', '#9a6ce8',
];

const LABEL_FONT_SIZE_PRESETS = [
  { key: 'S', value: 12 },
  { key: 'M', value: 16 },
  { key: 'L', value: 20 },
];

const LABEL_POSITION_PRESETS = [
  { value: 'free',        labelKey: 'arrow_label_pos_free'        },
  { value: 'midpoint',    labelKey: 'arrow_label_pos_midpoint'    },
  { value: 'near_source', labelKey: 'arrow_label_pos_near_source' },
  { value: 'near_target', labelKey: 'arrow_label_pos_near_target' },
];

const STROKE_WIDTH_PRESETS = [1, 2, 3, 4, 6, 8];
const STROKE_COLOR_SWATCHES_EDIT = ['#ffffff', '#000000', '#e83d3d', '#e88a3d', '#e8c83d', '#5fa854', '#2e6fe8', '#9a6ce8'];

function popoverStrokeWidth(edge) {
  if (edge && edge.stroke && Number.isFinite(edge.stroke.width)) return edge.stroke.width;
  return 2;
}

function popoverStrokeColor(edge) {
  if (edge && edge.stroke && typeof edge.stroke.color === 'string' && edge.stroke.color) return edge.stroke.color;
  return 'auto';
}

function buildStrokeRow(edge, onPatch) {
  const wrap = document.createElement('div');
  wrap.className = 'arrow-props-row arrow-props-row-block arrow-props-stroke';

  const widthBtns = [];
  const widthRow = document.createElement('div');
  widthRow.className = 'arrow-props-label-style-row';
  const widthLab = document.createElement('span');
  widthLab.className = 'arrow-props-mini-label';
  widthLab.textContent = tr('edge_stroke_width');
  widthRow.appendChild(widthLab);
  const curW = popoverStrokeWidth(edge);
  for (const w of STROKE_WIDTH_PRESETS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'arrow-props-mini-btn arrow-props-stroke-width-btn';
    b.textContent = String(w);
    if (w === curW) b.classList.add('active');
    b.addEventListener('click', () => {
      onPatch({ strokeWidth: w });
      syncWidthActive(w);
    });
    widthRow.appendChild(b);
    widthBtns.push({ w, el: b });
  }
  wrap.appendChild(widthRow);

  const colorRow = document.createElement('div');
  colorRow.className = 'arrow-props-label-style-row';
  const colorLab = document.createElement('span');
  colorLab.className = 'arrow-props-mini-label';
  colorLab.textContent = tr('edge_stroke_color');
  colorRow.appendChild(colorLab);
  const currentColor = popoverStrokeColor(edge);
  const colorBtns = [];
  const autoBtn = document.createElement('button');
  autoBtn.type = 'button';
  autoBtn.className = 'arrow-props-mini-btn';
  autoBtn.textContent = 'A';
  autoBtn.title = tr('arrow_label_color_auto');
  if (currentColor === 'auto') autoBtn.classList.add('active');
  autoBtn.addEventListener('click', () => {
    onPatch({ strokeColor: 'auto' });
    syncColorActive('auto');
  });
  colorRow.appendChild(autoBtn);
  colorBtns.push({ value: 'auto', el: autoBtn });
  for (const c of STROKE_COLOR_SWATCHES_EDIT) {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'arrow-props-color-swatch';
    sw.style.background = c;
    if (currentColor === c) sw.classList.add('active');
    sw.addEventListener('click', () => {
      onPatch({ strokeColor: c });
      syncColorActive(c);
    });
    colorRow.appendChild(sw);
    colorBtns.push({ value: c, el: sw });
  }
  wrap.appendChild(colorRow);

  function syncWidthActive(active) {
    for (const it of widthBtns) it.el.classList.toggle('active', it.w === active);
  }
  function syncColorActive(active) {
    for (const it of colorBtns) it.el.classList.toggle('active', it.value === active);
  }

  return wrap;
}

function buildLabelStyleRow(currentLabel, onPatch) {
  const wrap = document.createElement('div');
  wrap.className = 'arrow-props-row arrow-props-row-block arrow-props-label-style';

  const sizeRow = document.createElement('div');
  sizeRow.className = 'arrow-props-label-style-row';
  const sizeLab = document.createElement('span');
  sizeLab.className = 'arrow-props-mini-label';
  sizeLab.textContent = tr('arrow_label_font_size');
  sizeRow.appendChild(sizeLab);
  const currentFS = popoverLabelFontSize(currentLabel);
  for (const preset of LABEL_FONT_SIZE_PRESETS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'arrow-props-mini-btn';
    b.textContent = preset.key;
    if (preset.value === currentFS) b.classList.add('active');
    b.addEventListener('click', () => onPatch({ fontSize: preset.value }));
    sizeRow.appendChild(b);
  }
  wrap.appendChild(sizeRow);

  const colorRow = document.createElement('div');
  colorRow.className = 'arrow-props-label-style-row';
  const colorLab = document.createElement('span');
  colorLab.className = 'arrow-props-mini-label';
  colorLab.textContent = tr('arrow_label_color');
  colorRow.appendChild(colorLab);
  const currentColor = popoverLabelColor(currentLabel);
  const autoBtn = document.createElement('button');
  autoBtn.type = 'button';
  autoBtn.className = 'arrow-props-mini-btn';
  autoBtn.textContent = 'A';
  autoBtn.title = tr('arrow_label_color_auto');
  if (currentColor === 'auto') autoBtn.classList.add('active');
  autoBtn.addEventListener('click', () => onPatch({ color: 'auto' }));
  colorRow.appendChild(autoBtn);
  for (const c of LABEL_COLOR_SWATCHES) {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'arrow-props-color-swatch';
    sw.style.background = c;
    if (currentColor === c) sw.classList.add('active');
    sw.addEventListener('click', () => onPatch({ color: c }));
    colorRow.appendChild(sw);
  }
  wrap.appendChild(colorRow);

  const posRow = document.createElement('div');
  posRow.className = 'arrow-props-label-style-row';
  const posLab = document.createElement('span');
  posLab.className = 'arrow-props-mini-label';
  posLab.textContent = tr('arrow_label_position');
  posRow.appendChild(posLab);
  const posSel = document.createElement('select');
  posSel.className = 'arrow-props-mini-select';
  for (const opt of LABEL_POSITION_PRESETS) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = tr(opt.labelKey);
    posSel.appendChild(o);
  }
  posSel.value = popoverLabelHasPosition(currentLabel) ? 'free' : 'midpoint';
  posSel.addEventListener('change', () => onPatch({ positionPreset: posSel.value }));
  posRow.appendChild(posSel);
  wrap.appendChild(posRow);

  const rotRow = document.createElement('div');
  rotRow.className = 'arrow-props-label-style-row';
  const rotLab = document.createElement('span');
  rotLab.className = 'arrow-props-mini-label';
  rotLab.textContent = tr('arrow_label_rotation');
  rotRow.appendChild(rotLab);
  const rotIn = document.createElement('input');
  rotIn.type = 'number';
  rotIn.min = '-180';
  rotIn.max = '180';
  rotIn.step = '5';
  rotIn.className = 'arrow-props-mini-input';
  rotIn.value = String(popoverLabelRotation(currentLabel));
  rotIn.addEventListener('change', () => {
    const v = Number(rotIn.value);
    onPatch({ rotation: Number.isFinite(v) ? v : 0 });
  });
  rotRow.appendChild(rotIn);
  wrap.appendChild(rotRow);

  return wrap;
}

export class EdgePropsPopover {
  constructor(opts) {
    this.layer = opts.layer;
    this.el = null;
    this.boundOnDoc = null;
  }

  show(edge, screenPt) {
    this.hide();
    const popover = document.createElement('div');
    popover.className = 'arrow-props';
    popover.style.left = `${Math.max(8, Math.min(window.innerWidth - 290, screenPt.x - 145))}px`;
    popover.style.top  = `${Math.max(8, Math.min(window.innerHeight - 260, screenPt.y + 14))}px`;

    popover.appendChild(this._buildSelectRow('edge_routing', ROUTINGS, edge.routing, (v) => {
      this.layer.applyEdgePatch(edge.id, { routing: v });
    }));
    popover.appendChild(this._buildSelectRow('edge_style', STYLES, edge.style, (v) => {
      this.layer.applyEdgePatch(edge.id, { style: v });
    }));
    popover.appendChild(this._buildSelectRow('edge_color', COLOURS, edge.color || 'accent', (v) => {
      this.layer.applyEdgePatch(edge.id, { color: v });
    }));
    popover.appendChild(buildStrokeRow(edge, (p) => {
      this.layer.applyEdgePatch(edge.id, p);
    }));

    const labelRow = document.createElement('div');
    labelRow.className = 'arrow-props-row arrow-props-row-block';
    const labelLab = document.createElement('label');
    labelLab.textContent = tr('edge_label');
    labelRow.appendChild(labelLab);
    const input = document.createElement('textarea');
    input.rows = 2;
    input.spellcheck = false;
    input.className = 'arrow-props-textarea';
    input.value = popoverLabelText(edge.label);
    input.placeholder = tr('arrow_label_placeholder');
    const mdToolbarRef = buildMarkdownToolbar(() => input);
    labelRow.appendChild(mdToolbarRef.el);
    let labelDebounceTimer = null;
    const commitLabelText = () => {
      this.layer.applyEdgePatch(edge.id, { labelText: input.value });
    };
    input.addEventListener('input', () => {
      if (labelDebounceTimer) clearTimeout(labelDebounceTimer);
      labelDebounceTimer = setTimeout(() => {
        labelDebounceTimer = null;
        commitLabelText();
      }, 500);
    });
    input.addEventListener('blur', () => {
      if (labelDebounceTimer) { clearTimeout(labelDebounceTimer); labelDebounceTimer = null; }
      commitLabelText();
    });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
        ev.preventDefault();
        if (labelDebounceTimer) { clearTimeout(labelDebounceTimer); labelDebounceTimer = null; }
        commitLabelText();
        input.blur();
      }
    });
    this._labelDebounceCancel = () => {
      if (labelDebounceTimer) { clearTimeout(labelDebounceTimer); labelDebounceTimer = null; commitLabelText(); }
    };
    labelRow.appendChild(input);
    popover.appendChild(labelRow);

    popover.appendChild(buildLabelStyleRow(edge.label, (p) => {
      const patch = {};
      if (p.fontSize !== undefined) patch.labelFontSize = p.fontSize;
      if (p.color !== undefined) patch.labelColor = p.color;
      if (p.positionPreset !== undefined) patch.labelPositionPreset = p.positionPreset;
      if (p.rotation !== undefined) patch.labelRotation = p.rotation;
      this.layer.applyEdgePatch(edge.id, patch);
    }));

    if (Array.isArray(edge.branches) && edge.branches.length) {
      for (let i = 0; i < edge.branches.length; i++) {
        const branchIdx = i;
        const b = edge.branches[i];
        const row = document.createElement('div');
        row.className = 'arrow-props-row arrow-props-row-block';
        const lab = document.createElement('label');
        lab.textContent = `${tr('edge_branch_label')} ${i + 1}`;
        row.appendChild(lab);
        const inp = document.createElement('textarea');
        inp.rows = 2;
        inp.spellcheck = false;
        inp.className = 'arrow-props-textarea';
        inp.value = popoverLabelText(b.label);
        inp.placeholder = tr('arrow_label_placeholder');
        const branchTbRef = buildMarkdownToolbar(() => inp);
        row.appendChild(branchTbRef.el);
        let bTimer = null;
        const commit = () => this.layer.applyEdgePatch(edge.id, { branchLabel: { index: branchIdx, text: inp.value } });
        inp.addEventListener('input', () => {
          if (bTimer) clearTimeout(bTimer);
          bTimer = setTimeout(() => { bTimer = null; commit(); }, 500);
        });
        inp.addEventListener('blur', () => {
          if (bTimer) { clearTimeout(bTimer); bTimer = null; commit(); }
        });
        row.appendChild(inp);
        popover.appendChild(row);
        popover.appendChild(buildLabelStyleRow(b.label, (p) => {
          const branchLabel = { index: branchIdx };
          if (p.fontSize !== undefined) branchLabel.fontSize = p.fontSize;
          if (p.color !== undefined) branchLabel.color = p.color;
          if (p.positionPreset !== undefined) branchLabel.positionPreset = p.positionPreset;
          if (p.rotation !== undefined) branchLabel.rotation = p.rotation;
          this.layer.applyEdgePatch(edge.id, { branchLabel });
        }));
      }
    }

    const actions = document.createElement('div');
    actions.className = 'arrow-props-actions';
    const branch = document.createElement('button');
    branch.textContent = tr('edge_add_branch');
    branch.addEventListener('click', () => {
      this.layer.beginAddBranch(edge.id);
    });
    const del = document.createElement('button');
    del.className = 'danger';
    del.textContent = tr('edge_delete');
    del.addEventListener('click', () => {
      this.layer.deleteEdge(edge.id);
    });
    actions.appendChild(branch);
    actions.appendChild(del);
    popover.appendChild(actions);

    document.body.appendChild(popover);
    this.el = popover;
    this._installDismissHandlers();
  }

  _installDismissHandlers() {
    this._removeDismissHandlers();
    const onDocDown = (ev) => {
      if (!this.el) return;
      if (this.el.contains(ev.target)) return;
      const t = ev.target;
      if (t && t.classList && t.classList.contains('arrow-path-interactive')) return;
      if (t && typeof t.closest === 'function' && t.closest('.arrow-path-interactive')) return;
      this.layer._deselect();
    };
    const onKey = (ev) => {
      if (ev.key === 'Escape' && this.el) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        this.layer._deselect();
      }
    };
    this._onDocDown = onDocDown;
    this._onKey = onKey;
    document.addEventListener('mousedown', onDocDown, true);
    document.addEventListener('keydown', onKey, true);
  }

  _removeDismissHandlers() {
    if (this._onDocDown) {
      document.removeEventListener('mousedown', this._onDocDown, true);
      this._onDocDown = null;
    }
    if (this._onKey) {
      document.removeEventListener('keydown', this._onKey, true);
      this._onKey = null;
    }
  }

  hide() {
    if (this._labelDebounceCancel) {
      try { this._labelDebounceCancel(); } catch (e) { void e; }
      this._labelDebounceCancel = null;
    }
    this._removeDismissHandlers();
    if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el);
    this.el = null;
  }

  contains(node) {
    return !!(this.el && node && this.el.contains(node));
  }

  _buildSelectRow(labelKey, options, current, onChange) {
    const row = document.createElement('div');
    row.className = 'arrow-props-row';
    const lab = document.createElement('label');
    lab.textContent = tr(labelKey);
    row.appendChild(lab);
    const sel = document.createElement('select');
    for (const o of options) {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = tr(o.labelKey);
      if (o.value === current) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => onChange(sel.value));
    row.appendChild(sel);
    return row;
  }
}

export class EdgeContextMenu {
  constructor() {
    this.el = null;
  }

  open(screenX, screenY, items) {
    this.close();
    const el = document.createElement('div');
    el.className = 'context-menu';
    el.style.left = `${screenX}px`;
    el.style.top  = `${screenY}px`;
    for (const it of items) {
      const btn = document.createElement('button');
      btn.textContent = it.label;
      if (it.danger) btn.classList.add('danger');
      btn.addEventListener('click', () => {
        this.close();
        it.fn();
      });
      el.appendChild(btn);
    }
    document.body.appendChild(el);
    this.el = el;
    const r = el.getBoundingClientRect();
    if (r.right  > window.innerWidth  - 6) el.style.left = `${window.innerWidth  - r.width  - 6}px`;
    if (r.bottom > window.innerHeight - 6) el.style.top  = `${window.innerHeight - r.height - 6}px`;
    setTimeout(() => {
      const onDoc = (ev) => {
        if (!el.contains(ev.target)) {
          this.close();
          document.removeEventListener('mousedown', onDoc);
        }
      };
      document.addEventListener('mousedown', onDoc);
    }, 0);
  }

  close() {
    if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el);
    this.el = null;
  }
}

export function endpointResolve(edge, which, nodes) {
  const ep = which === 'from' ? endpointDescriptor(edge, 'from') : endpointDescriptor(edge, 'to');
  if (ep.nodeId) {
    const node = nodes.get(ep.nodeId);
    if (node) return { node, binding: ep.binding };
  }
  return { fallback: ep.fallback || null, binding: ep.binding };
}

function endpointDescriptor(edge, which) {
  const nodeId  = which === 'from' ? edge.fromNode : edge.toNode;
  const binding = edge.bindings && edge.bindings[which]
    ? edge.bindings[which]
    : { fixedPoint: [0.5, 0.5], mode: 'orbit' };
  const fallback = which === 'from' ? edge.fromPoint : edge.toPoint;
  return { nodeId, binding, fallback };
}

export function resolveAnchor(edge, which, nodes, otherPoint) {
  const desc = endpointDescriptor(edge, which);
  if (desc.nodeId && nodes.has(desc.nodeId)) {
    const node = nodes.get(desc.nodeId);
    const rect = rectOf(node);
    const anchor = bindingPoint(rect, desc.binding, otherPoint);
    const side = sideFromBinding(rect, desc.binding, otherPoint || anchor);
    return { point: anchor, side, rect, bound: true };
  }
  if (desc.fallback && Number.isFinite(desc.fallback.x) && Number.isFinite(desc.fallback.y)) {
    return { point: { x: desc.fallback.x, y: desc.fallback.y }, side: null, rect: null, bound: false };
  }
  return { point: anchorWorld({ x: 0, y: 0, w: 100, h: 100 }, [0.5, 0.5]), side: null, rect: null, bound: false };
}

export function setEndpointToNode(edge, which, nodeId, fixedPoint) {
  const key = which === 'from' ? 'fromNode' : 'toNode';
  edge[key] = nodeId;
  ensureBindings(edge);
  edge.bindings[which].fixedPoint = [fixedPoint[0], fixedPoint[1]];
  edge.bindings[which].mode = edge.bindings[which].mode === 'inside' ? 'inside' : 'orbit';
  if (which === 'from') edge.fromPoint = null;
  else edge.toPoint = null;
  syncLegacySide(edge);
}

export function setEndpointDangling(edge, which, worldPoint) {
  const key = which === 'from' ? 'fromNode' : 'toNode';
  edge[key] = '';
  if (which === 'from') edge.fromPoint = { x: worldPoint.x, y: worldPoint.y };
  else                  edge.toPoint   = { x: worldPoint.x, y: worldPoint.y };
}

export function rebindEndpointToNode(edge, which, node, fixedPoint) {
  setEndpointToNode(edge, which, node.id, fixedPoint);
}

export function ensureBindings(edge) {
  if (!edge.bindings || typeof edge.bindings !== 'object') {
    edge.bindings = {
      from: { mode: 'orbit', fixedPoint: [0.5, 0.5] },
      to:   { mode: 'orbit', fixedPoint: [0.5, 0.5] },
    };
    return;
  }
  if (!edge.bindings.from) edge.bindings.from = { mode: 'orbit', fixedPoint: [0.5, 0.5] };
  if (!edge.bindings.to)   edge.bindings.to   = { mode: 'orbit', fixedPoint: [0.5, 0.5] };
  if (!Array.isArray(edge.bindings.from.fixedPoint)) edge.bindings.from.fixedPoint = [0.5, 0.5];
  if (!Array.isArray(edge.bindings.to.fixedPoint))   edge.bindings.to.fixedPoint   = [0.5, 0.5];
}

function syncLegacySide(edge) {
  const fromFP = edge.bindings && edge.bindings.from && edge.bindings.from.fixedPoint;
  const toFP   = edge.bindings && edge.bindings.to   && edge.bindings.to.fixedPoint;
  edge.fromSide = sideFromFP(fromFP) || edge.fromSide;
  edge.toSide   = sideFromFP(toFP)   || edge.toSide;
}

function sideFromFP(fp) {
  if (!fp || fp.length !== 2) return null;
  const [u, v] = fp;
  if (u === 0) return 'left';
  if (u === 1) return 'right';
  if (v === 0) return 'top';
  if (v === 1) return 'bottom';
  return null;
}

export { SNAP_PX, ANCHOR_HALO_PX };
