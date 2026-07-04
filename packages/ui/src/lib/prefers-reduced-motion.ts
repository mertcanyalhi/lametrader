/**
 * Whether the user has asked the OS/browser to reduce motion
 * (`prefers-reduced-motion: reduce`). Wrapped here rather than read inline so
 * components never touch `window.matchMedia` directly (see `web/CLAUDE.md`), and
 * so callers degrade gracefully where `matchMedia` is absent (e.g. jsdom without
 * a stub) — treated as "motion allowed".
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
