import { describe, expect, it } from 'vitest';

import { type StateValue, StateValueType } from './state.types.js';

describe('StateValue', () => {
  it('round-trips through JSON unchanged for each variant', () => {
    const values: StateValue[] = [
      { type: StateValueType.String, value: 'hello' },
      { type: StateValueType.Number, value: 42 },
      { type: StateValueType.Bool, value: true },
    ];

    expect(values.map((v) => JSON.parse(JSON.stringify(v)))).toEqual(values);
  });
});
