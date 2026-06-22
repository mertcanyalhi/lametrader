# Spec: rule event tagged-union types

- Status: implemented
- Touches: `core` (`packages/core/src/rule-event.types.ts`).

## Goal

Define `RuleEvent` — the normalized tagged-union event the rule engine consumes across every input source (timer, OHLCV streams, state mutations, indicator updates).
Per ADR 0012, every variant carries its own `ts` so the engine never reads a wall-clock.

## Acceptance criteria

- [ ] A `TimerEvent` is constructible with `kind: Timer`, `ts`, and `symbolId: null`.
- [ ] A `CurrentValueChangedEvent` is constructible with `prev`, `current`, and `final` for a symbol's last price.
- [ ] An `OpenValueChangedEvent` is constructible and accepts `prev: null` for the first observation.
- [ ] A `HighValueChangedEvent` is constructible with `prev` and `current` for a symbol's high value.
- [ ] A `LowValueChangedEvent` is constructible with `prev` and `current` for a symbol's low value.
- [ ] A `CloseValueChangedEvent` is constructible with `final: true` to mark a bar close.
- [ ] A `VolumeValueChangedEvent` is constructible with `prev` and `current` volume numbers.
- [ ] A `SymbolStateChangedEvent` is constructible with a `key`, `prev: null` for a newly-created key, and a `StateValue` `current`.
- [ ] A `GlobalStateChangedEvent` is constructible with `symbolId: null`, a `key`, and `StateValue` `prev`/`current`.
- [ ] An `IndicatorValueChangedEvent` is constructible with `instanceId`, `stateKey`, and `StateValue` `prev`/`current`.
