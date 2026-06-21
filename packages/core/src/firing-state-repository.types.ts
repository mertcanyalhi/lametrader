/**
 * Driven port for the rule engine's per-(rule, symbol) firing-state flags.
 *
 * Currently holds the `currentlyActive` bit the `OncePerMinute` trigger gate
 * needs to detect false → true transitions across restarts.
 *
 * Implemented by driven adapters (MongoDB); an in-memory adapter backs the
 * unit tier and offline/demo wiring.
 */
export interface FiringStateRepository {
  /**
   * Whether the rule's condition was true on the most recent evaluation for
   * `symbolId`. Defaults to `false` when never set.
   */
  getActive(ruleId: string, symbolId: string): Promise<boolean>;
  /**
   * Persist whether the rule's condition is currently true for `symbolId`.
   */
  setActive(ruleId: string, symbolId: string, active: boolean): Promise<void>;
}
