/* Top-level bootstrap. Wires viewer + arrow layer + side panel + editor +
   search + i18n + minimap + outline + command palette + keyboard. Owns the
   canvas nodes/edges maps, syncs persistence. */

import { Viewer } from './viewer.js';
import { SidePanel } from './side-panel.js';
import { SearchBar } from './search.js';
import { EditorModal, ContextMenu } from './editor.js';
import { ArrowLayer } from './arrows.js';
import { Minimap } from './minimap.js';
import { OutlinePanel } from './outline.js';
import { CommandPalette } from './command-palette.js';
import { KeyboardShortcuts } from './keyboard.js';
import { StatusFilter } from './status-filter.js';
import {
  loadCanvas,
  setCachedMarkdown,
  snapshotMarkdownCache,
  restoreMarkdownCache,
  normaliseNode,
  normaliseEdge,
  serializeCanvas,
} from './data-loader.js';
import {
  saveState,
  saveStateImmediate,
  loadState,
  clearState,
  downloadCanvasFile,
  importCanvasFile,
} from './persistence.js';
import {
  STATUSES,
  findNode,
  addPuzzleNode,
  updatePuzzleNode,
  removeNode,
  uniqueId,
  toViewShape,
  puzzleViews,
  blockViews,
  isPuzzleNode,
  nodeAtParentLookup,
  nodeMarkdown,
  statusLabel,
} from './nodes.js';
import { LANGS, initLang, getLang, setLang, tr } from './i18n.js';
import { AuthUI } from './auth-ui.js';
import { Realtime } from './realtime.js';
import {
  isLoggedIn, getCurrentUser, subscribeAuth,
  getCanvas as apiGetCanvas, putCanvas as apiPutCanvas,
  createNode as apiCreateNode, patchNode as apiPatchNode, deleteNode as apiDeleteNode,
  createEdge as apiCreateEdge, patchEdge as apiPatchEdge, deleteEdge as apiDeleteEdge,
  getClientId,
} from './api-client.js';
import { isPlaceholderApiBase } from './config.js';

const STATE_VERSION = 3;
const DETECTIVE_KEY = 'arg_map_detective_theme';
const THEME_KEY = 'arg.theme';
const THEME_CHOICES = ['light', 'dark', 'auto'];
const SELF_ECHO_WINDOW_MS = 250;

const state = {
  nodes: new Map(),
  edges: new Map(),
  imageW: 0,
  imageH: 0,
  statusFilter: new Set(STATUSES),
  activeFilter: 'all',
  mode: 'viewer',
  searchTerm: '',
  searchMatches: null,
  backendOnline: false,
  revision: 0,
  recentSelfMutations: [],
};

let viewer;
let sidePanel;
let searchBar;
let editorModal;
let contextMenu;
let arrowLayer;
let minimap;
let outlinePanel;
let commandPalette;
let keyboard;
let statusFilter;
let authUI;
let realtime;

function $(id) { return document.getElementById(id); }

function toast(msg, kind) {
  const t = $('toast');
  t.textContent = msg;
  t.className = '';
  t.classList.add('show');
  if (kind === 'error') t.classList.add('error');
  setTimeout(() => t.classList.remove('show'), 2200);
}

function snapshot() {
  return {
    version: STATE_VERSION,
    canvas: serializeCanvas(state.nodes, state.edges),
    lang: getLang(),
    puzzles: snapshotMarkdownCache(),
  };
}

function scheduleSave() {
  saveState(snapshot());
}

async function bootstrap() {
  initLang();
  setupThemeSwitch();
  applyStaticTranslations();
  setupLangSelect();
  setupViewer();
  setupSidePanel();
  setupSearchBar();
  setupEditorModal();
  setupArrowLayer();
  setupToolbar();
  setupMigrationBanner();
  contextMenu = new ContextMenu(document.body);

  setupStatusFilter();
  setupMinimap();
  setupOutline();
  setupCommandPalette();
  setupKeyboard();
  setupDetectiveTheme();
  setupAuthUI();

  await loadInitialData();
  await outlinePanel.loadInitial();
  applyFilters();
  applyAuthState();

  setupRealtime();

  document.addEventListener('i18n:changed', () => {
    applyStaticTranslations();
    if (sidePanel && sidePanel.isOpen() && sidePanel.currentView) {
      sidePanel.refreshLocalised();
    }
    if (arrowLayer) arrowLayer.retranslate();
    if (minimap) minimap.retranslate();
    if (outlinePanel) outlinePanel.retranslate();
    if (commandPalette) commandPalette.retranslate();
    if (keyboard) keyboard.retranslate();
    refreshMigrationBannerText();
    refreshRealtimeStatusLabel();
    refreshOfflineBanner();
  });
}

function setupAuthUI() {
  authUI = new AuthUI({
    toolbarEl: $('toolbar'),
    afterModeSwitchEl: document.querySelector('.mode-switch'),
    onLogin: () => {
      applyAuthState();
      if (realtime) realtime._reconnectNow();
      toast(tr('login_title'));
    },
    onLogout: () => {
      applyAuthState();
      if (realtime) realtime._reconnectNow();
      if (state.mode === 'editor') setMode('viewer');
    },
  });
  subscribeAuth((kind) => {
    if (kind === 'login' || kind === 'logout' || kind === 'expired') applyAuthState();
  });
}

