# Prefer established, non-commercial dependencies

- Status: accepted

## Context

An earlier stance favored native Node over libraries (hand-rolling with `fetch`,
`WebSocket`, `node:util parseArgs`, etc.). In practice that traded reinvention and
maintenance burden for marginal dependency savings.

## Decision

Prefer well-established, non-commercial (open-source / freely licensed) industry-
standard packages wherever they fit. Avoid commercial/paid dependencies and obscure
or unmaintained ones. This reverses the native-first preference.

## Consequences

- Less reinvention; we lean on vetted ecosystems (e.g. vitest, biome, yahoo-finance2).
- Each new dependency still needs a quick vetting pass (maintenance, license, footprint).
- Supersedes the prior "prefer native Node over libraries" guidance.
