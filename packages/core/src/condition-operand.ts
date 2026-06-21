import { type ConditionOperand, OperandKind } from './condition-operand.types.js';
import type { StateValueType } from './state.types.js';

/**
 * The {@link StateValueType} an operand resolves to — the discriminant the
 * operator-compatibility validator (and the rule editor's operator picker) read
 * to constrain the legal operator choices for a given left/right pair.
 *
 * For {@link OperandKind.Literal} the type is read from the wrapped
 * {@link StateValue}'s own `type`; for every other variant it comes from the
 * operand's explicit `valueType` field.
 *
 * @param operand - the operand to inspect.
 */
export function operandValueType(operand: ConditionOperand): StateValueType {
  return operand.kind === OperandKind.Literal ? operand.value.type : operand.valueType;
}
