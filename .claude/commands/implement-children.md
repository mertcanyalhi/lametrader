---
description: Work a parent issue's children end-to-end via a workflow — one child at a time, /implement → verify → PR → poll CI → merge.
argument-hint: <parent-issue-number>
---

Crank through every child of a parent issue, sequentially, using the Workflow tool.
Calling this command is the explicit opt-in to multi-agent orchestration.

Parent issue: $ARGUMENTS

## Reference

- `/implement` — the per-child work skill (TDD ceremony, spec → red → green → refactor → e2e → gate).
- `/ship` — the per-change commit gate (`check:full` + DoD + one conventional commit).
- `/interview` — relentless clarification, one question at a time.

## Process

### 1. Gather parent context (inline, before the workflow)

- Read the parent issue via `mcp__github__issue_read` (method `get` and `get_comments`).
- List its children via `mcp__github__issue_read` (method `get_sub_issues`).
- Capture the parent's architectural baseline — ADRs cited, scope boundaries, prior decisions in the comments. This becomes the shared context every child agent receives verbatim.
- If the parent has no sub-issues, stop and report; this command isn't for single-issue work (use `/implement` directly).

### 2. Author one workflow that processes children sequentially

Write the script body as a plain `for await` loop over the child list — **not** `pipeline()`, **not** `parallel()`. The next child only starts after the previous child's PR is merged (or explicitly skipped on failure).

Each iteration spawns one `agent(...)` with `agentType: 'claude'` (full-tool agent) and the shared parent context plus the child's issue number.

### 3. What each child agent must do

Self-contained brief — every child agent gets the same instructions, parameterised by issue number:

1. **Read the child issue.** Full body, comments, acceptance criteria.
2. **Branch.** Create / check out the branch named in the child's "Git Development Branch Requirements" section if present; otherwise `<type>/<kebab-summary>` per `CLAUDE.md`.
3. **Implement.** Invoke `/implement` with the child's task. Lazy ladder per the skill's own rules.
4. **Verify the acceptance criteria.** Re-read the child issue and walk every `[ ]` bullet. If any criterion isn't met, fix it before moving on. Do not check items off in the issue — that's the merge's job.
5. **Ship.** Invoke `/ship` to gate (`check:full`) and commit on the branch.
6. **Push** the branch (`git push -u origin <branch>`).
7. **Open the PR** with `mcp__github__create_pull_request`. Title: `<type>: <short summary> (closes #N)`. Body summarises what shipped + how it satisfies each acceptance criterion.
8. **Subscribe** to PR activity (`mcp__github__subscribe_pr_activity`) so CI failures wake the agent.
9. **Poll CI** every 60 seconds via `mcp__github__pull_request_read` (status checks). Continue while pending; stop on success or terminal failure.
10. **On green:** merge with `mcp__github__merge_pull_request` (squash). Return `{ issueNumber, prNumber, merged: true }`.
11. **On red:** investigate the failing check, push a fix, re-poll. After **3** unsuccessful fix rounds, return `{ issueNumber, prNumber, merged: false, reason: "<diagnosis>" }` and let the loop move on.

### 4. Hard rules every child agent inherits

- **No guessing.** If the child issue has an ambiguous acceptance criterion, a missing decision, or a design call that two reasonable readers would split on, **stop and invoke `/interview`** to surface the question to the human. Do not pick a plausible interpretation and proceed.
- **No `--no-verify`**, no skipping hooks, no destructive git operations.
- **No spec-skipping.** `/implement` runs the full spec ceremony; do not fall back to `/implement-lazy` unless the child issue explicitly says fast-track.
- **One child = one branch = one PR.** Never reuse a branch across children.
- **Pass the parent context verbatim** in every child agent's prompt — that's the architectural baseline they don't have time to re-derive.

### 5. Return value

When the workflow finishes, the orchestrator emits a final summary table:

| issue | PR  | merged | note |
| ----- | --- | ------ | ---- |
| #312  | #401 | ✅      |      |
| #313  | #402 | ❌      | CI flake on minute-timer e2e; 3 fix rounds exhausted |

Any row with `merged: false` is the human's to triage.

## Invocation

- `/implement-children #257` — work every child of #257 in order.
- `/implement-children 257` — same; the `#` is optional.
