/* GitHub repository importer modal. Three sections: repo input, options,
   action buttons. Preview hits the backend with dry_run=true and renders
   the plan summary + first 50 nodes. Import does the real run. Also hosts
   a Local files tab with drag-and-drop + folder picker for one-shot markdown
   + image bulk import. */

import { tr, LANGS } from './i18n.js';
import { importFromGithub, uploadImage } from './api-client.js';

function el(tag, attrs, kids) {
  const e = document.createElement(tag);
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k.startsWith('on') && typeof attrs[k] === 'function') e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    }
  }
  if (kids) for (const k of kids) if (k) e.appendChild(k);
  return e;
}

function parseRepoInput(raw) {
  const v = (raw || '').trim();
  if (!v) return null;
  const urlMatch = v.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/tree\/([^/]+)(?:\/(.+))?)?\/?$/i);
  if (urlMatch) {
    return {
      owner: urlMatch[1],
      repo: urlMatch[2],
      branch: urlMatch[3] || '',
      path: urlMatch[4] ? urlMatch[4] : '',
    };
  }
  const shortMatch = v.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (shortMatch) return { owner: shortMatch[1], repo: shortMatch[2], branch: '', path: '' };
  return null;
}

function classifyFile(name) {
  const ext = name.toLowerCase().match(/\.[a-z0-9]+$/);
  if (!ext) return null;
  const e = ext[0];
  if (e === '.md' || e === '.markdown') return { kind: 'text', mime: 'text/markdown' };
  if (e === '.png') return { kind: 'block', mime: 'image/png' };
  if (e === '.jpg' || e === '.jpeg') return { kind: 'block', mime: 'image/jpeg' };
  if (e === '.webp') return { kind: 'block', mime: 'image/webp' };
  if (e === '.gif') return { kind: 'block', mime: 'image/gif' };
  if (e === '.bmp') return { kind: 'block', mime: 'image/bmp' };
  if (e === '.svg') return { kind: 'block', mime: 'image/svg+xml' };
  if (e === '.pdf') return { kind: 'document', mime: 'application/pdf' };
  if (e === '.json') return { kind: 'document', mime: 'application/json' };
  if (e === '.csv') return { kind: 'document', mime: 'text/csv' };
  if (e === '.xml') return { kind: 'document', mime: 'application/xml' };
  if (e === '.html' || e === '.htm') return { kind: 'document', mime: 'text/html' };
  if (e === '.txt') return { kind: 'document', mime: 'text/plain' };
  if (e === '.py') return { kind: 'document', mime: 'text/x-python' };
  if (e === '.js') return { kind: 'document', mime: 'application/javascript' };
  if (e === '.sh') return { kind: 'document', mime: 'application/x-sh' };
  if (e === '.css') return { kind: 'document', mime: 'text/css' };
  return null;
}

function splitFrontmatter(text) {
  if (!text.startsWith('---')) return { fm: null, body: text };
  const m = /\n---\s*(?:\n|$)/.exec(text.slice(3));
  if (!m) return { fm: null, body: text };
  const yamlBlock = text.slice(3, 3 + m.index);
  const rest = text.slice(3 + m.index + m[0].length);
  const fm = parseSimpleYaml(yamlBlock);
  return { fm, body: rest };
}

function parseSimpleYaml(text) {
  const out = {};
  const lines = text.split('\n');
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    let val = m[2].trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      val = val.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    } else if (/^["'].*["']$/.test(val)) {
      val = val.slice(1, -1);
    }
    out[m[1]] = val;
  }
  return out;
}

function slugifyPath(path) {
  const base = path.split('/').pop().replace(/\.[^.]+$/, '');
  return base.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 80) || 'node';
}

function idFromPath(path, used) {
  const base = path.replace(/[^a-z0-9_.\-/]+/gi, '-').replace(/[\/.]+/g, '_').replace(/^-|-$/g, '').toLowerCase() || 'node';
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) { candidate = `${base}-${n}`; n += 1; }
  used.add(candidate);
  return candidate;
}

