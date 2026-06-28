import { validateAction } from './action.js';
import { validateConditionTree } from './condition-tree.js';
import { validateExpiration } from './expiration.js';
import { RULE_DESCRIPTION_MAX, RULE_NAME_MAX, SYMBOL_ID_MAX } from './limits.js';
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
 * Raised when a {@link Rule} does not exist (on get / replace / remove).
 *
 * Driving adapters map it to HTTP 404.
 */
export class RuleNotFoundError extends Error {
  /**
   * @param message - human-readable not-found reason.
   */
  constructor(message: string) {
    super(message);
    this.name = 'RuleNotFoundError';
  }
}

/**
 * Raised when a v2 rule with a tick-cadence trigger
 * (`EveryTime` / `Once` / `OncePerBar`) references one or more symbols that
 * are not on the watchlist.
 *
 * Per ADR 0016: per-tick triggers require a live `QuoteStreamService`
 * subscription, which is gated by watchlist membership. The driving adapter
 * inspects {@link unwatchedSymbolIds} so it can surface a `fields[]` 400
 * pointing at the offending scope path(s).
 */
export class TickRuleNotEligibleError extends Error {
  /**
   * @param message - human-readable reason.
   * @param unwatchedSymbolIds - the symbol ids that failed the watchlist check (one or more).
   */
  constructor(
    message: string,
    readonly unwatchedSymbolIds: readonly string[],
  ) {
    super(message);
    this.name = 'TickRuleNotEligibleError';
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
 * Reject strings longer than `max`.
 */
function requireMaxLength(value: string, field: string, max: number): void {
  if (value.length > max) {
    throw new RuleError(`Rule '${field}' must be ${max} characters or fewer.`);
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
  requireMaxLength(rule.name, 'name', RULE_NAME_MAX);
  if (rule.description !== undefined) {
    requireMaxLength(rule.description, 'description', RULE_DESCRIPTION_MAX);
  }

  if (rule.scope.kind === RuleScopeKind.Symbol) {
    requireNonEmpty(rule.scope.symbolId, 'scope.symbolId');
    requireMaxLength(rule.scope.symbolId, 'scope.symbolId', SYMBOL_ID_MAX);
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
