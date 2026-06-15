---
description: Create the next-numbered Architecture Decision Record from the template.
argument-hint: <decision title>
---

Create a new ADR capturing: $ARGUMENTS

1. Look in `docs/decisions/` for the highest existing `NNNN` and use `NNNN + 1`, zero-padded to four digits.
2. Copy `docs/decisions/_template.md` to `docs/decisions/<NNNN>-<kebab-title>.md`.
3. Fill in Status (`accepted`), today's date, and draft the Context / Decision / Consequences sections from our discussion.
   If a prior ADR is being reversed, set its Status to `superseded by <NNNN>`.
4. Show me the draft and ask for confirmation before finalizing if anything is uncertain.
