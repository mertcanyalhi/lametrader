// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  type ChartViewport,
  captureViewport,
  getStoredViewport,
  liveLogicalRange,
  setStoredViewport,
} from './chart-viewport.js';

describe('chart viewport persistence', () => {
  afterEach(() => window.localStorage.clear());

  it('round-trips a fixed viewport through localStorage', () => {
    const viewport: ChartViewport = {
      mode: 'fixed',
      from: 1_700_000_000_000,
      to: 1_700_600_000_000,
    };
    setStoredViewport(viewport);

    expect(getStoredViewport()).toEqual({
      mode: 'fixed',
      from: 1_700_000_000_000,
      to: 1_700_600_000_000,
    });
  });

  it('round-trips a live viewport through localStorage', () => {
    setStoredViewport({ mode: 'live', bars: 120 });

    expect(getStoredViewport()).toEqual({ mode: 'live', bars: 120 });
  });

  it('returns null when no viewport has been stored', () => {
    expect(getStoredViewport()).toEqual(null);
  });

  it('returns null for a malformed fixed viewport (non-ascending bounds)', () => {
    window.localStorage.setItem(
      'chart-viewport',
      JSON.stringify({ mode: 'fixed', from: 5, to: 1 }),
    );

    expect(getStoredViewport()).toEqual(null);
  });

  it('returns null for a live viewport with a non-positive bar count', () => {
    window.localStorage.setItem('chart-viewport', JSON.stringify({ mode: 'live', bars: 0 }));

    expect(getStoredViewport()).toEqual(null);
  });
});

describe('captureViewport', () => {
  it('captures a live viewport (bar count) when the window reaches the latest bar', () => {
    expect(
      captureViewport({ visibleFrom: 1000, visibleTo: 6000, lastBarTime: 5000, visibleBars: 80.4 }),
    ).toEqual({ mode: 'live', bars: 80 });
  });

  it('captures a fixed viewport when the window is scrolled back from the latest bar', () => {
    expect(
      captureViewport({ visibleFrom: 1000, visibleTo: 4000, lastBarTime: 5000, visibleBars: 30 }),
    ).toEqual({ mode: 'fixed', from: 1000, to: 4000 });
  });

  it('captures fixed when there is no latest bar to compare against', () => {
    expect(
      captureViewport({ visibleFrom: 1000, visibleTo: 6000, lastBarTime: null, visibleBars: 80 }),
    ).toEqual({ mode: 'fixed', from: 1000, to: 6000 });
  });
});

describe('liveLogicalRange', () => {
  it('spans the last `bars` of the series with the right edge on the newest bar', () => {
    expect(liveLogicalRange(500, 120)).toEqual({ from: 380, to: 499 });
  });

  it('never starts before the first bar when the series is shorter than the window', () => {
    expect(liveLogicalRange(50, 120)).toEqual({ from: 0, to: 49 });
  });
});
