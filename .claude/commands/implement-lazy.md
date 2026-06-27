---
description: Simplified feature flow — climb the YAGNI ladder, ship the shortest diff that holds. Lazy alternative to /implement.
argument-hint: <feature-name> [short description]
---

Build this the lazy way (see CLAUDE.md). Lazy means efficient, not careless.

Feature: $ARGUMENTS

**Branch first.** If `git branch --show-current` isn't `<type>/<kebab-summary>`, rename via `git branch -m`.

## The ladder — stop at the first rung that holds

1. **Does this need to exist?** Speculative need = skip it, say so in one line, stop. (YAGNI)
2. **Stdlib / native platform covers it?** Use it.
3. **Already-installed dependency solves it?** Use it. Never add a dep for what a few lines do.
4. **One line?** One line.
5. **Only then:** the minimum code that works.

Two rungs work → take the higher one and move on. First lazy solution that works is the right one.

## Flow

1. **Scope it down.** State in one or two lines what you'll build and what you're deliberately *not* building. If anything's genuinely ambiguous or a decision could cost a refactor, ask — don't guess (CLAUDE.md).
2. **Build.** Minimal code, shortest diff, fewest files. Respect the one rule: adapters → application → domain. Resolve config via `loadSettings`, never `process.env`. Mark deliberate simplifications with a `// Lazy:` comment naming the ceiling and upgrade path.
3. **One check behind it.** Non-trivial logic (a branch, loop, parser, money/security path) leaves ONE runnable check — a unit test, full-payload `toEqual`, `expect.closeTo` for floats. Trivial one-liners need no test. No spec file, no e2e, no scaffolding unless the behavior is a documented spec change — if it is, stop and use `/implement` instead.
4. **Gate.** `npm run check`. Fix red.

Don't commit — leave that to `/ship`.

## Output

Code first. Then at most three lines: `did X; Y covers it. skipped Z, add when W.` If the explanation is longer than the diff, delete the explanation.
