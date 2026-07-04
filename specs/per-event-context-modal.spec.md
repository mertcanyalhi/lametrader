# Spec: per-event context capture + info modal

- Status: draft
- Touches: `packages/core/src/rule.types.ts`, `packages/engine/src/rules/rule-orchestrator.ts`, `packages/ui/src/pages/rules/events-dialog.tsx`

## Goal

When a rule fires, persist the context that explains why — the inbound `RuleEvent` and the firing symbol's OHLCV snapshot — alongside the `Fired` rule event, and surface it in the events dialog through an info icon → modal.
Today the dialog shows only `summarize(event)`; debugging "did the rule really see open=0.0263 there?" requires re-running the tick.
Closes #304.

## Acceptance criteria

Each bullet maps to exactly one test.

- [ ] `FiredRuleEvent` accepts an optional `context: RuleEventContext` field carrying `{ inboundEvent, lookupSnapshot }`, where `lookupSnapshot` lists the firing symbol's `current` / `open` / `high` / `low` / `close` / `volume` at fire time.
- [ ] `RuleOrchestrator.fire` populates `context` on the appended `Fired` rule and symbol entries — both mirror the same payload so either consumer renders the same modal.
- [ ] The events dialog renders an info icon on every `Fired` row whose entry carries a `context` (no icon when context is absent, so historical entries don't get a dead button).
- [ ] Clicking the icon opens a Radix `Dialog` whose body lists the inbound event's `kind` / `ts` / `symbolId` and the lookup snapshot's OHLCV values (one row per non-null field).

## End-to-end expectation

A polled candle → fired rule → events dialog row with a clickable info icon → opened modal showing the inbound `CurrentValueChanged` event and the firing symbol's OHLCV snapshot.
The existing `rule-orchestrator-wiring.e2e.test.ts` keeps passing.

## Out of scope

- The condition truth-table (per-leaf resolved values) — punted until the lookup snapshot proves insufficient.
- The trigger gate's decision/inputs — same; user's primary "did the rule see X?" question is answered by inbound + lookup snapshot.
- Indicator value snapshots — only OHLCV of the firing symbol is captured (the primary debugging signal); indicators land when there's a concrete need.
- A sibling `event_contexts` Mongo collection — the context inlines on the existing entry; storage scale is reassessed only if rule docs grow too large.
- Chart events button info icon — events-dialog only (the chart surface can land later once the events-dialog modal proves out).
- Context on non-`Fired` event types (`NotificationSent`, state events, errors) — modal-less rows for now.

## Surprises
