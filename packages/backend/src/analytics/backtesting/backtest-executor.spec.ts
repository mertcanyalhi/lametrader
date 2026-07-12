import {
  type BacktestCommission,
  BacktestExitReason,
  type BacktestSignal,
  type BacktestStrategyExit,
  BacktestThresholdKind,
  type BacktestTrade,
  type Candle,
  type RuleEventEntry,
  RuleEventType,
  StateScope,
  type StateValue,
  StateValueType,
  SymbolType,
} from '@lametrader/core';
import { BacktestExecutor, summarizeTrades } from './backtest-executor.js';

/** A bool state value. */
const bool = (value: boolean): StateValue => ({ type: StateValueType.Bool, value });

/** A crypto candle with explicit OHLC. */
const candle = (time: number, open: number, high: number, low: number, close: number): Candle => ({
  type: SymbolType.Crypto,
  time,
  open,
  high,
  low,
  close,
  volume: 1,
  quoteVolume: 1,
  trades: 1,
});

/** A flat crypto candle whose OHLC are all `price`. */
const flat = (time: number, price: number): Candle => candle(time, price, price, price, price);

/** A symbol-scoped `StateSet` run event writing `key = value`. */
const stateSet = (key: string, value: StateValue): RuleEventEntry => ({
  type: RuleEventType.StateSet,
  ts: 0,
  ruleId: 'rule-1',
  symbolId: 'crypto:BTCUSDT',
  scope: StateScope.Symbol,
  key,
  value,
});

/** An entry signal firing when `long` becomes `true`. */
const entrySignal: BacktestSignal = { key: 'long', value: bool(true) };

/** A strategy over the shared entry signal plus the given exit definition. */
const strategyWith = (exit: BacktestStrategyExit) => ({ entry: { signal: entrySignal }, exit });

/**
 * Feed one bar through the executor, stamping its fills at the bar's **close**
 * instant — its open `time` plus a fixed 100ms bar — so `entryTs` / `exitTs`
 * assert against the close, not the open `time`.
 */
const step = (
  executor: BacktestExecutor,
  bar: Candle,
  events: readonly RuleEventEntry[] = [],
): void => executor.processStep(bar, events, bar.time + 100);

/** Zero commission — clean sizing. */
const noCommission: BacktestCommission = {};

