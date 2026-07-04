# Web form validation with Yup, scoped to the UI

- Status: accepted

## Context

The settings form needs per-field, user-friendly validation messages — e.g. "Default period is required." shown inline on the control, with the field's human label rather than its property name.

`@lametrader/core`'s `parseConfig` is the platform's authoritative config validator and is reused by the API.
Issue #34 deliberately reused it on the frontend too ("no zod … the domain validator is the single source of truth") to avoid duplicating rules.
In practice that doesn't give good form UX: `parseConfig` throws a single `ConfigError` with a domain-phrased message that embeds the property name (`"defaultPeriod must not be empty"`) and carries no per-field structure.
Attempts to bridge it — manual presence guards, tagging `ConfigError` with a `field`, string-rewriting the message — were each either rule duplication or hacky string surgery.
Neither react-hook-form nor `parseConfig` has a native field-label/message facility; that is a schema-library feature.

## Decision

Use **Yup** (`yup` + `@hookform/resolvers/yup`) for the **web UI's** form validation, **only** in user-facing schemas.
The schema (`packages/ui/src/lib/config-schema.ts`) expresses the form's rules declaratively with `.label(...)`, so messages are per-field, label-aware, and per-rule.

`parseConfig` remains the **authoritative** validator: the API re-validates every write, so the Yup schema is a UX layer, not the source of truth.
This is scoped to the web package — `core`, `engine`, and the API do **not** adopt a schema library.

## Consequences

- The settings form gets clean, declarative, per-field messages with field labels, the standard react-hook-form pattern (`yupResolver`).
- It reverses issue #34's "single source of truth" stance: the config rules now exist in two places — the Yup schema (client UX) and `parseConfig` (server authority) — and could drift. The server is the backstop: an out-of-date client schema can only be over- or under-eager about *messages*; an actually-invalid write is still rejected by `parseConfig` with a 400 the form surfaces.
- The duplication is intentionally confined to **user-facing** schemas. Backend/domain validation stays single-sourced in `parseConfig`.
- New web forms validate with Yup schemas (in `packages/ui/src/lib/*`), not by reusing domain validators.
