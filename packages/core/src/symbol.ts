import { Period } from './config.types.js';
import { SymbolType } from './symbol.types.js';

/**
 * Raised when a symbol input fails validation (bad id, bad periods, or no source
 * for the type). Distinct type so driving adapters map it to a client error
 * (HTTP 400) rather than a server fault.
 */
export class SymbolError extends Error {
  /**
   * @param message - the human-readable validation failure reason.
   */
  constructor(message: string) {
    super(message);
    this.name = 'SymbolError';
  }
}

/**
 * Raised when a symbol does not exist — either at its source (on add) or on the
 * watchlist (on update/remove). Driving adapters map it to HTTP 404.
 */
export class SymbolNotFoundError extends Error {
  /**
   * @param message - the human-readable not-found reason.
   */
  constructor(message: string) {
    super(message);
    this.name = 'SymbolNotFoundError';
  }
}

/**
 * Raised when adding a symbol that is already on the watchlist. Driving adapters
 * map it to HTTP 409. Re-adding never mutates the existing entry.
 */
export class SymbolConflictError extends Error {
  /**
   * @param message - the human-readable conflict reason.
   */
  constructor(message: string) {
    super(message);
    this.name = 'SymbolConflictError';
  }
}

/**
 * Raised when a {@link MarketDataSource} fails to serve a request because of an
 * upstream/provider failure (network error, non-2xx, rejected range). Adapters
 * wrap the provider's own error as the `cause`. Driving adapters map it to HTTP
 * 502 (the upstream dependency failed) rather than a generic 500 — it is not an
 * internal bug.
 */
export class MarketDataError extends Error {
  /**
   * @param message - what failed, including the upstream reason.
   * @param options - standard error options; pass the provider error as `cause`.
   */
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'MarketDataError';
  }
}

/**
 * Every valid {@link SymbolType} value, for prefix membership checks.
 */
const TYPE_VALUES = new Set<string>(Object.values(SymbolType));

/**
 * Every valid {@link Period} value, for membership checks.
 */
const PERIOD_VALUES = new Set<string>(Object.values(Period));

/**
 * Derive the {@link SymbolType} from a canonical id (the part before the first
 * `:`).
 *
 * @param id - a canonical symbol id, e.g. `"crypto:BTCUSDT"`.
 * @throws {@link SymbolError} when the prefix is missing or not a known type.
 */
export function symbolType(id: string): SymbolType {
  const prefix = id.split(':')[0];
  if (!prefix || !TYPE_VALUES.has(prefix)) {
    throw new SymbolError(`unknown symbol type in id: ${id}`);
  }
  return prefix as SymbolType;
}

/**
 * Validate and normalize an unknown periods input for a symbol: a non-empty,
 * duplicate-free list of {@link Period}s, each enabled in `supported` (the global
 * config's periods).
 *
 * @param input - the raw periods value (expected to be a string array).
 * @param supported - the platform-enabled periods (global config).
 * @throws {@link SymbolError} on an empty list, a duplicate, a non-enum value, or
 *   a period not present in `supported`.
 */
export function parseSymbolPeriods(input: unknown, supported: Period[]): Period[] {
  if (!Array.isArray(input)) {
    throw new SymbolError('periods must be an array');
  }
  if (input.length === 0) {
    throw new SymbolError('periods must not be empty');
  }
  const supportedSet = new Set<string>(supported);
  const periods: Period[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string' || !PERIOD_VALUES.has(raw)) {
      throw new SymbolError(`unsupported period: ${String(raw)}`);
    }
    const period = raw as Period;
    if (periods.includes(period)) {
      throw new SymbolError(`duplicate period: ${period}`);
    }
    if (!supportedSet.has(period)) {
      throw new SymbolError(`period ${period} is not enabled in config`);
    }
    periods.push(period);
  }
  return periods;
}
