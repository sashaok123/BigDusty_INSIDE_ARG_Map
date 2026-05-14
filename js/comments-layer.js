/* Comment pins overlay. Renders draggable numbered bubbles at canvas
   positions; click expands a thread popover. Authed users can drop a
   pin (Arm mode) and reply; everyone can read. Backed by
   POST/GET /canvas/{id}/comments. */

import { tr } from './i18n.js';
import {
  listComments as apiListComments,
  createComment as apiCreateComment,
  replyToComment as apiReplyToComment,
} from './api-client.js';

export class CommentsLayer {
  constructor(opts) {
    this.viewport = opts.viewport;
    this.getTransform = opts.getTransform || (() => ({ scale: 1, panX: 0, panY: 0 }));
    this.isLoggedIn = opts.isLoggedIn || (() => false);
    this.canvasId = opts.canvasId || 'main';
    this.comments = [];
    this._build();
    this._armed = false;
    this._raf = null;
  }

  _build() {
    if (!this.viewport) return;
    const wrap = document.createElement('div');
    wrap.className = 'comments-layer';
    wrap.style.position = 'absolute';
    wrap.style.inset = '0';
    wrap.style.pointerEvents = 'none';
    wrap.style.zIndex = '740';
    this.viewport.appendChild(wrap);
    this.el = wrap;
    this.viewport.addEventListener('click', (ev) => this._onViewportClick(ev), true);
  }

  armNextClick() {
    this._armed = true;
    document.body.classList.add('comment-arm');
  }

  disarm() {
    this._armed = false;
    document.body.classList.remove('comment-arm');
  }

  async loadInitial() {
    try {
      const list = await apiListComments(this.canvasId);
      this.comments = Array.isArray(list) ? list : [];
      this.requestDraw();
    } catch (e) {
      void e;
    }
  }

  requestDraw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      this._draw();
    });
  }

  _draw() {
    if (!this.el) return;
    while (this.el.firstChild) this.el.removeChild(this.el.firstChild);
    const t = this.getTransform();
    for (let i = 0; i < this.comments.length; i++) {
      const c = this.comments[i];
      if (!c || typeof c.x !== 'number' || typeof c.y !== 'number') continue;
      const sx = c.x * t.scale + t.panX;
      const sy = c.y * t.scale + t.panY;
      const pin = document.createElement('button');
      pin.type = 'button';
      pin.className = 'comment-pin';
      pin.style.position = 'absolute';
      pin.style.left = `${sx - 14}px`;
      pin.style.top = `${sy - 14}px`;
      pin.style.pointerEvents = 'auto';
      pin.textContent = String(i + 1);
      pin.title = c.thread && c.thread.length
        ? c.thread[0].body
        : tr('comment_pin_label', { n: i + 1 });
      pin.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this._openThread(c, pin);
      });
      this.el.appendChild(pin);
    }
  }

  async _onViewportClick(ev) {
    if (!this._armed) return;
    if (ev.target && ev.target.closest && ev.target.closest('.comment-pin, .comments-panel, #left-rail, #toolbar, #panel, #edit-node-modal, #editor-modal, #confirm-modal')) return;
    this.disarm();
    if (!this.isLoggedIn()) return;
    const t = this.getTransform();
    const r = this.viewport.getBoundingClientRect();
    const x = (ev.clientX - r.left - t.panX) / t.scale;
    const y = (ev.clientY - r.top - t.panY) / t.scale;
    const body = prompt(tr('comment_prompt'));
    if (!body || !body.trim()) return;
    try {
      const created = await apiCreateComment(this.canvasId, { x, y, body: body.trim() });
      if (created && created.id) {
        this.comments.push(created);
        this.requestDraw();
      }
    } catch (e) {
      console.warn('[comments] create failed', e);
    }
  }

  _openThread(c, anchor) {
    const existing = document.querySelector('.comments-panel');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    const panel = document.createElement('div');
    panel.className = 'comments-panel';
    const rect = anchor.getBoundingClientRect();
    panel.style.left = `${Math.min(window.innerWidth - 320, rect.right + 8)}px`;
    panel.style.top = `${Math.max(8, rect.top - 8)}px`;
    panel.style.zIndex = '1500';
    panel.innerHTML = `
      <div class="comments-panel-head">
        <span>${tr('comment_thread')}</span>
        <button type="button" class="comments-panel-close" aria-label="${tr('side_panel_close')}">&times;</button>
      </div>
      <div class="comments-panel-thread"></div>
      <form class="comments-panel-reply">
        <input type="text" placeholder="${tr('comment_reply_placeholder')}">
        <button type="submit" class="modal-btn primary">${tr('comment_send')}</button>
      </form>
    `;
    document.body.appendChild(panel);
    const threadHost = panel.querySelector('.comments-panel-thread');
    const renderThread = () => {
      threadHost.innerHTML = '';
      const items = c.thread || [];
      for (const t of items) {
        const row = document.createElement('div');
        row.className = 'comments-msg';
        const author = document.createElement('div');
        author.className = 'comments-msg-author';
        author.textContent = t.author || '';
        const body = document.createElement('div');
        body.className = 'comments-msg-body';
        body.textContent = t.body || '';
        row.appendChild(author); row.appendChild(body);
        threadHost.appendChild(row);
      }
    };
    renderThread();
    panel.querySelector('.comments-panel-close').addEventListener('click', () => {
      try { panel.parentNode.removeChild(panel); } catch (e) { void e; }
    });
    const form = panel.querySelector('.comments-panel-reply');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!this.isLoggedIn()) return;
      const input = form.querySelector('input');
      const body = (input.value || '').trim();
      if (!body) return;
      input.disabled = true;
      try {
        const next = await apiReplyToComment(this.canvasId, c.id, { body });
        if (next && next.thread) {
          c.thread = next.thread;
          renderThread();
          input.value = '';
        }
      } catch (er) {
        console.warn('[comments] reply failed', er);
      } finally {
        input.disabled = false;
      }
    });
  }
}
