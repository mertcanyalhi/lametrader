import { type EnumFieldDescriptor, FieldType } from '@lametrader/core';
import { IndicatorError, validateIndicatorInputs } from './indicator.js';

/**
 * A reference enum input descriptor used across the validation tests below.
 */
const directionDescriptor: EnumFieldDescriptor<
  readonly [{ value: 'long-only'; label: string }, { value: 'both'; label: string }]
> = {
  type: FieldType.Enum,
  key: 'direction',
  label: 'Direction',
  options: [
    { value: 'long-only', label: 'Long Only' },
    { value: 'both', label: 'Long & Short' },
  ] as const,
  default: 'both',
};

describe('validateIndicatorInputs — enum', () => {
  it('accepts a valid enum value and returns it in the typed object', () => {
    expect(
      validateIndicatorInputs(
        { inputs: [directionDescriptor] as const },
        {
          direction: 'long-only',
        },
      ),
    ).toEqual({ direction: 'long-only' });
  });

  it('applies the enum default when the value is omitted', () => {
    expect(validateIndicatorInputs({ inputs: [directionDescriptor] as const }, {})).toEqual({
      direction: 'both',
    });
  });

  it("rejects an enum value that isn't a member of options", () => {
    expect(() =>
      validateIndicatorInputs(
        { inputs: [directionDescriptor] as const },
        {
          direction: 'sideways',
        },
      ),
    ).toThrow(IndicatorError);
  });
});
