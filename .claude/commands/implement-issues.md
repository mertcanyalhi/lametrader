---
description: Work a set of issues end-to-end via a workflow — one at a time, /implement → verify → PR → poll CI → merge.
argument-hint: <parent-issue-number> | <issue-number>...
---

Crank through every issue in the input set, sequentially, using the Workflow tool.
Calling this command is the explicit opt-in to multi-agent orchestration.

Input: $ARGUMENTS

The argument is one of:

- **One issue number** — if it has sub-issues, walk every child. If it has none, work that single issue.
- **A list of issue numbers** — work each in the order given.

The `#` prefix is optional in either form.

## Reference

- `/implement` — the per-issue work skill (TDD ceremony, spec → red → green → refactor → e2e → gate).
- `/ship` — the per-change commit gate (`check:full` + DoD + one conventional commit).
- `/interview` — relentless clarification, one question at a time.

## Process

### 1. Resolve the issue set (inline, before the workflow)

- Parse `$ARGUMENTS` into a list of issue numbers.
- If exactly one issue is given, read it via `mcp__github__issue_read` (method `get`) and check for sub-issues (method `get_sub_issues`). If sub-issues exist, the set is the sub-issues in order; otherwise the set is the single issue.
- If multiple issues are given, the set is exactly those, in the order given.
- For a parent-with-children input, also capture the parent's architectural baseline — ADRs cited, scope boundaries, prior decisions in the comments. This shared context is passed verbatim to every child agent. For a flat list input, there's no shared baseline; each agent reads its issue cold.

### 2. Author one workflow that processes the set sequentially

Write the script body as a plain `for await` loop over the issue list — **not** `pipeline()`, **not** `parallel()`. The next issue only starts after the previous issue's PR is merged (or explicitly skipped on failure).

Each iteration spawns one `agent(...)` with `agentType: 'claude'` (full-tool agent) and the optional shared context plus the issue number.

### 3. What each per-issue agent must do

Self-contained brief — every agent gets the same instructions, parameterised by issue number:

1. **Read the issue.** Full body, comments, acceptance criteria.
2. **Branch.** Create / check out the branch named in the issue's "Git Development Branch Requirements" section if present; otherwise `<type>/<kebab-summary>` per `CLAUDE.md`.
3. **Implement.** Invoke `/implement` with the issue's task. Lazy ladder per the skill's own rules.
4. **Verify the acceptance criteria.** Re-read the issue and walk every `[ ]` bullet. If any criterion isn't met, fix it before moving on. Do not check items off in the issue — that's the merge's job.
5. **Ship.** Invoke `/ship` to gate (`check:full`) and commit on the branch.
6. **Push** the branch (`git push -u origin <branch>`).
7. **Open the PR** with `mcp__github__create_pull_request`. Title: `<type>: <short summary> (closes #N)`. Body summarises what shipped + how it satisfies each acceptance criterion.
8. **Subscribe** to PR activity (`mcp__github__subscribe_pr_activity`) so CI failures wake the agent.
9. **Poll CI** every 60 seconds via `mcp__github__pull_request_read` (status checks). Continue while pending; stop on success or terminal failure.
10. **On green:** merge with `mcp__github__merge_pull_request` (squash). Return `{ issueNumber, prNumber, merged: true }`.
11. **On red:** investigate the failing check, push a fix, re-poll. After **3** unsuccessful fix rounds, return `{ issueNumber, prNumber, merged: false, reason: "<diagnosis>" }` and let the loop move on.

### 4. Hard rules every per-issue agent inherits

- **No guessing.** If the issue has an ambiguous acceptance criterion, a missing decision, or a design call that two reasonable readers would split on, **stop and invoke `/interview`** to surface the question to the human. Do not pick a plausible interpretation and proceed.
- **No `--no-verify`**, no skipping hooks, no destructive git operations.
- **No spec-skipping.** `/implement` runs the full spec ceremony; do not fall back to `/implement-lazy` unless the issue explicitly says fast-track.
- **One issue = one branch = one PR.** Never reuse a branch across issues.
- **Pass any shared parent context verbatim** in every agent's prompt — that's the architectural baseline they don't have time to re-derive.

### 5. Return value

When the workflow finishes, the orchestrator emits a final summary table:

| issue | PR  | merged | note |
| ----- | --- | ------ | ---- |
| #312  | #401 | ✅      |      |
| #313  | #402 | ❌      | CI flake on minute-timer e2e; 3 fix rounds exhausted |

Any row with `merged: false` is the human's to triage.

## Invocation

- `/implement-issues #257` — if #257 has sub-issues, walk every child in order; otherwise work #257 alone.
- `/implement-issues 257` — same; the `#` is optional.
- `/implement-issues #312 #313 #314` — work the listed issues in the order given.
