/* Top-level bootstrap. Wires viewer + arrow layer + side panel + editor +
   search + i18n + minimap + keyboard + left rail + touch. Owns the canvas
   nodes/edges maps, syncs persistence, drives presence + snapshots. */

import { Viewer } from './viewer.js';
import { SearchBar } from './search.js';
import { EditorModal } from './editor.js';
import { ContextMenu, statusSubmenu, isInOwnedSurface } from './context-menu.js';
import { ArrowLayer } from './arrows.js';
import { Minimap } from './minimap.js';
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
  normaliseBranches,
  defaultBranchSeed,
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
  addStickyNode,
  addGroupNode,
  addTextNode,
  updatePuzzleNode,
  removeNode,
  uniqueId,
  toViewShape,
  puzzleViews,
  blockViews,
  groupViews,
  isPuzzleNode,
  isStickyNode,
  isGroupNode,
  isTextNode,
  isBlockNode,
  isEditableNode,
  groupDescendantIds,
  nextGroupLabel,
  nodeAtParentLookup,
  nodeMarkdown,
  statusLabel,
  viewWithLang,
} from './nodes.js';
import { LeftRail } from './left-rail.js';
import { EditNodeModal, detectVideoUrl } from './edit-node-modal.js';
import { Uploader, validateImageFile, isVideoMime } from './uploader.js';
import { openCropper } from './crop-tool.js';
import { CropOverlay } from './crop-overlay.js';
import { TouchHandler } from './touch.js';
import { NodeClipboard } from './clipboard.js';
import { openVideoUrlDialog } from './video-dialog.js';
import { SettingsModal } from './settings-modal.js';
import { AlignFloater } from './align-floater.js';
import { CommentsLayer } from './comments-layer.js';
import { SnapGuides } from './snap-guides.js';
import { VideoOverlay } from './video-overlay.js';
import { AudioOverlay } from './audio-overlay.js';
import { DocumentOverlay } from './document-overlay.js';
import { FileViewerModal } from './file-viewer.js';
import { BranchesPanel, openManageBranchesModal } from './branches.js';
import { LANGS, initLang, getLang, setLang, tr } from './i18n.js';
import { AuthUI } from './auth-ui.js';
import { Realtime } from './realtime.js';
import { PresencePanel } from './presence.js';
import { openActivityLog, openSnapshots, openPresence } from './admin-modals.js';
import { ExportModal } from './export-modal.js';
import { getActiveTool, setActiveTool, onActiveToolChange, onSpaceHeldChange, isSpaceHeld } from './tools.js';
import {
  isLoggedIn, getCurrentUser, subscribeAuth,
  getCanvas as apiGetCanvas,
  putCanvas as apiPutCanvas,
  createNode as apiCreateNode, patchNode as apiPatchNode, deleteNode as apiDeleteNode,
  createEdge as apiCreateEdge, patchEdge as apiPatchEdge, deleteEdge as apiDeleteEdge,
  uploadImage as apiUploadImage,
} from './api-client.js';
import { isPlaceholderApiBase } from './config.js';

const STATE_VERSION = 3;
const THEME_KEY = 'arg.theme';
const THEME_CHOICES = ['white', 'dark', 'graphite', 'auto'];
const SELF_ECHO_WINDOW_MS = 250;
const BACKEND_RETRY_MS = 30000;

const state = {
  nodes: new Map(),
  edges: new Map(),
  branches: [],
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
  selection: new Set(),
  history: { past: [], future: [] },
  hasUnsavedEdits: false,
};

const HISTORY_LIMIT = 50;

let viewer;
let searchBar;
let editorModal;
let editNodeModal;
let leftRail;
let contextMenu;
let arrowLayer;
let minimap;
let keyboard;
let statusFilter;
let authUI;
let realtime;
let selectionStatusEl;
let uploader;
let replaceImagePicker;
let touchHandler;
let clipboardMgr;
let pendingTextClick = false;
let backendRetryTimer = null;
let backendOfflineMode = 'placeholder';
let settingsModal;
let alignFloater;
let commentsLayer;
let snapGuides;
let videoOverlay;
let audioOverlay;
let documentOverlay;
let fileViewerModal;
let branchesPanel;
let presencePanel;
let cropOverlay;
let exportModal;
let _resizeHistoryPushed = false;

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
    canvas: serializeCanvas(state.nodes, state.edges, state.branches),
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
  clipboardMgr = new NodeClipboard();
  setupViewer();
  setupEditorModal();
  setupEditNodeModal();
  setupSearchBar();
  setupArrowLayer();
  setupToolbar();
  setupMigrationBanner();
  contextMenu = new ContextMenu({ container: document.body });
  setupGlobalContextMenu();
  setupUploader();

  setupStatusFilter();
  setupMinimap();
  setupKeyboard();
  setupAuthUI();
  setupLeftRail();
  setupSelectionStatus();
  setupTouch();
  setupBeforeUnload();
  setupSettingsModal();
  setupExportModal();
  setupSnapGuides();
  setupAlignFloater();
  setupCommentsLayer();
  setupVideoOverlay();
  setupAudioOverlay();
  setupDocumentOverlay();
  setupFileViewer();
  setupCropOverlay();
  setupBranchesPanel();
  setupToastBridge();
  setupPresence();

  await loadInitialData();
  applyFilters();
  applyAuthState();

  setupRealtime();

  setupDebugPanel();

  document.addEventListener('i18n:changed', () => {
    applyStaticTranslations();
    refreshPuzzleViewsInViewer();
    if (editNodeModal && editNodeModal.isOpen() && editNodeModal.currentView) {
      editNodeModal.refreshLocalised();
      const cur = editNodeModal.currentView;
      const n = findNode(state.nodes, cur.id);
      if (n) editNodeModal.open(viewWithLang(toViewShape(n), getLang()));
    }
    if (arrowLayer) arrowLayer.retranslate();
    if (minimap) minimap.retranslate();
    if (keyboard) keyboard.retranslate();
    if (cropOverlay) cropOverlay.retranslate();
    if (leftRail) leftRail.setLang(getLang());
    refreshMigrationBannerText();
    refreshRealtimeStatusLabel();
    refreshOfflineBanner();
    refreshSelectionStatus();
  });
}

function setupDebugPanel() {
  let enabled = false;
  try { enabled = localStorage.getItem('argDebug') === '1'; } catch (e) { void e; }
  if (!enabled) return;
  const panel = document.createElement('div');
  panel.id = 'arg-debug-panel';
  panel.style.cssText = 'position:fixed;right:10px;bottom:60px;z-index:9999;background:rgba(0,0,0,0.72);color:#7eea7e;font:11px/1.4 Consolas,monospace;padding:6px 10px;border-radius:4px;pointer-events:none;max-width:260px;white-space:pre';
  document.body.appendChild(panel);
  const dbg = { lastFrame: 0, lastEvent: 'none', lastStorage: 0, frameTime: 0 };
  let frameAt = 0;
  const origRAF = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => origRAF((t) => {
    if (frameAt) dbg.frameTime = t - frameAt;
    frameAt = t;
    return cb(t);
  });
  document.addEventListener('realtime:change', (ev) => {
    dbg.lastEvent = `${ev.detail && ev.detail.kind || '?'} ${(ev.detail && ev.detail.id) || ''}`;
  });
  const origSetItem = localStorage.setItem.bind(localStorage);
  try {
    localStorage.setItem = (k, v) => {
      if (k === 'arg_map_state' && typeof v === 'string') dbg.lastStorage = v.length;
      return origSetItem(k, v);
    };
  } catch (e) { void e; }
  setInterval(() => {
    panel.textContent = `[arg debug]
frame ${dbg.frameTime.toFixed(1)} ms
ws ${dbg.lastEvent}
local ${(dbg.lastStorage / 1024).toFixed(1)} KB
nodes ${state.nodes.size}  edges ${state.edges.size}`;
  }, 250);
}

function setupToolbarOverflow() {
  const btn = $('tb-overflow-btn');
  const menu = $('tb-overflow-menu');
  if (!btn || !menu) return;
  const searchSlot  = $('tb-overflow-search-slot');
  const filtersSlot = $('tb-overflow-filters-slot');
  const searchGroup = document.getElementById('tb-group-search');
  if (!searchSlot || !filtersSlot || !searchGroup) return;
  const searchWrap = searchGroup.querySelector('#search-wrap');
  const chipsWrap  = searchGroup.querySelector('.tb-filter-chips');
  let inOverflow = false;
  const applyLayout = () => {
    const narrow = window.innerWidth <= 900;
    if (narrow && !inOverflow) {
      if (searchWrap) searchSlot.appendChild(searchWrap);
      if (chipsWrap)  filtersSlot.appendChild(chipsWrap);
      inOverflow = true;
    } else if (!narrow && inOverflow) {
      if (searchWrap) searchGroup.appendChild(searchWrap);
      if (chipsWrap)  searchGroup.appendChild(chipsWrap);
      menu.classList.remove('open');
      inOverflow = false;
    }
  };
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    menu.classList.toggle('open');
  });
  document.addEventListener('mousedown', (e) => {
    if (!menu.contains(e.target) && e.target !== btn) {
      menu.classList.remove('open');
    }
  });
  window.addEventListener('resize', applyLayout);
  applyLayout();
}

function setupBeforeUnload() {
  window.addEventListener('beforeunload', (e) => {
    if (state.hasUnsavedEdits) {
      const msg = tr('unsaved_edits_warning');
      e.preventDefault();
      e.returnValue = msg;
      return msg;
    }
    return undefined;
  });
}

function setupSettingsModal() {
  settingsModal = new SettingsModal();
  const btn = $('btn-settings');
  if (btn) {
    btn.style.display = 'none';
    btn.addEventListener('click', () => settingsModal.open());
  }
}

function setupExportModal() {
  exportModal = new ExportModal({
    getState: () => state,
    getArrowLayer: () => arrowLayer,
    toast: (msg) => toast(msg),
  });
}

function openExportDialog() {
  if (!exportModal) return;
  exportModal.open();
}

function setupSnapGuides() {
  snapGuides = new SnapGuides({
    viewport: $('viewport'),
    getTransform: () => viewer ? viewer.getTransform() : { scale: 1, panX: 0, panY: 0 },
  });
}

function setupAlignFloater() {
  alignFloater = new AlignFloater({
    viewport: $('viewport'),
    getSelection: () => Array.from(state.selection),
    getNode: (id) => findNode(state.nodes, id),
    onApply: (op) => applyAlignmentOperation(op),
  });
}

function setupCommentsLayer() {
  commentsLayer = new CommentsLayer({
    viewport: $('viewport'),
    getTransform: () => viewer ? viewer.getTransform() : { scale: 1, panX: 0, panY: 0 },
    isLoggedIn,
    canvasId: 'main',
  });
  if (viewer && typeof viewer.subscribe === 'function') {
    viewer.subscribe((kind) => {
      if (kind === 'transform') commentsLayer.requestDraw();
    });
  }
  commentsLayer.loadInitial();
}

function setupToastBridge() {
  document.addEventListener('toast', (ev) => {
    if (!ev || !ev.detail) return;
    toast(ev.detail.msg || '', ev.detail.kind);
  });
}

function setupPresence() {
  presencePanel = new PresencePanel({ mountEl: $('presence-badges') });
}

function openActivityLogModal() {
  if (!isLoggedIn()) { if (authUI) authUI.openLogin(); return; }
  openActivityLog();
}

function openSnapshotsModal() {
  if (!isLoggedIn()) { if (authUI) authUI.openLogin(); return; }
  openSnapshots({
    canvasId: 'main',
    onPreview: (snap) => previewSnapshot(snap),
    onRestored: (result) => {
      if (result && result.data) {
        state.revision = Number(result.revision) || state.revision;
        ingestCanvasData(result.data).catch((e) => console.warn('[app] restore ingest', e));
      }
      toast(tr('snapshots_restored_toast'));
    },
  });
}

function openPresenceModal() {
  if (!isLoggedIn()) { if (authUI) authUI.openLogin(); return; }
  openPresence(() => (presencePanel ? presencePanel.getUsers() : []));
}

function previewSnapshot(snap) {
  if (!snap || !snap.data) return;
  const overlay = document.createElement('div');
  overlay.className = 'snapshot-preview-overlay';
  const head = document.createElement('div');
  head.className = 'snapshot-preview-head';
  const title = document.createElement('span');
  title.textContent = tr('snapshots_preview_revision', { revision: snap.revision });
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.className = 'snapshot-preview-close';
  head.appendChild(title); head.appendChild(close);
  const body = document.createElement('pre');
  body.className = 'snapshot-preview-body';
  const data = snap.data || {};
  const ncount = Array.isArray(data.nodes) ? data.nodes.length : 0;
  const ecount = Array.isArray(data.edges) ? data.edges.length : 0;
  body.textContent = `nodes: ${ncount}\nedges: ${ecount}\n\n${JSON.stringify(data, null, 2).slice(0, 4000)}`;
  overlay.appendChild(head); overlay.appendChild(body);
  document.body.appendChild(overlay);
  close.addEventListener('click', () => { try { document.body.removeChild(overlay); } catch (e) { void e; } });
}

