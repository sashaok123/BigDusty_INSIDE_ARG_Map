/* ShareLinkModal: admin generates a read-only share link with optional TTL,
   sees a list of active links, and can revoke them. */

import { tr } from './i18n.js';
import {
  createShareLink,
  listShareLinks,
  revokeShareLink,
} from './api-client.js';
import { CANVAS_ID } from './config.js';

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

function expiryLabel(iso) {
  if (!iso) return tr('share_modal_expires_never');
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const d = new Date(t);
  return d.toLocaleString();
}

const EXPIRY_OPTIONS = [
  { value: '1', labelKey: 'share_modal_expires_1h' },
  { value: '24', labelKey: 'share_modal_expires_24h' },
  { value: '168', labelKey: 'share_modal_expires_7d' },
  { value: '720', labelKey: 'share_modal_expires_30d' },
  { value: '', labelKey: 'share_modal_expires_never' },
];

export class ShareLinkModal {
  constructor(opts) {
    this.canvasId = (opts && opts.canvasId) || CANVAS_ID;
    this.onMessage = (opts && opts.onMessage) || (() => {});
    this._build();
  }

  _build() {
    const modal = el('div', { id: 'share-modal', class: 'auth-modal' });
    const box = el('div', { class: 'auth-modal-box wide' });
    const head = el('div', { class: 'auth-modal-head' });
    const titleEl = el('h2', { text: tr('share_modal_title') });
    const close = el('button', { type: 'button', class: 'auth-x', html: '&times;' });
    head.appendChild(titleEl); head.appendChild(close);

    const body = el('div', { class: 'auth-modal-body' });

    const formWrap = el('div', { class: 'share-form' });
    const expiryLabelEl = el('label', { text: tr('share_modal_expires_label'), class: 'share-form-label' });
    const expiry = el('select', { class: 'share-form-select' });
    for (const opt of EXPIRY_OPTIONS) {
      const o = el('option', { value: opt.value, text: tr(opt.labelKey) });
      expiry.appendChild(o);
    }
    expiry.value = '24';
    const createBtn = el('button', { type: 'button', class: 'auth-primary', text: tr('share_modal_create') });
    formWrap.appendChild(expiryLabelEl); formWrap.appendChild(expiry); formWrap.appendChild(createBtn);

    const errEl = el('div', { class: 'auth-error' });

    const resultRow = el('div', { class: 'share-result' });
    resultRow.style.display = 'none';
    const resultLabel = el('div', { class: 'share-result-label', text: tr('share_modal_url_label') });
    const resultUrlIn = el('input', { type: 'text', readonly: 'readonly', class: 'share-result-url' });
    const resultCopy = el('button', { type: 'button', class: 'auth-primary share-result-copy', text: tr('share_modal_copy') });
    resultRow.appendChild(resultLabel); resultRow.appendChild(resultUrlIn); resultRow.appendChild(resultCopy);

    const listTitle = el('h3', { class: 'share-list-title', text: tr('share_modal_existing') });
    const listEl = el('div', { class: 'share-list' });

    body.appendChild(formWrap);
    body.appendChild(errEl);
    body.appendChild(resultRow);
    body.appendChild(listTitle);
    body.appendChild(listEl);
    box.appendChild(head); box.appendChild(body);
    modal.appendChild(box);
    document.body.appendChild(modal);

    const closeFn = () => modal.classList.remove('open');
    close.addEventListener('click', closeFn);
    modal.addEventListener('mousedown', (e) => { if (e.target === modal) closeFn(); });

    const reload = async () => {
      listEl.innerHTML = '';
      try {
        const rows = await listShareLinks(this.canvasId);
        if (!Array.isArray(rows) || rows.length === 0) {
          listEl.appendChild(el('div', { class: 'share-empty', text: tr('share_modal_empty') }));
          return;
        }
        for (const r of rows) listEl.appendChild(this._renderRow(r, reload));
      } catch (e) {
        errEl.textContent = tr('share_modal_error_load');
      }
    };

    createBtn.addEventListener('click', async () => {
      errEl.textContent = '';
      createBtn.disabled = true;
      const v = expiry.value;
      const expHours = v === '' ? null : Number(v);
      try {
        const result = await createShareLink(this.canvasId, expHours);
        if (result && result.share_url) {
          resultUrlIn.value = result.share_url;
          resultRow.style.display = 'flex';
          setTimeout(() => { resultUrlIn.focus(); resultUrlIn.select(); }, 20);
        }
        await reload();
      } catch (e) {
        errEl.textContent = (e && e.kind === 'network') ? tr('login_error_network') : tr('share_modal_error_create');
      } finally {
        createBtn.disabled = false;
      }
    });

    resultCopy.addEventListener('click', async () => {
      const v = resultUrlIn.value;
      if (!v) return;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(v);
        } else {
          resultUrlIn.focus(); resultUrlIn.select();
          document.execCommand('copy');
        }
        resultCopy.textContent = tr('share_modal_copied');
        setTimeout(() => { resultCopy.textContent = tr('share_modal_copy'); }, 1500);
      } catch (e) { void e; }
    });

    this.modalEl = modal;
    this.titleEl = titleEl;
    this.expiryLabelEl = expiryLabelEl;
    this.expirySelectEl = expiry;
    this.createBtnEl = createBtn;
    this.resultLabelEl = resultLabel;
    this.resultCopyEl = resultCopy;
    this.resultRowEl = resultRow;
    this.resultUrlIn = resultUrlIn;
    this.listTitleEl = listTitle;
    this._reload = reload;
  }

  _renderRow(row, reload) {
    const wrap = el('div', { class: 'share-row' });
    const urlSpan = el('span', { class: 'share-row-url', text: row.share_url || '' });
    urlSpan.title = row.share_url || '';
    const exp = el('span', { class: 'share-row-exp', text: expiryLabel(row.expires_at) });
    const acts = el('div', { class: 'share-row-acts' });
    const copy = el('button', { type: 'button', class: 'share-row-copy', text: tr('share_modal_copy') });
    copy.addEventListener('click', async () => {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(row.share_url || '');
        }
        copy.textContent = tr('share_modal_copied');
        setTimeout(() => { copy.textContent = tr('share_modal_copy'); }, 1500);
      } catch (e) { void e; }
    });
    const revoke = el('button', { type: 'button', class: 'danger', text: tr('share_modal_revoke') });
    revoke.addEventListener('click', async () => {
      revoke.disabled = true;
      try {
        await revokeShareLink(row.token);
        await reload();
      } catch (e) {
        revoke.disabled = false;
      }
    });
    acts.appendChild(copy); acts.appendChild(revoke);
    wrap.appendChild(urlSpan); wrap.appendChild(exp); wrap.appendChild(acts);
    return wrap;
  }

  async open() {
    this.modalEl.classList.add('open');
    this.resultRowEl.style.display = 'none';
    this.resultUrlIn.value = '';
    if (typeof this._reload === 'function') await this._reload();
  }

  close() { this.modalEl.classList.remove('open'); }
  isOpen() { return this.modalEl.classList.contains('open'); }
}
