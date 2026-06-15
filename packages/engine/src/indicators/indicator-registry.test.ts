import { FieldType, SymbolType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';
import { defineIndicator } from './define-indicator.js';
import { IndicatorRegistry } from './indicator-registry.js';

/** A throwaway indicator module used to probe the registry plumbing. */
const noop = defineIndicator({
  key: 'noop',
  name: 'Noop',
  description: 'Returns nulls for every candle.',
  version: 1,
  inputs: [
    {
      type: FieldType.Number,
      key: 'length',
      label: 'Length',
      integer: true,
      min: 1,
      default: 1,
    },
  ] as const,
  state: [{ type: FieldType.Number, key: 'value', label: 'Value' }] as const,
  compute: (_inputs, candles) => candles.map((c) => ({ time: c.time, value: null })),
});

describe('defineIndicator', () => {
  it('returns a module carrying the supplied definition and compute (defaults appliesTo)', () => {
    expect(noop.definition).toEqual({
      key: 'noop',
      name: 'Noop',
      description: 'Returns nulls for every candle.',
      version: 1,
      appliesTo: [SymbolType.Crypto, SymbolType.Stock, SymbolType.Fund, SymbolType.Fx],
      inputs: [
        {
          type: FieldType.Number,
          key: 'length',
          label: 'Length',
          integer: true,
          min: 1,
          default: 1,
        },
      ],
      state: [{ type: FieldType.Number, key: 'value', label: 'Value' }],
    });
    expect(typeof noop.compute).toEqual('function');
  });

  it('preserves an explicitly supplied appliesTo', () => {
    const cryptoOnly = defineIndicator({
      key: 'crypto-only',
      name: 'Crypto Only',
      description: '',
      version: 1,
      appliesTo: [SymbolType.Crypto],
      inputs: [] as const,
      state: [{ type: FieldType.Number, key: 'value', label: 'Value' }] as const,
      compute: (_inputs, candles) => candles.map((c) => ({ time: c.time, value: null })),
    });
    expect(cryptoOnly.definition.appliesTo).toEqual([SymbolType.Crypto]);
  });
});

describe('IndicatorRegistry', () => {
  it('round-trips registered modules and returns null for an unknown key', () => {
    const registry = new IndicatorRegistry();
    registry.register(noop);
    expect(registry.get('noop')).toEqual(noop);
    expect(registry.list()).toEqual([noop.definition]);
    expect(registry.get('unknown')).toBeNull();
  });
});
