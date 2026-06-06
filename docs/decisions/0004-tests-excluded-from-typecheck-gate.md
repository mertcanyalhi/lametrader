# 0004. Test files are excluded from the build, leaving a type-check gap

- Status: accepted
- Date: 2026-06-11

## Context

Packages compile with `tsc --build` (NodeNext, project references) over
`include: ["src"]`. Left as-is, that pulls `*.test.ts` into `dist`, forces test
files to satisfy build-time constraints (explicit `.js` import extensions), and
drags test-only deps (vitest, testcontainers) into the build graph. Each package
therefore excludes `src/**/*.test.ts` and `src/**/*.e2e.test.ts`, and the e2e
suites live outside `src` entirely (`packages/<pkg>/tests/e2e/`).

The unit/e2e tiers run under Vitest, which resolves `@lametrader/*` to each
package's `src` (see the workspace aliases in `vitest.config.ts`) and transpiles
test files with esbuild — **without type-checking them**.

The net effect: the `check` gate (`tsc --build` + lint + unit) does **not**
type-check test files. A type error in a test is caught only by the IDE and, if
it surfaces at runtime, by the test run — not by the gate.

## Decision

Accept the gap for now. Keep test files out of the emit build (clean `dist`, fast
build, no extension/test-dep friction). Do not add a separate test type-check pass
yet.

## Consequences

- **Pro:** `dist` ships only production code; the build graph stays free of test
  deps; test imports need no `.js` extensions; resolution matches Vitest's
  `src` aliases.
- **Con:** test type errors bypass CI — they fail only in the editor or at runtime.
- **Revisit when** test type-safety in CI becomes worth the cost: add either a
  `vitest --typecheck` step or a dedicated `tsconfig` (bundler resolution,
  `noEmit`) that includes tests, wired into the `check` script.
