/**
 * Minimal frontend logger so feature modules don't reach for `console.*`
 * directly. Each entry is namespaced (`[web/<scope>]`) so logs from different
 * subsystems are grep-able in the browser console.
 *
 * Levels are intentionally narrow: `warn` for swallowed failures (kept-running
 * conditions worth flagging) and `error` for thrown / fatal paths. Use `info`
 * / `debug` only when we introduce them with a real driver — until then, those
 * messages have no callers and shouldn't exist.
 */
export const log = {
  /**
   * Flag a non-fatal anomaly — typically inside a `catch` block where the
   * caller intentionally falls through with a fallback value.
   */
  warn(scope: string, message: string, context?: Record<string, unknown>): void {
    console.warn(`[web/${scope}] ${message}`, context ?? {});
  },
  /**
   * Flag a fatal condition that the caller is about to surface to the user
   * (typically by throwing). The log gives a developer / SRE the breadcrumb
   * they would otherwise have to dig out of the network panel.
   */
  error(scope: string, message: string, context?: Record<string, unknown>): void {
    console.error(`[web/${scope}] ${message}`, context ?? {});
  },
};
