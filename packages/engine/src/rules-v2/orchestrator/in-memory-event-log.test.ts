import { FIXED_FIRED_AT, runEventLogContract } from '../testing/event-log.contract.js';
import { InMemoryEventLog } from './in-memory-event-log.js';

/**
 * The in-memory adapter drives the shared {@link runEventLogContract} suite —
 * the same suite the Mongo adapter runs in the e2e tier.
 */
runEventLogContract(() => {
  const log = new InMemoryEventLog(() => FIXED_FIRED_AT);
  return { log };
});
