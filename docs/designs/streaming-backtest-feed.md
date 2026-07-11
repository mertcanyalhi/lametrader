# Streaming candle feed with a bounded lookback buffer for backtest replay

- Status: superseded by ADR-0022 (in-memory preload replaces the sliding-window streaming direction; the run stream was removed) — see issue #565
- Scope: `BacktestReplayService` and the candle-feed / lookback plumbing it drives

## Problem

`BacktestReplayService.replay` today loads the whole run window eagerly and then pages the shared candle store on every drain.
Two independent costs make a long, fine-grained run infeasible.

**Memory.**
`loadFeed` calls `this.candles.range(symbolId, period, start, end)` once per active period and materializes every candle in `[start, end)` into a single `FeedCandle[]` (`backtest-replay.service.ts`, `loadFeed` → `orderBacktestFeed`).
A 10-year 1-minute window is ~5.26M candles; at ~200 bytes per V8 candle object that is ~1 GB for the 1m series alone, before the engine wiring.
The run OOMs on `loadFeed` before it processes a single bar — the whole window is resident whether or not the current position needs it.

**Per-bar I/O under contention.**
Inside each drain the bar-series pagers (`PagedBarSeriesView`, page size 64) and the indicator pagers (`PagedIndicatorSeriesView`, page size 64, one `IndicatorService.compute` per page) read the candle store live.
Profiling against a Mongo-backed store (via temporary per-candle read/compute counters) shows individual `range` / `latestN` round-trips at ~10 ms under write-path contention (the live poll loop shares the collection), and a coarse indicator (e.g. an SMA on the 1h series) is recomputed on **every fine 1m bar**: each drain rebuilds a fresh evaluation context (`wireRuleEngine` → `buildContext`), and the shared compute memo (ADR-0021) is scoped to a single observation, so it dedupes a bar's fan-out events but never spans candles.
At ~5.26M drains and several candle reads per drain, that is tens of millions of Mongo round-trips — tens of hours of pure I/O wait, independent of CPU.

**What is in scope.**
This design removes both storage costs: it makes per-candle cost near-zero (no per-bar Mongo I/O) and keeps memory bounded independent of the backtest span.
It does **not** remove the ~5.26M-drain CPU wall — that is a separate problem, named but out of scope in section 7.

**What stays fixed.**
Ordering, determinism, and byte-identical results.
The streamed path must produce exactly the events, trades, and summary the current Mongo-backed path produces for the same fixture; the streaming is an I/O and memory optimization, never a semantic change.

> All TypeScript in this document is **illustrative, not to be committed** — it sketches shapes and algorithms to make the design concrete, not a diff.

---

## 1. Chunked / cursor streaming that preserves ordering

The feed is the k-way merge of each active period's candles, ordered exactly as `orderBacktestFeed` orders them today: by **completion time** `candle.time + periodMillis(period)`, ties broken **finest-period-first** (smaller `periodMillis` first).
`orderBacktestFeed` does this by materializing every candle and sorting; `streamFeed` reproduces the identical order without ever holding more than a read-ahead chunk per period in memory.

**Per-period cursor.**
Each active period gets an async cursor that pulls candles ascending by `time` in fixed-size chunks via the existing `CandleRepository.range(symbolId, period, from, to, limit)` — newest data need not be loaded until the merge reaches it.

```ts
// Illustrative, not to be committed.

/** How many candles one period cursor pulls per repository round-trip. */
const FEED_CHUNK = 4096;

/** An ascending, chunked cursor over one period's candles in [start, end). */
class PeriodFeedCursor {
  private buffer: Candle[] = [];
  private index = 0;
  private nextFrom: number;
  private exhausted = false;

  constructor(
    private readonly candles: CandleRepository,
    private readonly symbolId: string,
    private readonly period: Period,
    start: number,
    private readonly end: number,
  ) {
    this.nextFrom = start;
  }

  /** The next candle without consuming it, refilling the buffer on demand. */
  async peek(): Promise<Candle | undefined> {
    if (this.index >= this.buffer.length) await this.refill();
    return this.buffer[this.index];
  }

  /** Consume and return the next candle. */
  async take(): Promise<Candle | undefined> {
    const candle = await this.peek();
    if (candle !== undefined) this.index += 1;
    return candle;
  }

  private async refill(): Promise<void> {
    this.buffer = [];
    this.index = 0;
    while (!this.exhausted && this.buffer.length === 0) {
      // range() is ascending by time and [from, to); limit caps the chunk.
      const page = await this.candles.range(
        this.symbolId, this.period, this.nextFrom, this.end, FEED_CHUNK,
      );
      if (page.length < FEED_CHUNK) this.exhausted = true;
      if (page.length === 0) return;
      this.buffer = page;
      // Next chunk starts strictly after the last candle we just pulled.
      this.nextFrom = page[page.length - 1]!.time + 1;
    }
  }
}
```

