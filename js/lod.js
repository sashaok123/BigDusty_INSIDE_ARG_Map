/* Level-of-detail rules driven by the viewer's current zoom. Pure: takes a
   scale number, returns flags the viewer / arrows / minimap consume. Levels:
   full (>=0.75), captions hidden (0.5..0.75), thumbnails only (0.25..0.5),
   solid rects (<0.25). The lowest level is also what the minimap always uses. */

export const LOD_LEVELS = ['full', 'no-caption', 'thumbs-only', 'rect-only'];

export function lodFromScale(scale) {
  const s = Number.isFinite(scale) ? scale : 1;
  if (s >= 0.75) return 'full';
  if (s >= 0.5)  return 'no-caption';
  if (s >= 0.25) return 'thumbs-only';
  return 'rect-only';
}

export function lodFlags(level) {
  switch (level) {
    case 'full':
      return {
        level,
        captionsVisible: true,
        edgeLabelsVisible: true,
        thumbnailsVisible: true,
        textVisible: true,
        handlesVisible: true,
      };
    case 'no-caption':
      return {
        level,
        captionsVisible: false,
        edgeLabelsVisible: true,
        thumbnailsVisible: true,
        textVisible: true,
        handlesVisible: true,
      };
    case 'thumbs-only':
      return {
        level,
        captionsVisible: false,
        edgeLabelsVisible: false,
        thumbnailsVisible: true,
        textVisible: false,
        handlesVisible: false,
      };
    case 'rect-only':
    default:
      return {
        level: 'rect-only',
        captionsVisible: false,
        edgeLabelsVisible: false,
        thumbnailsVisible: false,
        textVisible: false,
        handlesVisible: false,
      };
  }
}

export function lodFor(scale) {
  return lodFlags(lodFromScale(scale));
}

export function minimapLod() {
  return lodFlags('rect-only');
}
