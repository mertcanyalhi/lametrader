/**
 * Numeric operators for rule-condition leaves.
 *
 * The string value is the persisted/serialized tag (stable across JSON
 * round-trips).
 * Every variant requires both operands to resolve to a numeric value.
 */
export enum NumericOperator {
  /** Strict greater-than (`left > right`). */
  Gt = 'gt',
  /** Strict less-than (`left < right`). */
  Lt = 'lt',
  /** Greater-than-or-equal (`left >= right`). */
  Gte = 'gte',
  /** Less-than-or-equal (`left <= right`). */
  Lte = 'lte',
  /** Numeric equality (`left == right`). */
  Eq = 'eq',
  /** Numeric inequality (`left != right`). */
  Neq = 'neq',
  /** Sides swapped order between prev and current (direction-agnostic). */
  Crossing = 'crossing',
  /** Left moved from `<= right` to `> right` between prev and current. */
  CrossingUp = 'crossingUp',
  /** Left moved from `>= right` to `< right` between prev and current. */
  CrossingDown = 'crossingDown',
}

/**
 * State operators for rule-condition leaves.
 *
 * The string value is the persisted/serialized tag (stable across JSON
 * round-trips).
 * `Equals` / `NotEquals` work on any value type as long as both sides match;
 * `ChangesTo` / `ChangesFrom` require a {@link OperandKind.Literal} on the right.
 */
export enum StateOperator {
  /** Same-type equality (`left == right`); both sides must share `valueType`. */
  Equals = 'equals',
  /** Same-type inequality (`left != right`); both sides must share `valueType`. */
  NotEquals = 'notEquals',
  /** `prev != right` and `current == right`; right must be a literal target. */
  ChangesTo = 'changesTo',
  /** `prev == right` and `current != right`; right must be a literal source. */
  ChangesFrom = 'changesFrom',
}

/**
 * The union of every rule-condition operator.
 */
export type RuleOperator = NumericOperator | StateOperator;
