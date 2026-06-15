/**
 * Recursively strip `readonly` modifiers from arrays and object properties.
 *
 * Lets the API boundary cast a domain type with `readonly` arrays (used internally for `as const` literal-type inference) to its structurally equivalent transport type (TypeBox `Static<>` infers mutable arrays).
 *
 * Type-only, zero runtime cost; the cast is provably correct because every `readonly` array is structurally a superset of its mutable counterpart (read-only is a constraint on the *holder*, not the data).
 */
export type DeepMutable<T> =
  T extends ReadonlyArray<infer U>
    ? DeepMutable<U>[]
    : T extends object
      ? { -readonly [K in keyof T]: DeepMutable<T[K]> }
      : T;
