/* Touch gesture handler for the canvas. One-finger drag = pan, two-finger
   pinch = zoom (centred on pinch midpoint), two-finger drag = pan, one-finger
   tap on a node = select, one-finger long-press (500 ms) = context menu. */

const LONG_PRESS_MS = 500;
const TAP_SLOP_PX = 8;
const MIN_PINCH_DIST = 12;

export class TouchHandler {
  constructor(opts) {
    this.canvas = opts.canvas;
    this.viewer = opts.viewer;
    this.onTap = opts.onTap || (() => {});
    this.onLongPress = opts.onLongPress || (() => {});
    this._touches = new Map();
    this._lastPan = null;
    this._lastPinch = null;
    this._longPressTimer = null;
    this._startPt = null;
    this._moved = false;
    this._install();
  }

  _install() {
    if (!this.canvas) return;
    try { this.canvas.style.touchAction = 'none'; } catch (e) { void e; }
    this.canvas.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
    this.canvas.addEventListener('touchmove',  (e) => this._onTouchMove(e),  { passive: false });
    this.canvas.addEventListener('touchend',   (e) => this._onTouchEnd(e),   { passive: false });
    this.canvas.addEventListener('touchcancel', (e) => this._onTouchEnd(e),  { passive: false });
  }

  _updateTouchMap(ev) {
    for (let i = 0; i < ev.touches.length; i++) {
      const t = ev.touches[i];
      this._touches.set(t.identifier, { x: t.clientX, y: t.clientY });
    }
    const ids = new Set();
    for (let i = 0; i < ev.touches.length; i++) ids.add(ev.touches[i].identifier);
    for (const id of Array.from(this._touches.keys())) {
      if (!ids.has(id)) this._touches.delete(id);
    }
  }

  _cancelLongPress() {
    if (this._longPressTimer) {
      clearTimeout(this._longPressTimer);
      this._longPressTimer = null;
    }
  }

  _onTouchStart(ev) {
    ev.preventDefault();
    this._updateTouchMap(ev);
    if (ev.touches.length === 1) {
      const t = ev.touches[0];
      this._startPt = { x: t.clientX, y: t.clientY, t: Date.now() };
      this._moved = false;
      this._lastPan = { x: t.clientX, y: t.clientY };
      this._lastPinch = null;
      this._cancelLongPress();
      this._longPressTimer = setTimeout(() => {
        if (!this._moved && this._startPt) {
          this.onLongPress(this._startPt.x, this._startPt.y);
        }
      }, LONG_PRESS_MS);
    } else if (ev.touches.length === 2) {
      this._cancelLongPress();
      const t1 = ev.touches[0];
      const t2 = ev.touches[1];
      this._lastPinch = this._pinchState(t1, t2);
      this._lastPan = { x: this._lastPinch.cx, y: this._lastPinch.cy };
    } else {
      this._cancelLongPress();
    }
  }

  _onTouchMove(ev) {
    ev.preventDefault();
    this._updateTouchMap(ev);
    if (ev.touches.length === 1 && this._lastPan) {
      const t = ev.touches[0];
      const dx = t.clientX - this._lastPan.x;
      const dy = t.clientY - this._lastPan.y;
      if (this._startPt && (Math.abs(t.clientX - this._startPt.x) > TAP_SLOP_PX
          || Math.abs(t.clientY - this._startPt.y) > TAP_SLOP_PX)) {
        this._moved = true;
        this._cancelLongPress();
      }
      if (this.viewer) {
        const v = this.viewer;
        v.panX += dx;
        v.panY += dy;
        if (typeof v._notifyTransform === 'function') v._notifyTransform();
        v.requestDraw();
      }
      this._lastPan = { x: t.clientX, y: t.clientY };
    } else if (ev.touches.length === 2 && this._lastPinch) {
      const t1 = ev.touches[0];
      const t2 = ev.touches[1];
      const next = this._pinchState(t1, t2);
      if (this.viewer) {
        const v = this.viewer;
        const r = this.canvas.getBoundingClientRect();
        const cx = next.cx - r.left;
        const cy = next.cy - r.top;
        if (next.dist > MIN_PINCH_DIST && this._lastPinch.dist > MIN_PINCH_DIST) {
          const factor = next.dist / this._lastPinch.dist;
          if (typeof v.zoomAt === 'function') v.zoomAt(cx, cy, factor);
        }
        const dx = next.cx - this._lastPinch.cx;
        const dy = next.cy - this._lastPinch.cy;
        v.panX += dx;
        v.panY += dy;
        if (typeof v._notifyTransform === 'function') v._notifyTransform();
        v.requestDraw();
      }
      this._lastPinch = next;
      this._moved = true;
      this._cancelLongPress();
    }
  }

  _onTouchEnd(ev) {
    ev.preventDefault();
    this._updateTouchMap(ev);
    if (ev.touches.length === 0) {
      this._cancelLongPress();
      if (!this._moved && this._startPt) {
        const elapsed = Date.now() - this._startPt.t;
        if (elapsed < LONG_PRESS_MS) {
          this.onTap(this._startPt.x, this._startPt.y);
        }
      }
      this._startPt = null;
      this._lastPan = null;
      this._lastPinch = null;
      this._moved = false;
    } else if (ev.touches.length === 1) {
      const t = ev.touches[0];
      this._lastPan = { x: t.clientX, y: t.clientY };
      this._lastPinch = null;
    }
  }

  _pinchState(t1, t2) {
    const cx = (t1.clientX + t2.clientX) / 2;
    const cy = (t1.clientY + t2.clientY) / 2;
    const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
    return { cx, cy, dist };
  }
}
