import type { Expiration } from '../expiration.types.js';
import type { Action } from './action.types.js';
import type { ConditionNode } from './condition.types.js';
import type { RuleScope } from './scope.types.js';
import type { Trigger } from './trigger.types.js';

/**
 * A persisted v2 rule.
 *
 * Greenfield document shape per ADR 0016: scope / trigger / condition / actions
 * plus identity (`id`, `profileId`) and lifecycle (`enabled`, `order`,
 * `expiration`, `createdAt`, `updatedAt`).
 *
 * v1's embedded `events` / `history` / `firingState` arrays are NOT carried
 * forward; the v2 event log lives behind the new `EventLog` port and trigger
 * latches are owned by the trigger evaluator.
 */
export interface Rule {
  /** Generated, stable id. */
  id: string;
  /** The parent profile's id. */
  profileId: string;
  /** Human-readable name (non-empty). */
  name: string;
  /** Optional free-text description. */
  description?: string;
  /** Which symbol(s) the rule applies to. */
  scope: RuleScope;
  /** The condition tree evaluated each cadence tick. */
  condition: ConditionNode;
  /** Which evaluation cadence drives the rule and how often it may re-fire. */
  trigger: Trigger;
  /** When the rule stops firing (or `null` for never). */
  expiration: Expiration;
  /** Side-effects performed on fire (non-empty). */
  actions: Action[];
  /** Whether the rule is currently active. */
  enabled: boolean;
  /** Ordering hint within the parent profile. */
  order: number;
  /** Creation time (epoch ms). */
  createdAt: number;
  /** Last-update time (epoch ms). */
  updatedAt: number;
}