**The merge.**
`streamFeed` opens one cursor per period and repeatedly emits the cursor whose head candle has the smallest completion key, breaking ties finest-period-first — the exact comparator `orderBacktestFeed` uses.

```ts
// Illustrative, not to be committed.

/** The completion-time sort key, identical to orderBacktestFeed's comparator. */
function completionKey(candle: Candle, period: Period): [number, number] {
  const pm = periodMillis(period);
  return [candle.time + pm, pm]; // [completionTime, tieBreakByFinestPeriod]
}

async function* streamFeed(
  candles: CandleRepository,
  symbolId: string,
  periods: Period[],
  start: number,
  end: number,
): AsyncGenerator<FeedCandle> {
  const cursors = periods.map(
    (period) => ({ period, cursor: new PeriodFeedCursor(candles, symbolId, period, start, end) }),
  );
  while (true) {
    let best: { period: Period; candle: Candle; key: [number, number] } | undefined;
    for (const { period, cursor } of cursors) {
      const head = await cursor.peek();
      if (head === undefined) continue;
      const key = completionKey(head, period);
      if (best === undefined || lessThan(key, best.key)) {
        best = { period, candle: head, key };
      }
    }
    if (best === undefined) return; // every cursor exhausted
    // Consume the winning cursor's head and emit it.
    const winner = cursors.find((c) => c.period === best!.period)!;
    await winner.cursor.take();
    yield { period: best.period, candle: best.candle };
  }
}

/** Lexicographic compare of [completionTime, periodMillis] — finest period wins ties. */
function lessThan(a: [number, number], b: [number, number]): boolean {
  return a[0] !== b[0] ? a[0] < b[0] : a[1] < b[1];
}
```

**Determinism.**
`range` returns candles ascending by `time`, so each cursor is deterministic; the merge picks the minimum of a fixed comparator over a fixed set of cursors, so the merged order is a total order identical to the sort in `orderBacktestFeed`.
The tie-break is the same secondary key (`periodMillis`), so a coarse bar never leaks its range before the finer bars completing at the same instant — the invariant the completion-time ordering exists to protect.

The correctness obligation is section 8's property test: `streamFeed(...)` collected into an array must `toEqual` `orderBacktestFeed(rangeAll(...))` for any fixture.

---

## 2. Bounded lookback buffer — `deriveMaxLookback`

The window feeder holds `[current − maxLookback(period), current]` candles per period.
`maxLookback(period)` must be derived from the profile **before** the run so the window can never be too small at read time.
It is the deepest number of bars any read during a drain can reach behind the bar under evaluation, per period.

**Two contributors, per period.**

1. **Operator backward-walk depth on a series at that `interval`.**
   - `Moving` walks up to `lookbackBars + 1` points (`operators/moving.ts`): contributes `leaf.lookbackBars + 1`.
   - `Comparison` / `State` are snapshot tests resolved through `asOf` — the latest point at or before the bar: contributes `1`.
   - `Crossing` / `Channel` walk back to the **first non-flat / off-boundary baseline** (`operators/crossing.ts`, `operators/channel.ts`): the depth is data-dependent and **not derivable from config** — this is the crux of change A, handled in section A below.

2. **Indicator warmup at that `interval`.**
   `IndicatorService.compute` loads `module.warmup(inputs)` bars *before* the requested `from` (`indicator.service.ts`: `latestN(symbolId, period, warmupBars, from)`), so an indicator operand walked `k` points back reaches `k + warmup` candles behind the newest.
   `warmup` is a finite bar count (`define-indicator.ts`: `warmup?: (inputs) => number`; SMA / VWMA both `({ length }) => length`).

**The formula.**
For each active `period`, take the max operator walk depth over every rule leaf referencing a series at that interval, add the max indicator warmup over every indicator instance computed at that interval (indicator operands pay both — the walk *and* the warmup behind it), then round up to a page multiple and add one page of safety margin so the pager's page-boundary refetch never underflows.

