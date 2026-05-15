/* Top-level SVG arrow layer manager. Owns the edges Map (mirror of state),
   delegates routing to router.js, path strings to connector.js, and editor
   interactions to arrow-edit.js. Bidirectional bindings mean each node tracks
   a boundEdges Set so node drags can recompute only what they touched. */

import { tr } from './i18n.js';
import { isBlockNode } from './nodes.js';
import { isSpaceHeld } from './tools.js';
import { resolveAnchor, ensureBindings, setEndpointToNode, setEndpointDangling, findSnapTarget, defaultJunction, renderAnchorHandles, renderEndpointHandle, renderWaypointHandles, renderJunctionHandle, EdgePropsPopover, EdgeContextMenu } from './arrow-edit.js';
import { routeEdge, ROUTINGS, isValidRouting, pointAlong } from './router.js';
import { vertexPathD, dashFor, STYLES, isValidStyle } from './connector.js';
import { rectOf } from './bindings.js';
import { lodFor } from './lod.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const COLOURS = ['accent', 'solved', 'partial', 'unsolved', 'muted'];
const COLOUR_VAR = {
  accent:   'var(--accent)',
  solved:   'var(--solved)',
  partial:  'var(--partial)',
  unsolved: 'var(--unsolved)',
  muted:    'var(--text-dim)',
};

export { isValidRouting, isValidStyle, ROUTINGS, STYLES };

export function isValidColour(c) { return COLOURS.includes(c); }

const STROKE_COLOR_SWATCHES = ['#ffffff', '#000000', '#e83d3d', '#e88a3d', '#e8c83d', '#5fa854', '#2e6fe8', '#9a6ce8'];

function ensureStrokeShape(stroke) {
  const def = { width: 2, color: 'auto' };
  if (!stroke || typeof stroke !== 'object') return { ...def };
  const w = Number(stroke.width);
  const width = Number.isFinite(w) ? Math.max(1, Math.min(12, w)) : def.width;
  const color = typeof stroke.color === 'string' && stroke.color ? stroke.color : def.color;
  return { width, color };
}

function strokeFor(edge, fallbackColour) {
  const s = ensureStrokeShape(edge.stroke);
  const colour = s.color === 'auto' ? COLOUR_VAR[fallbackColour] || COLOUR_VAR.accent : s.color;
  return { width: s.width, colour };
}

export { STROKE_COLOR_SWATCHES, ensureStrokeShape };

function ensureLabelShape(label) {
  if (label && typeof label === 'object' && typeof label.text === 'string') {
    const pos = label.position;
    const safePos = (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y))
      ? { x: pos.x, y: pos.y } : null;
    const fontSize = Number.isFinite(label.fontSize) ? Math.max(8, Math.min(64, label.fontSize)) : 14;
    const color = typeof label.color === 'string' && label.color ? label.color : 'auto';
    const rotation = Number.isFinite(label.rotation) ? Math.max(-180, Math.min(180, label.rotation)) : 0;
    return { text: label.text, position: safePos, fontSize, color, rotation };
  }
  if (typeof label === 'string') return { text: label, position: null, fontSize: 14, color: 'auto', rotation: 0 };
  return { text: '', position: null, fontSize: 14, color: 'auto', rotation: 0 };
}

function normaliseLabelValue(value, current) {
  const cur = ensureLabelShape(current);
  if (typeof value === 'string') return { ...cur, text: value };
  if (value && typeof value === 'object') {
    const next = ensureLabelShape(value);
    return {
      text: typeof value.text === 'string' ? value.text : cur.text,
      position: value.position === null ? null : (next.position || cur.position),
      fontSize: Number.isFinite(value.fontSize) ? next.fontSize : cur.fontSize,
      color: typeof value.color === 'string' && value.color ? next.color : cur.color,
      rotation: Number.isFinite(value.rotation) ? next.rotation : cur.rotation,
    };
  }
  return cur;
}


export class ArrowLayer {
  constructor(opts) {
    this.svg = opts.svg;
    this.viewport = opts.viewport;
    this.getNodes = opts.getNodes;
    this.getTransform = opts.getTransform;
    this.onEdgesChange = opts.onEdgesChange || (() => {});
    this.onScheduleSave = opts.onScheduleSave || (() => {});
    this.onEdgeMutation = opts.onEdgeMutation || (() => {});

    this.edges = new Map();
    this.boundEdges = new Map();
    this.mode = 'viewer';
    this.selectedId = null;
    this.hoverId = null;
    this.hoverHandle = null;
    this._hoverNodeId = null;
    this.dragState = null;
    this.contextMenu = new EdgeContextMenu();
    this.popover = new EdgePropsPopover({ layer: this });
    this.statusFilter = null;
    this.fadeNonMatching = false;
    this._pathCache = new Map();

    this._installRoot();
    this._installEvents();
  }

