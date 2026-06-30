/**
 * Numeric comparison operators — stateless tests on the latest operand values.
 *
 * The string value is the persisted/serialized tag (stable across JSON
 * round-trips).
 */
export enum ComparisonOperator {
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
}

/**
 * Series-aware crossing operators — detect that the left operand crossed the
 * right under lookback-past-flats semantics.
 */
export enum CrossingOperator {
  /** Either crossing-up or crossing-down. */
  Crossing = 'crossing',
  /** Left moved from `<= right` to `> right` (after walking back past flats). */
  CrossingUp = 'crossingUp',
  /** Left moved from `>= right` to `< right` (after walking back past flats). */
  CrossingDown = 'crossingDown',
}

/**
 * Series-aware channel operators — ternary tests against operand-typed bounds.
 *
 * The leaf carries `(left, lower, upper)`; the walk skips points sitting on
 * either boundary (same lookback-past-flats family as crossing).
 */
export enum ChannelOperator {
  /** Baseline strictly outside `[lower, upper]`; latest inside or on boundary. */
  EnteringChannel = 'enteringChannel',
  /** Baseline strictly inside `(lower, upper)`; latest outside or on boundary. */
  ExitingChannel = 'exitingChannel',
  /** Latest is inside `[lower, upper]`. */
  InsideChannel = 'insideChannel',
}

/**
 * Series-aware movement operators — detect a directional change of the left
 * operand over an integer `lookbackBars` window.
 *
 * Absolute variants compare against a scalar threshold; percent variants
 * compare against a percentage of the prior value.
 */
export enum MovingOperator {
  /** Moved up by at least `threshold` (absolute) over `lookbackBars`. */
  MovingUp = 'movingUp',
  /** Moved down by at least `threshold` (absolute) over `lookbackBars`. */
  MovingDown = 'movingDown',
  /** Moved up by at least `threshold` percent over `lookbackBars`. */
  MovingUpPercent = 'movingUpPercent',
  /** Moved down by at least `threshold` percent over `lookbackBars`. */
  MovingDownPercent = 'movingDownPercent',
}

/**
 * State operators — snapshot equality and transition checks.
 *
 * `Equals` / `NotEquals` compare current values; `ChangesTo` / `ChangesFrom`
 * compare the prev→current transition against a literal target/source.
 */
export enum StateOperator {
  /** Same-type equality (`left == right`). */
  Equals = 'equals',
  /** Same-type inequality (`left != right`). */
  NotEquals = 'notEquals',
  /** `prev != right` and `current == right`. */
  ChangesTo = 'changesTo',
  /** `prev == right` and `current != right`. */
  ChangesFrom = 'changesFrom',
}

/**
 * The union of every rule-condition operator.
 *
 * Five families; the {@link LeafCondition} variant carrying the operator also
 * disambiguates the operand layout.
 */
export type Operator =
  | ComparisonOperator
  | CrossingOperator
  | ChannelOperator
  | MovingOperator
  | StateOperator;
