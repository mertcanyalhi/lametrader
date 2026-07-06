import type { Period } from '@lametrader/core';
import type { OnModuleDestroy } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { OncePerBarLatchStore } from './once-per-bar-latch.types.js';

/** Composite-key separator. */
const SEP = '|';

/**
 * Redis-backed {@link OncePerBarLatchStore} — the production adapter that makes
 * the `OncePerBar` gate survive a restart and be shared across instances (issue
 * #513, ADR-0020).
 *
 * Two key kinds, both under a dedicated Redis (introduced solely for this latch):
 *
 * - `latch|<ruleId>|<symbolId>|<period>` — presence is the latch, written with a
 *   per-key TTL so a missed `BarOpened` or a crashed instance can never wedge it.
 * - `latch-idx|<symbolId>|<period>` — a Set of the rule ids currently latched on
 *   that `(symbol, period)`, so {@link rearm} clears every rule's latch in O(set
 *   members) rather than scanning the keyspace.
 *
 * Behaviour-identical to the in-memory fake, proven by the shared
 * `runOncePerBarLatchStoreContract` suite run over a real Redis (Testcontainers)
 * in the e2e tier.
 */
export class RedisOncePerBarLatchStore implements OncePerBarLatchStore, OnModuleDestroy {
  /** @param redis - the connected client (created and owned by this store). */
  constructor(private readonly redis: Redis) {}

  async isLatched(ruleId: string, symbolId: string, period: Period): Promise<boolean> {
    return (await this.redis.exists(latchKey(ruleId, symbolId, period))) === 1;
  }

  async latch(ruleId: string, symbolId: string, period: Period, ttlMs: number): Promise<void> {
    const key = latchKey(ruleId, symbolId, period);
    const index = indexKey(symbolId, period);
    // Presence = latched; `NX` so a concurrent re-fire never resets the TTL. The
    // sibling per-`(symbol, period)` index set records the rule id so `rearm`
    // can clear every rule's latch without a keyspace scan; it carries the same
    // TTL as its own backstop (every latch under one index shares the period,
    // hence the same ttlMs).
    await this.redis
      .multi()
      .set(key, '1', 'PX', ttlMs, 'NX')
      .sadd(index, ruleId)
      .pexpire(index, ttlMs)
      .exec();
  }

  async rearm(symbolId: string, period: Period): Promise<void> {
    const index = indexKey(symbolId, period);
    const ruleIds = await this.redis.smembers(index);
    const keys = ruleIds.map((ruleId) => latchKey(ruleId, symbolId, period));
    // UNLINK (non-blocking DEL) the index plus every latch it names. Entries that
    // already TTL-expired are a no-op, so the index and its latches may drift
    // freely — `isLatched` always reads the latch key, never the index.
    await this.redis.unlink(index, ...keys);
  }

  /**
   * Close the client on app shutdown so `app.close()` (e2e + SIGTERM) doesn't
   * leak the connection. Best-effort: a `quit()` against an already-dropped
   * socket falls back to a synchronous `disconnect()`.
   */
  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}

/** Presence-latch key for one `(rule, symbol, period)`. */
function latchKey(ruleId: string, symbolId: string, period: Period): string {
  return `latch${SEP}${ruleId}${SEP}${symbolId}${SEP}${period}`;
}

/** Re-arm index-set key for one `(symbol, period)`. */
function indexKey(symbolId: string, period: Period): string {
  return `latch-idx${SEP}${symbolId}${SEP}${period}`;
}