```ts
// Illustrative, not to be committed.

/** Round a raw bar count up to a whole page, plus one page of safety margin. */
function roundToPage(bars: number): number {
  const PAGE = BAR_SERIES_PAGE_SIZE; // 64, shared with the pagers
  return Math.ceil(bars / PAGE) * PAGE + PAGE;
}

/**
 * The max resident bar count per period, derived from the profile before the run.
 * Returns undefined for a period whose operators have a non-derivable (unbounded)
 * lookback — the caller routes such a profile to the eager path (section A).
 */
function deriveMaxLookback(
  profile: Profile,
  rules: Rule[],
  registry: IndicatorRegistry,
): Map<Period, number> | undefined {
  const perPeriod = new Map<Period, number>();
  const bump = (period: Period, bars: number) =>
    perPeriod.set(period, Math.max(perPeriod.get(period) ?? 0, bars));

  // Operator walk depth, per referenced interval.
  for (const rule of rules) {
    for (const leaf of leavesOf(rule.condition)) {
      const period = leaf.interval ?? rule.trigger; // the leaf's evaluated interval
      const depth = operatorWalkDepth(leaf); // number | undefined
      if (depth === undefined) return undefined; // unbounded operator → not streamable
      bump(period, depth);
    }
  }

  // Indicator warmup, per period the profile computes an instance at.
  // An instance carries no period; it is computed at each of the symbol's active
  // periods (register-indicator-instances.ts), so warmup applies to each.
  for (const instance of profile.indicators) {
    const module = registry.get(instance.indicatorKey);
    const warmup = module?.warmup ? module.warmup(instance.inputs as never) : 0;
    for (const period of activePeriods) bump(period, warmup);
  }

  // Round each period up to a page multiple + margin; guarantee a minimum of one
  // page so even a pure-snapshot profile keeps a page resident.
  for (const [period, bars] of perPeriod) perPeriod.set(period, roundToPage(bars));
  return perPeriod;
}

/** Backward-walk depth of one leaf, or undefined when it is not config-derivable. */
function operatorWalkDepth(leaf: LeafCondition): number | undefined {
  switch (leaf.family) {
    case LeafConditionFamily.Moving:      return leaf.lookbackBars + 1;
    case LeafConditionFamily.Comparison:  return 1;
    case LeafConditionFamily.State:       return 1;
    case LeafConditionFamily.Crossing:    return crossingBound(leaf);  // section A
    case LeafConditionFamily.Channel:     return channelBound(leaf);   // section A
  }
}
```

The `+ warmup` term matters: an SMA-200 operand on the 1h series that a `Moving(lookbackBars=3)` leaf walks needs `3 + 1 + 200` = 204 bars resident on 1h, rounded to `256 + 64 = 320`.
Rounding to the 64 page size keeps the window aligned with the pagers' fetch granularity, and the extra page absorbs the pager stepping one page past the last point it needs before it observes a short page and stops.

---

## 3. `WindowedCandleRepository` — the sliding window *is* the repository

A single in-memory `CandleRepository` holds the current window and serves every read the drain issues.
It implements the same interface `InMemoryCandleRepository` does, so it is a drop-in behind the same `CANDLE_REPOSITORY`-shaped port — but it holds only `[current − maxLookback(period), current]` per period and evicts older candles as the window advances.

```ts
// Illustrative, not to be committed.

/**
 * An in-memory CandleRepository that IS the sliding lookback window. Holds only
 * [current − maxLookback(period), current] per period; older candles are evicted
 * by the WindowFeeder (section 5). save() ingests newly-streamed candles; the
 * read methods answer exactly as InMemoryCandleRepository does, over the resident
 * window. Reads strictly before the resident floor throw LookbackUnderflowError.
 */
class WindowedCandleRepository implements CandleRepository {
  /** Resident candles per `${symbol}|${period}`, ascending by time. */
  private readonly series = new Map<string, Candle[]>();
  /** Oldest time still guaranteed resident per series — the eviction floor. */
  private readonly floor = new Map<string, number>();

  async save(symbolId: string, period: Period, candles: Candle[]): Promise<void> {
    const key = `${symbolId}|${period}`;
    const arr = this.series.get(key) ?? [];
    for (const c of candles) arr.push(c); // feeder appends in ascending order
    this.series.set(key, arr);
  }

  /** Drop candles with time < newFloor; record the floor so reads can guard it. */
  evictBelow(symbolId: string, period: Period, newFloor: number): void {
    const key = `${symbolId}|${period}`;
    const arr = this.series.get(key);
    if (arr) this.series.set(key, arr.filter((c) => c.time >= newFloor));
    this.floor.set(key, newFloor);
  }

  async range(symbolId: string, period: Period, from: number, to: number, limit?: number) {
    this.assertNotBelowFloor(symbolId, period, from);
    const arr = this.series.get(`${symbolId}|${period}`) ?? [];
    const matched = arr.filter((c) => c.time >= from && c.time < to);
    return limit === undefined ? matched : matched.slice(0, limit);
  }

  async latestN(symbolId: string, period: Period, n: number, before = Infinity) {
    const arr = this.series.get(`${symbolId}|${period}`) ?? [];
    const picked = arr.filter((c) => c.time < before).slice(-n).reverse();
    // If the caller asked for n but the window floor could have hidden older
    // candles it needs, that is an underflow, not a short read.
    if (picked.length < n) this.assertWindowCovers(symbolId, period, n, before);
    return picked;
  }

  async latest(symbolId: string, period: Period) {
    const arr = this.series.get(`${symbolId}|${period}`) ?? [];
    return arr.at(-1) ?? null;
  }

  async deleteSymbol(): Promise<void> {/* unused in a single-symbol run */}

  private assertNotBelowFloor(symbolId: string, period: Period, from: number): void {
    const f = this.floor.get(`${symbolId}|${period}`);
    if (f !== undefined && from < f) throw new LookbackUnderflowError(symbolId, period, from, f);
  }
  private assertWindowCovers(/* ... */): void { /* throws LookbackUnderflowError */ }
}
```

**It satisfies every access pattern.**

