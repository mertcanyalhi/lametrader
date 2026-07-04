/**
 * DI token for the {@link import('./symbol-event-log.types.js').SymbolEventLog}
 * narrow read port.
 *
 * The port is a plain interface, so it has no runtime value to inject by type;
 * this string token binds it to a concrete provider. Owned by
 * {@link import('./event-log.module.js').EventLogModule}, which aliases it
 * (`useExisting`) onto the shared {@link import('./event-log.token.js').EVENT_LOG}
 * so the state-history read use-case resolves the **one** shared event log
 * through its narrow slice — the full `EventLog` satisfies the narrow
 * `SymbolEventLog` (ISP). Consumed by the state resource's
 * {@link import('../analytics/services/state-history.service.js').StateHistoryService}.
 */
export const SYMBOL_EVENT_LOG = 'SYMBOL_EVENT_LOG';
