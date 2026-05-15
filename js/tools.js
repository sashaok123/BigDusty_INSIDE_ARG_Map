/* Single source of truth for the editor's active tool. The viewer, left
   rail, and keyboard module all read and write through this module so
   shortcuts, button clicks, and pointer behaviour stay in sync. */

export const TOOLS = ['select', 'pan', 'block', 'sticky', 'group', 'text', 'image', 'video', 'arrow', 'transform'];

const SPACE_PAN_TOOL = 'select';

let activeTool = 'select';
let spaceHeld = false;

export function getActiveTool() {
  return activeTool;
}

export function setActiveTool(next) {
  const t = typeof next === 'string' && TOOLS.includes(next) ? next : 'select';
  if (t === activeTool) return;
  activeTool = t;
  emit('tool:changed', { tool: t });
}

export function isPanning() {
  return spaceHeld || activeTool === 'pan';
}

export function setSpaceHeld(held) {
  const v = !!held;
  if (v === spaceHeld) return;
  spaceHeld = v;
  emit('tool:space', { spaceHeld: v });
}

export function isSpaceHeld() {
  return spaceHeld;
}

export function returnToSelect() {
  setActiveTool('select');
}

function emit(type, detail) {
  try {
    document.dispatchEvent(new CustomEvent(type, { detail }));
  } catch (e) { void e; }
}

export function onActiveToolChange(fn) {
  const handler = (ev) => { if (typeof fn === 'function') fn(ev.detail && ev.detail.tool); };
  document.addEventListener('tool:changed', handler);
  return () => document.removeEventListener('tool:changed', handler);
}

export function onSpaceHeldChange(fn) {
  const handler = (ev) => { if (typeof fn === 'function') fn(!!(ev.detail && ev.detail.spaceHeld)); };
  document.addEventListener('tool:space', handler);
  return () => document.removeEventListener('tool:space', handler);
}

export { SPACE_PAN_TOOL };
