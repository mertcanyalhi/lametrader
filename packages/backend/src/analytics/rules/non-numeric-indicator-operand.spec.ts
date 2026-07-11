import {
  type Candle,
  LeafConditionFamily,
  OperandKind,
  Period,
  type StateLeafCondition,
  StateOperator,
  StateValueType,
  SymbolType,
} from '@lametrader/core';
import { InMemoryCandleRepository } from '../../market/persistence/in-memory-candle.repository.js';
import { InMemoryWatchlistRepository } from '../../market/persistence/in-memory-watchlist.repository.js';
import { IndicatorService } from '../indicators/indicator.service.js';
import { IndicatorRegistry } from '../indicators/indicator-registry.js';
import { volumeWeightedMovingAverage } from '../indicators/vwma.js';
import { buildEvaluationContext } from './evaluation-context.js';
import type { EvaluationContext } from './evaluation-context.types.js';
import { IndicatorSeriesStore } from './indicator-series-store.js';
import { evaluateState } from './operators/state.js';

/**
 * These tests exercise the #562 gap: a non-numeric (`Bool` / enum-`String`)
 * `IndicatorRef` state field must resolve through the SAME projected series path
 * as a numeric one, so `latest` and `prev` stay consistent and the state
 * operators fire. They drive the real {@link IndicatorSeriesStore} +
 * {@link volumeWeightedMovingAverage} compute (uniform volume ⇒ the VWMA line is
 * the plain SMA of the close), so the projection is proven end-to-end at the
 * unit tier rather than through a fake.
 */

const SYMBOL = 'BTC';
const PERIOD = Period.OneMinute;
const PROFILE = 'profile-1';
const INSTANCE_ID = 'vwma-3-inst';

/** Build a uniform crypto candle closing at `close` with volume 1 (equal weights). */
const candle = (time: number, close: number): Candle => ({
  type: SymbolType.Crypto,
  time,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1,
  quoteVolume: close,
  trades: 1,
});

/**
 * Build an evaluation context reading a `vwma` instance over `closes`, bounded so
 * the newest candle is the latest projected point.
 */
const seed = async (closes: number[]): Promise<EvaluationContext> => {
  const repo = new InMemoryCandleRepository();
  const bars = closes.map((c, i) => candle((i + 1) * 60_000, c));
  await repo.save(SYMBOL, PERIOD, bars);

  const watchlist = new InMemoryWatchlistRepository([
    { id: SYMBOL, type: SymbolType.Crypto, description: 'BTC', exchange: 'X', periods: [PERIOD] },
  ]);
  const indicators = new IndicatorRegistry();
  indicators.register(volumeWeightedMovingAverage);
  const indicatorService = new IndicatorService(indicators, watchlist, repo);

  const indicatorStore = new IndicatorSeriesStore(repo, indicatorService);
  indicatorStore.register({
    instanceId: INSTANCE_ID,
    indicatorKey: 'vwma',
    inputs: { length: 3, source: 'close', multiplier: 1, direction: 'both' },
  });

  return buildEvaluationContext({
    symbolId: SYMBOL,
    profileId: PROFILE,
    candleRepository: repo,
    indicatorStore,
    before: (closes.length + 1) * 60_000,
    getSymbolState: () => null,
    getGlobalState: () => null,
  });
};

/** The `above` Bool state field of the vwma instance. */
const aboveRef = {
  kind: OperandKind.IndicatorRef as const,
  instanceId: INSTANCE_ID,
  stateKey: 'above',
  valueType: StateValueType.Bool,
};

/** The `signal` enum-String state field of the vwma instance. */
const signalRef = {
  kind: OperandKind.IndicatorRef as const,
  instanceId: INSTANCE_ID,
  stateKey: 'signal',
  valueType: StateValueType.String,
};

/** A state leaf `<left> <op> <right>` at the 1m interval. */
const stateLeaf = (
  left: StateLeafCondition['left'],
  operator: StateOperator,
  right: StateLeafCondition['right'],
): StateLeafCondition => ({
  family: LeafConditionFamily.State,
  operator,
  left,
  right,
  interval: PERIOD,
});

const boolLiteral = (value: boolean) => ({
  kind: OperandKind.Literal as const,
  value: { type: StateValueType.Bool as const, value },
});
const stringLiteral = (value: string) => ({
  kind: OperandKind.Literal as const,
  value: { type: StateValueType.String as const, value },
});