function setupVideoOverlay() {
  videoOverlay = new VideoOverlay({
    viewport: $('viewport'),
    getNodes: () => state.nodes,
    getTransform: () => viewer ? viewer.getTransform() : { scale: 1, panX: 0, panY: 0 },
    viewer,
  });
  if (viewer) {
    try { window.__viewer = viewer; } catch (e) { void e; }
  }
  videoOverlay.requestDraw();
}

function _overlayOpts() {
  return { viewport: $('viewport'), getNodes: () => state.nodes,
    getTransform: () => viewer ? viewer.getTransform() : { scale: 1, panX: 0, panY: 0 },
    viewer };
}

function setupAudioOverlay() { audioOverlay = new AudioOverlay(_overlayOpts()); audioOverlay.requestDraw(); }

function setupDocumentOverlay() {
  documentOverlay = new DocumentOverlay({
    ..._overlayOpts(),
    onOpen: (node) => { if (fileViewerModal) fileViewerModal.open(node); },
  });
  documentOverlay.requestDraw();
}

function setupFileViewer() { fileViewerModal = new FileViewerModal(); }

function setupCropOverlay() {
  const viewport = $('viewport');
  if (!viewport || !viewer) return;
  cropOverlay = new CropOverlay({
    viewport,
    viewer,
    getTransform: () => viewer.getTransform(),
    onApply: () => {},
    onCancel: () => {},
  });
}

function setupBranchesPanel() {
  branchesPanel = new BranchesPanel({
    getBranches: () => state.branches,
    getNodes: () => state.nodes,
    canEdit: () => isLoggedIn(),
    onFocus: (id) => focusBranch(id),
    onFilterChange: () => refreshBranchFilter(),
    onManage: () => openManageBranches(),
  });
  const btn = $('btn-branches-toggle');
  if (btn) btn.addEventListener('click', () => branchesPanel && branchesPanel.toggle());
}

function renderVideoOverlay() {
  if (videoOverlay) videoOverlay.requestDraw();
  if (audioOverlay) audioOverlay.requestDraw();
  if (documentOverlay) documentOverlay.requestDraw();
}

function focusBranch(branchId) {
  if (!branchId || !viewer) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, any = false;
  for (const n of state.nodes.values()) {
    if (!Array.isArray(n.branches) || !n.branches.includes(branchId)) continue;
    any = true;
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x + n.width > maxX) maxX = n.x + n.width;
    if (n.y + n.height > maxY) maxY = n.y + n.height;
  }
  if (!any) return;
  const rect = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  if (typeof viewer.fitToRect === 'function') viewer.fitToRect(rect);
  else if (typeof viewer.centerOnHotspot === 'function') viewer.centerOnHotspot({ rect });
}

function refreshBranchFilter() { if (viewer) refreshPuzzleViewsInViewer(); }

function openManageBranches() {
  if (!isLoggedIn()) { if (authUI) authUI.openLogin(); return; }
  openManageBranchesModal({
    getBranches: () => state.branches,
    onUpdate: (next) => applyBranchesUpdate(next),
    onConfirmDelete: (msg) => window.confirm(msg),
  });
}

function applyBranchesUpdate(nextList) {
  pushHistory();
  const validIds = new Set(nextList.map((b) => b.id));
  state.branches = normaliseBranches(nextList);
  for (const n of state.nodes.values()) {
    if (!Array.isArray(n.branches)) continue;
    const before = n.branches.length;
    n.branches = n.branches.filter((b) => validIds.has(b));
    if (n.branches.length !== before) pushNodePatch(n.id, { branches: n.branches });
  }
  if (branchesPanel) branchesPanel.setBranches();
  refreshPuzzleViewsInViewer();
  scheduleSave();
  pushBranchesToBackend();
}

async function pushBranchesToBackend() {
  if (!state.backendOnline || !isLoggedIn()) return;
  try {
    const data = serializeCanvas(state.nodes, state.edges, state.branches);
    const res = await apiPutCanvas(data, state.revision);
    if (res && typeof res.revision === 'number') state.revision = res.revision;
  } catch (e) {
    if (e && e.kind !== 'auth_expired') console.warn('[app] branches push failed', e);
  }
}

async function triggerAddVideo() {
  if (!isLoggedIn()) { if (authUI) authUI.openLogin(); return; }
  const info = await openVideoUrlDialog();
  if (!info) { setActiveTool('select'); return; }
  const pt = viewer.imagePointFromClient(window.innerWidth / 2, window.innerHeight / 2);
  const rect = { x: Math.round(pt.x - 280), y: Math.round(pt.y - 160), w: 560, h: 320 };
  createVideoNode(rect, info);
  setActiveTool('select');
}

function triggerAddAudio() {
  if (!isLoggedIn()) { if (authUI) authUI.openLogin(); return; }
  if (uploader && typeof uploader.openAudioPicker === 'function') uploader.openAudioPicker();
}

function triggerAddComment() {
  if (!isLoggedIn()) { if (authUI) authUI.openLogin(); return; }
  if (!commentsLayer) return;
  commentsLayer.armNextClick();
  toast(tr('comment_arm_hint'));
}

function createVideoNode(rect, media) {
  pushHistory();
  const id = uniqueId(state.nodes, `video-${media.provider || 'media'}`);
  const node = {
    id,
    type: 'link',
    url: media.url,
    x: rect.x, y: rect.y, width: rect.w, height: rect.h,
    kind: 'video',
    status: 'no-data',
    tags: [],
    slug: id,
    media: { ...media },
  };
  state.nodes.set(id, node);
  refreshPuzzleViewsInViewer();
  if (viewer) viewer.notifyNodesChanged();
  const newNode = findNode(state.nodes, id);
  if (newNode) pushNodeCreate(toViewShape(newNode), '');
  scheduleSave();
  toast(tr('node_created'));
  renderVideoOverlay();
}

function applyAlignmentOperation(op) {
  if (!isLoggedIn()) { if (authUI) authUI.openLogin(); return; }
  const ids = Array.from(state.selection);
  if (ids.length < 2) return;
  pushHistory();
  const nodes = ids.map((id) => findNode(state.nodes, id)).filter(Boolean);
  if (!nodes.length) return;
  const lefts = nodes.map((n) => n.x);
  const tops = nodes.map((n) => n.y);
  const rights = nodes.map((n) => n.x + n.width);
  const bottoms = nodes.map((n) => n.y + n.height);
  const minLeft = Math.min(...lefts);
  const minTop = Math.min(...tops);
  const maxRight = Math.max(...rights);
  const maxBottom = Math.max(...bottoms);
  const cxMid = (minLeft + maxRight) / 2;
  const cyMid = (minTop + maxBottom) / 2;
  if (op === 'left') for (const n of nodes) n.x = minLeft;
  else if (op === 'right') for (const n of nodes) n.x = maxRight - n.width;
  else if (op === 'top') for (const n of nodes) n.y = minTop;
  else if (op === 'bottom') for (const n of nodes) n.y = maxBottom - n.height;
  else if (op === 'centerH') for (const n of nodes) n.x = Math.round(cxMid - n.width / 2);
  else if (op === 'middleV') for (const n of nodes) n.y = Math.round(cyMid - n.height / 2);
  else if (op === 'distH') {
    const sorted = nodes.slice().sort((a, b) => a.x - b.x);
    const totalW = sorted.reduce((s, n) => s + n.width, 0);
    const span = maxRight - minLeft;
    const gap = (span - totalW) / Math.max(1, sorted.length - 1);
    let cur = minLeft;
    for (const n of sorted) { n.x = Math.round(cur); cur += n.width + gap; }
  } else if (op === 'distV') {
    const sorted = nodes.slice().sort((a, b) => a.y - b.y);
    const totalH = sorted.reduce((s, n) => s + n.height, 0);
    const span = maxBottom - minTop;
    const gap = (span - totalH) / Math.max(1, sorted.length - 1);
    let cur = minTop;
    for (const n of sorted) { n.y = Math.round(cur); cur += n.height + gap; }
  }
  for (const n of nodes) pushNodePatch(n.id, { x: n.x, y: n.y });
  refreshPuzzleViewsInViewer();
  scheduleSave();
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
    onMessage: (msg) => { if (msg) toast(msg); },
    adminHandlers: {
      onDownloadSnapshot: () => triggerDownloadSnapshot(),
      onImportCanvas:     () => triggerImportCanvas(),
      onResetDefaults:    () => triggerResetDefaults(),
      onOpenActivityLog:  () => openActivityLogModal(),
      onOpenSnapshots:    () => openSnapshotsModal(),
      onOpenPresence:     () => openPresenceModal(),
      onManageBranches:   () => openManageBranches(),
      onOpenExport:       () => openExportDialog(),
    },
  });
  subscribeAuth((kind) => {
    if (kind === 'login' || kind === 'logout' || kind === 'expired') applyAuthState();
  });
}

function applyAuthState() {
  const authed = isLoggedIn();
  const user = getCurrentUser();
  const isAdmin = !!(user && user.is_admin);
  document.body.classList.toggle('authed', authed);
  document.body.classList.toggle('admin', isAdmin);
  if (!authed) {
    document.body.classList.remove('editor-mode');
    state.selection = new Set();
    if (viewer) viewer.setSelection(new Set());
    refreshSelectionStatus();
  }
  if (!authed && state.mode === 'editor') setMode('viewer');
  if (leftRail) leftRail.setAuthState(authed, isAdmin);
  if (authUI) authUI.refreshAdmin();
  const settingsBtn = $('btn-settings');
  if (settingsBtn) settingsBtn.style.display = isAdmin ? '' : 'none';
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
    isNodeLocked: (id) => {
      const n = findNode(state.nodes, id);
      return !!(n && n.locked);
    },
    onHotspotClick: (id) => {
      const n = findNode(state.nodes, id);
      if (!n) return;
      const view = toViewShape(n);
      viewer.setActiveId(id);
      if (editNodeModal) editNodeModal.open(viewWithLang(view, getLang()));
    },
    onHotspotDoubleClick: (id) => {
      const n = findNode(state.nodes, id);
      if (n && nodeIsImageFile(n)) {
        doCropImage(id, n.file);
        return;
      }
      openRichEdit(id);
    },
    onHotspotRightClick: (id, ev) => {
      const items = buildContextMenuItemsForNode(id);
      if (items.length) contextMenu.open(ev.clientX, ev.clientY, items);
    },
    onCanvasRightClick: (ev) => {
      const items = buildContextMenuItemsForEmpty();
      if (items.length) contextMenu.open(ev.clientX, ev.clientY, items);
    },
    onCanvasDrawRect: (rect) => {
      handleDrawRect(rect);
    },
    onArrowDrawBegin: () => {},
    onArrowDrawMove: () => {},
    onArrowDrawEnd: (info) => {
      handleArrowDrawEnd(info);
    },
    onHotspotResize: (id, rect) => {
      if (!_resizeHistoryPushed) {
        const n = findNode(state.nodes, id);
        if (n) {
          const snap = serializeFullState();
          for (const entry of snap.nodes) {
            if (entry[0] === id) {
              entry[1].x = n.x; entry[1].y = n.y;
              entry[1].width = n.width; entry[1].height = n.height;
              break;
            }
          }
          state.history.past.push(snap);
          if (state.history.past.length > HISTORY_LIMIT) state.history.past.shift();
          state.history.future = [];
        }
        _resizeHistoryPushed = true;
      }
      updatePuzzleNode(state.nodes, id, { rect });
      if (arrowLayer) arrowLayer.invalidateNode(id);
    },
    onHotspotResizeEnd: (id) => {
      _resizeHistoryPushed = false;
      const n = findNode(state.nodes, id);
      if (n) {
        pushNodePatch(id, { x: n.x, y: n.y, width: n.width, height: n.height });
      }
      scheduleSave();
    },
    onTransformChange: () => {
      if (arrowLayer) arrowLayer.requestDraw();
    },
    onSelectionChange: ({ ids }) => {
      state.selection = new Set(ids);
      refreshSelectionStatus();
      if (ids.length === 0 && editNodeModal && editNodeModal.isOpen()) {
        editNodeModal.requestClose();
      }
    },
    onMarqueeSelect: ({ ids }) => {
      state.selection = new Set(ids);
      refreshSelectionStatus();
    },
    onDragSelection: ({ ids, dx, dy }) => {
      applyDragSelection(ids, dx, dy, false);
    },
    onDragSelectionEnd: ({ ids, dx, dy }) => {
      applyDragSelection(ids, dx, dy, true);
    },
  });
  viewer.attachTooltip($('hotspot-tooltip'));
  onActiveToolChange(() => { if (viewer) viewer.refreshCursor(); });
  onSpaceHeldChange((held) => {
    document.body.classList.toggle('space-held', !!held);
    if (viewer) viewer.refreshCursor();
  });
}

