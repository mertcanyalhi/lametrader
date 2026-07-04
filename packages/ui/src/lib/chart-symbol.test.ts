// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { getStoredSymbolId, setStoredSymbolId } from './chart-symbol.js';

describe('chart symbol persistence', () => {
  afterEach(() => window.localStorage.clear());

  it('round-trips a stored symbol id through localStorage', () => {
    setStoredSymbolId('crypto:BTCUSDT');

    expect(getStoredSymbolId()).toEqual('crypto:BTCUSDT');
  });

  it('returns null when no symbol id has been stored', () => {
    expect(getStoredSymbolId()).toEqual(null);
  });

  it('returns null for a stored empty string', () => {
    window.localStorage.setItem('chart-symbol', '');

    expect(getStoredSymbolId()).toEqual(null);
  });
});
