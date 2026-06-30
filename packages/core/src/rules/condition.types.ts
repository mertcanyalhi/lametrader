import type { Period } from '../config.types.js';
import type { ConditionOperand } from './operand.types.js';
import type {
  ChannelOperator,
  ComparisonOperator,
  CrossingOperator,
  MovingOperator,
  StateOperator,
} from './operator.types.js';

/**
 * The family of a {@link LeafCondition} — disambiguates the operand layout the
 * leaf carries (binary, ternary, or unary+scalar-tuple).
 *
 * The string value is the persisted/serialized tag (stable across JSON
 * round-trips).
 */
export enum LeafConditionFamily {
  /** Binary snapshot comparison (`>`, `<`, `>=`, `<=`, `==`, `!=`). */
  Comparison = 'comparison',
  /** Binary series-aware crossing (`crossing`, `crossingUp`, `crossingDown`). */
  Crossing = 'crossing',
  /** Ternary series-aware channel test (`entering` / `exiting` / `inside`). */
  Channel = 'channel',
  /** Unary + scalar tuple series-aware movement detector. */
  Moving = 'moving',
  /** Snapshot / transition state test. */
  State = 'state',
}

/**
 * Binary snapshot comparison leaf.
 *
 * Carries `(left, right)`; may carry an `interval` when an operand is OHLCV or
 * an indicator reference that needs the bar period.
 */
export interface ComparisonLeafCondition {
  family: LeafConditionFamily.Comparison;
  operator: ComparisonOperator;
  left: ConditionOperand;
  right: ConditionOperand;
  interval?: Period;
}

/**
 * Series-aware crossing leaf.
 *
 * Carries `(left, right)`; walks `left`'s native timeline under
 * lookback-past-flats semantics (per ADR 0016 / CONTEXT.md series alignment).
 */
export interface CrossingLeafCondition {
  family: LeafConditionFamily.Crossing;
  operator: CrossingOperator;
  left: ConditionOperand;
  right: ConditionOperand;
  interval?: Period;
}

/**
 * Ternary series-aware channel leaf.
 *
 * Carries `(left, lower, upper)`; bounds are full operands (literal, indicator,
 * OHLCV, etc.) so the channel can be a fixed band or a dynamic envelope.
 */
export interface ChannelLeafCondition {
  family: LeafConditionFamily.Channel;
  operator: ChannelOperator;
  left: ConditionOperand;
  lower: ConditionOperand;
  upper: ConditionOperand;
  interval?: Period;
}

/**
 * Unary + scalar tuple series-aware movement leaf.
 *
 * Carries `(left, threshold, lookbackBars)`; for absolute variants `threshold`
 * is a literal number, for percent variants it's a percentage.
 */
export interface MovingLeafCondition {
  family: LeafConditionFamily.Moving;
  operator: MovingOperator;
  left: ConditionOperand;
  /** Scalar threshold (absolute units or %, by operator). */
  threshold: number;
  /** Integer count of bars to look back on the row's `interval`. */
  lookbackBars: number;
  interval?: Period;
}

/**
 * Snapshot / transition state leaf.
 *
 * Carries `(left, right)`; `ChangesTo` / `ChangesFrom` require a `Literal` on
 * the right per the v1 contract carried forward (per CONTEXT.md).
 */
export interface StateLeafCondition {
  family: LeafConditionFamily.State;
  operator: StateOperator;
  left: ConditionOperand;
  right: ConditionOperand;
  interval?: Period;
}

/**
 * One leaf of a rule's condition tree — discriminated by operator family so the
 * operand layout is statically enforced per family.
 *
 * The bool-operand shortcut (UI hides operator + RHS for a Bool indicator
 * state-key) is stored as a {@link StateLeafCondition} of
 * `Equals(operand, Literal(true))` — no separate `IsTruthy` operator.
 */
export type LeafCondition =
  | ComparisonLeafCondition
  | CrossingLeafCondition
  | ChannelLeafCondition
  | MovingLeafCondition
  | StateLeafCondition;

/**
 * The kind of a {@link ConditionNode} — its role in the condition tree.
 *
 * The string value is the persisted/serialized tag.
 */
export enum ConditionNodeKind {
  /** A group whose children are all true. */
  And = 'and',
  /** A group with at least one true child. */
  Or = 'or',
  /** A leaf carrying a single {@link LeafCondition}. */
  Leaf = 'leaf',
}

/**
 * One node of a rule's condition tree — a leaf wrapping a
 * {@link LeafCondition}, or a nested AND/OR group of further nodes.
 */
export type ConditionNode =
  | { kind: ConditionNodeKind.And; children: ConditionNode[] }
  | { kind: ConditionNodeKind.Or; children: ConditionNode[] }
  | { kind: ConditionNodeKind.Leaf; leaf: LeafCondition };