describe('BacktestExecutor entry and sizing', () => {
  it('opens a position at the producing candle close with cash-constrained quantity when an entry signal fires while flat', () => {
    const executor = new BacktestExecutor(
      strategyWith({ profitTarget: { kind: BacktestThresholdKind.Fixed, amount: 1000 } }),
      { initialCapital: 1020, commission: { rate: 2 } },
    );

    step(executor, flat(1000, 100), [stateSet('long', bool(true))]);

    expect(executor.result()).toEqual({
      trades: [],
      openPosition: {
        entryTs: 1100,
        entryPrice: 100,
        quantity: 10,
        entryCommission: 20,
        unrealizedPnl: -20,
      },
      summary: summarizeTrades([], 1020),
    });
  });

  it('ignores an entry signal while a position is already open', () => {
    const executor = new BacktestExecutor(
      strategyWith({ signal: { key: 'short', value: bool(true) } }),
      {
        initialCapital: 10_000,
        commission: noCommission,
      },
    );

    step(executor, flat(1000, 100), [stateSet('long', bool(true))]);
    step(executor, flat(2000, 200), [stateSet('long', bool(false)), stateSet('long', bool(true))]);

    expect(executor.result()).toEqual({
      trades: [],
      openPosition: {
        entryTs: 1100,
        entryPrice: 100,
        quantity: 100,
        entryCommission: 0,
        unrealizedPnl: 10_000,
      },
      summary: summarizeTrades([], 10_000),
    });
  });

  it('re-enters after a level exit when the entry signal is re-emitted while flat (the edge is re-armed on close)', () => {
    // A profit-target exit closes without any state key changing. The entry key
    // is therefore still `true` after the exit, so re-arming edge detection on
    // close is what lets the re-emitted `long=true` open a fresh position.
    const executor = new BacktestExecutor(
      strategyWith({ profitTarget: { kind: BacktestThresholdKind.Fixed, amount: 10 } }),
      { initialCapital: 10_000, commission: noCommission },
    );

    step(executor, flat(1000, 100), [stateSet('long', bool(true))]);
    step(executor, candle(2000, 100, 120, 100, 100), []);
    step(executor, flat(3000, 100), [stateSet('long', bool(true))]);

    const firstTrade: BacktestTrade = {
      entryTs: 1100,
      exitTs: 2100,
      entryPrice: 100,
      exitPrice: 110,
      quantity: 100,
      commission: 0,
      pnl: 1000,
      roiPct: 10,
      exitReason: BacktestExitReason.ProfitTarget,
    };
    expect(executor.result()).toEqual({
      trades: [firstTrade],
      openPosition: {
        entryTs: 3100,
        entryPrice: 100,
        quantity: 110,
        entryCommission: 0,
        unrealizedPnl: 0,
      },
      summary: summarizeTrades([firstTrade], 10_000),
    });
  });

  it('re-enters after a stop-loss when the entry signal is still active on a later flat bar', () => {
    const executor = new BacktestExecutor(
      strategyWith({ stopLoss: { kind: BacktestThresholdKind.Percentage, amount: 5 } }),
      { initialCapital: 10_000, commission: noCommission },
    );

    step(executor, flat(1000, 100), [stateSet('long', bool(true))]); // BUY @100
    step(executor, candle(2000, 100, 100, 90, 92)); // low 90 < stop 95 -> SELL @95
    step(executor, flat(3000, 100), [stateSet('long', bool(true))]); // re-enter while flat

    const stopped: BacktestTrade = {
      entryTs: 1100,
      exitTs: 2100,
      entryPrice: 100,
      exitPrice: 95,
      quantity: 100,
      commission: 0,
      pnl: -500,
      roiPct: -5,
      exitReason: BacktestExitReason.StopLoss,
    };
    expect(executor.result()).toEqual({
      trades: [stopped],
      openPosition: {
        entryTs: 3100,
        entryPrice: 100,
        quantity: 95,
        entryCommission: 0,
        unrealizedPnl: 0,
      },
      summary: summarizeTrades([stopped], 10_000),
    });
  });

  it('still ignores a repeated entry signal within the same open position (edge dedup while holding)', () => {
    // The re-arm is on close only; while a position is open the flat-guard plus
    // edge dedup keep a re-emitted entry signal from doing anything.
    const executor = new BacktestExecutor(
      strategyWith({ profitTarget: { kind: BacktestThresholdKind.Fixed, amount: 1000 } }),
      { initialCapital: 10_000, commission: noCommission },
    );

    step(executor, flat(1000, 100), [stateSet('long', bool(true))]);
    step(executor, flat(2000, 100), [stateSet('long', bool(true))]);
    step(executor, flat(3000, 100), [stateSet('long', bool(true))]);

    expect(executor.result()).toEqual({
      trades: [],
      openPosition: {
        entryTs: 1100,
        entryPrice: 100,
        quantity: 100,
        entryCommission: 0,
        unrealizedPnl: 0,
      },
      summary: summarizeTrades([], 10_000),
    });
  });

  it('re-arms a persistent exit signal across a round trip so the next position still exits on it', () => {
    // Exit signal is on a different key (`flat`) than entry (`long`), so the
    // exit value can persist across the round trip. Entry re-arm is taken out of
    // the picture by cycling `long` down-then-up; only the never-cycled `flat`
    // key depends on the close re-arming edge detection.
    const executor = new BacktestExecutor(
      strategyWith({ signal: { key: 'flat', value: bool(true) } }),
      { initialCapital: 10_000, commission: noCommission },
    );

    step(executor, flat(1000, 100), [stateSet('long', bool(true))]); // BUY
    step(executor, flat(2000, 100), [stateSet('flat', bool(true))]); // SELL (signal)
    step(executor, flat(3000, 100), [stateSet('long', bool(false))]); // cycle entry down
    step(executor, flat(4000, 100), [stateSet('long', bool(true))]); // BUY again (fresh edge)
    step(executor, flat(5000, 100), [stateSet('flat', bool(true))]); // SELL again — only if re-armed

    const trade = (entryTs: number, exitTs: number): BacktestTrade => ({
      entryTs,
      exitTs,
      entryPrice: 100,
      exitPrice: 100,
      quantity: 100,
      commission: 0,
      pnl: 0,
      roiPct: 0,
      exitReason: BacktestExitReason.Signal,
    });
    const trades = [trade(1100, 2100), trade(4100, 5100)];
    expect(executor.result()).toEqual({ trades, summary: summarizeTrades(trades, 10_000) });
  });
});

