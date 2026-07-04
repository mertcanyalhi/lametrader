import { InMemoryEventLog } from './in-memory-event-log.js';
import { FIXED_FIRED_AT, runEventLogContract } from './testing/event-log.contract.js';

/**
 * Runs the shared {@link import('@lametrader/core').EventLog} contract against the
 * in-memory adapter — the unit half of the suite whose e2e half runs the Mongoose
 * adapter over a real Mongo. The fixed `firedAt` clock keeps the full-payload
 * assertions deterministic.
 */
describe('InMemoryEventLog', () => {
  runEventLogContract(() => ({ log: new InMemoryEventLog(() => FIXED_FIRED_AT) }));
});
