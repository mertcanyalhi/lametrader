import {
  type BacktestSignal,
  type BacktestStrategyEntry,
  type BacktestStrategyExit,
  type BacktestStrategyFields,
  type BacktestThreshold,
  BacktestThresholdKind,
  type StateValue,
  StateValueType,
} from '@lametrader/core';

/**
 * Raised when a backtest-strategy input fails validation (bad name, malformed
 * signal/threshold, missing entry signal, or no exit mechanism).
 *
 * Distinct type so driving adapters map it to a client error (HTTP 400) rather
 * than a server fault.
 */
export class BacktestStrategyError extends Error {
  /**
   * @param message - the human-readable validation failure reason.
   */
  constructor(message: string) {
    super(message);
    this.name = 'BacktestStrategyError';
  }
}

/**
 * Raised when a backtest strategy does not exist (on get/replace/remove).
 *
 * Driving adapters map it to HTTP 404.
 */
export class BacktestStrategyNotFoundError extends Error {
  /**
   * @param message - the human-readable not-found reason.
   */
  constructor(message: string) {
    super(message);
    this.name = 'BacktestStrategyNotFoundError';
  }
}

/**
 * Raised when creating or renaming a strategy to a name already in use.
 *
 * Driving adapters map it to HTTP 409.
 */
export class BacktestStrategyConflictError extends Error {
  /**
   * @param message - the human-readable conflict reason.
   */
  constructor(message: string) {
    super(message);
    this.name = 'BacktestStrategyConflictError';
  }
}

/**
 * Validate and normalize an unknown value into a {@link StateValue}.
 *
 * The `type` discriminant must be a known {@link StateValueType} and `value`'s
 * scalar shape must match it.
 *
 * @throws {@link BacktestStrategyError} on an unknown type or a mismatched value.
 */
function parseStateValue(input: unknown, path: string): StateValue {
  const obj = (input ?? {}) as { type?: unknown; value?: unknown };
  switch (obj.type) {
    case StateValueType.String:
      if (typeof obj.value !== 'string') {
        throw new BacktestStrategyError(`${path}.value must be a string`);
      }
      return { type: StateValueType.String, value: obj.value };
    case StateValueType.Number:
      if (typeof obj.value !== 'number' || !Number.isFinite(obj.value)) {
        throw new BacktestStrategyError(`${path}.value must be a finite number`);
      }
      return { type: StateValueType.Number, value: obj.value };
    case StateValueType.Bool:
      if (typeof obj.value !== 'boolean') {
        throw new BacktestStrategyError(`${path}.value must be a boolean`);
      }
      return { type: StateValueType.Bool, value: obj.value };
    default:
      throw new BacktestStrategyError(`${path}.type must be a known state value type`);
  }
}

/**
 * Validate and normalize an unknown value into a {@link BacktestSignal}.
 *
 * @throws {@link BacktestStrategyError} on a blank `key` or a malformed `value`.
 */
function parseSignal(input: unknown, path: string): BacktestSignal {
  const obj = (input ?? {}) as { key?: unknown; value?: unknown };
  if (typeof obj.key !== 'string' || obj.key.trim().length === 0) {
    throw new BacktestStrategyError(`${path}.key must be a non-empty string`);
  }
  return { key: obj.key, value: parseStateValue(obj.value, `${path}.value`) };
}

/**
 * Validate and normalize an unknown value into a {@link BacktestThreshold}.
 *
 * @throws {@link BacktestStrategyError} on an unknown `kind` or a non-positive
 * `amount`.
 */
function parseThreshold(input: unknown, path: string): BacktestThreshold {
  const obj = (input ?? {}) as { kind?: unknown; amount?: unknown };
  if (obj.kind !== BacktestThresholdKind.Fixed && obj.kind !== BacktestThresholdKind.Percentage) {
    throw new BacktestStrategyError(`${path}.kind must be a known threshold kind`);
  }
  if (typeof obj.amount !== 'number' || !Number.isFinite(obj.amount) || obj.amount <= 0) {
    throw new BacktestStrategyError(`${path}.amount must be a positive number`);
  }
  return { kind: obj.kind, amount: obj.amount };
}

/**
 * Validate and normalize an unknown input into the mutable
 * {@link BacktestStrategyFields}.
 *
 * Applies the description default (`''`). Enforces the two domain rules the DTO
 * boundary can't: the entry signal is required, and the exit must set at least
 * one mechanism (signal, profit target, or stop loss). Only the exit mechanisms
 * that are present are carried through.
 *
 * @throws {@link BacktestStrategyError} on a blank `name`, a missing entry
 * signal, no exit mechanism, or any malformed signal/threshold.
 */
export function parseBacktestStrategyFields(input: unknown): BacktestStrategyFields {
  const obj = (input ?? {}) as {
    name?: unknown;
    description?: unknown;
    entry?: unknown;
    exit?: unknown;
  };
  if (typeof obj.name !== 'string' || obj.name.trim().length === 0) {
    throw new BacktestStrategyError('name must be a non-empty string');
  }
  if (obj.description !== undefined && typeof obj.description !== 'string') {
    throw new BacktestStrategyError('description must be a string');
  }

  const entryObj = (obj.entry ?? {}) as { signal?: unknown };
  if (entryObj.signal === undefined || entryObj.signal === null) {
    throw new BacktestStrategyError('entry signal is required');
  }
  const entry: BacktestStrategyEntry = { signal: parseSignal(entryObj.signal, 'entry.signal') };

  const exitObj = (obj.exit ?? {}) as {
    signal?: unknown;
    profitTarget?: unknown;
    stopLoss?: unknown;
  };
  const hasSignal = exitObj.signal !== undefined && exitObj.signal !== null;
  const hasProfitTarget = exitObj.profitTarget !== undefined && exitObj.profitTarget !== null;
  const hasStopLoss = exitObj.stopLoss !== undefined && exitObj.stopLoss !== null;
  if (!hasSignal && !hasProfitTarget && !hasStopLoss) {
    throw new BacktestStrategyError('exit must define at least one mechanism');
  }
  const exit: BacktestStrategyExit = {
    ...(hasSignal ? { signal: parseSignal(exitObj.signal, 'exit.signal') } : {}),
    ...(hasProfitTarget
      ? { profitTarget: parseThreshold(exitObj.profitTarget, 'exit.profitTarget') }
      : {}),
    ...(hasStopLoss ? { stopLoss: parseThreshold(exitObj.stopLoss, 'exit.stopLoss') } : {}),
  };

  return {
    name: obj.name,
    description: obj.description === undefined ? '' : obj.description,
    entry,
    exit,
  };
}
