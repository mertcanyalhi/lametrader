# Spec: Backtest run-form Period range picker

- Status: draft
- Touches: `packages/ui` — `lib/backtest-range.ts` (presets + resolution), `lib/backtest-run-schema.ts` (form `from`/`to` bounds), `pages/backtesting/period-picker.tsx` (date-range picker), `pages/backtesting/run-form.tsx` (wiring).

## Goal

Replace the run form's raw Start/End date inputs with a single **Period** date-range picker in the classic daterangepicker layout: a left sidebar of relative presets and a right dual-month calendar (`react-day-picker`) with From / To datetime fields and Apply / Cancel.
A preset or freely-picked range resolves to concrete `from`/`to` epoch-ms bounds on Apply, and those are what the form submits — so the run the server stores still carries concrete timestamps.

## Acceptance criteria

Each bullet maps to exactly one test.

- [ ] `RANGE_OPTIONS` lists exactly the ten presets in order: Today Only, Yesterday Only, 3 Days, 5 Days, 1 Week, 2 Weeks, 1 Month, 90 Days, 1 Year, Custom Range.
- [ ] `presetRange` resolves Today Only to local-midnight-through-now and Yesterday Only to the whole previous day.
- [ ] `presetRange` resolves each trailing preset (3 Days … 1 Year) to `{ from: now - span, to: now }`.
- [ ] `toBacktestRunInput` maps the form's `from`/`to` bounds to the run's `start`/`end`.
- [ ] The schema rejects a `from` on or after `to`, and a `to` in the future.
- [ ] The picker renders a Period trigger and, when opened, lists all ten presets.
- [ ] Choosing a preset locks the From/To fields; choosing Custom Range unlocks them for free picking.
- [ ] Apply commits the chosen preset window (its concrete `from`/`to`) to the parent; Cancel commits nothing.
- [ ] The run form applies a preset picked in the popover and posts a run whose window spans that preset.

## End-to-end expectation

Covered by unit/component tests (UI-only change).
Happy path: open `/backtesting`, open the Period picker, pick a preset, Apply, Run — the posted run's window is the preset span.
Failure mode: an invalid range (`from ≥ to`) is blocked client-side by the schema before posting.

## Out of scope

- Resolving presets against the dataset's latest candle (uses wall-clock `now`; see the report's decision note).
- Sharing the preset enum with the backend (UI-only; the API only sees concrete `from`/`to`).
- A bespoke calendar — the dual-month grid is `react-day-picker` (MIT).

## Surprises

(empty)
