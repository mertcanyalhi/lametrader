# Spec: chart Rules button + symbol-scoped rules modal

- Status: draft
- Touches: `@lametrader/ui` only — new `SymbolRulesDialog` component, wired into `ChartPage`'s bottom-bar Chart actions group.
- Issue: #427 (inherits #426).

## Goal

On the `/chart` page expose a Rules button next to Indicators that opens a modal listing every rule applicable to the currently-viewed symbol — rules with `Symbol(this)`, `Symbols(list-containing-this)`, or `AllSymbols` scope.
Clicking the button opens a modal whose title reads `Rules for <symbolId>` and whose body is the shared `RulesTable` (#426) with the `Scope` column omitted (scope is implicitly the current symbol).
A `+ New rule` button on the modal opens the rule editor pre-scoped to the current symbol.
Edit / Events / Delete row actions reuse the shared `RulesTable`'s wiring.

## Acceptance criteria

Each bullet maps to exactly one test.

### Symbol-scoped rules dialog

- [ ] When closed, the dialog renders only its trigger button labeled `Rules` with a badge carrying the integer count.
- [ ] When the count is `0`, the badge renders `0`.
- [ ] Opening the dialog reveals a title `Rules for <symbol id>`.
- [ ] The dialog renders the shared `RulesTable` with `columns.scope` set to `false` — no `Scope` header is present.
- [ ] The table shows one row per rule returned by `GET /rules?profileId=<p>&symbolId=<s>` (the server's symbol filter covers `Symbol`, `Symbols(list)`, and `AllSymbols` scopes).
- [ ] When the server returns no rules for the symbol, the dialog renders an empty-state hint instead of the table.
- [ ] The dialog renders a `+ New rule` button that, when clicked, opens the rule editor in `create` mode pre-scoped to the current symbol (`scope.kind === Symbol` with `symbolId === <current>`).
- [ ] When no profile is selected, the dialog renders a warning callout pointing to the profile picker (no `+ New rule` button — there is nothing to attach the rule to).
- [ ] Clicking the row's Edit icon opens the rule editor in `edit` mode pre-seeded with the row's rule.
- [ ] Clicking the row's Events icon opens the rule-events dialog for that rule.

### Chart page wiring

- [ ] `ChartPage` renders the Rules button inside the bottom-bar `role="group"` named `Chart actions`, with an accessible name carrying the count (`Rules (N)`).

## End-to-end expectation

The existing web build e2e (`packages/ui/tests/e2e/rules-ui.e2e.test.ts`) already asserts the rules-editor bundle ships; extend it (or add a sibling assertion) so the `Rules for ` modal title copy is present in the built bundle — same shape as the existing `New rule` assertion.

## Out of scope

- Live websocket-driven count updates (counts fetched on dialog open; consistent with the Events button's pattern).
- Filtering / sorting / search inside the symbol-scoped table.
- A bulk-toggle action on the row set.
- A separate `lastFiredAt` source for the Charts modal — reuses the same `Rule.lastFiredAt` field stamped by the orchestrator (#426).

## Surprises

(Filled in retroactively if anything bites.)
