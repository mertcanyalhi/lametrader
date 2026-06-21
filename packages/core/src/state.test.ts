import { describe, expect, it } from 'vitest';

import { isBool, isEnum, isNumber, isString } from './state.js';
import { type StateValue, StateValueType } from './state.types.js';

describe('StateValue', () => {
  it('round-trips through JSON unchanged for each variant', () => {
    const values: StateValue[] = [
      { type: StateValueType.String, value: 'hello' },
      { type: StateValueType.Number, value: 42 },
      { type: StateValueType.Bool, value: true },
      { type: StateValueType.Enum, value: 'buy' },
    ];

    expect(values.map((v) => JSON.parse(JSON.stringify(v)))).toEqual(values);
  });
});

describe('state value guards', () => {
  const string: StateValue = { type: StateValueType.String, value: 'hello' };
  const number: StateValue = { type: StateValueType.Number, value: 42 };
  const bool: StateValue = { type: StateValueType.Bool, value: true };
  const enumeration: StateValue = { type: StateValueType.Enum, value: 'buy' };

  it('isString returns true only for the String variant', () => {
    expect([isString(string), isString(number), isString(bool), isString(enumeration)]).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });

  it('isNumber returns true only for the Number variant', () => {
    expect([isNumber(string), isNumber(number), isNumber(bool), isNumber(enumeration)]).toEqual([
      false,
      true,
      false,
      false,
    ]);
  });

  it('isBool returns true only for the Bool variant', () => {
    expect([isBool(string), isBool(number), isBool(bool), isBool(enumeration)]).toEqual([
      false,
      false,
      true,
      false,
    ]);
  });

  it('isEnum returns true only for the Enum variant', () => {
    expect([isEnum(string), isEnum(number), isEnum(bool), isEnum(enumeration)]).toEqual([
      false,
      false,
      false,
      true,
    ]);
  });
});
