import {
  type ConditionOperand,
  OperandKind,
  type RuleEvent,
  RuleEventKind,
  type StateValue,
  StateValueType,
} from '@lametrader/core';
import type { EvaluationContext, EvaluationLookups } from './evaluation-context.types.js';

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
      return resolveOperand(operand, profileId, targetSymbolId, lookups, false);
    },
    resolvePrev(operand) {
      return resolveOperand(operand, profileId, targetSymbolId, lookups, true);
    },
  };
}

/**
 * Resolve one {@link ConditionOperand} against `targetSymbolId` + lookups,
 * scoped to `profileId` for state operands. When `prev` is `true` the
 * pre-change ("prev") cache slot is read instead of the latest one;
 * `Literal` operands ignore the flag — they have no time dimension.
 */
function resolveOperand(
  operand: ConditionOperand,
  profileId: string,
  symbolId: string | null,
  lookups: EvaluationLookups,
  prev: boolean,
): StateValue | null {
  switch (operand.kind) {
    case OperandKind.Literal:
      return operand.value;
    case OperandKind.CurrentValue:
      return wrapNumber(
        lookupOnSymbol(symbolId, (id) =>
          prev ? lookups.getPrevCurrentValue(id) : lookups.getCurrentValue(id),
        ),
      );
    case OperandKind.OpenValue:
      return wrapNumber(
        lookupOnSymbol(symbolId, (id) =>
          prev ? lookups.getPrevOpenValue(id) : lookups.getOpenValue(id),
        ),
      );
    case OperandKind.HighValue:
      return wrapNumber(
        lookupOnSymbol(symbolId, (id) =>
          prev ? lookups.getPrevHighValue(id) : lookups.getHighValue(id),
        ),
      );
    case OperandKind.LowValue:
      return wrapNumber(
        lookupOnSymbol(symbolId, (id) =>
          prev ? lookups.getPrevLowValue(id) : lookups.getLowValue(id),
        ),
      );
    case OperandKind.CloseValue:
      return wrapNumber(
        lookupOnSymbol(symbolId, (id) =>
          prev ? lookups.getPrevCloseValue(id) : lookups.getCloseValue(id),
        ),
      );
    case OperandKind.VolumeValue:
      return wrapNumber(
        lookupOnSymbol(symbolId, (id) =>
          prev ? lookups.getPrevVolumeValue(id) : lookups.getVolumeValue(id),
        ),
      );
    case OperandKind.IndicatorRef:
      return prev
        ? lookups.getPrevIndicatorValue(operand.instanceId, operand.stateKey)
        : lookups.getIndicatorValue(operand.instanceId, operand.stateKey);
    case OperandKind.SymbolStateRef:
      return lookupOnSymbol(symbolId, (id) =>
        prev
          ? lookups.getPrevSymbolState(profileId, id, operand.key)
          : lookups.getSymbolState(profileId, id, operand.key),
      );
    case OperandKind.GlobalStateRef:
      return prev
        ? lookups.getPrevGlobalState(profileId, operand.key)
        : lookups.getGlobalState(profileId, operand.key);
  }
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
