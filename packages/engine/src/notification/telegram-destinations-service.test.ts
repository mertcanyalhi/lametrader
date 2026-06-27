import {
  ConfigKey,
  TelegramDestinationError,
  TelegramDestinationNotFoundError,
} from '@lametrader/core';
import { describe, expect, it } from 'vitest';
import { InMemoryConfigRepository } from '../config/in-memory-config-repository.js';
import { TelegramDestinationsService } from './telegram-destinations-service.js';

/** Build a fresh service over an empty in-memory config repo. */
function service(): { svc: TelegramDestinationsService; repo: InMemoryConfigRepository } {
  const repo = new InMemoryConfigRepository();
  return { svc: new TelegramDestinationsService(repo), repo };
}

describe('TelegramDestinationsService', () => {
  it('list returns an empty array when the key is unset', async () => {
    expect(await service().svc.list()).toEqual([]);
  });

  it('findByName returns null when the key is unset', async () => {
    expect(await service().svc.findByName('ghost')).toBeNull();
  });

  it('upsert trims fields, persists, and returns the summary (no bot token)', async () => {
    const { svc } = service();
    const summary = await svc.upsert({ name: '  main  ', botToken: ' TOKEN-1 ', chatId: ' 123 ' });
    expect({
      returned: summary,
      listed: await svc.list(),
      found: await svc.findByName('main'),
    }).toEqual({
      returned: { name: 'main', chatId: '123' },
      listed: [{ name: 'main', chatId: '123' }],
      found: { name: 'main', botToken: 'TOKEN-1', chatId: '123' },
    });
  });

  it('upsert replaces an existing destination keyed by name (preserves order)', async () => {
    const { svc } = service();
    await svc.upsert({ name: 'main', botToken: 'TOKEN-1', chatId: '123' });
    await svc.upsert({ name: 'alerts', botToken: 'TOKEN-2', chatId: '999' });
    await svc.upsert({ name: 'main', botToken: 'TOKEN-3', chatId: '456' });
    expect(await svc.list()).toEqual([
      { name: 'main', chatId: '456' },
      { name: 'alerts', chatId: '999' },
    ]);
  });

  it('list preserves insertion order across multiple destinations', async () => {
    const { svc } = service();
    await svc.upsert({ name: 'main', botToken: 'TOKEN-1', chatId: '1' });
    await svc.upsert({ name: 'alerts', botToken: 'TOKEN-2', chatId: '2' });
    await svc.upsert({ name: 'ops', botToken: 'TOKEN-3', chatId: '3' });
    expect((await svc.list()).map((d) => d.name)).toEqual(['main', 'alerts', 'ops']);
  });

  it('upsert rejects an empty name with TelegramDestinationError', async () => {
    await expect(
      service().svc.upsert({ name: '   ', botToken: 'T', chatId: '1' }),
    ).rejects.toBeInstanceOf(TelegramDestinationError);
  });

  it('upsert rejects an empty botToken with TelegramDestinationError', async () => {
    await expect(
      service().svc.upsert({ name: 'main', botToken: '', chatId: '1' }),
    ).rejects.toBeInstanceOf(TelegramDestinationError);
  });

  it('upsert rejects an empty chatId with TelegramDestinationError', async () => {
    await expect(
      service().svc.upsert({ name: 'main', botToken: 'T', chatId: '' }),
    ).rejects.toBeInstanceOf(TelegramDestinationError);
  });

  it('remove deletes by name', async () => {
    const { svc } = service();
    await svc.upsert({ name: 'main', botToken: 'T', chatId: '1' });
    await svc.remove('main');
    expect(await svc.list()).toEqual([]);
  });

  it('remove throws TelegramDestinationNotFoundError for an unknown name', async () => {
    await expect(service().svc.remove('ghost')).rejects.toBeInstanceOf(
      TelegramDestinationNotFoundError,
    );
  });

  it('persists to the configured key so the K/V store holds the array', async () => {
    const { svc, repo } = service();
    await svc.upsert({ name: 'main', botToken: 'TOKEN-1', chatId: '123' });
    expect(await repo.get(ConfigKey.TelegramDestinations)).toEqual([
      { name: 'main', botToken: 'TOKEN-1', chatId: '123' },
    ]);
  });

  it('list throws TelegramDestinationError when the stored value is not an array', async () => {
    const { svc, repo } = service();
    await repo.set(ConfigKey.TelegramDestinations, { not: 'an array' });
    await expect(svc.list()).rejects.toBeInstanceOf(TelegramDestinationError);
  });

  it('list throws TelegramDestinationError when an entry is missing required fields', async () => {
    const { svc, repo } = service();
    await repo.set(ConfigKey.TelegramDestinations, [{ name: 'main', botToken: 'T' }]);
    await expect(svc.list()).rejects.toBeInstanceOf(TelegramDestinationError);
  });
});