describe('BacktestExecutor exits', () => {
  it('closes at the producing candle close with exitReason Signal when an exit signal fires', () => {
    const executor = new BacktestExecutor(
      strategyWith({ signal: { key: 'short', value: bool(true) } }),
      {
        initialCapital: 10_000,
        commission: noCommission,
      },
    );

    step(executor, flat(1000, 100), [stateSet('long', bool(true))]);
    step(executor, flat(2000, 130), [stateSet('short', bool(true))]);

    expect(executor.result().trades).toEqual([
      {
        entryTs: 1100,
        exitTs: 2100,
        entryPrice: 100,
        exitPrice: 130,
        quantity: 100,
        commission: 0,
        pnl: 3000,
        roiPct: 30,
        exitReason: BacktestExitReason.Signal,
      },
    ]);
  });

  it('closes at a Fixed profit-target level with exitReason ProfitTarget when a candle high reaches it', () => {
    const executor = new BacktestExecutor(
      strategyWith({ profitTarget: { kind: BacktestThresholdKind.Fixed, amount: 20 } }),
      { initialCapital: 10_000, commission: noCommission },
    );

    step(executor, flat(1000, 100), [stateSet('long', bool(true))]);
    step(executor, candle(2000, 110, 125, 105, 110), []);

    expect(executor.result().trades).toEqual([
      {
        entryTs: 1100,
        exitTs: 2100,
        entryPrice: 100,
        exitPrice: 120,
        quantity: 100,
        commission: 0,
        pnl: 2000,
        roiPct: 20,
        exitReason: BacktestExitReason.ProfitTarget,
      },
    ]);
  });

  it('closes at a Percentage profit-target level with exitReason ProfitTarget when a candle high reaches it', () => {
    const executor = new BacktestExecutor(
      strategyWith({ profitTarget: { kind: BacktestThresholdKind.Percentage, amount: 25 } }),
      { initialCapital: 10_000, commission: noCommission },
    );

    step(executor, flat(1000, 100), [stateSet('long', bool(true))]);
    step(executor, candle(2000, 120, 130, 110, 120), []);

    expect(executor.result().trades).toEqual([
      {
        entryTs: 1100,
        exitTs: 2100,
        entryPrice: 100,
        exitPrice: 125,
        quantity: 100,
        commission: 0,
        pnl: 2500,
        roiPct: 25,
        exitReason: BacktestExitReason.ProfitTarget,
      },
    ]);
  });

  it('closes at a Fixed stop-loss level with exitReason StopLoss when a candle low reaches it', () => {
    const executor = new BacktestExecutor(
      strategyWith({ stopLoss: { kind: BacktestThresholdKind.Fixed, amount: 20 } }),
      { initialCapital: 10_000, commission: noCommission },
    );

    step(executor, flat(1000, 100), [stateSet('long', bool(true))]);
    step(executor, candle(2000, 100, 100, 75, 100), []);

    expect(executor.result().trades).toEqual([
      {
        entryTs: 1100,
        exitTs: 2100,
        entryPrice: 100,
        exitPrice: 80,
        quantity: 100,
        commission: 0,
        pnl: -2000,
        roiPct: -20,
        exitReason: BacktestExitReason.StopLoss,
      },
    ]);
  });

  it('closes at a Percentage stop-loss level with exitReason StopLoss when a candle low reaches it', () => {
    const executor = new BacktestExecutor(
      strategyWith({ stopLoss: { kind: BacktestThresholdKind.Percentage, amount: 10 } }),
      { initialCapital: 10_000, commission: noCommission },
    );

    step(executor, flat(1000, 100), [stateSet('long', bool(true))]);
    step(executor, candle(2000, 100, 100, 85, 100), []);

    expect(executor.result().trades).toEqual([
      {
        entryTs: 1100,
        exitTs: 2100,
        entryPrice: 100,
        exitPrice: 90,
        quantity: 100,
        commission: 0,
        pnl: -1000,
        roiPct: -10,
        exitReason: BacktestExitReason.StopLoss,
      },
    ]);
  });

  it('does not check the levels on the entry candle and applies them from the next candle onward', () => {
    const executor = new BacktestExecutor(
      strategyWith({ stopLoss: { kind: BacktestThresholdKind.Fixed, amount: 5 } }),
      { initialCapital: 10_000, commission: noCommission },
    );

    step(executor, candle(1000, 100, 100, 50, 100), [stateSet('long', bool(true))]);
    step(executor, candle(2000, 100, 100, 90, 100), []);

    expect(executor.result().trades).toEqual([
      {
        entryTs: 1100,
        exitTs: 2100,
        entryPrice: 100,
        exitPrice: 95,
        quantity: 100,
        commission: 0,
        pnl: -500,
        roiPct: -5,
        exitReason: BacktestExitReason.StopLoss,
      },
    ]);
  });

  it('resolves the stop-loss first when one candle spans both levels', () => {
    const executor = new BacktestExecutor(
      strategyWith({
        profitTarget: { kind: BacktestThresholdKind.Fixed, amount: 10 },
        stopLoss: { kind: BacktestThresholdKind.Fixed, amount: 10 },
      }),
      { initialCapital: 10_000, commission: noCommission },
    );

    step(executor, flat(1000, 100), [stateSet('long', bool(true))]);
    step(executor, candle(2000, 100, 120, 80, 100), []);

    expect(executor.result().trades).toEqual([
      {
        entryTs: 1100,
        exitTs: 2100,
        entryPrice: 100,
        exitPrice: 90,
        quantity: 100,
        commission: 0,
        pnl: -1000,
        roiPct: -10,
        exitReason: BacktestExitReason.StopLoss,
      },
    ]);
  });
});