function handleArrowDrawEnd(info) {
  if (!isLoggedIn()) { if (authUI) authUI.openLogin(); return; }
  if (!info) return;
  if (!info.moved && !info.toId) return;
  if (!arrowLayer) return;
  arrowLayer.createEdgeFromPoints({
    fromId: info.fromId || null,
    fromPt: info.fromPt,
    toId: info.toId || null,
    toPt: info.toPt,
  });
}

function setupArrowLayer() {
  arrowLayer = new ArrowLayer({
    svg: $('arrow-layer'),
    viewport: $('viewport'),
    getNodes: () => state.nodes,
    getTransform: () => viewer.getTransform(),
    onEdgesChange: () => {},
    onScheduleSave: () => scheduleSave(),
    onBeforeMutation: () => { pushHistory(); },
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
  if (viewer && typeof viewer === 'object') {
    viewer.onAnchorMouseDown = (ev, nodeId, side) => {
      if (arrowLayer && typeof arrowLayer._beginDrawEdge === 'function') {
        arrowLayer._beginDrawEdge(ev, nodeId, side);
      }
    };
  }
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
      if (editNodeModal) editNodeModal.open(viewWithLang(view, getLang()));
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
        if (editNodeModal) {
          editNodeModal.setNodeMeta(view);
          if (editNodeModal.isOpen() && editNodeModal.currentSlug() === finalSlug) {
            editNodeModal.open(view);
          }
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
  if (!n) return;
  if (n.locked) { toast(tr('node_locked_toast')); return; }
  const slug = n.slug;
  const wasFile = n.type === 'file';
  removeNode(state.nodes, id);
  if (viewer && wasFile) viewer.removeBlock(id);
  if (arrowLayer) arrowLayer.notifyNodeDeleted(id);
  refreshPuzzleViewsInViewer();
  if (viewer) viewer.notifyNodesChanged();
  if (editNodeModal && editNodeModal.isOpen() && editNodeModal.currentSlug() === slug) {
    editNodeModal.requestClose();
  }
  pushNodeDelete(id);
  scheduleSave();
  toast(tr('toast_hotspot_deleted'));
}

function refreshPuzzleViewsInViewer() {
  const lang = getLang();
  const applyBranch = (v) => {
    if (!branchesPanel) return v;
    const op = branchesPanel.computeFocusOpacity(v.branches || []);
    if (op !== 1) v.branchOpacity = op;
    return v;
  };
  viewer.setHotspots(puzzleViews(state.nodes).map((v) => applyBranch(viewWithLang(v, lang))));
  viewer.setGroups(groupViews(state.nodes).map((v) => applyBranch(viewWithLang(v, lang))));
  if (viewer) viewer.notifyNodesChanged();
  if (videoOverlay) videoOverlay.requestDraw();
  if (audioOverlay) audioOverlay.requestDraw();
  if (documentOverlay) documentOverlay.requestDraw();
}

function setupLeftRail() {
  leftRail = new LeftRail({
    handlers: {
      onModeChange: (m) => setMode(m),
      onGroupSelection: () => groupCurrentSelection(),
      onUngroup: () => ungroupCurrentSelection(),
      onDeleteSelection: () => deleteCurrentSelection(),
      onDuplicate: () => doDuplicate(),
      onToggleLock: () => toggleLockSelection(),
      onUndo: () => doUndo(),
      onRedo: () => doRedo(),
      onUploadImage: () => uploader && uploader.openFilePicker(),
      onAddVideo: () => triggerAddVideo(),
      onUploadAudio: () => triggerAddAudio(),
      getSelectionInfo: () => ({
        size: state.selection.size,
        allLocked: state.selection.size > 0 && Array.from(state.selection).every((id) => {
          const n = findNode(state.nodes, id);
          return !!(n && n.locked);
        }),
      }),
    },
  });
  leftRail.setActiveMode(state.mode);
  leftRail.setLang(getLang());
  const stored = readStoredThemeChoice();
  leftRail.setThemeChoice(stored);
  document.body.classList.toggle('rail-collapsed', leftRail.isCollapsed());
  document.addEventListener('rail:toggle', () => {
    document.body.classList.toggle('rail-collapsed', leftRail.isCollapsed());
  });
  document.addEventListener('selection:changed', () => {
    if (leftRail) leftRail.refreshSelectionGroup();
  });
  const railEl = document.getElementById('left-rail');
  if (railEl) {
    const obs = new MutationObserver(() => {
      document.body.classList.toggle('rail-collapsed', railEl.classList.contains('collapsed'));
    });
    obs.observe(railEl, { attributes: true, attributeFilter: ['class'] });
  }
}

function setupTouch() {
  const canvas = $('map-canvas');
  if (!canvas || !viewer) return;
  touchHandler = new TouchHandler({
    canvas,
    viewer,
    onTap: (cx, cy) => {
      const pt = viewer.imagePointFromClient(cx, cy);
      const target = viewer.selectableAtImagePoint ? viewer.selectableAtImagePoint(pt) : null;
      if (target) {
        const n = findNode(state.nodes, target.id);
        if (n) {
          const view = toViewShape(n);
          viewer.setActiveId(target.id);
          if (editNodeModal) editNodeModal.open(viewWithLang(view, getLang()));
        }
      }
    },
    onLongPress: (cx, cy) => {
      const pt = viewer.imagePointFromClient(cx, cy);
      const target = viewer.selectableAtImagePoint ? viewer.selectableAtImagePoint(pt) : null;
      if (target) {
        const items = buildContextMenuItemsForNode(target.id);
        if (items.length && contextMenu) contextMenu.open(cx, cy, items);
      }
    },
  });
}

function setupEditNodeModal() {
  editNodeModal = new EditNodeModal({
    panelEl: $('panel'),
    mountInto: $('panel-mount'),
    getNodes: () => state.nodes,
    getNode: (id) => findNode(state.nodes, id),
    getBranches: () => (Array.isArray(state.branches) ? state.branches : []),
    canEdit: () => isLoggedIn(),
    onSave: (payload) => persistRichEditSave(payload),
    onDelete: (id) => deletePuzzleNode(id),
    onCancel: () => {},
    onUnauthedSubmit: () => { if (authUI) authUI.openLogin(); },
    onCropImage: (id, currentUrl) => doCropImage(id, currentUrl),
    onReplaceImage: (id) => doReplaceImage(id),
    onStatusChange: (id, status) => {
      if (!isLoggedIn()) {
        const n0 = findNode(state.nodes, id);
        if (n0 && editNodeModal) editNodeModal.setNodeMeta(toViewShape(n0));
        if (authUI) authUI.openLogin();
        return;
      }
      updatePuzzleNode(state.nodes, id, { status });
      const n = findNode(state.nodes, id);
      if (!n) return;
      const view = toViewShape(n);
      if (editNodeModal) editNodeModal.setNodeMeta(view);
      refreshPuzzleViewsInViewer();
      pushNodePatch(id, { status });
      scheduleSave();
    },
    onLabelChange: (id, label) => {
      if (!isLoggedIn()) {
        const n0 = findNode(state.nodes, id);
        if (n0 && editNodeModal) editNodeModal.setNodeMeta(toViewShape(n0));
        if (authUI) authUI.openLogin();
        return;
      }
      updatePuzzleNode(state.nodes, id, { label, title: label });
      const n = findNode(state.nodes, id);
      if (!n) return;
      refreshPuzzleViewsInViewer();
      pushNodePatch(id, { label });
      scheduleSave();
    },
    onTagsChange: (id, tags) => {
      if (!isLoggedIn()) {
        const n0 = findNode(state.nodes, id);
        if (n0 && editNodeModal) editNodeModal.setNodeMeta(toViewShape(n0));
        if (authUI) authUI.openLogin();
        return;
      }
      updatePuzzleNode(state.nodes, id, { tags });
      refreshPuzzleViewsInViewer();
      pushNodePatch(id, { tags });
      scheduleSave();
    },
    onBranchesChange: (id, branches) => {
      if (!isLoggedIn()) {
        const n0 = findNode(state.nodes, id);
        if (n0 && editNodeModal) editNodeModal.setNodeMeta(toViewShape(n0));
        if (authUI) authUI.openLogin();
        return;
      }
      updatePuzzleNode(state.nodes, id, { branches });
      refreshPuzzleViewsInViewer();
      pushNodePatch(id, { branches });
      scheduleSave();
    },
    onLockToggle: (id, locked) => {
      if (!isLoggedIn()) {
        const n0 = findNode(state.nodes, id);
        if (n0 && editNodeModal) editNodeModal.setNodeMeta(toViewShape(n0));
        if (authUI) authUI.openLogin();
        return;
      }
      const n = findNode(state.nodes, id);
      if (!n) return;
      if (locked) n.locked = true;
      else delete n.locked;
      refreshPuzzleViewsInViewer();
      pushNodePatch(id, { locked: !!locked });
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
      if (viewer) viewer.setActiveId(null);
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
    onOpenFullViewer: (view) => { if (fileViewerModal && view) fileViewerModal.open(view); },
  });
  const closeBtn = $('panel-close');
  if (closeBtn) closeBtn.addEventListener('click', () => editNodeModal && editNodeModal.requestClose());
}

function setupSelectionStatus() {
  const el = document.createElement('div');
  el.id = 'selection-status';
  document.body.appendChild(el);
  selectionStatusEl = el;
  refreshSelectionStatus();
}

function refreshSelectionStatus() {
  if (!selectionStatusEl) return;
  const n = state.selection.size;
  if (n > 0 && state.mode === 'editor') {
    selectionStatusEl.textContent = tr('selection_count', { n });
    selectionStatusEl.classList.add('visible');
  } else {
    selectionStatusEl.classList.remove('visible');
  }
  try { document.dispatchEvent(new CustomEvent('selection:changed', { detail: { ids: Array.from(state.selection) } })); } catch (e) { void e; }
  if (alignFloater) alignFloater.refresh();
}

function openRichEdit(id) {
  const n = findNode(state.nodes, id);
  if (!n) return;
  const view = toViewShape(n);
  const md = nodeMarkdown(n);
  if (editNodeModal) editNodeModal.open(view, md);
}

const IMAGE_EXT_RE_APP = /\.(png|jpe?g|webp|gif|bmp)(\?.*)?$/i;
function nodeIsImageFile(n) {
  if (!n) return false;
  if (n.type !== 'file') return false;
  const f = typeof n.file === 'string' ? n.file : '';
  if (!f) return false;
  if (IMAGE_EXT_RE_APP.test(f)) return true;
  if (/\/canvas\/[^/]+\/images\//i.test(f)) return true;
  return false;
}

function setupGlobalContextMenu() {
  document.addEventListener('contextmenu', (ev) => {
    const tgt = ev.target;
    if (!tgt) return;
    if (tgt.closest && tgt.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (!isInOwnedSurface(tgt)) return;
    ev.preventDefault();
  }, true);
}

const HTML_EXT_RE = /\.(x?html?)(\?.*)?$/i;
const PDF_EXT_RE = /\.pdf(\?.*)?$/i;
const TEXT_CODE_EXT_RE = /\.(json|csv|md|txt|py|js|sh|css|xml|ts|tsx|jsx|yaml|yml|toml|ini|log)(\?.*)?$/i;

function nodeFileMime(n) {
  return (n && typeof n.mime === 'string') ? n.mime.toLowerCase() : '';
}
function nodeFileUrl(n) {
  if (!n) return '';
  if (typeof n.file === 'string' && n.file) return n.file;
  if (n.media && typeof n.media.url === 'string') return n.media.url;
  return '';
}
function nodeFileName(n) {
  if (!n) return '';
  return n.name || n.slug || n.id || '';
}
function nodeIsHtmlDocument(n) {
  if (!n || n.kind !== 'document') return false;
  const m = nodeFileMime(n);
  const url = nodeFileUrl(n);
  if (m === 'text/html') return true;
  if (HTML_EXT_RE.test(url)) return true;
  return false;
}
function nodeIsPdfDocument(n) {
  if (!n) return false;
  const m = nodeFileMime(n);
  const url = nodeFileUrl(n);
  if (m === 'application/pdf') return true;
  if (PDF_EXT_RE.test(url)) return true;
  return false;
}
function nodeIsTextDocument(n) {
  if (!n || n.kind !== 'document') return false;
  if (nodeIsHtmlDocument(n) || nodeIsPdfDocument(n)) return false;
  const m = nodeFileMime(n);
  const url = nodeFileUrl(n);
  if (/^text\//.test(m)) return true;
  if (m === 'application/json' || m === 'application/xml' || m === 'application/javascript') return true;
  if (TEXT_CODE_EXT_RE.test(url)) return true;
  return false;
}
function nodeIsVideo(n) { return !!(n && n.kind === 'video'); }
function nodeIsAudio(n) { return !!(n && n.kind === 'audio'); }

function viewerNodeForFile(n) {
  return {
    id: n.id,
    file: n.file || null,
    name: nodeFileName(n),
    slug: n.slug || n.id,
    mime: n.mime || null,
    media: n.media || null,
    kind: n.kind || null,
  };
}

function viewImageFull(id) {
  const n = findNode(state.nodes, id);
  if (!n || !fileViewerModal) return;
  fileViewerModal.open(viewerNodeForFile(n), { mode: 'image' });
}
function viewAsCode(id) {
  const n = findNode(state.nodes, id);
  if (!n || !fileViewerModal) return;
  fileViewerModal.open(viewerNodeForFile(n), { mode: 'hex' });
}
function viewAsHtmlPage(id) {
  const n = findNode(state.nodes, id);
  if (!n || !fileViewerModal) return;
  fileViewerModal.open(viewerNodeForFile(n), { mode: 'render' });
}
function viewSource(id) {
  const n = findNode(state.nodes, id);
  if (!n || !fileViewerModal) return;
  fileViewerModal.open(viewerNodeForFile(n), { mode: 'source' });
}
function viewPdf(id) {
  const n = findNode(state.nodes, id);
  if (!n || !fileViewerModal) return;
  fileViewerModal.open(viewerNodeForFile(n));
}
function viewTextFormatted(id) {
  const n = findNode(state.nodes, id);
  if (!n || !fileViewerModal) return;
  fileViewerModal.open(viewerNodeForFile(n));
}
function openFileInNewTab(id) {
  const n = findNode(state.nodes, id);
  if (!n) return;
  const url = nodeFileUrl(n);
  if (!url) return;
  try { window.open(url, '_blank', 'noopener,noreferrer'); } catch (e) { console.warn('[app] open new tab failed', e); }
}
function downloadFile(id) {
  const n = findNode(state.nodes, id);
  if (!n) return;
  const url = nodeFileUrl(n);
  if (!url) return;
  const a = document.createElement('a');
  a.href = url;
  a.download = nodeFileName(n) || 'file';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}
function copyNodeUrl(id) {
  const n = findNode(state.nodes, id);
  if (!n) return;
  const url = nodeFileUrl(n);
  if (!url) return;
  try { navigator.clipboard.writeText(url); toast(tr('admin_invitation_copied')); }
  catch (e) { void e; }
}
async function replaceVideoUrl(id) {
  if (!isLoggedIn()) { if (authUI) authUI.openLogin(); return; }
  const n = findNode(state.nodes, id);
  if (!n) return;
  const info = await openVideoUrlDialog();
  if (!info) return;
  pushHistory();
  updatePuzzleNode(state.nodes, id, { media: { ...info }, url: info.url });
  refreshPuzzleViewsInViewer();
  pushNodePatch(id, { media: { ...info }, url: info.url });
  scheduleSave();
  if (videoOverlay) videoOverlay.requestDraw();
}
function triggerMediaPlay(id) {
  const host = document.querySelector(`[data-id="${id}"]`);
  if (!host) return;
  const btn = host.querySelector('.audio-card-play, .video-placeholder-play')
    || host.querySelector('button.audio-card-play')
    || host.querySelector('.video-placeholder');
  if (btn && typeof btn.click === 'function') btn.click();
}

function appendCommonItems(items, id, n, view) {
  const selSize = state.selection.size;
  const selHasId = state.selection.has(id);
  items.push({
    label: tr('ctx_set_status'),
    submenu: statusSubmenu(view.status, (status) => setStatusForNode(id, status)),
  });
  items.push({
    label: tr(n.locked ? 'ctx_unlock' : 'ctx_lock'),
    fn: () => {
      state.selection = new Set([id]);
      if (viewer) viewer.setSelection(state.selection);
      toggleLockSelection();
    },
  });
  if (selSize > 1 && selHasId) {
    items.push({ label: tr('ctx_group'), fn: () => groupCurrentSelection() });
  } else {
    items.push({ label: tr('ctx_group'), fn: () => {
      state.selection = new Set([id]);
      if (viewer) viewer.setSelection(state.selection);
      groupCurrentSelection();
    } });
  }
  if (n.parent) {
    items.push({ label: tr('ctx_ungroup'), fn: () => {
      const parentId = n.parent;
      ungroupGroup(parentId);
    } });
  }
}

function buildContextMenuItemsForNode(id) {
  const n = findNode(state.nodes, id);
  if (!n) return [];
  const view = toViewShape(n);
  const items = [];
  const selSize = state.selection.size;
  const selHasId = state.selection.has(id);

  if (selSize > 1 && selHasId) {
    items.push({ label: tr('ctx_group_selection'), fn: () => groupCurrentSelection() });
    items.push({ label: tr('ctx_delete_selected'), danger: true, fn: () => deleteCurrentSelection() });
    return items;
  }

  if (isGroupNode(n)) {
    items.push({ label: tr('ctx_edit'), fn: () => openRichEdit(id) });
    items.push({ label: tr('ctx_group_rename'), fn: () => renameGroupPrompt(id) });
    items.push({ label: tr('ctx_group_set_background'), fn: () => setGroupBackgroundPrompt(id) });
    items.push({ label: tr('ctx_group_set_color'), fn: () => setGroupColorPrompt(id) });
    items.push({ kind: 'separator' });
    items.push({ label: tr('ctx_group_ungroup'), fn: () => ungroupGroup(id) });
    items.push({ label: tr('ctx_group_delete_keep_children'), fn: () => deleteGroupKeepChildren(id) });
    items.push({ label: tr('ctx_group_delete_with_children'), danger: true, fn: () => deleteGroupWithChildren(id) });
    return items;
  }

  const editorOpenForThis = !!(editNodeModal && editNodeModal.isOpen && editNodeModal.isOpen()
    && editNodeModal.currentView && editNodeModal.currentView.id === id);
  if ((isEditableNode(n) || isPuzzleNode(n) || isStickyNode(n) || isBlockNode(n)) && !editorOpenForThis) {
    items.push({ label: tr('ctx_edit'), fn: () => openRichEdit(id) });
  }

  if (nodeIsImageFile(n)) {
    items.push({ label: tr('ctx_view_image'), fn: () => viewImageFull(id) });
    items.push({ label: tr('ctx_view_as_code'), fn: () => viewAsCode(id) });
    items.push({ label: tr('ctx_crop'), fn: () => doCropImage(id, n.file) });
    items.push({ label: tr('ctx_replace_image'), fn: () => doReplaceImage(id) });
    items.push({ kind: 'separator' });
    appendCommonItems(items, id, n, view);
  } else if (nodeIsHtmlDocument(n)) {
    items.push({ label: tr('ctx_view_as_page'), fn: () => viewAsHtmlPage(id) });
    items.push({ label: tr('ctx_view_source'), fn: () => viewSource(id) });
    items.push({ label: tr('ctx_open_new_tab'), fn: () => openFileInNewTab(id) });
    items.push({ kind: 'separator' });
    appendCommonItems(items, id, n, view);
  } else if (nodeIsPdfDocument(n)) {
    items.push({ label: tr('ctx_view_pdf'), fn: () => viewPdf(id) });
    items.push({ label: tr('ctx_download'), fn: () => downloadFile(id) });
    items.push({ kind: 'separator' });
    appendCommonItems(items, id, n, view);
  } else if (nodeIsTextDocument(n)) {
    items.push({ label: tr('ctx_view_formatted'), fn: () => viewTextFormatted(id) });
    items.push({ label: tr('ctx_view_as_hex'), fn: () => viewAsCode(id) });
    items.push({ label: tr('ctx_download'), fn: () => downloadFile(id) });
    items.push({ kind: 'separator' });
    appendCommonItems(items, id, n, view);
  } else if (nodeIsVideo(n)) {
    items.push({ label: tr('ctx_play'), fn: () => triggerMediaPlay(id) });
    items.push({ label: tr('ctx_replace_url'), fn: () => replaceVideoUrl(id) });
    items.push({ label: tr('ctx_copy_url'), fn: () => copyNodeUrl(id) });
    items.push({ kind: 'separator' });
    appendCommonItems(items, id, n, view);
  } else if (nodeIsAudio(n)) {
    items.push({ label: tr('ctx_play_pause'), fn: () => triggerMediaPlay(id) });
    items.push({ label: tr('ctx_replace_audio'), fn: () => doReplaceAudio(id) });
    items.push({ kind: 'separator' });
    appendCommonItems(items, id, n, view);
  } else {
    appendCommonItems(items, id, n, view);
  }

  const brSub = buildBranchSubmenu(id);
  if (brSub && brSub.length) {
    items.push({ kind: 'separator' });
    items.push({ label: tr('branches_add_to_node'), submenu: brSub });
  }
  items.push({ kind: 'separator' });
  items.push({ label: tr('ctx_delete'), danger: true, fn: () => deletePuzzleNode(id) });
  return items;
}

let _replaceAudioPicker = null;
function doReplaceAudio(nodeId) {
  if (!isLoggedIn()) { if (authUI) authUI.openLogin(); return; }
  const n = findNode(state.nodes, nodeId);
  if (!n) return;
  if (!_replaceAudioPicker) {
    _replaceAudioPicker = document.createElement('input');
    _replaceAudioPicker.type = 'file';
    _replaceAudioPicker.accept = 'audio/mpeg,audio/mp3,audio/ogg,audio/wav,audio/x-wav,audio/webm,audio/aac,audio/flac';
    _replaceAudioPicker.style.display = 'none';
    document.body.appendChild(_replaceAudioPicker);
  }
  const input = _replaceAudioPicker;
  input.value = '';
  input.onchange = async () => {
    const file = input.files && input.files[0];
    input.onchange = null;
    if (!file) return;
    try {
      const uploaded = await apiUploadImage(file, file.name);
      if (!uploaded || !uploaded.url) return;
      pushHistory();
      const currentNode = findNode(state.nodes, nodeId);
      if (!currentNode) return;
      const nextMedia = { ...(currentNode.media || {}), kind: 'audio', url: uploaded.url, provider: 'local' };
      updatePuzzleNode(state.nodes, nodeId, { file: uploaded.url, media: nextMedia, mime: file.type || currentNode.mime });
      refreshPuzzleViewsInViewer();
      pushNodePatch(nodeId, { file: uploaded.url, media: nextMedia, mime: file.type || currentNode.mime });
      if (audioOverlay) audioOverlay.requestDraw();
      scheduleSave();
      toast(tr('toast_hotspot_updated'));
    } catch (e) {
      if (e && e.kind === 'auth_expired') {
        if (authUI) authUI.openLogin();
      } else {
        toast(tr('upload_image_failed'), 'error');
        console.warn('[app] audio replace failed', e);
      }
    }
  };
  input.click();
}

function buildBranchSubmenu(nodeId) {
  const node = findNode(state.nodes, nodeId);
  if (!node) return [];
  const list = state.branches || [];
  if (!list.length) return [];
  const cur = new Set(Array.isArray(node.branches) ? node.branches : []);
  return list.map((b) => ({
    label: (cur.has(b.id) ? '✓ ' : '   ') + (b.label || b.id),
    fn: () => toggleNodeBranch(nodeId, b.id),
  }));
}

function toggleNodeBranch(nodeId, branchId) {
  if (!isLoggedIn()) { if (authUI) authUI.openLogin(); return; }
  const node = findNode(state.nodes, nodeId);
  if (!node) return;
  const cur = Array.isArray(node.branches) ? node.branches.slice() : [];
  const idx = cur.indexOf(branchId);
  if (idx >= 0) cur.splice(idx, 1);
  else cur.push(branchId);
  updatePuzzleNode(state.nodes, nodeId, { branches: cur });
  refreshPuzzleViewsInViewer();
  pushNodePatch(nodeId, { branches: cur });
  scheduleSave();
}

function buildContextMenuItemsForEmpty() {
  const items = [];
  if (state.selection.size === 0) return items;
  if (state.selection.size > 1) {
    items.push({ label: tr('ctx_group_selection'), fn: () => groupCurrentSelection() });
    items.push({ label: tr('ctx_delete_selected'), danger: true, fn: () => deleteCurrentSelection() });
  } else {
    items.push({ label: tr('ctx_delete'), danger: true, fn: () => deleteCurrentSelection() });
  }
  return items;
}

function setStatusForNode(id, status) {
  if (!isLoggedIn()) { if (authUI) authUI.openLogin(); return; }
  const n = findNode(state.nodes, id);
  if (!n) return;
  updatePuzzleNode(state.nodes, id, { status });
  refreshPuzzleViewsInViewer();
  pushNodePatch(id, { status });
  scheduleSave();
  toast(tr('node_status_changed', { status: statusLabel(status) }));
}

function renameGroupPrompt(id) {
  if (!isLoggedIn()) { if (authUI) authUI.openLogin(); return; }
  const n = findNode(state.nodes, id);
  if (!n || !isGroupNode(n)) return;
  const next = window.prompt(tr('group_rename_prompt'), n.label || '');
  if (next === null) return;
  updatePuzzleNode(state.nodes, id, { label: next, title: next });
  refreshPuzzleViewsInViewer();
  pushNodePatch(id, { label: next });
  scheduleSave();
}

function setGroupColorPrompt(id) {
  if (!isLoggedIn()) { if (authUI) authUI.openLogin(); return; }
  const n = findNode(state.nodes, id);
  if (!n || !isGroupNode(n)) return;
  const next = window.prompt(tr('group_set_color_prompt'), n.color || '');
  if (next === null) return;
  updatePuzzleNode(state.nodes, id, { color: next || '' });
  refreshPuzzleViewsInViewer();
  pushNodePatch(id, { color: next || '' });
  scheduleSave();
}

function setGroupBackgroundPrompt(id) {
  if (!isLoggedIn()) { if (authUI) authUI.openLogin(); return; }
  const n = findNode(state.nodes, id);
  if (!n || !isGroupNode(n)) return;
  const next = window.prompt(tr('group_set_background_prompt'), n.background || '');
  if (next === null) return;
  updatePuzzleNode(state.nodes, id, { background: next || '' });
  refreshPuzzleViewsInViewer();
  pushNodePatch(id, { background: next || '' });
  scheduleSave();
}

function setupUploader() {
  uploader = new Uploader({
    viewport: $('viewport'),
    canvasEl: $('map-canvas'),
    isEnabled: () => isLoggedIn() && state.backendOnline,
    toClientToImage: (cx, cy) => viewer ? viewer.imagePointFromClient(cx, cy) : null,
    onPickerCancel: () => setActiveTool('select'),
    onUpload: async (file) => {
      if (!isLoggedIn()) {
        if (authUI) authUI.openLogin();
        throw Object.assign(new Error('auth_required'), { kind: 'auth_expired' });
      }
      return apiUploadImage(file, file.name);
    },
    onPlaceNode: async (placement) => placeUploadedImageNode(placement),
    onToast: (msg, kind) => toast(msg, kind),
    onConfirm: (msg) => confirmAudioOversize(msg),
  });
}

function confirmAudioOversize(msg) {
  return new Promise((resolve) => {
    const modal = $('confirm-modal'), titleEl = $('confirm-title');
    const messageEl = $('confirm-message'), actionsEl = $('confirm-actions');
    const wordIn = $('confirm-word-input');
    if (!modal || !titleEl || !actionsEl) { resolve(window.confirm(msg)); return; }
    titleEl.textContent = tr('upload_large_audio_warning', { size: '' });
    messageEl.textContent = msg;
    actionsEl.innerHTML = '';
    if (wordIn) wordIn.style.display = 'none';
    const close = () => modal.classList.remove('open');
    const cancel = document.createElement('button');
    cancel.className = 'modal-btn cancel';
    cancel.textContent = tr('upload_large_audio_cancel');
    cancel.addEventListener('click', () => { close(); resolve(false); });
    const ok = document.createElement('button');
    ok.className = 'modal-btn primary';
    ok.textContent = tr('upload_large_audio_continue');
    ok.addEventListener('click', () => { close(); resolve(true); });
    actionsEl.appendChild(cancel); actionsEl.appendChild(ok);
    modal.classList.add('open');
  });
}

async function placeUploadedImageNode(placement) {
  if (!placement || !placement.file) return null;
  const baseId = placement.name || 'image';
  const placementKind = placement.kind || (isVideoMime(placement.mime) ? 'video' : 'image');
  const prefixMap = { video: 'video', audio: 'audio', document: 'doc' };
  const id = uniqueId(state.nodes, `${prefixMap[placementKind] || 'img'}-${baseId}`);
  const parent = nodeAtParentLookup(state.nodes, placement.rect);
  const rect = placement.rect;
  const base = {
    id, type: 'file',
    x: rect.x, y: rect.y, width: rect.w, height: rect.h,
    file: placement.file, status: 'no-data', tags: [], slug: id,
  };
  let node;
  if (placementKind === 'video') {
    node = { ...base, kind: 'video', mime: placement.mime,
      media: { kind: 'video', url: placement.file, provider: 'local' } };
  } else if (placementKind === 'audio') {
    node = { ...base, kind: 'audio', mime: placement.mime, name: placement.name || 'audio',
      media: { kind: 'audio', url: placement.file, provider: 'local', volume_default: 0.5 } };
  } else if (placementKind === 'document') {
    node = { ...base, kind: 'document', mime: placement.mime, name: placement.name || 'document' };
  } else {
    node = { ...base, kind: 'block' };
  }
  if (parent) node.parent = parent;
  state.nodes.set(id, node);
  if (viewer && placementKind === 'image') await viewer.addBlock({ id, rect, file: placement.file });
  refreshPuzzleViewsInViewer();
  if (viewer) viewer.notifyNodesChanged();
  if (placementKind !== 'image') renderVideoOverlay();
  if (state.backendOnline && isLoggedIn()) {
    trackSelfMutation('node_created', id);
    try {
      const res = await apiCreateNode({ ...node });
      if (res && typeof res.revision === 'number') state.revision = res.revision;
    } catch (e) {
      if (e && e.kind !== 'auth_expired') console.warn('[app] image node create', e);
    }
  }
  scheduleSave();
  setActiveTool('select');
  return id;
}

function doCropImage(nodeId, currentUrl) {
  if (!isLoggedIn()) { if (authUI) authUI.openLogin(); return Promise.resolve(null); }
  if (!currentUrl) return Promise.resolve(null);
  const n = findNode(state.nodes, nodeId);
  if (!n) return Promise.resolve(null);
  if (!cropOverlay) return doCropImageFallback(nodeId, currentUrl);
  if (cropOverlay.isActive()) return Promise.resolve(null);
  return new Promise((resolve) => {
    const node = { x: n.x, y: n.y, width: n.width, height: n.height };
    cropOverlay.onApply = async (blob) => {
      if (!blob) { resolve(null); return; }
      try {
        const uploaded = await apiUploadImage(blob, 'crop.webp');
        if (!uploaded || !uploaded.url) { resolve(null); return; }
        pushHistory();
        await replaceImageForNode(nodeId, uploaded.url);
        resolve(uploaded.url);
      } catch (e) {
        if (e && e.kind === 'auth_expired') {
          if (authUI) authUI.openLogin();
        } else {
          toast(tr('upload_image_failed'), 'error');
          console.warn('[app] crop upload failed', e);
        }
        resolve(null);
      }
    };
    cropOverlay.onCancel = () => resolve(null);
    cropOverlay.open(node, currentUrl);
  });
}

async function doCropImageFallback(nodeId, currentUrl) {
  const blob = await openCropper(currentUrl);
  if (!blob) return null;
  try {
    const uploaded = await apiUploadImage(blob, 'crop.webp');
    if (!uploaded || !uploaded.url) return null;
    pushHistory();
    await replaceImageForNode(nodeId, uploaded.url);
    return uploaded.url;
  } catch (e) {
    if (e && e.kind === 'auth_expired') {
      if (authUI) authUI.openLogin();
    } else {
      toast(tr('upload_image_failed'), 'error');
      console.warn('[app] crop upload failed', e);
    }
    return null;
  }
}

function doReplaceImage(nodeId) {
  if (!isLoggedIn()) { if (authUI) authUI.openLogin(); return Promise.resolve(null); }
  return new Promise((resolve) => {
    if (!replaceImagePicker) {
      replaceImagePicker = document.createElement('input');
      replaceImagePicker.type = 'file';
      replaceImagePicker.accept = 'image/png,image/jpeg,image/webp';
      replaceImagePicker.style.display = 'none';
      document.body.appendChild(replaceImagePicker);
    }
    const input = replaceImagePicker;
    const cleanup = () => { input.onchange = null; };
    input.value = '';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      cleanup();
      if (!file) { resolve(null); return; }
      const invalid = validateImageFile(file);
      if (invalid === 'invalid_type') { toast(tr('upload_image_invalid_type'), 'error'); resolve(null); return; }
      if (invalid === 'too_large')   { toast(tr('upload_image_too_large'),  'error'); resolve(null); return; }
      try {
        let blob = file;
        let name = file.name;
        if (file.type !== 'image/webp') {
          const converted = await convertImageBlobToWebP(file);
          if (converted) {
            blob = converted;
            name = (file.name || 'image').replace(/\.[^.]+$/, '') + '.webp';
          }
        }
        const uploaded = await apiUploadImage(blob, name);
        if (!uploaded || !uploaded.url) { resolve(null); return; }
        pushHistory();
        await replaceImageForNode(nodeId, uploaded.url);
        resolve(uploaded.url);
      } catch (e) {
        if (e && e.kind === 'auth_expired') {
          if (authUI) authUI.openLogin();
        } else {
          toast(tr('upload_image_failed'), 'error');
          console.warn('[app] replace upload failed', e);
        }
        resolve(null);
      }
    };
    input.click();
  });
}

async function replaceImageForNode(nodeId, newUrl) {
  const n = findNode(state.nodes, nodeId);
  if (!n) return;
  n.file = newUrl;
  if (viewer) {
    await viewer.refreshBlock({ id: nodeId, rect: { x: n.x, y: n.y, w: n.width, h: n.height }, file: newUrl });
  }
  refreshPuzzleViewsInViewer();
  if (viewer) viewer.notifyNodesChanged();
  if (state.backendOnline && isLoggedIn()) {
    trackSelfMutation('node_updated', nodeId);
    try {
      const res = await apiPatchNode(nodeId, { file: newUrl });
      if (res && typeof res.revision === 'number') state.revision = res.revision;
    } catch (e) {
      if (e && e.kind !== 'auth_expired') console.warn('[app] replace patch failed', e);
    }
  }
  scheduleSave();
  toast(tr('toast_hotspot_updated'));
}

function handleDrawRect(rect) {
  if (!isLoggedIn()) { if (authUI) authUI.openLogin(); return; }
  const createMode = rect.mode || getActiveTool() || 'block';
  if (rect.clickOnly) {
    if (createMode === 'block') {
      const placed = { x: Math.round(rect.x), y: Math.round(rect.y), w: 220, h: 140 };
      createBlockAtPoint(placed);
      return;
    }
    if (createMode === 'sticky') {
      const placed = { x: Math.round(rect.x - 100), y: Math.round(rect.y - 70), w: 200, h: 140 };
      createStickyFromRect(placed);
      return;
    }
    if (createMode === 'text') {
      const placed = { x: Math.round(rect.x), y: Math.round(rect.y), w: 280, h: 80 };
      createTextFromRect(placed);
      return;
    }
    return;
  }
  if (createMode === 'group') {
    createGroupFromRect(rect);
    return;
  }
  if (createMode === 'sticky') {
    createStickyFromRect(rect);
    return;
  }
  if (createMode === 'text') {
    createTextFromRect(rect);
    return;
  }
  editorModal.openCreate(rect, {
    md: '# New puzzle\n\n## Status\nunsolved\n\n## TLDR\n\n## Background\n\n## Current state\n\n## Techniques tried\n\n## References\n\n## Open questions\n',
  });
}

function createBlockAtPoint(rect) {
  pushHistory();
  const id = uniqueId(state.nodes, 'block');
  const title = `Block ${state.nodes.size + 1}`;
  const parent = nodeAtParentLookup(state.nodes, rect);
  addPuzzleNode(state.nodes, {
    id,
    title,
    slug: id,
    status: 'unsolved',
    tags: [],
    rect,
    md: `# ${title}\n`,
    parent,
  });
  setCachedMarkdown(id, `# ${title}\n`);
  refreshPuzzleViewsInViewer();
  const newNode = findNode(state.nodes, id);
  if (newNode) pushNodeCreate(toViewShape(newNode), `# ${title}\n`);
  scheduleSave();
  toast(tr('node_created'));
}

function createTextFromRect(rect) {
  pushHistory();
  const id = uniqueId(state.nodes, 'text');
  const parent = nodeAtParentLookup(state.nodes, rect);
  const initRect = (rect && rect.w >= 40 && rect.h >= 40)
    ? rect
    : { x: rect.x, y: rect.y, w: Math.max(rect.w || 0, 280), h: Math.max(rect.h || 0, 80) };
  const md = '';
  addTextNode(state.nodes, { id, rect: initRect, md, parent });
  refreshPuzzleViewsInViewer();
  const newNode = findNode(state.nodes, id);
  if (newNode) pushNodeCreate(toViewShape(newNode), md);
  scheduleSave();
  toast(tr('node_created'));
  if (editNodeModal) {
    const view = toViewShape(newNode);
    editNodeModal.open(view, md);
  }
}

function createStickyFromRect(rect) {
  pushHistory();
  const id = uniqueId(state.nodes, 'sticky');
  const parent = nodeAtParentLookup(state.nodes, rect);
  const md = `# Sticky\n`;
  addStickyNode(state.nodes, { id, title: 'Sticky', slug: id, status: 'no-data', tags: [], rect, md, parent, color: '3' });
  refreshPuzzleViewsInViewer();
  const newNode = findNode(state.nodes, id);
  if (newNode) pushNodeCreate(toViewShape(newNode), md);
  scheduleSave();
  toast(tr('node_created'));
}

function createGroupFromRect(rect) {
  pushHistory();
  const id = uniqueId(state.nodes, 'group');
  const label = tr('group_default_label', { n: nextGroupLabel(state.nodes) });
  addGroupNode(state.nodes, { id, label, rect });
  refreshPuzzleViewsInViewer();
  const n = findNode(state.nodes, id);
  if (n) pushNodeCreate(toViewShape(n), '');
  scheduleSave();
  toast(tr('node_created'));
}

function applyDragSelection(ids, dx, dy, commit) {
  if (!ids || !ids.length) return;
  if (!isLoggedIn()) return;
  const allIds = new Set();
  for (const id of ids) {
    allIds.add(id);
    const n = findNode(state.nodes, id);
    if (n && isGroupNode(n)) {
      for (const sid of groupDescendantIds(state.nodes, id)) allIds.add(sid);
    }
  }
  if (!applyDragSelection._orig) applyDragSelection._orig = new Map();
  const orig = applyDragSelection._orig;
  for (const id of allIds) {
    const n = findNode(state.nodes, id);
    if (!n) continue;
    if (!orig.has(id)) orig.set(id, { x: n.x, y: n.y });
    const o = orig.get(id);
    n.x = o.x + dx;
    n.y = o.y + dy;
    if (arrowLayer) arrowLayer.invalidateNode(id);
    if (viewer && n.kind === 'block' && typeof viewer.updateBlockRect === 'function') {
      viewer.updateBlockRect(id, { x: n.x, y: n.y, w: n.width, h: n.height });
    }
  }
  if (snapGuides && !commit) {
    const otherRects = [];
    for (const n of state.nodes.values()) {
      if (allIds.has(n.id)) continue;
      otherRects.push({ x: n.x, y: n.y, w: n.width, h: n.height });
    }
    const dragRect = computeUnionBbox(Array.from(allIds));
    if (dragRect) {
      const guides = computeSnapGuides(dragRect, otherRects);
      snapGuides.show(guides);
    }
  }
  refreshPuzzleViewsInViewer();
  if (commit) {
    if (snapGuides) snapGuides.clear();
    pushHistoryForDragCommit(allIds);
    for (const id of allIds) {
      const n = findNode(state.nodes, id);
      if (!n) continue;
      pushNodePatch(id, { x: n.x, y: n.y });
    }
    applyDragSelection._orig = null;
    scheduleSave();
  }
}

function pushHistoryForDragCommit(allIds) {
  const orig = applyDragSelection._orig;
  if (!orig || orig.size === 0) return;
  const snap = serializeFullState();
  for (const entry of snap.nodes) {
    const id = entry[0];
    const node = entry[1];
    if (orig.has(id)) {
      const o = orig.get(id);
      node.x = o.x;
      node.y = o.y;
    }
  }
  state.history.past.push(snap);
  if (state.history.past.length > HISTORY_LIMIT) state.history.past.shift();
  state.history.future = [];
  void allIds;
}

function computeSnapGuides(dragRect, otherRects) {
  const SNAP = 4;
  const out = [];
  const dragXs = [
    { v: dragRect.x, role: 'left' },
    { v: dragRect.x + dragRect.w, role: 'right' },
    { v: dragRect.x + dragRect.w / 2, role: 'centerH' },
  ];
  const dragYs = [
    { v: dragRect.y, role: 'top' },
    { v: dragRect.y + dragRect.h, role: 'bottom' },
    { v: dragRect.y + dragRect.h / 2, role: 'middleV' },
  ];
  for (const r of otherRects) {
    const xs = [r.x, r.x + r.w, r.x + r.w / 2];
    const ys = [r.y, r.y + r.h, r.y + r.h / 2];
    for (const d of dragXs) for (const ox of xs) {
      if (Math.abs(d.v - ox) <= SNAP) {
        out.push({ x1: ox, y1: Math.min(dragRect.y, r.y) - 30, x2: ox, y2: Math.max(dragRect.y + dragRect.h, r.y + r.h) + 30 });
      }
    }
    for (const d of dragYs) for (const oy of ys) {
      if (Math.abs(d.v - oy) <= SNAP) {
        out.push({ x1: Math.min(dragRect.x, r.x) - 30, y1: oy, x2: Math.max(dragRect.x + dragRect.w, r.x + r.w) + 30, y2: oy });
      }
    }
  }
  return out;
}

function groupCurrentSelection() {
  if (!isLoggedIn()) { if (authUI) authUI.openLogin(); return; }
  if (state.selection.size === 0) return;
  pushHistory();
  const ids = Array.from(state.selection);
  const rect = computeUnionBbox(ids);
  if (!rect) return;
  const pad = 24;
  const expandedRect = { x: rect.x - pad, y: rect.y - pad, w: rect.w + pad * 2, h: rect.h + pad * 2 };
  const newId = uniqueId(state.nodes, 'group');
  const label = tr('group_default_label', { n: nextGroupLabel(state.nodes) });
  addGroupNode(state.nodes, { id: newId, label, rect: expandedRect });
  for (const id of ids) {
    const n = findNode(state.nodes, id);
    if (n) {
      n.parent = newId;
      pushNodePatch(id, { parent: newId });
    }
  }
  state.selection = new Set([newId]);
  if (viewer) viewer.setSelection(state.selection);
  refreshPuzzleViewsInViewer();
  refreshSelectionStatus();
  const g = findNode(state.nodes, newId);
  if (g) pushNodeCreate(toViewShape(g), '');
  scheduleSave();
  toast(tr('node_created'));
}

function ungroupCurrentSelection() {
  if (!isLoggedIn()) { if (authUI) authUI.openLogin(); return; }
  for (const id of Array.from(state.selection)) {
    const n = findNode(state.nodes, id);
    if (n && isGroupNode(n)) ungroupGroup(id);
  }
}

function ungroupGroup(groupId, opts) {
  if (!isLoggedIn()) { if (authUI) authUI.openLogin(); return; }
  const g = findNode(state.nodes, groupId);
  if (!g || !isGroupNode(g)) return;
  if (!opts || !opts.skipHistory) pushHistory();
  const children = [];
  for (const n of state.nodes.values()) {
    if (n.parent === groupId) {
      children.push(n.id);
      delete n.parent;
      pushNodePatch(n.id, { parent: null });
    }
  }
  removeNode(state.nodes, groupId);
  pushNodeDelete(groupId);
  state.selection = new Set(children);
  if (viewer) viewer.setSelection(state.selection);
  if (arrowLayer) arrowLayer.notifyNodeDeleted(groupId);
  refreshPuzzleViewsInViewer();
  refreshSelectionStatus();
  scheduleSave();
}

function deleteGroupWithChildren(groupId) {
  if (!isLoggedIn()) { if (authUI) authUI.openLogin(); return; }
  const g = findNode(state.nodes, groupId);
  if (!g || !isGroupNode(g)) return;
  pushHistory();
  const desc = groupDescendantIds(state.nodes, groupId);
  for (const cid of desc) {
    removeNode(state.nodes, cid);
    pushNodeDelete(cid);
    if (arrowLayer) arrowLayer.notifyNodeDeleted(cid);
  }
  removeNode(state.nodes, groupId);
  pushNodeDelete(groupId);
  if (arrowLayer) arrowLayer.notifyNodeDeleted(groupId);
  state.selection = new Set();
  if (viewer) viewer.setSelection(state.selection);
  refreshPuzzleViewsInViewer();
  refreshSelectionStatus();
  scheduleSave();
}

function deleteGroupKeepChildren(groupId, opts) {
  ungroupGroup(groupId, opts);
}

function deleteCurrentSelection() {
  if (!isLoggedIn()) { if (authUI) authUI.openLogin(); return; }
  if (state.selection.size === 0) return;
  const n = state.selection.size;
  if (n > 1) {
    editorModal.showConfirm({
      title: tr('editor_delete_title'),
      message: tr('delete_selection_prompt', { n }),
      actions: [
        { label: tr('editor_cancel_button'), kind: 'cancel', fn: () => editorModal.hideConfirm() },
        { label: tr('editor_delete_button'), kind: 'danger', fn: () => {
          editorModal.hideConfirm();
          _performDeleteSelection();
        } },
      ],
    });
    return;
  }
  _performDeleteSelection();
}

function _performDeleteSelection() {
  pushHistory();
  let skippedLocked = 0;
  for (const id of Array.from(state.selection)) {
    const n = findNode(state.nodes, id);
    if (!n) continue;
    if (n.locked) { skippedLocked++; continue; }
    if (isGroupNode(n)) deleteGroupKeepChildren(id, { skipHistory: true });
    else deletePuzzleNode(id);
  }
  state.selection = new Set();
  if (viewer) viewer.setSelection(state.selection);
  refreshSelectionStatus();
  if (skippedLocked > 0) toast(tr('node_locked_toast'));
}

function toggleLockSelection() {
  if (!isLoggedIn()) { if (authUI) authUI.openLogin(); return; }
  if (state.selection.size === 0) return;
  pushHistory();
  const ids = Array.from(state.selection);
  const anyUnlocked = ids.some((id) => {
    const n = findNode(state.nodes, id);
    return n && !n.locked;
  });
  const targetLocked = anyUnlocked;
  for (const id of ids) {
    const n = findNode(state.nodes, id);
    if (!n) continue;
    if (targetLocked) n.locked = true;
    else delete n.locked;
    pushNodePatch(id, { locked: !!targetLocked });
  }
  refreshPuzzleViewsInViewer();
  refreshSelectionStatus();
  scheduleSave();
  toast(tr(targetLocked ? 'node_locked_done' : 'node_unlocked_done'));
}

function computeUnionBbox(ids) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let any = false;
  for (const id of ids) {
    const n = findNode(state.nodes, id);
    if (!n) continue;
    any = true;
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x + n.width  > maxX) maxX = n.x + n.width;
    if (n.y + n.height > maxY) maxY = n.y + n.height;
  }
  if (!any) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function pushHistory() {
  const snap = serializeFullState();
  state.history.past.push(snap);
  if (state.history.past.length > HISTORY_LIMIT) state.history.past.shift();
  state.history.future = [];
}

function serializeNodes() {
  return serializeFullState();
}

function serializeFullState() {
  return {
    nodes: Array.from(state.nodes.entries()).map(([id, n]) => [id, JSON.parse(JSON.stringify(n))]),
    edges: arrowLayer && typeof arrowLayer.serializeEdges === 'function' ? arrowLayer.serializeEdges() : [],
    branches: Array.isArray(state.branches) ? JSON.parse(JSON.stringify(state.branches)) : [],
  };
}

function restoreNodes(snap) {
  restoreFullState(snap);
}

function restoreFullState(snap) {
  if (!snap) return;
  const prevNodes = state.nodes;
  const prevEdges = arrowLayer ? new Map(arrowLayer.edges) : new Map();
  if (Array.isArray(snap.nodes)) state.nodes = new Map(snap.nodes);
  if (Array.isArray(snap.branches)) state.branches = JSON.parse(JSON.stringify(snap.branches));
  if (arrowLayer && Array.isArray(snap.edges)) {
    arrowLayer.replaceAllEdges(snap.edges);
    state.edges = arrowLayer.edges;
  }
  refreshPuzzleViewsInViewer();
  if (viewer) viewer.notifyNodesChanged();
  if (arrowLayer) arrowLayer.requestDraw();
  if (branchesPanel) branchesPanel.setBranches();
  syncRestoredStateToBackend(prevNodes, prevEdges);
}

function syncRestoredStateToBackend(prevNodes, prevEdges) {
  if (!state.backendOnline || !isLoggedIn()) return;
  const nextEdges = arrowLayer ? arrowLayer.edges : new Map();
  for (const [id, n] of state.nodes.entries()) {
    const prev = prevNodes.get(id);
    if (!prev) {
      pushNodeCreate(toViewShape(n), nodeMarkdown(n) || '');
      continue;
    }
    if (JSON.stringify(prev) !== JSON.stringify(n)) {
      pushNodePatch(id, nodePatchPayload(n));
    }
  }
  for (const [id] of prevNodes.entries()) {
    if (!state.nodes.has(id)) pushNodeDelete(id);
  }
  for (const [id, e] of nextEdges.entries()) {
    const prev = prevEdges.get(id);
    if (!prev) {
      pushEdgeCreate(e);
      continue;
    }
    if (JSON.stringify(prev) !== JSON.stringify(e)) {
      pushEdgePatch(id, e);
    }
  }
  for (const [id] of prevEdges.entries()) {
    if (!nextEdges.has(id)) pushEdgeDelete(id);
  }
}

function nodePatchPayload(n) {
  const payload = {
    x: n.x, y: n.y, width: n.width, height: n.height,
    status: n.status, tags: n.tags || [], label: n.label, color: n.color,
    parent: n.parent || null, caption: n.caption || null,
    translations: n.translations || null, text_style: n.text_style || null,
    media: n.media || null, branches: Array.isArray(n.branches) ? n.branches : [],
    kind: n.kind || null, locked: !!n.locked,
  };
  if (typeof n.file === 'string') payload.file = n.file;
  if (typeof n.text === 'string') payload.text = n.text;
  if (typeof n.mime === 'string') payload.mime = n.mime;
  if (typeof n.name === 'string') payload.name = n.name;
  if (typeof n.background === 'string') payload.background = n.background;
  if (typeof n.url === 'string') payload.url = n.url;
  return payload;
}

async function pushEdgeCreate(edge) {
  if (!state.backendOnline || !isLoggedIn()) return;
  try {
    trackSelfMutation('edge_created', edge.id);
    const r = await apiCreateEdge({ ...edge });
    if (r && typeof r.revision === 'number') state.revision = r.revision;
  } catch (e) {
    if (e && e.kind !== 'auth_expired') console.warn('[app] edge create (restore) failed', e);
  }
}
async function pushEdgePatch(id, edge) {
  if (!state.backendOnline || !isLoggedIn()) return;
  try {
    trackSelfMutation('edge_updated', id);
    const r = await apiPatchEdge(id, { ...edge });
    if (r && typeof r.revision === 'number') state.revision = r.revision;
  } catch (e) {
    if (e && e.kind !== 'auth_expired') console.warn('[app] edge patch (restore) failed', e);
  }
}
async function pushEdgeDelete(id) {
  if (!state.backendOnline || !isLoggedIn()) return;
  try {
    trackSelfMutation('edge_deleted', id);
    const r = await apiDeleteEdge(id);
    if (r && typeof r.revision === 'number') state.revision = r.revision;
  } catch (e) {
    if (e && e.kind !== 'auth_expired') console.warn('[app] edge delete (restore) failed', e);
  }
}

function doUndo() {
  if (!isLoggedIn()) { if (authUI) authUI.openLogin(); return; }
  if (state.history.past.length === 0) return;
  state.history.future.push(serializeFullState());
  const snap = state.history.past.pop();
  restoreFullState(snap);
  scheduleSave();
}

function doRedo() {
  if (!isLoggedIn()) { if (authUI) authUI.openLogin(); return; }
  if (state.history.future.length === 0) return;
  state.history.past.push(serializeFullState());
  const snap = state.history.future.pop();
  restoreFullState(snap);
  scheduleSave();
}

function persistRichEditSave(payload) {
  if (!payload || !payload.id) return;
  const n = findNode(state.nodes, payload.id);
  if (!n) return;
  pushHistory();
  const patch = {
    title: payload.title,
    status: payload.status,
    tags: payload.tags,
    color: payload.color || undefined,
    caption: payload.caption,
    parent: payload.parent,
    translations: payload.translations || null,
    text_style: payload.text_style || null,
    media: payload.media || null,
    branches: Array.isArray(payload.branches) ? payload.branches : [],
  };
  if (isPuzzleNode(n) || isStickyNode(n) || isTextNode(n)) {
    patch.md = payload.md;
  } else if (isGroupNode(n)) {
    patch.label = payload.title;
  }
  if (payload.kind === 'video' && n.kind !== 'video') {
    n.kind = 'video';
  }
  updatePuzzleNode(state.nodes, payload.id, patch);
  const updated = findNode(state.nodes, payload.id);
  if (!updated) return;
  refreshPuzzleViewsInViewer();
  const wireBody = {
    status: updated.status,
    tags: updated.tags || [],
    label: updated.label,
    color: updated.color,
    parent: updated.parent || null,
    caption: updated.caption || null,
    translations: updated.translations || null,
    text_style: updated.text_style || null,
    media: updated.media || null,
    branches: Array.isArray(updated.branches) ? updated.branches : [],
    kind: updated.kind || null,
  };
  if (updated.type === 'text') wireBody.text = updated.text || '';
  pushNodePatch(payload.id, wireBody);
  scheduleSave();
  toast(tr('toast_hotspot_updated'));
}

function setupToolbar() {
  setupToolbarOverflow();

  const zin = $('btn-zoom-in');
  const zout = $('btn-zoom-out');
  const zfit = $('btn-zoom-fit');
  if (zin) zin.addEventListener('click', () => {
    const r = $('map-canvas').getBoundingClientRect();
    viewer.zoomAt(r.width / 2, r.height / 2, 1.25);
  });
  if (zout) zout.addEventListener('click', () => {
    const r = $('map-canvas').getBoundingClientRect();
    viewer.zoomAt(r.width / 2, r.height / 2, 1 / 1.25);
  });
  if (zfit) zfit.addEventListener('click', () => viewer.fitToScreen());

  const fileImport = $('file-import');
  if (fileImport) fileImport.addEventListener('change', async (e) => {
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
}

function triggerDownloadSnapshot() {
  exportCanvasSnapshot();
}

function triggerImportCanvas() {
  confirmWithWord({
    title: tr('import_confirm_title'),
    message: tr('import_confirm_message'),
    requireWord: tr('import_confirm_word'),
    confirmLabel: tr('import_confirm_ok'),
    onConfirm: () => $('file-import').click(),
  });
}

function triggerResetDefaults() {
  confirmWithWord({
    title: tr('reset_title'),
    message: tr('reset_message'),
    requireWord: tr('reset_confirm_word'),
    confirmLabel: tr('reset_confirm'),
    onConfirm: () => { clearState(); window.location.reload(); },
  });
}

function confirmWithWord(opts) {
  const modal = $('confirm-modal');
  const titleEl = $('confirm-title');
  const messageEl = $('confirm-message');
  const actionsEl = $('confirm-actions');
  const wordIn = $('confirm-word-input');
  if (!modal || !titleEl || !actionsEl) {
    if (opts.onConfirm) opts.onConfirm();
    return;
  }
  titleEl.textContent = opts.title || tr('reset_title');
  messageEl.textContent = opts.message || '';
  actionsEl.innerHTML = '';
  if (opts.requireWord) {
    wordIn.style.display = 'block';
    wordIn.value = '';
    wordIn.placeholder = opts.requireWord;
    setTimeout(() => wordIn.focus(), 30);
  } else {
    wordIn.style.display = 'none';
  }
  const close = () => modal.classList.remove('open');
  const cancel = document.createElement('button');
  cancel.className = 'modal-btn cancel';
  cancel.textContent = tr('editor_cancel_button');
  cancel.addEventListener('click', close);
  const ok = document.createElement('button');
  ok.className = 'modal-btn danger';
  ok.textContent = opts.confirmLabel || tr('reset_confirm');
  ok.disabled = !!opts.requireWord;
  ok.addEventListener('click', () => {
    if (opts.requireWord && wordIn.value !== opts.requireWord) return;
    close();
    if (typeof opts.onConfirm === 'function') opts.onConfirm();
  });
  if (opts.requireWord) {
    wordIn.addEventListener('input', () => {
      ok.disabled = wordIn.value !== opts.requireWord;
    });
  }
  actionsEl.appendChild(cancel);
  actionsEl.appendChild(ok);
  modal.classList.add('open');
}

function exportCanvasSnapshot() {
  downloadCanvasFile(state.nodes, state.edges, 'canvas.canvas', state.branches);
  toast(tr('toast_exported'));
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
  if (editNodeModal) editNodeModal.refreshStatusOptions();
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
  document.body.classList.toggle('editor-mode', mode === 'editor');
  if (leftRail) leftRail.setActiveMode(mode);
  if (keyboard) keyboard.setEditMode(mode === 'editor');
  if (mode === 'editor') {
    setActiveTool('select');
  } else {
    state.selection = new Set();
    if (viewer) viewer.setSelection(new Set());
    refreshSelectionStatus();
    pendingTextClick = false;
  }
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
        backendOfflineMode = 'online';
        state.revision = Number(remote.revision) || 0;
        await ingestCanvasData(remote.data);
        return;
      }
      backendOfflineMode = 'unreachable';
    } catch (e) {
      backendOfflineMode = 'unreachable';
      console.warn('[app] backend fetch failed, falling back to local file:', e && e.message);
    }
  } else {
    backendOfflineMode = 'placeholder';
  }
  state.backendOnline = false;
  if (backendOfflineMode === 'unreachable') startBackendRetry();
  refreshOfflineBanner();

  const loaded = await loadCanvas();
  const stored = loadState();
  const useStored = stored && stored.version === STATE_VERSION
    && stored.canvas && Array.isArray(stored.canvas.nodes) && Array.isArray(stored.canvas.edges);

  let nodes;
  let edges;
  let branches = null;
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
    if (Array.isArray(stored.canvas.branches)) branches = normaliseBranches(stored.canvas.branches);
    if (stored.puzzles) restoreMarkdownCache(stored.puzzles);
    toast(tr('toast_loaded_local'));
  } else {
    nodes = loaded.nodes;
    edges = loaded.edges;
    branches = Array.isArray(loaded.branches) ? loaded.branches : null;
  }

  state.nodes = nodes;
  state.edges = edges;
  state.branches = (branches && branches.length) ? branches : defaultBranchSeed();
  if (branchesPanel) branchesPanel.setBranches();

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
  const incomingBranches = normaliseBranches(data.branches);
  state.branches = incomingBranches.length ? incomingBranches : defaultBranchSeed();
  if (branchesPanel) branchesPanel.setBranches();
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
    if (viewer && nn.kind === 'block' && nn.type === 'file' && nn.file) {
      viewer.addBlock({ id: nn.id, rect: { x: nn.x, y: nn.y, w: nn.width, h: nn.height }, file: nn.file })
        .catch((e) => console.warn('[app] addBlock from ws', e));
    }
    incrementalAfterNodeChange(nn, 'created');
    return;
  }
  if (k === 'node_updated' && ev.data && ev.id) {
    const prev = state.nodes.get(ev.id);
    const nn = normaliseNode(ev.data);
    state.nodes.set(nn.id, nn);
    if (viewer && nn.kind === 'block' && nn.type === 'file' && nn.file) {
      const prevFile = prev && typeof prev.file === 'string' ? prev.file : null;
      if (prevFile !== nn.file) {
        viewer.refreshBlock({ id: nn.id, rect: { x: nn.x, y: nn.y, w: nn.width, h: nn.height }, file: nn.file })
          .catch((e) => console.warn('[app] refreshBlock from ws', e));
      }
    }
    incrementalAfterNodeChange(nn, 'updated');
    return;
  }
  if (k === 'node_deleted' && ev.id) {
    state.nodes.delete(ev.id);
    if (viewer) {
      viewer.removeBlock(ev.id);
      viewer.removeHotspot(ev.id);
      viewer.removeGroup(ev.id);
    }
    if (arrowLayer) arrowLayer.notifyNodeDeleted(ev.id);
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

function incrementalAfterNodeChange(node, change) {
  if (!viewer || !node) return;
  const lang = getLang();
  const baseView = toViewShape(node);
  if (!baseView) return;
  const view = viewWithLang(baseView, lang);
  if (isGroupNode(node)) {
    viewer.updateGroup(view);
  } else if (node.type !== 'group') {
    viewer.updateHotspot(view);
  }
  if (arrowLayer) {
    arrowLayer.invalidateNode(node.id);
    arrowLayer.requestDraw();
  }
  void change;
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
  if (state.backendOnline) { b.classList.remove('open'); return; }
  b.classList.add('open');
  if (backendOfflineMode === 'placeholder') {
    b.textContent = tr('offline_banner_local');
  } else if (backendOfflineMode === 'unreachable') {
    b.textContent = tr('offline_banner_unreachable');
  } else {
    b.textContent = tr('offline_banner');
  }
}

function startBackendRetry() {
  if (backendRetryTimer) return;
  if (isPlaceholderApiBase()) return;
  backendRetryTimer = setTimeout(async () => {
    backendRetryTimer = null;
    try {
      const r = await apiGetCanvas();
      if (r) {
        const wasOffline = !state.backendOnline;
        state.backendOnline = true;
        state.revision = Number(r.revision) || 0;
        await ingestCanvasData(r.data);
        refreshOfflineBanner();
        if (realtime) realtime._reconnectNow();
        if (wasOffline) toast(tr('backend_reconnected'));
      } else {
        startBackendRetry();
      }
    } catch (e) {
      startBackendRetry();
    }
  }, BACKEND_RETRY_MS);
}

async function doCopy() {
  if (!isLoggedIn() && state.mode !== 'editor') return;
  if (state.selection.size === 0) return;
  const ids = Array.from(state.selection);
  const allIds = new Set();
  for (const id of ids) {
    allIds.add(id);
    const n = findNode(state.nodes, id);
    if (n && isGroupNode(n)) {
      for (const sid of groupDescendantIds(state.nodes, id)) allIds.add(sid);
    }
  }
  const nodes = [];
  for (const id of allIds) {
    const n = findNode(state.nodes, id);
    if (!n) continue;
    nodes.push(JSON.parse(JSON.stringify(n)));
  }
  const edges = [];
  for (const e of state.edges.values()) {
    if (allIds.has(e.fromNode) && allIds.has(e.toNode)) edges.push(JSON.parse(JSON.stringify(e)));
  }
  await clipboardMgr.copyPayload({ nodes, edges });
  toast(tr('copy_paste_copied', { n: nodes.length }));
}

async function doPaste() {
  if (state.mode !== 'editor') return;
  if (!isLoggedIn()) { if (authUI) authUI.openLogin(); return; }
  const sysPayload = await clipboardMgr.readSystemPayload();
  if (sysPayload && sysPayload.kind === 'image' && sysPayload.blob) {
    await pasteImage(sysPayload.blob);
    return;
  }
  let payload = null;
  if (sysPayload && sysPayload.kind === 'nodes_payload') payload = sysPayload.payload;
  else if (clipboardMgr.hasInternal()) payload = clipboardMgr.getInternal();
  else if (sysPayload && sysPayload.kind === 'text' && sysPayload.text) {
    pasteText(sysPayload.text);
    return;
  }
  if (!payload || !Array.isArray(payload.nodes) || payload.nodes.length === 0) {
    toast(tr('copy_paste_clipboard_empty'));
    return;
  }
  instantiatePastedNodes(payload, 20, 20);
}

async function doDuplicate() {
  if (state.mode !== 'editor') return;
  if (!isLoggedIn()) { if (authUI) authUI.openLogin(); return; }
  if (state.selection.size === 0) return;
  await doCopy();
  await doPaste();
}

function pasteText(text) {
  const pt = viewer.imagePointFromClient(window.innerWidth / 2, window.innerHeight / 2);
  const rect = { x: Math.round(pt.x), y: Math.round(pt.y), w: 280, h: 80 };
  pushHistory();
  const id = uniqueId(state.nodes, 'text');
  addTextNode(state.nodes, { id, rect, md: text });
  refreshPuzzleViewsInViewer();
  const newNode = findNode(state.nodes, id);
  if (newNode) pushNodeCreate(toViewShape(newNode), text);
  scheduleSave();
  toast(tr('copy_paste_pasted', { n: 1 }));
}

async function pasteImage(blob) {
  if (!isLoggedIn() || !state.backendOnline) return;
  try {
    const converted = await convertImageBlobToWebP(blob);
    const finalBlob = converted || blob;
    const name = converted ? 'paste.webp' : 'paste.png';
    const result = await apiUploadImage(finalBlob, name);
    if (!result || !result.url) return;
    const dims = await readBlobDims(finalBlob).catch(() => null);
    const w = dims ? Math.min(400, dims.w) : 300;
    const h = dims ? Math.round(w * (dims.h / dims.w)) : 200;
    const pt = viewer.imagePointFromClient(window.innerWidth / 2, window.innerHeight / 2);
    const rect = { x: Math.round(pt.x - w / 2), y: Math.round(pt.y - h / 2), w, h };
    await placeUploadedImageNode({
      file: result.url, imageId: result.id || null, sha256: result.sha256 || null,
      mime: result.mime || finalBlob.type, size: result.size || finalBlob.size,
      name, rect,
    });
    toast(tr('copy_paste_pasted', { n: 1 }));
  } catch (e) {
    console.warn('[app] paste image failed', e);
    toast(tr('upload_image_failed'), 'error');
  }
}

function readBlobDims(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || img.width || 0;
      const h = img.naturalHeight || img.height || 0;
      try { URL.revokeObjectURL(url); } catch (e) { void e; }
      resolve({ w, h });
    };
    img.onerror = (e) => {
      try { URL.revokeObjectURL(url); } catch (er) { void er; }
      reject(e || new Error('img_dim_failed'));
    };
    img.src = url;
  });
}

function instantiatePastedNodes(payload, dx, dy) {
  pushHistory();
  const idMap = new Map();
  const newNodes = [];
  for (const raw of payload.nodes) {
    if (!raw || typeof raw.id !== 'string') continue;
    const newId = uniqueId(state.nodes, `${raw.kind || raw.type || 'node'}-paste`);
    idMap.set(raw.id, newId);
    const clone = JSON.parse(JSON.stringify(raw));
    clone.id = newId;
    clone.x = (Number(clone.x) || 0) + dx;
    clone.y = (Number(clone.y) || 0) + dy;
    clone.slug = newId;
    if (clone.parent && idMap.has(clone.parent)) {
      clone.parent = idMap.get(clone.parent);
    } else if (clone.parent && !idMap.has(clone.parent) && !state.nodes.has(clone.parent)) {
      delete clone.parent;
    }
    state.nodes.set(newId, clone);
    newNodes.push(clone);
  }
  if (Array.isArray(payload.edges)) {
    for (const raw of payload.edges) {
      if (!raw) continue;
      const fromNew = idMap.get(raw.fromNode);
      const toNew = idMap.get(raw.toNode);
      if (!fromNew || !toNew) continue;
      const clone = JSON.parse(JSON.stringify(raw));
      clone.id = uniqueId(state.nodes, `${raw.id}-paste`);
      clone.fromNode = fromNew;
      clone.toNode = toNew;
      state.edges.set(clone.id, clone);
      if (arrowLayer) arrowLayer.setEdges(state.edges);
    }
  }
  state.selection = new Set(Array.from(idMap.values()));
  refreshPuzzleViewsInViewer();
  if (viewer) viewer.setSelection(state.selection);
  for (const n of newNodes) {
    pushNodeCreate(toViewShape(n), typeof n.text === 'string' ? n.text : '');
  }
  scheduleSave();
  refreshSelectionStatus();
  toast(tr('copy_paste_pasted', { n: newNodes.length }));
}

async function convertImageBlobToWebP(blob) {
  if (!blob || !blob.type) return null;
  if (blob.type === 'image/webp') return null;
  try {
    const url = URL.createObjectURL(blob);
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = (e) => reject(e);
      i.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width  = img.naturalWidth  || img.width;
    canvas.height = img.naturalHeight || img.height;
    const cx = canvas.getContext('2d');
    cx.drawImage(img, 0, 0);
    const out = await new Promise((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/webp', 0.9);
    });
    try { URL.revokeObjectURL(url); } catch (e) { void e; }
    return out;
  } catch (e) {
    console.warn('[app] webp convert failed', e);
    return null;
  }
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
  if (Array.isArray(imported.branches)) {
    const b = normaliseBranches(imported.branches);
    state.branches = b.length ? b : state.branches;
  }
  if (branchesPanel) branchesPanel.setBranches();
  refreshPuzzleViewsInViewer();
  arrowLayer.setEdges(state.edges);
  scheduleSave();
}

function setupMigrationBanner() {
  const banner = $('migration-banner');
  if (!banner) return;
  $('migration-banner-button').addEventListener('click', () => {
    downloadCanvasFile(state.nodes, state.edges, 'canvas.canvas', state.branches);
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
  const mmBtn = $('btn-minimap-toggle');
  if (mmBtn) mmBtn.addEventListener('click', () => minimap && minimap.toggle());
}

function setupKeyboard() {
  keyboard = new KeyboardShortcuts({
    overlayContainer: document.body,
    handlers: {
      onCommandPalette: () => {
        const s = $('search');
        if (s) { s.focus(); s.select(); }
      },
      onCopy: () => doCopy(),
      onPaste: () => doPaste(),
      onCut: () => doCut(),
      onDuplicate: () => doDuplicate(),
      onSelectAll: () => doSelectAll(),
      onEscape: () => {
        if (editNodeModal && editNodeModal.isOpen()) {
          editNodeModal.requestClose();
          return;
        }
        if (getActiveTool() !== 'select') {
          setActiveTool('select');
          return;
        }
        if (state.selection.size > 0) {
          state.selection = new Set();
          if (viewer) viewer.setSelection(state.selection);
          refreshSelectionStatus();
          return;
        }
        viewer.setActiveId(null);
      },
      onMinimapToggle: () => minimap && minimap.toggle(),
      onFilterCycle: () => statusFilter && statusFilter.cycle(),
      onModeToggle: () => setMode(state.mode === 'viewer' ? 'editor' : 'viewer'),
      onCreateChild: () => createChildNode(),
      onCreateSibling: () => {
        if (state.selection.size === 1) {
          const id = Array.from(state.selection)[0];
          openRichEdit(id);
          return true;
        }
        return createSiblingNode();
      },
      onDeleteSelected: () => {
        if (state.mode === 'editor' && state.selection.size > 0) {
          deleteCurrentSelection();
          return true;
        }
        return confirmDeleteSelected();
      },
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
      onGroupSelection: () => { groupCurrentSelection(); return true; },
      onUngroupSelection: () => { ungroupCurrentSelection(); return true; },
      onUndo: () => { doUndo(); return true; },
      onRedo: () => { doRedo(); return true; },
      onImageTool: () => { if (uploader) uploader.openFilePicker(); return true; },
      onVideoTool: () => { triggerAddVideo(); return true; },
      onAudioTool: () => { triggerAddAudio(); return true; },
      onGroupShortcut: () => {
        if (state.selection.size >= 2) {
          groupCurrentSelection();
          return true;
        }
        return false;
      },
      onToggleLock: () => {
        if (state.mode === 'editor' && state.selection.size > 0) {
          toggleLockSelection();
          return true;
        }
        return false;
      },
    },
  });
  keyboard.setEditMode(state.mode === 'editor');
}

function doSelectAll() {
  if (state.mode !== 'editor') return;
  if (!isLoggedIn()) { if (authUI) authUI.openLogin(); return; }
  const ids = new Set();
  for (const n of state.nodes.values()) {
    if (isBlockNode_local(n)) continue;
    ids.add(n.id);
  }
  state.selection = ids;
  if (viewer) viewer.setSelection(ids);
  refreshSelectionStatus();
}

function isBlockNode_local(n) {
  return n && n.kind === 'block' && n.type === 'file';
}

async function doCut() {
  if (state.mode !== 'editor') return;
  if (!isLoggedIn()) { if (authUI) authUI.openLogin(); return; }
  if (state.selection.size === 0) return;
  await doCopy();
  deleteCurrentSelection();
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
  let message = tr('delete_node_prompt', { label: view.title });
  if (isGroupNode(n)) {
    const descCount = groupDescendantIds(state.nodes, id).size;
    message = tr('delete_group_prompt', { label: view.title, n: descCount });
  }
  editorModal.showConfirm({
    title: tr('editor_delete_title'),
    message,
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
    if (raw === 'light') return 'white';
  } catch (e) { void e; }
  return 'white';
}

function resolveTheme(choice) {
  if (choice === 'dark' || choice === 'white' || choice === 'graphite') return choice;
  try {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
  } catch (e) { void e; }
  return 'white';
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
  if (leftRail) leftRail.setThemeChoice(choice);
  syncThemeButtons(choice);
}

function syncThemeButtons(choice) {
  const buttons = document.querySelectorAll('#theme-switch .theme-btn');
  buttons.forEach((b) => {
    b.classList.toggle('active', b.dataset.themeValue === choice);
  });
}

function setupThemeSwitch() {
  const choice = readStoredThemeChoice();
  applyTheme(choice);
  const buttons = document.querySelectorAll('#theme-switch .theme-btn');
  buttons.forEach((b) => {
    b.addEventListener('click', (e) => {
      e.preventDefault();
      const v = b.dataset.themeValue;
      if (!THEME_CHOICES.includes(v)) return;
      try { localStorage.setItem(THEME_KEY, v); } catch (er) { void er; }
      applyTheme(v);
    });
  });
  const langSel = $('lang-select');
  if (langSel) {
    langSel.value = getLang();
    langSel.addEventListener('change', () => {
      const v = langSel.value;
      if (LANGS.includes(v)) setLang(v);
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

window.addEventListener('DOMContentLoaded', () => {
  bootstrap().catch((e) => {
    console.error(e);
    toast(tr('toast_init_failed', { error: e.message }), 'error');
  });
});
