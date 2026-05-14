/* Top-level SVG arrow layer manager. Owns the edges Map (mirror of state),
   delegates routing to router.js, path strings to connector.js, and editor
   interactions to arrow-edit.js. Bidirectional bindings mean each node tracks
   a boundEdges Set so node drags can recompute only what they touched. */

import { tr } from './i18n.js';
import { isBlockNode } from './nodes.js';
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
    this.dragState = null;
    this.contextMenu = new EdgeContextMenu();
    this.popover = new EdgePropsPopover({ layer: this });
    this.statusFilter = null;
    this.fadeNonMatching = false;

    this._installRoot();
    this._installEvents();
  }

  _installRoot() {
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);
    this.defs = document.createElementNS(SVG_NS, 'defs');
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

  _installEvents() {
    this.svg.addEventListener('mousedown', (e) => this._onMouseDown(e));
    window.addEventListener('mousemove', (e) => this._onMouseMove(e));
    window.addEventListener('mouseup',   (e) => this._onMouseUp(e));
    this.svg.addEventListener('dblclick', (e) => this._onDoubleClick(e));
    this.svg.addEventListener('contextmenu', (e) => this._onContextMenu(e));
  }

  setEdges(edges) {
    this.edges = edges instanceof Map ? edges : new Map();
    for (const e of this.edges.values()) ensureBindings(e);
    this._rebuildBoundIndex();
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
    this.svg.style.pointerEvents = mode === 'editor' ? 'auto' : 'none';
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
    }
    this.boundEdges.delete(nodeId);
    this.requestDraw();
  }

  applyEdgePatch(id, patch, opts) {
    const e = this.edges.get(id);
    if (!e) return;
    if (patch.routing !== undefined) e.routing = isValidRouting(patch.routing) ? patch.routing : e.routing;
    if (patch.style   !== undefined) e.style   = isValidStyle(patch.style)   ? patch.style   : e.style;
    if (patch.color   !== undefined) e.color   = isValidColour(patch.color)  ? patch.color   : 'accent';
    if (patch.label   !== undefined) e.label   = String(patch.label);
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
    this.dragState = {
      kind: 'draw-branch',
      edgeId: id,
      cursorImg: { ...e.junction },
      snapped: null,
    };
    this.popover.hide();
    this.requestDraw();
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

    const vertices = routeEdge(edge.routing, fromInfo.point, toInfo.point, {
      fromSide: fromInfo.side,
      toSide:   toInfo.side,
      obstacles: this._obstaclesExcluding(obstacles, [fromInfo.rect, toInfo.rect]),
      waypoints: edge.waypoints,
    });
    const d = vertexPathD(vertices, edge.routing);
    this._appendEdgePath(edge, d, colour, scale, vertices, { opacity });
    if (lod && lod.edgeLabelsVisible) {
      this._appendEdgeLabel(edge, vertices, scale, opacity);
    }
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
      if (b.label && lod && lod.edgeLabelsVisible) this._appendBranchLabel(b.label, verts, scale, opacity);
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
    path.setAttribute('stroke', COLOUR_VAR[colour]);
    path.setAttribute('stroke-linecap',  'round');
    path.setAttribute('stroke-linejoin', 'round');
    const baseWidth = this.selectedId === edge.id ? 3.4 : 2.4;
    path.setAttribute('stroke-width', String(baseWidth / scale));
    const dash = dashFor(edge.style, scale);
    if (dash) path.setAttribute('stroke-dasharray', dash);
    if (!opts || !opts.isTrunk) {
      path.setAttribute('marker-end', `url(#arrowhead-${colour})`);
    }
    if (opts && Number.isFinite(opts.opacity) && opts.opacity < 1) {
      path.setAttribute('opacity', String(opts.opacity));
    }
    path.setAttribute('data-id', edge.id);
    path.style.cursor = this.mode === 'editor' ? 'pointer' : 'default';
    if (this.selectedId === edge.id) {
      path.setAttribute('filter', '');
      path.style.filter = 'drop-shadow(0 0 4px rgba(85,170,255,0.55))';
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
    path.setAttribute('stroke', COLOUR_VAR[colour] || COLOUR_VAR.accent);
    path.setAttribute('stroke-width', String(2.2 / scale));
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('marker-end', `url(#arrowhead-${COLOUR_VAR[colour] ? colour : 'accent'})`);
    const dash = dashFor(edge.style, scale);
    if (dash) path.setAttribute('stroke-dasharray', dash);
    if (Number.isFinite(opacity) && opacity < 1) path.setAttribute('opacity', String(opacity));
    path.setAttribute('data-id', edge.id);
    path.setAttribute('data-branch', String(branchIdx));
    path.style.cursor = this.mode === 'editor' ? 'pointer' : 'default';
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
    if (!edge.label) return;
    const mid = pointAlong(vertices, 0.5, edge.routing);
    this._drawLabel(edge.label, mid, scale, opacity);
  }

  _appendBranchLabel(label, vertices, scale, opacity) {
    if (!label) return;
    const mid = pointAlong(vertices, 0.5, null);
    this._drawLabel(label, mid, scale, opacity);
  }

  _drawLabel(label, mid, scale, opacity) {
    const padX = 5;
    const padY = 2;
    const fontPx = 12 / scale;
    const approxW = label.length * fontPx * 0.55 + padX * 2;
    const approxH = fontPx + padY * 2;
    const labelOpacity = Number.isFinite(opacity) ? opacity : 1;
    const bg = document.createElementNS(SVG_NS, 'rect');
    bg.setAttribute('x', String(mid.x - approxW / 2));
    bg.setAttribute('y', String(mid.y - approxH / 2));
    bg.setAttribute('width',  String(approxW));
    bg.setAttribute('height', String(approxH));
    bg.setAttribute('rx', String(3 / scale));
    bg.setAttribute('class', 'arrow-label-bg');
    bg.setAttribute('fill',   'rgba(10,10,14,0.86)');
    bg.setAttribute('stroke', 'rgba(232,107,46,0.45)');
    bg.setAttribute('stroke-width', String(1 / scale));
    bg.setAttribute('pointer-events', 'none');
    if (labelOpacity < 1) bg.setAttribute('opacity', String(labelOpacity));
    this.edgesGroup.appendChild(bg);
    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', String(mid.x));
    text.setAttribute('y', String(mid.y));
    text.setAttribute('font-size', String(fontPx));
    text.setAttribute('font-family', 'var(--font-mono)');
    text.setAttribute('class', 'arrow-label-text');
    text.setAttribute('fill', '#d4d4e8');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'central');
    text.setAttribute('pointer-events', 'none');
    if (labelOpacity < 1) text.setAttribute('opacity', String(labelOpacity));
    text.textContent = label;
    this.edgesGroup.appendChild(text);
  }

  _renderEditorOverlay(nodes, scale) {
    for (const n of nodes.values()) {
      if (!isBlockNode(n)) continue;
      renderAnchorHandles(this.handlesGroup, n, scale, (ev, nodeId, side) => this._beginDrawEdge(ev, nodeId, side));
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
      const junction = e.junction || resolveAnchor(e, 'from', nodes, null).point;
      const toPt = d.snapped ? d.snapped.point : d.cursorImg;
      this._renderPreviewLine(junction, toPt, scale, d.snapped);
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
      this.dragState.cursorImg = img;
      const ownerNodeId = this.dragState.kind === 'draw-edge' ? this.dragState.fromNode : null;
      this.dragState.snapped = this._findSnap(img, ownerNodeId);
      this.requestDraw();
      return;
    }
    if (this.mode !== 'editor') return;
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
    } else if (d.kind === 'drag-waypoint' || d.kind === 'drag-junction') {
      this.onEdgesChange();
      this.onScheduleSave();
      const e = this.edges.get(d.edgeId);
      if (e) this.onEdgeMutation('update', d.edgeId, e);
    } else if (d.kind === 'draw-branch') {
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
    const img = this._imgPointFromClient(ev.clientX, ev.clientY);
    this.contextMenu.open(ev.clientX, ev.clientY, [
      { label: tr('waypoint_add'),  fn: () => this._addWaypoint(id, img) },
      { label: tr('edge_add_branch'), fn: () => this.beginAddBranch(id) },
      { label: tr('edge_delete'), danger: true, fn: () => this.deleteEdge(id) },
    ]);
  }

  _findSnap(imgPt, ignoreNodeId) {
    const nodes = this.getNodes();
    const t = this.getTransform();
    const result = findSnapTarget(nodes, imgPt, t.scale);
    if (result && result.nodeId === ignoreNodeId) return null;
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

