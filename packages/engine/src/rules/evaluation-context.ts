import {
  type ConditionOperand,
  OperandKind,
  type RuleEvent,
  RuleEventKind,
  type StateValue,
  StateValueType,
} from '@lametrader/core';
import {
  type EvaluationContext,
  type EvaluationLookups,
  type OperandPrevCurrent,
  OperandValueSource,
  type TracedResolution,
} from './evaluation-context.types.js';

/**
 * For every OHLCV operand kind, the {@link RuleEventKind} that carries the
 * fresh value for that axis on its inbound event.
 *
 * Resolving the operand reads from `event.current` when the inbound event
 * matches this kind (and same symbol) — guards against a live cache that
 * hasn't caught up to the bar that triggered processing (#312).
 */
const OHLCV_OPERAND_TO_EVENT_KIND: Readonly<
  Record<
    | OperandKind.CurrentValue
    | OperandKind.OpenValue
    | OperandKind.HighValue
    | OperandKind.LowValue
    | OperandKind.CloseValue
    | OperandKind.VolumeValue,
    | RuleEventKind.CurrentValueChanged
    | RuleEventKind.OpenValueChanged
    | RuleEventKind.HighValueChanged
    | RuleEventKind.LowValueChanged
    | RuleEventKind.CloseValueChanged
    | RuleEventKind.VolumeValueChanged
  >
> = {
  [OperandKind.CurrentValue]: RuleEventKind.CurrentValueChanged,
  [OperandKind.OpenValue]: RuleEventKind.OpenValueChanged,
  [OperandKind.HighValue]: RuleEventKind.HighValueChanged,
  [OperandKind.LowValue]: RuleEventKind.LowValueChanged,
  [OperandKind.CloseValue]: RuleEventKind.CloseValueChanged,
  [OperandKind.VolumeValue]: RuleEventKind.VolumeValueChanged,
};

/**
 * Build a fresh {@link EvaluationContext} for one inbound {@link RuleEvent}.
 *
 * Pure: takes the event plus a set of injected lookups; never touches I/O or
 * a clock. The returned context resolves any operand by dispatching on its
 * `kind`.
 *
 * @param event - the event being evaluated.
 * @param lookups - the live caches the orchestrator wires in.
 * @param profileId - the firing rule's profile id; state lookups
 *   ({@link OperandKind.SymbolStateRef} / {@link OperandKind.GlobalStateRef})
 *   resolve against this profile's namespace (#281).
 * @param targetSymbolId - the symbol the rule is firing on (may differ from
 *   the event's `symbolId` for AllSymbols Timer fan-out); defaults to
 *   `event.symbolId`.
 */
export function buildEvaluationContext(
  event: RuleEvent,
  lookups: EvaluationLookups,
  profileId: string,
  targetSymbolId: string | null = event.symbolId,
): EvaluationContext {
  const { prev, current } = derivePrevCurrent(event);
  return {
    event,
    prev,
    current,
    resolve(operand) {
      return resolveOperand(operand, event, profileId, targetSymbolId, lookups).value;
    },
    resolveTraced(operand) {
      return resolveOperand(operand, event, profileId, targetSymbolId, lookups);
    },
    resolvePrevCurrent(operand) {
      return resolveOperandPrevCurrent(operand, event, profileId, targetSymbolId, lookups);
    },
  };
}

/**
 * Resolve one {@link ConditionOperand} against `targetSymbolId` + lookups,
 * scoped to `profileId` for state operands.
 *
 * For OHLCV operands whose axis matches the inbound `event`'s
 * `*ValueChanged` kind on the same symbol, the value is taken from
 * `event.current` rather than the live cache — the event's payload is
 * authoritative for that axis at this `ts`, and the live cache may not yet
 * have caught up (#312).
 */