  _installRoot() {
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);
    this.defs = document.createElementNS(SVG_NS, 'defs');
    this._customMarkerCache = new Set();
    for (const c of COLOURS) {
      const mk = document.createElementNS(SVG_NS, 'marker');
      mk.setAttribute('id', `arrowhead-${c}`);
      mk.setAttribute('viewBox', '0 0 10 10');
      mk.setAttribute('refX', '8');
      mk.setAttribute('refY', '5');
      mk.setAttribute('markerWidth',  '6');
      mk.setAttribute('markerHeight', '6');
      mk.setAttribute('orient', 'auto-start-reverse');
      const poly = document.createElementNS(SVG_NS, 'path');
      poly.setAttribute('d', 'M 0 0 L 10 5 L 0 10 Z');
      poly.setAttribute('fill', COLOUR_VAR[c]);
      mk.appendChild(poly);
      this.defs.appendChild(mk);
    }
    this.svg.appendChild(this.defs);
    this.world = document.createElementNS(SVG_NS, 'g');
    this.world.setAttribute('id', 'arrow-world');
    this.svg.appendChild(this.world);
    this.edgesGroup = document.createElementNS(SVG_NS, 'g');
    this.edgesGroup.setAttribute('id', 'arrow-paths');
    this.world.appendChild(this.edgesGroup);
    this.handlesGroup = document.createElementNS(SVG_NS, 'g');
    this.handlesGroup.setAttribute('id', 'arrow-handles');
    this.world.appendChild(this.handlesGroup);
    this.previewGroup = document.createElementNS(SVG_NS, 'g');
    this.previewGroup.setAttribute('id', 'arrow-preview');
    this.world.appendChild(this.previewGroup);
  }

  _ensureCustomMarker(hex) {
    const key = String(hex).toLowerCase();
    if (!/^#[0-9a-f]{3,8}$/i.test(key)) return null;
    const id = `arrowhead-x${key.slice(1)}`;
    if (this._customMarkerCache && this._customMarkerCache.has(id)) return id;
    const mk = document.createElementNS(SVG_NS, 'marker');
    mk.setAttribute('id', id);
    mk.setAttribute('viewBox', '0 0 10 10');
    mk.setAttribute('refX', '8');
    mk.setAttribute('refY', '5');
    mk.setAttribute('markerWidth', '6');
    mk.setAttribute('markerHeight', '6');
    mk.setAttribute('orient', 'auto-start-reverse');
    const poly = document.createElementNS(SVG_NS, 'path');
    poly.setAttribute('d', 'M 0 0 L 10 5 L 0 10 Z');
    poly.setAttribute('fill', key);
    mk.appendChild(poly);
    this.defs.appendChild(mk);
    if (this._customMarkerCache) this._customMarkerCache.add(id);
    return id;
  }

  _markerEndUrlFor(edge, fallbackColour) {
    const s = ensureStrokeShape(edge.stroke);
    if (s.color !== 'auto') {
      const id = this._ensureCustomMarker(s.color);
      if (id) return `url(#${id})`;
    }
    const preset = COLOUR_VAR[fallbackColour] ? fallbackColour : 'accent';
    return `url(#arrowhead-${preset})`;
  }

  _installEvents() {
    this.svg.addEventListener('mousedown', (e) => this._onMouseDown(e));
    window.addEventListener('mousemove', (e) => this._onMouseMove(e));
    window.addEventListener('mouseup',   (e) => this._onMouseUp(e));
    this.svg.addEventListener('dblclick', (e) => this._onDoubleClick(e));
    this.svg.addEventListener('contextmenu', (e) => this._onContextMenu(e));
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.dragState && this.dragState.kind === 'draw-branch') {
        this.dragState = null;
        this._hideBranchHint();
        this.requestDraw();
      }
    });
  }

  setEdges(edges) {
    this.edges = edges instanceof Map ? edges : new Map();
    for (const e of this.edges.values()) ensureBindings(e);
    this._rebuildBoundIndex();
    this._pathCache.clear();
    this.requestDraw();
  }

  setStatusFilter(statusSet, opts) {
    this.statusFilter = statusSet instanceof Set ? statusSet : null;
    this.fadeNonMatching = !!(opts && opts.fade);
    this.requestDraw();
  }

  getEdgesMap() { return this.edges; }

  setMode(mode) {
    this.mode = mode;
    if (mode !== 'editor') {
      this._deselect();
    }
    this.requestDraw();
  }

  requestDraw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      this._draw();
    });
  }

  retranslate() {
    if (this.selectedId) {
      const e = this.edges.get(this.selectedId);
      if (e) {
        const screenPt = this._popoverAnchorScreen(e);
        this.popover.show(e, screenPt);
      }
    }
  }

  _rebuildBoundIndex() {
    this.boundEdges.clear();
    for (const e of this.edges.values()) {
      if (e.fromNode) {
        if (!this.boundEdges.has(e.fromNode)) this.boundEdges.set(e.fromNode, new Set());
        this.boundEdges.get(e.fromNode).add(e.id);
      }
      if (e.toNode) {
        if (!this.boundEdges.has(e.toNode)) this.boundEdges.set(e.toNode, new Set());
        this.boundEdges.get(e.toNode).add(e.id);
      }
      if (Array.isArray(e.branches)) {
        for (const b of e.branches) {
          if (b.toNode) {
            if (!this.boundEdges.has(b.toNode)) this.boundEdges.set(b.toNode, new Set());
            this.boundEdges.get(b.toNode).add(e.id);
          }
        }
      }
    }
  }

  createEdgeFromPoints(opts) {
    const id = this._nextId();
    const fromPt = opts && opts.fromPt ? { x: opts.fromPt.x, y: opts.fromPt.y } : { x: 0, y: 0 };
    const toPt = opts && opts.toPt ? { x: opts.toPt.x, y: opts.toPt.y } : { x: fromPt.x + 100, y: fromPt.y };
    const newEdge = {
      id,
      fromNode: opts && opts.fromId ? opts.fromId : '',
      toNode:   opts && opts.toId   ? opts.toId   : '',
      routing: 'orthogonal',
      style:   'solid',
      color:   'accent',
      label:   '',
      bindings: {
        from: { mode: 'orbit', fixedPoint: [0.5, 0.5] },
        to:   { mode: 'orbit', fixedPoint: [0.5, 0.5] },
      },
    };
    if (!newEdge.fromNode) newEdge.fromPoint = fromPt;
    if (!newEdge.toNode) newEdge.toPoint = toPt;
    this.edges.set(id, newEdge);
    this._rebuildBoundIndex();
    this._selectEdge(id, null);
    this.onEdgesChange();
    this.onScheduleSave();
    this.onEdgeMutation('create', id, newEdge);
    return id;
  }

  notifyNodeDeleted(nodeId) {
    const ids = this.boundEdges.get(nodeId);
    if (!ids) return;
    for (const eid of ids) {
      const e = this.edges.get(eid);
      if (!e) continue;
      const nodes = this.getNodes();
      const otherPt = e.fromNode === nodeId
        ? resolveAnchor(e, 'to', nodes, null).point
        : resolveAnchor(e, 'from', nodes, null).point;
      const danglingAt = otherPt || { x: 0, y: 0 };
      if (e.fromNode === nodeId) setEndpointDangling(e, 'from', danglingAt);
      if (e.toNode   === nodeId) setEndpointDangling(e, 'to',   danglingAt);
      if (Array.isArray(e.branches)) {
        e.branches = e.branches.filter((b) => b.toNode !== nodeId);
      }
      this._pathCache.delete(eid);
    }
    this.boundEdges.delete(nodeId);
    this.requestDraw();
  }

  invalidateEdge(id) {
    if (id) this._pathCache.delete(id);
  }

  invalidateNode(nodeId) {
    const ids = this.boundEdges.get(nodeId);
    if (!ids) return;
    for (const eid of ids) this._pathCache.delete(eid);
  }

  applyEdgePatch(id, patch, opts) {
    const e = this.edges.get(id);
    if (!e) return;
    if (patch.routing !== undefined) e.routing = isValidRouting(patch.routing) ? patch.routing : e.routing;
    if (patch.style   !== undefined) e.style   = isValidStyle(patch.style)   ? patch.style   : e.style;
    if (patch.color   !== undefined) e.color   = isValidColour(patch.color)  ? patch.color   : 'accent';
    if (patch.strokeWidth !== undefined) {
      const cur = ensureStrokeShape(e.stroke);
      const w = Number(patch.strokeWidth);
      e.stroke = { ...cur, width: Number.isFinite(w) ? Math.max(1, Math.min(12, w)) : cur.width };
    }
    if (patch.strokeColor !== undefined) {
      const cur = ensureStrokeShape(e.stroke);
      const c = typeof patch.strokeColor === 'string' && patch.strokeColor ? patch.strokeColor : 'auto';
      e.stroke = { ...cur, color: c };
    }
    if (patch.routing !== undefined) this._pathCache.delete(id);
    if (patch.label   !== undefined) e.label   = normaliseLabelValue(patch.label, e.label);
    if (patch.labelText !== undefined) {
      const cur = ensureLabelShape(e.label);
      e.label = { ...cur, text: String(patch.labelText) };
    }
    if (patch.labelPosition !== undefined) {
      const cur = ensureLabelShape(e.label);
      e.label = { ...cur, position: patch.labelPosition || null };
    }
    if (patch.labelFontSize !== undefined) {
      const cur = ensureLabelShape(e.label);
      const fs = Number(patch.labelFontSize);
      e.label = { ...cur, fontSize: Number.isFinite(fs) ? Math.max(8, Math.min(64, fs)) : cur.fontSize };
    }
    if (patch.labelColor !== undefined) {
      const cur = ensureLabelShape(e.label);
      const col = typeof patch.labelColor === 'string' && patch.labelColor ? patch.labelColor : 'auto';
      e.label = { ...cur, color: col };
    }
    if (patch.labelRotation !== undefined) {
      const cur = ensureLabelShape(e.label);
      const r = Number(patch.labelRotation);
      e.label = { ...cur, rotation: Number.isFinite(r) ? Math.max(-180, Math.min(180, r)) : 0 };
    }
    if (patch.labelPositionPreset !== undefined) {
      const cur = ensureLabelShape(e.label);
      const preset = patch.labelPositionPreset;
      const nodes = this.getNodes();
      const from = resolveAnchor(e, 'from', nodes, null).point;
      const to = resolveAnchor(e, 'to', nodes, null).point;
      let nextPos = null;
      if (preset === 'midpoint') nextPos = null;
      else if (preset === 'near_source') nextPos = { x: from.x + (to.x - from.x) * 0.2, y: from.y + (to.y - from.y) * 0.2 };
      else if (preset === 'near_target') nextPos = { x: from.x + (to.x - from.x) * 0.8, y: from.y + (to.y - from.y) * 0.8 };
      else if (preset === 'free') nextPos = cur.position || { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
      e.label = { ...cur, position: nextPos };
    }
    if (patch.branchLabel && typeof patch.branchLabel === 'object') {
      const { index, text, position, fontSize, color, rotation, positionPreset } = patch.branchLabel;
      if (Array.isArray(e.branches) && Number.isInteger(index) && e.branches[index]) {
        const cur = ensureLabelShape(e.branches[index].label);
        let next = { ...cur };
        if (text !== undefined) next.text = String(text);
        if (position !== undefined) next.position = position || null;
        if (Number.isFinite(fontSize)) next.fontSize = Math.max(8, Math.min(64, fontSize));
        if (typeof color === 'string' && color) next.color = color;
        if (Number.isFinite(rotation)) next.rotation = Math.max(-180, Math.min(180, rotation));
        if (positionPreset) {
          const nodes = this.getNodes();
          const junction = e.junction || resolveAnchor(e, 'from', nodes, null).point;
          const targetNode = nodes.get(e.branches[index].toNode);
          const targetPt = targetNode ? { x: targetNode.x + targetNode.width / 2, y: targetNode.y + targetNode.height / 2 } : junction;
          if (positionPreset === 'midpoint') next.position = null;
          else if (positionPreset === 'near_source') next.position = { x: junction.x + (targetPt.x - junction.x) * 0.2, y: junction.y + (targetPt.y - junction.y) * 0.2 };
          else if (positionPreset === 'near_target') next.position = { x: junction.x + (targetPt.x - junction.x) * 0.8, y: junction.y + (targetPt.y - junction.y) * 0.8 };
        }
        e.branches[index].label = next;
      }
    }
    this.requestDraw();
    if (!opts || !opts.silent) {
      this.onEdgesChange();
      this.onScheduleSave();
      this.onEdgeMutation('update', id, e);
    }
  }

  commitEdge() {
    this.onEdgesChange();
    this.onScheduleSave();
  }

  deleteEdge(id) {
    if (!this.edges.has(id)) return;
    this.edges.delete(id);
    this._pathCache.delete(id);
    if (this.selectedId === id) this._deselect();
    this._rebuildBoundIndex();
    this.onEdgesChange();
    this.onScheduleSave();
    this.onEdgeMutation('delete', id, null);
    this.requestDraw();
  }

  beginAddBranch(id) {
    const e = this.edges.get(id);
    if (!e) return;
    const nodes = this.getNodes();
    const from = resolveAnchor(e, 'from', nodes, null).point;
    const to   = resolveAnchor(e, 'to',   nodes, null).point;
    if (!e.junction) e.junction = defaultJunction(from, [to]);
    const excludeIds = new Set();
    if (e.fromNode) excludeIds.add(e.fromNode);
    if (e.toNode) excludeIds.add(e.toNode);
    if (Array.isArray(e.branches)) for (const b of e.branches) if (b.toNode) excludeIds.add(b.toNode);
    this.dragState = {
      kind: 'draw-branch',
      edgeId: id,
      cursorImg: { x: to.x, y: to.y },
      anchorImg: { x: to.x, y: to.y },
      excludeIds,
      snapped: null,
    };
    this.popover.hide();
    this._showBranchHint();
    this.requestDraw();
  }

  _showBranchHint() {
    if (this._branchHintEl) {
      try { document.body.removeChild(this._branchHintEl); } catch (e) { void e; }
      this._branchHintEl = null;
    }
    const hint = document.createElement('div');
    hint.className = 'arrow-branch-hint';
    hint.textContent = tr('arrow_drag_to_target');
    hint.style.cssText = 'position:fixed;left:50%;top:60px;transform:translateX(-50%);background:var(--panel-bg);border:1px solid var(--accent);color:var(--accent);padding:6px 14px;border-radius:var(--radius);font-family:var(--font-mono);font-size:11px;letter-spacing:1px;text-transform:uppercase;z-index:1700;box-shadow:var(--shadow-soft);pointer-events:none;';
    document.body.appendChild(hint);
    this._branchHintEl = hint;
  }

  _hideBranchHint() {
    if (this._branchHintEl) {
      try { document.body.removeChild(this._branchHintEl); } catch (e) { void e; }
      this._branchHintEl = null;
    }
  }

  _draw() {
    const t = this.getTransform();
    this.world.setAttribute('transform', `translate(${t.panX} ${t.panY}) scale(${t.scale})`);

    while (this.edgesGroup.firstChild)   this.edgesGroup.removeChild(this.edgesGroup.firstChild);
    while (this.handlesGroup.firstChild) this.handlesGroup.removeChild(this.handlesGroup.firstChild);
    while (this.previewGroup.firstChild) this.previewGroup.removeChild(this.previewGroup.firstChild);

    const scale = t.scale || 1;
    const lod = lodFor(scale);
    const nodes = this.getNodes();
    const obstacles = this._obstacleRects(nodes);

    for (const e of this.edges.values()) {
      this._renderEdge(e, nodes, obstacles, scale, lod);
    }

    if (this.mode === 'editor' && lod.handlesVisible) {
      this._renderEditorOverlay(nodes, scale);
    }

    if (this.dragState) this._renderDragPreview(scale, nodes);
  }

  _obstacleRects(nodes) {
    const out = [];
    for (const n of nodes.values()) {
      if (isBlockNode(n)) out.push(rectOf(n));
    }
    return out;
  }

  _obstaclesExcluding(all, excludeRects) {
    if (!Array.isArray(all) || !all.length) return [];
    const exclude = (excludeRects || []).filter(Boolean);
    if (!exclude.length) return all;
    return all.filter((r) => {
      for (const ex of exclude) {
        if (Math.abs(r.x - ex.x) < 0.5 && Math.abs(r.y - ex.y) < 0.5
            && Math.abs(r.w - ex.w) < 0.5 && Math.abs(r.h - ex.h) < 0.5) return false;
      }
      return true;
    });
  }

  _renderEdge(edge, nodes, obstacles, scale, lod) {
    const toAnchor   = resolveAnchor(edge, 'to',   nodes, null).point;
    const fromInfo   = resolveAnchor(edge, 'from', nodes, toAnchor);
    const toInfo     = resolveAnchor(edge, 'to',   nodes, fromInfo.point);
    const colour     = COLOUR_VAR[edge.color] ? edge.color : 'accent';
    const opacity    = this._edgeOpacity(edge, nodes);

    if (Array.isArray(edge.branches) && edge.branches.length) {
      this._renderBranchedEdge(edge, fromInfo, nodes, obstacles, scale, colour, lod, opacity);
      return;
    }

    const cacheKey = this._edgeRouteKey(edge, fromInfo, toInfo);
    const cached = this._pathCache.get(edge.id);
    let vertices;
    let d;
    if (cached && cached.key === cacheKey) {
      vertices = cached.vertices;
      d = cached.d;
    } else {
      vertices = routeEdge(edge.routing, fromInfo.point, toInfo.point, {
        fromSide: fromInfo.side,
        toSide:   toInfo.side,
        obstacles: this._obstaclesExcluding(obstacles, [fromInfo.rect, toInfo.rect]),
        waypoints: edge.waypoints,
      });
      d = vertexPathD(vertices, edge.routing);
      this._pathCache.set(edge.id, { key: cacheKey, vertices, d });
    }
    this._appendEdgePath(edge, d, colour, scale, vertices, { opacity });
    if (lod && lod.edgeLabelsVisible) {
      this._appendEdgeLabel(edge, vertices, scale, opacity);
    }
  }

  _edgeRouteKey(edge, fromInfo, toInfo) {
    const wp = Array.isArray(edge.waypoints)
      ? edge.waypoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(';')
      : '';
    return `${edge.routing}|${fromInfo.point.x.toFixed(2)},${fromInfo.point.y.toFixed(2)}|${toInfo.point.x.toFixed(2)},${toInfo.point.y.toFixed(2)}|${fromInfo.side || ''}|${toInfo.side || ''}|${wp}`;
  }

  _edgeOpacity(edge, nodes) {
    if (!this.fadeNonMatching || !this.statusFilter) return 1;
    const fromN = nodes.get(edge.fromNode);
    const toN   = nodes.get(edge.toNode);
    const fromMatch = fromN ? this._nodeMatchesFilter(fromN) : false;
    const toMatch   = toN   ? this._nodeMatchesFilter(toN)   : false;
    return (fromMatch || toMatch) ? 1 : 0.1;
  }

  _nodeMatchesFilter(node) {
    if (!this.statusFilter) return true;
    const st = node && node.status ? node.status : 'unsolved';
    return this.statusFilter.has(st);
  }

  _renderBranchedEdge(edge, fromInfo, nodes, obstacles, scale, colour, lod, opacity) {
    const branchTargets = edge.branches.map((b) => resolveAnchor({
      fromNode: edge.fromNode,
      toNode: b.toNode,
      bindings: { from: edge.bindings.from, to: b.binding || { fixedPoint: [0.5, 0.5], mode: 'orbit' } },
      fromSide: edge.fromSide,
      toSide: b.toSide,
      toPoint: b.toPoint,
    }, 'to', nodes, fromInfo.point));
    if (!edge.junction) {
      edge.junction = defaultJunction(fromInfo.point, branchTargets.map((b) => b.point));
    }
    const junction = edge.junction;
    const trunkVerts = routeEdge(edge.routing, fromInfo.point, junction, {
      fromSide: fromInfo.side,
      toSide: null,
      obstacles: this._obstaclesExcluding(obstacles, [fromInfo.rect]),
    });
    const trunkPath = vertexPathD(trunkVerts, edge.routing);
    this._appendEdgePath(edge, trunkPath, colour, scale, trunkVerts, { isTrunk: true, opacity });

    for (let i = 0; i < edge.branches.length; i++) {
      const b = edge.branches[i];
      const target = branchTargets[i];
      const verts = routeEdge(edge.routing, junction, target.point, {
        fromSide: null,
        toSide: target.side,
        obstacles: this._obstaclesExcluding(obstacles, [target.rect]),
      });
      const d = vertexPathD(verts, edge.routing);
      this._appendBranchPath(edge, i, d, b.color || colour, scale, verts, opacity);
      if (lod && lod.edgeLabelsVisible) {
        this._appendBranchLabel(b.label, verts, scale, opacity, { edgeId: edge.id, branchIndex: i });
      }
    }

    if (this.mode === 'editor' && (!lod || lod.handlesVisible)) {
      renderJunctionHandle(this.handlesGroup, edge, junction, scale, (ev, edgeId) => {
        this.dragState = {
          kind: 'drag-junction',
          edgeId,
          start: { ...junction },
          startCursor: this._imgPointFromClient(ev.clientX, ev.clientY),
        };
      });
    }
  }

  _appendEdgePath(edge, d, colour, scale, vertices, opts) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    const stroke = strokeFor(edge, colour);
    path.style.stroke = stroke.colour;
    path.setAttribute('stroke-linecap',  'round');
    path.setAttribute('stroke-linejoin', 'round');
    const selectedBoost = this.selectedId === edge.id ? 1.0 : 0;
    const baseWidth = stroke.width + selectedBoost;
    path.setAttribute('stroke-width', String(baseWidth / scale));
    const dash = dashFor(edge.style, scale);
    if (dash) path.setAttribute('stroke-dasharray', dash);
    if (!opts || !opts.isTrunk) {
      path.setAttribute('marker-end', this._markerEndUrlFor(edge, colour));
    }
    if (opts && Number.isFinite(opts.opacity) && opts.opacity < 1) {
      path.setAttribute('opacity', String(opts.opacity));
    }
    path.setAttribute('data-id', edge.id);
    path.style.cursor = this.mode === 'editor' ? 'pointer' : 'default';
    if (this.mode === 'editor') path.classList.add('arrow-path-interactive');
    if (this.selectedId === edge.id) {
      path.classList.add('arrow-selected-glow');
    }
    if (this.mode === 'editor') {
      path.addEventListener('mousedown', (ev) => {
        if (ev.button !== 0) return;
        ev.stopPropagation();
        this._selectEdge(edge.id, ev);
      });
    }
    this.edgesGroup.appendChild(path);
    if (this.mode === 'editor' && this.selectedId === edge.id) {
      renderWaypointHandles(
        this.handlesGroup,
        edge,
        vertices,
        scale,
        (ev, edgeId, idx) => this._beginWaypointDrag(ev, edgeId, idx),
        (ev, edgeId, idx) => this._waypointContext(ev, edgeId, idx),
      );
      const aPt = vertices[0];
      const bPt = vertices[vertices.length - 1];
      renderEndpointHandle(this.handlesGroup, edge, 'from', aPt, scale, (ev, edgeId, which) => this._beginEndpointDrag(ev, edgeId, which));
      renderEndpointHandle(this.handlesGroup, edge, 'to',   bPt, scale, (ev, edgeId, which) => this._beginEndpointDrag(ev, edgeId, which));
    }
  }

  _appendBranchPath(edge, branchIdx, d, colour, scale, vertices, opacity) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    const stroke = strokeFor(edge, colour);
    path.style.stroke = stroke.colour;
    path.setAttribute('stroke-width', String((stroke.width * 0.9) / scale));
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('marker-end', this._markerEndUrlFor(edge, colour));
    const dash = dashFor(edge.style, scale);
    if (dash) path.setAttribute('stroke-dasharray', dash);
    if (Number.isFinite(opacity) && opacity < 1) path.setAttribute('opacity', String(opacity));
    path.setAttribute('data-id', edge.id);
    path.setAttribute('data-branch', String(branchIdx));
    path.style.cursor = this.mode === 'editor' ? 'pointer' : 'default';
    if (this.mode === 'editor') path.classList.add('arrow-path-interactive');
    if (this.mode === 'editor') {
      path.addEventListener('mousedown', (ev) => {
        if (ev.button !== 0) return;
        ev.stopPropagation();
        this._selectEdge(edge.id, ev);
      });
    }
    this.edgesGroup.appendChild(path);
    void vertices;
  }

  _appendEdgeLabel(edge, vertices, scale, opacity) {
    const shape = ensureLabelShape(edge.label);
    if (!shape.text) return;
    const auto = pointAlong(vertices, 0.5, edge.routing);
    const anchor = shape.position ? shape.position : auto;
    this._drawLabel(shape, anchor, auto, scale, opacity, {
      kind: 'edge', edgeId: edge.id, branchIndex: null, autoAt: auto,
      free: !!shape.position,
    });
  }

  _appendBranchLabel(label, vertices, scale, opacity, ctx) {
    const shape = ensureLabelShape(label);
    if (!shape.text) return;
    const auto = pointAlong(vertices, 0.5, null);
    const anchor = shape.position ? shape.position : auto;
    this._drawLabel(shape, anchor, auto, scale, opacity, {
      kind: 'branch', edgeId: ctx && ctx.edgeId, branchIndex: ctx && ctx.branchIndex,
      autoAt: auto, free: !!shape.position,
    });
  }

  _drawLabel(shape, anchor, autoAt, scale, opacity, refs) {
    const text = shape.text;
    const customFontSize = Number.isFinite(shape.fontSize) ? shape.fontSize : 14;
    const rotation = Number.isFinite(shape.rotation) ? shape.rotation : 0;
    const customColor = typeof shape.color === 'string' && shape.color ? shape.color : 'auto';
    const padX = 5;
    const padY = 2;
    const fontPx = customFontSize / scale;
    const approxW = text.length * fontPx * 0.55 + padX * 2;
    const approxH = fontPx + padY * 2;
    const labelOpacity = Number.isFinite(opacity) ? opacity : 1;
    const isFree = refs && refs.free;
    if (isFree && autoAt && (autoAt.x !== anchor.x || autoAt.y !== anchor.y)) {
      const tether = document.createElementNS(SVG_NS, 'line');
      tether.setAttribute('x1', String(autoAt.x));
      tether.setAttribute('y1', String(autoAt.y));
      tether.setAttribute('x2', String(anchor.x));
      tether.setAttribute('y2', String(anchor.y));
      tether.setAttribute('stroke', 'var(--label-stroke)');
      tether.setAttribute('stroke-width', String(1 / scale));
      tether.setAttribute('stroke-dasharray', `${4 / scale} ${3 / scale}`);
      tether.setAttribute('opacity', String(Math.min(0.5, labelOpacity)));
      tether.setAttribute('pointer-events', 'none');
      this.edgesGroup.appendChild(tether);
    }
    const labelGroup = document.createElementNS(SVG_NS, 'g');
    if (rotation) {
      labelGroup.setAttribute('transform', `rotate(${rotation} ${anchor.x} ${anchor.y})`);
    }
    const bg = document.createElementNS(SVG_NS, 'rect');
    bg.setAttribute('x', String(anchor.x - approxW / 2));
    bg.setAttribute('y', String(anchor.y - approxH / 2));
    bg.setAttribute('width',  String(approxW));
    bg.setAttribute('height', String(approxH));
    bg.setAttribute('rx', String(3 / scale));
    bg.setAttribute('class', 'arrow-label-bg');
    bg.setAttribute('fill',   'var(--label-bg)');
    bg.setAttribute('stroke', 'var(--label-stroke)');
    bg.setAttribute('stroke-width', String(1 / scale));
    if (labelOpacity < 1) bg.setAttribute('opacity', String(labelOpacity));
    if (this.mode === 'editor' && refs) {
      bg.setAttribute('data-label-edge', refs.edgeId || '');
      if (refs.branchIndex !== null && refs.branchIndex !== undefined) {
        bg.setAttribute('data-label-branch', String(refs.branchIndex));
      }
      bg.style.cursor = 'move';
      bg.addEventListener('mousedown', (ev) => this._beginLabelDrag(ev, refs));
      bg.addEventListener('contextmenu', (ev) => this._onLabelContext(ev, refs));
    } else {
      bg.setAttribute('pointer-events', 'none');
    }
    labelGroup.appendChild(bg);
    const textEl = document.createElementNS(SVG_NS, 'text');
    textEl.setAttribute('x', String(anchor.x));
    textEl.setAttribute('y', String(anchor.y));
    textEl.setAttribute('font-size', String(fontPx));
    textEl.setAttribute('font-family', 'var(--font-mono)');
    textEl.setAttribute('class', 'arrow-label-text');
    textEl.setAttribute('fill', customColor === 'auto' ? 'var(--label-text)' : customColor);
    textEl.setAttribute('text-anchor', 'middle');
    textEl.setAttribute('dominant-baseline', 'central');
    textEl.setAttribute('pointer-events', 'none');
    if (labelOpacity < 1) textEl.setAttribute('opacity', String(labelOpacity));
    textEl.textContent = text;
    labelGroup.appendChild(textEl);
    this.edgesGroup.appendChild(labelGroup);
  }

  _beginLabelDrag(ev, refs) {
    if (this.mode !== 'editor') return;
    if (ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    const e = this.edges.get(refs.edgeId);
    if (!e) return;
    let startPos;
    if (refs.kind === 'branch' && Number.isInteger(refs.branchIndex) && e.branches && e.branches[refs.branchIndex]) {
      startPos = ensureLabelShape(e.branches[refs.branchIndex].label).position || refs.autoAt || { x: 0, y: 0 };
    } else {
      startPos = ensureLabelShape(e.label).position || refs.autoAt || { x: 0, y: 0 };
    }
    this.dragState = {
      kind: 'drag-label',
      edgeId: refs.edgeId,
      branchIndex: refs.kind === 'branch' ? refs.branchIndex : null,
      start: { x: startPos.x, y: startPos.y },
      startCursor: this._imgPointFromClient(ev.clientX, ev.clientY),
    };
  }

  _onLabelContext(ev, refs) {
    if (this.mode !== 'editor') return;
    ev.preventDefault();
    ev.stopPropagation();
    const isBranch = refs.kind === 'branch' && Number.isInteger(refs.branchIndex);
    const e = this.edges.get(refs.edgeId);
    if (!e) return;
    const items = [
      {
        label: tr('arrow_label_reset_position'),
        fn: () => {
          if (isBranch) {
            this.applyEdgePatch(refs.edgeId, { branchLabel: { index: refs.branchIndex, position: null } });
          } else {
            this.applyEdgePatch(refs.edgeId, { labelPosition: null });
          }
        },
      },
    ];
    this.contextMenu.open(ev.clientX, ev.clientY, items);
  }

  _renderEditorOverlay(nodes, scale) {
    const targetId = this._hoverNodeId;
    if (targetId) {
      const n = nodes.get(targetId);
      if (n && isBlockNode(n)) {
        renderAnchorHandles(this.handlesGroup, n, scale, (ev, nodeId, side) => this._beginDrawEdge(ev, nodeId, side));
      }
    }
    if (this.hoverHandle && this.dragState) {
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('cx', String(this.hoverHandle.point.x));
      c.setAttribute('cy', String(this.hoverHandle.point.y));
      c.setAttribute('r',  String(8 / scale));
      c.setAttribute('class', 'arrow-snap-target');
      c.setAttribute('pointer-events', 'none');
      this.handlesGroup.appendChild(c);
    }
  }

  _renderDragPreview(scale, nodes) {
    const d = this.dragState;
    if (!d) return;
    if (d.kind === 'draw-edge') {
      const fromNode = nodes.get(d.fromNode);
      if (!fromNode) return;
      const aRect = rectOf(fromNode);
      const fromPt = { x: aRect.x + aRect.w * d.fromFixedPoint[0], y: aRect.y + aRect.h * d.fromFixedPoint[1] };
      const toPt = d.snapped ? d.snapped.point : d.cursorImg;
      this._renderPreviewLine(fromPt, toPt, scale, d.snapped);
    } else if (d.kind === 'rebind-endpoint') {
      const e = this.edges.get(d.edgeId);
      if (!e) return;
      const otherWhich = d.which === 'from' ? 'to' : 'from';
      const otherPt = resolveAnchor(e, otherWhich, nodes, null).point;
      const fromPt = otherPt;
      const toPt = d.snapped ? d.snapped.point : d.cursorImg;
      this._renderPreviewLine(fromPt, toPt, scale, d.snapped);
    } else if (d.kind === 'draw-branch') {
      const e = this.edges.get(d.edgeId);
      if (!e) return;
      const anchor = d.anchorImg || e.junction || resolveAnchor(e, 'from', nodes, null).point;
      const toPt = d.snapped ? d.snapped.point : d.cursorImg;
      this._renderPreviewLine(anchor, toPt, scale, d.snapped);
    }
  }

  _renderPreviewLine(a, b, scale, snapped) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', `M ${a.x} ${a.y} L ${b.x} ${b.y}`);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', snapped ? COLOUR_VAR.solved : COLOUR_VAR.accent);
    path.setAttribute('stroke-width', String(2.2 / scale));
    path.setAttribute('stroke-dasharray', `${6 / scale} ${4 / scale}`);
    path.setAttribute('pointer-events', 'none');
    this.previewGroup.appendChild(path);
  }

  _beginDrawEdge(ev, nodeId, side) {
    if (this.mode !== 'editor') return;
    const node = this.getNodes().get(nodeId);
    if (!node) return;
    const rect = rectOf(node);
    const fp = sideToFixedPoint(side);
    const cursorImg = this._imgPointFromClient(ev.clientX, ev.clientY);
    this.dragState = {
      kind: 'draw-edge',
      fromNode: nodeId,
      fromFixedPoint: fp,
      fromSide: side,
      cursorImg,
      snapped: null,
    };
    void rect;
    this.requestDraw();
  }

  _beginEndpointDrag(ev, edgeId, which) {
    if (this.mode !== 'editor') return;
    const e = this.edges.get(edgeId);
    if (!e) return;
    const cursorImg = this._imgPointFromClient(ev.clientX, ev.clientY);
    this.dragState = {
      kind: 'rebind-endpoint',
      edgeId,
      which,
      cursorImg,
      snapped: null,
    };
    this.requestDraw();
  }

  _beginWaypointDrag(ev, edgeId, idx) {
    if (this.mode !== 'editor') return;
    const e = this.edges.get(edgeId);
    if (!e || !Array.isArray(e.waypoints) || !e.waypoints[idx]) return;
    const cursorImg = this._imgPointFromClient(ev.clientX, ev.clientY);
    this.dragState = {
      kind: 'drag-waypoint',
      edgeId,
      idx,
      start: { ...e.waypoints[idx] },
      startCursor: cursorImg,
    };
  }

  _waypointContext(ev, edgeId, idx) {
    this.contextMenu.open(ev.clientX, ev.clientY, [
      { label: tr('waypoint_remove'), danger: true, fn: () => this._removeWaypoint(edgeId, idx) },
    ]);
  }

  _removeWaypoint(edgeId, idx) {
    const e = this.edges.get(edgeId);
    if (!e || !Array.isArray(e.waypoints)) return;
    e.waypoints.splice(idx, 1);
    if (!e.waypoints.length) delete e.waypoints;
    this.onEdgesChange();
    this.onScheduleSave();
    this.onEdgeMutation('update', edgeId, e);
    this.requestDraw();
  }

  _addWaypoint(edgeId, point) {
    const e = this.edges.get(edgeId);
    if (!e) return;
    if (!Array.isArray(e.waypoints)) e.waypoints = [];
    e.waypoints.push({ x: point.x, y: point.y });
    this.onEdgesChange();
    this.onScheduleSave();
    this.onEdgeMutation('update', edgeId, e);
    this.requestDraw();
  }

  _onMouseDown(ev) {
    if (this.mode !== 'editor') return;
    if (isSpaceHeld()) return;
    if (this.dragState && this.dragState.kind === 'draw-branch') {
      ev.preventDefault();
      ev.stopPropagation();
      const d = this.dragState;
      this.dragState = null;
      this._hideBranchHint();
      if (d.snapped) {
        this._addBranchFromDrag(d);
      } else {
        const e = this.edges.get(d.edgeId);
        if (e && !e.branches) delete e.junction;
      }
      this.requestDraw();
      return;
    }
    if (this.dragState) return;
    const tgt = ev.target;
    if (tgt && tgt.getAttribute) {
      if (tgt.getAttribute('data-id'))   return;
      if (tgt.getAttribute('data-block')) return;
      if (tgt.getAttribute('data-edge'))  return;
    }
    if (ev.target === this.svg || ev.target === this.world || ev.target === this.edgesGroup) {
      this._deselect();
    }
  }

  _onMouseMove(ev) {
    if (this.dragState) {
      const img = this._imgPointFromClient(ev.clientX, ev.clientY);
      if (this.dragState.kind === 'drag-waypoint') {
        const e = this.edges.get(this.dragState.edgeId);
        if (e && Array.isArray(e.waypoints) && e.waypoints[this.dragState.idx]) {
          const sc = this.dragState.startCursor;
          e.waypoints[this.dragState.idx] = {
            x: this.dragState.start.x + (img.x - sc.x),
            y: this.dragState.start.y + (img.y - sc.y),
          };
          this.requestDraw();
        }
        return;
      }
      if (this.dragState.kind === 'drag-junction') {
        const e = this.edges.get(this.dragState.edgeId);
        if (e) {
          const sc = this.dragState.startCursor;
          e.junction = {
            x: this.dragState.start.x + (img.x - sc.x),
            y: this.dragState.start.y + (img.y - sc.y),
          };
          this.requestDraw();
        }
        return;
      }
      if (this.dragState.kind === 'drag-label') {
        const e = this.edges.get(this.dragState.edgeId);
        if (e) {
          const sc = this.dragState.startCursor;
          const nextPos = {
            x: this.dragState.start.x + (img.x - sc.x),
            y: this.dragState.start.y + (img.y - sc.y),
          };
          const bIdx = this.dragState.branchIndex;
          if (Number.isInteger(bIdx) && Array.isArray(e.branches) && e.branches[bIdx]) {
            const cur = ensureLabelShape(e.branches[bIdx].label);
            e.branches[bIdx].label = { text: cur.text, position: nextPos };
          } else {
            const cur = ensureLabelShape(e.label);
            e.label = { text: cur.text, position: nextPos };
          }
          this.requestDraw();
        }
        return;
      }
      this.dragState.cursorImg = img;
      if (this.dragState.kind === 'draw-branch') {
        this.dragState.snapped = this._findSnapExcluding(img, this.dragState.excludeIds);
      } else {
        const ownerNodeId = this.dragState.kind === 'draw-edge' ? this.dragState.fromNode : null;
        this.dragState.snapped = this._findSnap(img, ownerNodeId);
      }
      this.requestDraw();
      return;
    }
    if (this.mode !== 'editor') return;
    const himg = this._imgPointFromClient(ev.clientX, ev.clientY);
    let newHoverId = null;
    if (himg) {
      for (const n of this.getNodes().values()) {
        if (!isBlockNode(n)) continue;
        const r = { x: n.x, y: n.y, w: n.width, h: n.height };
        if (himg.x >= r.x && himg.x <= r.x + r.w && himg.y >= r.y && himg.y <= r.y + r.h) {
          newHoverId = n.id;
          break;
        }
      }
    }
    if (newHoverId !== this._hoverNodeId) {
      this._hoverNodeId = newHoverId;
      this.requestDraw();
    }
    if (this.hoverHandle) {
      this.hoverHandle = null;
      this.requestDraw();
    }
    void ev;
  }

  _onMouseUp(ev) {
    if (!this.dragState) return;
    const d = this.dragState;
    this.dragState = null;
    if (d.kind === 'draw-edge') {
      if (d.snapped) {
        this._createEdgeFromDrag(d);
      }
    } else if (d.kind === 'rebind-endpoint') {
      const e = this.edges.get(d.edgeId);
      if (e) {
        if (d.snapped) {
          setEndpointToNode(e, d.which, d.snapped.nodeId, d.snapped.fixedPoint);
        } else {
          const img = this._imgPointFromClient(ev.clientX, ev.clientY);
          setEndpointDangling(e, d.which, img);
        }
        this._rebuildBoundIndex();
        this.onEdgesChange();
        this.onScheduleSave();
        this.onEdgeMutation('update', d.edgeId, e);
      }
    } else if (d.kind === 'drag-waypoint' || d.kind === 'drag-junction' || d.kind === 'drag-label') {
      this.onEdgesChange();
      this.onScheduleSave();
      const e = this.edges.get(d.edgeId);
      if (e) this.onEdgeMutation('update', d.edgeId, e);
    } else if (d.kind === 'draw-branch') {
      this._hideBranchHint();
      if (d.snapped) {
        this._addBranchFromDrag(d);
      } else {
        const e = this.edges.get(d.edgeId);
        if (e && !e.branches) delete e.junction;
      }
    }
    this.hoverHandle = null;
    this.requestDraw();
  }

  _createEdgeFromDrag(d) {
    const id = this._nextId();
    const fromFP = d.fromFixedPoint;
    const newEdge = {
      id,
      fromNode: d.fromNode,
      toNode:   d.snapped.nodeId,
      routing: 'orthogonal',
      style:   'solid',
      color:   'accent',
      label:   '',
      bindings: {
        from: { mode: 'orbit', fixedPoint: [fromFP[0], fromFP[1]] },
        to:   { mode: 'orbit', fixedPoint: [d.snapped.fixedPoint[0], d.snapped.fixedPoint[1]] },
      },
    };
    const fromSide = sideFromFixedPoint(fromFP);
    if (fromSide) newEdge.fromSide = fromSide;
    const toSide = sideFromFixedPoint(d.snapped.fixedPoint);
    if (toSide) newEdge.toSide = toSide;
    this.edges.set(id, newEdge);
    this._rebuildBoundIndex();
    this._selectEdge(id, null);
    this.onEdgesChange();
    this.onScheduleSave();
    this.onEdgeMutation('create', id, newEdge);
  }

  _addBranchFromDrag(d) {
    const e = this.edges.get(d.edgeId);
    if (!e) return;
    if (!Array.isArray(e.branches)) e.branches = [];
    if (e.branches.length === 0 && e.toNode) {
      e.branches.push({
        toNode: e.toNode,
        binding: e.bindings && e.bindings.to ? { ...e.bindings.to } : { mode: 'orbit', fixedPoint: [0.5, 0.5] },
        toSide: e.toSide,
        label: '',
        color: e.color || 'accent',
      });
    }
    e.branches.push({
      toNode: d.snapped.nodeId,
      binding: { mode: 'orbit', fixedPoint: [d.snapped.fixedPoint[0], d.snapped.fixedPoint[1]] },
      toSide: sideFromFixedPoint(d.snapped.fixedPoint) || undefined,
      label: '',
      color: e.color || 'accent',
    });
    this._rebuildBoundIndex();
    this.onEdgesChange();
    this.onScheduleSave();
    this.onEdgeMutation('update', d.edgeId, e);
    this._selectEdge(d.edgeId, null);
  }

  _onDoubleClick(ev) {
    if (this.mode !== 'editor') return;
    const tgt = ev.target;
    if (!tgt || !tgt.getAttribute) return;
    const id = tgt.getAttribute('data-id');
    if (!id) return;
    ev.preventDefault();
    ev.stopPropagation();
    const img = this._imgPointFromClient(ev.clientX, ev.clientY);
    this._addWaypoint(id, img);
  }

  _onContextMenu(ev) {
    if (this.mode !== 'editor') return;
    const tgt = ev.target;
    const id = tgt && tgt.getAttribute ? tgt.getAttribute('data-id') : null;
    if (!id) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (document.body && document.body.dataset && document.body.dataset.suppressContextMenu === '1') {
      return;
    }
    const img = this._imgPointFromClient(ev.clientX, ev.clientY);
    const branchAttr = tgt && tgt.getAttribute ? tgt.getAttribute('data-branch') : null;
    const items = [
      { label: tr('waypoint_add'),  fn: () => this._addWaypoint(id, img) },
      { label: tr('edge_add_branch'), fn: () => this.beginAddBranch(id) },
    ];
    if (branchAttr !== null && branchAttr !== '') {
      const branchIdx = parseInt(branchAttr, 10);
      if (Number.isInteger(branchIdx)) {
        items.push({ label: tr('edge_branch_remove'), danger: true, fn: () => this._removeBranch(id, branchIdx) });
      }
    }
    items.push({ label: tr('edge_delete'), danger: true, fn: () => this.deleteEdge(id) });
    this.contextMenu.open(ev.clientX, ev.clientY, items);
  }

  _removeBranch(edgeId, branchIdx) {
    const e = this.edges.get(edgeId);
    if (!e || !Array.isArray(e.branches)) return;
    if (branchIdx < 0 || branchIdx >= e.branches.length) return;
    e.branches.splice(branchIdx, 1);
    if (e.branches.length === 0) {
      delete e.branches;
      delete e.junction;
    }
    this._rebuildBoundIndex();
    this.onEdgesChange();
    this.onScheduleSave();
    this.onEdgeMutation('update', edgeId, e);
    this.requestDraw();
  }

  _findSnap(imgPt, ignoreNodeId) {
    const nodes = this.getNodes();
    const t = this.getTransform();
    const result = findSnapTarget(nodes, imgPt, t.scale);
    if (result && result.nodeId === ignoreNodeId) return null;
    return result;
  }

  _findSnapExcluding(imgPt, excludeIds) {
    const nodes = this.getNodes();
    const t = this.getTransform();
    const result = findSnapTarget(nodes, imgPt, t.scale);
    if (result && excludeIds && excludeIds.has(result.nodeId)) return null;
    return result;
  }

  _imgPointFromClient(cx, cy) {
    const t = this.getTransform();
    const r = this.viewport.getBoundingClientRect();
    return {
      x: (cx - r.left - t.panX) / t.scale,
      y: (cy - r.top  - t.panY) / t.scale,
    };
  }

  _nextId() {
    let n = this.edges.size + 1;
    while (this.edges.has(`arr_${String(n).padStart(3, '0')}`)) n += 1;
    return `arr_${String(n).padStart(3, '0')}`;
  }

  _selectEdge(id, ev) {
    this.selectedId = id;
    const e = this.edges.get(id);
    if (!e) return;
    const screenPt = ev
      ? { x: ev.clientX, y: ev.clientY }
      : this._popoverAnchorScreen(e);
    this.popover.show(e, screenPt);
    this.requestDraw();
  }

  _deselect() {
    if (this.selectedId == null) return;
    this.selectedId = null;
    this.popover.hide();
    this.requestDraw();
  }

  _popoverAnchorScreen(edge) {
    const t = this.getTransform();
    const r = this.viewport.getBoundingClientRect();
    const nodes = this.getNodes();
    const toAnchor = resolveAnchor(edge, 'to', nodes, null).point;
    const fromAnchor = resolveAnchor(edge, 'from', nodes, toAnchor).point;
    const mid = { x: (fromAnchor.x + toAnchor.x) / 2, y: (fromAnchor.y + toAnchor.y) / 2 };
    return { x: mid.x * t.scale + t.panX + r.left, y: mid.y * t.scale + t.panY + r.top };
  }
}

