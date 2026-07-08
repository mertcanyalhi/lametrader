# Backtest default timeframe is the selected symbol's smallest period

The backtesting page's idle period picker should default to the *smallest* period the
selected symbol is watched on, not the global config default.
A symbol charted on 1h/1d should start on 1h; switching to a symbol watched on 1d/1w should
reset the idle default to 1d.

This is only the default for a fresh/idle selection.
A loaded or running run still pins its own stored period (`chartPeriod = view?.params.period ?? period`),
so this change never overrides an in-flight run's timeframe.

## Acceptance criteria

- On first load the bottom-bar period picker shows the selected symbol's smallest watched period
  (min by `periodMillis`), not `config.defaultPeriod`.
- When the trader picks a different symbol, the idle period resets to *that* symbol's smallest
  watched period.
- When the selected symbol has an empty `periods` list, the period falls back to
  `config.defaultPeriod`.
