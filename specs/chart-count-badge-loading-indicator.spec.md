# Spec: Chart count-badge loading indicator

- Status: draft
- Touches: `packages/ui` chart bottom-bar panels — `SymbolRulesDialog`, `SymbolRuleEventsDialog`.

## Goal

The chart bottom bar's Rules and Events trigger badges coalesce their pending query to an empty result (`data ?? []` / `data ?? 0`), so while the count is still loading the badge flashes `0` — indistinguishable from a genuinely empty result.
Show a loading indicator on the badge while the query is pending, and keep rendering `0` once the data has actually loaded and is empty.

## Acceptance criteria

Each bullet maps to exactly one test.

- [ ] The Rules trigger renders a loading indicator (accessible name `Rules (loading)`), not `Rules (0)`, while its rules query is pending.
- [ ] The Rules trigger renders `Rules (0)` once the query resolves to an empty list.
- [ ] The Events trigger renders a loading indicator (accessible name `Events (loading)`), not `Events (0)`, while its count query is pending.
- [ ] The Events trigger renders `Events (0)` once the count query resolves to `0`.

## End-to-end expectation

Covered by the existing chart e2e flow — no new e2e path.
The pending-vs-empty distinction is a pure render-state concern with no server round-trip beyond what the existing suites already drive, so it is proven at the unit tier.

## Out of scope

- The States badge — it renders `selected.length` from synchronous `localStorage` state (`useState`), never has a pending query, and needs no loading indicator.
- Any new spinner/loading component — reuse `@radix-ui/themes` `Spinner`, already used elsewhere in the app.

## Surprises

_None yet._