describe('non-numeric IndicatorRef resolution', () => {
  it('resolveLatest wraps a Bool state field as a tagged Bool StateValue', async () => {
    // closes [10,10,10,11]: newest VWMA(3)=10.333, close 11 > line ⇒ above=true.
    const ctx = await seed([10, 10, 10, 11]);
    expect(await ctx.resolveLatest(aboveRef, PERIOD)).toEqual({
      type: StateValueType.Bool,
      value: true,
    });
  });

  it('resolveLatest wraps an enum-String state field as a tagged String StateValue', async () => {
    // closes [10,10,10,11]: newest bar is an up-cross ⇒ signal='buy'.
    const ctx = await seed([10, 10, 10, 11]);
    expect(await ctx.resolveLatest(signalRef, PERIOD)).toEqual({
      type: StateValueType.String,
      value: 'buy',
    });
  });

  it('resolvePrev derives the second-newest projected Bool point from the series (no fallback hook)', async () => {
    // closes [10,10,10,11,9]: above is idx2=false, idx3=true, idx4=false —
    // latest false, prev the idx3 true point, straight off the series walk.
    const ctx = await seed([10, 10, 10, 11, 9]);
    expect({
      latest: await ctx.resolveLatest(aboveRef, PERIOD),
      prev: await ctx.resolvePrev(aboveRef, PERIOD),
    }).toEqual({
      latest: { type: StateValueType.Bool, value: false },
      prev: { type: StateValueType.Bool, value: true },
    });
  });

  it('fires Equals(Bool, true) when the current field is true', async () => {
    const ctx = await seed([10, 10, 10, 11]);
    expect(
      await evaluateState(stateLeaf(aboveRef, StateOperator.Equals, boolLiteral(true)), ctx),
    ).toEqual(true);
  });

  it('does not fire Equals(Bool, true) when the current field is false', async () => {
    // closes [10,10,10,9]: newest VWMA(3)=9.667, close 9 < line ⇒ above=false.
    const ctx = await seed([10, 10, 10, 9]);
    expect(
      await evaluateState(stateLeaf(aboveRef, StateOperator.Equals, boolLiteral(true)), ctx),
    ).toEqual(false);
  });

  it('evaluates Equals / NotEquals on an enum-String field against a string literal', async () => {
    const ctx = await seed([10, 10, 10, 11]); // signal='buy'
    expect({
      equalsBuy: await evaluateState(
        stateLeaf(signalRef, StateOperator.Equals, stringLiteral('buy')),
        ctx,
      ),
      equalsSell: await evaluateState(
        stateLeaf(signalRef, StateOperator.Equals, stringLiteral('sell')),
        ctx,
      ),
      notEqualsSell: await evaluateState(
        stateLeaf(signalRef, StateOperator.NotEquals, stringLiteral('sell')),
        ctx,
      ),
    }).toEqual({ equalsBuy: true, equalsSell: false, notEqualsSell: true });
  });

  it('resolves latest AND prev consistently for ChangesTo / ChangesFrom on a Bool field', async () => {
    // closes [10,10,10,9,12]: above idx3=false → idx4=true (a false→true step).
    const ctx = await seed([10, 10, 10, 9, 12]);
    expect({
      changesToTrue: await evaluateState(
        stateLeaf(aboveRef, StateOperator.ChangesTo, boolLiteral(true)),
        ctx,
      ),
      changesFromTrue: await evaluateState(
        stateLeaf(aboveRef, StateOperator.ChangesFrom, boolLiteral(true)),
        ctx,
      ),
    }).toEqual({ changesToTrue: true, changesFromTrue: false });
  });

  it('resolves latest AND prev consistently for ChangesTo / ChangesFrom on an enum-String field', async () => {
    // closes [10,10,10,11,9]: signal buy@idx3 → sell@idx4 (prev='buy', latest='sell').
    const ctx = await seed([10, 10, 10, 11, 9]);
    expect({
      changesToSell: await evaluateState(
        stateLeaf(signalRef, StateOperator.ChangesTo, stringLiteral('sell')),
        ctx,
      ),
      changesFromBuy: await evaluateState(
        stateLeaf(signalRef, StateOperator.ChangesFrom, stringLiteral('buy')),
        ctx,
      ),
    }).toEqual({ changesToSell: true, changesFromBuy: true });
  });
});
