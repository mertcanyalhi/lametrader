# 0014. Embed firing-state on the rule document, drop firing_state collection

- Status: accepted
- Date: 2026-06-27

## Context

The `OncePerMinute` trigger gate needs a per-`(ruleId, symbolId)` "currently active" bit so it can detect the false → true transitions that gate re-firing across restarts.
The first cut stored that bit in its own Mongo collection (`firing_state`), one document per pair, keyed by a compound `_id`.

Three forces have accumulated since then:

1. **It's internal plumbing, not user-facing state.**
   The orchestrator and the trigger gate are the only readers; the latch never surfaces in API responses, CLI output, or the web UI.
2. **The rule document already embeds related runtime arrays.**
   ADR 0012 chose embedded `events[]` and `history[]` over a sibling collection for the same reason — single-document reads, no cross-collection cursor, lifecycle cleanup falls out for free.
3. **The cleanup cascade is explicit code on two paths.**
   `RuleService.remove` and `ProfileService.remove` both call `FiringStateRepository.removeByRule` after deleting the rule(s).
   Both call-sites disappear if the latch lives on the rule.

## Decision

Embed the latch as a sub-doc map on the rule:

```ts
Rule.firingState?: Record<string /* symbolId */, boolean>
```

- **Storage shape.**
  The Mongo `FiringStateRepository` reads and writes the dotted path `firingState.{symbolId}` on the `rules` collection — `findOne({ _id: ruleId }, { projection: { 'firingState.{symbolId}': 1 } })` for reads, `$set: { 'firingState.{symbolId}': active }` for writes.
  Two symbols on the same rule never replace each other's slot.
- **No standalone `firing_state` collection.**
  The Mongo adapter operates against the rule document directly; the old collection is dropped.
- **No more `removeByRule`.**
  The port loses the method; `RuleService.remove` and `ProfileService.remove` drop their explicit cascades.
  Entries vanish implicitly when the rule document is deleted.
- **Default `false` for unset entries.**
  Missing keys read as `false` — no backfill needed, no migration logic in the read path.
- **Optional on the domain `Rule`.**
  Marked `firingState?: Record<string, boolean>` so existing rule constructions and test fixtures don't need to seed an empty map.
  The orchestrator never reads the field off the rule object; it goes through the `FiringStateRepository` port either way.
- **Not exposed via the API.**
  `RuleSchema` (the Fastify response schema) intentionally omits `firingState`; `additionalProperties: false` strips it from serialized responses.
- **`RuleService.replace` preserves the existing latch.**
  The in-memory rule is reloaded before save, so its `firingState` survives the `replaceOne` round-trip.
  Other mutators (`setEnabled`, `reorder`) already preserve the field via `{ ...existing, ... }`.

## Consequences

**Single-document lifecycle**

- Rule delete + profile delete cascade clean up the latch implicitly — no separate code path, no chance of orphaned firing-state docs lingering when a cascade misses a step.
- A `RuleService.replace` race that wrote the rule between an orchestrator read and write would now overwrite the latch.
  We preserve `existing.firingState` in the in-memory `Rule` passed to `save`, which contains the read-side bit; the standing race window (load → save) is the same one we accept for `events[]` and `history[]`.

**Document size**

- The latch grows with the number of subscribed symbols — the same growth shape ADR 0012 already accepted for `events[]`.
  `Symbol`-scoped rules carry exactly one entry; `AllSymbols`-scoped rules carry one per watched symbol.

**Port shape**

- `FiringStateRepository` stays — the orchestrator and the gate remain decoupled from the storage shape — but loses `removeByRule`.
  The contract test seeds rule docs before exercising read/write, since the Mongo adapter's `$set` targets an existing document (no `upsert` — that would create orphan rule docs).

**Migration**

- Existing rules pre-migration have no `firingState` field; reads default to `false` and the next write creates the field via `$set`.
- Orphan documents in the pre-existing `firing_state` collection can be dropped — they were only ever a per-`(rule, symbol)` cache.
  No data is lost; the OncePerMinute gate's worst case after migration is one spurious or one missed transition on the first evaluation after a restart, the same window the system already tolerates between writes.

**Out of scope**

- Reworking `OncePerMinute` trigger semantics; only the latch's storage location changes.
- Symbol-side embedding (no existing symbol-delete cascade for firing state, and rule-trigger ownership lives with the rule).
- Removing the `FiringStateRepository` port — the orchestrator and gate stay decoupled from storage; only the Mongo impl moves.

## Closes

#279.
