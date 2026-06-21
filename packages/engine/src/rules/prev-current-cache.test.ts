import { Period } from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { PrevCurrentCache } from './prev-current-cache.js';

describe('PrevCurrentCache', () => {
  it('returns prev=null on the first write to a slot', () => {
    const cache = new PrevCurrentCache<number>();
    expect(cache.record('AAPL', Period.OneMinute, 'close', 100)).toEqual({
      prev: null,
      current: 100,
    });
  });

  it('returns the previously written value on subsequent writes', () => {
    const cache = new PrevCurrentCache<number>();
    cache.record('AAPL', Period.OneMinute, 'close', 100);
    expect(cache.record('AAPL', Period.OneMinute, 'close', 101)).toEqual({
      prev: 100,
      current: 101,
    });
  });

  it('isolates slots by symbol', () => {
    const cache = new PrevCurrentCache<number>();
    cache.record('AAPL', Period.OneMinute, 'close', 100);
    expect(cache.record('MSFT', Period.OneMinute, 'close', 200)).toEqual({
      prev: null,
      current: 200,
    });
  });

  it('isolates slots by period', () => {
    const cache = new PrevCurrentCache<number>();
    cache.record('AAPL', Period.OneMinute, 'close', 100);
    expect(cache.record('AAPL', Period.FiveMinutes, 'close', 200)).toEqual({
      prev: null,
      current: 200,
    });
  });

  it('isolates slots by key', () => {
    const cache = new PrevCurrentCache<number>();
    cache.record('AAPL', Period.OneMinute, 'close', 100);
    expect(cache.record('AAPL', Period.OneMinute, 'open', 200)).toEqual({
      prev: null,
      current: 200,
    });
  });
});
