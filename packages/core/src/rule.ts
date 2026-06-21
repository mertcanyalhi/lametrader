import { validateAction } from './action.js';
import { validateConditionTree } from './condition-tree.js';
import { validateExpiration } from './expiration.js';
import { type Rule, RuleScopeKind } from './rule.types.js';
import { validateTrigger } from './trigger.js';

/**
 * Thrown when a {@link Rule}'s rule-level fields (non-empty name, non-empty
 * actions, scope's symbol id) are invalid.
 *
 * Per-piece validators (condition / trigger / expiration / action) throw their
 * own typed errors; `validateRule` lets those propagate.
 *
 * Caught at the API/CLI boundary so user-facing errors surface as 400s.
 */
export class RuleError extends Error {
  /**
   * @param message - human-readable reason.
   */
  constructor(message: string) {
    super(message);
    this.name = 'RuleError';
  }
}

/**
 * Reject empty / whitespace-only strings.
 */
function requireNonEmpty(value: string, field: string): void {
  if (value.trim() === '') {
    throw new RuleError(`Rule '${field}' must be a non-empty string.`);
  }
}

/**
 * Validate a full {@link Rule} — rule-level checks (non-empty `id`,
 * `profileId`, `name`; non-empty `actions`; scope's `symbolId`) plus every
 * per-piece validator on the embedded condition, trigger, expiration, and each
 * action.
 *
 * @param rule - the rule to check.
 * @param now - the reference instant (epoch ms) passed to
 *   {@link validateExpiration}.
 * @throws {RuleError} on rule-level violations.
 * @throws {RuleConditionError | RuleOperatorError | TriggerError |
 *   ExpirationError | ActionError} from the per-piece validators.
 */
export function validateRule(rule: Rule, now: number): void {
  requireNonEmpty(rule.id, 'id');
  requireNonEmpty(rule.profileId, 'profileId');
  requireNonEmpty(rule.name, 'name');

  if (rule.scope.kind === RuleScopeKind.Symbol) {
    requireNonEmpty(rule.scope.symbolId, 'scope.symbolId');
  }

  validateConditionTree(rule.condition);
  validateTrigger(rule.trigger);
  validateExpiration(rule.expiration, now);

  if (rule.actions.length === 0) {
    throw new RuleError('Rule must have at least one action.');
  }
  for (const action of rule.actions) {
    validateAction(action);
  }
}
