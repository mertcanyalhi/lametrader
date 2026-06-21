import { type FieldDescriptor, FieldType, PriceSource } from '@lametrader/core';
import * as yup from 'yup';

/**
 * Build a Yup schema for one indicator's `inputs[]` at render time.
 *
 * The indicator-inputs form is descriptor-driven: its field set varies with
 * the selected definition, so the schema can't live as a static module like
 * `lib/profile-schema.ts`. The construction itself is mechanical — one Yup
 * rule per descriptor flag (`required`, `min`, `max`, `integer`, `oneOf`) —
 * keeping the same convention surface (`yupResolver` + label-aware messages)
 * the static schemas use.
 *
 * Number fields coerce the input control's string value to a number via a
 * Yup transform, so an empty input fails `required` (the previous form sent
 * `NaN` to the server) and any non-numeric input fails `typeError`.
 */
export function buildIndicatorInputsSchema(
  inputs: readonly FieldDescriptor[],
): yup.ObjectSchema<Record<string, unknown>> {
  const shape: Record<string, yup.AnySchema> = {};
  for (const descriptor of inputs) {
    if (descriptor.type === FieldType.Number) {
      let schema = yup
        .number()
        .transform((value, originalValue) => {
          if (originalValue === '' || originalValue === null || originalValue === undefined) {
            return undefined;
          }
          const parsed = typeof originalValue === 'number' ? originalValue : Number(originalValue);
          return Number.isFinite(parsed) ? parsed : undefined;
        })
        .typeError(({ label }) => `${label} must be a number.`)
        .required(({ label }) => `${label} is required.`)
        .label(descriptor.label);
      if (descriptor.integer === true) {
        schema = schema.integer(({ label }) => `${label} must be an integer.`);
      }
      if (descriptor.min !== undefined) {
        schema = schema.min(descriptor.min, ({ label, min }) => `${label} must be ≥ ${min}.`);
      }
      if (descriptor.max !== undefined) {
        schema = schema.max(descriptor.max, ({ label, max }) => `${label} must be ≤ ${max}.`);
      }
      shape[descriptor.key] = schema;
    } else if (descriptor.type === FieldType.Source) {
      shape[descriptor.key] = yup
        .string()
        .oneOf(Object.values(PriceSource), ({ label }) => `${label} must be a price source.`)
        .required(({ label }) => `${label} is required.`)
        .label(descriptor.label);
    } else {
      shape[descriptor.key] = yup
        .string()
        .oneOf(
          descriptor.options.map((option) => option.value),
          ({ label }) => `${label} must be one of the listed options.`,
        )
        .required(({ label }) => `${label} is required.`)
        .label(descriptor.label);
    }
  }
  return yup.object(shape) as yup.ObjectSchema<Record<string, unknown>>;
}