function sideToFixedPoint(side) {
  switch (side) {
    case 'left':   return [0, 0.5];
    case 'right':  return [1, 0.5];
    case 'top':    return [0.5, 0];
    case 'bottom': return [0.5, 1];
    default:       return [0.5, 0.5];
  }
}

function sideFromFixedPoint(fp) {
  if (!fp || fp.length !== 2) return null;
  const [u, v] = fp;
  if (u === 0) return 'left';
  if (u === 1) return 'right';
  if (v === 0) return 'top';
  if (v === 1) return 'bottom';
  return null;
}

export function edgeFromLegacyShape(a) {
  const fp = (s) => {
    switch (s) {
      case 'left':   return [0, 0.5];
      case 'right':  return [1, 0.5];
      case 'top':    return [0.5, 0];
      case 'bottom': return [0.5, 1];
      default:       return [0.5, 0.5];
    }
  };
  return {
    id: a.id,
    fromNode: (a.from && a.from.block_id) || '',
    toNode:   (a.to   && a.to.block_id)   || '',
    fromSide: a.from && a.from.side,
    toSide:   a.to   && a.to.side,
    routing: a.kind === 'bezier' ? 'smooth' : (a.kind || 'orthogonal'),
    style: a.style || 'solid',
    color: a.colour || 'accent',
    label: a.label || '',
    bindings: {
      from: { mode: 'orbit', fixedPoint: fp(a.from && a.from.side) },
      to:   { mode: 'orbit', fixedPoint: fp(a.to   && a.to.side)   },
    },
  };
}

