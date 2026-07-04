---
name: tidy-comments
description: Audit and clean code comments — delete obvious/dead ones, condense sprawl into terse pointer lines, turn what-comments into why-comments. Reports findings grouped by file, applies after confirmation. Use when the user says "tidy comments", "clean up comments", "fix the comments", or /tidy-comments. Default scope is the whole repo; pass a path to narrow it.
---

# Tidy Comments

Clean comments to match the project's bar: no noise, human-readable, why-not-what.

## Scope

- No arg → whole repo (skip `node_modules`, `dist`, `coverage`, lockfiles, generated files).
- Arg given → that file or directory only.

## Operate: report, then apply

1. Scan in scope. Collect every finding.
2. Print findings grouped by file: `path:line` — category — current → proposed.
3. Ask the user to confirm (all / per-file / skip-some).
4. Apply confirmed edits. Run `npm run check` (typecheck + lint) — comment edits change no behavior, so a red check means an edit broke something.

## Precision requirements — non-negotiable

- **Quote the exact text verbatim.** Never paraphrase or summarize. If the comment spans lines, include all of them.
- **Verify line numbers** by reading the file. Never guess or infer. A finding with a wrong line number is worse than no finding.
- **When in doubt, keep.** False positives (flagging a good comment) are worse than false negatives. Only flag what clearly violates; don't reach.

## The one test: can you reconstruct it from the code in 5 seconds?

Yes → DELETE candidate. No → KEEP.

A comment that answers "why this order?", "why this number?", "why not the obvious alternative?", "what invariant does this maintain?" passes the test — keep it even if it is verbose.

## Delete

Inline comments only (`//` not inside JSDoc). Never touch `/** */` blocks.

- Restates the name on the same line: `i++ // increment`, `setLoading(true) // set loading to true`.
- Restates what the code obviously does: `// loop over items`, `// return early`.
- Commented-out dead code — git remembers it.
- Filler / vague noise: "simple helper", "handle stuff", "some logic".
- Section dividers: `// ===== HELPERS =====`.
- An obvious sentence inside an otherwise-useful multi-line block — cut the sentence, keep the block.

**Do not delete** a comment just because it is long or multi-line. Length alone is not a violation.

## Rewrite

Only rewrite when the improvement is clear and the meaning is preserved exactly.

- Prose sprawled across 4+ lines that could be 1–2 pointer lines, without losing meaning.
- A WHAT comment where a WHY would serve better: `// set timeout to 30s` → `// 30s: matches the broker's order-ack SLA`.
- A vague term that has a concrete equivalent: `// adjust the value` → `// round up to tick size (e.g. 0.01 for BTC/USD)`.
- Rewrite proposals must preserve every fact in the original. If you'd have to drop a constraint or caveat to shorten it, leave it alone.

## Keep — never touch

- `/** */` JSDoc on any symbol — the project mandates it.
- Any comment explaining ordering, sequencing, or timing constraints ("must run before X", "deferred until Y settles").
- Any comment explaining why a non-obvious alternative was rejected.
- Invariants, units, gotchas, issue/ADR links, `ponytail:` notes.
- Accessibility rationale (a11y decisions are non-obvious to future readers).
- Functional pragmas: `biome-ignore`, `@vitest-environment`, `@ts-*`, license headers, eslint directives.
- `TODO` / `FIXME` — surface vague ones in the report, never delete.

## Flag, don't fix

A comment that contradicts the code is either stale or hiding a bug — you can't tell which. List under **NEEDS-HUMAN** with both sides verbatim; don't silently rewrite.

## Output format

Group by file. One finding per line:

```
packages/foo/bar.ts:42 — DELETE — "// loop over items"
packages/foo/bar.ts:55 — REWRITE — "// We do X because Y and Z and..." → "// X: Y. Z."
packages/foo/bar.ts:70 — NEEDS-HUMAN — comment says "never null" but line 71 handles null
```

Omit files with no findings. End with totals: `DELETE: N  REWRITE: N  NEEDS-HUMAN: N`.