function applyAuthState() {
  const authed = isLoggedIn();
  document.body.classList.toggle('authed', authed);
  if (!authed && state.mode === 'editor') setMode('viewer');
}

function setupRealtime() {
  realtime = new Realtime({
    getRevision: () => state.revision,
    onStatus: (s) => setRealtimeStatus(s),
    onChange: (ev) => applyRealtimeChange(ev),
    onResync: (data) => applyServerCanvas(data),
  });
  realtime.start();
}

function setupViewer() {
  viewer = new Viewer($('map-canvas'), {
    drawPreviewEl: $('draw-preview'),
    onHotspotClick: (id) => {
      const n = findNode(state.nodes, id);
      if (!n) return;
      const view = toViewShape(n);
      if (state.mode === 'editor' && isPuzzleNode(n)) {
        editorModal.openEdit(view, nodeMarkdown(n));
        return;
      }
      viewer.setActiveId(id);
      sidePanel.open(view);
    },
    onHotspotRightClick: (id, ev) => {
      const n = findNode(state.nodes, id);
      if (!n || !isPuzzleNode(n)) return;
      const view = toViewShape(n);
      const items = [
        { label: tr('context_edit_hotspot'), fn: () => {
          editorModal.openEdit(view, nodeMarkdown(n));
        } },
      ];
      if (outlinePanel) {
        if (outlinePanel.hasNode(id)) {
          items.push({ label: tr('outline_remove_from_outline'), fn: () => {
            outlinePanel.removeByNodeId(id);
            scheduleSave();
          } });
        } else {
          items.push({ label: tr('outline_add_to_outline'), fn: () => {
            outlinePanel.addNodeAtEnd(id, 0);
            scheduleSave();
          } });
        }
      }
      items.push({ label: tr('context_delete_hotspot'), danger: true, fn: () => {
        editorModal.showConfirm({
          title: tr('editor_delete_title'),
          message: tr('context_delete_confirm_msg', { title: view.title }),
          actions: [
            { label: tr('editor_cancel_button'), kind: 'cancel', fn: () => editorModal.hideConfirm() },
            { label: tr('editor_delete_button'), kind: 'danger', fn: () => {
              editorModal.hideConfirm();
              deletePuzzleNode(view.id);
            } },
          ],
        });
      } });
      contextMenu.open(ev.clientX, ev.clientY, items);
    },
    onCanvasDrawRect: (rect) => {
      editorModal.openCreate(rect, {
        md: '# New puzzle\n\n## Status\nunsolved\n\n## TLDR\n\n## Background\n\n## Current state\n\n## Techniques tried\n\n## References\n\n## Open questions\n',
      });
    },
    onHotspotResize: (id, rect) => {
      updatePuzzleNode(state.nodes, id, { rect });
    },
    onHotspotResizeEnd: (id) => {
      const n = findNode(state.nodes, id);
      if (n) {
        pushNodePatch(id, { x: n.x, y: n.y, width: n.width, height: n.height });
      }
      scheduleSave();
    },
    onTransformChange: () => {
      if (arrowLayer) arrowLayer.requestDraw();
    },
  });
  viewer.attachTooltip($('hotspot-tooltip'));
}

function setupArrowLayer() {
  arrowLayer = new ArrowLayer({
    svg: $('arrow-layer'),
    viewport: $('viewport'),
    getNodes: () => state.nodes,
    getTransform: () => viewer.getTransform(),
    onEdgesChange: () => {},
    onScheduleSave: () => scheduleSave(),
    onEdgeMutation: (kind, id, edge) => {
      if (!state.backendOnline || !isLoggedIn()) return;
      if (kind === 'create' && edge) {
        trackSelfMutation('edge_created', id);
        apiCreateEdge({ ...edge }).then((r) => { if (r) state.revision = r.revision; })
          .catch((e) => { if (e && e.kind !== 'auth_expired') console.warn('[app] edge create', e); });
      } else if (kind === 'update' && edge) {
        trackSelfMutation('edge_updated', id);
        apiPatchEdge(id, { ...edge }).then((r) => { if (r) state.revision = r.revision; })
          .catch((e) => { if (e && e.kind !== 'auth_expired') console.warn('[app] edge update', e); });
      } else if (kind === 'delete') {
        trackSelfMutation('edge_deleted', id);
        apiDeleteEdge(id).then((r) => { if (r) state.revision = r.revision; })
          .catch((e) => { if (e && e.kind !== 'auth_expired') console.warn('[app] edge delete', e); });
      }
    },
  });
}

