/**
 * Errors that surface from the rules use-case (v2).
 *
 * Kept in `core` as plain exception classes (not v2-namespaced) so the API's
 * error handler can `instanceof`-map them to HTTP status codes without
 * importing the engine.
 */

/**
 * Base error class for every rule-related domain failure.
 *
 * Subclassed by the specific kinds below; the API error handler maps it to a
 * generic 400 when none of the more specific subclasses matched first.
 */
export class RuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleError';
  }
}

/**
 * Thrown when a rule id has no matching persisted document.
 *
 * The API error handler maps this to 404.
 */
export class RuleNotFoundError extends RuleError {
  constructor(message: string) {
    super(message);
    this.name = 'RuleNotFoundError';
  }
}

/**
 * Thrown at create / replace time when a rule's trigger granularity is
 * tick-cadence (e.g. `EveryTime` over `Tick`) but one or more of the rule's
 * scoped symbols is not eligible for live quote streaming — i.e. not on the
 * watchlist or not subscribed (per ADR 0016, no synthesised ticks).
 *
 * The API error handler maps this to 400 with one `fields[]` entry per
 * unwatched symbol id.
 */
export class TickRuleNotEligibleError extends RuleError {
  constructor(
    message: string,
    /** The symbol ids that failed the eligibility check. */
    public readonly unwatchedSymbolIds: string[],
  ) {
    super(message);
    this.name = 'TickRuleNotEligibleError';
  }
}
