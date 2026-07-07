# Backtest replay reuses the shared engine compute memo

## Context

The backtest replay path (`BacktestReplayService.replay`) wires its throwaway engine through the **same** `wireRuleEngine` seam the live path uses.
That seam now creates one fresh per-observation indicator-compute memo per event batch and threads it into the evaluation context (#548 / #552), so a shared indicator operand read by every trigger event of one observation computes once instead of once per event.

Issue #550 is a decision record: it catalogues why wrapping `IndicatorService` in a per-consumer `Proxy` that memoizes `compute` per drain must **not** be adopted for the backtest path, and it proposes no runtime change.
Because the backtest replay already wires through the shared seam, its compute is already deduped with no backtest-local workaround.

This spec locks that guarantee from the backtest perspective and enforces that the rejected `Proxy` alternative never creeps into the backtest replay service.

## Acceptance criteria

- Within one replayed candle's drain, the trigger events a single final candle fans out (`BarOpened`, `BarClosed`, and the per-poll `Tick`) that all read one shared indicator operand drive exactly **one** `IndicatorService.compute` call — proving `BacktestReplayService.replay` dedups the shared operand through the engine's per-observation memo rather than the slow one-compute-per-event path.
- `backtest-replay.service.ts` contains none of the rejected per-consumer-memo constructs: no `Proxy`, no `memoizeCompute`, no method-name interception on `'compute'`, and no `JSON.stringify` cache key — so the dedup can only come from the shared engine seam, never a backtest-local workaround.

## Decision

The rejected-alternative decision (per-consumer `Proxy` memo vs. the shared engine per-observation memo) is recorded in an ADR, capturing the issue's five problems as the rationale for relying on the shared seam.
