import { type StateValue, StateValueType } from './state.types.js';

/**
 * Type-guard: narrows `v` to the `String` variant of {@link StateValue}.
 */
export function isString(v: StateValue): v is StateValue & { type: StateValueType.String } {
  return v.type === StateValueType.String;
}

/**
 * Type-guard: narrows `v` to the `Number` variant of {@link StateValue}.
 */
export function isNumber(v: StateValue): v is StateValue & { type: StateValueType.Number } {
  return v.type === StateValueType.Number;
}

/**
 * Type-guard: narrows `v` to the `Bool` variant of {@link StateValue}.
 */
export function isBool(v: StateValue): v is StateValue & { type: StateValueType.Bool } {
  return v.type === StateValueType.Bool;
}