function resolveOperand(
  operand: ConditionOperand,
  event: RuleEvent,
  profileId: string,
  symbolId: string | null,
  lookups: EvaluationLookups,
): TracedResolution {
  switch (operand.kind) {
    case OperandKind.Literal:
      return { value: operand.value, source: OperandValueSource.Literal };
    case OperandKind.CurrentValue:
      return resolveOhlcv(event, symbolId, operand.kind, (id) => lookups.getCurrentValue(id));
    case OperandKind.OpenValue:
      return resolveOhlcv(event, symbolId, operand.kind, (id) => lookups.getOpenValue(id));
    case OperandKind.HighValue:
      return resolveOhlcv(event, symbolId, operand.kind, (id) => lookups.getHighValue(id));
    case OperandKind.LowValue:
      return resolveOhlcv(event, symbolId, operand.kind, (id) => lookups.getLowValue(id));
    case OperandKind.CloseValue:
      return resolveOhlcv(event, symbolId, operand.kind, (id) => lookups.getCloseValue(id));
    case OperandKind.VolumeValue:
      return resolveOhlcv(event, symbolId, operand.kind, (id) => lookups.getVolumeValue(id));
    case OperandKind.IndicatorRef:
      return {
        value: lookups.getIndicatorValue(operand.instanceId, operand.stateKey),
        source: OperandValueSource.Lookup,
      };
    case OperandKind.SymbolStateRef:
      return {
        value: lookupOnSymbol(symbolId, (id) => lookups.getSymbolState(profileId, id, operand.key)),
        source: OperandValueSource.Lookup,
      };
    case OperandKind.GlobalStateRef:
      return {
        value: lookups.getGlobalState(profileId, operand.key),
        source: OperandValueSource.Lookup,
      };
  }
}

/**
 * Resolve one {@link ConditionOperand} to its `(prev, current)` pair against
 * the inbound `event`. For change-aware operand kinds, the inbound event is
 * inspected first: if it's the matching `*Changed` event for the operand's
 * identity (axis / instance / state key), `(event.prev, event.current)` is
 * returned. Otherwise no transition has happened for this operand on this
 * event, so prev = current = the live lookup (or both `null`).
 *
 * Literals are stationary — prev = current = literal value.
 */
function resolveOperandPrevCurrent(
  operand: ConditionOperand,
  event: RuleEvent,
  profileId: string,
  symbolId: string | null,
  lookups: EvaluationLookups,
): OperandPrevCurrent {
  switch (operand.kind) {
    case OperandKind.Literal:
      return { prev: operand.value, current: operand.value };
    case OperandKind.CurrentValue:
    case OperandKind.OpenValue:
    case OperandKind.HighValue:
    case OperandKind.LowValue:
    case OperandKind.CloseValue:
    case OperandKind.VolumeValue: {
      const matchingKind = OHLCV_OPERAND_TO_EVENT_KIND[operand.kind];
      if (event.kind === matchingKind && symbolId !== null && event.symbolId === symbolId) {
        return { prev: wrapNumber(event.prev), current: wrapNumber(event.current) };
      }
      const value = wrapNumber(lookupOnSymbol(symbolId, ohlcvLookup(operand.kind, lookups)));
      return { prev: value, current: value };
    }
    case OperandKind.IndicatorRef: {
      if (
        event.kind === RuleEventKind.IndicatorValueChanged &&
        event.instanceId === operand.instanceId &&
        event.stateKey === operand.stateKey
      ) {
        return { prev: event.prev, current: event.current };
      }
      const value = lookups.getIndicatorValue(operand.instanceId, operand.stateKey);
      return { prev: value, current: value };
    }
    case OperandKind.SymbolStateRef: {
      if (
        event.kind === RuleEventKind.SymbolStateChanged &&
        event.profileId === profileId &&
        symbolId !== null &&
        event.symbolId === symbolId &&
        event.key === operand.key
      ) {
        return { prev: event.prev, current: event.current };
      }
      const value = lookupOnSymbol(symbolId, (id) =>
        lookups.getSymbolState(profileId, id, operand.key),
      );
      return { prev: value, current: value };
    }
    case OperandKind.GlobalStateRef: {
      if (
        event.kind === RuleEventKind.GlobalStateChanged &&
        event.profileId === profileId &&
        event.key === operand.key
      ) {
        return { prev: event.prev, current: event.current };
      }
      const value = lookups.getGlobalState(profileId, operand.key);
      return { prev: value, current: value };
    }
  }
}

