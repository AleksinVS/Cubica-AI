// src/app/utils/assetPath.js CURENTLY NOT USED>dead code
const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';

export function normalizeAssetUrl(p) {
  if (!p) return p;
  if (/^data:|^https?:\/\//i.test(p)) return p; // absolute or data:
  if (p.startsWith('/')) return `${BASE}${p}`;   // root absolute
  // "./images/foo.png" or "images/foo.png" -> "/images/foo.png"
  return `${BASE}/${p.replace(/^\.?\/*/, '')}`;
}

export function normalizeCssUrls(style) {
  if (!style) return style;
  const out = { ...style };
  for (const k in out) {
    const v = out[k];
    if (typeof v === 'string' && v.includes('url(')) {
      out[k] = v.replace(
        /url\((['"]?)(.+?)\1\)/g,
        (_m, _q, path) => `url(${normalizeAssetUrl(path)})`
      );
    }
  }
  return out;
}
