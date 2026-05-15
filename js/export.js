/* Multi-format export of the investigation map. Pure functions, no DOM:
   buildExportModel() produces a normalised model from state + arrowLayer,
   then per-format renderers turn that model into Markdown / AI text /
   Cytoscape / Mermaid / DOT / GraphML / JSON Canvas / plaintext. */

import { serializeCanvas } from './data-loader.js';
import {
  isBlockNode,
  isStickyNode,
  isPuzzleNode,
  isTextNode,
  isGroupNode,
  isVideoNode,
  isAudioNode,
  isDocumentNode,
} from './nodes.js';

const STATUS_FILL_HEX = {
  'solved':   '#3de88a',
  'partial':  '#e8c83d',
  'unsolved': '#e83d3d',
  'no-data':  '#888888',
  'dead-end': '#444444',
};

const STATUS_TEXT_HEX = {
  'solved':   '#0a2c14',
  'partial':  '#332b06',
  'unsolved': '#fdecec',
  'no-data':  '#ffffff',
  'dead-end': '#ffffff',
};

const STATUS_STROKE_HEX = {
  'solved':   '#2a9c50',
  'partial':  '#a68f1e',
  'unsolved': '#a02828',
  'no-data':  '#555555',
  'dead-end': '#222222',
};

const STATUS_SORT_ORDER = { 'solved': 0, 'partial': 1, 'unsolved': 2, 'no-data': 3, 'dead-end': 4 };

const TEXTLIKE_MIME_RE = /^(text\/|application\/(json|xml|x-python|javascript)$|application\/x-sh$|text\/(html|plain|markdown|csv|xml|css|javascript|x-python|x-shellscript)$)/i;

const DEFAULT_MAX_BODY = 4000;
const DEFAULT_MAX_FETCH_BYTES = 50 * 1024;
const MERMAID_NODE_LIMIT = 200;

function kindOf(node) {
  if (!node) return 'unknown';
  if (isBlockNode(node)) return 'block';
  if (isStickyNode(node)) return 'sticky';
  if (isPuzzleNode(node)) return 'puzzle';
  if (isVideoNode(node)) return 'video';
  if (isAudioNode(node)) return 'audio';
  if (isDocumentNode(node)) return 'document';
  if (isGroupNode(node)) return 'group';
  if (isTextNode(node)) return 'text';
  if (node.type === 'file') return 'block';
  if (node.type === 'group') return 'group';
  if (node.type === 'link') return 'link';
  return node.kind || node.type || 'unknown';
}

