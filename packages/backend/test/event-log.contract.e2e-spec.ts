import type { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import type { Model } from 'mongoose';
import { AppModule } from '../src/app.module.js';
import { MongooseEventLog } from '../src/event-log/mongoose-event-log.js';
import { RuleEventDoc } from '../src/event-log/rule-event-doc.schema.js';
import { SymbolEventDoc } from '../src/event-log/symbol-event-doc.schema.js';
import {
  FIXED_FIRED_AT,
  runEventLogContract,
} from '../src/event-log/testing/event-log.contract.js';

/**
 * Runs the shared {@link import('@lametrader/core').EventLog} contract against the Mongoose adapter over a
 * real Mongo (Testcontainers) — the e2e half of the suite whose unit half runs
 * against the in-memory fake. Together they prove the Mongoose rewrite is
 * behaviour-identical to the old native-driver `MongoEventLog`, including the
 * two-write fan-out onto the `rules` and `watchlist` collections' embedded
 * `events[]` and the tagged-union {@link import('@lametrader/core').StateValue}
 * round-trip (ADR-0014 / ADR-0013).
 *
 * The adapter is constructed directly over the app's registered models with a
 * fixed `firedAt` clock so the full-payload assertions stay deterministic — the
 * DI-bound {@link EVENT_LOG} uses the default `Date.now`.
 */
describe('MongooseEventLog (contract, e2e)', () => {
  let container: StartedMongoDBContainer;
  let app: INestApplication;
  let ruleModel: Model<RuleEventDoc>;
  let symbolModel: Model<SymbolEventDoc>;

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:8').start();
    process.env.MONGODB_URI = `${container.getConnectionString()}/?directConnection=true`;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    ruleModel = app.get<Model<RuleEventDoc>>(getModelToken(RuleEventDoc.name));
    symbolModel = app.get<Model<SymbolEventDoc>>(getModelToken(SymbolEventDoc.name));
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await container?.stop();
  });

  // Each contract case gets freshly-emptied `rules` + `watchlist` collections.
  runEventLogContract(async () => {
    await ruleModel.deleteMany({});
    await symbolModel.deleteMany({});
    return { log: new MongooseEventLog(ruleModel, symbolModel, () => FIXED_FIRED_AT) };
  });
});
