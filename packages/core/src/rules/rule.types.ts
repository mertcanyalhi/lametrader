import type { Expiration } from '../expiration.types.js';
import type { Action } from './action.types.js';
import type { ConditionNode } from './condition.types.js';
import type { RuleScope } from './scope.types.js';
import type { Trigger } from './trigger.types.js';

/**
 * A persisted rule.
 *
 * Greenfield document shape per ADR 0016: scope / trigger / condition / actions
 * plus identity (`id`, `profileId`) and lifecycle (`enabled`, `order`,
 * `expiration`, `createdAt`, `updatedAt`).
 *
 * The event log lives behind the separate {@link EventLog} port; trigger
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
  /**
   * Last time the orchestrator fired this rule, in epoch-ms — stamped by the
   * orchestrator on every successful fire (see issue #426).
   *
   * Absent on a freshly-created rule and on rules that haven't fired since
   * `lastFiredAt` was introduced.
   * Surfaced in the rules table's "Last fired" column.
   */
  lastFiredAt?: number;
}
