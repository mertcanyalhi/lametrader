import type { Candle } from './candle.types.js';
import type { Period } from './config.types.js';
import type { SymbolType } from './symbol.types.js';

/**
 * The vocabulary of input/state field types an indicator can declare.
 *
 * Grows on its second instance — keep additions narrow.
 */
export enum FieldType {
  /** A numeric scalar (integer or float). */
  Number = 'number',
  /** A price-source selector (where to pull the value from on a candle). */
  Source = 'source',
  /** A choice from a closed set of string options. */
  Enum = 'enum',
}

/**
 * Available price-source selectors over a candle.
 *
 * The averaged sources (`HL2`, `HLC3`, `OHLC4`) are computed from the candle's OHLC.
 *
 * `Volume` is only valid on candle classes that carry it (crypto, equity).
 */
export enum PriceSource {
  /** Candle open price. */
  Open = 'open',
  /** Candle high price. */
  High = 'high',
  /** Candle low price. */
  Low = 'low',
  /** Candle close price. */
  Close = 'close',
  /** (high + low) / 2 — typical bar midpoint. */
  HL2 = 'hl2',
  /** (high + low + close) / 3 — "typical" price. */
  HLC3 = 'hlc3',
  /** (open + high + low + close) / 4 — "weighted" price. */
  OHLC4 = 'ohlc4',
  /** Traded volume — invalid for FX candles. */
  Volume = 'volume',
}

/**
 * A numeric input parameter — e.g. a moving-average length or a multiplier.
 */
export interface NumberFieldDescriptor {
  /** Discriminator: numeric input. */
  type: FieldType.Number;
  /** Stable key used in the input object and addressable from action rules. */
  key: string;
  /** Human-readable label for UI forms. */
  label: string;
  /** When true, the value must be an integer. */
  integer?: boolean;
  /** Inclusive lower bound. */
  min?: number;
  /** Inclusive upper bound. */
  max?: number;
  /** UI step hint (form rendering only — not validated). */
  step?: number;
  /** Default applied when the value is omitted at validation. */
  default?: number;
}

/**
 * A price-source selector input — picks which price (or volume) to feed the indicator.
 */
export interface SourceFieldDescriptor {
  /** Discriminator: price-source input. */
  type: FieldType.Source;
  /** Stable key. */
  key: string;
  /** Human-readable label for UI forms. */
  label: string;
  /** Default selector applied when omitted (typically `Close`). */
  default?: PriceSource;
}

/**
 * One option in an {@link EnumFieldDescriptor}'s closed set.
 *
 * `value` is the string used in the input/state object; `label` is the human-readable form for UI option lists.
 */
export interface EnumOption {
  /** The actual value used in inputs/state. */
  value: string;
  /** Human-readable label for UI forms / chart legends. */
  label: string;
}

/**
 * An enum input — a choice from a closed set of string options.
 *
 * The generic `O` preserves the literal-union of option values for type-level inference (authors declare `options: [...] as const`).
 */
export interface EnumFieldDescriptor<O extends readonly EnumOption[] = readonly EnumOption[]> {
  /** Discriminator: enum input. */
  type: FieldType.Enum;
  /** Stable key. */
  key: string;
  /** Human-readable label for UI forms. */
  label: string;
  /** The closed set of allowed options. */
  options: O;
  /** Default applied when the value is omitted at validation; must be one of `options`. */
  default?: O[number]['value'];
}

/**
 * An input field descriptor — a union of the supported input types.
 */
export type FieldDescriptor = NumberFieldDescriptor | SourceFieldDescriptor | EnumFieldDescriptor;

/**
 * Chart render kinds carried as a hint on state fields.
 *
 * The chart layer (future) translates these into renderer-specific calls.
 */
export enum RenderKind {
  /** Plot the state value as a line. */
  Line = 'line',
  /** Discrete per-bar markers (e.g. buy/sell shapes). */
  Markers = 'markers',
}

/**
 * Whether a state field is drawn on the price pane or in a separate pane.
 */
export enum Pane {
  /** Overlay on the price chart. */
  Overlay = 'overlay',
  /** In a separate pane below the price chart. */
  Separate = 'separate',
}

/**
 * A numeric state field — e.g. the moving-average value at each bar.
 */
export interface NumberStateFieldDescriptor {
  /** Discriminator: numeric state. */
  type: FieldType.Number;
  /** Stable key used in the result rows and addressable from action rules. */
  key: string;
  /** Human-readable label for UI / chart legends. */
  label: string;
  /** Render hint for a future chart view. */
  render?: RenderKind;
  /** Pane hint for a future chart view. */
  pane?: Pane;
  /** Default colour hint for a future chart view (CSS string). */
  color?: string;
}

/**
 * An enum state field — emits one of a closed set of string values per bar (or `null`).
 *
 * Like its input cousin, the generic preserves the literal-union of option values for type-level inference.
 */
