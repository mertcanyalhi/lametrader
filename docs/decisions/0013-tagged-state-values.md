# State values are a tagged union, not bare `unknown`

- Status: accepted

## Context

The rules engine's state store holds arbitrary user-defined keys (`symbol.trend`, `global.regime`, …) with values that the user picks the shape of at rule-creation time.
Two reasonable shapes for the stored value:

1. **Bare `unknown`** — the store stashes whatever JSON the user wrote; the evaluator and operator validators read it back and try to do something sensible.
2. **Tagged union** — every value carries its kind alongside its data (`{ type: 'number', value: 42 }`), so reads know what they're holding without inspecting it.

The operators that consume state values fork on the value's type: `Equals`/`NotEquals` apply to every kind; `ChangesTo`/`ChangesFrom` are state-flavoured; numeric comparisons need a number on both sides; the `enum` flavour exists specifically so the rule editor can render a dropdown instead of a free-text input.
Whichever shape we pick has to make that operator-vs-value-type compatibility checkable somewhere.

## Decision

```ts
enum StateValueType { String, Number, Bool, Enum }
type StateValue =
  | { type: StateValueType.String; value: string }
  | { type: StateValueType.Number; value: number }
  | { type: StateValueType.Bool;   value: boolean }
  | { type: StateValueType.Enum;   value: string };
```

The `type` discriminant is the source of truth; the validator (`validateOperatorOperands`) reads it to decide which operators are legal against which operands.
JSON round-trip through Mongo and the API is the literal `{ type, value }` object — no flattening, no coercion at the boundary.

The companion guards (`isNumber(v): v is StateValue & { type: Number }`, etc.) live in `@lametrader/core`.

## Consequences

- **The evaluator never guesses.** Every operator implementation switches on `type` and reads the right field; an enum value compared to a string surfaces as a type-system mismatch at the operand picker, not as silent stringification at runtime.
- **The rule editor stays honest.** The operand picker shows the value's `type`, the operator picker filters by it, the literal editor renders the right input (number, text, checkbox, dropdown).
  No "type unknown → free-text fallback" path that gets it wrong half the time.
- **One extra field on every write.** `{ type, value }` is bigger than the raw value would be; for the volumes this app handles, the cost is negligible.
- **Enum vs string is a deliberate split.** `enum` and `string` both carry strings at runtime, but the type signals "this is one of a fixed set" to the editor (dropdown) and to the user (clearer intent).
  The set of allowed enum members lives on the producing rule's action, not on the value itself — keeping the value shape small and avoiding a registry of "known enums".
- **Adding a new kind (e.g. `Date`) is a controlled change.** Bumping the enum, adding a union arm, and the type-checker walks every operator/validator/renderer that needs an update.
  Bare `unknown` would have made the same change silent.
- **This forecloses on shapes we don't yet support** — no arrays, no nested objects, no `null` as a first-class value (remove the key instead).
  When one of those is genuinely needed, it's a new ADR, not a quiet broadening.

## Closes

#99.
