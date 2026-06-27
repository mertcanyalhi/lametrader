import pino, { type DestinationStream, type Logger } from 'pino';

import { loadSettings } from './settings.js';

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
 * The engine's root logger — level resolved from `loadSettings()`, base
 * field `{ app: 'engine' }`, sink routed through {@link proxyStream}.
 */
const root: Logger = pino({ level: loadSettings().logLevel, base: { app: 'engine' } }, proxyStream);

/**
 * Every child returned by {@link getLogger}, tracked so {@link _setLogLevel}
 * can propagate a level change into the captured module-top loggers (Pino
 * does not re-read parent level after the child is created).
 */
const childRegistry: Logger[] = [];

/**
 * Return a Pino child logger with `{ scope }` baked into every entry — the
 * engine's equivalent of the web package's `getLogger`.
 *
 * Each engine subsystem builds its own at module top
 * (`const log = getLogger('rule-orchestrator')`) so logs from one part of
 * the engine can be filtered out of the stream by `scope`.
 *
 * Closes #306.
 */
export function getLogger(scope: string): Logger {
  const child = root.child({ scope });
  childRegistry.push(child);
  return child;
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