function setupSidePanel() {
  sidePanel = new SidePanel({
    panelEl: $('panel'),
    statusSelectEl: $('panel-status-select'),
    titleEl: $('panel-title'),
    tagsEl: $('panel-tags'),
    bodyEl: $('panel-body'),
    closeEl: $('panel-close'),
    editBtnEl: $('btn-edit-md'),
    saveBtnEl: $('btn-save-md'),
    exportBtnEl: $('btn-export-md'),
    statusDotEl: $('panel-status-dot'),
    overlayEl: $('md-edit-overlay'),
    overlayTextareaEl: $('md-edit-textarea'),
    overlaySaveEl: $('md-edit-save'),
    overlayCancelEl: $('md-edit-cancel'),
    getNode: (id) => findNode(state.nodes, id),
    onStatusChange: (id, status) => {
      if (!isLoggedIn()) {
        const n0 = findNode(state.nodes, id);
        if (n0) sidePanel.setNodeMeta(toViewShape(n0));
        if (authUI) authUI.openLogin();
        return;
      }
      updatePuzzleNode(state.nodes, id, { status });
      const n = findNode(state.nodes, id);
      if (!n) return;
      const view = toViewShape(n);
      sidePanel.setNodeMeta(view);
      sidePanel.refreshStatusDot(view.status);
      refreshPuzzleViewsInViewer();
      pushNodePatch(id, { status });
      scheduleSave();
    },
    onContentChange: (id, md, persist) => {
      const n = findNode(state.nodes, id);
      if (!n) return;
      if (isPuzzleNode(n)) {
        updatePuzzleNode(state.nodes, id, { md });
        if (n.slug) setCachedMarkdown(n.slug, md);
      }
      if (persist) {
        toast(tr('toast_md_saved'));
        pushNodePatch(id, { text: md });
        scheduleSave();
      }
    },
    onConfirmCloseWithUnsaved: (cb) => {
      editorModal.showConfirm({
        title: tr('editor_discard_title'),
        message: tr('editor_discard_confirm_q'),
        actions: [
          { label: tr('editor_discard_keep'),    kind: 'cancel', fn: () => { editorModal.hideConfirm(); cb(false); } },
          { label: tr('editor_discard_discard'), kind: 'danger', fn: () => { editorModal.hideConfirm(); cb(true);  } },
        ],
      });
    },
    onClose: () => {
      viewer.setActiveId(null);
    },
    onExportMd: (slug, md) => {
      const blob = new Blob([md], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${slug}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 200);
      toast(tr('toast_md_downloaded', { filename: `${slug}.md` }));
    },
  });
}

function setupSearchBar() {
  searchBar = new SearchBar({
    inputEl: $('search'),
    resultsEl: $('search-results'),
    getHotspots: () => puzzleViews(state.nodes),
    onPick: (id) => {
      const n = findNode(state.nodes, id);
      if (!n) return;
      const view = toViewShape(n);
      viewer.centerOnHotspot(view);
      viewer.setActiveId(id);
      sidePanel.open(view);
    },
    onTermChange: (term, ids) => {
      state.searchTerm = term;
      state.searchMatches = ids;
      viewer.setSearchTerm(term, ids);
    },
  });
}

function setupEditorModal() {
  editorModal = new EditorModal({
    modalEl: $('editor-modal'),
    headerTitleEl: $('editor-modal-header-title'),
    closeEl: $('editor-modal-close'),
    titleEl: $('field-title'),
    slugEl: $('field-slug'),
    statusEl: $('field-status'),
    tagsEl: $('field-tags'),
    mdEl: $('field-md'),
    saveBtnEl: $('editor-save'),
    cancelBtnEl: $('editor-cancel'),
    deleteBtnEl: $('editor-delete'),
    confirmModalEl: $('confirm-modal'),
    confirmTitleEl: $('confirm-title'),
    confirmMessageEl: $('confirm-message'),
    confirmActionsEl: $('confirm-actions'),
    onSave: (payload) => {
      if (payload.mode === 'edit') {
        const existing = findNode(state.nodes, payload.id);
        if (!existing) return;
        const slugClash = state.nodes.has(payload.slug) && payload.slug !== payload.id
          && state.nodes.get(payload.slug) !== existing;
        const finalSlug = slugClash ? `${payload.slug}-${Date.now().toString(36)}` : payload.slug;
        updatePuzzleNode(state.nodes, payload.id, {
          title: payload.title,
          slug: finalSlug,
          status: payload.status,
          tags: payload.tags,
          rect: payload.rect,
          md: payload.md,
        });
        if (finalSlug) setCachedMarkdown(finalSlug, payload.md);
        refreshPuzzleViewsInViewer();
        const view = toViewShape(findNode(state.nodes, payload.id));
        sidePanel.setNodeMeta(view);
        if (sidePanel.isOpen() && sidePanel.currentSlug() === finalSlug) {
          sidePanel.open(view);
        }
        pushNodePatch(payload.id, {
          slug: finalSlug,
          status: payload.status,
          tags: payload.tags,
          x: payload.rect.x, y: payload.rect.y,
          width: payload.rect.w, height: payload.rect.h,
          text: payload.md,
        });
        scheduleSave();
        toast(tr('toast_hotspot_updated'));
        return;
      }
      const id = uniqueId(state.nodes, payload.slug || payload.title);
      const finalSlug = payload.slug && !state.nodes.has(payload.slug)
        ? payload.slug
        : id;
      const parent = nodeAtParentLookup(state.nodes, payload.rect);
      addPuzzleNode(state.nodes, {
        id,
        title: payload.title,
        slug: finalSlug,
        status: payload.status,
        tags: payload.tags,
        rect: payload.rect,
        md: payload.md,
        parent,
      });
      setCachedMarkdown(finalSlug, payload.md);
      refreshPuzzleViewsInViewer();
      const newNode = findNode(state.nodes, id);
      if (newNode) pushNodeCreate(toViewShape(newNode), payload.md);
      scheduleSave();
      toast(tr('toast_hotspot_added'));
    },
    onDelete: (id) => deletePuzzleNode(id),
    onCancel: () => {},
  });
}

