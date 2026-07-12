> **Archived.** The live-chart-during-run behaviour this spec described was removed when backtesting moved to an in-memory replay with a poll-for-result UI (ADR-0022, issue #565). Kept for history.

# Live forming bar of a coarser charted period folds finer stream frames

When the charted period is coarser than the finest streaming period, the forming
(latest) bar of the charted period must keep advancing between the coarse
period's own, infrequent, boundaries — by folding the finer stream frames into
it via `formingBucketCandle`.
It froze before, because live updates filtered by strict period equality and
dropped the finer frames.

The fold engages only when a strictly-finer period is actually available; the
shortest (or equal) charted period is unchanged.

## `finestFinerPeriod(periods, target)` — pick which period to fold

- Returns the finest (shortest-duration) period strictly finer than `target`:
  `finestFinerPeriod([OneMinute, FifteenMinutes, OneHour], OneHour)` is `OneMinute`.
- Returns `null` when no period is strictly finer than `target`:
  `finestFinerPeriod([OneHour, OneDay], OneHour)` is `null`.
- Returns `null` for an empty list.

## `chartCandlesFor(candles, period)` — backtest run projection

- Overlays a forming bar folded from the finest finer period onto the charted
  period's latest bucket: given `OneHour` candles plus finer `FifteenMinutes`
  candles inside the current hour, the last hour bar reflects the folded
  fifteen-minute frames.
- Leaves completed coarse buckets as the charted period's own candles; only the
  latest bucket is folded.
- Equal-period unchanged: with no finer period present, the projection is the
  charted period's own candles, deduped and ascending — identical to before.
