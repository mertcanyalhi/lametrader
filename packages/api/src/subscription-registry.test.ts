import { describe, expect, it, vi } from 'vitest';

import { SubscriptionRegistry } from './subscription-registry.js';
import type { SubscriptionKind } from './subscription-registry.types.js';

interface FakeSocket {
  readyState: number;
  OPEN: number;
  send(data: string): void;
  sent: string[];
}

/** Build a fake socket whose `send` records every frame. */
function fakeSocket(): FakeSocket {
  const sent: string[] = [];
  return {
    readyState: 1,
    OPEN: 1,
    send(frame: string) {
      sent.push(frame);
    },
    sent,
  };
}

/** A no-op fastify logger surface for tests. */
function noopLog() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    child: vi.fn().mockReturnThis(),
    level: 'info',
    silent: vi.fn(),
    bindings: vi.fn().mockReturnValue({}),
    flush: vi.fn(),
    isLevelEnabled: vi.fn().mockReturnValue(true),
    setBindings: vi.fn(),
    /* biome-ignore lint/suspicious/noExplicitAny: shim only */
  } as any;
}

/**
 * Build a sync subscription kind with overridable fields. The default kind
 * accepts `{id: string}`, keys by the id, no-ops the hub subscribe / release,
 * and maps all errors via the generic fallback.
 */
function syncKind(
  overrides: Partial<SubscriptionKind<{ id: string }, string>> = {},
): SubscriptionKind<{ id: string }, string> {
  return {
    subscribeAction: 'sub',
    unsubscribeAction: 'unsub',
    validateSubscribe: (m: unknown) => {
      const r = m as { id?: unknown };
      return typeof r?.id === 'string' ? { input: { id: r.id } } : { error: 'bad' };
    },
    validateUnsubscribe: (m: unknown) => {
      const r = m as { id?: unknown };
      return typeof r?.id === 'string' ? { key: r.id } : { error: 'bad' };
    },
    acquire: ({ id }) => ({ key: id }),
    subscribeHub: () => () => {},
    errorToFrame: (_e, generic) => ({ error: generic }),
    logScope: 'sync stream',
    ...overrides,
  };
}

describe('SubscriptionRegistry — dispatch', () => {
  it('routes a subscribe message to the matching kind by action string', async () => {
    const acquire = vi.fn((input: { id: string }) => ({ key: input.id }));
    const registry = new SubscriptionRegistry([syncKind({ acquire })]);
    const { sent: _ } = fakeSocket();
    const subs = registry.attach(fakeSocket(), noopLog());
    await subs.handle({ action: 'sub', id: 'AAPL' });
    expect(acquire).toHaveBeenCalledWith({ id: 'AAPL' });
  });

  it('replies with {error: "unknown action"} for an unrouted action', async () => {
    const registry = new SubscriptionRegistry([syncKind()]);
    const socket = fakeSocket();
    const subs = registry.attach(socket, noopLog());
    await subs.handle({ action: 'mystery' });
    expect(socket.sent.map((f) => JSON.parse(f))).toEqual([{ error: 'unknown action' }]);
  });

  it('replies with the validator error frame when validateSubscribe returns {error}', async () => {
    const registry = new SubscriptionRegistry([syncKind()]);
    const socket = fakeSocket();
    const subs = registry.attach(socket, noopLog());
    await subs.handle({ action: 'sub' });
    expect(socket.sent.map((f) => JSON.parse(f))).toEqual([{ error: 'bad' }]);
  });

  it('sends the ack reply once acquire + subscribeHub succeed', async () => {
    const registry = new SubscriptionRegistry([
      syncKind({
        acquire: ({ id }) => ({ key: id, reply: { action: 'acked', id } }),
      }),
    ]);
    const socket = fakeSocket();
    const subs = registry.attach(socket, noopLog());
    await subs.handle({ action: 'sub', id: 'AAPL' });
    expect(socket.sent.map((f) => JSON.parse(f))).toEqual([{ action: 'acked', id: 'AAPL' }]);
  });
});

