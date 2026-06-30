import type { Period } from '../config.types.js';
import type { StateValue } from '../state.types.js';

/**
 * The kind of an {@link EvaluationTriggerEvent} — an event that drives a rule
 * re-evaluation.
 *
 * The string value is the persisted/serialized tag (stable across JSON
 * round-trips).
 *
 * Per ADR 0016 / CONTEXT.md: evaluation triggers and data-update events live
 * in two distinct channels.
 * This enum is the evaluation-trigger channel; {@link DataUpdateKind} is the
 * data-update channel.
 */
export enum EvaluationTriggerKind {
  /** A live tick (price update) from the quote stream. */
  Tick = 'tick',
  /** A new bar of a given `Period` opened for a symbol. */
  BarOpened = 'barOpened',
  /** A bar of a given `Period` closed (`final`) for a symbol. */
  BarClosed = 'barClosed',
  /** A wall-clock timer fired (drives `OncePerInterval`). */
  Timer = 'timer',
  /** A key in a specific symbol's state mutated (cascade trigger). */
  SymbolStateChanged = 'symbolStateChanged',
  /** A key in the global state mutated (cascade trigger). */
  GlobalStateChanged = 'globalStateChanged',
  /** A key in an indicator-instance's state mutated (cascade trigger). */
  IndicatorChanged = 'indicatorChanged',
}

/** A live tick (price update) from the quote stream. */
export interface TickEvent {
  kind: EvaluationTriggerKind.Tick;
  ts: number;
  symbolId: string;
  /** The tick's price value. */
  price: number;
}

/** A new bar of `period` was first observed for `symbolId`. */
export interface BarOpenedEvent {
  kind: EvaluationTriggerKind.BarOpened;
  ts: number;
  symbolId: string;
  /** The bar period that opened. */
  period: Period;
}

/** A bar of `period` transitioned to `final` for `symbolId`. */
export interface BarClosedEvent {
  kind: EvaluationTriggerKind.BarClosed;
  ts: number;
  symbolId: string;
  /** The bar period that closed. */
  period: Period;
}

/**
 * Wall-clock timer tick.
 * Used to drive {@link TriggerKind.OncePerInterval}; carries no symbol.
 */
export interface TimerEvent {
  kind: EvaluationTriggerKind.Timer;
  ts: number;
}

/**
 * One key in a specific symbol's state mutated.
 * Cascade trigger: a state mutation re-runs the orchestrator within the same
 * tick under the cycle guard (per ADR 0012).
 */
export interface SymbolStateChangedEvent {
  kind: EvaluationTriggerKind.SymbolStateChanged;
  ts: number;
  symbolId: string;
  /** Which profile's namespace the mutation happened in. */
  profileId: string;
  key: string;
  prev: StateValue | null;
  current: StateValue | null;
}

/** One key in the global state mutated. */
export interface GlobalStateChangedEvent {
  kind: EvaluationTriggerKind.GlobalStateChanged;
  ts: number;
  /** Which profile's namespace the mutation happened in. */
  profileId: string;
  key: string;
  prev: StateValue | null;
  current: StateValue | null;
}

/**
 * One key in an indicator-instance's state mutated.
 *
 * Carries `profileId` so the orchestrator can partition cascade candidates
 * to the originating profile — preserving the same per-profile scoping
 * invariant {@link SymbolStateChangedEvent} / {@link GlobalStateChangedEvent}
 * uphold (introduced by #281).
 */
export interface IndicatorChangedEvent {
  kind: EvaluationTriggerKind.IndicatorChanged;
  ts: number;
  symbolId: string;
  /** Which profile's indicator-instance the mutation belongs to. */
  profileId: string;
  instanceId: string;
  stateKey: string;
  prev: StateValue | null;
  current: StateValue;
}

/**
 * An event that drives a rule re-evaluation.
 * Tagged union over {@link EvaluationTriggerKind}.
 */
export type EvaluationTriggerEvent =
  | TickEvent
  | BarOpenedEvent
  | BarClosedEvent
  | TimerEvent
  | SymbolStateChangedEvent
  | GlobalStateChangedEvent
  | IndicatorChangedEvent;

/**
 * The kind of a {@link DataUpdateEvent} — a per-axis OHLCV change that mutates
 * the engine's lookup caches but does NOT drive evaluation on its own.
 *
 * The string value is the persisted/serialized tag.
 */
export enum DataUpdateKind {
  /** A bar's open value changed. */
  Open = 'openChanged',
  /** A bar's high value changed. */
  High = 'highChanged',
  /** A bar's low value changed. */
  Low = 'lowChanged',
  /** A bar's close value changed. */
  Close = 'closeChanged',
  /** A bar's volume value changed. */
  Volume = 'volumeChanged',
}

/** Shared shape of every OHLCV data-update event. */
interface BaseDataUpdateEvent<K extends DataUpdateKind> {
  kind: K;
  ts: number;
  symbolId: string;
  /** The bar period whose axis updated. */
  period: Period;
  /** The new value on the axis. */
  value: number;
}

/** A bar's open value changed. */
export type OpenChangedEvent = BaseDataUpdateEvent<DataUpdateKind.Open>;
/** A bar's high value changed. */
export type HighChangedEvent = BaseDataUpdateEvent<DataUpdateKind.High>;
/** A bar's low value changed. */
export type LowChangedEvent = BaseDataUpdateEvent<DataUpdateKind.Low>;
/** A bar's close value changed. */
export type CloseChangedEvent = BaseDataUpdateEvent<DataUpdateKind.Close>;
/** A bar's volume value changed. */
export type VolumeChangedEvent = BaseDataUpdateEvent<DataUpdateKind.Volume>;

/**
 * A per-axis OHLCV change.
 *
 * Fills the lookups cache; does NOT drive re-evaluation by itself.
 * Tagged union over {@link DataUpdateKind}.
 */
export type DataUpdateEvent =
  | OpenChangedEvent
  | HighChangedEvent
  | LowChangedEvent
  | CloseChangedEvent
  | VolumeChangedEvent;

/**
 * Umbrella over both event channels — what the engine's inbound queue carries.
 */
export type RuleEvent = EvaluationTriggerEvent | DataUpdateEvent;
