import { describe, expect, it } from 'vitest';

import { StateValueType } from '../state.types.js';
import { type Action, ActionKind, NotificationChannel } from './action.types.js';

describe('RulesV2 Action', () => {
  it('admits a Notification action with a telegram channel discriminator and { destinationName, template }', () => {
    const a: Action = {
      kind: ActionKind.Notification,
      channel: NotificationChannel.Telegram,
      destinationName: 'main',
      template: 'Price crossed {{price}}',
    };
    expect(a).toEqual({
      kind: ActionKind.Notification,
      channel: NotificationChannel.Telegram,
      destinationName: 'main',
      template: 'Price crossed {{price}}',
    });
  });

  it('admits SetSymbolState / RemoveSymbolState / SetGlobalState / RemoveGlobalState mutations', () => {
    const actions: Action[] = [
      {
        kind: ActionKind.SetSymbolState,
        key: 'trend',
        value: { type: StateValueType.String, value: 'up' },
      },
      { kind: ActionKind.RemoveSymbolState, key: 'trend' },
      {
        kind: ActionKind.SetGlobalState,
        key: 'mode',
        value: { type: StateValueType.String, value: 'live' },
      },
      { kind: ActionKind.RemoveGlobalState, key: 'mode' },
    ];
    expect(actions).toEqual([
      {
        kind: ActionKind.SetSymbolState,
        key: 'trend',
        value: { type: StateValueType.String, value: 'up' },
      },
      { kind: ActionKind.RemoveSymbolState, key: 'trend' },
      {
        kind: ActionKind.SetGlobalState,
        key: 'mode',
        value: { type: StateValueType.String, value: 'live' },
      },
      { kind: ActionKind.RemoveGlobalState, key: 'mode' },
    ]);
  });
});