- `PagedBarSeriesView.backwardWalk` → `latestN(symbol, period, 64, cursor)`, paging strictly within the resident window. ✓
- `PagedIndicatorSeriesView.backwardWalk` → `latestN` for page boundaries, then `IndicatorService.compute`, which itself reads `latestN(warmup, from)` + `range(from, to)`. ✓ (the `+ warmup` term in `deriveMaxLookback` guarantees those warmup bars are resident).
- `IndicatorService.compute` → `latestN` + `range` over its own injected repo — which is now the windowed repo (section 4). ✓
- `FallbackSeriesView` reads `backwardWalk` / `asOf` off the pager, unchanged. ✓
- `latest` for `observedPeriods` / mirror snapshotting. ✓

The one behavioural difference from `InMemoryCandleRepository` is deliberate: a read reaching **before** the resident floor throws `LookbackUnderflowError` rather than silently returning a short result.
Under `deriveMaxLookback` sizing that read is unreachable for a streamable profile; the throw is a correctness assertion, not an expected path (section 8, section A).

---

## 4. Backtest-local `IndicatorService` over the windowed repo

`IndicatorService.compute` reads over **its own injected** `this.candles` (`indicator.service.ts`, constructor `private readonly candles`), not over a repo passed per call.
The production `IndicatorService` is wired in `analytics.module.ts` over `CANDLE_REPOSITORY` (the Mongo store), and `BacktestReplayService` is injected that same shared instance.
So to route indicator reads through the windowed repo, the replay must construct its **own** `IndicatorService` over the windowed repo — the shared one cannot be repointed.

**DI change.**
Inject `IndicatorRegistry` (and `WATCHLIST_REPOSITORY`) into `BacktestReplayService` instead of (or in addition to) the shared `IndicatorService`, and build a run-local service per replay.

```ts
// Illustrative, not to be committed.

// analytics.module.ts — provider wiring for BacktestReplayService.
{
  provide: BacktestReplayService,
  useFactory: (
    candles: CandleRepository,       // shared Mongo store: the streaming SOURCE
    rules: RuleRepository,
    watchlist: WatchlistRepository,
    registry: IndicatorRegistry,     // NEW: to build a run-local IndicatorService
  ) => new BacktestReplayService(candles, rules, watchlist, registry),
  inject: [CANDLE_REPOSITORY, RULE_REPOSITORY, WATCHLIST_REPOSITORY, IndicatorRegistry],
},
```

Inside `replay`, once `maxLookback` is derived and the windowed repo is constructed:

```ts
// Illustrative, not to be committed.

const windowed = new WindowedCandleRepository();
const feeder = new WindowFeeder(this.sourceCandles, windowed, maxLookback, params, periods);
await feeder.seed(); // section 5 — warmup bars resident before the first candle

// A run-local IndicatorService reading the WINDOW, not Mongo. No onState sink:
// the backtest never streams live indicator events.
const localIndicators = new IndicatorService(this.registry, watchedSymbolCache, windowed);

// The series store + engine share the ONE windowed repo and the local service, so
// bar pagers, indicator pagers, and compute all read the same in-memory window.
const indicatorStore = new IndicatorSeriesStore(windowed, localIndicators);
await registerIndicatorInstances({ store: indicatorStore, profiles });

const wired = await wireRuleEngine({
  rules: ruleRepository,
  oncePerBarLatch: new InMemoryOncePerBarLatchStore(),
  state,
  watchlist: this.watchlist,
  notifier: new RecordingNoOpNotifier(),
  eventLog,
  candleRepository: windowed,   // was countingCandles over the shared store
  indicatorStore,
});
```

**One repo, shared everywhere.**
`buildLiveBarSeries` (in `wireRuleEngine`) builds `PagedBarSeriesView`s over `deps.candleRepository`; `IndicatorSeriesStore.series` builds `PagedIndicatorSeriesView`s over the `candles` it was constructed with; `IndicatorService.compute` reads its own `candles`.
All three are now the single `windowed` instance, so every read a drain issues hits the in-memory window — zero Mongo round-trips per drain.

**Watched-symbol caching (change B, in Phase 1).**
`IndicatorService.compute` calls `validateRequest`, which does `await this.watchlist.get(symbolId)` **every** compute (`indicator.service.ts`).
In a backtest the symbol is single and immutable for the whole run, yet under the same contention that produces ~10 ms candle reads this per-compute `watchlist.get` is a real cost repeated across millions of drains.
The run-local service therefore reads the watchlist through a per-run cache that resolves the one symbol once and answers every subsequent `get` from memory.

```ts
// Illustrative, not to be committed.

/**
 * A WatchlistRepository facade that memoizes the single symbol a backtest run
 * evaluates. The symbol is immutable for the run, so one get() resolves it and
 * every later get() answers from the cache — removing a per-compute repo read
 * from the hot path. Delegates non-cached ids straight through (defensive; a run
 * only ever asks for its one symbol).
 */
class WatchedSymbolCache implements WatchlistRepository {
  private cached?: WatchedSymbol | null;
  constructor(private readonly inner: WatchlistRepository, private readonly symbolId: string) {}
  async get(id: string): Promise<WatchedSymbol | null> {
    if (id !== this.symbolId) return this.inner.get(id);
    if (this.cached === undefined) this.cached = await this.inner.get(id);
    return this.cached;
  }
  // list()/other methods delegate to inner unchanged.
}
```

