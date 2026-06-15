---
description: Pre-commit gate — run check:full, verify Definition of Done, then make one conventional commit.
argument-hint: [commit subject]
---

Prepare and make a clean commit for the current change.

1. Run `npm run check:full`.
   If anything fails, STOP and report — do not commit.
2. Verify the Definition of Done (CLAUDE.md): a spec exists, unit + e2e tests derive from it and pass, nothing is `.skip`-ped, and an ADR was written if a non-obvious decision was made.
3. Show `git status` and `git diff --stat`.
   Confirm the change is ONE logical concern; if it spans several, propose splitting into multiple commits.
4. Stage and make the commit(s) with a Conventional Commits message (`feat|fix|refactor|test|docs|chore: ...`).
   Use `$ARGUMENTS` as the subject if provided.
   Reference the spec and any ADR in the body.

Do NOT bump package `version`s here — versioning is handled separately by `/release`.
