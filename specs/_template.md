# Spec: <feature name>

- Status: draft | approved | implemented
- Touches: <port(s) / use-case / adapter(s)>

## Goal

One or two sentences: what behavior this adds and why.
Keep scope minimal — if it isn't needed now, it doesn't belong here.

## Acceptance criteria

Each bullet maps to exactly one test.
If a line of code maps to no bullet, it shouldn't be written.

- [ ] <observable behavior — one action, one outcome>
- [ ] <edge case worth a unit test>

## End-to-end expectation

The single happy path the e2e test asserts (poll -> persist -> process -> expect), plus the one critical failure mode (e.g. source unavailable).

## Out of scope

What this deliberately does NOT do, so the implementation stays small.

## Surprises

Anything that didn't work as expected during implementation — gotchas, workarounds, non-obvious constraints discovered along the way.
Filled in retroactively after the feature lands so the next reader doesn't rediscover them.
Default: empty (only fill when there's something to capture).