This is placed in Phase 1, not deferred: it is a small, self-contained facade and the cost it removes is paid every drain.

---

## 5. Eviction + refill loop — `WindowFeeder`

The `WindowFeeder` owns advancing the window: it streams the next candle from the source (via `streamFeed`), ingests it into the windowed repo, and evicts candles that have fallen out of every period's lookback.

**Seed before `start`.**
Before the first in-range candle, warmup + operator-lookback bars ending strictly before `start` must already be resident, or the first drain underflows.
`seed()` reads, per period, the `maxLookback(period)` candles ending before `start` (one `latestN(symbol, period, maxLookback, start)` against the **source** store) and `save`s them into the window.

```ts
// Illustrative, not to be committed.

class WindowFeeder {
  private readonly feed: AsyncGenerator<FeedCandle>;
  constructor(
    private readonly source: CandleRepository,     // shared Mongo store
    private readonly window: WindowedCandleRepository,
    private readonly maxLookback: Map<Period, number>,
    private readonly params: BacktestParams,
    private readonly periods: Period[],
  ) {
    this.feed = streamFeed(source, params.symbolId, periods, params.start, params.end);
  }

  /** Load each period's pre-start lookback bars so the first drain never underflows. */
  async seed(): Promise<void> {
    for (const period of this.periods) {
      const n = this.maxLookback.get(period) ?? 0;
      // latestN(..., before = start): the n bars strictly preceding the window.
      const warm = (await this.source.latestN(this.params.symbolId, period, n, this.params.start)).reverse();
      await this.window.save(this.params.symbolId, period, warm);
    }
  }

  /** The next feed candle, ingested into the window with eviction applied. */
  async next(): Promise<FeedCandle | undefined> {
    const item = await this.feed.next();
    if (item.done) return undefined;
    const { period, candle } = item.value;
    await this.window.save(this.params.symbolId, period, [candle]);
    this.evict(candle);
    return item.value;
  }

  /**
   * Evict candles older than every period's lookback floor, keyed off the just-
   * ingested candle's COMPLETION time — never off wall-clock or a coarse bar's
   * open time. A candle at completion T means every candle whose completion is
   * <= T has already played; the floor for period p is the open time of the bar
   * maxLookback(p) back from the current position on p.
   */
  private evict(justIngested: Candle): void {
    for (const period of this.periods) {
      const n = this.maxLookback.get(period) ?? 0;
      const resident = /* window's ascending array for (symbol, period) */ [] as Candle[];
      if (resident.length <= n) continue;
      const floorCandle = resident[resident.length - n - 1];
      if (floorCandle) this.window.evictBelow(this.params.symbolId, period, floorCandle.time + 1);
    }
  }
}
```

**Eviction respects completion-time ordering.**
The hazard is evicting a candle the *current* position still needs.
A coarse bar (1d) completes **after** all the fine bars (1m, 1h) in its span, and finer bars of the same span are fed before it (the completion-time order).
Eviction is therefore driven **per period by candle count**, not by a single global timestamp: each period keeps its own last `maxLookback(period)` candles regardless of how far another period has advanced.
This guarantees that when the 1d bar closing an interval is finally fed and drained, the 1m/1h lookback it may read is still resident, because those periods evict only relative to *their own* current head — and their head has not advanced past this interval yet (the merge feeds in completion order).

**Prefetch depth.**
`streamFeed`'s per-period `FEED_CHUNK` read-ahead (4096) is the prefetch: the feeder pulls the next candle synchronously in the replay loop, and each pull is served from the cursor's buffer until a chunk boundary triggers one `range`.
No separate prefetch thread — the read-ahead buffer is the depth, and it is bounded and tunable.

**Replay-loop change.**
`replay`'s `for (const item of feed)` becomes a `while ((item = await feeder.next()) !== undefined)` — the only structural change to the loop body; everything after (`feedCandleIntoEngine`, `await wired.drain()`, executor, hooks, progress) is unchanged, and `progressAt` still works off `item.candle.time + periodMillis(item.period)`.

---

## A. Reads past the window floor, and the `CROSSING_LOOKBACK_CAP` question

The earlier sketch bounded how far a `Crossing` / `Channel` operator may look back with a guessed cap (256), let the streamed result diverge from the unbounded Mongo path beyond it, and called that divergence an "intentional declared contract" kept safe by keeping test fixtures within the cap.
**That is rejected here.**
A backtesting tool that silently returns a *different verdict* than the historical / unbounded path — based on nothing but an internal buffer size — is producing a wrong answer dressed as a design choice.
This section replaces it.

