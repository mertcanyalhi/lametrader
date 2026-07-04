import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import type { FieldError } from './error-response.types.js';

/**
 * Build the global {@link ValidationPipe} that validates every DTO at the
 * request boundary and — on failure — throws the uniform `{ error, fields }`
 * envelope (a 400) the app-wide error contract mandates.
 *
 * - `whitelist` + `forbidNonWhitelisted` reproduce the old TypeBox
 *   `additionalProperties: false`: an unknown property is a 400, not silently
 *   dropped.
 * - `transform` hydrates the plain body into the DTO class instance.
 * - `exceptionFactory` flattens class-validator's nested errors into the
 *   additive `fields[]` array (one entry per failing constraint), so a DTO
 *   rejection is byte-shape-identical to today's schema rejection.
 *
 * Cross-field / domain rules (e.g. `defaultPeriod ∈ periods`, non-empty
 * `periods`) are intentionally *not* expressed as DTO constraints — they stay
 * in the domain and surface as their own `{ error }` 400 via the exception
 * filter, exactly as before.
 */
export function buildValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors: ValidationError[]) =>
      new BadRequestException({
        error: 'Validation failed',
        fields: flattenValidationErrors(errors),
      }),
  });
}

/**
 * Flatten class-validator's (possibly nested) {@link ValidationError} tree into
 * a flat {@link FieldError} list — one entry per failing constraint, with the
 * dotted property path.
 *
 * @param errors - the validation errors for one level of the object graph.
 * @param parentPath - the dotted path accumulated from ancestor properties.
 */
function flattenValidationErrors(errors: ValidationError[], parentPath = ''): FieldError[] {
  const fields: FieldError[] = [];
  for (const error of errors) {
    const path = parentPath === '' ? error.property : `${parentPath}.${error.property}`;
    if (error.constraints !== undefined) {
      for (const message of Object.values(error.constraints)) {
        fields.push({ path, message });
      }
    }
    if (error.children !== undefined && error.children.length > 0) {
      fields.push(...flattenValidationErrors(error.children, path));
    }
  }
  return fields;
}
