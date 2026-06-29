/**
 * v2 rules application services — `RuleServiceV2` exposes CRUD over the v2
 * {@link RulesV2.RuleRepository} and {@link RulesV2.EventLog} ports, gated by
 * the watchlist for tick-cadence triggers.
 */

export {
  type EventListOptions,
  RuleServiceV2,
  type RuleServiceV2Options,
  type RuleV2CreateInput,
  type RuleV2ListFilters,
} from './rule-service.js';