**A.1 — Reads past the floor are a hard error, never a silent fallback.**
`WindowedCandleRepository` throws `LookbackUnderflowError` when a read reaches before the resident floor.
There is **no** fallback to Mongo and **no** truncated short-read: an underflow means the window was sized too small for what the profile actually asked, which is a bug in `deriveMaxLookback` or a profile that should never have been streamed — either way, fail loud.

**A.2 — Streamable vs. eager is an explicit, testable routing decision.**
`deriveMaxLookback` returns a bound only when *every* operator in the profile has a **derivable, finite** lookback.

- Derivable: `Moving` (`lookbackBars`), `Comparison` / `State` (snapshot, depth 1), and any indicator warmup (a finite bar count by contract).
- **Not** derivable: `Crossing` / `Channel`, whose baseline walk continues until it finds the first non-flat / off-boundary point (`operators/crossing.ts`, `operators/channel.ts`).
  On a series that is flat for a long stretch this walk reaches arbitrarily far back — a genuinely **unbounded** lookback with no value in the rule config to bound it.

When `deriveMaxLookback` returns `undefined` (a genuinely-unbounded operator is present), the run is **not streamed**.
It routes to the existing eager path (`loadFeed` + full materialization) unchanged — the same correct, unbounded-lookback behaviour it has today.
It does not get streamed-with-a-truncated-result.

```ts
// Illustrative, not to be committed.

const maxLookback = deriveMaxLookback(profile, rules, this.registry);
if (maxLookback === undefined) {
  // A genuinely-unbounded operator (Crossing/Channel with no declared bound) is
  // present: stream would risk a wrong verdict, so run the eager path verbatim.
  return this.replayEager(params, strategy, profile, periods, hooks);
}
return this.replayStreamed(params, strategy, profile, periods, hooks, maxLookback);
```

The consequence is honest and explicit: a 10-year 1-minute run of a profile that uses a crossover is **not** made feasible by this design today — it still routes to eager and still OOMs.
Making crossovers streamable requires giving `Crossing` / `Channel` a **declared** lookback bound in the rule config (e.g. an optional `maxLookbackBars` on the leaf, past which no baseline is sought), which is a **product decision** — see open questions.
That is the only correct way to make them streamable: a bound the *user declared*, not one the engine guessed.

**A.3 — No guessed cap constant.**
There is **no** `CROSSING_LOOKBACK_CAP = 256` in this design.
If a bound constant ever exists for `Crossing` / `Channel`, it must be **derived from the leaf's declared `maxLookbackBars`** (config), named, and documented — a checkable expression of a user-stated bound, never a guess.
Any residual guessed value is called out as an open question requiring a product decision, not silently shipped.

**A.4 — What the tests must prove (see section 8).**

- For a **streamable** profile (Moving / Comparison / indicator operands), the streamed path is **byte-identical** to the eager Mongo-backed path — proven by a differential test asserting full-payload `toEqual` on events + trades + summary, not merely "the fixture stayed within a cap".
- For a profile with a **genuinely-unbounded** operator (`Crossing` / `Channel`, no declared bound), a declared test asserts the run is **routed to the eager path** — the routing decision is executable, not just documented.

---

## 6. Memory + I/O analysis — 10-year single-symbol 1m + 1h + 1d

**Bar counts (feed size).**

| Period | Bars over 10 years |
| ------ | ------------------ |
| 1m     | ~5,259,600         |
| 1h     | ~87,660            |
| 1d     | ~3,653             |
| Total  | ~5,350,000 drains  |

**Resident window (span-independent).**
Take a representative profile: an SMA-14 and a `Moving(lookbackBars=20)`, so `maxLookback ≈ roundToPage(20 + 1 + 14) = 64 + 64 = 128` bars per period.

- Window: 3 periods × 128 candles = **384 candles resident**.
- At ~200 bytes per V8 candle object, that is **~77 KB — on the order of ~100 KB**, and it does **not grow with the backtest span**: a 1-year and a 10-year run hold the same window.
- A heavier profile (SMA-200) lifts this to ~320 candles/period → ~192 KB — still ~hundreds of KB, still span-independent.

**Chunk read-ahead (accounted separately).**
The `streamFeed` cursors hold up to `FEED_CHUNK` candles per active period in flight: 3 × 4096 = 12,288 candles ≈ **~2.4 MB peak**.
This is larger than the lookback window but is also bounded and span-independent, and it is tunable via `FEED_CHUNK` (a smaller chunk trades more `range` round-trips for less buffer).
The two must not be conflated: **window ≈ 100 KB**, **chunk read-ahead ≈ single-digit MB** — total resident is a few MB regardless of span, versus ~1 GB (and growing) for eager materialization.

**Mongo round-trips.**

- **Streamed feed:** `⌈bars / FEED_CHUNK⌉` `range` calls per period, plus one warmup `latestN` seed per period.
  1m: ⌈5,259,600 / 4096⌉ ≈ 1,285; 1h: ≈ 22; 1d: 1; seeds: 3.
  **Total ≈ ~1,311 round-trips for the entire run.**