function deletePuzzleNode(id) {
  const n = findNode(state.nodes, id);
  if (!n || !isPuzzleNode(n)) return;
  const slug = n.slug;
  removeNode(state.nodes, id);
  if (arrowLayer) arrowLayer.notifyNodeDeleted(id);
  if (outlinePanel) outlinePanel.removeByNodeId(id);
  refreshPuzzleViewsInViewer();
  if (viewer) viewer.notifyNodesChanged();
  if (sidePanel.isOpen() && sidePanel.currentSlug() === slug) {
    sidePanel.requestClose();
  }
  pushNodeDelete(id);
  scheduleSave();
  toast(tr('toast_hotspot_deleted'));
}

function refreshPuzzleViewsInViewer() {
  viewer.setHotspots(puzzleViews(state.nodes));
  if (viewer) viewer.notifyNodesChanged();
}

function setupToolbar() {
  document.querySelectorAll('.mode-switch button').forEach((btn) => {
    btn.addEventListener('click', () => {
      setMode(btn.dataset.mode);
    });
  });

  $('btn-zoom-in').addEventListener('click', () => {
    const r = $('map-canvas').getBoundingClientRect();
    viewer.zoomAt(r.width / 2, r.height / 2, 1.25);
  });
  $('btn-zoom-out').addEventListener('click', () => {
    const r = $('map-canvas').getBoundingClientRect();
    viewer.zoomAt(r.width / 2, r.height / 2, 1 / 1.25);
  });
  $('btn-zoom-fit').addEventListener('click', () => viewer.fitToScreen());

  $('btn-export').addEventListener('click', () => {
    exportCanvasAndOutline();
  });

  $('btn-import').addEventListener('click', () => $('file-import').click());
  $('file-import').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const imported = await importCanvasFile(f);
      applyImportedCanvas(imported);
      const count = puzzleViews(state.nodes).length;
      toast(tr('toast_imported', { n: count }));
    } catch (err) {
      toast(tr('toast_import_failed', { error: err.message }), 'error');
    }
    e.target.value = '';
  });

  $('btn-reset').addEventListener('click', () => {
    editorModal.showConfirm({
      title: tr('reset_title'),
      message: tr('reset_message'),
      actions: [
        { label: tr('editor_cancel_button'), kind: 'cancel', fn: () => editorModal.hideConfirm() },
        { label: tr('reset_confirm'),        kind: 'danger', fn: () => {
          editorModal.hideConfirm();
          clearState();
          window.location.reload();
        } },
      ],
    });
  });

  const outlineBtn = $('btn-outline');
  if (outlineBtn) outlineBtn.addEventListener('click', () => outlinePanel && outlinePanel.toggle());
  const minimapBtn = $('btn-minimap');
  if (minimapBtn) minimapBtn.addEventListener('click', () => minimap && minimap.toggle());
  const paletteBtn = $('btn-palette');
  if (paletteBtn) paletteBtn.addEventListener('click', () => commandPalette && commandPalette.open());
}

