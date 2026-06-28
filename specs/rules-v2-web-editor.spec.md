# Spec: rules-v2 web editor

- Status: draft
- Touches: `packages/web` (driving adapter) — new pages, hooks, form schema; uses the `/v2/rules` REST surface from #395 and the `RulesV2` core types from #388.

## Goal

Replace the v1 rule editor in the web app with a v2 editor that round-trips through `/v2/rules`.
No feature flag — the v1 editor is going away in #397, so the v2 editor takes over the `/rules` route directly; the existing v1 page/dialog/hooks files become unreferenced and are removed.

## Acceptance criteria

Each bullet maps to exactly one test.

- [ ] `useRulesV2()` lists rules for the active profile by issuing `GET /v2/rules?profileId=...` and returns the parsed `RulesV2.Rule[]`.
- [ ] `useCreateRuleV2()` POSTs the form payload to `/v2/rules` and seeds the rules list cache on success.
- [ ] `useReplaceRuleV2()` PATCHes `/v2/rules/:id` with the updated payload.
- [ ] `useDeleteRuleV2()` DELETEs `/v2/rules/:id` and removes the row from the cache.
- [ ] `apiFetch` surfaces the `{ error, fields[] }` validation envelope as a typed `ApiError` carrying the `fields` array.
- [ ] The trigger picker renders all six `TriggerKind` options and, when the kind is `OncePerBar` / `OncePerBarOpen` / `OncePerBarClose`, shows a `Period` dropdown; when `OncePerInterval`, shows a wall-clock-ms input.
- [ ] The scope picker renders `Symbol` / `Symbols` / `AllSymbols`; `Symbol` shows a single symbol select, `Symbols` shows a multi-select, both seeded by `useWatchlist()`.
- [ ] The operand picker exposes all ten `OperandKind` variants under the `Price` label for `Price` (not `Current`); per-kind inner controls render the right input shape.
- [ ] The operand picker filters the `IndicatorRef` instance options by the surrounding leaf's `Interval`, hiding instances on other periods.
- [ ] The operand picker seeds `SymbolStateRef` keys from `GET /symbols/:id/state?profileId=...` and `GlobalStateRef` keys from `GET /profiles/:profileId/state/global`, with a freetext fallback when the user types an unknown key.
- [ ] The operator picker shows only operators whose `valueType` accepts both the resolved left and right operand types — e.g. `Number` operands hide `Equals` for `Bool`, `Bool` operands hide `Gt`.
- [ ] When the leaf's operand resolves to `Bool` (a `Bool`-typed state key or indicator state), the operator + RHS rows are hidden and the leaf serializes to `Equals(operand, Literal{ Bool, true })`.
- [ ] The operator picker, when the operator family is `Channel`, renders two operand-shaped pickers (`upper`, `lower`).
- [ ] The operator picker, when the operator family is `Moving`, renders an inline `threshold` field (number, with an optional `%` suffix toggle) plus an integer `bars` field.
- [ ] On a `POST /v2/rules` 400 with `fields: [{ path: 'condition.children[0].right', message: '...' }]`, the editor surfaces that message inline next to the matching operand row (via a `fieldErrors: Record<string, string>` indexed by path).
- [ ] The actions editor renders a `Notification` row with a `channel` selector (Telegram only at v2 launch), a `destinationName` picker fed by the existing Telegram destinations endpoint, and a `template` text area.
- [ ] The actions editor renders state-mutation rows for `SetSymbolState` / `RemoveSymbolState` / `SetGlobalState` / `RemoveGlobalState`, each with the right key + value inputs.
- [ ] When the rule's trigger is per-tick (`EveryTime` / `Once`) and the chosen `Symbol` scope's symbol has no live quote subscription configured, the form shows an inline warning at validation time (consistent with `/v2/rules`' 400 in #395) and blocks submit.
- [ ] The new `/rules` page lists v2 rules in a table with name + scope + enabled toggle + edit + delete, and shows an empty-state when the list is empty.

## End-to-end expectation

The single happy path: open the web app, navigate to `/rules`, click "New rule", fill in name + symbol scope + a `Price > 100` condition + `EveryTime` trigger + a Telegram notification action, click Create.
The dialog closes, the table refreshes with the new rule, and `GET /v2/rules` returns it.
Then open the same rule, toggle `enabled` off, save — the PATCH round-trips and the table reflects the change.

Critical failure mode: submitting a rule with a `Symbol` scope on a symbol the user does not watch returns 400 from `/v2/rules` with a `fields: [{ path: 'scope.symbolId', message: '...' }]` envelope; the editor surfaces the message inline next to the symbol picker and keeps the dialog open.

## Out of scope

- Feature flag mechanism (user direction: replace v1 directly; cleanup in #397).
- Deleting v1 `pages/rules/` files, `lib/hooks/rules.ts`, `lib/rule-form-schema.ts`, and the v1 `/api/rules` server surface — all cleared in #397.
- A new server endpoint listing the union of all known state keys for a profile; the dropdown sources from the existing per-scope state endpoints only.
- The events / firing-history dialog for v2 rules — the existing v1 events dialog stays in place; per-rule event mirroring already lives in `/v2/rules/:id/events` and reuses the same UI in a follow-up.
- Per-`Interval` period autocomplete on the operand picker beyond what `RulesV2.Period`'s enum offers.

## Surprises

(empty — filled retroactively if anything surprises during implementation)
