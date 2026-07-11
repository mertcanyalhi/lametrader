---
description: Spec-driven TDD for a new feature — scaffold spec, red/green/refactor, unit + e2e, granular green commits on a draft PR, gate, optional auto-merge. Lazy by default.
argument-hint: <feature-name> [short description] [--merge | --no-merge]
---

Build this the lazy way, with the documented-behaviour ceremony on top (see CLAUDE.md). Lazy means efficient, not careless.

Feature: $ARGUMENTS

**Auto-merge flag.** `$ARGUMENTS` may carry an auto-merge preference; strip it before using the rest as the feature name/description:

- `--merge` — after the gate, enable GitHub auto-merge (squash) without asking.
- `--no-merge` — leave the PR for a human to merge; don't ask.
- neither — once the PR is green, **ask** (`AskUserQuestion`) whether to enable auto-merge. Never guess the merge preference (CLAUDE.md).

> **Auto-merge depends on repo settings — it's not something the command can force.** The `--merge` leg only takes effect when the repo has *Allow auto-merge* on **and** a `main` branch rule makes the `check:full (+ e2e)` status check required; otherwise `enable_pr_auto_merge` no-ops gracefully and the PR waits for a manual merge.
> If that rule also requires an approving review, GitHub holds the merge until someone approves — and a PR author can never approve their own PR. So the identity that opens the PR matters: a PR opened under your own account can't be self-approved, and the `--merge` flow will stall waiting for a review that can't come. For hands-off auto-merge either keep required approvals at 0 (CI-gated only) or add yourself to the ruleset bypass list (see `.github/CODEOWNERS`).

**Branch first.** If `git branch --show-current` isn't `<type>/<kebab-summary>`, rename via `git branch -m <new-name>` — never push an auto-generated `claude/…` name. This branch is the PR's head; every commit below lands on it.

## The ladder — stop at the first rung that holds

Apply at every decision: the spec, each acceptance criterion, the implementation, the abstractions.

1. **Does this need to exist?** Speculative need = skip it, say so in one line, stop. (YAGNI)
2. **Stdlib / native platform covers it?** Use it.
3. **Already-installed dependency solves it?** Use it. Never add a dep for what a few lines do.
4. **One line?** One line.
5. **Only then:** the minimum code that works.

Two rungs work → take the higher one and move on. First lazy solution that works is the right one.

## Flow

Follow these steps, in order, and do not skip any. Commits are **granular and always green**: one logical concern per commit, pushed as it lands, so each push runs CI on the PR. Never commit a red tree.

1. **Scope it down.** State in one or two lines what you'll build and what you're deliberately *not* building. If anything's genuinely ambiguous or a decision could cost a refactor, ask — don't guess (CLAUDE.md).
2. **Spec → open the draft PR.** Create `specs/<kebab-name>.spec.md` from `specs/_template.md`. Fill in the goal, acceptance criteria (one bullet per intended behavior), the port(s)/use-case touched, and the end-to-end expectation. Each criterion must pass the ladder — drop it if it doesn't. Show me the spec and pause if anything is ambiguous. Then:
   - Commit the spec alone (`docs: scaffold <name> spec`) — it's under `specs/**`, so this push skips CI.
   - `git push -u origin <branch>`.
   - Open a **draft** PR against `main` (`mcp__github__create_pull_request`, `draft: true`). Title `<type>: <short summary>`; body summarises the goal and lists the acceptance criteria as an unchecked list.
   - Subscribe to PR activity (`mcp__github__subscribe_pr_activity`) so CI failures and review comments wake the session (CLAUDE.md).
   The draft PR is the running home for the granular commits that follow.
3. **Red.** For each acceptance criterion, write a failing unit test (full-payload `toEqual`). Run `npm test` and confirm each fails for the right reason. Don't commit a red tree — the commit comes after green.
4. **Green, one concern at a time.** For each criterion: write the minimal code to pass it (nothing the spec didn't ask for), climb the ladder per piece, respect the dependency rule (adapters → application → domain), resolve config via `loadSettings` never `process.env`, and mark deliberate simplifications with a `// Lazy:` comment naming the ceiling and upgrade path. When that criterion is green (`npm test`), commit it — the test and its implementation together — with a Conventional Commits message, then push. Repeat per criterion, so the PR fills with small green commits and CI runs `check:full` on each push.
5. **Refactor.** Clean up under green tests. Apply a SOLID abstraction only if a second concrete case actually exists (abstract on the second instance). If the refactor changes anything, commit + push it as its own concern.
6. **E2E.** Add a `*.e2e.test.ts` exercising the feature end-to-end (poll → persist → process → assert), plus its one critical failure mode. Run `npm run test:e2e`, then commit + push.
7. **Gate.** Run `npm run check:full`. Fix anything red, committing + pushing each fix. Do not proceed until it's green locally.
8. **Ready for review.** Flip the PR out of draft (`mcp__github__update_pull_request`, `draft: false`) and confirm CI on the latest push is green (`mcp__github__pull_request_read`, status checks).
9. **Merge preference.**
   - `--merge`: enable GitHub auto-merge, squash (`mcp__github__enable_pr_auto_merge`, `mergeMethod: "SQUASH"`) — GitHub merges once required checks pass.
   - `--no-merge`: leave it; report the PR link for a human to merge.
   - neither: `AskUserQuestion` — "Enable auto-merge (squash) so this merges when CI passes, or leave it for you to merge?" Honor the answer; enable squash auto-merge on yes.
   Squash keeps the granular commits as PR history while collapsing them to one conventional commit on `main` — that's the "one logical concern" the DoD asks for.
10. **Done.** Walk the Definition of Done in CLAUDE.md and report coverage + any gaps, plus the PR link and its merge state (auto-merge enabled / awaiting human).

## Output

Code first. Then the DoD walkthrough — shortest form that covers each acceptance criterion, e2e status, and any deliberate gaps with their `// Lazy:` markers — followed by the PR link and merge state. If a section's explanation is longer than its diff, trim it.
