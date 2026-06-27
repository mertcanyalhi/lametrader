# Triage labels

The `/triage`, `/to-issues`, and `/to-prd` commands assume the following labels exist on the GitHub repository.
Create them once.
If your tracker uses different label strings, edit the slash command files to remap.

Every triaged issue (or external PR) carries **exactly one category label and one state label**.

## Category labels

- `bug` — something is broken.
- `enhancement` — new feature or improvement.

## State labels

- `needs-triage` — maintainer needs to evaluate.
- `needs-info` — waiting on reporter for more information.
- `ready-for-agent` — fully specified, ready for an AFK agent to pick up.
- `ready-for-human` — needs human implementation (judgment calls, external access, design decisions, manual testing).
- `wontfix` — will not be actioned.

## State transitions

An unlabeled issue normally goes to `needs-triage` first.
From `needs-triage` it moves to `needs-info`, `ready-for-agent`, `ready-for-human`, or `wontfix`.
`needs-info` returns to `needs-triage` once the reporter replies.
The maintainer can override at any time.
Flag transitions that look unusual and ask before proceeding.

## External PRs

If the repo treats external pull requests as a request surface, triage covers them too — **a PR is an issue with attached code**, same roles, same states.
A collaborator's in-flight PR is not triage work; only external authors' PRs are surfaced by discovery.

