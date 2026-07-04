# @lametrader/core

The platform's shared **types** package.

`core` holds the type declarations, enums, and the handful of runtime constants that both the backend (`@lametrader/server`) and the browser app (`@lametrader/web`) need to agree on.
It performs no I/O and imports nothing outward — importing it never pulls domain logic or a server dependency into the browser bundle.

## What lives here

- **Type declarations** — interfaces, type aliases, and discriminated unions in `*.types.ts` modules grouped by context under `src/types/<context>/` (`market-data`, `config`, `indicators`, `profiles`, `state`, `notifications`, `rules`).
- **Enums** — every shared enum, e.g. `Period`, `SymbolType`, `StateValueType`, `ProfileScope`, `TriggerKind`, `RuleEventType`, `PriceSource`, `FieldType`, `RuleScopeKind`, `NotificationChannel`, `ActionKind`.
- **Shared runtime values** — the input-limit constants in `limits.ts` (`DESTINATION_NAME_MAX`, `CHAT_ID_MAX`, `BOT_TOKEN_MAX`, `RULE_NAME_MAX`, …) and the pure `periodMillis` helper.

## What does not live here

All domain **logic** and every domain **error class** live in `@lametrader/server` (`packages/server/src/domain/`).
Input validation/coercion (`parseConfig`, `validateIndicatorInputs`, `parseSymbolPeriods`, the rule condition normalize/validate helpers, …) and the error types the HTTP layer maps to status codes (`SymbolNotFoundError`, `MarketDataError`, `RuleError`, …) moved there when the hexagonal `engine` package was dissolved (ADR-0018).

## Usage

```ts
import { Period, periodMillis, SymbolType, type Candle } from '@lametrader/core';
```

The public surface is re-exported from `src/index.ts`; import from the package root, not from individual modules.
