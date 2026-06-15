import { describe, expect, it } from 'vitest';
import {
  FieldType,
  IndicatorError,
  type NumberFieldDescriptor,
  validateIndicatorInputs,
} from './indicator.js';

const length: NumberFieldDescriptor = {
  type: FieldType.Number,
  key: 'length',
  label: 'Length',
  integer: true,
  min: 1,
  default: 14,
};

describe('validateIndicatorInputs — string coercion for Number', () => {
  it('accepts a numeric string and returns it as a number', () => {
    expect(validateIndicatorInputs({ inputs: [length] }, { length: '14' })).toEqual({ length: 14 });
  });

  it('rejects a non-numeric string with IndicatorError', () => {
    expect(() => validateIndicatorInputs({ inputs: [length] }, { length: 'abc' })).toThrow(
      IndicatorError,
    );
  });
});
