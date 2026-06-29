# Spec: collapse Equals/NotEquals operator vocabulary

- Status: draft
- Touches: `packages/web/src/pages/rules/operator-picker.tsx`, `packages/web/src/pages/rules/leaf-editor.tsx`, `packages/core/src/rules/condition-normalize.ts` (new), `packages/engine/src/rules/dispatch/in-memory-rule-repository.ts`, `packages/engine/src/rules/dispatch/mongo-rule-repository.ts`.

## Goal

Surface one `Equals` and one `NotEquals` option in the leaf-editor operator picker — never both the Comparison and the State dialect side-by-side.
The engine continues to dispatch on the leaf's `family` discriminator; the picker chooses the family per-selection based on the LHS operand kind (state-ref → `State` / NULL-aware, otherwise → `Comparison` / snapshot).
Existing persisted rules with `StateOperator.Equals` / `StateOperator.NotEquals` over a non-state-ref LHS are rewritten to `ComparisonOperator.Eq` / `Neq` at read time, preserving runtime behaviour without an offline data migration.

## Acceptance criteria

Each bullet maps to exactly one test.

- [ ] `OPERATOR_OPTIONS` exposes a single `Equals` entry and a single `NotEquals` entry — neither the Comparison nor the State family lists both dialects.
- [ ] `legalOperatorsFor` over a numeric LHS returns the unified `Equals` / `NotEquals` entries with `family: Comparison` (so a fresh leaf builds as a `ComparisonLeafCondition`).
- [ ] `legalOperatorsFor` over a state-ref LHS (`SymbolStateRef` / `GlobalStateRef`) returns the unified `Equals` / `NotEquals` entries with `family: State` (so a fresh leaf builds as a `StateLeafCondition` and dispatches to NULL-aware semantics).
- [ ] `legalOperatorsFor` over a string-like indicator-ref LHS still returns `Equals` / `NotEquals` (legal for the family) plus the other State-only operators (`ChangesTo` / `ChangesFrom`).
- [ ] `normalizeRule` rewrites a persisted leaf with `family: State, operator: Equals` and a non-state-ref LHS to `family: Comparison, operator: Eq`, preserving the rest of the leaf (left / right / interval) and the surrounding rule unchanged.
- [ ] `normalizeRule` keeps a persisted leaf with `family: State, operator: Equals` and a state-ref LHS as-is (state-ref dispatch continues to apply).
- [ ] `normalizeRule` walks every `And` / `Or` group and rewrites nested leaves under the same rule.
- [ ] `InMemoryRuleRepository.list` / `get` / `listForSymbol` / `listEnabledForSymbol` return rules normalized via `normalizeRule`.
- [ ] `MongoRuleRepository.list` / `get` / `listForSymbol` / `listEnabledForSymbol` return rules normalized via `normalizeRule`.

## End-to-end expectation

The chart-Rules e2e flow stays green with a `state/Equals(SymbolStateRef, Literal)` rule (state-ref dispatch path), and a previously-persisted `state/Equals(Price, Literal)` document reads back as `comparison/Eq(Price, Literal)` through the in-memory repository contract suite.

## Out of scope

- A one-shot Mongo migration script — read-time rewrite covers it without coordinated downtime.
- Collapsing `ChangesTo` / `ChangesFrom` — those keep their State-family semantics (no Comparison analogue).
- Cross-family enum unification on the core `Operator` type — keeping the two dialect enums lets the engine continue to dispatch by `family` with no domain churn.
- Changes to the engine's per-family operator implementation (`evaluateComparison` / `evaluateState` are untouched).

## Surprises

(filled in after implementation lands)
