import { describe, expect, it } from 'vitest';

import { ActionError, validateAction } from './action.js';
import { ActionKind } from './action.types.js';
import { StateValueType } from './state.types.js';

describe('validateAction — SetSymbolState', () => {
  it('accepts a SetSymbolState action with a non-empty key', () => {
    expect(() =>
      validateAction({
        kind: ActionKind.SetSymbolState,
        key: 'armed',
        value: { type: StateValueType.Bool, value: true },
      }),
    ).not.toThrow();
  });

  it('rejects a SetSymbolState action with an empty key', () => {
    expect(() =>
      validateAction({
        kind: ActionKind.SetSymbolState,
        key: '   ',
        value: { type: StateValueType.Bool, value: true },
      }),
    ).toThrow(ActionError);
  });
});

describe('validateAction — RemoveSymbolState', () => {
  it('accepts a RemoveSymbolState action with a non-empty key', () => {
    expect(() =>
      validateAction({ kind: ActionKind.RemoveSymbolState, key: 'armed' }),
    ).not.toThrow();
  });

  it('rejects a RemoveSymbolState action with an empty key', () => {
    expect(() => validateAction({ kind: ActionKind.RemoveSymbolState, key: '' })).toThrow(
      ActionError,
    );
  });
});

describe('validateAction — SetGlobalState', () => {
  it('accepts a SetGlobalState action with a non-empty key', () => {
    expect(() =>
      validateAction({
        kind: ActionKind.SetGlobalState,
        key: 'regime',
        value: { type: StateValueType.Enum, value: 'risk-on' },
      }),
    ).not.toThrow();
  });

  it('rejects a SetGlobalState action with an empty key', () => {
    expect(() =>
      validateAction({
        kind: ActionKind.SetGlobalState,
        key: '',
        value: { type: StateValueType.Enum, value: 'risk-on' },
      }),
    ).toThrow(ActionError);
  });
});

describe('validateAction — RemoveGlobalState', () => {
  it('accepts a RemoveGlobalState action with a non-empty key', () => {
    expect(() =>
      validateAction({ kind: ActionKind.RemoveGlobalState, key: 'regime' }),
    ).not.toThrow();
  });

  it('rejects a RemoveGlobalState action with an empty key', () => {
    expect(() => validateAction({ kind: ActionKind.RemoveGlobalState, key: '' })).toThrow(
      ActionError,
    );
  });
});

describe('validateAction — NotifyTelegram', () => {
  it('accepts a NotifyTelegram action with non-empty destination and template', () => {
    expect(() =>
      validateAction({
        kind: ActionKind.NotifyTelegram,
        destinationName: 'main',
        template: 'Rule fired',
      }),
    ).not.toThrow();
  });

  it('rejects a NotifyTelegram action with an empty destination', () => {
    expect(() =>
      validateAction({
        kind: ActionKind.NotifyTelegram,
        destinationName: '',
        template: 'Rule fired',
      }),
    ).toThrow(ActionError);
  });

  it('rejects a NotifyTelegram action with an empty template', () => {
    expect(() =>
      validateAction({
        kind: ActionKind.NotifyTelegram,
        destinationName: 'main',
        template: '   ',
      }),
    ).toThrow(ActionError);
  });
});