/**
 * Dispatch one OHLCV operand kind to its per-axis lookup function.
 */
function ohlcvLookup(
  operandKind: keyof typeof OHLCV_OPERAND_TO_EVENT_KIND,
  lookups: EvaluationLookups,
): (symbolId: string) => number | null {
  switch (operandKind) {
    case OperandKind.CurrentValue:
      return (id) => lookups.getCurrentValue(id);
    case OperandKind.OpenValue:
      return (id) => lookups.getOpenValue(id);
    case OperandKind.HighValue:
      return (id) => lookups.getHighValue(id);
    case OperandKind.LowValue:
      return (id) => lookups.getLowValue(id);
    case OperandKind.CloseValue:
      return (id) => lookups.getCloseValue(id);
    case OperandKind.VolumeValue:
      return (id) => lookups.getVolumeValue(id);
  }
}

/**
 * Resolve one OHLCV operand: when the inbound `event` is the matching
 * `*ValueChanged` for the same `symbolId`, take the value from
 * `event.current` directly. Otherwise fall through to the live `lookup`.
 */
function resolveOhlcv(
  event: RuleEvent,
  symbolId: string | null,
  operandKind: keyof typeof OHLCV_OPERAND_TO_EVENT_KIND,
  lookup: (symbolId: string) => number | null,
): TracedResolution {
  const matchingKind = OHLCV_OPERAND_TO_EVENT_KIND[operandKind];
  if (event.kind === matchingKind && symbolId !== null && event.symbolId === symbolId) {
    return { value: wrapNumber(event.current), source: OperandValueSource.Event };
  }
  return {
    value: wrapNumber(lookupOnSymbol(symbolId, lookup)),
    source: OperandValueSource.Lookup,
  };
}

/**
 * Invoke `lookup` against `symbolId` when present; `null` symbolId (Timer
 * with no fan-out target / global-state-change) resolves symbol-scoped
 * operands to `null`.
 */
function lookupOnSymbol<T>(
  symbolId: string | null,
  lookup: (symbolId: string) => T | null,
): T | null {
  return symbolId === null ? null : lookup(symbolId);
}

/**
 * Wrap a raw number lookup in a {@link StateValue.Number}, propagating
 * `null`.
 */
function wrapNumber(value: number | null): StateValue | null {
  return value === null ? null : { type: StateValueType.Number, value };
}

/**
 * Pull the inbound event's `prev` / `current` into the uniform
 * {@link StateValue} shape the operators consume.
 *
 * Timer events carry no value (`prev` = `current` = `null`). OHLCV events
 * wrap their numbers as `Number`. State / indicator events forward their
 * already-typed values.
 */
function derivePrevCurrent(event: RuleEvent): {
  prev: StateValue | null;
  current: StateValue | null;
} {
  switch (event.kind) {
    case RuleEventKind.Timer:
      return { prev: null, current: null };
    case RuleEventKind.CurrentValueChanged:
    case RuleEventKind.OpenValueChanged:
    case RuleEventKind.HighValueChanged:
    case RuleEventKind.LowValueChanged:
    case RuleEventKind.CloseValueChanged:
    case RuleEventKind.VolumeValueChanged:
      return {
        prev: wrapNumber(event.prev),
        current: wrapNumber(event.current),
      };
    case RuleEventKind.SymbolStateChanged:
    case RuleEventKind.GlobalStateChanged:
      return { prev: event.prev, current: event.current };
    case RuleEventKind.IndicatorValueChanged:
      return { prev: event.prev, current: event.current };
  }
}
