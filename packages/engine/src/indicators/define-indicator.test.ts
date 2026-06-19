import { FieldType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';
import { defineIndicator } from './define-indicator.js';

/**
 * `defineIndicator` is a pure factory: every field the spec carries — including
 * the optional `warmup` function — must surface on the returned module verbatim,
 * since the engine's compute service relies on `warmup(inputs)` to scope the
 * candle-repository load.
 */
describe('defineIndicator', () => {
  it("forwards the spec's `warmup` function onto the returned module verbatim", () => {
    const warmup = ({ length }: { length: number }): number => length;
    const module = defineIndicator({
      key: 'sample',
      name: 'Sample',
      description: '',
      version: 1,
      inputs: [
        {
          type: FieldType.Number,
          key: 'length',
          label: 'Length',
          default: 14,
        },
      ] as const,
      state: [
        {
          type: FieldType.Number,
          key: 'value',
          label: 'Value',
        },
      ] as const,
      summary: ({ length }) => `Sample ${length}`,
      compute: (_inputs, candles) => candles.map((c) => ({ time: c.time, value: null })),
      warmup,
    });

    expect({ hasWarmup: module.warmup === warmup }).toEqual({ hasWarmup: true });
  });
});