describe('BacktestExecutor commissions and lifecycle', () => {
  it('charges commission per fill and reports pnl net of both fills', () => {
    const executor = new BacktestExecutor(
      strategyWith({ signal: { key: 'short', value: bool(true) } }),
      {
        initialCapital: 1015,
        commission: { rate: 1, fixed: 5 },
      },
    );

    step(executor, flat(1000, 100), [stateSet('long', bool(true))]);
    step(executor, flat(2000, 200), [stateSet('short', bool(true))]);

    expect(executor.result().trades).toEqual([
      {
        entryTs: 1100,
        exitTs: 2100,
        entryPrice: 100,
        exitPrice: 200,
        quantity: 10,
        commission: 40,
        pnl: 960,
        roiPct: expect.closeTo(94.5812808, 5),
        exitReason: BacktestExitReason.Signal,
      },
    ]);
  });

  it('nets a same-candle entry-then-exit to minus the commissions with zero gross', () => {
    const executor = new BacktestExecutor(
      strategyWith({ signal: { key: 'short', value: bool(true) } }),
      {
        initialCapital: 1015,
        commission: { rate: 1, fixed: 5 },
      },
    );

    step(executor, flat(1000, 100), [stateSet('long', bool(true)), stateSet('short', bool(true))]);

    expect(executor.result().trades).toEqual([
      {
        entryTs: 1100,
        exitTs: 1100,
        entryPrice: 100,
        exitPrice: 100,
        quantity: 10,
        commission: 30,
        pnl: -30,
        roiPct: expect.closeTo(-2.955665, 5),
        exitReason: BacktestExitReason.Signal,
      },
    ]);
  });

  it('keeps a position open at the end of the replay and reports its unrealized pnl without appending a trade', () => {
    const executor = new BacktestExecutor(
      strategyWith({ signal: { key: 'short', value: bool(true) } }),
      {
        initialCapital: 10_000,
        commission: noCommission,
      },
    );

    step(executor, flat(1000, 100), [stateSet('long', bool(true))]);
    step(executor, flat(2000, 150), []);

    expect(executor.result()).toEqual({
      trades: [],
      openPosition: {
        entryTs: 1100,
        entryPrice: 100,
        quantity: 100,
        entryCommission: 0,
        unrealizedPnl: 5000,
      },
      summary: summarizeTrades([], 10_000),
    });
  });

  it('compounds equity so the second trade entry notional derives from the first trade proceeds', () => {
    const executor = new BacktestExecutor(
      strategyWith({ profitTarget: { kind: BacktestThresholdKind.Percentage, amount: 100 } }),
      { initialCapital: 10_000, commission: noCommission },
    );

    step(executor, flat(1000, 100), [stateSet('long', bool(true))]);
    step(executor, candle(2000, 100, 250, 100, 100), []);
    step(executor, flat(3000, 100), [stateSet('long', bool(false)), stateSet('long', bool(true))]);
    step(executor, candle(4000, 100, 250, 100, 100), []);

    expect(executor.result().trades).toEqual([
      {
        entryTs: 1100,
        exitTs: 2100,
        entryPrice: 100,
        exitPrice: 200,
        quantity: 100,
        commission: 0,
        pnl: 10_000,
        roiPct: 100,
        exitReason: BacktestExitReason.ProfitTarget,
      },
      {
        entryTs: 3100,
        exitTs: 4100,
        entryPrice: 100,
        exitPrice: 200,
        quantity: 200,
        commission: 0,
        pnl: 20_000,
        roiPct: 100,
        exitReason: BacktestExitReason.ProfitTarget,
      },
    ]);
  });
});

