import pino, { type DestinationStream, type Level, type Logger } from 'pino';

/**
 * A pino log level (`trace` … `fatal`, or `silent`).
 */
export type LogLevel = Level | 'silent';

/**
 * A per-scope level override: a `pattern` (literal, `prefix.*`, or bare `*`) and
 * the {@link LogLevel} to apply to any matching scope.
 */
export interface LogScopeOverride {
  /** The scope pattern to match (literal, `prefix.*`, or `*`). */
  pattern: string;
  /** The level applied to a matching scope. */
  level: LogLevel;
}

/**
 * The relocated rule-engine logger — the engine's own scoped pino instance,
 * carried over verbatim from `engine/src/log.ts` (its `loadSettings()` source is
 * severed here; the root defaults to `info` with no scope overrides).
 *
 * The rule engine is relocated as-is (ADR-0018), so its fine-grained per-scope
 * trace logging — asserted structurally by the engine's `*.trace` suites via the
 * `_reset*` / `_setLogLevel` hooks — comes with it, rather than being rewritten
 * onto `nestjs-pino` (whose request-scoped logger offers no such test seam). This
 * is the rules subsystem's own logger, distinct from the app's request logger.
 */

/**
 * The active write sink for the engine's log records. `undefined` (the
 * production default) routes through to `process.stdout`. Tests install a
 * recording sink via {@link _resetLogRoot}; the indirection means scoped
 * children captured at module top (`const log = getLogger('foo')`) still
 * see the test sink without any reconstruction.
 */
let activeStream: DestinationStream | undefined;

/**
 * Proxy destination Pino routes every record through. Stable for the
 * lifetime of the process so scoped children remain attached; the actual
 * sink is resolved per write via {@link activeStream}.
 */
const proxyStream: DestinationStream = {
  write(line: string): void {
    if (activeStream !== undefined) {
      activeStream.write(line);
      return;
    }
    process.stdout.write(line);
  },
};

/**
 * The engine's root logger — level `info` by default, base field
 * `{ app: 'engine' }`, sink routed through {@link proxyStream}.
 */
const root: Logger = pino({ level: 'info', base: { app: 'engine' } }, proxyStream);

/**
 * Active per-scope level overrides — empty by default; tests swap it via
 * {@link _resetLogScopes}. Reads happen at child-creation time inside
 * {@link getLogger} and on every pass of {@link _resetLogScopes}.
 */
let activeScopes: readonly LogScopeOverride[] = [];

/**
 * Every child returned by {@link getLogger}, tracked so {@link _setLogLevel}
 * (and {@link _resetLogScopes}) can propagate a level change into the
 * captured module-top loggers (Pino does not re-read parent level after the
 * child is created).
 */
const childRegistry: Logger[] = [];

/**
 * Per-`scope` Pino child cache.
 *
 * Two callers of `getLogger('engine.rules.dispatch')` get the same child so
 * a `_resetLogScopes(...)` call applies consistently and the registry
 * doesn't bloat over re-imports in long-running tests.
 */
const childCache = new Map<string, Logger>();

/**
 * Return a Pino child logger with `{ scope }` baked into every entry — the
 * engine's equivalent of the web package's `getLogger`.
 *
 * Each engine subsystem builds its own at module top
 * (`const log = getLogger('engine.rules.dispatch')`) so logs from one part
 * of the engine can be filtered out of the stream by `scope`.
 *
 * The child's level is the first matching pattern from `activeScopes` when one
 * matches; otherwise the inherited global level. Matching is performed at
 * child-creation time; calling `getLogger` again with the same scope returns the
 * cached child (so the cache and the registry stay aligned).
 */
export function getLogger(scope: string): Logger {
  const cached = childCache.get(scope);
  if (cached !== undefined) return cached;
  const child = root.child({ scope });
  const override = matchScopeOverride(scope, activeScopes);
  if (override !== null) child.level = override;
  childRegistry.push(child);
  childCache.set(scope, child);
  return child;
}

/**
 * Find the first {@link LogScopeOverride} whose `pattern` matches `scope`,
 * returning the associated level (or `null` if no entry matches).
 *
 * Two pattern shapes are supported:
 * - Literal — `pattern === scope`.
 * - `prefix.*` — matches any scope whose name starts with `prefix.`; the
 *   bare `*` matches every scope.
 */
function matchScopeOverride(
  scope: string,
  overrides: readonly LogScopeOverride[],
): LogLevel | null {
  for (const { pattern, level } of overrides) {
    if (pattern === '*') return level;
    if (pattern === scope) return level;
    if (pattern.endsWith('.*')) {
      const prefix = pattern.slice(0, -1); // keep the trailing '.'
      if (scope.startsWith(prefix)) return level;
    }
  }
  return null;
}

/**
 * Internal: install (or clear, when `stream` is omitted) a write sink for
 * captured records. Tests use this to assert against emitted log lines
 * without having to reconstruct or proxy the module-top scoped children.
 */
export function _resetLogRoot(stream?: DestinationStream): void {
  activeStream = stream;
}

/**
 * Internal: raise or lower the active log level on the root logger and every
 * already-created child. Tests use this to enable `'trace'` before driving
 * the orchestrator, so trace records reach the captured sink (Pino's level
 * filter is evaluated per-logger and is not re-inherited from the root).
 */
export function _setLogLevel(level: string): void {
  root.level = level;
  for (const child of childRegistry) child.level = level;
}

/**
 * Internal: install a new `logScopes` array and re-apply it to every
 * already-created child — a matching child overrides the root's current
 * level; a non-matching child falls back to the root's current level.
 * Tests use this to assert per-scope gating without re-importing the
 * module-under-test.
 */
export function _resetLogScopes(overrides: readonly LogScopeOverride[]): void {
  activeScopes = overrides;
  for (const child of childRegistry) {
    const scope = (child.bindings() as { scope?: string }).scope ?? '';
    const override = matchScopeOverride(scope, activeScopes);
    child.level = override ?? root.level;
  }
}
