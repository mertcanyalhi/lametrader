import type { Period } from '@lametrader/core';
import type { OncePerBarLatchStore } from './once-per-bar-latch.types.js';

/** Composite-key separator (`<ruleId>|<symbolId>|<period>`). */
const SEP = '|';

/**
 * In-memory {@link OncePerBarLatchStore} fake — the unit-tier stand-in for the
 * Redis adapter, and the exact behaviour of the dispatcher's former private
 * `Set` latch, now behind the port.
 *
 * Presence in the {@link latched} set is the latch; {@link rearm} sweeps by the
 * `|<symbol>|<period>` suffix so one symbol's `BarOpened` never clears another's
 * latch of the same period (the leading `|` keeps the match exact even when one
 * symbol id is a suffix of another, e.g. `BTC` / `WBTC`).
 */
export class InMemoryOncePerBarLatchStore implements OncePerBarLatchStore {
  /** The set of currently-latched `<ruleId>|<symbolId>|<period>` keys. */
  private readonly latched = new Set<string>();

  async isLatched(ruleId: string, symbolId: string, period: Period): Promise<boolean> {
    return this.latched.has(key(ruleId, symbolId, period));
  }

  async latch(ruleId: string, symbolId: string, period: Period, _ttlMs: number): Promise<void> {
    // Lazy: a single-process fake never restarts, so the TTL backstop is a
    // no-op here — only the explicit rearm() ever clears an entry, which is the
    // same mechanism the dispatcher relies on and the contract exercises.
    // Upgrade path: honour ttlMs with a timestamp map if a test ever needs to
    // observe expiry (the Redis adapter honours it natively).
    this.latched.add(key(ruleId, symbolId, period));
  }

  async rearm(symbolId: string, period: Period): Promise<void> {
    const suffix = `${SEP}${symbolId}${SEP}${period}`;
    for (const entry of this.latched) {
      if (entry.endsWith(suffix)) this.latched.delete(entry);
    }
  }
}

/** Composite latch key. */
function key(ruleId: string, symbolId: string, period: Period): string {
  return `${ruleId}${SEP}${symbolId}${SEP}${period}`;
}