describe('summarizeTrades', () => {
  /** A closed trade with the given pnl / roiPct and a duration of `days` days. */
  const trade = (pnl: number, roiPct: number, days: number): BacktestTrade => ({
    entryTs: 0,
    exitTs: days * 86_400_000,
    entryPrice: 100,
    exitPrice: 100,
    quantity: 1,
    commission: 0,
    pnl,
    roiPct,
    exitReason: BacktestExitReason.Signal,
  });

  it('computes every metric over closed trades, counting a zero-pnl trade in neither bucket', () => {
    const trades = [trade(100, 10, 1), trade(-50, -5, 2), trade(0, 0, 3)];

    expect(summarizeTrades(trades, 1000)).toEqual({
      totalPnl: 50,
      roiPct: 5,
      avgPnlPerTrade: expect.closeTo(16.6666667, 5),
      tradeCount: 3,
      winners: 1,
      losers: 1,
      avgRoiPct: expect.closeTo(1.6666667, 5),
      avgDaysInTrade: 2,
    });
  });

  it('summarizes an empty set of closed trades as all zeros', () => {
    expect(summarizeTrades([], 1000)).toEqual({
      totalPnl: 0,
      roiPct: 0,
      avgPnlPerTrade: 0,
      tradeCount: 0,
      winners: 0,
      losers: 0,
      avgRoiPct: 0,
      avgDaysInTrade: 0,
    });
  });
});
