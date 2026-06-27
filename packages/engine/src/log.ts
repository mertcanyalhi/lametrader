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
  return root.child({ scope });
}

/**
 * Internal: install (or clear, when `stream` is omitted) a write sink for
 * captured records. Tests use this to assert against emitted log lines
 * without having to reconstruct or proxy the module-top scoped children.
 */
export function _resetLogRoot(stream?: DestinationStream): void {
  activeStream = stream;
}