- **Per-drain reads:** **zero** Mongo round-trips — every bar-pager `latestN`, indicator-pager `latestN`, and `compute` `range`/`latestN` is served from the in-memory window.
- **Current path:** `loadFeed`'s eager `range` materializes ~5.35M candles (~1 GB → OOM) *and* each of ~5.35M drains issues several candle-store reads (bar pagers + indicator compute), at ~10 ms each under contention → tens of millions of round-trips, tens of hours of pure I/O wait.

The storage problem is solved: ~1,300 sequential bulk reads and a few-MB resident set replace ~1 GB materialization plus tens of millions of contended per-drain reads.

---

## 7. The independent runtime wall (out of scope)

Storage is not the only 10-year-1m cost.
The feed is ~5.26M candles, so the replay loop performs **~5.26M drains** — `feedCandleIntoEngine` + `await wired.drain()` + executor step — regardless of where candles come from.
Streaming makes each drain cheap (no I/O) but does not reduce their **count**; that CPU-bound step-count wall is untouched by this design and is explicitly out of scope.

Named, not designed here, the levers that would address it:

- **Coarse base resolution** — run the strategy at the coarsest period that preserves its signals, collapsing the drain count by the period ratio.
- **Chunked / parallel runs** — partition `[start, end)` into segments run concurrently (each segment re-seeds its own warmup), trading determinism-preserving stitching for wall-clock.
- **Phase-2 coarse-bar change-detection** — skip drains where nothing an operator reads has changed since the last bar (the SMA-on-1h recomputed every 1m bar is the canonical waste); see section 9.

---

## 8. Correctness & tests

- **Differential test (the headline correctness proof).**
  A fixture with a **cross-period rule** (e.g. a `Moving` on the 1h series gating a 1m-triggered rule, plus an SMA indicator operand) is replayed twice: once through the current eager Mongo-backed path, once through the streamed windowed path.
  Assert the two `BacktestReplayResult`s are **byte-identical** with a full-payload `toEqual` on `{ events, trades, openPosition, summary, cancelled }`.
  This proves equivalence for a **streamable** profile — not "stayed within a cap" (change A).

- **Eager-routing test (change A).**
  A profile whose condition uses `Crossing` (or `Channel`) with no declared bound is replayed; assert it is **routed to the eager path** — e.g. `deriveMaxLookback(...)` returns `undefined`, and (behaviourally) that the run still produces the correct unbounded-lookback result on a fixture where the crossover baseline sits deeper than any fixed window.

