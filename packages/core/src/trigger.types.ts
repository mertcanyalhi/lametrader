import type { Period } from './config.types.js';

/**
 * The gating policy that decides when a rule may fire again after a previous
 * firing.
 *
 * The string value is the persisted/serialized tag (stable across JSON
 * round-trips).
 */
export enum TriggerKind {
  /** Fires once over the rule's lifetime; never again. */
  Once = 'once',
  /** Fires at most once per bar of {@link OncePerBarTrigger.period}. */
  OncePerBar = 'oncePerBar',
  /**
   * Fires at most once per *closed* bar of
   * {@link OncePerBarCloseTrigger.period}.
   */
  OncePerBarClose = 'oncePerBarClose',
  /**
   * Fires at most once per `intervalMs` window (default 60 000 ms).
   */
  OncePerMinute = 'oncePerMinute',
}

/**
 * Fires once, then never again.
 */
export interface OnceTrigger {
  kind: TriggerKind.Once;
}

/**
 * Fires at most once per bar of `period`.
 */
export interface OncePerBarTrigger {
  kind: TriggerKind.OncePerBar;
  /** The bar size the gate uses. */
  period: Period;
}

/**
 * Fires at most once per *closed* bar of `period`.
 */
export interface OncePerBarCloseTrigger {
  kind: TriggerKind.OncePerBarClose;
  /** The bar size the gate uses. */
  period: Period;
}

/**
 * Fires at most once per `intervalMs` window.
 */
export interface OncePerMinuteTrigger {
  kind: TriggerKind.OncePerMinute;
  /**
   * Minimum elapsed time between fires, in milliseconds. Defaults to
   * {@link DEFAULT_TRIGGER_INTERVAL_MS}.
   */
  intervalMs: number;
}

/**
 * The trigger gate of a {@link Rule} — a tagged union over {@link TriggerKind}.
 *
 * Choose between firing-on-every-evaluation policies by the `kind`
 * discriminant; per-variant payload (period, interval) is required.
 */
export type Trigger =
  | OnceTrigger
  | OncePerBarTrigger
  | OncePerBarCloseTrigger
  | OncePerMinuteTrigger;
