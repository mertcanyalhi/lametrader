import { TelegramDestinationNotFoundError } from '@lametrader/core';
import { MongoConfigRepository, TelegramDestinationsService } from '@lametrader/engine';
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb';
import { type Db, MongoClient } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * E2E: the Telegram destinations service against an ephemeral Mongo
 * (Testcontainers). Storage folded into the shared config K/V collection,
 * so the round-trip exercises `MongoConfigRepository` reads/writes under
 * the new `ConfigKey.TelegramDestinations` key.
 */
describe('telegram destinations persistence (e2e)', () => {
  let container: StartedMongoDBContainer;
  let client: MongoClient;
  let db: Db;

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

  beforeEach(async () => {
    await db.collection('config').deleteMany({});
  });

  function service(): TelegramDestinationsService {
    return new TelegramDestinationsService(new MongoConfigRepository(db));
  }

  it('round-trips an upsert through a fresh service instance', async () => {
    const writer = service();
    await writer.upsert({ name: 'main', botToken: 'TOKEN-1', chatId: '123' });

    expect({
      listed: await service().list(),
      found: await service().findByName('main'),
    }).toEqual({
      listed: [{ name: 'main', chatId: '123' }],
      found: { name: 'main', botToken: 'TOKEN-1', chatId: '123' },
    });
  });

  it('preserves insertion order across upserts', async () => {
    const svc = service();
    await svc.upsert({ name: 'main', botToken: 'TOKEN-1', chatId: '1' });
    await svc.upsert({ name: 'alerts', botToken: 'TOKEN-2', chatId: '2' });
    await svc.upsert({ name: 'ops', botToken: 'TOKEN-3', chatId: '3' });
    expect((await service().list()).map((d) => d.name)).toEqual(['main', 'alerts', 'ops']);
  });

  it('replaces an existing destination keyed by name in place', async () => {
    const svc = service();
    await svc.upsert({ name: 'main', botToken: 'TOKEN-1', chatId: '123' });
    await svc.upsert({ name: 'main', botToken: 'TOKEN-2', chatId: '456' });
    expect({
      listed: await service().list(),
      found: await service().findByName('main'),
    }).toEqual({
      listed: [{ name: 'main', chatId: '456' }],
      found: { name: 'main', botToken: 'TOKEN-2', chatId: '456' },
    });
  });

  it('remove drops the destination and rejects re-removal with not-found', async () => {
    const svc = service();
    await svc.upsert({ name: 'main', botToken: 'TOKEN-1', chatId: '123' });
    await svc.remove('main');
    expect(await service().list()).toEqual([]);
    await expect(service().remove('main')).rejects.toBeInstanceOf(TelegramDestinationNotFoundError);
  });

  it('returns an empty list and null lookup on a fresh database', async () => {
    expect({ listed: await service().list(), found: await service().findByName('main') }).toEqual({
      listed: [],
      found: null,
    });
  });
});
