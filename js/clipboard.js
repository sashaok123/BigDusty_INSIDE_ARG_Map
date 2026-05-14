/* Copy / paste / duplicate manager for nodes and arrows. Internal clipboard
   for fast in-tab operations plus best-effort sync to the system clipboard
   as JSON text so a paste in another tab works. On paste, also try image
   blobs (creates a file node) and plain text (creates a text node). */

export const CLIPBOARD_KIND = 'arg_map_nodes';
export const CLIPBOARD_VERSION = 1;

export class NodeClipboard {
  constructor() {
    this._internal = null;
  }

  hasInternal() { return !!this._internal; }
  getInternal() { return this._internal; }

  async copyPayload(payload) {
    this._internal = payload;
    const obj = { kind: CLIPBOARD_KIND, version: CLIPBOARD_VERSION, ...payload };
    try {
      if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(JSON.stringify(obj));
      }
    } catch (e) { void e; }
    return obj;
  }

  async readSystemPayload() {
    if (!navigator || !navigator.clipboard) return null;
    try {
      if (typeof navigator.clipboard.read === 'function') {
        const items = await navigator.clipboard.read();
        for (const it of items) {
          for (const type of it.types || []) {
            if (type.startsWith('image/')) {
              try {
                const blob = await it.getType(type);
                return { kind: 'image', blob, mime: type };
              } catch (e) { void e; }
            }
          }
        }
      }
    } catch (e) { void e; }
    let text = '';
    try {
      if (typeof navigator.clipboard.readText === 'function') {
        text = await navigator.clipboard.readText();
      }
    } catch (e) {
      void e;
      return null;
    }
    if (!text) return null;
    try {
      const obj = JSON.parse(text);
      if (obj && obj.kind === CLIPBOARD_KIND && Array.isArray(obj.nodes)) {
        return { kind: 'nodes_payload', payload: obj };
      }
    } catch (e) { void e; }
    return { kind: 'text', text };
  }
}