describe('SubscriptionRegistry — async acquire race-check', () => {
  it('releases the acquired key (no hub-subscribe, no reply) when the socket closes mid-acquire', async () => {
    let resolveAcquire!: (v: { key: string }) => void;
    const release = vi.fn();
    const subscribeHub = vi.fn(() => () => {});
    const kind = syncKind({
      acquire: () =>
        new Promise<{ key: string }>((r) => {
          resolveAcquire = r;
        }),
      subscribeHub,
      release,
    });
    const registry = new SubscriptionRegistry([kind]);
    const socket = fakeSocket();
    const subs = registry.attach(socket, noopLog());
    const pending = subs.handle({ action: 'sub', id: 'AAPL' });
    subs.cleanup();
    resolveAcquire({ key: 'AAPL' });
    await pending;
    expect(subscribeHub).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith('AAPL');
  });
});

describe('SubscriptionRegistry — cleanup', () => {
  it('hub-unsubscribes and releases every active subscription on cleanup', async () => {
    const hubUnsub = vi.fn();
    const release = vi.fn();
    const registry = new SubscriptionRegistry([
      syncKind({
        subscribeHub: () => hubUnsub,
        release,
      }),
    ]);
    const subs = registry.attach(fakeSocket(), noopLog());
    await subs.handle({ action: 'sub', id: 'AAPL' });
    subs.cleanup();
    expect(hubUnsub).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith('AAPL');
  });

  it('cleanup is idempotent — second call is a no-op', async () => {
    const hubUnsub = vi.fn();
    const registry = new SubscriptionRegistry([syncKind({ subscribeHub: () => hubUnsub })]);
    const subs = registry.attach(fakeSocket(), noopLog());
    await subs.handle({ action: 'sub', id: 'AAPL' });
    subs.cleanup();
    subs.cleanup();
    expect(hubUnsub).toHaveBeenCalledTimes(1);
  });
});

describe('SubscriptionRegistry — error mapping', () => {
  it('routes a thrown error through errorToFrame and sends the resulting frame', async () => {
    const registry = new SubscriptionRegistry([
      syncKind({
        acquire: () => {
          throw new Error('boom');
        },
        errorToFrame: (error, generic) =>
          error instanceof Error ? { error: error.message } : { error: generic },
      }),
    ]);
    const socket = fakeSocket();
    const subs = registry.attach(socket, noopLog());
    await subs.handle({ action: 'sub', id: 'AAPL' });
    expect(socket.sent.map((f) => JSON.parse(f))).toEqual([{ error: 'boom' }]);
  });

  it('falls back to the generic frame when errorToFrame returns it', async () => {
    const registry = new SubscriptionRegistry([
      syncKind({
        acquire: () => {
          throw new Error('boom');
        },
      }),
    ]);
    const socket = fakeSocket();
    const subs = registry.attach(socket, noopLog());
    await subs.handle({ action: 'sub', id: 'AAPL' });
    expect(socket.sent.map((f) => JSON.parse(f))).toEqual([{ error: 'sub failed' }]);
  });
});

describe('SubscriptionRegistry — unsubscribe', () => {
  it('hub-unsubscribes and releases the matched key on unsubscribe', async () => {
    const hubUnsub = vi.fn();
    const release = vi.fn();
    const registry = new SubscriptionRegistry([
      syncKind({ subscribeHub: () => hubUnsub, release }),
    ]);
    const subs = registry.attach(fakeSocket(), noopLog());
    await subs.handle({ action: 'sub', id: 'AAPL' });
    subs.handle({ action: 'unsub', id: 'AAPL' });
    expect(hubUnsub).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith('AAPL');
  });

  it('replies with the validator error frame when validateUnsubscribe returns {error}', () => {
    const registry = new SubscriptionRegistry([syncKind()]);
    const socket = fakeSocket();
    const subs = registry.attach(socket, noopLog());
    subs.handle({ action: 'unsub' });
    expect(socket.sent.map((f) => JSON.parse(f))).toEqual([{ error: 'bad' }]);
  });
});
