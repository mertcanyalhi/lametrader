# Backtest completed-at and duration

A completed backtest records **when it finished** and the run details surface both the
completion timestamp and how long the run took, alongside the existing "Ran at".

The finish time is an immutable `completedAt` stamped once when the run flips
`Running → Completed`; unlike `updatedAt` it is never touched by a later rename, so the
displayed duration stays correct for the life of the saved run.

## Acceptance criteria

- The `Backtest` domain type carries an optional `completedAt` (epoch ms), set only on a
  completed run.
- `BacktestService` stamps `completedAt` (equal to the completion `updatedAt`) when a run
  completes, and a subsequent `rename` leaves `completedAt` unchanged while it bumps
  `updatedAt`.
- The Mongoose repository round-trips `completedAt`, dropping the key when absent (matching
  the `openPosition` pattern), so pre-existing documents without it read back cleanly.
- The run-details list renders a "Completed at" row (the `completedAt` timestamp) and a
  "Duration" row (`completedAt − createdAt` via `formatDuration`) whenever `completedAt` is
  present, and omits both rows when it is absent.
