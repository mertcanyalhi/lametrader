import { StateValueType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';
import { stateOverlayToLineData, stateOverlayToMarkers } from './state-overlay.js';

describe('stateOverlayToLineData', () => {
  it('maps each StateSet entry (numeric) to a {time, value} sample and StateRemoved to a whitespace gap', () => {
    const data = stateOverlayToLineData([
      { ts: 1_000, value: { type: StateValueType.Number, value: 1 } },
      { ts: 2_000, value: { type: StateValueType.Number, value: 2 } },
      { ts: 3_000, value: null },
    ]);

    expect(data).toEqual([{ time: 1, value: 1 }, { time: 2, value: 2 }, { time: 3 }]);
  });

  it('returns a whitespace gap for non-numeric entries to defend against value-type drift', () => {
    const data = stateOverlayToLineData([
      { ts: 1_000, value: { type: StateValueType.String, value: 'buy' } },
    ]);

    expect(data).toEqual([{ time: 1 }]);
  });
});

describe('stateOverlayToMarkers', () => {
  it('maps each StateSet entry to a belowBar arrowUp marker with the value stringified', () => {
    const markers = stateOverlayToMarkers(
      [
        { ts: 1_000, value: { type: StateValueType.String, value: 'buy' } },
        { ts: 2_000, value: { type: StateValueType.Bool, value: true } },
        { ts: 3_000, value: { type: StateValueType.Enum, value: 'risk-on' } },
      ],
      '#abc',
    );

    expect(markers).toEqual([
      { time: 1, position: 'belowBar', color: '#abc', shape: 'arrowUp', text: 'buy' },
      { time: 2, position: 'belowBar', color: '#abc', shape: 'arrowUp', text: 'true' },
      { time: 3, position: 'belowBar', color: '#abc', shape: 'arrowUp', text: 'risk-on' },
    ]);
  });

  it('maps a StateRemoved entry to an inBar circle marker labeled with `×`', () => {
    const markers = stateOverlayToMarkers([{ ts: 5_000, value: null }], '#xyz');

    expect(markers).toEqual([
      { time: 5, position: 'inBar', color: '#xyz', shape: 'circle', text: '×' },
    ]);
  });
});
