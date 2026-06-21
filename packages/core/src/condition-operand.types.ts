import type { StateValue, StateValueType } from './state.types.js';

/**
 * The kind of a {@link ConditionOperand} — what the operand reads from when a
 * rule condition is evaluated.
 *
 * The string value is the persisted/serialized tag (stable across JSON
 * round-trips).
 */
export enum OperandKind {
  /** The latest tick price (mid-bar quote). */
  CurrentValue = 'current',
  /** The current bar's open. */
  OpenValue = 'open',
  /** The current bar's high so far. */
  HighValue = 'high',
  /** The current bar's low so far. */
  LowValue = 'low',
  /** The current bar's close (forming until the bar finalizes). */
  CloseValue = 'close',
  /** The current bar's accumulated volume. */
  VolumeValue = 'volume',
  /** The value of a state field on a profile-attached indicator instance. */
  IndicatorRef = 'indicatorRef',
  /** The value of a key in the current symbol's state map. */
  SymbolStateRef = 'symbolStateRef',
  /** The value of a key in the global state map. */
  GlobalStateRef = 'globalStateRef',
  /** A constant literal value (typed via its {@link StateValue.type}). */
  Literal = 'literal',
}

/**
 * Tagged union of every value a rule-condition leaf can reference.
 *
 * Each variant carries the {@link StateValueType} of the value it resolves to
 * (via an explicit `valueType` field, or — for {@link OperandKind.Literal} — via
 * the wrapped {@link StateValue}'s own `type`).
 * The operator picker uses {@link operandValueType} to filter the operators
 * legal against a given left/right pair.
 */
export type ConditionOperand =
  | { kind: OperandKind.CurrentValue; valueType: StateValueType.Number }
  | { kind: OperandKind.OpenValue; valueType: StateValueType.Number }
  | { kind: OperandKind.HighValue; valueType: StateValueType.Number }
  | { kind: OperandKind.LowValue; valueType: StateValueType.Number }
  | { kind: OperandKind.CloseValue; valueType: StateValueType.Number }
  | { kind: OperandKind.VolumeValue; valueType: StateValueType.Number }
  | {
      kind: OperandKind.IndicatorRef;
      /** The profile-attached indicator instance id. */
      instanceId: string;
      /** The state-field key on that instance to read. */
      stateKey: string;
      /** The value type the referenced state field resolves to. */
      valueType: StateValueType;
    }
  | {
      kind: OperandKind.SymbolStateRef;
      /** The key on the current symbol's state map to read. */
      key: string;
      /** The value type the referenced state key is expected to hold. */
      valueType: StateValueType;
    }
  | {
      kind: OperandKind.GlobalStateRef;
      /** The key in the global state map to read. */
      key: string;
      /** The value type the referenced state key is expected to hold. */
      valueType: StateValueType;
    }
  | { kind: OperandKind.Literal; value: StateValue };
