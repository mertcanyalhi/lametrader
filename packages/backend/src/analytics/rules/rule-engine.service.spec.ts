import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EVENT_LOG } from '../../common/interfaces/event-log.token.js';
import { InMemoryEventLog } from '../../common/persistence/in-memory-event-log.js';
import { InMemoryNotifier } from '../../common/services/in-memory-notifier.js';
import { TelegramNotifier } from '../../common/services/telegram-notifier.js';
import { CANDLE_REPOSITORY } from '../../market/interfaces/candle-repository.token.js';
import { WATCHLIST_REPOSITORY } from '../../market/interfaces/watchlist-repository.token.js';
import { InMemoryCandleRepository } from '../../market/persistence/in-memory-candle.repository.js';
import { InMemoryWatchlistRepository } from '../../market/persistence/in-memory-watchlist.repository.js';
import { defaultIndicators } from '../indicators/default-indicators.js';
import { IndicatorService } from '../indicators/indicator.service.js';
import { PROFILE_REPOSITORY } from '../interfaces/profile-repository.token.js';
import { STATE_REPOSITORY } from '../interfaces/state-repository.token.js';
import { InMemoryProfileRepository } from '../persistence/in-memory-profile.repository.js';
import { InMemoryStateRepository } from '../persistence/in-memory-state.repository.js';
import { InMemoryRuleRepository } from './in-memory-rule.repository.js';
import { IndicatorSeriesStore } from './indicator-series-store.js';
import { RuleEngineService } from './rule-engine.service.js';
import { RULE_REPOSITORY } from './rule-repository.token.js';

/**
 * Proves the relocated rule engine is **dormant at boot** (the #488 requirement,
 * parity with the relocated {@link import('../../market/services/polling.service.js').PollingService}).
 *
 * Boots a Nest module wiring the {@link RuleEngineService} over in-memory fakes —
 * no Mongo, no Docker — and asserts that after `app.init()` the live engine was
 * never composed and the notifier dispatched nothing: no `wireRuleEngine`, no
 * candle feed, no `IntervalScheduler`, no notification. A second case drives
 * `start()` explicitly and shows the engine composes but still dispatches nothing
 * (nothing is fed), so it is ready-but-idle.
 */
describe('RuleEngineService dormancy', () => {
  let app: INestApplication;
  let service: RuleEngineService;
  let notifier: InMemoryNotifier;

  beforeEach(async () => {
    const watchlist = new InMemoryWatchlistRepository();
    const candles = new InMemoryCandleRepository();
    notifier = new InMemoryNotifier();
    const moduleRef = await Test.createTestingModule({
      providers: [
        RuleEngineService,
        { provide: RULE_REPOSITORY, useValue: new InMemoryRuleRepository() },
        { provide: STATE_REPOSITORY, useValue: new InMemoryStateRepository() },
        { provide: WATCHLIST_REPOSITORY, useValue: watchlist },
        { provide: EVENT_LOG, useValue: new InMemoryEventLog() },
        { provide: CANDLE_REPOSITORY, useValue: candles },
        { provide: TelegramNotifier, useValue: notifier },
        { provide: PROFILE_REPOSITORY, useValue: new InMemoryProfileRepository() },
        {
          provide: IndicatorSeriesStore,
          useValue: new IndicatorSeriesStore(
            candles,
            new IndicatorService(defaultIndicators(), watchlist, candles),
          ),
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    service = app.get(RuleEngineService);
  });

  afterEach(async () => {
    await app?.close();
  });

  it('leaves the live engine un-wired and dispatches nothing at application bootstrap', () => {
    expect({ isWired: service.isWired, dispatched: notifier.sent }).toEqual({
      isWired: false,
      dispatched: [],
    });
  });

  it('composes the engine on an explicit start() without feeding or dispatching anything', async () => {
    await service.start();
    expect({ isWired: service.isWired, dispatched: notifier.sent }).toEqual({
      isWired: true,
      dispatched: [],
    });
  });
});
