import { type RuleEventEntry, RuleEventType, StateScope, StateValueType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';
import { Theme } from '../../lib/theme.types.js';
import { paletteColor } from '../chart/indicators/overlay-palette.js';
import { stateOverlaysFromEvents } from './run-state-overlays.js';

/** A symbol-scoped `StateSet` event for `key` set to a bool `value` at `ts`. */
function stateSet(key: string, value: boolean, ts: number): RuleEventEntry {
  return {
    type: RuleEventType.StateSet,
    ts,
    ruleId: 'r-1',
    symbolId: 'crypto:BTCUSDT',
    scope: StateScope.Symbol,
    key,
    value: { type: StateValueType.Bool, value },
  };
}

/** A symbol-scoped `StateRemoved` event for `key` at `ts`. */
function stateRemoved(key: string, ts: number): RuleEventEntry {
  return {
    type: RuleEventType.StateRemoved,
    ts,
    ruleId: 'r-1',
    symbolId: 'crypto:BTCUSDT',
    scope: StateScope.Symbol,
    key,
  };
}

/** A global-scope `StateSet` event — must be ignored by the symbol-scoped overlays. */
function globalStateSet(key: string, ts: number): RuleEventEntry {
  return {
    type: RuleEventType.StateSet,
    ts,
    ruleId: 'r-1',
    symbolId: 'crypto:BTCUSDT',
    scope: StateScope.Global,
    key,
    value: { type: StateValueType.Bool, value: true },
  };
}

describe('stateOverlaysFromEvents', () => {
  it('groups a symbol-scoped set-then-remove series into one overlay', () => {
    const overlays = stateOverlaysFromEvents(
      [stateSet('go_long', true, 1_000), stateRemoved('go_long', 2_000)],
      Theme.Dark,
    );

    expect(overlays).toEqual([
      {
        key: 'go_long',
        valueType: StateValueType.Bool,
        entries: [
          { ts: 1_000, value: { type: StateValueType.Bool, value: true } },
          { ts: 2_000, value: null },
        ],
        color: paletteColor(0, Theme.Dark),
        visible: true,
      },
    ]);
  });

  it('ignores non-state and global-scope events when building overlays', () => {
    const overlays = stateOverlaysFromEvents(
      [
        globalStateSet('regime', 500),
        {
          type: RuleEventType.NotificationSent,
          ts: 600,
          ruleId: 'r-1',
          symbolId: 'crypto:BTCUSDT',
          destinationName: 'tg',
          body: 'hi',
        },
        stateSet('go_long', true, 1_000),
      ],
      Theme.Dark,
    );

    expect(overlays).toEqual([
      {
        key: 'go_long',
        valueType: StateValueType.Bool,
        entries: [{ ts: 1_000, value: { type: StateValueType.Bool, value: true } }],
        color: paletteColor(0, Theme.Dark),
        visible: true,
      },
    ]);
  });
});
