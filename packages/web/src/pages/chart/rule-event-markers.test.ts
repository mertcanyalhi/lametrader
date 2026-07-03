import {
  EvaluationTriggerKind,
  type RuleEventEntry,
  RuleEventType,
  StateScope,
  StateValueType,
} from '@lametrader/core';
import { describe, expect, it } from 'vitest';
import { buildEventMarkers, EVENT_MARKER_STYLE } from './rule-event-markers.js';

/** A `Fired` umbrella entry at `ts`. */
function firedAt(ts: number): RuleEventEntry {
  return {
    type: RuleEventType.Fired,
    ts,
    firedAt: ts + 1,
    ruleId: 'rule-1',
    symbolId: 'AAPL',
    context: {
      inboundEvent: {
        kind: EvaluationTriggerKind.Tick,
        ts,
        symbolId: 'AAPL',
        price: 100,
      },
      lookupSnapshot: {
        current: 100,
        open: null,
        high: null,
        low: null,
        close: null,
        volume: null,
      },
    },
  };
}

/** A `StateSet` entry at `ts`. */
function stateSetAt(ts: number): RuleEventEntry {
  return {
    type: RuleEventType.StateSet,
    ts,
    firedAt: ts + 1,
    ruleId: 'rule-1',
    symbolId: 'AAPL',
    scope: StateScope.Symbol,
    key: 'fired',
    value: { type: StateValueType.Bool, value: true },
  };
}

/** An `Error` entry at `ts`. */
function errorAt(ts: number): RuleEventEntry {
  return {
    type: RuleEventType.Error,
    ts,
    firedAt: ts + 1,
    ruleId: 'rule-1',
    symbolId: 'AAPL',
    reason: 'transport failure',
  };
}

describe('buildEventMarkers', () => {
  it('returns an empty array when no entries are passed', () => {
    expect(buildEventMarkers([])).toEqual([]);
  });

  it('maps every entry to one marker with the settled style and second-resolution time — no type gate', () => {
    const fired = firedAt(1_000_000);
    const stateSet = stateSetAt(1_001_000);
    const error = errorAt(1_002_000);

    expect(buildEventMarkers([fired, stateSet, error])).toEqual([
      {
        time: 1_000,
        position: EVENT_MARKER_STYLE[RuleEventType.Fired].position,
        shape: EVENT_MARKER_STYLE[RuleEventType.Fired].shape,
        color: EVENT_MARKER_STYLE[RuleEventType.Fired].color,
        text: EVENT_MARKER_STYLE[RuleEventType.Fired].label,
      },
      {
        time: 1_001,
        position: EVENT_MARKER_STYLE[RuleEventType.StateSet].position,
        shape: EVENT_MARKER_STYLE[RuleEventType.StateSet].shape,
        color: EVENT_MARKER_STYLE[RuleEventType.StateSet].color,
        text: EVENT_MARKER_STYLE[RuleEventType.StateSet].label,
      },
      {
        time: 1_002,
        position: EVENT_MARKER_STYLE[RuleEventType.Error].position,
        shape: EVENT_MARKER_STYLE[RuleEventType.Error].shape,
        color: EVENT_MARKER_STYLE[RuleEventType.Error].color,
        text: EVENT_MARKER_STYLE[RuleEventType.Error].label,
      },
    ]);
  });

  it('returns markers sorted ascending by time even when entries arrive out of order', () => {
    expect(
      buildEventMarkers([firedAt(3_000_000), stateSetAt(1_000_000), errorAt(2_000_000)]),
    ).toEqual([
      {
        time: 1_000,
        position: EVENT_MARKER_STYLE[RuleEventType.StateSet].position,
        shape: EVENT_MARKER_STYLE[RuleEventType.StateSet].shape,
        color: EVENT_MARKER_STYLE[RuleEventType.StateSet].color,
        text: EVENT_MARKER_STYLE[RuleEventType.StateSet].label,
      },
      {
        time: 2_000,
        position: EVENT_MARKER_STYLE[RuleEventType.Error].position,
        shape: EVENT_MARKER_STYLE[RuleEventType.Error].shape,
        color: EVENT_MARKER_STYLE[RuleEventType.Error].color,
        text: EVENT_MARKER_STYLE[RuleEventType.Error].label,
      },
      {
        time: 3_000,
        position: EVENT_MARKER_STYLE[RuleEventType.Fired].position,
        shape: EVENT_MARKER_STYLE[RuleEventType.Fired].shape,
        color: EVENT_MARKER_STYLE[RuleEventType.Fired].color,
        text: EVENT_MARKER_STYLE[RuleEventType.Fired].label,
      },
    ]);
  });
});
