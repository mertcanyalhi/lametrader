---
description: Relentless interview that captures terms in CONTEXT.md and offers ADRs as decisions crystallise.
---

Interview me relentlessly about every aspect of this plan or design, capturing the language and decisions as we go.

## Interview

Walk down each branch of the design tree, resolving dependencies between decisions one-by-one.
For each question, provide your recommended answer.

Ask the questions one at a time, waiting for feedback on each question before continuing.
Asking multiple questions at once is bewildering.

If a question can be answered by exploring the codebase, explore the codebase instead.

## Maintain the domain model

Actively build and sharpen the project's domain model as the interview unfolds.
This is the active discipline — challenging terms, inventing edge-case scenarios, and writing the glossary down the moment terms crystallise.

### File structure

Most repos have a single context: one `CONTEXT.md` at the repo root.

If a `CONTEXT-MAP.md` exists at the root, the repo has multiple contexts.
The map points to where each one lives (e.g. `packages/<n>/CONTEXT.md`).

Create files lazily — only when you have something to write.
If no `CONTEXT.md` exists, create one when the first term is resolved.

### Challenge against the glossary

When I use a term that conflicts with the existing language in `CONTEXT.md`, call it out immediately.
"Your glossary defines 'cancellation' as X, but you seem to mean Y — which is it?"

### Sharpen fuzzy language

When I use vague or overloaded terms, propose a precise canonical term.
"You're saying 'account' — do you mean the Customer or the User? Those are different things."

### Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios.
Invent scenarios that probe edge cases and force precision about the boundaries between concepts.

### Cross-reference with code

When I state how something works, check whether the code agrees.
If you find a contradiction, surface it: "Your code cancels entire Orders, but you just said partial cancellation is possible — which is right?"

### Update CONTEXT.md inline

When a term is resolved, update `CONTEXT.md` right there.
Don't batch these up — capture them as they happen.
Use the format in [docs/context-format.md](../../docs/context-format.md).

`CONTEXT.md` should be totally devoid of implementation details.
Do not treat `CONTEXT.md` as a spec, a scratch pad, or a repository for implementation decisions.
It is a glossary and nothing else.

## Offer ADRs sparingly

Only offer to create an ADR when all three are true:

1. **Hard to reverse** — the cost of changing your mind later is meaningful.
2. **Surprising without context** — a future reader will wonder "why did they do it this way?".
3. **The result of a real trade-off** — there were genuine alternatives and you picked one for specific reasons.

If any of the three is missing, skip the ADR.
When all three hold, run `/adr` to create the ADR under this repo's existing `docs/decisions/` convention.

## Invocation

- "Walk me through the <domain> model and update `CONTEXT.md` as we go"
- "Interview me on this design and capture the glossary + any ADRs"
- "Sharpen the language for the <feature> context"

