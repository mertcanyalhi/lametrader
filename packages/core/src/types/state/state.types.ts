/**
 * The kind of a {@link StateValue}, used as its discriminant.
 *
 * See ADR-0013 for why state values are a tagged union rather than bare `unknown`.
 */
export enum StateValueType {
  String = 'string',
  Number = 'number',
  Bool = 'bool',
}

/**
 * A value stored in the rules engine's state store (symbol-scoped or global), or
 * supplied as a literal operand in a rule condition.
 *
 * Carries its kind alongside its data so operator/value-type compatibility is
 * checkable at the type level and the rule editor can render the right input
 * per kind. See ADR-0013.
 */
export type StateValue =
  | { type: StateValueType.String; value: string }
  | { type: StateValueType.Number; value: number }
  | { type: StateValueType.Bool; value: boolean };
