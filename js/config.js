/* Runtime configuration. Replace `YOUR_RAILWAY_URL_HERE` after Railway gives
   you a public URL. For local dev override at runtime with:
   <script>window.__ARG_API_BASE__='http://localhost:8000'</script> placed
   before the <script type="module" src="js/app.js"> tag. */

export const API_BASE = (typeof window !== 'undefined' && window.__ARG_API_BASE__)
  || 'https://insideargmap-production.up.railway.app';

export const CANVAS_ID = 'main';

export function isPlaceholderApiBase() {
  return /YOUR_RAILWAY_URL_HERE/i.test(API_BASE);
}

export function wsBase() {
  let s = API_BASE;
  if (s.startsWith('https://')) return 'wss://' + s.slice('https://'.length);
  if (s.startsWith('http://'))  return 'ws://'  + s.slice('http://'.length);
  return s;
}
