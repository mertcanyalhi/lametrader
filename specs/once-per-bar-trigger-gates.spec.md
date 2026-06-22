# Spec: `OncePerBar` and `OncePerBarClose` trigger gates

- Status: implemented
- Touches: `engine` (`packages/engine/src/rules/once-per-bar-trigger-gate.ts`).

## Goal

The `OncePerBar` gate returns `true` when no prior `Fired` event for `symbolId` lands in the same `period` bar as `currentTs`, deriving the bar boundary by aligning `ts` to `periodMillis(period)`.
The `OncePerBarClose` gate composes `OncePerBar` with a `final` check — a forming bar never satisfies it.

## Acceptance criteria

- [ ] `mayFireOncePerBar` returns `true` when the events log is empty.
- [ ] `mayFireOncePerBar` returns `false` when a prior `Fired` lands in the same bar as `currentTs`.
- [ ] `mayFireOncePerBar` returns `true` when the prior `Fired` is in the previous bar.
- [ ] `mayFireOncePerBar` ignores `Fired` events for other symbols.
- [ ] `mayFireOncePerBarClose` returns `false` on a forming bar regardless of prior fires.
- [ ] `mayFireOncePerBarClose` returns `true` on a final bar with no prior fires.
- [ ] `mayFireOncePerBarClose` returns `false` on a final bar when a prior `Fired` lands in the same bar.
- [ ] `mayFireOncePerBarClose` returns `true` on a final bar when the prior `Fired` is in the previous bar.
