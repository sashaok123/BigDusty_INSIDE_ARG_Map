/* Top-level bootstrap. Wires viewer + arrow layer + side panel + editor +
   search + i18n. Owns state, syncs persistence. */

import { Viewer } from './viewer.js';
import { SidePanel } from './side-panel.js';
import { SearchBar } from './search.js';
import { EditorModal, ContextMenu } from './editor.js';
import { ArrowLayer, loadArrows, normaliseArrow } from './arrows.js';
import {
  loadHotspots,
  loadBlocks,
  loadPuzzleMarkdown,
  setCachedMarkdown,
  snapshotMarkdownCache,
  restoreMarkdownCache,
} from './data-loader.js';
import {
  saveState,
  saveStateImmediate,
  loadState,
  clearState,
  downloadJSON,
  importJSON,
} from './persistence.js';
import {
  STATUSES,
  findHotspot,
  addHotspot,
  updateHotspot,
  removeHotspot,
  uniqueId,
  normalizeHotspot,
  statusLabel,
} from './hotspots.js';
import { LANGS, initLang, getLang, setLang, tr } from './i18n.js';

const STATE_VERSION = 2;

const state = {
  hotspots: [],
  blocks: [],
  arrows: [],
  imageW: 0,
  imageH: 0,
  statusFilter: new Set(STATUSES),
  activeFilter: 'all',
  mode: 'viewer',
  searchTerm: '',
  searchMatches: null,
};

let viewer;
let sidePanel;
let searchBar;
let editorModal;
let contextMenu;
let arrowLayer;

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
    image_w: state.imageW,
    image_h: state.imageH,
    hotspots: state.hotspots,
    arrows: state.arrows,
    puzzles: snapshotMarkdownCache(),
  };
}

function scheduleSave() {
  saveState(snapshot());
}

async function bootstrap() {
  initLang();
  applyStaticTranslations();
  setupLangSelect();
  setupViewer();
  setupSidePanel();
  setupSearchBar();
  setupEditorModal();
  setupArrowLayer();
  setupToolbar();
  contextMenu = new ContextMenu(document.body);

  await loadInitialData();
  applyFilters();

  document.addEventListener('i18n:changed', () => {
    applyStaticTranslations();
    if (sidePanel && sidePanel.isOpen() && sidePanel.currentHotspot) {
      sidePanel.refreshLocalised();
    }
    if (arrowLayer) arrowLayer.retranslate();
  });
}

function setupViewer() {
  viewer = new Viewer($('map-canvas'), {
    drawPreviewEl: $('draw-preview'),
    onHotspotClick: (id) => {
      const h = findHotspot(state.hotspots, id);
      if (!h) return;
      if (state.mode === 'editor') {
        loadPuzzleMarkdown(h.slug).then((md) => editorModal.openEdit(h, md));
      } else {
        viewer.setActiveId(id);
        sidePanel.open(h);
      }
    },
    onHotspotRightClick: (id, ev) => {
      const h = findHotspot(state.hotspots, id);
      if (!h) return;
      contextMenu.open(ev.clientX, ev.clientY, [
        { label: tr('context_edit_hotspot'), fn: () => {
          loadPuzzleMarkdown(h.slug).then((md) => editorModal.openEdit(h, md));
        } },
        { label: tr('context_delete_hotspot'), danger: true, fn: () => {
          editorModal.showConfirm({
            title: tr('editor_delete_title'),
            message: tr('context_delete_confirm_msg', { title: h.title }),
            actions: [
              { label: tr('editor_cancel_button'), kind: 'cancel', fn: () => editorModal.hideConfirm() },
              { label: tr('editor_delete_button'), kind: 'danger', fn: () => {
                editorModal.hideConfirm();
                deleteHotspot(h.id);
              } },
            ],
          });
        } },
      ]);
    },
    onCanvasDrawRect: (rect) => {
      editorModal.openCreate(rect, { md: '# New puzzle\n\n## Status\nunsolved\n\n## TLDR\n\n## Background\n\n## Current state\n\n## Techniques tried\n\n## References\n\n## Open questions\n' });
    },
    onHotspotResize: (id, rect) => {
      updateHotspot(state.hotspots, id, { rect });
    },
    onHotspotResizeEnd: () => {
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
    getBlocks: () => state.blocks,
    getTransform: () => viewer.getTransform(),
    onArrowsChange: () => {
      state.arrows = arrowLayer.getArrows();
    },
    onScheduleSave: () => scheduleSave(),
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
    onStatusChange: (id, status) => {
      updateHotspot(state.hotspots, id, { status });
      const h = findHotspot(state.hotspots, id);
      sidePanel.setHotspotMeta(h);
      sidePanel.refreshStatusDot(status);
      viewer.setHotspots(state.hotspots);
      scheduleSave();
    },
    onContentChange: (id, md, persist) => {
      const h = findHotspot(state.hotspots, id);
      if (!h) return;
      setCachedMarkdown(h.slug, md);
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
    getHotspots: () => state.hotspots,
    onPick: (id) => {
      const h = findHotspot(state.hotspots, id);
      if (!h) return;
      viewer.centerOnHotspot(h);
      viewer.setActiveId(id);
      sidePanel.open(h);
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
        const slugChanged = payload.slug !== payload.id && state.hotspots.some((h) => h.slug === payload.slug && h.id !== payload.id);
        const finalSlug = slugChanged ? `${payload.slug}-${Date.now().toString(36)}` : payload.slug;
        updateHotspot(state.hotspots, payload.id, {
          title: payload.title,
          slug: finalSlug,
          status: payload.status,
          tags: payload.tags,
          rect: payload.rect,
        });
        setCachedMarkdown(finalSlug, payload.md);
        viewer.setHotspots(state.hotspots);
        const h = findHotspot(state.hotspots, payload.id);
        sidePanel.setHotspotMeta(h);
        if (sidePanel.isOpen() && sidePanel.currentSlug() === finalSlug) {
          loadPuzzleMarkdown(finalSlug).then(() => sidePanel.open(h));
        }
        scheduleSave();
        toast(tr('toast_hotspot_updated'));
      } else {
        const id = uniqueId(state.hotspots, payload.slug || payload.title);
        const finalSlug = payload.slug && !state.hotspots.some((h) => h.slug === payload.slug)
          ? payload.slug
          : id;
        const h = {
          id,
          title: payload.title,
          slug: finalSlug,
          status: payload.status,
          tags: payload.tags,
          rect: payload.rect,
          block_id: null,
        };
        addHotspot(state.hotspots, h);
        setCachedMarkdown(finalSlug, payload.md);
        viewer.setHotspots(state.hotspots);
        scheduleSave();
        toast(tr('toast_hotspot_added'));
      }
    },
    onDelete: (id) => deleteHotspot(id),
    onCancel: () => {},
  });
}

function deleteHotspot(id) {
  const h = findHotspot(state.hotspots, id);
  if (!h) return;
  removeHotspot(state.hotspots, id);
  viewer.setHotspots(state.hotspots);
  if (sidePanel.isOpen() && sidePanel.currentSlug() === h.slug) {
    sidePanel.requestClose();
  }
  scheduleSave();
  toast(tr('toast_hotspot_deleted'));
}

function setupToolbar() {
  document.querySelectorAll('.filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const f = btn.dataset.filter;
      if (state.activeFilter === f && f !== 'all') {
        setActiveFilter('all');
      } else {
        setActiveFilter(f);
      }
    });
  });

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
    downloadJSON(snapshot(), 'arg_map_state.json');
    toast(tr('toast_exported'));
  });

  $('btn-import').addEventListener('click', () => $('file-import').click());
  $('file-import').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const data = await importJSON(f);
      applyImportedState(data);
      toast(tr('toast_imported', { n: data.hotspots.length }));
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
  refreshFilterDots();
  if (sidePanel) sidePanel.refreshStatusOptions();
  if (editorModal) editorModal.refreshStatusOptions();
}