function exportCanvasAndOutline() {
  downloadCanvasFile(state.nodes, state.edges, 'canvas.canvas');
  if (outlinePanel && outlinePanel.dirty) {
    const blob = new Blob([JSON.stringify(outlinePanel.serialize(), null, 2) + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'outline.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 200);
  }
  toast(tr('toast_exported'));
}

function setupLangSelect() {
  const sel = $('lang-select');
  if (!sel) return;
  sel.value = getLang();
  sel.addEventListener('change', () => {
    if (LANGS.includes(sel.value)) {
      setLang(sel.value);
    }
  });
}

function applyStaticTranslations() {
  document.title = tr('app_title');
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = tr(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = tr(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = tr(el.dataset.i18nTitle);
  });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => {
    el.setAttribute('aria-label', tr(el.dataset.i18nAria));
  });
  if (sidePanel) sidePanel.refreshStatusOptions();
  if (editorModal) editorModal.refreshStatusOptions();
}

function setMode(mode) {
  if (mode === 'editor' && !isLoggedIn()) {
    if (authUI) authUI.openLogin();
    return;
  }
  state.mode = mode;
  viewer.setMode(mode);
  if (arrowLayer) arrowLayer.setMode(mode);
  document.querySelectorAll('.mode-switch button').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
}

function applyFilters() {
  viewer.setStatusFilter(state.statusFilter, { fade: true, activeFilter: state.activeFilter });
  if (arrowLayer) arrowLayer.setStatusFilter(state.statusFilter, { fade: true });
  if (minimap)    minimap.setStatusFilter(state.statusFilter, { fade: true });
}

async function loadInitialData() {
  if (!isPlaceholderApiBase()) {
    try {
      const remote = await apiGetCanvas();
      if (remote && remote.data && Array.isArray(remote.data.nodes) && Array.isArray(remote.data.edges)) {
        state.backendOnline = true;
        state.revision = Number(remote.revision) || 0;
        await ingestCanvasData(remote.data);
        return;
      }
    } catch (e) {
      console.warn('[app] backend fetch failed, falling back to local file:', e && e.message);
    }
  }
  state.backendOnline = false;
  refreshOfflineBanner();

  const loaded = await loadCanvas();
  const stored = loadState();
  const useStored = stored && stored.version === STATE_VERSION
    && stored.canvas && Array.isArray(stored.canvas.nodes) && Array.isArray(stored.canvas.edges);

  let nodes;
  let edges;
  if (useStored) {
    nodes = new Map();
    for (const n of stored.canvas.nodes) {
      const nn = normaliseNode(n);
      if (nn.id) nodes.set(nn.id, nn);
    }
    edges = new Map();
    for (const e of stored.canvas.edges) {
      const ee = normaliseEdge(e);
      if (ee.id) edges.set(ee.id, ee);
    }
    if (stored.puzzles) restoreMarkdownCache(stored.puzzles);
    toast(tr('toast_loaded_local'));
  } else {
    nodes = loaded.nodes;
    edges = loaded.edges;
  }

  state.nodes = nodes;
  state.edges = edges;

  const blocks = blockViews(nodes);
  await viewer.setBlocks(blocks);
  const sz = viewer.getImageSize();
  state.imageW = sz.w;
  state.imageH = sz.h;

  refreshPuzzleViewsInViewer();
  arrowLayer.setEdges(edges);
  arrowLayer.setMode(state.mode);

  if (useStored) {
    saveStateImmediate(snapshot());
  }

  if (loaded.fellBack && !useStored) {
    showMigrationBanner();
  }
}

async function ingestCanvasData(data) {
  const nodes = new Map();
  for (const raw of (data.nodes || [])) {
    if (!raw || typeof raw.id !== 'string') continue;
    nodes.set(raw.id, normaliseNode(raw));
  }
  const edges = new Map();
  for (const raw of (data.edges || [])) {
    if (!raw || typeof raw.id !== 'string') continue;
    edges.set(raw.id, normaliseEdge(raw));
  }
  state.nodes = nodes;
  state.edges = edges;
  const blocks = blockViews(nodes);
  await viewer.setBlocks(blocks);
  const sz = viewer.getImageSize();
  state.imageW = sz.w;
  state.imageH = sz.h;
  refreshPuzzleViewsInViewer();
  arrowLayer.setEdges(edges);
  arrowLayer.setMode(state.mode);
  hideMigrationBanner();
  refreshOfflineBanner();
}

function applyServerCanvas(payload) {
  if (!payload || !payload.data) return;
  state.revision = Number(payload.revision) || state.revision;
  ingestCanvasData(payload.data).catch((e) => console.warn('[app] resync ingest', e));
}

function trackSelfMutation(kind, id) {
  const now = Date.now();
  state.recentSelfMutations.push({ kind, id, t: now });
  if (state.recentSelfMutations.length > 32) state.recentSelfMutations.shift();
}

function isSelfEcho(ev) {
  if (ev && ev.clientId && ev.selfClientId && ev.clientId === ev.selfClientId) return true;
  const now = Date.now();
  for (let i = state.recentSelfMutations.length - 1; i >= 0; i--) {
    const r = state.recentSelfMutations[i];
    if (now - r.t > SELF_ECHO_WINDOW_MS) break;
    if (r.kind === ev.kind && (r.id || null) === (ev.id || null)) {
      state.recentSelfMutations.splice(i, 1);
      return true;
    }
  }
  return false;
}

function applyRealtimeChange(ev) {
  if (!ev || !ev.kind) return;
  if (typeof ev.revision === 'number') state.revision = ev.revision;
  if (isSelfEcho(ev)) return;
  const k = ev.kind;
  if (k === 'canvas_replaced') {
    realtime && realtime._fullResync();
    return;
  }
  if (k === 'node_created' && ev.data && ev.id) {
    const nn = normaliseNode(ev.data);
    state.nodes.set(nn.id, nn);
    refreshAllAfterChange();
    return;
  }
  if (k === 'node_updated' && ev.data && ev.id) {
    const nn = normaliseNode(ev.data);
    state.nodes.set(nn.id, nn);
    refreshAllAfterChange();
    return;
  }
  if (k === 'node_deleted' && ev.id) {
    state.nodes.delete(ev.id);
    if (arrowLayer) arrowLayer.notifyNodeDeleted(ev.id);
    refreshAllAfterChange();
    return;
  }
  if (k === 'edge_created' && ev.data && ev.id) {
    const ee = normaliseEdge(ev.data);
    state.edges.set(ee.id, ee);
    if (arrowLayer) arrowLayer.setEdges(state.edges);
    return;
  }
  if (k === 'edge_updated' && ev.data && ev.id) {
    const ee = normaliseEdge(ev.data);
    state.edges.set(ee.id, ee);
    if (arrowLayer) arrowLayer.setEdges(state.edges);
    return;
  }
  if (k === 'edge_deleted' && ev.id) {
    state.edges.delete(ev.id);
    if (arrowLayer) arrowLayer.setEdges(state.edges);
    return;
  }
}

function refreshAllAfterChange() {
  refreshPuzzleViewsInViewer();
  if (viewer) viewer.notifyNodesChanged();
}

function setRealtimeStatus(s) {
  const dot = $('realtime-status');
  if (!dot) return;
  dot.classList.remove('connected', 'connecting', 'offline');
  dot.classList.add(s === 'connected' ? 'connected' : s === 'connecting' ? 'connecting' : 'offline');
  refreshRealtimeStatusLabel();
}

function refreshRealtimeStatusLabel() {
  const dot = $('realtime-status');
  if (!dot) return;
  const s = dot.classList.contains('connected') ? 'connected'
    : dot.classList.contains('connecting') ? 'connecting' : 'offline';
  const key = s === 'connected' ? 'realtime_connected'
    : s === 'connecting' ? 'realtime_connecting' : 'realtime_offline';
  dot.title = tr(key);
}

function refreshOfflineBanner() {
  const b = $('offline-banner');
  if (!b) return;
  if (state.backendOnline) b.classList.remove('open');
  else b.classList.add('open');
  b.textContent = tr('offline_banner');
}

async function pushNodeCreate(view, md) {
  if (!state.backendOnline || !isLoggedIn()) return false;
  const node = { ...nodeToServer(view, md) };
  trackSelfMutation('node_created', node.id);
  try {
    const res = await apiCreateNode(node);
    if (res && typeof res.revision === 'number') state.revision = res.revision;
    return true;
  } catch (e) {
    if (e && e.kind === 'auth_expired') return false;
    console.warn('[app] node create failed', e);
    return false;
  }
}

async function pushNodePatch(id, patch) {
  if (!state.backendOnline || !isLoggedIn()) return false;
  trackSelfMutation('node_updated', id);
  try {
    const res = await apiPatchNode(id, patch);
    if (res && typeof res.revision === 'number') state.revision = res.revision;
    return true;
  } catch (e) {
    if (e && e.kind === 'auth_expired') return false;
    console.warn('[app] node patch failed', e);
    return false;
  }
}

async function pushNodeDelete(id) {
  if (!state.backendOnline || !isLoggedIn()) return false;
  trackSelfMutation('node_deleted', id);
  try {
    const res = await apiDeleteNode(id);
    if (res && typeof res.revision === 'number') state.revision = res.revision;
    return true;
  } catch (e) {
    if (e && e.kind === 'auth_expired') return false;
    console.warn('[app] node delete failed', e);
    return false;
  }
}

function nodeToServer(view, md) {
  return {
    id: view.id,
    type: 'text',
    x: view.rect.x, y: view.rect.y,
    width: view.rect.w, height: view.rect.h,
    text: md || '',
    status: view.status,
    tags: view.tags || [],
    kind: 'puzzle',
    slug: view.slug || view.id,
    parent: view.parent || undefined,
  };
}

function applyImportedCanvas(imported) {
  state.nodes = new Map();
  for (const n of imported.nodes) state.nodes.set(n.id, n);
  state.edges = new Map();
  for (const e of imported.edges) state.edges.set(e.id, e);
  refreshPuzzleViewsInViewer();
  arrowLayer.setEdges(state.edges);
  scheduleSave();
}

function setupMigrationBanner() {
  const banner = $('migration-banner');
  if (!banner) return;
  $('migration-banner-button').addEventListener('click', () => {
    downloadCanvasFile(state.nodes, state.edges, 'canvas.canvas');
    toast(tr('toast_exported'));
    hideMigrationBanner();
  });
  $('migration-banner-dismiss').addEventListener('click', () => hideMigrationBanner());
}

function showMigrationBanner() {
  const banner = $('migration-banner');
  if (banner) banner.classList.add('open');
  refreshMigrationBannerText();
}

function hideMigrationBanner() {
  const banner = $('migration-banner');
  if (banner) banner.classList.remove('open');
}

function refreshMigrationBannerText() {
  const text = $('migration-banner-text');
  const button = $('migration-banner-button');
  const dismiss = $('migration-banner-dismiss');
  if (text) text.textContent = tr('migration_banner_text');
  if (button) button.textContent = tr('migration_banner_button');
  if (dismiss) dismiss.textContent = tr('migration_banner_dismiss');
}

function setupStatusFilter() {
  const chips = Array.from(document.querySelectorAll('.filter-btn'));
  statusFilter = new StatusFilter({
    chips,
    onChange: (info) => {
      state.activeFilter = info.activeKey;
      state.statusFilter = info.effectiveSet;
      applyFilters();
    },
  });
  state.activeFilter = statusFilter.getActiveKey();
  state.statusFilter = statusFilter.getEffectiveSet();
}

function setupMinimap() {
  minimap = new Minimap({
    viewer,
    container: document.body,
  });
}

function setupOutline() {
  outlinePanel = new OutlinePanel({
    container: document.body,
    getNodes: () => state.nodes,
    onFlyTo: (id, view) => {
      viewer.centerOnHotspot(view);
      viewer.setActiveId(id);
      sidePanel.open(view);
    },
    onHighlight: (id) => {
      viewer.setOutlineHighlight(id);
    },
    onScheduleSave: () => scheduleSave(),
  });
}

function setupCommandPalette() {
  commandPalette = new CommandPalette({
    container: document.body,
    getEntries: () => collectCommandEntries(),
    onActivate: () => {},
  });
}

function collectCommandEntries() {
  const out = [];
  for (const n of state.nodes.values()) {
    if (!isPuzzleNode(n)) continue;
    const view = toViewShape(n);
    out.push({
      id: `node:${n.id}`,
      category: 'nodes',
      title: view.title,
      hint: view.status,
      fn: () => {
        viewer.centerOnHotspot(view);
        viewer.setActiveId(n.id);
        sidePanel.open(view);
      },
    });
  }
  out.push(
    { id: 'cmd:toggle-minimap',  category: 'commands', title: tr('command_toggle_minimap'),  hint: 'M',     fn: () => minimap && minimap.toggle() },
    { id: 'cmd:toggle-outline',  category: 'commands', title: tr('command_toggle_outline'),  hint: 'O',     fn: () => outlinePanel && outlinePanel.toggle() },
    { id: 'cmd:reset-zoom',      category: 'commands', title: tr('command_reset_zoom'),      hint: '0',     fn: () => viewer && resetZoom() },
    { id: 'cmd:fit-all',         category: 'commands', title: tr('command_fit_all'),         hint: '',      fn: () => viewer && viewer.fitToScreen() },
    { id: 'cmd:export-canvas',   category: 'commands', title: tr('command_export_canvas'),   hint: '',      fn: () => exportCanvasAndOutline() },
    { id: 'cmd:import-canvas',   category: 'commands', title: tr('command_import_canvas'),   hint: '',      fn: () => $('file-import') && $('file-import').click() },
    { id: 'cmd:switch-viewer',   category: 'commands', title: tr('command_switch_viewer'),   hint: 'E',     fn: () => setMode('viewer') },
    { id: 'cmd:switch-editor',   category: 'commands', title: tr('command_switch_editor'),   hint: 'E',     fn: () => setMode('editor') },
    { id: 'cmd:show-shortcuts',  category: 'commands', title: tr('command_show_shortcuts'),  hint: '?',     fn: () => keyboard && keyboard.showOverlay() },
    { id: 'cmd:change-language', category: 'commands', title: tr('command_change_language'), hint: '',      fn: () => commandPalette.enterLangSubmode() },
  );
  out.push(
    { id: 'filter:solved',     category: 'filters', title: `${tr('filter_all')} -> ${tr('filter_solved')}`,   fn: () => statusFilter.apply('solved',   new Set(['solved'])) },
    { id: 'filter:partial',    category: 'filters', title: `${tr('filter_all')} -> ${tr('filter_partial')}`,  fn: () => statusFilter.apply('partial',  new Set(['partial'])) },
    { id: 'filter:unsolved',   category: 'filters', title: `${tr('filter_all')} -> ${tr('filter_unsolved')}`, fn: () => statusFilter.apply('unsolved', new Set(['unsolved'])) },
    { id: 'filter:dead-end',   category: 'filters', title: `${tr('filter_all')} -> ${tr('filter_dead_end')}`, fn: () => statusFilter.apply('dead-end', new Set(['dead-end'])) },
    { id: 'filter:clear',      category: 'filters', title: tr('filter_clear'), fn: () => statusFilter.clear() },
  );
  if (outlinePanel) {
    const items = outlinePanel.getItems();
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      out.push({
        id: `outline:${i}`,
        category: 'outline',
        title: it.title || it.nodeId || `(#${i + 1})`,
        hint: it.note || '',
        fn: () => {
          const n = findNode(state.nodes, it.nodeId);
          if (!n) return;
          const view = toViewShape(n);
          viewer.centerOnHotspot(view);
          viewer.setActiveId(it.nodeId);
          sidePanel.open(view);
          if (outlinePanel) outlinePanel.open();
        },
      });
    }
  }
  out.push({ id: 'setting:detective', category: 'settings', title: tr('command_toggle_detective'), fn: () => toggleDetectiveTheme() });
  return out;
}

