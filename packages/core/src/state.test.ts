import { describe, expect, it } from 'vitest';

import { isBool, isNumber, isString } from './state.js';
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

describe('state value guards', () => {
  const string: StateValue = { type: StateValueType.String, value: 'hello' };
  const number: StateValue = { type: StateValueType.Number, value: 42 };
  const bool: StateValue = { type: StateValueType.Bool, value: true };

  it('isString returns true only for the String variant', () => {
    expect([isString(string), isString(number), isString(bool)]).toEqual([true, false, false]);
  });

  it('isNumber returns true only for the Number variant', () => {
    expect([isNumber(string), isNumber(number), isNumber(bool)]).toEqual([false, true, false]);
  });

  it('isBool returns true only for the Bool variant', () => {
    expect([isBool(string), isBool(number), isBool(bool)]).toEqual([false, false, true]);
  });
});