function nodeLabel(node) {
  if (!node) return '';
  if (typeof node.label === 'string' && node.label.trim()) return node.label.trim();
  if (typeof node.name === 'string' && node.name.trim()) return node.name.trim();
  if (typeof node.text === 'string') {
    const heading = node.text.split('\n').find((line) => /^#{1,6}\s+/.test(line));
    if (heading) return heading.replace(/^#{1,6}\s+/, '').trim();
    const firstLine = node.text.split('\n').find((line) => line.trim().length);
    if (firstLine) return firstLine.trim().slice(0, 80);
  }
  if (typeof node.slug === 'string' && node.slug.trim()) return node.slug.trim();
  if (typeof node.id === 'string') return node.id;
  return '';
}

function nodeBody(node, maxLen) {
  if (!node) return '';
  let body = '';
  if (typeof node.text === 'string' && node.text) body = node.text;
  if (!body && typeof node.label === 'string' && node.label && node.type === 'group') body = node.label;
  if (!body) return '';
  if (maxLen && body.length > maxLen) {
    return `${body.slice(0, maxLen)}\n\n...[truncated ${body.length - maxLen} chars]`;
  }
  return body;
}

function asLabelText(label) {
  if (label == null) return '';
  if (typeof label === 'string') return label;
  if (typeof label === 'object' && typeof label.text === 'string') return label.text;
  return '';
}

function edgeLabelToString(edge) {
  return asLabelText(edge && edge.label);
}

function depthOfGroup(nodes, id, seen) {
  const node = nodes.get(id);
  if (!node) return 0;
  if (!node.parent) return 0;
  if (seen && seen.has(id)) return 0;
  const next = new Set(seen || []);
  next.add(id);
  return 1 + depthOfGroup(nodes, node.parent, next);
}

function passesFilters(node, opts) {
  if (!node) return false;
  if (opts.filterBranches && opts.filterBranches.length) {
    const set = new Set(opts.filterBranches);
    const have = Array.isArray(node.branches) ? node.branches : [];
    let hit = false;
    for (const b of have) if (set.has(b)) { hit = true; break; }
    if (!hit) return false;
  }
  if (opts.filterStatuses && opts.filterStatuses.length) {
    const set = new Set(opts.filterStatuses);
    if (!set.has(node.status || 'unsolved')) return false;
  }
  if (opts.includeLockedOnly && !node.locked) return false;
  if (opts.includeUnlockedOnly && node.locked) return false;
  return true;
}

function edgePassesFilters(edge, allowedNodeIds) {
  if (!edge) return false;
  if (!allowedNodeIds) return true;
  return allowedNodeIds.has(edge.fromNode) && allowedNodeIds.has(edge.toNode);
}

function branchTargetsForEdge(edge) {
  if (!edge || !Array.isArray(edge.branches)) return [];
  return edge.branches.map((b) => b && b.toNode).filter((t) => typeof t === 'string' && t);
}

function fileUrlForNode(node) {
  if (!node) return null;
  if (typeof node.file === 'string' && node.file) return node.file;
  if (node.media && typeof node.media === 'object') {
    if (typeof node.media.url === 'string' && node.media.url) return node.media.url;
    if (typeof node.media.embedUrl === 'string' && node.media.embedUrl) return node.media.embedUrl;
  }
  if (typeof node.url === 'string' && node.url) return node.url;
  return null;
}

export function buildExportModel(state, arrowLayer, opts) {
  const options = opts || {};
  const maxBodyLength = Number.isFinite(options.maxBodyLength) ? options.maxBodyLength : DEFAULT_MAX_BODY;
  const nodesMap = state && state.nodes instanceof Map ? state.nodes : new Map();
  const branches = Array.isArray(state && state.branches) ? state.branches : [];
  const edgePairs = arrowLayer && typeof arrowLayer.serializeEdges === 'function'
    ? arrowLayer.serializeEdges()
    : [];

  const allowedNodeIds = new Set();
  const allowedNodes = [];
  for (const node of nodesMap.values()) {
    if (passesFilters(node, options)) {
      allowedNodeIds.add(node.id);
      allowedNodes.push(node);
    }
  }

  const allowedEdges = [];
  for (const [id, edge] of edgePairs) {
    if (!id || !edge) continue;
    if (!edgePassesFilters(edge, allowedNodeIds)) continue;
    allowedEdges.push([id, edge]);
  }

  const incomingByNode = new Map();
  const outgoingByNode = new Map();
  for (const [id, edge] of allowedEdges) {
    const labelText = edgeLabelToString(edge);
    if (allowedNodeIds.has(edge.fromNode)) {
      if (!outgoingByNode.has(edge.fromNode)) outgoingByNode.set(edge.fromNode, []);
      outgoingByNode.get(edge.fromNode).push({ edgeId: id, toId: edge.toNode, label: labelText });
    }
    if (allowedNodeIds.has(edge.toNode)) {
      if (!incomingByNode.has(edge.toNode)) incomingByNode.set(edge.toNode, []);
      incomingByNode.get(edge.toNode).push({ edgeId: id, fromId: edge.fromNode, label: labelText });
    }
    for (const target of branchTargetsForEdge(edge)) {
      if (!allowedNodeIds.has(target)) continue;
      if (!incomingByNode.has(target)) incomingByNode.set(target, []);
      incomingByNode.get(target).push({ edgeId: id, fromId: edge.fromNode, label: labelText, viaBranch: true });
    }
  }

  const groupsMap = new Map();
  for (const node of allowedNodes) {
    if (!isGroupNode(node)) continue;
    groupsMap.set(node.id, {
      id: node.id,
      label: nodeLabel(node) || node.id,
      childIds: [],
      depth: depthOfGroup(nodesMap, node.id),
    });
  }
  for (const node of allowedNodes) {
    if (node.parent && groupsMap.has(node.parent)) {
      groupsMap.get(node.parent).childIds.push(node.id);
    }
  }
  const groups = Array.from(groupsMap.values()).sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    return (a.label || '').localeCompare(b.label || '');
  });

  const branchNodeCount = new Map();
  for (const node of allowedNodes) {
    if (!Array.isArray(node.branches)) continue;
    for (const b of node.branches) branchNodeCount.set(b, (branchNodeCount.get(b) || 0) + 1);
  }
  const nodeBranchSets = new Map();
  for (const node of allowedNodes) {
    nodeBranchSets.set(node.id, new Set(Array.isArray(node.branches) ? node.branches : []));
  }
  const branchEdgeCount = new Map();
  for (const [, edge] of allowedEdges) {
    const fromBranches = nodeBranchSets.get(edge.fromNode);
    const toBranches = nodeBranchSets.get(edge.toNode);
    if (!fromBranches || !toBranches) continue;
    for (const b of fromBranches) {
      if (toBranches.has(b)) branchEdgeCount.set(b, (branchEdgeCount.get(b) || 0) + 1);
    }
  }
  const branchSummaries = branches.map((b) => ({
    id: b.id,
    label: b.label || b.id,
    color: b.color || '',
    description: b.description || '',
    nodeCount: branchNodeCount.get(b.id) || 0,
    edgeCount: branchEdgeCount.get(b.id) || 0,
  }));

  const exportNodes = allowedNodes.map((node) => {
    const id = node.id;
    return {
      id,
      kind: kindOf(node),
      type: node.type || null,
      mime: node.mime || null,
      label: nodeLabel(node),
      slug: typeof node.slug === 'string' ? node.slug : null,
      status: node.status || null,
      tags: Array.isArray(node.tags) ? [...node.tags] : [],
      branches: Array.isArray(node.branches) ? [...node.branches] : [],
      rect: { x: node.x || 0, y: node.y || 0, w: node.width || 0, h: node.height || 0 },
      body: nodeBody(node, maxBodyLength),
      file: fileUrlForNode(node),
      fileContent: null,
      caption: node.caption ? { ...node.caption } : null,
      color: node.color || '',
      locked: !!node.locked,
      parent: node.parent || null,
      incoming: incomingByNode.get(id) || [],
      outgoing: outgoingByNode.get(id) || [],
    };
  });

  const exportEdges = allowedEdges.map(([id, edge]) => {
    const stroke = edge.stroke && typeof edge.stroke === 'object'
      ? { width: edge.stroke.width || 2, color: edge.stroke.color || 'auto' }
      : { width: 2, color: 'auto' };
    const fromBranches = nodeBranchSets.get(edge.fromNode) || new Set();
    const toBranches = nodeBranchSets.get(edge.toNode) || new Set();
    const sharedBranches = [];
    for (const b of fromBranches) if (toBranches.has(b)) sharedBranches.push(b);
    return {
      id,
      fromId: edge.fromNode,
      toId: edge.toNode,
      label: edgeLabelToString(edge),
      style: edge.style || 'solid',
      routing: edge.routing || 'orthogonal',
      color: edge.color || 'accent',
      stroke,
      waypoints: Array.isArray(edge.waypoints) ? edge.waypoints.map((p) => ({ x: p.x, y: p.y })) : [],
      branches: sharedBranches,
      junction: edge.junction ? { x: edge.junction.x, y: edge.junction.y } : null,
      isBranched: Array.isArray(edge.branches) && edge.branches.length > 0,
      branchTargets: branchTargetsForEdge(edge),
    };
  });

  const meta = {
    exportedAt: new Date().toISOString(),
    canvasId: (state && state.canvasId) || 'main',
    nodeCount: exportNodes.length,
    edgeCount: exportEdges.length,
    branchCount: branchSummaries.length,
  };

  return {
    meta,
    branches: branchSummaries,
    groups,
    nodes: exportNodes,
    edges: exportEdges,
  };
}

