/**
 * True only when running in an environment with a real browser window
 * (i.e. not during SSR/SSG in Next.js, Remix, etc.).
 *
 * Guard every access to `window`, `navigator`, or `document` in the
 * store with this — those globals do not exist during server rendering.
 */
export function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof navigator !== "undefined";
}

/**
 * Safe read of navigator.onLine. Returns `true` as a conservative
 * default when not in a browser (assume online rather than showing a
 * false "offline" banner during SSR, before the client can verify).
 */
export function getRawBrowserOnline(): boolean {
  if (!isBrowser()) return true;
  // navigator.onLine is undefined in a handful of very old/non-standard
  // environments; fall back to true rather than let it be falsy-undefined.
  return typeof navigator.onLine === "boolean" ? navigator.onLine : true;
}

/**
 * Safe read of document.hidden. Returns `false` (i.e. "visible") when
 * not in a browser or when the Page Visibility API is unavailable, so
 * pause-when-hidden logic simply never pauses in that case.
 */
export function isDocumentHidden(): boolean {
  if (typeof document === "undefined") return false;
  return typeof document.hidden === "boolean" ? document.hidden : false;
}