export interface EnumStateFieldDescriptor<O extends readonly EnumOption[] = readonly EnumOption[]> {
  /** Discriminator: enum state. */
  type: FieldType.Enum;
  /** Stable key. */
  key: string;
  /** Human-readable label. */
  label: string;
  /** The closed set of allowed output values. */
  options: O;
  /** Render hint for a future chart view (typically `Markers` for buy/sell). */
  render?: RenderKind;
  /** Pane hint for a future chart view. */
  pane?: Pane;
  /** Default colour hint for a future chart view (CSS string). */
  color?: string;
}

/**
 * A state field descriptor — a union of the supported state types.
 */
export type StateFieldDescriptor = NumberStateFieldDescriptor | EnumStateFieldDescriptor;

/**
 * Map an input descriptor to the value type it produces.
 *
 * Used inside {@link InferInputs} to drive type-level inference.
 */
export type InferFieldValue<D extends FieldDescriptor> = D extends NumberFieldDescriptor
  ? number
  : D extends SourceFieldDescriptor
    ? PriceSource
    : D extends EnumFieldDescriptor<infer O>
      ? O[number]['value']
      : never;

/**
 * Map an array of input descriptors to the typed inputs object an indicator's `compute` receives.
 *
 * Keys come from each descriptor's `key`; values come from {@link InferFieldValue}.
 */
export type InferInputs<I extends readonly FieldDescriptor[]> = {
  [D in I[number] as D['key']]: InferFieldValue<D>;
};

/**
 * Map a state descriptor to the value type at a given bar (`null` during warm-up).
 */
export type InferStateValue<D extends StateFieldDescriptor> = D extends NumberStateFieldDescriptor
  ? number | null
  : D extends EnumStateFieldDescriptor<infer O>
    ? O[number]['value'] | null
    : never;

/**
 * One row of an indicator's output, aligned to a single candle by `time`.
 */
export type InferStateRow<S extends readonly StateFieldDescriptor[]> = { time: number } & {
  [D in S[number] as D['key']]: InferStateValue<D>;
};

/**
 * The output series an indicator's `compute` returns — one row per input candle.
 */
export type InferStateSeries<S extends readonly StateFieldDescriptor[]> = InferStateRow<S>[];

/**
 * One row of a computed indicator series, aligned to a candle by `time`.
 *
 * Each remaining key is a `state` descriptor's `key` carrying its per-bar value (or `null` during warm-up / non-firing bars).
 */
export type IndicatorStatePoint = { time: number } & Record<string, unknown>;

/**
 * The transport shape returned by the indicator compute service.
 *
 * Carries the indicator key, the definition's `version` at compute time, the period the candles were sampled at, and the aligned state series.
 */
export interface IndicatorComputeResult {
  /** The indicator that produced the result. */
  indicatorKey: string;
  /** The `definition.version` at compute time. */
  version: number;
  /** The period the candles were sampled at. */
  period: Period;
  /** The aligned state series, one row per included candle. */
  state: IndicatorStatePoint[];
}

/**
 * The JSON-serializable metadata declaring an indicator.
 *
 * Carries the input/state schema, the asset classes the indicator applies to, and a `version` consumers (e.g. attached profile instances) record so configured inputs can be migrated when the schema evolves.
 */
export interface IndicatorDefinition<
  I extends readonly FieldDescriptor[] = readonly FieldDescriptor[],
  S extends readonly StateFieldDescriptor[] = readonly StateFieldDescriptor[],
> {
  /** Stable lookup id — e.g. `'sma'`. */
  key: string;
  /** Human-readable name. */
  name: string;
  /** Free-text description. */
  description: string;
  /** Schema version — incremented when the input/state shape changes. */
  version: number;
  /** Asset classes the indicator is valid for. */
  appliesTo: SymbolType[];
  /** Input parameter descriptors. */
  inputs: I;
  /** Per-bar state field descriptors. */
  state: S;
}

/**
 * An indicator module — the {@link IndicatorDefinition} plus a pure `compute` function.
 *
 * `compute` is **pure** (no I/O, no shared mutable state) and uses **no look-ahead** — the state at bar *t* depends only on candles `≤ t`.
 *
 * It returns one state row per input candle, with state fields `null` during warm-up.
 *
 * When the input is shorter than the indicator's warm-up needs, the whole series is all-`null` (silent — no error).
 */
export interface IndicatorModule<
  I extends readonly FieldDescriptor[] = readonly FieldDescriptor[],
  S extends readonly StateFieldDescriptor[] = readonly StateFieldDescriptor[],
> {
  /** The indicator's serializable metadata. */
  definition: IndicatorDefinition<I, S>;
  /** Pure compute over a candle series. */
  compute: (inputs: InferInputs<I>, candles: Candle[]) => InferStateSeries<S>;
}
