/**
 * Rules application services — `RuleService` exposes CRUD over the
 * {@link RuleRepository} and {@link EventLog} ports, gated by the watchlist
 * for tick-cadence triggers.
 */

export {
  type EventListOptions,
  type RuleCreateInput,
  type RuleListFilters,
  RuleService,
  type RuleServiceOptions,
} from './rule-service.js';
