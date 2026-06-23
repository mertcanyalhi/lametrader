import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import { type Db, MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe } from 'vitest';
import { MongoTelegramDestinationsRepository } from '../../src/notification/mongo-telegram-destinations-repository.js';
import { runTelegramDestinationsRepositoryContract } from '../../src/notification/testing/telegram-destinations-repository.contract.js';

/**
 * E2E: the Telegram destinations adapter against an ephemeral Mongo
 * (Testcontainers), run through the same shared contract suite as the
 * in-memory adapter.
 */
describe('telegram destinations persistence (e2e)', () => {
  let container: StartedMongoDBContainer;
  let client: MongoClient;
  let db: Db;
  let clock = 0;

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:8').start();
    client = new MongoClient(container.getConnectionString(), { directConnection: true });
    await client.connect();
    db = client.db('lametrader');
  });

  afterAll(async () => {
    await client?.close();
    await container?.stop();
  });

  runTelegramDestinationsRepositoryContract(async () => {
    await db.collection('telegramDestinations').deleteMany({});
    clock = 0;
    const repo = new MongoTelegramDestinationsRepository(db, () => {
      clock += 1;
      return clock;
    });
    await repo.ensureIndexes();
    return repo;
  });
});
