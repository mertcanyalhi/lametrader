# Spec: rules — drop the `-v2` suffix

- Status: draft
- Touches: `@lametrader/core` (types), `@lametrader/engine` (services), `@lametrader/api` (controllers + schemas), `@lametrader/cli` (callers), `@lametrader/web` (pages + hooks + lib)

## Goal

After PR #421 deleted the v1 rules engine in the cutover, every remaining `RulesV2`, `rules` + `-v2` token, `rules_v2`, `/v2/rules`, and `-v2`-suffixed file basename in the rules code reads as "v2 of nothing".
Drop the suffix from every code identifier, file basename, REST route, and prose mention of the live engine — pure rename, no behaviour changes.

## Acceptance criteria

Each criterion is a separate `grep`-style assertion against the working tree at completion.

- [ ] No file under `packages/**` has a `-v2`, `_v2`, or `V2`-suffixed basename.
- [ ] No file under `specs/**` has a `-v2` infix in its basename (except this spec, which documents the rename).
- [ ] No source line under `packages/**` carries `RulesV2` or the REST prefix `/v2/rules` (only the documented Mongo collection literal `'rules_v2'` and the `events_v2` field literal survive — both protected by single-quoted string literals).
- [ ] No source line under `specs/**` carries `RulesV2` or `/v2/rules` (apart from this spec's inventory + the Mongo-rename out-of-scope note).
- [ ] `packages/core/src/rules/` exists; `packages/core/src/rules-v2/` does not.
- [ ] `packages/engine/src/rules/` exists; `packages/engine/src/rules-v2/` does not.
- [ ] `@lametrader/core` re-exports the rule types unprefixed at the package root (no `RulesV2` namespace).
- [ ] `MongoRuleRepository` keeps the `'rules_v2'` collection literal and carries a JSDoc comment naming issue #422 + locked decision 2 as the reason.
- [ ] `CONTEXT.md` "Rule engine" section reads as the live, current engine (no `v2` suffix on the section title or living-glossary entries); only the historical migration paragraph mentions `v2`.

## End-to-end expectation

`npm run check:full` is green: typecheck + lint + unit + e2e all pass without touching test bodies beyond import-path updates.
The shipped REST surface is `/rules*` (no `/v2/rules*`) — verified by the existing `rules.e2e.test.ts` against the live API.

## Out of scope

- Renaming the Mongo collection from `rules_v2` to `rules` and the watchlist field from `events_v2` to `events`.
  Requires operator-controlled data migration; tracked separately.
- Renaming `docs/decisions/0016-rules-v2-greenfield-engine.md`.
  ADRs are immutable historical artifacts.
- Rewriting commit messages or git history.

## Surprises

(Filled in after implementation if anything bites.)
