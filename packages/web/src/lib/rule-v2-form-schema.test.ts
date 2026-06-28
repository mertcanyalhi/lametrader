import { Period, RulesV2, StateValueType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';
import {
  ExpirationKindV2,
  expirationV2FromForm,
  isBarBasedTriggerV2,
  isConditionTreeV2NonEmpty,
  isStateActionV2,
  scopeV2FromForm,
  scopeV2ToForm,
  triggerV2FromForm,
  triggerV2ToForm,
} from './rule-v2-form-schema.js';

describe('rule-v2-form-schema converters', () => {
  describe('triggerV2FromForm', () => {
    it('maps an EveryTime form value to an EveryTime domain trigger (no period or interval)', () => {
      expect(
        triggerV2FromForm({
          triggerKind: RulesV2.TriggerKind.EveryTime,
          triggerPeriod: '',
          triggerIntervalMs: 60_000,
        }),
      ).toEqual({ kind: RulesV2.TriggerKind.EveryTime });
    });

    it('maps an OncePerBarOpen form value to an OncePerBarOpen domain trigger carrying the selected period', () => {
      expect(
        triggerV2FromForm({
          triggerKind: RulesV2.TriggerKind.OncePerBarOpen,
          triggerPeriod: Period.OneMinute,
          triggerIntervalMs: 60_000,
        }),
      ).toEqual({ kind: RulesV2.TriggerKind.OncePerBarOpen, period: Period.OneMinute });
    });

    it('maps an OncePerInterval form value to an OncePerInterval domain trigger carrying the selected intervalMs', () => {
      expect(
        triggerV2FromForm({
          triggerKind: RulesV2.TriggerKind.OncePerInterval,
          triggerPeriod: '',
          triggerIntervalMs: 30_000,
        }),
      ).toEqual({ kind: RulesV2.TriggerKind.OncePerInterval, intervalMs: 30_000 });
    });
  });

  describe('triggerV2ToForm', () => {
    it('projects a OncePerBar domain trigger into the flat form shape preserving the period and defaulting the intervalMs to 60_000', () => {
      expect(
        triggerV2ToForm({ kind: RulesV2.TriggerKind.OncePerBar, period: Period.FiveMinutes }),
      ).toEqual({
        triggerKind: RulesV2.TriggerKind.OncePerBar,
        triggerPeriod: Period.FiveMinutes,
        triggerIntervalMs: 60_000,
      });
    });
  });

  describe('scopeV2FromForm', () => {
    it('builds a Symbols scope from the multi-select symbolIds when scopeKind is Symbols', () => {
      expect(
        scopeV2FromForm({
          scopeKind: RulesV2.RuleScopeKind.Symbols,
          symbolId: '',
          symbolIds: ['BTC', 'ETH'],
        }),
      ).toEqual({ kind: RulesV2.RuleScopeKind.Symbols, symbolIds: ['BTC', 'ETH'] });
    });

    it('builds an AllSymbols scope (no symbol fields) when scopeKind is AllSymbols', () => {
      expect(
        scopeV2FromForm({
          scopeKind: RulesV2.RuleScopeKind.AllSymbols,
          symbolId: '',
          symbolIds: [],
        }),
      ).toEqual({ kind: RulesV2.RuleScopeKind.AllSymbols });
    });
  });

  describe('scopeV2ToForm', () => {
    it('projects a Symbol domain scope into the flat form shape, clearing symbolIds', () => {
      expect(scopeV2ToForm({ kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'BTC' })).toEqual({
        scopeKind: RulesV2.RuleScopeKind.Symbol,
        symbolId: 'BTC',
        symbolIds: [],
      });
    });
  });

  describe('expirationV2FromForm', () => {
    it('returns null for the Never expiration kind', () => {
      expect(
        expirationV2FromForm({
          expirationKind: ExpirationKindV2.Never,
          expirationAt: '',
        }),
      ).toEqual(null);
    });

    it('parses the datetime-local string into an epoch-ms { at } object for the OnDate expiration kind', () => {
      expect(
        expirationV2FromForm({
          expirationKind: ExpirationKindV2.OnDate,
          // Fixed UTC date so the test does not depend on TZ.
          expirationAt: '2030-01-15T00:00:00Z',
        }),
      ).toEqual({ at: Date.parse('2030-01-15T00:00:00Z') });
    });
  });

  describe('isBarBasedTriggerV2', () => {
    it('returns true for OncePerBar, OncePerBarOpen, and OncePerBarClose and false for the other three kinds (EveryTime / Once / OncePerInterval)', () => {
      expect({
        everyTime: isBarBasedTriggerV2(RulesV2.TriggerKind.EveryTime),
        once: isBarBasedTriggerV2(RulesV2.TriggerKind.Once),
        oncePerBar: isBarBasedTriggerV2(RulesV2.TriggerKind.OncePerBar),
        oncePerBarOpen: isBarBasedTriggerV2(RulesV2.TriggerKind.OncePerBarOpen),
        oncePerBarClose: isBarBasedTriggerV2(RulesV2.TriggerKind.OncePerBarClose),
        oncePerInterval: isBarBasedTriggerV2(RulesV2.TriggerKind.OncePerInterval),
      }).toEqual({
        everyTime: false,
        once: false,
        oncePerBar: true,
        oncePerBarOpen: true,
        oncePerBarClose: true,
        oncePerInterval: false,
      });
    });
  });

  describe('isStateActionV2', () => {
    it('returns false for a Notification action (the only non-state v2 action kind)', () => {
      expect(
        isStateActionV2({
          kind: RulesV2.ActionKind.Notification,
          channel: RulesV2.NotificationChannel.Telegram,
          destinationName: 'main',
          template: 'hi',
        }),
      ).toBe(false);
    });

    it('returns true for a SetSymbolState action (a state-mutation kind)', () => {
      expect(
        isStateActionV2({
          kind: RulesV2.ActionKind.SetSymbolState,
          key: 'phase',
          value: { type: StateValueType.String, value: 'on' },
        }),
      ).toBe(true);
    });
  });

  describe('isConditionTreeV2NonEmpty', () => {
    it('returns true for a single leaf node', () => {
      expect(
        isConditionTreeV2NonEmpty({
          kind: RulesV2.ConditionNodeKind.Leaf,
          leaf: {
            family: RulesV2.LeafConditionFamily.Comparison,
            operator: RulesV2.ComparisonOperator.Gt,
            left: { kind: RulesV2.OperandKind.Price },
            right: {
              kind: RulesV2.OperandKind.Literal,
              value: { type: StateValueType.Number, value: 0 },
            },
          },
        }),
      ).toBe(true);
    });

    it('returns false for an empty And group at the root (the editor surfaces this as an inline error before submit)', () => {
      expect(
        isConditionTreeV2NonEmpty({
          kind: RulesV2.ConditionNodeKind.And,
          children: [],
        }),
      ).toBe(false);
    });

    it('returns false when any nested Or group is empty, even if the root has children', () => {
      expect(
        isConditionTreeV2NonEmpty({
          kind: RulesV2.ConditionNodeKind.And,
          children: [{ kind: RulesV2.ConditionNodeKind.Or, children: [] }],
        }),
      ).toBe(false);
    });
  });
});
