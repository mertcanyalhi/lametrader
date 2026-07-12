import { Period, StateValueType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';
import { stateOverlayToLineData, stateOverlayToMarkers } from './state-overlay.js';

describe('stateOverlayToLineData', () => {
  it('floors each entry to its containing 1h bar-open (in seconds) and maps StateRemoved to a whitespace gap', () => {
    // 11:10 and 11:40 both fall in the 11:00 bar; 12:20 in the 12:00 bar.
    const elevenTen = Date.UTC(2026, 6, 12, 11, 10);
    const elevenForty = Date.UTC(2026, 6, 12, 11, 40);
    const twelveTwenty = Date.UTC(2026, 6, 12, 12, 20);
    const elevenOpen = Date.UTC(2026, 6, 12, 11, 0) / 1000;
    const twelveOpen = Date.UTC(2026, 6, 12, 12, 0) / 1000;

    const data = stateOverlayToLineData(
      [
        { ts: elevenTen, value: { type: StateValueType.Number, value: 1 } },
        { ts: elevenForty, value: { type: StateValueType.Number, value: 2 } },
        { ts: twelveTwenty, value: null },
      ],
      Period.OneHour,
    );

    // Both 11:xx entries collapse onto the 11:00 bar, last (value 2) winning.
    expect(data).toEqual([{ time: elevenOpen, value: 2 }, { time: twelveOpen }]);
  });

  it('returns a whitespace gap for non-numeric entries to defend against value-type drift', () => {
    const data = stateOverlayToLineData(
      [{ ts: 90_000, value: { type: StateValueType.String, value: 'buy' } }],
      Period.OneMinute,
    );

    // 90_000 ms floors to the 60_000 ms (60 s) bar-open on a 1m chart.
    expect(data).toEqual([{ time: 60 }]);
  });
});

describe('stateOverlayToMarkers', () => {
  it('floors each StateSet entry to its bar-open and renders a belowBar arrowUp with the value stringified', () => {
    const elevenForty = Date.UTC(2026, 6, 12, 11, 40);
    const twelveTwenty = Date.UTC(2026, 6, 12, 12, 20);
    const elevenOpen = Date.UTC(2026, 6, 12, 11, 0) / 1000;
    const twelveOpen = Date.UTC(2026, 6, 12, 12, 0) / 1000;

    const markers = stateOverlayToMarkers(
      [
        { ts: elevenForty, value: { type: StateValueType.String, value: 'buy' } },
        { ts: twelveTwenty, value: { type: StateValueType.Bool, value: true } },
      ],
      '#abc',
      Period.OneHour,
    );

    expect(markers).toEqual([
      { time: elevenOpen, position: 'belowBar', color: '#abc', shape: 'arrowUp', text: 'buy' },
      { time: twelveOpen, position: 'belowBar', color: '#abc', shape: 'arrowUp', text: 'true' },
    ]);
  });

  it('maps a StateRemoved entry to an inBar circle marker labeled with `×` at its bar-open', () => {
    const markers = stateOverlayToMarkers([{ ts: 90_000, value: null }], '#xyz', Period.OneMinute);

    expect(markers).toEqual([
      { time: 60, position: 'inBar', color: '#xyz', shape: 'circle', text: '×' },
    ]);
  });
});
