/* Small modal: paste a video URL, detect YouTube/Vimeo, return media info. */

import { tr } from './i18n.js';
import { detectVideoUrl } from './edit-node-modal.js';

export function openVideoUrlDialog() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'video-dialog';
    overlay.innerHTML = `
      <div class="video-dialog-box">
        <div class="video-dialog-head">
          <h2>${tr('video_dialog_title')}</h2>
          <button type="button" class="video-dialog-close" aria-label="${tr('side_panel_close')}">&times;</button>
        </div>
        <div class="video-dialog-body">
          <label>${tr('video_dialog_label')}</label>
          <input type="text" class="video-dialog-input" placeholder="https://youtube.com/watch?v=...">
          <div class="video-dialog-hint"></div>
        </div>
        <div class="video-dialog-foot">
          <button type="button" class="modal-btn cancel video-dialog-cancel">${tr('editor_cancel_button')}</button>
          <button type="button" class="modal-btn primary video-dialog-ok">${tr('video_dialog_add')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('.video-dialog-input');
    const hint = overlay.querySelector('.video-dialog-hint');
    const okBtn = overlay.querySelector('.video-dialog-ok');
    const close = (info) => {
      try { document.body.removeChild(overlay); } catch (e) { void e; }
      resolve(info);
    };
    overlay.querySelector('.video-dialog-close').addEventListener('click', () => close(null));
    overlay.querySelector('.video-dialog-cancel').addEventListener('click', () => close(null));
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(null); });
    okBtn.disabled = true;
    const reflect = () => {
      const info = detectVideoUrl(input.value);
      if (info) {
        hint.textContent = tr('edit_modal_video_recognised', { provider: info.provider });
        hint.classList.remove('error');
        okBtn.disabled = false;
        okBtn._info = info;
      } else {
        hint.textContent = input.value.trim() ? tr('edit_modal_video_unknown') : '';
        hint.classList.toggle('error', !!input.value.trim());
        okBtn.disabled = true;
      }
    };
    input.addEventListener('input', reflect);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(null); }
      if (e.key === 'Enter' && !okBtn.disabled) { e.preventDefault(); close(okBtn._info); }
    });
    okBtn.addEventListener('click', () => close(okBtn._info));
    setTimeout(() => input.focus(), 30);
  });
}
