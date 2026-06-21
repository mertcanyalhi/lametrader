import { describe, expect, it } from 'vitest';
import { StreamHub } from './stream-hub.js';

describe('StreamHub', () => {
  it('fans a payload to every subscriber of its key', () => {
    const hub = new StreamHub<string>();
    const received: string[] = [];
    hub.subscribe('k1', (p) => received.push(p));
    hub.subscribe('k1', (p) => received.push(`${p}!`));

    hub.publish('k1', 'hello');

    expect(received).toEqual(['hello', 'hello!']);
  });

  it('only delivers payloads for the subscribed key', () => {
    const hub = new StreamHub<string>();
    const received: string[] = [];
    hub.subscribe('k1', (p) => received.push(p));

    hub.publish('k2', 'hello');

    expect(received).toEqual([]);
  });

  it('stops delivering after unsubscribe', () => {
    const hub = new StreamHub<string>();
    const received: string[] = [];
    const unsubscribe = hub.subscribe('k1', (p) => received.push(p));

    unsubscribe();
    hub.publish('k1', 'hello');

    expect(received).toEqual([]);
  });

  it('publishing with no subscribers is a no-op', () => {
    const hub = new StreamHub<string>();
    expect(() => hub.publish('k1', 'hello')).not.toThrow();
  });

  it('isolates a throwing subscriber so the others still receive the payload', () => {
    const hub = new StreamHub<string>();
    const received: string[] = [];
    hub.subscribe('k1', () => {
      throw new Error('dead socket');
    });
    hub.subscribe('k1', (p) => received.push(p));

    hub.publish('k1', 'hello');

    expect(received).toEqual(['hello']);
  });

  it('reports a throwing subscriber to onError with the error and key', () => {
    const error = new Error('dead socket');
    const reported: Array<{ error: unknown; key: string }> = [];
    const hub = new StreamHub<string>((e, key) => reported.push({ error: e, key }));
    hub.subscribe('k1', () => {
      throw error;
    });

    hub.publish('k1', 'hello');

    expect(reported).toEqual([{ error, key: 'k1' }]);
  });
});
