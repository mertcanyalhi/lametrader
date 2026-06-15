# 0009. Profile scope and the symbol-removal cascade

- Status: accepted
- Date: 2026-06-15

## Context

A profile (see `specs/profile-crud.spec.md`) selects which watched symbols it
applies to: either **all** of them or an **explicit subset** of watched symbol ids,
embedded on the profile aggregate. The watchlist is mutable — symbols are added and
removed independently of profiles — so a profile's subset can drift out of sync with
what is actually watched. Two forces needed a decision:

1. **What a subset may reference, and what an empty subset means.** A subset that
   names symbols nobody watches is meaningless, and "an explicit subset of nothing"
   is ambiguous (apply to none? to all?).
2. **What happens to subsets when a symbol leaves the watchlist**, and **where that
   cross-aggregate reaction lives** — profiles and symbols are separate aggregates
   with separate use-cases.

`SymbolService.remove` already cascades to candle deletion, so symbol removal is an
established fan-out point.

## Decision

Scope is a discriminated union (`{ type: all }` or `{ type: symbols, symbolIds }`)
embedded on the profile, with these rules:

- **Direct writes** (create / replace / update) **validate** that every id in a
  `symbols` scope is currently watched — an unwatched id is a client error
  (`ProfileError` → 400). An **empty** subset **normalizes to `all`** (an empty
  explicit subset never persists from user input).
- **Symbol removal** cascades: `SymbolService.remove` calls
  `ProfileService.pruneSymbol`, which removes the id from every profile's subset. A
  profile whose subset becomes **empty as a result is disabled** (`enabled = false`)
  and **kept `symbols`-scoped** — it goes dormant rather than silently widening to
  `all`.
- **Coupling direction:** `SymbolService` takes an optional `ProfileService` and
  invokes it on removal (mirroring its existing candle cascade). `ProfileService`
  depends only on `ProfileRepository` and `WatchlistRepository`, so the dependency
  graph stays acyclic.

## Consequences

- A persisted profile scope can never reference an unwatched symbol, and removing a
  symbol can never accidentally **broaden** a narrowly-scoped profile — the safer
  failure mode (dormant) over the surprising one (suddenly applies to everything).
- The normalization rules are deliberately **asymmetric**: an empty subset from
  *user input* becomes `all`, but an empty subset reached via *cascade* disables the
  profile. This is intentional (explicit intent vs an incidental side effect) and is
  the main thing a reader might find surprising — hence this record.
- A profile can end up disabled with an empty `symbols` subset. Re-enabling it goes
  through the normal write path, so the user must give it targets or it normalizes to
  `all` — a conscious dormant state, not a hidden one.
- `SymbolService` gains a dependency on `ProfileService` (optional, so existing
  constructions and focused tests are unaffected). This is cross-aggregate coupling
  inside the application layer; accepted because removal is already a cascade point
  and the direction stays acyclic.
- `pruneSymbol` iterates all profiles on each removal (no per-symbol index). Fine at
  the expected scale; a reverse index is deferred until profile counts make the scan
  matter.
