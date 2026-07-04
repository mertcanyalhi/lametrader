import type {
  Candle,
  FieldDescriptor,
  IndicatorDefinition,
  IndicatorModule,
  InferInputs,
  InferStateSeries,
  StateFieldDescriptor,
  SymbolType,
} from '@lametrader/core';
import { SymbolType as ST } from '@lametrader/core';

/**
 * Every {@link SymbolType} value — used as the default `appliesTo` for indicators that don't narrow.
 */
const ALL_SYMBOL_TYPES: SymbolType[] = [ST.Crypto, ST.Stock, ST.Fund, ST.Fx];

/**
 * The spec an indicator author passes to {@link defineIndicator}.
 *
 * Identical to {@link IndicatorDefinition} except that `appliesTo` is optional (it defaults to every {@link SymbolType}), plus the `compute` function.
 */
export interface DefineIndicatorSpec<
  I extends readonly FieldDescriptor[],
  S extends readonly StateFieldDescriptor[],
> extends Omit<IndicatorDefinition<I, S>, 'appliesTo'> {
  /** Asset classes this indicator is valid for; defaults to every `SymbolType` when omitted. */
  appliesTo?: SymbolType[];
  /** Pure per-candle compute returning an aligned state series. */
  compute: (inputs: InferInputs<I>, candles: Candle[]) => InferStateSeries<S>;
  /** Short, user-readable summary of a configured instance — e.g. `"SMA 14 close"`. */
  summary: (inputs: InferInputs<I>) => string;
  /** Optional warm-up bar count — forwarded to the module so the compute service can scope candle loads. */
  warmup?: (inputs: InferInputs<I>) => number;
}

/**
 * Pure factory: construct an {@link IndicatorModule} from a spec.
 *
 * Defaults `appliesTo` to every {@link SymbolType} when omitted, so authors only narrow when an indicator requires a specific candle shape (e.g. volume).
 *
 * No side effects — callers register the returned module into an {@link IndicatorRegistry} explicitly.
 */
export function defineIndicator<
  I extends readonly FieldDescriptor[],
  S extends readonly StateFieldDescriptor[],
>(spec: DefineIndicatorSpec<I, S>): IndicatorModule<I, S> {
  const { compute, summary, warmup, appliesTo, ...definitionWithoutAppliesTo } = spec;
  return {
    definition: {
      ...definitionWithoutAppliesTo,
      appliesTo: appliesTo ?? ALL_SYMBOL_TYPES,
    },
    compute,
    summary,
    warmup,
  };
}