function setupKeyboard() {
  keyboard = new KeyboardShortcuts({
    overlayContainer: document.body,
    handlers: {
      onCommandPalette: () => commandPalette && commandPalette.open(),
      onEscape: () => {
        if (commandPalette && commandPalette.isOpen()) {
          commandPalette.close();
          return;
        }
        if (sidePanel && sidePanel.isOpen()) {
          sidePanel.requestClose();
          return;
        }
        viewer.setActiveId(null);
      },
      onMinimapToggle: () => minimap && minimap.toggle(),
      onOutlineToggle: () => outlinePanel && outlinePanel.toggle(),
      onFilterCycle: () => statusFilter && statusFilter.cycle(),
      onModeToggle: () => setMode(state.mode === 'viewer' ? 'editor' : 'viewer'),
      onCreateChild: () => createChildNode(),
      onCreateSibling: () => createSiblingNode(),
      onDeleteSelected: () => confirmDeleteSelected(),
      onZoomIn: () => {
        const r = $('map-canvas').getBoundingClientRect();
        viewer.zoomAt(r.width / 2, r.height / 2, 1.2);
      },
      onZoomOut: () => {
        const r = $('map-canvas').getBoundingClientRect();
        viewer.zoomAt(r.width / 2, r.height / 2, 1 / 1.2);
      },
      onZoomReset: () => resetZoom(),
      onSetStatus: (info) => setSelectedStatus(info && info.status),
    },
  });
}

