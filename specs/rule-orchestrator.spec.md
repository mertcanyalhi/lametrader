# Spec: rule orchestrator

- Status: implemented
- Touches: `engine` (`packages/engine/src/rules/rule-orchestrator.ts`).

## Goal

Top-level rule engine entry point that drives one inbound `RuleEvent` through the loop: load matching enabled rules in `order`, build an `EvaluationContext`, evaluate the condition tree, run the trigger gate, execute actions, and append the matching rule-event entries.
State mutations made by actions re-enter the loop in the same tick via a `StateRepository.onStateChanged` subscription, bounded by a `CycleGuard` that records exactly one `CycleOverflow` entry on overflow.

## Acceptance criteria

- [ ] Fires enabled rules in `order` against one event.
- [ ] Cascades state changes from one rule's actions into a downstream rule in the same tick.
- [ ] Stops cascading and records exactly one `CycleOverflow` event when the cycle limit is breached.
- [ ] Does not fire disabled rules.
- [ ] Filters out `Symbol`-scoped rules whose `symbolId` does not match the event.
- [ ] `AllSymbols`-scoped rules fire on the event's symbol.
- [ ] Runs a rule's actions in declaration order and records exactly one `Fired` event after them.
- [ ] Treats `expiration.at` strictly greater than `ts` as still-active.
- [ ] `OncePerMinute` fires on a false → true transition across two events and is suppressed on a second false → true within the interval.
- [ ] Skips a rule whose expiration has passed and emits exactly one `Expired` event per symbol across repeated post-expiry events.
- [ ] Fans an `AllSymbols`-scoped rule out across every watched symbol on a `Timer` event.
- [ ] Fires only rules belonging to the active profile when `getActiveProfileId` is configured.
