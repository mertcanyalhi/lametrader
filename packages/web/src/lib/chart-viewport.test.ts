// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { type ChartViewport, getStoredViewport, setStoredViewport } from './chart-viewport.js';

describe('chart viewport persistence', () => {
  afterEach(() => window.localStorage.clear());

  it('round-trips a stored viewport through localStorage', () => {
    const viewport: ChartViewport = { from: 1_700_000_000_000, to: 1_700_600_000_000 };
    setStoredViewport(viewport);

    expect(getStoredViewport()).toEqual({ from: 1_700_000_000_000, to: 1_700_600_000_000 });
  });

  it('returns null when no viewport has been stored', () => {
    expect(getStoredViewport()).toEqual(null);
  });

  it('returns null for a malformed stored value (non-numeric or non-ascending bounds)', () => {
    window.localStorage.setItem('chart-viewport', JSON.stringify({ from: 5, to: 1 }));

    expect(getStoredViewport()).toEqual(null);
  });
});
