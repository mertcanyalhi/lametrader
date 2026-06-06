# 0003. Spec-driven TDD, with an e2e test per major feature

- Status: accepted
- Date: 2026-06-10

## Context

Change decisions were producing over-built, under-tested, sloppy code. We want a
flow that constrains scope, guarantees coverage of real behavior, and keeps tests
from being skipped.

## Decision

Every change follows: spec -> red -> green -> refactor -> check -> commit.

- A short spec with acceptance criteria precedes code; each criterion maps to one
  unit test (full-payload assertion). Code mapping to no criterion isn't written.
- Test tiers: `unit` (pure, default, TDD), `e2e` (full hexagon wired, one per major
  feature), `live` (raw adapter vs real API, manual). Port contracts are one shared
  suite run against both fake and real adapters.
- **Every major feature ships with an e2e test** — a feature isn't Done without one.
- Gates: `check` (typecheck + lint + unit) runs in the native git pre-commit hook and
  CI; `check:full` (+ e2e) runs in CI on PRs.
- Commits are small (one concern), Conventional Commits style. ADRs capture decisions.
- Walking skeleton first: thinnest full slice end-to-end before adding breadth.

## Consequences

- Higher confidence: every feature has a spec, unit tests, and an e2e.
- Slower per-feature up front, paid back in fewer regressions and reviewable history.
- e2e kept to one happy path + one critical failure per feature to avoid slow, brittle
  suites; edge cases live in fast unit tests.
