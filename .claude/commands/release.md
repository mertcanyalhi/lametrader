---
description: Versioning flow — derive semver bumps from commits since the last release, bump package versions (and dependent pins), sync the lockfile, and make one release commit.
argument-hint: [package@bump ... | overrides]
---

Cut a version bump as a **separate, deliberate step** — never per change. Run this
when releasing, not from `/ship`.

Optional `$ARGUMENTS` override the derived plan (e.g. `engine minor`, `api major`,
or an explicit `core@0.5.0`); with none, derive everything from the commit history.

1. **Baseline** — find the last release point: the most recent `chore(release):`
   commit (`git log --grep '^chore(release)' -1 --format=%H`), else the repo root.
   Everything after it is unreleased.
2. **Classify** — list commits since the baseline (`git log <baseline>..HEAD --oneline`)
   and map each to the package(s) it touched (`packages/<n>/...`). Per affected
   package, pick the highest bump implied by its Conventional Commit types:
   - **major** — any `!`/`BREAKING CHANGE` (e.g. a changed API/port shape).
   - **minor** — any `feat`.
   - **patch** — `fix`/`perf` only.
   - none — only `refactor`/`test`/`docs`/`chore` with no user-visible surface change
     (skip the bump for that package).
   Apply any `$ARGUMENTS` overrides on top. Show the plan and pause if unsure.
3. **Bump versions** — set each affected `packages/<n>/package.json` `version` to its
   new semver.
4. **Update dependent pins** — for every bumped package, update the
   `"@lametrader/<dep>"` entries in **all** dependents' `package.json` to the new
   version. npm only links a workspace package when the pin matches its version, so a
   stale pin makes `npm ci` 404 (see CLAUDE.md "Adding a Node package"). Don't miss
   `web`.
5. **Sync the lockfile** — `npm install` to update `package-lock.json`, then prove the
   resolution with the CI command: `npm ci`. Both must succeed.
6. **Verify** — `npm run check` green.
7. **Commit** — one `chore(release): <pkg>@<ver>, ...` commit covering only the
   version/lockfile changes. Summarize the included changes per package in the body.
   Optionally tag (`<pkg>-v<ver>` or `v<ver>` for a coordinated bump) if the project
   tags releases.

Keep the bump and the feature/fix commits separate: this commit changes only
`version`s, dependent pins, and the lockfile.
