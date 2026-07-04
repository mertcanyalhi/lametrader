// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { getStoredStateOverlays, setStoredStateOverlays } from './chart-state-overlays.js';

describe('chart-state-overlays', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('getStoredStateOverlays returns [] when nothing is stored for the (profileId, symbolId) pair', () => {
    expect(getStoredStateOverlays('p-1', 'crypto:BTCUSDT')).toEqual([]);
  });

  it('setStoredStateOverlays then getStoredStateOverlays round-trips the key order', () => {
    setStoredStateOverlays('p-1', 'crypto:BTCUSDT', ['last_signal', 'cooldown']);

    expect(getStoredStateOverlays('p-1', 'crypto:BTCUSDT')).toEqual(['last_signal', 'cooldown']);
  });

  it('isolates storage between different (profileId, symbolId) pairs', () => {
    setStoredStateOverlays('p-1', 'crypto:BTCUSDT', ['a']);
    setStoredStateOverlays('p-2', 'crypto:BTCUSDT', ['b']);

    expect(getStoredStateOverlays('p-1', 'crypto:BTCUSDT')).toEqual(['a']);
    expect(getStoredStateOverlays('p-2', 'crypto:BTCUSDT')).toEqual(['b']);
  });

  it('getStoredStateOverlays returns [] when stored value is not a JSON array', () => {
    window.localStorage.setItem('chart-state-overlays::p-1::crypto:BTCUSDT', '{"oops":true}');

    expect(getStoredStateOverlays('p-1', 'crypto:BTCUSDT')).toEqual([]);
  });
});
