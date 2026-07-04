/**
 * DI token for the {@link import('@lametrader/core').RuleRepository} port.
 *
 * The port is a `@lametrader/core` interface, so it has no runtime value to
 * inject by type; this string token binds it to its concrete provider (the
 * Mongoose adapter in production, an in-memory fake under a Nest DI override in
 * tests).
 *
 * Owned and bound exactly once by
 * {@link import('./rules.module.js').RulesModule}, which registers the single
 * `rules`-collection rule model and exports this token — the shared-persistence
 * pattern. The rules use-case (`RuleService` CRUD) and the relocated rule engine
 * (orchestrator + dispatcher) both resolve the **one** shared rule store through
 * it.
 */
export const RULE_REPOSITORY = 'RULE_REPOSITORY';
