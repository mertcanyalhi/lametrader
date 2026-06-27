---
description: Spec-driven TDD for a new feature — scaffold spec, red/green/refactor, unit + e2e, gate, DoD. Lazy by default.
argument-hint: <feature-name> [short description]
---

Build this the lazy way, with the documented-behaviour ceremony on top (see CLAUDE.md). Lazy means efficient, not careless.

Feature: $ARGUMENTS

**Branch first.** If `git branch --show-current` isn't `<type>/<kebab-summary>`, rename via `git branch -m <new-name>` — never push an auto-generated `claude/…` name.

## The ladder — stop at the first rung that holds

Apply at every decision: the spec, each acceptance criterion, the implementation, the abstractions.

1. **Does this need to exist?** Speculative need = skip it, say so in one line, stop. (YAGNI)
2. **Stdlib / native platform covers it?** Use it.
3. **Already-installed dependency solves it?** Use it. Never add a dep for what a few lines do.
4. **One line?** One line.
5. **Only then:** the minimum code that works.

Two rungs work → take the higher one and move on. First lazy solution that works is the right one.

## Flow

Follow these steps, in order, and do not skip any:

1. **Scope it down.** State in one or two lines what you'll build and what you're deliberately *not* building. If anything's genuinely ambiguous or a decision could cost a refactor, ask — don't guess (CLAUDE.md).
2. **Spec.** Create `specs/<kebab-name>.spec.md` from `specs/_template.md`. Fill in the goal, acceptance criteria (one bullet per intended behavior), the port(s)/use-case touched, and the end-to-end expectation. Each criterion must pass the ladder — drop it if it doesn't. Show me the spec and pause if anything is ambiguous.
3. **Red.** For each acceptance criterion, write a failing unit test (full-payload `toEqual`). Run `npm test` and confirm each fails for the right reason.
4. **Green.** Write the minimal code to pass. Nothing the spec didn't ask for. Climb the ladder per piece. Respect the dependency rule (adapters → application → domain). Resolve config via `loadSettings`, never `process.env`. Mark deliberate simplifications with a `// Lazy:` comment naming the ceiling and upgrade path. Run `npm test` until green.
5. **Refactor.** Clean up under green tests. Apply a SOLID abstraction only if a second concrete case actually exists (abstract on the second instance).
6. **E2E.** Add a `*.e2e.test.ts` exercising the feature end-to-end (poll → persist → process → assert), plus its one critical failure mode. Run `npm run test:e2e`.
7. **Gate.** Run `npm run check:full`. Fix anything red.
8. **Done.** Walk the Definition of Done in CLAUDE.md and report coverage + any gaps.

Don't commit — leave that to `/ship`.

## Output

Code first. Then the DoD walkthrough — shortest form that covers each acceptance criterion, e2e status, and any deliberate gaps with their `// Lazy:` markers. If a section's explanation is longer than its diff, trim it.