function resetZoom() {
  if (!viewer) return;
  const r = $('map-canvas').getBoundingClientRect();
  viewer.zoomAt(r.width / 2, r.height / 2, 1 / viewer.getScale());
}

function createChildNode() {
  if (!isLoggedIn()) { if (authUI) authUI.openLogin(); return false; }
  const id = viewer.activeId;
  if (!id) return false;
  const n = findNode(state.nodes, id);
  if (!n || !isPuzzleNode(n)) return false;
  const view = toViewShape(n);
  const newRect = {
    x: view.rect.x + view.rect.w + 200,
    y: view.rect.y,
    w: view.rect.w,
    h: view.rect.h,
  };
  const title = `${view.title} child`;
  const newId = uniqueId(state.nodes, title);
  addPuzzleNode(state.nodes, {
    id: newId,
    title,
    slug: newId,
    status: 'unsolved',
    tags: [],
    rect: newRect,
    md: `# ${title}\n`,
    parent: view.parent,
  });
  refreshPuzzleViewsInViewer();
  viewer.setActiveId(newId);
  const newNode = findNode(state.nodes, newId);
  if (newNode) pushNodeCreate(toViewShape(newNode), `# ${title}\n`);
  scheduleSave();
  toast(tr('node_created'));
  return true;
}

