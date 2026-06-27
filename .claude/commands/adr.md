---
description: Create the next-numbered Architecture Decision Record from the template.
argument-hint: <decision title>
---

Create a new ADR capturing: $ARGUMENTS

1. Look in `docs/decisions/` for the highest existing `NNNN` and use `NNNN + 1`, zero-padded to four digits.
2. Copy `docs/decisions/_template.md` to `docs/decisions/<NNNN>-<kebab-title>.md`.
3. Fill in Status (`accepted`) and draft the Context and Decision sections from our discussion.
   Include Considered Options only when the rejected alternatives are worth remembering; otherwise remove that section.
   Include Consequences only when non-obvious downstream effects need calling out; otherwise remove that section.
   If a prior ADR is being reversed, set its Status to `superseded by <NNNN>`.
4. Show me the draft and ask for confirmation before finalizing if anything is uncertain.
