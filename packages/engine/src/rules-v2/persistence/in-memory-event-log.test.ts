import { describe } from 'vitest';

import { runEventLogContract } from '../testing/event-log.contract.js';
import { InMemoryEventLog } from './in-memory-event-log.js';

describe('InMemoryEventLog (v2)', () => {
  runEventLogContract((firedAtClock) => new InMemoryEventLog(() => firedAtClock));
});