function createSiblingNode() {
  if (!isLoggedIn()) { if (authUI) authUI.openLogin(); return false; }
  const id = viewer.activeId;
  if (!id) return false;
  const n = findNode(state.nodes, id);
  if (!n || !isPuzzleNode(n)) return false;
  const view = toViewShape(n);
  const newRect = {
    x: view.rect.x,
    y: view.rect.y + view.rect.h + 200,
    w: view.rect.w,
    h: view.rect.h,
  };
  const title = `${view.title} sibling`;
  const newId = uniqueId(state.nodes, title);
  addPuzzleNode(state.nodes, {
    id: newId,
    title,
    slug: newId,
    status: 'unsolved',
    tags: [],
    rect: newRect,
    md: `# ${title}\n`,
    parent: view.parent,
  });
  refreshPuzzleViewsInViewer();
  viewer.setActiveId(newId);
  const newNode = findNode(state.nodes, newId);
  if (newNode) pushNodeCreate(toViewShape(newNode), `# ${title}\n`);
  scheduleSave();
  toast(tr('node_created'));
  return true;
}

function confirmDeleteSelected() {
  if (!isLoggedIn()) { if (authUI) authUI.openLogin(); return false; }
  const id = viewer.activeId;
  if (!id) return false;
  const n = findNode(state.nodes, id);
  if (!n || !isPuzzleNode(n)) return false;
  const view = toViewShape(n);
  editorModal.showConfirm({
    title: tr('editor_delete_title'),
    message: tr('context_delete_confirm_msg', { title: view.title }),
    actions: [
      { label: tr('editor_cancel_button'), kind: 'cancel', fn: () => editorModal.hideConfirm() },
      { label: tr('editor_delete_button'), kind: 'danger', fn: () => {
        editorModal.hideConfirm();
        deletePuzzleNode(id);
      } },
    ],
  });
  return true;
}

function setSelectedStatus(status) {
  if (!status) return false;
  if (!isLoggedIn()) { if (authUI) authUI.openLogin(); return false; }
  const id = viewer.activeId;
  if (!id) return false;
  const n = findNode(state.nodes, id);
  if (!n || !isPuzzleNode(n)) return false;
  if (!STATUSES.includes(status)) return false;
  updatePuzzleNode(state.nodes, id, { status });
  refreshPuzzleViewsInViewer();
  pushNodePatch(id, { status });
  scheduleSave();
  toast(tr('node_status_changed', { status: statusLabel(status) }));
  return true;
}

function readStoredThemeChoice() {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (THEME_CHOICES.includes(raw)) return raw;
  } catch (e) { void e; }
  return 'light';
}

function resolveTheme(choice) {
  if (choice === 'dark' || choice === 'light') return choice;
  try {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
  } catch (e) { void e; }
  return 'light';
}

function applyTheme(choice) {
  const resolved = resolveTheme(choice);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themeChoice = choice;
  if (viewer && typeof viewer.setBackgroundFromCSS === 'function') {
    viewer.setBackgroundFromCSS();
  }
  if (minimap && typeof minimap.refreshPalette === 'function') {
    minimap.refreshPalette();
  }
  document.querySelectorAll('#theme-switch button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.themeValue === choice);
  });
}

function setupThemeSwitch() {
  const choice = readStoredThemeChoice();
  applyTheme(choice);

  const root = document.getElementById('theme-switch');
  if (root) {
    root.querySelectorAll('button[data-theme-value]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = btn.dataset.themeValue;
        if (!THEME_CHOICES.includes(next)) return;
        try { localStorage.setItem(THEME_KEY, next); } catch (e) { void e; }
        applyTheme(next);
      });
    });
  }

  try {
    const mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    if (mq && typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', () => {
        if (readStoredThemeChoice() === 'auto') applyTheme('auto');
      });
    } else if (mq && typeof mq.addListener === 'function') {
      mq.addListener(() => {
        if (readStoredThemeChoice() === 'auto') applyTheme('auto');
      });
    }
  } catch (e) { void e; }
}

function setupDetectiveTheme() {
  let enabled = false;
  try { enabled = localStorage.getItem(DETECTIVE_KEY) === '1'; }
  catch (e) { void e; }
  if (enabled) document.body.classList.add('detective');
}

function toggleDetectiveTheme() {
  const next = !document.body.classList.contains('detective');
  document.body.classList.toggle('detective', next);
  try { localStorage.setItem(DETECTIVE_KEY, next ? '1' : '0'); }
  catch (e) { void e; }
  viewer.setBackgroundFromCSS();
}

window.addEventListener('DOMContentLoaded', () => {
  bootstrap().catch((e) => {
    console.error(e);
    toast(tr('toast_init_failed', { error: e.message }), 'error');
  });
});
