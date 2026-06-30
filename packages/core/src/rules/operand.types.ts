import type { StateValue, StateValueType } from '../state.types.js';

/**
 * The kind of a {@link ConditionOperand} — what the operand reads from when
 * a rule's condition is evaluated.
 *
 * The string value is the persisted/serialized tag (stable across JSON
 * round-trips).
 *
 * Ten kinds total; `Price` is the live tick price for the firing symbol.
 */
export enum OperandKind {
  /** The live tick price for the firing symbol. */
  Price = 'price',
  /** The current bar's open value (requires the row's `interval`). */
  Open = 'open',
  /** The current bar's high so far (requires the row's `interval`). */
  High = 'high',
  /** The current bar's low so far (requires the row's `interval`). */
  Low = 'low',
  /** The current bar's close so far (requires the row's `interval`). */
  Close = 'close',
  /** The current bar's accumulated volume (requires the row's `interval`). */
  Volume = 'volume',
  /**
   * The value of a state field on a profile-attached indicator instance
   * (requires the row's `interval`).
   */
  IndicatorRef = 'indicatorRef',
  /** The value of a key in the firing symbol's state map. */
  SymbolStateRef = 'symbolStateRef',
  /** The value of a key in the global state map. */
  GlobalStateRef = 'globalStateRef',
  /** A constant literal value (right-hand side only). */
  Literal = 'literal',
}

/**
 * Tagged union of every value a rule-condition leaf can reference.
 *
 * `Open` / `High` / `Low` / `Close` / `Volume` / `IndicatorRef` operands
 * resolve against a specific bar period — the row's `interval` carries the
 * disambiguator.
 * `Price` and the state-refs are interval-agnostic.
 */
export type ConditionOperand =
  | { kind: OperandKind.Price }
  | { kind: OperandKind.Open }
  | { kind: OperandKind.High }
  | { kind: OperandKind.Low }
  | { kind: OperandKind.Close }
  | { kind: OperandKind.Volume }
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
      /** The key on the firing symbol's state map to read. */
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
