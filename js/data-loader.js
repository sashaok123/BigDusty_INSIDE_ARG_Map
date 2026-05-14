/* Async loaders for hotspots.json, blocks_raw.json, arrows.json, and
   per-puzzle markdown files. In-memory cache after first successful fetch. */

const mdCache = new Map();

export async function loadHotspots() {
  const res = await fetch('data/hotspots.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`hotspots.json HTTP ${res.status}`);
  return res.json();
}

export async function loadBlocks() {
  const res = await fetch('data/blocks_raw.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`blocks_raw.json HTTP ${res.status}`);
  return res.json();
}

export function loadBlockImage(block) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${block.file}`));
    img.src = block.file;
  });
}

export async function loadPuzzleMarkdown(slug) {
  if (mdCache.has(slug)) return mdCache.get(slug);
  const url = `data/puzzles/${slug}.md`;
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) {
      const empty = `# ${slug}\n\nNo content yet. Use **Edit raw MD** to add notes.\n`;
      mdCache.set(slug, empty);
      return empty;
    }
    const text = await res.text();
    mdCache.set(slug, text);
    return text;
  } catch (e) {
    const fallback = `# ${slug}\n\nFailed to load: ${e.message}\n`;
    mdCache.set(slug, fallback);
    return fallback;
  }
}

export function setCachedMarkdown(slug, text) {
  mdCache.set(slug, text);
}

export function getCachedMarkdown(slug) {
  return mdCache.get(slug);
}

export function snapshotMarkdownCache() {
  const out = {};
  for (const [k, v] of mdCache) out[k] = v;
  return out;
}

export function restoreMarkdownCache(obj) {
  if (!obj || typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') mdCache.set(k, v);
  }
}