export async function enrichWithFileContent(model, opts) {
  const options = opts || {};
  const maxBytes = Number.isFinite(options.maxFetchBytes) ? options.maxFetchBytes : DEFAULT_MAX_FETCH_BYTES;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const candidates = model.nodes.filter((n) => n.file && shouldFetchForNode(n));
  let done = 0;
  for (const node of candidates) {
    try {
      const content = await fetchTextCapped(node.file, maxBytes);
      node.fileContent = content;
    } catch (e) {
      node.fileContent = `[fetch failed: ${e && e.message ? e.message : 'unknown'}]`;
    }
    done += 1;
    if (onProgress) onProgress({ done, total: candidates.length, current: node.id });
  }
  return model;
}

function shouldFetchForNode(node) {
  if (!node || !node.file) return false;
  if (typeof node.mime === 'string' && TEXTLIKE_MIME_RE.test(node.mime)) return true;
  if (node.kind === 'document' || node.kind === 'text') return true;
  if (typeof node.file === 'string' && /\.(html?|json|md|markdown|txt|csv|xml|js|py|sh|css)$/i.test(node.file)) return true;
  return false;
}

async function fetchTextCapped(url, maxBytes) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const reader = res.body && typeof res.body.getReader === 'function' ? res.body.getReader() : null;
  if (!reader) {
    const text = await res.text();
    if (text.length > maxBytes) return `${text.slice(0, maxBytes)}\n\n...[truncated]`;
    return text;
  }
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
      if (total >= maxBytes) break;
    }
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
  const trimmed = total > maxBytes ? buf.subarray(0, maxBytes) : buf;
  const text = new TextDecoder('utf-8', { fatal: false }).decode(trimmed);
  if (total >= maxBytes) return `${text}\n\n...[truncated]`;
  return text;
}

