/* Editor-only DOM helpers for the arrow layer: anchor handles on selected
   nodes, drag-to-create / drag-to-rebind, waypoint markers + double-click
   add, junction marker for branching edges, and the floating edge properties
   popover. Stateless across edges: the layer owns the edge map and feeds
   each render call into here. */

import { tr } from './i18n.js';
import { rectOf, anchorWorld, perimeterProjection, rectContains, sideFromBinding, bindingPoint } from './bindings.js';

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
    c.style.cursor = 'crosshair';
    c.addEventListener('mousedown', (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      onDown(ev, node.id, s.side);
    });
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

    const labelRow = document.createElement('div');
    labelRow.className = 'arrow-props-row';
    const labelLab = document.createElement('label');
    labelLab.textContent = tr('edge_label');
    labelRow.appendChild(labelLab);
    const input = document.createElement('input');
    input.type = 'text';
    input.value = popoverLabelText(edge.label);
    input.placeholder = tr('arrow_label_placeholder');
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
      if (ev.key === 'Enter') {
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

    if (popoverLabelHasPosition(edge.label)) {
      const resetRow = document.createElement('div');
      resetRow.className = 'arrow-props-row arrow-props-row-mini';
      const resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.className = 'arrow-props-mini-btn';
      resetBtn.textContent = tr('arrow_label_reset_position');
      resetBtn.addEventListener('click', () => {
        this.layer.applyEdgePatch(edge.id, { labelPosition: null });
      });
      resetRow.appendChild(resetBtn);
      popover.appendChild(resetRow);
    }

    if (Array.isArray(edge.branches) && edge.branches.length) {
      for (let i = 0; i < edge.branches.length; i++) {
        const branchIdx = i;
        const b = edge.branches[i];
        const row = document.createElement('div');
        row.className = 'arrow-props-row';
        const lab = document.createElement('label');
        lab.textContent = `${tr('edge_branch_label')} ${i + 1}`;
        row.appendChild(lab);
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.value = popoverLabelText(b.label);
        inp.placeholder = tr('arrow_label_placeholder');
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
  }

  hide() {
    if (this._labelDebounceCancel) {
      try { this._labelDebounceCancel(); } catch (e) { void e; }
      this._labelDebounceCancel = null;
    }
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
