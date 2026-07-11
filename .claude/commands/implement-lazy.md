---
description: Simplified feature flow — climb the YAGNI ladder, ship the shortest diff that holds. Lazy alternative to /implement.
argument-hint: <feature-name> [short description]
---

Build this the lazy way (see CLAUDE.md). Lazy means efficient, not careless.

Feature: $ARGUMENTS

**Auto-merge flag.** `$ARGUMENTS` may carry an auto-merge preference; strip it before using the rest as the feature name/description:

- `--merge` — after the gate, enable GitHub auto-merge (squash) without asking.
- `--no-merge` — leave the PR for a human to merge; don't ask.
- neither — once the PR is green, **ask** (`AskUserQuestion`) whether to enable auto-merge. Never guess the merge preference (CLAUDE.md).

**Branch first.** If `git branch --show-current` isn't `<type>/<kebab-summary>`, rename via `git branch -m`.

## The ladder — stop at the first rung that holds

1. **Does this need to exist?** Speculative need = skip it, say so in one line, stop. (YAGNI)
2. **Stdlib / native platform covers it?** Use it.
3. **Already-installed dependency solves it?** Use it. Never add a dep for what a few lines do.
4. **One line?** One line.
5. **Only then:** the minimum code that works.

Two rungs work → take the higher one and move on. First lazy solution that works is the right one.

## Flow

1. **Scope it down.** State in one or two lines what you'll build and what you're deliberately *not* building. If the request implies abstraction (interface, factory, config, port), don't — wait for the second instance (CLAUDE.md: abstract on the second instance). If anything's genuinely ambiguous or a decision could cost a refactor, ask — don't guess (CLAUDE.md).
2. **Build.** Minimal code, shortest diff, fewest files. Respect the one rule: adapters → application → domain. Resolve config via `loadSettings`, never `process.env`. Mark deliberate simplifications with a `// Lazy:` comment naming the ceiling and upgrade path.
3. **One check behind it.** Non-trivial logic (a branch, loop, parser, money/security path) leaves ONE runnable check — a unit test, full-payload `toEqual`, `expect.closeTo` for floats. Trivial one-liners need no test. No spec file, no e2e, no scaffolding unless the behavior is a documented spec change — if it is, stop and use `/implement` instead.
4. **Gate.** `npm run check`. Fix red.
5. **Commit + push + PR.** The diff is small and already green, so one commit is enough — no granular staging. Commit it with a Conventional Commits message, `git push -u origin <branch>`, and open a **ready** (non-draft) PR against `main` (`mcp__github__create_pull_request`) titled `<type>: <short summary>` with a one-line body. Subscribe to PR activity (`mcp__github__subscribe_pr_activity`) so CI failures and review comments wake the session (CLAUDE.md).
6. **Merge preference.** Once CI is green: `--merge` → enable GitHub auto-merge, squash (`mcp__github__enable_pr_auto_merge`, `mergeMethod: "SQUASH"`); `--no-merge` → report the PR link for a human to merge; neither → `AskUserQuestion` whether to enable squash auto-merge, and honor the answer.

The full spec ceremony, granular commits, and e2e belong to `/implement` — this fast track stays a single green commit on its own PR.

## Output

Code first. Then at most three lines: `did X; Y covers it. skipped Z, add when W.` If the explanation is longer than the diff, delete the explanation. End with the PR link and its merge state (auto-merge enabled / awaiting human).
