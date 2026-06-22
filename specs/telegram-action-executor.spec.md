# Spec: Telegram action executor

- Status: implemented
- Touches: `engine` (`packages/engine/src/rules/telegram-action-executor.ts`).

## Goal

Execute one `NotifyTelegram` action: render the template against the `EvaluationContext`'s fixed allow-list (`{symbolId}`, `{ts}`, `{prev}`, `{current}`), call the `Notifier` with the resolved body, and append one event entry to both the rule and symbol logs.
Failures (unknown token, unknown destination, transport error) are recorded as `Error` entries rather than thrown.

## Acceptance criteria

- [ ] On the happy path, renders the template, calls the notifier with the resolved body, and appends a `NotificationSent` entry to both the rule log and the symbol log.
- [ ] An unknown template token does not call the notifier and appends an `Error` entry naming the bad token.
- [ ] An unknown destination appends an `Error` entry identifying the missing destination.
- [ ] A transport failure appends an `Error` entry carrying the thrown error message.
- [ ] A `null` `prev` / `current` stringifies to the empty string in the rendered body.
- [ ] A non-`Number` `StateValue` (e.g. `Enum`) `prev` / `current` renders using its wrapped value.
