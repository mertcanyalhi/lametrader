import type { StateValue } from './state.types.js';

/**
 * The kind of a {@link RuleEvent} — the normalized event the engine consumes.
 *
 * The string value is the persisted/serialized tag (stable across JSON
 * round-trips).
 */
export enum RuleEventKind {
  /** Per-minute timer tick (no symbol). */
  Timer = 'timer',
  /** A symbol's current ("last") price changed. */
  CurrentValueChanged = 'currentValueChanged',
  /** A symbol's open value changed. */
  OpenValueChanged = 'openValueChanged',
  /** A symbol's high value changed. */
  HighValueChanged = 'highValueChanged',
  /** A symbol's low value changed. */
  LowValueChanged = 'lowValueChanged',
  /** A symbol's close value changed. */
  CloseValueChanged = 'closeValueChanged',
  /** A symbol's volume value changed. */
  VolumeValueChanged = 'volumeValueChanged',
  /** A key in a specific symbol's state mutated. */
  SymbolStateChanged = 'symbolStateChanged',
  /** A key in the global state mutated. */
  GlobalStateChanged = 'globalStateChanged',
  /** A key in an indicator-instance's state mutated. */
  IndicatorValueChanged = 'indicatorValueChanged',
}

/**
 * Per-minute timer tick. `symbolId` is `null` — the tick applies to every
 * watched symbol the orchestrator iterates.
 */
export interface TimerEvent {
  kind: RuleEventKind.Timer;
  ts: number;
  symbolId: null;
}

/**
 * Shared shape of every OHLCV change event — only the discriminant differs.
 *
 * `prev` is `null` on the first observation of the value (no prior to compare
 * to).
 */
interface OhlcvChangedEvent<K extends RuleEventKind> {
  kind: K;
  ts: number;
  symbolId: string;
  prev: number | null;
  current: number;
}

/** A symbol's current ("last") price changed. */
export type CurrentValueChangedEvent = OhlcvChangedEvent<RuleEventKind.CurrentValueChanged>;
/** A symbol's open value changed. */
export type OpenValueChangedEvent = OhlcvChangedEvent<RuleEventKind.OpenValueChanged>;
/** A symbol's high value changed. */
export type HighValueChangedEvent = OhlcvChangedEvent<RuleEventKind.HighValueChanged>;
/** A symbol's low value changed. */
export type LowValueChangedEvent = OhlcvChangedEvent<RuleEventKind.LowValueChanged>;
/** A symbol's close value changed. */
export type CloseValueChangedEvent = OhlcvChangedEvent<RuleEventKind.CloseValueChanged>;
/** A symbol's volume value changed. */
export type VolumeValueChangedEvent = OhlcvChangedEvent<RuleEventKind.VolumeValueChanged>;

/**
 * One key in a specific symbol's state mutated. `current` is `null` when the
 * key was removed; `prev` is `null` when the key was just created.
 */
export interface SymbolStateChangedEvent {
  kind: RuleEventKind.SymbolStateChanged;
  ts: number;
  symbolId: string;
  key: string;
  prev: StateValue | null;
  current: StateValue | null;
}

/**
 * One key in the global state mutated. `symbolId` is `null` because the
 * mutation isn't scoped to a single symbol.
 */
export interface GlobalStateChangedEvent {
  kind: RuleEventKind.GlobalStateChanged;
  ts: number;
  symbolId: null;
  key: string;
  prev: StateValue | null;
  current: StateValue | null;
}

/**
 * One key in an indicator-instance's state mutated. Identifies the instance
 * (`instanceId`) and which output (`stateKey`) changed.
 */
export interface IndicatorValueChangedEvent {
  kind: RuleEventKind.IndicatorValueChanged;
  ts: number;
  symbolId: string;
  instanceId: string;
  stateKey: string;
  prev: StateValue | null;
  current: StateValue;
}

/**
 * The normalized event the rule engine consumes — one tagged union across
 * every input source (timer, OHLCV streams, state mutations, indicator
 * updates).
 *
 * Per ADR 0012, every variant carries its own `ts`; the engine never reads a
 * wall-clock.
 */
export type RuleEvent =
  | TimerEvent
  | CurrentValueChangedEvent
  | OpenValueChangedEvent
  | HighValueChangedEvent
  | LowValueChangedEvent
  | CloseValueChangedEvent
  | VolumeValueChangedEvent
  | SymbolStateChangedEvent
  | GlobalStateChangedEvent
  | IndicatorValueChangedEvent;