- **`streamFeed ≡ orderBacktestFeed` property test (Phase 0).**
  For randomized multi-period fixtures, `collect(streamFeed(...))` `toEqual` `orderBacktestFeed(perPeriodRanges(...))` — same length, same order, same tie-breaks — across `FEED_CHUNK` boundaries (including chunk sizes smaller than a period's bar count, to exercise refill).

- **Windowed-repo contract test.**
  Run `WindowedCandleRepository` against the existing shared candle-repository contract suite, **restricted to a covering window**: every contract read stays within `[floor, current]`, so the windowed repo must answer exactly as `InMemoryCandleRepository` does for those reads.
  This proves `range` / `latestN` / `latest` are behaviour-identical within the window.

- **`LookbackUnderflowError` test.**
  A read reaching before the resident floor throws `LookbackUnderflowError` (not a silent short read, not a Mongo fallback) — the change-A invariant made executable.

- **Eviction tests.**
  (a) After ingesting a candle, each period retains exactly `maxLookback(period)` candles and drops older ones.
  (b) When a coarse (1d) bar closing an interval is fed **after** the fine (1m/1h) bars of its span, the fine-period lookback it reads is still resident — the completion-time-ordering eviction invariant (section 5).
  (c) Seeding makes `maxLookback(period)` pre-`start` warmup bars resident so the first drain reads without underflow.

- **Determinism hazards (guard explicitly).**
  - **Memo key stability.** The per-drain / per-observation compute memo keys on the compute identity; the shared engine seam uses an explicit `IndicatorComputeKey` (not `JSON.stringify`) per ADR-0021 — this design keeps that seam and adds no `JSON.stringify`-keyed memo.
  - **Float determinism.** Indicator compute over the window must be bit-identical to compute over Mongo for the same bars — the windowed repo returns the same `Candle` objects the source held, so `module.compute` sees identical inputs.
  - **The `before = event.ts + 1` bound.** The pagers' exclusive upper bound (`upperTs + 1`) must be preserved so a candle stored after the observation never becomes the newest point; in the window this also means the feeder must not ingest a candle *ahead* of the current position before its drain (the merge guarantees this — candles arrive in completion order).

---

## 9. Phasing

**Phase 0 — pure functions, no wiring.**
Land `streamFeed` and `deriveMaxLookback` as pure, exported functions with the property test (`streamFeed ≡ orderBacktestFeed`) and unit tests for the lookback formula and the streamable/eager routing predicate.
No change to `replay`; nothing is wired in.
This de-risks the ordering and sizing logic in isolation.

**Phase 1 — window + local IndicatorService + differential test (the shippable win).**
Wire `WindowedCandleRepository`, `WindowFeeder`, the run-local `IndicatorService` over the window, and the `WatchedSymbolCache` (change B) into `replay`, behind the streamable/eager routing.
Land the differential, eager-routing, underflow, eviction, and windowed-contract tests.
**This is the memory + I/O win** — 10y-1m becomes feasible on memory and I/O for streamable profiles; unbounded-operator profiles route to eager unchanged.

**Phase 2 — coarse-bar change-detection (separate, where 10y gets fast).**
Skip drains where nothing an operator reads has changed since the previous bar (the ~5.26M-drain CPU wall).
Independent of storage; explicitly deferred.

**Preload-all is strictly dominated — skip it.**
"Load the whole window into an in-memory repo up front" gives the same per-drain speed as the window (in-memory reads) but reintroduces the ~1 GB span-dependent memory that motivated the change — it is strictly worse than the window on memory and no better on drain cost, so it is not a phase.

**Relationship to filed issues.**

- **#548 (live per-event recompute)** — fixed by the shared per-observation compute memo (ADR-0021 / #552); unchanged here.
  The window makes each such compute cheap (in-memory) but the memo still earns its keep by deduping within an observation.
- **#549 (backtest per-bar candle paging)** — **resolved by this design**: per-drain paging no longer hits Mongo; it reads the in-memory window.
- **#550 (per-drain memo debt)** — **closed** (resolved by #553 / ADR-0021), which locked the backtest to the shared engine memo and rejected the per-consumer `Proxy` memo.
  This design honours that decision: it adds no per-consumer or `JSON.stringify`-keyed memo, and Phase 2's change-detection builds on the shared seam rather than reintroducing one.

---

## 10. Open questions / risks

- **Declared bound for `Crossing` / `Channel` (product decision).**
  Making crossover profiles streamable for 10y-1m requires a **user-declared** lookback bound on those leaves (e.g. an optional `maxLookbackBars`, past which no baseline is sought and the operator returns `false`).
  This is a product/semantics decision — it changes what a crossover *means* on a long flat stretch — and must not be resolved by a guessed engine constant.
  Until it is decided, `Crossing` / `Channel` profiles route to eager (and 10y-1m of them stays infeasible).
  **Needs a human decision before any bound constant is introduced.**

- **Multi-symbol scope.**
  This design is **single-symbol**, matching `replay` today (`params.symbolId` throughout, one feed, one window keyed by the single symbol).
  Confirm `replay` stays single-symbol; a multi-symbol backtest would need one window per symbol (or a symbol-keyed window) and a merged multi-symbol feed — out of scope, and the `WatchedSymbolCache` / windowed-repo shapes assume one symbol.

- **Warmup-must-be-a-finite-bar-count contract.**
  `deriveMaxLookback` relies on `module.warmup(inputs)` returning a finite bar count (it does today: `warmup?: (inputs) => number`, SMA/VWMA `length`).
  An indicator whose warmup is unbounded or not expressible as a bar count would break the derivation — this must stay a **contract**: an indicator with a non-derivable warmup makes its profile non-streamable (route to eager), the same rule as unbounded operators.

- **Interaction with a concurrently-running live poll loop.**
  The streaming source reads (`range` / `latestN` against Mongo) share the collection with the live poll loop's writes — the ~10 ms contention this design measures.
  Streaming *reduces* read count by ~4 orders of magnitude, so it lightens contention; but a run started mid-poll could read a `[start, end)` that the poll loop is still extending near `end`.
  Backtests run over historical `[start, end)` with `end` in the past, so this is unlikely — flag it, don't design for it yet.

- **Chunk-vs-window memory accounting.**
  Keep the two terms distinct in any capacity planning: the **lookback window** is ~100 KB (span-independent), the **chunk read-ahead** is `FEED_CHUNK × periods` candles (a few MB, span-independent, tunable).
  Reporting a single "resident memory" number that conflates them will mislead; `FEED_CHUNK` is the knob for the second.

- **Cancellation mid-stream.**
  `replay` honours `hooks.isCancelled()` per candle.
  With an async-generator feed, cancellation must call the generator's `return()` so the in-flight `range` cursor is disposed and no further chunk is pulled — otherwise a cancelled run leaves a dangling read.
  The `WindowFeeder` should expose a `close()` that calls `this.feed.return()`, called from `replay`'s cancellation branch and its `finally`.

- **`operatorWalkDepth` completeness.**
  `deriveMaxLookback` must enumerate **every** leaf family; a new leaf family added later without a case would either under-size the window (underflow at runtime — caught loud by `LookbackUnderflowError`) or be missed by the routing predicate.
  The `switch` over `LeafConditionFamily` should be exhaustive (no `default`) so a new family is a compile error, forcing an explicit derivable/unbounded decision.