function escapeMarkdown(text) {
  if (!text) return '';
  return String(text).replace(/([\\`*_{}\[\]<>|])/g, '\\$1');
}

function blockquote(text) {
  if (!text) return '';
  return text.split('\n').map((line) => `> ${line}`).join('\n');
}

function groupByStatus(nodes) {
  const out = new Map();
  for (const n of nodes) {
    const status = n.status || 'no-data';
    if (!out.has(status)) out.set(status, []);
    out.get(status).push(n);
  }
  return out;
}

function sortNodesForDigest(nodes) {
  return [...nodes].sort((a, b) => {
    const sa = STATUS_SORT_ORDER[a.status || 'no-data'] !== undefined ? STATUS_SORT_ORDER[a.status || 'no-data'] : 99;
    const sb = STATUS_SORT_ORDER[b.status || 'no-data'] !== undefined ? STATUS_SORT_ORDER[b.status || 'no-data'] : 99;
    if (sa !== sb) return sa - sb;
    return (a.label || a.id).localeCompare(b.label || b.id);
  });
}

export function exportAsMarkdownDigest(model, opts) {
  const options = opts || {};
  const lines = [];
  lines.push('# INSIDE ARG Investigation Map');
  lines.push('');
  lines.push(`_Exported ${model.meta.exportedAt}. ${model.meta.nodeCount} nodes, ${model.meta.edgeCount} edges, ${model.meta.branchCount} branches._`);
  lines.push('');

  if (model.branches.length) {
    lines.push('## Branches');
    lines.push('');
    for (const b of model.branches) {
      const parts = [`**${escapeMarkdown(b.label)}**`, `_${b.nodeCount} nodes, ${b.edgeCount} edges._`];
      if (b.description) parts.push(escapeMarkdown(b.description));
      lines.push(`- ${parts.join(' - ')}`);
    }
    lines.push('');
  }

  if (model.groups.length) {
    lines.push('## Groups (parent-child relationships)');
    lines.push('');
    for (const g of model.groups) {
      const indent = '  '.repeat(g.depth);
      lines.push(`${indent}- ${escapeMarkdown(g.label)} (\`${g.id}\`, ${g.childIds.length} children)`);
      for (const cid of g.childIds.slice(0, 20)) {
        lines.push(`${indent}  - \`${cid}\``);
      }
      if (g.childIds.length > 20) {
        lines.push(`${indent}  - _...and ${g.childIds.length - 20} more_`);
      }
    }
    lines.push('');
  }

  lines.push('## Nodes');
  lines.push('');
  const byBranchSections = !options.flatNodes && model.branches.length > 0;
  if (byBranchSections) {
    const nodesByBranch = new Map();
    const orphan = [];
    for (const n of model.nodes) {
      if (!n.branches.length) { orphan.push(n); continue; }
      for (const b of n.branches) {
        if (!nodesByBranch.has(b)) nodesByBranch.set(b, []);
        nodesByBranch.get(b).push(n);
      }
    }
    for (const b of model.branches) {
      const arr = nodesByBranch.get(b.id);
      if (!arr || !arr.length) continue;
      lines.push(`### Branch: ${escapeMarkdown(b.label)}`);
      lines.push('');
      for (const n of sortNodesForDigest(arr)) appendNodeMarkdown(lines, n);
    }
    if (orphan.length) {
      lines.push('### Branch: (unassigned)');
      lines.push('');
      for (const n of sortNodesForDigest(orphan)) appendNodeMarkdown(lines, n);
    }
  } else {
    for (const n of sortNodesForDigest(model.nodes)) appendNodeMarkdown(lines, n);
  }

  if (model.edges.length) {
    lines.push('## Edges');
    lines.push('');
    for (const e of model.edges) {
      lines.push(`### \`${e.id}\` ${e.fromId} -> ${e.toId}`);
      lines.push(`- **Label:** ${e.label ? `"${escapeMarkdown(e.label)}"` : '_none_'}`);
      lines.push(`- **Style:** ${e.style} arrow, ${e.routing} routing`);
      lines.push(`- **Color:** ${escapeMarkdown(e.color)}`);
      lines.push(`- **Stroke:** ${e.stroke.width}px (${escapeMarkdown(e.stroke.color)})`);
      lines.push(`- **Branches:** ${e.branches.length ? e.branches.map(escapeMarkdown).join(', ') : '-'}`);
      lines.push(`- **Waypoints:** ${e.waypoints.length ? e.waypoints.map((p) => `(${p.x},${p.y})`).join(', ') : '-'}`);
      if (e.isBranched && e.branchTargets.length) {
        lines.push(`- **Branch targets:** ${e.branchTargets.map((t) => `\`${t}\``).join(', ')}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

function appendNodeMarkdown(lines, n) {
  const title = n.label || n.id;
  lines.push(`### ${escapeMarkdown(title)} (\`${n.id}\`)`);
  lines.push(`- **Kind:** ${escapeMarkdown(n.kind)}${n.type ? ` (${escapeMarkdown(n.type)})` : ''}`);
  if (n.status) lines.push(`- **Status:** ${escapeMarkdown(n.status)}`);
  if (n.tags.length) lines.push(`- **Tags:** ${n.tags.map(escapeMarkdown).join(', ')}`);
  if (n.branches.length) lines.push(`- **Branches:** ${n.branches.map(escapeMarkdown).join(', ')}`);
  lines.push(`- **Position:** (${n.rect.x}, ${n.rect.y}) ${n.rect.w}x${n.rect.h}`);
  if (n.locked) lines.push('- **Locked:** yes');
  if (n.parent) lines.push(`- **Parent group:** \`${n.parent}\``);
  if (n.file) {
    const mime = n.mime ? ` (${escapeMarkdown(n.mime)})` : '';
    lines.push(`- **File:** [${escapeMarkdown(n.file)}](${n.file})${mime}`);
  }
  if (n.caption && n.caption.text) {
    const side = n.caption.side ? ` _(${escapeMarkdown(n.caption.side)})_` : '';
    lines.push(`- **Caption:** "${escapeMarkdown(n.caption.text)}"${side}`);
  }
  if (n.body) {
    lines.push('- **Body:**');
    lines.push('');
    lines.push(blockquote(n.body));
  }
  if (n.fileContent) {
    lines.push('- **File content:**');
    lines.push('');
    lines.push('```');
    lines.push(n.fileContent);
    lines.push('```');
  }
  if (n.incoming.length) {
    lines.push('');
    lines.push('#### Incoming');
    for (const e of n.incoming) {
      const lbl = e.label ? ` "${escapeMarkdown(e.label)}"` : '';
      const via = e.viaBranch ? ' _(branch)_' : '';
      lines.push(`- <- \`${e.fromId}\`${lbl} via \`${e.edgeId}\`${via}`);
    }
  }
  if (n.outgoing.length) {
    lines.push('');
    lines.push('#### Outgoing');
    for (const e of n.outgoing) {
      const lbl = e.label ? ` "${escapeMarkdown(e.label)}"` : '';
      lines.push(`- -> \`${e.toId}\`${lbl} via \`${e.edgeId}\``);
    }
  }
  lines.push('');
  lines.push('---');
  lines.push('');
}

export function exportAsAiText(model, opts) {
  void opts;
  const lines = [];
  lines.push('INSIDE ARG Investigation Map - AI Context Export');
  lines.push(`Generated at ${model.meta.exportedAt}. The map has ${model.meta.nodeCount} nodes and ${model.meta.edgeCount} edges grouped into ${model.meta.branchCount} branches.`);
  lines.push('');

  if (model.branches.length) {
    lines.push('== BRANCHES ==');
    lines.push('');
    const nodesByBranch = new Map();
    const edgesByBranch = new Map();
    for (const n of model.nodes) for (const b of n.branches) {
      if (!nodesByBranch.has(b)) nodesByBranch.set(b, []);
      nodesByBranch.get(b).push(n.id);
    }
    for (const e of model.edges) for (const b of e.branches) {
      if (!edgesByBranch.has(b)) edgesByBranch.set(b, []);
      edgesByBranch.get(b).push(e.id);
    }
    for (const b of model.branches) {
      lines.push(`[branch:${b.label}]`);
      if (b.description) lines.push(`Description: ${b.description}`);
      const nodeList = nodesByBranch.get(b.id) || [];
      const edgeList = edgesByBranch.get(b.id) || [];
      lines.push(`Nodes in this branch (${nodeList.length}): ${nodeList.join(', ') || 'none'}`);
      lines.push(`Edges in this branch (${edgeList.length}): ${edgeList.join(', ') || 'none'}`);
      lines.push('');
    }
  }

  lines.push('== NODES ==');
  lines.push('');
  for (const n of model.nodes) {
    lines.push(`[node:${n.id}]`);
    const typeParts = [];
    typeParts.push(`Type: ${n.kind}${n.type && n.type !== n.kind ? ` (${n.type})` : ''}.`);
    if (n.status) typeParts.push(`Status: ${n.status}.`);
    if (n.tags.length) typeParts.push(`Tags: ${n.tags.join(', ')}.`);
    if (n.locked) typeParts.push('This node is locked.');
    lines.push(typeParts.join(' '));
    const desc = n.label ? `"${n.label}"` : 'unnamed';
    lines.push(`This node represents ${desc}. It sits at canvas position (${n.rect.x}, ${n.rect.y}) with dimensions ${n.rect.w}x${n.rect.h}.`);
    if (n.file) {
      const mime = n.mime ? ` (mime: ${n.mime})` : '';
      lines.push(`File: ${n.file}${mime}.`);
    }
    if (n.body) {
      lines.push('Body text:');
      lines.push('"""');
      lines.push(n.body);
      lines.push('"""');
    }
    if (n.fileContent) {
      lines.push('Embedded file content:');
      lines.push('"""');
      lines.push(n.fileContent);
      lines.push('"""');
    }
    if (n.caption && n.caption.text) {
      const side = n.caption.side ? ` (placed on ${n.caption.side} side)` : '';
      lines.push(`Caption${side}: "${n.caption.text}"`);
    }
    if (n.branches.length) lines.push(`Belongs to branches: ${n.branches.join(', ')}.`);
    const totalLinks = n.incoming.length + n.outgoing.length;
    lines.push(`Connected to: ${totalLinks} edge endpoints.`);
    for (const e of n.outgoing) {
      const lbl = e.label ? ` (label: "${e.label}")` : '';
      lines.push(`  - References ${e.toId} via arrow ${e.edgeId}${lbl}.`);
    }
    for (const e of n.incoming) {
      const lbl = e.label ? ` (label: "${e.label}")` : '';
      const via = e.viaBranch ? ' as a branched target' : '';
      lines.push(`  - Referenced by ${e.fromId}${via} via arrow ${e.edgeId}${lbl}.`);
    }
    if (n.parent) lines.push(`  - Group parent: ${n.parent}.`);
    lines.push('');
  }

  lines.push('== EDGES INDEX ==');
  lines.push('');
  for (const e of model.edges) {
    const lbl = e.label ? ` (label: "${e.label}")` : '';
    const branchPart = e.branches.length ? ` Tagged with branches: ${e.branches.join(', ')}.` : '';
    const branchTargets = e.branchTargets.length ? ` Additional branch targets: ${e.branchTargets.join(', ')}.` : '';
    lines.push(`[edge:${e.id}] ${e.fromId} -> ${e.toId}${lbl}. Style: ${e.style}, routing: ${e.routing}, color: ${e.color}, stroke ${e.stroke.width}px (${e.stroke.color}).${branchPart}${branchTargets}`);
  }

  return lines.join('\n');
}

export function exportAsCytoscapeJson(model, opts) {
  void opts;
  const elements = { nodes: [], edges: [] };
  for (const n of model.nodes) {
    elements.nodes.push({
      data: {
        id: n.id,
        label: n.label || n.id,
        kind: n.kind,
        type: n.type,
        status: n.status || 'no-data',
        tags: n.tags,
        branches: n.branches,
        file: n.file || null,
        mime: n.mime || null,
        locked: n.locked,
        parent: n.parent || undefined,
      },
      position: { x: n.rect.x + n.rect.w / 2, y: n.rect.y + n.rect.h / 2 },
    });
  }
  for (const e of model.edges) {
    elements.edges.push({
      data: {
        id: e.id,
        source: e.fromId,
        target: e.toId,
        label: e.label || '',
        style: e.style,
        routing: e.routing,
        color: e.color,
        strokeWidth: e.stroke.width,
        strokeColor: e.stroke.color,
        branches: e.branches,
        isBranched: e.isBranched,
        branchTargets: e.branchTargets,
      },
    });
    for (const target of e.branchTargets) {
      if (target === e.toId) continue;
      elements.edges.push({
        data: {
          id: `${e.id}__b__${target}`,
          source: e.fromId,
          target,
          label: e.label || '',
          style: e.style,
          routing: e.routing,
          color: e.color,
          isBranch: true,
          parentEdge: e.id,
        },
      });
    }
  }
  return JSON.stringify({ elements, meta: model.meta }, null, 2);
}

function mermaidSanitiseId(id) {
  return String(id).replace(/[^A-Za-z0-9_]/g, '_');
}

function mermaidQuoteLabel(text) {
  const safe = String(text || '')
    .replace(/"/g, '#quot;')
    .replace(/\n/g, '<br/>');
  return `"${safe}"`;
}

export function exportAsMermaid(model, opts) {
  const options = opts || {};
  const lines = [];
  let nodes = model.nodes;
  let edges = model.edges;
  let truncated = false;
  const limit = Number.isFinite(options.maxNodes) ? options.maxNodes : MERMAID_NODE_LIMIT;
  if (nodes.length > limit) {
    truncated = true;
    nodes = nodes.slice(0, limit);
    const keep = new Set(nodes.map((n) => n.id));
    edges = edges.filter((e) => keep.has(e.fromId) && keep.has(e.toId));
  }
  if (truncated) {
    lines.push(`%% WARNING: graph truncated to first ${limit} of ${model.nodes.length} nodes for readability.`);
  }
  lines.push('flowchart LR');
  for (const n of nodes) {
    const id = mermaidSanitiseId(n.id);
    const label = mermaidQuoteLabel(n.label || n.id);
    const cls = n.status ? `:::status_${n.status.replace(/-/g, '_')}` : '';
    lines.push(`  ${id}[${label}]${cls}`);
  }
  for (const e of edges) {
    const from = mermaidSanitiseId(e.fromId);
    const to = mermaidSanitiseId(e.toId);
    const lbl = e.label ? ` ${mermaidQuoteLabel(e.label)} ` : ' ';
    const arrow = e.style === 'dashed' ? '-.->' : '-->';
    lines.push(`  ${from} --${lbl}${arrow} ${to}`);
    for (const target of e.branchTargets) {
      if (target === e.toId) continue;
      const t = mermaidSanitiseId(target);
      lines.push(`  ${from} --${lbl}${arrow} ${t}`);
    }
  }
  lines.push('');
  lines.push('  classDef status_solved fill:#3de88a,stroke:#2a9c50,color:#0a2c14');
  lines.push('  classDef status_partial fill:#e8c83d,stroke:#a68f1e,color:#332b06');
  lines.push('  classDef status_unsolved fill:#e83d3d,stroke:#a02828,color:#fdecec');
  lines.push('  classDef status_no_data fill:#888888,stroke:#555555,color:#ffffff');
  lines.push('  classDef status_dead_end fill:#444444,stroke:#222222,color:#ffffff');
  return lines.join('\n');
}

function dotQuote(text) {
  return `"${String(text || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

export function exportAsDot(model, opts) {
  void opts;
  const lines = [];
  lines.push('digraph "INSIDE ARG Investigation Map" {');
  lines.push('  rankdir=LR;');
  lines.push('  bgcolor="white";');
  lines.push('  node [shape=box, style="rounded,filled", fontname="Helvetica"];');
  lines.push('  edge [fontname="Helvetica", fontsize=10];');
  lines.push('');

  const branchByNode = new Map();
  for (const n of model.nodes) {
    if (n.branches.length) branchByNode.set(n.id, n.branches[0]);
  }
  const nodesPerBranch = new Map();
  const unassigned = [];
  for (const n of model.nodes) {
    if (n.branches.length) {
      const b = n.branches[0];
      if (!nodesPerBranch.has(b)) nodesPerBranch.set(b, []);
      nodesPerBranch.get(b).push(n);
    } else {
      unassigned.push(n);
    }
  }

  const branchLookup = new Map(model.branches.map((b) => [b.id, b]));
  let clusterIdx = 0;
  for (const [branchId, arr] of nodesPerBranch.entries()) {
    const b = branchLookup.get(branchId);
    const label = b ? b.label : branchId;
    lines.push(`  subgraph cluster_${clusterIdx} {`);
    lines.push(`    label=${dotQuote(label)};`);
    lines.push(`    style="rounded,dashed";`);
    lines.push(`    color="#888888";`);
    for (const n of arr) emitDotNode(lines, n, '    ');
    lines.push('  }');
    clusterIdx += 1;
  }
  for (const n of unassigned) emitDotNode(lines, n, '  ');

  for (const e of model.edges) {
    const style = e.style === 'dashed' ? ',style="dashed"' : (e.style === 'dotted' ? ',style="dotted"' : '');
    const lbl = e.label ? `,label=${dotQuote(e.label)}` : '';
    lines.push(`  ${dotQuote(e.fromId)} -> ${dotQuote(e.toId)} [penwidth=${e.stroke.width}${lbl}${style}];`);
    for (const target of e.branchTargets) {
      if (target === e.toId) continue;
      lines.push(`  ${dotQuote(e.fromId)} -> ${dotQuote(target)} [penwidth=${e.stroke.width}${lbl}${style},color="#888888"];`);
    }
  }
  lines.push('}');
  return lines.join('\n');
}

function emitDotNode(lines, n, indent) {
  const status = n.status || 'no-data';
  const fill = STATUS_FILL_HEX[status] || '#cccccc';
  const stroke = STATUS_STROKE_HEX[status] || '#666666';
  const textColor = STATUS_TEXT_HEX[status] || '#000000';
  const label = `${n.label || n.id}\\n(${status})`;
  lines.push(`${indent}${dotQuote(n.id)} [label=${dotQuote(label)},fillcolor="${fill}",color="${stroke}",fontcolor="${textColor}"];`);
}

function xmlEscape(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function exportAsGraphML(model, opts) {
  void opts;
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<graphml xmlns="http://graphml.graphdrawing.org/xmlns"');
  lines.push('         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"');
  lines.push('         xsi:schemaLocation="http://graphml.graphdrawing.org/xmlns http://graphml.graphdrawing.org/xmlns/1.0/graphml.xsd">');
  lines.push('  <key id="d_label" for="node" attr.name="label" attr.type="string"/>');
  lines.push('  <key id="d_kind" for="node" attr.name="kind" attr.type="string"/>');
  lines.push('  <key id="d_status" for="node" attr.name="status" attr.type="string"/>');
  lines.push('  <key id="d_tags" for="node" attr.name="tags" attr.type="string"/>');
  lines.push('  <key id="d_branches" for="node" attr.name="branches" attr.type="string"/>');
  lines.push('  <key id="d_file" for="node" attr.name="file" attr.type="string"/>');
  lines.push('  <key id="d_x" for="node" attr.name="x" attr.type="double"/>');
  lines.push('  <key id="d_y" for="node" attr.name="y" attr.type="double"/>');
  lines.push('  <key id="d_w" for="node" attr.name="w" attr.type="double"/>');
  lines.push('  <key id="d_h" for="node" attr.name="h" attr.type="double"/>');
  lines.push('  <key id="d_locked" for="node" attr.name="locked" attr.type="boolean"/>');
  lines.push('  <key id="d_edge_label" for="edge" attr.name="label" attr.type="string"/>');
  lines.push('  <key id="d_edge_style" for="edge" attr.name="style" attr.type="string"/>');
  lines.push('  <key id="d_edge_routing" for="edge" attr.name="routing" attr.type="string"/>');
  lines.push('  <key id="d_edge_color" for="edge" attr.name="color" attr.type="string"/>');
  lines.push('  <key id="d_edge_stroke_width" for="edge" attr.name="strokeWidth" attr.type="double"/>');
  lines.push('  <key id="d_edge_branches" for="edge" attr.name="branches" attr.type="string"/>');
  lines.push('  <graph id="G" edgedefault="directed">');
  for (const n of model.nodes) {
    lines.push(`    <node id="${xmlEscape(n.id)}">`);
    lines.push(`      <data key="d_label">${xmlEscape(n.label || n.id)}</data>`);
    lines.push(`      <data key="d_kind">${xmlEscape(n.kind)}</data>`);
    if (n.status) lines.push(`      <data key="d_status">${xmlEscape(n.status)}</data>`);
    if (n.tags.length) lines.push(`      <data key="d_tags">${xmlEscape(n.tags.join(','))}</data>`);
    if (n.branches.length) lines.push(`      <data key="d_branches">${xmlEscape(n.branches.join(','))}</data>`);
    if (n.file) lines.push(`      <data key="d_file">${xmlEscape(n.file)}</data>`);
    lines.push(`      <data key="d_x">${n.rect.x}</data>`);
    lines.push(`      <data key="d_y">${n.rect.y}</data>`);
    lines.push(`      <data key="d_w">${n.rect.w}</data>`);
    lines.push(`      <data key="d_h">${n.rect.h}</data>`);
    if (n.locked) lines.push('      <data key="d_locked">true</data>');
    lines.push('    </node>');
  }
  let branchEdgeSeq = 0;
  for (const e of model.edges) {
    lines.push(`    <edge id="${xmlEscape(e.id)}" source="${xmlEscape(e.fromId)}" target="${xmlEscape(e.toId)}">`);
    if (e.label) lines.push(`      <data key="d_edge_label">${xmlEscape(e.label)}</data>`);
    lines.push(`      <data key="d_edge_style">${xmlEscape(e.style)}</data>`);
    lines.push(`      <data key="d_edge_routing">${xmlEscape(e.routing)}</data>`);
    lines.push(`      <data key="d_edge_color">${xmlEscape(e.color)}</data>`);
    lines.push(`      <data key="d_edge_stroke_width">${e.stroke.width}</data>`);
    if (e.branches.length) lines.push(`      <data key="d_edge_branches">${xmlEscape(e.branches.join(','))}</data>`);
    lines.push('    </edge>');
    for (const target of e.branchTargets) {
      if (target === e.toId) continue;
      branchEdgeSeq += 1;
      const bid = `${e.id}__b__${branchEdgeSeq}`;
      lines.push(`    <edge id="${xmlEscape(bid)}" source="${xmlEscape(e.fromId)}" target="${xmlEscape(target)}">`);
      if (e.label) lines.push(`      <data key="d_edge_label">${xmlEscape(e.label)}</data>`);
      lines.push(`      <data key="d_edge_style">${xmlEscape(e.style)}</data>`);
      lines.push('    </edge>');
    }
  }
  lines.push('  </graph>');
  lines.push('</graphml>');
  return lines.join('\n');
}

function plaintextQuote(text) {
  if (text == null || text === '') return '""';
  const safe = String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  return `"${safe}"`;
}

export function exportAsPlaintext(model, opts) {
  void opts;
  const lines = [];
  lines.push(`META exportedAt=${model.meta.exportedAt} canvasId=${model.meta.canvasId} nodes=${model.meta.nodeCount} edges=${model.meta.edgeCount} branches=${model.meta.branchCount}`);
  for (const b of model.branches) {
    const parts = [`id=${b.id}`, `label=${plaintextQuote(b.label)}`];
    if (b.color) parts.push(`color=${b.color}`);
    parts.push(`nodes=${b.nodeCount}`);
    parts.push(`edges=${b.edgeCount}`);
    if (b.description) parts.push(`desc=${plaintextQuote(b.description)}`);
    lines.push(`BRANCH ${parts.join(' ')}`);
  }
  for (const g of model.groups) {
    lines.push(`GROUP id=${g.id} label=${plaintextQuote(g.label)} depth=${g.depth} children=${g.childIds.length}`);
  }
  for (const n of model.nodes) {
    const parts = [`id=${n.id}`, `kind=${n.kind}`];
    if (n.type) parts.push(`type=${n.type}`);
    if (n.status) parts.push(`status=${n.status}`);
    if (n.label) parts.push(`label=${plaintextQuote(n.label)}`);
    if (n.slug) parts.push(`slug=${n.slug}`);
    if (n.mime) parts.push(`mime=${n.mime}`);
    if (n.tags.length) parts.push(`tags=${n.tags.join(',')}`);
    if (n.branches.length) parts.push(`branches=${n.branches.join(',')}`);
    parts.push(`x=${n.rect.x}`);
    parts.push(`y=${n.rect.y}`);
    parts.push(`w=${n.rect.w}`);
    parts.push(`h=${n.rect.h}`);
    if (n.file) parts.push(`file=${n.file}`);
    if (n.parent) parts.push(`parent=${n.parent}`);
    if (n.locked) parts.push('locked=true');
    if (n.color) parts.push(`color=${n.color}`);
    lines.push(`NODE ${parts.join(' ')}`);
  }
  for (const e of model.edges) {
    const parts = [`id=${e.id}`, `from=${e.fromId}`, `to=${e.toId}`];
    if (e.label) parts.push(`label=${plaintextQuote(e.label)}`);
    parts.push(`style=${e.style}`);
    parts.push(`routing=${e.routing}`);
    parts.push(`color=${e.color}`);
    parts.push(`strokeWidth=${e.stroke.width}`);
    parts.push(`strokeColor=${e.stroke.color}`);
    if (e.branches.length) parts.push(`branches=${e.branches.join(',')}`);
    if (e.branchTargets.length) parts.push(`branchTargets=${e.branchTargets.join(',')}`);
    if (e.waypoints.length) parts.push(`waypoints=${e.waypoints.map((p) => `${p.x},${p.y}`).join(';')}`);
    lines.push(`EDGE ${parts.join(' ')}`);
  }
  return lines.join('\n');
}

export function exportAsJsonCanvas(state, arrowLayer) {
  const nodes = state && state.nodes instanceof Map ? state.nodes : new Map();
  let edges = state && state.edges instanceof Map ? state.edges : new Map();
  if (arrowLayer && typeof arrowLayer.serializeEdges === 'function') {
    edges = new Map(arrowLayer.serializeEdges());
  }
  const branches = Array.isArray(state && state.branches) ? state.branches : [];
  return JSON.stringify(serializeCanvas(nodes, edges, branches), null, 2);
}

export const FORMAT_IDS = [
  'markdown',
  'aitext',
  'mermaid',
  'cytoscape',
  'dot',
  'graphml',
  'jsoncanvas',
  'plaintext',
];

export const FORMAT_META = {
  markdown:  { ext: 'md',     mime: 'text/markdown' },
  aitext:    { ext: 'txt',    mime: 'text/plain' },
  mermaid:   { ext: 'mmd',    mime: 'text/plain' },
  cytoscape: { ext: 'json',   mime: 'application/json' },
  dot:       { ext: 'dot',    mime: 'text/vnd.graphviz' },
  graphml:   { ext: 'graphml', mime: 'application/xml' },
  jsoncanvas: { ext: 'canvas', mime: 'application/json' },
  plaintext: { ext: 'txt',    mime: 'text/plain' },
};
