/* HTML overlay for audio nodes (kind: 'audio'). Renders a card with a Play
   button + filename + duration. The <audio> element is NOT instantiated
   until the user clicks Play for the first time (lazy load). */

import { tr } from './i18n.js';

function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

const PLAY_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 5l12 7-12 7z"/></svg>';
const PAUSE_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>';

export class AudioOverlay {
  constructor(opts) {
    this.viewport = opts.viewport;
    this.getNodes = opts.getNodes;
    this.getTransform = opts.getTransform;
    this.viewer = opts.viewer || null;
    this._raf = null;
    this._build();
    if (this.viewer && typeof this.viewer.subscribe === 'function') {
      this.viewer.subscribe((kind) => {
        if (kind === 'transform' || kind === 'nodes') this.requestDraw();
      });
    }
    document.addEventListener('i18n:changed', () => this._retranslate());
  }

  _build() {
    if (!this.viewport) return;
    const wrap = document.createElement('div');
    wrap.className = 'audio-overlay';
    wrap.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:720';
    this.viewport.appendChild(wrap);
    this.el = wrap;
    this._mounted = new Map();
  }

  requestDraw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = null; this._draw(); });
  }

  _draw() {
    if (!this.el) return;
    const t = this.getTransform();
    const seenIds = new Set();
    for (const n of this.getNodes().values()) {
      if (n.kind !== 'audio') continue;
      seenIds.add(n.id);
      let host = this._mounted.get(n.id);
      if (!host) { host = this._buildCard(n); this.el.appendChild(host); this._mounted.set(n.id, host); }
      host.style.left = `${n.x * t.scale + t.panX}px`;
      host.style.top = `${n.y * t.scale + t.panY}px`;
      host.style.width = `${n.width * t.scale}px`;
      host.style.height = `${n.height * t.scale}px`;
      this._syncMeta(host, n);
    }
    for (const [id, host] of this._mounted.entries()) {
      if (!seenIds.has(id)) {
        if (host.parentNode) host.parentNode.removeChild(host);
        this._mounted.delete(id);
      }
    }
  }

  _retranslate() {
    for (const [, host] of this._mounted) {
      const playBtn = host.querySelector('.audio-card-play');
      if (playBtn && !host._audioEl) {
        playBtn.title = tr('audio_play');
        playBtn.setAttribute('aria-label', tr('audio_play'));
      }
      const lbl = host.querySelector('.audio-card-state');
      if (lbl && !host._audioEl) lbl.textContent = tr('audio_loading');
    }
  }

  _syncMeta(host, node) {
    const nameEl = host.querySelector('.audio-card-name');
    if (nameEl) nameEl.textContent = node.name || node.slug || node.id;
  }

  _buildCard(node) {
    const card = document.createElement('div');
    card.className = 'audio-card';
    card.dataset.id = node.id;
    card.style.cssText = 'position:absolute;pointer-events:auto';
    const head = document.createElement('div');
    head.className = 'audio-card-head';
    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'audio-card-play';
    playBtn.title = tr('audio_play');
    playBtn.setAttribute('aria-label', tr('audio_play'));
    playBtn.innerHTML = PLAY_SVG;
    head.appendChild(playBtn);
    const meta = document.createElement('div');
    meta.className = 'audio-card-meta';
    const nameEl = document.createElement('div');
    nameEl.className = 'audio-card-name';
    nameEl.textContent = node.name || node.slug || node.id;
    const stateEl = document.createElement('div');
    stateEl.className = 'audio-card-state';
    stateEl.textContent = tr('audio_loading');
    meta.appendChild(nameEl); meta.appendChild(stateEl);
    head.appendChild(meta);
    card.appendChild(head);
    playBtn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      this._materialise(card, node);
    });
    return card;
  }

  _materialise(card, node) {
    if (card._audioEl) {
      const audio = card._audioEl;
      if (audio.paused) audio.play().catch(() => {}); else audio.pause();
      return;
    }
    const head = card.querySelector('.audio-card-head');
    if (head && head.parentNode === card) card.removeChild(head);
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.src = (node.media && node.media.url) || node.file || '';
    const defaultVol = node.media && Number.isFinite(node.media.volume_default)
      ? node.media.volume_default : 0.5;
    audio.volume = Math.max(0, Math.min(1, defaultVol));

    const row = document.createElement('div');
    row.className = 'audio-card-row';
    const playPause = document.createElement('button');
    playPause.type = 'button';
    playPause.className = 'audio-card-play';
    playPause.title = tr('audio_play');
    playPause.setAttribute('aria-label', tr('audio_play'));
    playPause.innerHTML = PLAY_SVG;
    const time = document.createElement('div');
    time.className = 'audio-card-time';
    time.textContent = '0:00 / 0:00';
    row.appendChild(playPause); row.appendChild(time);
    card.appendChild(row);

    const seek = document.createElement('input');
    seek.type = 'range'; seek.min = '0'; seek.max = '1000'; seek.value = '0';
    seek.className = 'audio-card-seek';
    seek.setAttribute('aria-label', tr('audio_play'));
    card.appendChild(seek);

    const volRow = document.createElement('div');
    volRow.className = 'audio-card-vol-row';
    const volLabel = document.createElement('span');
    volLabel.className = 'audio-card-vol-label';
    volLabel.textContent = tr('audio_volume');
    const vol = document.createElement('input');
    vol.type = 'range'; vol.min = '0'; vol.max = '100';
    vol.value = String(Math.round(audio.volume * 100));
    vol.className = 'audio-card-vol';
    vol.setAttribute('aria-label', tr('audio_volume'));
    volRow.appendChild(volLabel); volRow.appendChild(vol);
    card.appendChild(volRow);
    card.appendChild(audio);
    card._audioEl = audio;

    const updateBtn = () => {
      const paused = audio.paused;
      playPause.innerHTML = paused ? PLAY_SVG : PAUSE_SVG;
      const lbl = paused ? tr('audio_play') : tr('audio_pause');
      playPause.title = lbl;
      playPause.setAttribute('aria-label', lbl);
    };

    audio.addEventListener('loadedmetadata', () => {
      time.textContent = `${fmtTime(audio.currentTime)} / ${fmtTime(audio.duration || 0)}`;
    });
    audio.addEventListener('timeupdate', () => {
      const dur = audio.duration || 0;
      if (dur > 0) seek.value = String(Math.round((audio.currentTime / dur) * 1000));
      time.textContent = `${fmtTime(audio.currentTime)} / ${fmtTime(dur)}`;
    });
    audio.addEventListener('play', updateBtn);
    audio.addEventListener('pause', updateBtn);
    audio.addEventListener('ended', updateBtn);

    playPause.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (audio.paused) audio.play().catch(() => {}); else audio.pause();
    });
    seek.addEventListener('input', () => {
      const dur = audio.duration || 0;
      if (dur > 0) audio.currentTime = (Number(seek.value) / 1000) * dur;
    });
    vol.addEventListener('input', () => {
      audio.volume = Math.max(0, Math.min(1, Number(vol.value) / 100));
    });
    audio.play().catch(() => {});
    updateBtn();
  }
}
