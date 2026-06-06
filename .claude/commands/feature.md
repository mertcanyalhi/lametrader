---
description: Spec-driven TDD for a new feature — scaffold spec, red/green/refactor, unit + e2e, gate, DoD.
argument-hint: <feature-name> [short description]
---

Implement a feature using this repo's spec-driven TDD flow (see CLAUDE.md).

Feature: $ARGUMENTS

Follow these steps, in order, and do not skip any:

1. **Spec** — Create `specs/<kebab-name>.spec.md` from `specs/_template.md`. Fill in
   the goal, acceptance criteria (one bullet per intended behavior), the port(s)/
   use-case touched, and the end-to-end expectation. Keep scope minimal — only what
   is asked. Show me the spec and pause if anything is ambiguous.
2. **Red** — For each acceptance criterion, write a failing unit test (full-payload
   `toEqual`). Run `npm test` and confirm they fail for the right reason.
3. **Green** — Write the minimal code to pass. Nothing the spec didn't ask for.
   Respect the dependency rule (adapters → application → domain). Run `npm test`
   until green.
4. **Refactor** — Clean up under green tests. Apply a SOLID abstraction only if a
   second concrete case actually exists (abstract on the second instance).
5. **E2E** — Add a `*.e2e.test.ts` that exercises the feature end-to-end
   (poll → persist → process → assert), plus its one critical failure mode. Run
   `npm run test:e2e`.
6. **Gate** — Run `npm run check:full`. Fix anything red.
7. **Done** — Walk the Definition of Done in CLAUDE.md and report coverage + any gaps.

Do not commit — leave that to `/ship`.