function refreshFilterDots() {
}

function setActiveFilter(filter) {
  state.activeFilter = filter;
  if (filter === 'all') {
    state.statusFilter = new Set(STATUSES);
  } else {
    state.statusFilter = new Set([filter]);
  }
  document.querySelectorAll('.filter-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.filter === filter);
  });
  viewer.setStatusFilter(state.statusFilter);
}

function setMode(mode) {
  state.mode = mode;
  viewer.setMode(mode);
  if (arrowLayer) arrowLayer.setMode(mode);
  document.querySelectorAll('.mode-switch button').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
}

function applyFilters() {
  viewer.setStatusFilter(state.statusFilter);
}

async function loadInitialData() {
  const blocksData = await loadBlocks();
  state.blocks = (blocksData.blocks || []).map((b) => ({ id: b.id, rect: { ...b.rect }, file: b.file }));
  const blocksById = new Map(state.blocks.map((b) => [b.id, b]));

  await viewer.setBlocks(state.blocks);
  const sz = viewer.getImageSize();
  state.imageW = sz.w;
  state.imageH = sz.h;

  const stored = loadState();
  let hotspotsRaw;
  let arrowsRaw;
  let loadedFromStorage = false;
  if (stored && Array.isArray(stored.hotspots)) {
    hotspotsRaw = stored.hotspots;
    arrowsRaw = Array.isArray(stored.arrows) ? stored.arrows : null;
    if (stored.puzzles) restoreMarkdownCache(stored.puzzles);
    loadedFromStorage = true;
    toast(tr('toast_loaded_local'));
  } else {
    const baseData = await loadHotspots();
    hotspotsRaw = baseData.hotspots || [];
  }

  state.hotspots = hotspotsRaw.map((h) => normalizeHotspot(h, state.imageW, state.imageH, blocksById));
  viewer.setHotspots(state.hotspots);

  if (!arrowsRaw) {
    const fileArrows = await loadArrows();
    arrowsRaw = fileArrows.arrows;
  }
  state.arrows = (arrowsRaw || []).map(normaliseArrow);
  arrowLayer.setArrows(state.arrows);
  arrowLayer.setMode(state.mode);

  if (loadedFromStorage) {
    saveStateImmediate(snapshot());
  }
}

function applyImportedState(data) {
  state.imageW = data.image_w || state.imageW;
  state.imageH = data.image_h || state.imageH;
  const blocksById = new Map(state.blocks.map((b) => [b.id, b]));
  state.hotspots = (data.hotspots || []).map((h) => normalizeHotspot(h, state.imageW, state.imageH, blocksById));
  if (data.puzzles) restoreMarkdownCache(data.puzzles);
  viewer.setHotspots(state.hotspots);
  if (Array.isArray(data.arrows)) {
    state.arrows = data.arrows.map(normaliseArrow);
    arrowLayer.setArrows(state.arrows);
  }
  scheduleSave();
}

window.addEventListener('DOMContentLoaded', () => {
  bootstrap().catch((e) => {
    console.error(e);
    toast(tr('toast_init_failed', { error: e.message }), 'error');
  });
});
