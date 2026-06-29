# Spec — rules-v2: web UI rule editor

Companion to issue #396 (parent #387, ADR 0016).

## Why

The v2 rules engine ships its REST surface in #395 but no editor.
The web UI needs a v2-shaped rule editor — feature-flag-gated so it doesn't surface to users until the hard cutover — that walks one user through trigger / scope / condition / action selection end-to-end and round-trips a `Rule` through `/v2/rules`.

The editor must visibly support four reference shapes laid out in #396 (Price-vs-Literal crossing, Price-vs-IndicatorRef crossing, Bool-typed indicator-state shortcut, Moving-Up-% with scalar tuple) and surface API field-level validation errors (#395) inline.

## Out of scope

- Replacing v1's `/rules` page — coexistence behind the flag, hard cutover lands with #397.
- Implementing v1 features the v2 surface doesn't add (cross-symbol references, in-app channels other than Telegram).
- A visual-regression harness; the four reference shapes are exercised via JSDOM unit tests.

## Vocabulary

(See parent #387 / CONTEXT.md for the full vocabulary.)

- **`Rule` (v2)** — the persisted shape exposed at `/v2/rules*`: `{ id, profileId, name, scope, trigger, condition, expiration, actions, enabled, order, createdAt, updatedAt }`.
- **Operand kind** — one of the 10 kinds (Price, OHLCV, IndicatorRef, SymbolStateRef, GlobalStateRef, Literal).
  UI label `Price` (never `Current`).
- **Operand value type** — the resolved `valueType` of the LHS operand; drives which operators are legal on the row and which input control the RHS `Literal` renders.
- **Leaf family** — Comparison / Crossing / Channel / Moving / State; determines whether the leaf carries a single RHS, two bounds (lower/upper), or a scalar tuple (threshold/lookbackBars).
- **Bool-shortcut** — when the LHS operand resolves to `Bool`, hide the operator + RHS rows; on save the leaf becomes `{ family: State, operator: Equals, left, right: Literal(true) }`.
- **Feature flag** — `localStorage.rulesV2Enabled === 'true'` (also unlockable via `?rulesV2=1` URL param so the flag can be flipped from a browser without typing into devtools). Default off — the route + sidebar entry are absent when the flag is off.

## Acceptance criteria

Each bullet maps to one unit test (full-payload).
Reference-shape tests instantiate the editor with a seeded rule and assert the rendered structure + the leaf that round-trips on save.

- A `useRulesV2Enabled` hook reads the feature flag (URL param `rulesV2=1` wins, else `localStorage.rulesV2Enabled === 'true'`, else `false`).
- The `/rules-v2` route is mounted only when the flag is enabled.
- The sidebar's "Rules v2" entry is visible only when the flag is enabled.
- `lib/hooks/rules-v2.ts` exposes `useRulesV2(filters?)` → `GET /v2/rules?profileId=&symbolId=&enabled=`, `useCreateRuleV2` → `POST /v2/rules`, `usePatchRuleV2` → `PATCH /v2/rules/:id`, `useDeleteRuleV2` → `DELETE /v2/rules/:id`.
- `apiFetch` surfaces field-level validation envelope (`{ error, fields[] }`) on `ApiError` via a `fields` property the editor reads; missing `fields[]` resolves to `undefined`.
- The `OperandPickerV2` renders one option per `OperandKind`, labels `Price` (not `Current`), and updates the operand on selection.
- A `Literal` RHS auto-types its input control from the resolved LHS `valueType`: numeric → numeric stepper, bool → switch, string/enum → text input.
- The `OperatorPickerV2` filters its options to operators whose family is legal for the resolved LHS valueType (numeric LHS hides State operators; bool LHS only shows State family).
- The `ConditionTreeEditorV2` renders the bool-shortcut layout (operator + RHS hidden) when the LHS resolves to a Bool-typed operand; the saved leaf carries `Equals` against `Literal(true)`.
- Crossing operators render LHS + RHS pickers + an `Interval` row that is required when the LHS or RHS is OHLCV / IndicatorRef.
- Channel operators render LHS + lower bound + upper bound pickers (full operands, both shown side by side with labels Upper / Lower).
- Moving operators render LHS + a numeric `threshold` input + an integer `bars` input + no RHS picker.
- The `IndicatorRef` picker filters profile-attached instances by the row's `Interval` — instances whose period doesn't match the chosen interval are hidden from the dropdown.
- The `SymbolStateRef` / `GlobalStateRef` pickers show existing state keys via a dropdown plus a freetext fallback.
- The `TriggerPickerV2` exposes all six `TriggerKind` options; selecting `OncePerBar` / `OncePerBarOpen` / `OncePerBarClose` reveals a `period` field; `OncePerInterval` reveals a `intervalMs` field.
- The `ScopePickerV2` exposes `Symbol`, `Symbols(list)`, `AllSymbols`; `Symbol` reveals a single watched-symbol picker; `Symbols(list)` reveals a multi-select.
- The `ActionPickerV2` exposes the `Notification` (Telegram) variant and the four state-action variants; the Telegram form has a destination dropdown (seeded from `/config/notifications/telegram`) + a template textarea.
- The `RuleEditorDialogV2` round-trips a v2 rule end-to-end: a `useCreateRuleV2` mutation fires with the form's full payload on submit, and a 400 with `fields[]` populates inline field-level error messages (one per offending path).
- Reference Ex.1 (Price Crossing literal): seeding `Crossing(Price, Literal(120))` renders a numeric stepper on the RHS literal control (no `Interval` row), and a non-numeric input fails the Yup validator before submit.
- Reference Ex.2 (Price Crossing IndicatorRef): seeding `Crossing(Price, IndicatorRef('1h:Supertrend.upTrend'))` renders the `Interval` row at `1h` and the indicator-instance dropdown shows only instances attached on `1h`.
- Reference Ex.3 (Bool shortcut): seeding LHS=`IndicatorRef(Supertrend.superTrendBuy:Bool)` collapses to a single-operand row (operator + RHS hidden); saving emits a `State` leaf with `Equals` against `Literal(true)`.
- Reference Ex.4 (Moving Up %): seeding `MovingUpPercent(IndicatorRef.upTrend, threshold=10.5, lookbackBars=2)` renders a `%` numeric input, a `bars` integer input, no RHS picker, and the `Interval` row at `1h`.

## E2E

- A `*.e2e.test.ts` builds the web package and asserts the v2 editor's bundle markers ship (route mount, key copy strings) so the rule editor reaches the deployable artifact.
- The same e2e asserts a flag-off bundle does not surface the `/rules-v2` route at the URL root (the flag's presence is enough — the e2e doesn't drive a browser).
