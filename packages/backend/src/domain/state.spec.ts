import { type StateValue, StateValueType } from '@lametrader/core';
import { isBool, isNumber, isString } from './state.js';

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
