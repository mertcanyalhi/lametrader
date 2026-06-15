import type { Candle } from './candle.types.js';
import {
  type EnumFieldDescriptor,
  type FieldDescriptor,
  FieldType,
  type InferInputs,
  type NumberFieldDescriptor,
  PriceSource,
  type SourceFieldDescriptor,
} from './indicator.types.js';
import { SymbolType } from './symbol.types.js';

/**
 * Raised when an indicator input fails validation, or when a price-source selector is unsupported on the given candle's asset class.
 *
 * Distinct type so driving adapters map it to a client error (HTTP 400) rather than a server fault.
 */
export class IndicatorError extends Error {
  /**
   * @param message - the human-readable validation failure reason.
   */
  constructor(message: string) {
    super(message);
    this.name = 'IndicatorError';
  }
}

/**
 * Raised when an indicator key has no module registered.
 *
 * Driving adapters map it to HTTP 404 (consistent with `SymbolNotFoundError` / `ProfileNotFoundError`).
 *
 * Thrown by driving adapters (controllers, CLI) on a lookup miss — the registry's `get(key)` still returns `null` so callers in the application layer can opt out of the exception.
 */
export class IndicatorNotFoundError extends Error {
  /**
   * @param message - the human-readable not-found reason.
   */
  constructor(message: string) {
    super(message);
    this.name = 'IndicatorNotFoundError';
  }
}

/** Every {@link PriceSource} value, for membership checks. */
const PRICE_SOURCE_VALUES = new Set<string>(Object.values(PriceSource));

/**
 * Resolve a {@link PriceSource} selector against a candle.
 *
 * Averaged sources are computed from the candle's OHLC.
 *
 * `Volume` requires the candle's asset class to carry volume — invalid for FX.
 *
 * @throws {@link IndicatorError} when `Volume` is requested on a candle class that has no volume (FX).
 */
export function resolveSource(candle: Candle, source: PriceSource): number {
  switch (source) {
    case PriceSource.Open:
      return candle.open;
    case PriceSource.High:
      return candle.high;
    case PriceSource.Low:
      return candle.low;
    case PriceSource.Close:
      return candle.close;
    case PriceSource.HL2:
      return (candle.high + candle.low) / 2;
    case PriceSource.HLC3:
      return (candle.high + candle.low + candle.close) / 3;
    case PriceSource.OHLC4:
      return (candle.open + candle.high + candle.low + candle.close) / 4;
    case PriceSource.Volume:
      if (candle.type === SymbolType.Fx) {
        throw new IndicatorError('source "volume" is not available for FX candles');
      }
      return candle.volume;
  }
}

/**
 * Validate an unknown input payload against a definition's input descriptors, applying defaults and returning a typed inputs object.
 *
 * @throws {@link IndicatorError} on a wrong-typed value, an out-of-range number, a non-`PriceSource` source, or a required value with no default.
 */
export function validateIndicatorInputs<I extends readonly FieldDescriptor[]>(
  definition: { inputs: I },
  values: Record<string, unknown>,
): InferInputs<I> {
  const result: Record<string, unknown> = {};
  for (const descriptor of definition.inputs) {
    const raw = values[descriptor.key];
    if (descriptor.type === FieldType.Number) {
      result[descriptor.key] = validateNumberInput(descriptor, raw);
    } else if (descriptor.type === FieldType.Source) {
      result[descriptor.key] = validateSourceInput(descriptor, raw);
    } else {
      result[descriptor.key] = validateEnumInput(descriptor, raw);
    }
  }
  return result as InferInputs<I>;
}

/**
 * Validate a single number input, applying its `default` when the raw value is undefined.
 */
function validateNumberInput(descriptor: NumberFieldDescriptor, raw: unknown): number {
  const value = raw === undefined ? descriptor.default : raw;
  if (value === undefined) {
    throw new IndicatorError(`input "${descriptor.key}" is required`);
  }
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new IndicatorError(`input "${descriptor.key}" must be a number`);
  }
  if (descriptor.integer && !Number.isInteger(value)) {
    throw new IndicatorError(`input "${descriptor.key}" must be an integer`);
  }
  if (descriptor.min !== undefined && value < descriptor.min) {
    throw new IndicatorError(`input "${descriptor.key}" must be >= ${descriptor.min}`);
  }
  if (descriptor.max !== undefined && value > descriptor.max) {
    throw new IndicatorError(`input "${descriptor.key}" must be <= ${descriptor.max}`);
  }
  return value;
}

/**
 * Validate a single source input, applying its `default` when the raw value is undefined.
 */
function validateSourceInput(descriptor: SourceFieldDescriptor, raw: unknown): PriceSource {
  const value = raw === undefined ? descriptor.default : raw;
  if (value === undefined) {
    throw new IndicatorError(`input "${descriptor.key}" is required`);
  }
  if (typeof value !== 'string' || !PRICE_SOURCE_VALUES.has(value)) {
    throw new IndicatorError(`input "${descriptor.key}" must be one of PriceSource`);
  }
  return value as PriceSource;
}

/**
 * Validate a single enum input, applying its `default` when the raw value is undefined.
 */
function validateEnumInput(descriptor: EnumFieldDescriptor, raw: unknown): string {
  const value = raw === undefined ? descriptor.default : raw;
  if (value === undefined) {
    throw new IndicatorError(`input "${descriptor.key}" is required`);
  }
  if (typeof value !== 'string' || !descriptor.options.some((option) => option.value === value)) {
    throw new IndicatorError(
      `input "${descriptor.key}" must be one of ${descriptor.options
        .map((o) => o.value)
        .join(', ')}`,
    );
  }
  return value;
}

export {
  type EnumFieldDescriptor,
  type EnumOption,
  type FieldDescriptor,
  FieldType,
  type NumberFieldDescriptor,
  PriceSource,
  type SourceFieldDescriptor,
} from './indicator.types.js';