export class GitHubImportModal {
  constructor(opts) {
    this.getCanvasId = opts.getCanvasId || (() => 'main');
    this.canImport = opts.canImport || (() => true);
    this.onImported = opts.onImported || (() => {});
    this.onError = opts.onError || (() => {});
    this._activeTab = 'github';
    this._localFiles = [];
    this._build();
    document.addEventListener('i18n:changed', () => this._retranslate());
  }

  _build() {
    const overlay = el('div', { id: 'github-import-modal', class: 'gh-import-modal' });
    overlay.style.zIndex = '2400';
    const box = el('div', { class: 'gh-import-box' });
    const head = el('div', { class: 'gh-import-head' });
    const titleEl = el('h2', { text: tr('github_import_title') });
    const close = el('button', { type: 'button', class: 'gh-import-x', html: '&times;', onclick: () => this.close() });
    head.appendChild(titleEl); head.appendChild(close);

    const tabs = el('div', { class: 'gh-import-tabs' });
    const tabGh = el('button', { type: 'button', class: 'gh-import-tab active', text: tr('github_import_tab_github'),
      onclick: () => this._switchTab('github') });
    const tabLocal = el('button', { type: 'button', class: 'gh-import-tab', text: tr('github_import_tab_local'),
      onclick: () => this._switchTab('local') });
    tabs.appendChild(tabGh); tabs.appendChild(tabLocal);

    const body = el('div', { class: 'gh-import-body' });
    const ghPane = el('div', { class: 'gh-import-pane', 'data-pane': 'github' });
    const localPane = el('div', { class: 'gh-import-pane', 'data-pane': 'local' });
    localPane.style.display = 'none';

    const repoLabel = el('label', { class: 'gh-import-label', text: tr('github_import_repo_label') });
    const repoInput = el('input', { type: 'text', class: 'gh-import-input', placeholder: tr('github_import_repo_placeholder') });
    const branchLabel = el('label', { class: 'gh-import-label', text: tr('github_import_branch_label') });
    const branchInput = el('input', { type: 'text', class: 'gh-import-input', value: 'main' });
    const pathLabel = el('label', { class: 'gh-import-label', text: tr('github_import_path_label') });
    const pathInput = el('input', { type: 'text', class: 'gh-import-input' });
    const tokenLabel = el('label', { class: 'gh-import-label', text: tr('github_import_token_label') });
    const tokenInput = el('input', { type: 'password', class: 'gh-import-input', autocomplete: 'off' });
    const tokenHint = el('div', { class: 'gh-import-hint', text: tr('github_import_token_hint') });

    repoInput.addEventListener('blur', () => {
      const parsed = parseRepoInput(repoInput.value);
      if (parsed) {
        repoInput.value = `${parsed.owner}/${parsed.repo}`;
        if (parsed.branch) branchInput.value = parsed.branch;
        if (parsed.path) pathInput.value = parsed.path;
      }
    });

    const optsLabel = el('label', { class: 'gh-import-label', text: tr('github_import_options_label') });
    const optsRow = el('div', { class: 'gh-import-options' });
    const fmWrap = el('label', { class: 'gh-import-checkbox' });
    const fmCheck = el('input', { type: 'checkbox' });
    fmCheck.checked = true;
    const fmLabel = el('span', { text: tr('github_import_parse_frontmatter') });
    fmWrap.appendChild(fmCheck); fmWrap.appendChild(fmLabel);
    const layoutWrap = el('label', { class: 'gh-import-checkbox' });
    const layoutCheck = el('input', { type: 'checkbox' });
    layoutCheck.checked = true;
    const layoutLabel = el('span', { text: tr('github_import_folder_layout') });
    layoutWrap.appendChild(layoutCheck); layoutWrap.appendChild(layoutLabel);
    optsRow.appendChild(fmWrap); optsRow.appendChild(layoutWrap);

    const actions = el('div', { class: 'gh-import-actions' });
    const previewBtn = el('button', { type: 'button', class: 'gh-import-btn', text: tr('github_import_preview'),
      onclick: () => this._doPreview() });
    const applyBtn = el('button', { type: 'button', class: 'gh-import-btn gh-import-primary', text: tr('github_import_apply'),
      onclick: () => this._doImport() });
    actions.appendChild(previewBtn); actions.appendChild(applyBtn);

    const resultArea = el('div', { class: 'gh-import-result' });

    ghPane.appendChild(repoLabel); ghPane.appendChild(repoInput);
    ghPane.appendChild(branchLabel); ghPane.appendChild(branchInput);
    ghPane.appendChild(pathLabel); ghPane.appendChild(pathInput);
    ghPane.appendChild(tokenLabel); ghPane.appendChild(tokenInput); ghPane.appendChild(tokenHint);
    ghPane.appendChild(optsLabel); ghPane.appendChild(optsRow);
    ghPane.appendChild(actions);
    ghPane.appendChild(resultArea);

    const drop = el('div', { class: 'gh-import-drop', text: tr('github_import_local_drop') });
    const localPick = el('input', { type: 'file', multiple: 'multiple', style: 'display:none' });
    localPick.setAttribute('webkitdirectory', '');
    localPick.setAttribute('directory', '');
    const filePick = el('input', { type: 'file', multiple: 'multiple', style: 'display:none' });
    const localBtnRow = el('div', { class: 'gh-import-local-btns' });
    const localFolderBtn = el('button', { type: 'button', class: 'gh-import-btn', text: tr('github_import_local_pick'),
      onclick: () => localPick.click() });
    const localFilesBtn = el('button', { type: 'button', class: 'gh-import-btn', text: tr('github_import_local_pick_files'),
      onclick: () => filePick.click() });
    const localApplyBtn = el('button', { type: 'button', class: 'gh-import-btn gh-import-primary',
      text: tr('github_import_local_apply'), onclick: () => this._doLocalImport() });
    localBtnRow.appendChild(localFolderBtn);
    localBtnRow.appendChild(localFilesBtn);
    localBtnRow.appendChild(localApplyBtn);
    const localResult = el('div', { class: 'gh-import-result' });
    localPane.appendChild(drop);
    localPane.appendChild(localPick);
    localPane.appendChild(filePick);
    localPane.appendChild(localBtnRow);
    localPane.appendChild(localResult);
    this._wireLocalDrop(drop, localPick, filePick, localResult);

    body.appendChild(ghPane); body.appendChild(localPane);
    box.appendChild(head); box.appendChild(tabs); box.appendChild(body);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) this.close(); });

    this.overlayEl = overlay;
    this.titleEl = titleEl;
    this.tabsEl = tabs;
    this.tabGhEl = tabGh;
    this.tabLocalEl = tabLocal;
    this.ghPaneEl = ghPane;
    this.localPaneEl = localPane;
    this.repoLabelEl = repoLabel;
    this.repoInputEl = repoInput;
    this.branchLabelEl = branchLabel;
    this.branchInputEl = branchInput;
    this.pathLabelEl = pathLabel;
    this.pathInputEl = pathInput;
    this.tokenLabelEl = tokenLabel;
    this.tokenInputEl = tokenInput;
    this.tokenHintEl = tokenHint;
    this.optsLabelEl = optsLabel;
    this.fmCheckEl = fmCheck;
    this.fmLabelEl = fmLabel;
    this.layoutCheckEl = layoutCheck;
    this.layoutLabelEl = layoutLabel;
    this.previewBtnEl = previewBtn;
    this.applyBtnEl = applyBtn;
    this.resultAreaEl = resultArea;
    this.dropEl = drop;
    this.localPickEl = localPick;
    this.filePickEl = filePick;
    this.localFolderBtnEl = localFolderBtn;
    this.localFilesBtnEl = localFilesBtn;
    this.localApplyBtnEl = localApplyBtn;
    this.localResultEl = localResult;
  }

  _switchTab(tab) {
    this._activeTab = tab;
    const isGh = tab === 'github';
    this.tabGhEl.classList.toggle('active', isGh);
    this.tabLocalEl.classList.toggle('active', !isGh);
    this.ghPaneEl.style.display = isGh ? '' : 'none';
    this.localPaneEl.style.display = isGh ? 'none' : '';
  }

  open() {
    if (!this.canImport()) { this.onError(new Error(tr('github_import_admin_only'))); return; }
    this.overlayEl.classList.add('open');
  }

  close() {
    this.overlayEl.classList.remove('open');
    this.resultAreaEl.innerHTML = '';
    this.localResultEl.innerHTML = '';
    this._localFiles = [];
  }

  _readPayload(dryRun) {
    const parsed = parseRepoInput(this.repoInputEl.value);
    if (!parsed) return null;
    return {
      canvas_id: this.getCanvasId() || 'main',
      owner: parsed.owner,
      repo: parsed.repo,
      branch: (this.branchInputEl.value || 'main').trim(),
      path_prefix: (this.pathInputEl.value || '').trim(),
      token: (this.tokenInputEl.value || '').trim() || null,
      dry_run: !!dryRun,
      parse_frontmatter: !!this.fmCheckEl.checked,
      folder_layout: !!this.layoutCheckEl.checked,
    };
  }

  async _doPreview() {
    const payload = this._readPayload(true);
    if (!payload) {
      this.resultAreaEl.innerHTML = '';
      this.resultAreaEl.appendChild(el('div', { class: 'gh-import-error', text: 'Invalid repo input' }));
      return;
    }
    this.resultAreaEl.innerHTML = '';
    this.resultAreaEl.appendChild(el('div', { class: 'gh-import-status', text: tr('github_import_planning') }));
    this.previewBtnEl.disabled = true;
    this.applyBtnEl.disabled = true;
    try {
      const plan = await importFromGithub(payload);
      this._renderPlan(plan);
    } catch (e) {
      this._renderError(e);
    } finally {
      this.previewBtnEl.disabled = false;
      this.applyBtnEl.disabled = false;
    }
  }

  async _doImport() {
    const payload = this._readPayload(false);
    if (!payload) {
      this.resultAreaEl.innerHTML = '';
      this.resultAreaEl.appendChild(el('div', { class: 'gh-import-error', text: 'Invalid repo input' }));
      return;
    }
    this.resultAreaEl.innerHTML = '';
    this.resultAreaEl.appendChild(el('div', { class: 'gh-import-status', text: tr('github_import_importing') }));
    this.previewBtnEl.disabled = true;
    this.applyBtnEl.disabled = true;
    try {
      const plan = await importFromGithub(payload);
      this._renderPlan(plan);
      this.onImported({ nodes: plan.nodes_planned, groups: plan.groups_planned });
      setTimeout(() => this.close(), 1500);
    } catch (e) {
      this._renderError(e);
    } finally {
      this.previewBtnEl.disabled = false;
      this.applyBtnEl.disabled = false;
    }
  }

  _renderPlan(plan) {
    this.resultAreaEl.innerHTML = '';
    if (!plan) return;
    const summary = el('div', { class: 'gh-import-summary' });
    summary.textContent = tr('github_import_summary', {
      files: plan.files_total,
      nodes: plan.nodes_planned,
      groups: plan.groups_planned,
      skipped: (plan.skipped || []).length,
    });
    this.resultAreaEl.appendChild(summary);
    const preview = Array.isArray(plan.nodes_preview) ? plan.nodes_preview : [];
    if (preview.length) {
      const table = el('div', { class: 'gh-import-preview-table' });
      const head = el('div', { class: 'gh-import-preview-row gh-import-preview-head' });
      head.appendChild(el('span', { class: 'gh-import-preview-cell', text: 'id' }));
      head.appendChild(el('span', { class: 'gh-import-preview-cell', text: 'label' }));
      head.appendChild(el('span', { class: 'gh-import-preview-cell', text: 'kind' }));
      head.appendChild(el('span', { class: 'gh-import-preview-cell', text: 'github_path' }));
      table.appendChild(head);
      for (const r of preview) {
        const row = el('div', { class: 'gh-import-preview-row' });
        row.appendChild(el('span', { class: 'gh-import-preview-cell', text: r.id || '' }));
        row.appendChild(el('span', { class: 'gh-import-preview-cell', text: r.label || '' }));
        row.appendChild(el('span', { class: 'gh-import-preview-cell', text: r.kind || '' }));
        row.appendChild(el('span', { class: 'gh-import-preview-cell', text: r.github_path || '' }));
        table.appendChild(row);
      }
      this.resultAreaEl.appendChild(table);
    }
    if (plan.skipped && plan.skipped.length) {
      const skip = el('details', { class: 'gh-import-skipped' });
      const sum = el('summary', { text: `Skipped (${plan.skipped.length})` });
      skip.appendChild(sum);
      const list = el('div', { class: 'gh-import-skipped-list' });
      for (const s of plan.skipped) {
        const row = el('div', { class: 'gh-import-skipped-row' });
        row.appendChild(el('span', { class: 'gh-import-skipped-path', text: s.path || '' }));
        row.appendChild(el('span', { class: 'gh-import-skipped-reason', text: s.reason || '' }));
        list.appendChild(row);
      }
      skip.appendChild(list);
      this.resultAreaEl.appendChild(skip);
    }
  }

  _renderError(e) {
    this.resultAreaEl.innerHTML = '';
    const message = (e && e.body && e.body.detail) || (e && e.message) || 'error';
    const txt = typeof message === 'object' ? JSON.stringify(message) : String(message);
    this.resultAreaEl.appendChild(el('div', { class: 'gh-import-error', text: txt }));
    this.onError(e instanceof Error ? e : new Error(txt));
  }

  _wireLocalDrop(drop, folderPick, filePick, resultArea) {
    const handleFiles = async (entries) => {
      this._localFiles = entries;
      resultArea.innerHTML = '';
      if (!entries.length) {
        resultArea.appendChild(el('div', { class: 'gh-import-status', text: tr('github_import_local_empty') }));
        return;
      }
      const summary = el('div', { class: 'gh-import-summary', text: `${entries.length} files queued.` });
      resultArea.appendChild(summary);
      const list = el('div', { class: 'gh-import-preview-table' });
      for (const it of entries.slice(0, 50)) {
        const row = el('div', { class: 'gh-import-preview-row' });
        row.appendChild(el('span', { class: 'gh-import-preview-cell', text: it.relpath }));
        row.appendChild(el('span', { class: 'gh-import-preview-cell', text: `${it.size} B` }));
        list.appendChild(row);
      }
      resultArea.appendChild(list);
    };
    drop.addEventListener('click', () => filePick.click());
    drop.addEventListener('dragover', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      drop.classList.add('over');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', async (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      drop.classList.remove('over');
      const items = ev.dataTransfer && ev.dataTransfer.items;
      if (items && items.length && items[0].webkitGetAsEntry) {
        const collected = [];
        const tasks = [];
        for (const it of items) {
          const entry = it.webkitGetAsEntry();
          if (entry) tasks.push(walkEntry(entry, '', collected));
        }
        await Promise.all(tasks);
        handleFiles(collected);
        return;
      }
      const list = ev.dataTransfer && ev.dataTransfer.files;
      const out = [];
      if (list) for (const f of list) out.push({ file: f, relpath: f.name, size: f.size });
      handleFiles(out);
    });
    folderPick.addEventListener('change', () => {
      const list = folderPick.files;
      const out = [];
      if (list) for (const f of list) {
        const rel = f.webkitRelativePath || f.name;
        out.push({ file: f, relpath: rel, size: f.size });
      }
      handleFiles(out);
    });
    filePick.addEventListener('change', () => {
      const list = filePick.files;
      const out = [];
      if (list) for (const f of list) {
        out.push({ file: f, relpath: f.name, size: f.size });
      }
      handleFiles(out);
    });
  }

  async _doLocalImport() {
    if (!this._localFiles.length) {
      this.localResultEl.innerHTML = '';
      this.localResultEl.appendChild(el('div', { class: 'gh-import-status', text: tr('github_import_local_empty') }));
      return;
    }
    const result = await this._buildLocalNodes(this._localFiles);
    if (!result) return;
    const summary = el('div', { class: 'gh-import-summary',
      text: tr('github_import_done', { nodes: result.nodes.length }) });
    this.localResultEl.appendChild(summary);
    this.onImported({ nodes: result.nodes.length, groups: result.groups.length, local: true, payload: result });
    setTimeout(() => this.close(), 1500);
  }

  async _buildLocalNodes(entries) {
    const used = new Set();
    const groupUsed = new Set();
    const folderToGroup = {};
    const out = { nodes: [], groups: [] };
    const folderLayout = !!this.layoutCheckEl.checked;
    const placements = {};
    const byFolder = {};
    for (const it of entries) {
      const folder = it.relpath.includes('/') ? it.relpath.split('/').slice(0, -1).join('/') : '';
      byFolder[folder] = byFolder[folder] || [];
      byFolder[folder].push(it);
    }
    let col = 0;
    for (const folder of Object.keys(byFolder).sort()) {
      let row = 80;
      for (const it of byFolder[folder]) {
        placements[it.relpath] = { x: col * 320, y: row, w: 240, h: 160 };
        row += 180;
      }
      col += 1;
    }
    const folderIds = [];
    if (folderLayout) {
      for (const f of Object.keys(byFolder).sort()) {
        if (!f) continue;
        const parts = f.split('/');
        for (let i = 1; i <= parts.length; i++) {
          const slice = parts.slice(0, i).join('/');
          if (!folderToGroup[slice]) {
            const id = idFromPath(`group/${slice}`, groupUsed);
            folderToGroup[slice] = id;
            folderIds.push({ id, path: slice });
          }
        }
      }
    }
    let processed = 0;
    for (const it of entries) {
      const cls = classifyFile(it.file.name);
      if (!cls) continue;
      const pos = placements[it.relpath] || { x: 0, y: 0, w: 240, h: 160 };
      const id = idFromPath(it.relpath, used);
      const slug = slugifyPath(it.relpath);
      const folder = it.relpath.includes('/') ? it.relpath.split('/').slice(0, -1).join('/') : '';
      const node = {
        id, slug,
        type: 'text',
        x: pos.x, y: pos.y, width: pos.w, height: pos.h,
        name: it.file.name,
      };
      if (folder && folderToGroup[folder]) node.parent = folderToGroup[folder];
      try {
        if (cls.kind === 'text') {
          const text = await it.file.text();
          if (this.fmCheckEl.checked) {
            const { fm, body } = splitFrontmatter(text);
            node.text = fm ? body : text;
            if (fm) {
              if (fm.title) node.label = String(fm.title);
              if (fm.status) node.status = String(fm.status);
              if (Array.isArray(fm.tags)) node.tags = fm.tags;
              if (Array.isArray(fm.branches)) node.branches = fm.branches;
              for (const fld of ['verification', 'source_url', 'tool', 'technique']) {
                if (fm[fld]) node[fld] = String(fm[fld]);
              }
            }
          } else {
            node.text = text;
          }
          node.kind = 'text';
          if (!node.label) node.label = it.file.name.replace(/\.[^.]+$/, '');
        } else if (cls.kind === 'block' || cls.kind === 'document') {
          const blob = new Blob([await it.file.arrayBuffer()], { type: cls.mime });
          const uploaded = await uploadImage(blob, it.file.name);
          if (uploaded && uploaded.url) {
            node.type = 'file';
            node.file = uploaded.url;
            node.kind = cls.kind;
            node.mime = cls.mime;
          } else {
            continue;
          }
        }
        out.nodes.push(node);
        processed += 1;
      } catch (e) {
        console.warn('[github-import] local import skipped', it.relpath, e);
      }
    }
    if (folderLayout) {
      for (const f of folderIds) {
        const filesInFolder = entries.filter((it) => it.relpath.startsWith(f.path + '/') || it.relpath.split('/').slice(0, -1).join('/') === f.path);
        if (!filesInFolder.length) continue;
        const xs = filesInFolder.map((it) => placements[it.relpath] && placements[it.relpath].x || 0);
        const ys = filesInFolder.map((it) => placements[it.relpath] && placements[it.relpath].y || 0);
        const ws = filesInFolder.map((it) => (placements[it.relpath] && placements[it.relpath].w || 240));
        const hs = filesInFolder.map((it) => (placements[it.relpath] && placements[it.relpath].h || 160));
        const minX = Math.min(...xs) - 20;
        const minY = Math.min(...ys) - 60;
        const maxX = Math.max(...xs.map((x, i) => x + ws[i])) + 20;
        const maxY = Math.max(...ys.map((y, i) => y + hs[i])) + 20;
        const parent = f.path.includes('/') ? folderToGroup[f.path.split('/').slice(0, -1).join('/')] : null;
        const g = {
          id: f.id,
          type: 'group',
          kind: 'group',
          x: minX, y: minY, width: maxX - minX, height: maxY - minY,
          label: f.path.split('/').pop() || f.path,
        };
        if (parent) g.parent = parent;
        out.groups.push(g);
      }
    }
    void processed; void LANGS;
    return out;
  }

  _retranslate() {
    if (this.titleEl) this.titleEl.textContent = tr('github_import_title');
    if (this.tabGhEl) this.tabGhEl.textContent = tr('github_import_tab_github');
    if (this.tabLocalEl) this.tabLocalEl.textContent = tr('github_import_tab_local');
    if (this.repoLabelEl) this.repoLabelEl.textContent = tr('github_import_repo_label');
    if (this.repoInputEl) this.repoInputEl.placeholder = tr('github_import_repo_placeholder');
    if (this.branchLabelEl) this.branchLabelEl.textContent = tr('github_import_branch_label');
    if (this.pathLabelEl) this.pathLabelEl.textContent = tr('github_import_path_label');
    if (this.tokenLabelEl) this.tokenLabelEl.textContent = tr('github_import_token_label');
    if (this.tokenHintEl) this.tokenHintEl.textContent = tr('github_import_token_hint');
    if (this.optsLabelEl) this.optsLabelEl.textContent = tr('github_import_options_label');
    if (this.fmLabelEl) this.fmLabelEl.textContent = tr('github_import_parse_frontmatter');
    if (this.layoutLabelEl) this.layoutLabelEl.textContent = tr('github_import_folder_layout');
    if (this.previewBtnEl) this.previewBtnEl.textContent = tr('github_import_preview');
    if (this.applyBtnEl) this.applyBtnEl.textContent = tr('github_import_apply');
    if (this.dropEl) this.dropEl.textContent = tr('github_import_local_drop');
    if (this.localFolderBtnEl) this.localFolderBtnEl.textContent = tr('github_import_local_pick');
    if (this.localFilesBtnEl) this.localFilesBtnEl.textContent = tr('github_import_local_pick_files');
    if (this.localApplyBtnEl) this.localApplyBtnEl.textContent = tr('github_import_local_apply');
  }
}

async function walkEntry(entry, prefix, out) {
  if (entry.isFile) {
    return new Promise((resolve) => {
      entry.file((file) => {
        out.push({ file, relpath: `${prefix}${file.name}`, size: file.size });
        resolve();
      }, () => resolve());
    });
  }
  if (entry.isDirectory) {
    return new Promise((resolve) => {
      const reader = entry.createReader();
      const all = [];
      const readBatch = () => {
        reader.readEntries(async (results) => {
          if (!results.length) {
            await Promise.all(all.map((e) => walkEntry(e, `${prefix}${entry.name}/`, out)));
            resolve();
            return;
          }
          all.push(...results);
          readBatch();
        }, () => resolve());
      };
      readBatch();
    });
  }
}
