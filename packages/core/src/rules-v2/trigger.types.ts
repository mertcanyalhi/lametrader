import type { Period } from '../config.types.js';

/**
 * The kind of a {@link Trigger} — which evaluation cadence drives the rule and
 * which gating policy decides when it may fire again.
 *
 * The string value is the persisted/serialized tag (stable across JSON
 * round-trips).
 *
 * Per ADR 0016, three cadences (tick / bar / periodic) drive six triggers.
 * `EveryTime` / `Once` / `OncePerBar` are tick-cadence (re-evaluated per tick);
 * `OncePerBarOpen` / `OncePerBarClose` are bar-cadence (re-evaluated on bar
 * lifecycle events); `OncePerInterval` is periodic (wall-clock timer).
 */
export enum TriggerKind {
  /** Re-evaluate on every tick; fire on every match. */
  EveryTime = 'everyTime',
  /** Re-evaluate on every tick; fire once over the rule's lifetime. */
  Once = 'once',
  /**
   * Re-evaluate on every tick; first matching tick within a bar of `period`
   * fires, further checks suppressed until the next bar of that period.
   */
  OncePerBar = 'oncePerBar',
  /** Fire when a bar of `period` opens. */
  OncePerBarOpen = 'oncePerBarOpen',
  /** Fire when a bar of `period` closes (`final`). */
  OncePerBarClose = 'oncePerBarClose',
  /** Fire once per fixed wall-clock duration. */
  OncePerInterval = 'oncePerInterval',
}

/** Tick-cadence; fire on every matching tick. No fire throttle. */
export interface EveryTimeTrigger {
  kind: TriggerKind.EveryTime;
}

/** Tick-cadence; on the first matching tick auto-disable the rule. */
export interface OnceTrigger {
  kind: TriggerKind.Once;
}

/**
 * Tick-cadence; first matching tick within a bar of `period` fires and
 * suppresses further checks until the next bar of that period opens.
 */
export interface OncePerBarTrigger {
  kind: TriggerKind.OncePerBar;
  /** The bar period whose boundaries re-arm the latch. */
  period: Period;
}

/** Bar-cadence; fires when a bar of `period` opens. */
export interface OncePerBarOpenTrigger {
  kind: TriggerKind.OncePerBarOpen;
  /** The bar period whose `open` event drives evaluation. */
  period: Period;
}

/** Bar-cadence; fires when a bar of `period` closes (`final`). */
export interface OncePerBarCloseTrigger {
  kind: TriggerKind.OncePerBarClose;
  /** The bar period whose `close` event drives evaluation. */
  period: Period;
}

/** Periodic-cadence; fires once per fixed wall-clock window. */
export interface OncePerIntervalTrigger {
  kind: TriggerKind.OncePerInterval;
  /** Wall-clock duration between fires, in milliseconds. */
  intervalMs: number;
}

/**
 * The trigger of a v2 {@link Rule} — a tagged union over {@link TriggerKind}.
 *
 * The trigger explicitly declares its evaluation cadence (tick / bar /
 * periodic); operand axes are independent (per ADR 0016).
 */
export type Trigger =
  | EveryTimeTrigger
  | OnceTrigger
  | OncePerBarTrigger
  | OncePerBarOpenTrigger
  | OncePerBarCloseTrigger
  | OncePerIntervalTrigger;
