# Spec: `OncePerMinute` trigger gate

- Status: implemented
- Touches: `engine` (`packages/engine/src/rules/once-per-minute-trigger-gate.ts`).

## Goal

The `OncePerMinute` trigger gate fires once when the rule's condition becomes true (false → true), then stays silent while it remains true; it re-arms when the condition flips false.
A min-interval guard further suppresses additional fires within `intervalMs` of the previous fire to absorb flapping.

## Acceptance criteria

- [ ] Fires on a false → true transition with no prior fire.
- [ ] Stays silent while the condition remains true (true → true).
- [ ] Does not fire when the condition is now false (re-arming).
- [ ] Fires again on a fresh false → true transition once the min-interval has elapsed.
- [ ] Suppresses a second fire within the min-interval (rapid flap).
- [ ] Ignores fires for other symbols when computing the min-interval.
