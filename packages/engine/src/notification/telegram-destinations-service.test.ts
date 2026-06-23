import { TelegramDestinationError, TelegramDestinationNotFoundError } from '@lametrader/core';
import { describe, expect, it } from 'vitest';
import { InMemoryTelegramDestinationsRepository } from './in-memory-telegram-destinations-repository.js';
import { TelegramDestinationsService } from './telegram-destinations-service.js';

function service(): TelegramDestinationsService {
  return new TelegramDestinationsService(new InMemoryTelegramDestinationsRepository());
}

describe('TelegramDestinationsService', () => {
  it('list returns an empty array initially', async () => {
    expect(await service().list()).toEqual([]);
  });

  it('upsert trims fields, persists, and returns the summary (no bot token)', async () => {
    const svc = service();
    const summary = await svc.upsert({ name: '  main  ', botToken: ' TOKEN-1 ', chatId: ' 123 ' });
    expect({
      returned: summary,
      listed: await svc.list(),
    }).toEqual({
      returned: { name: 'main', chatId: '123' },
      listed: [{ name: 'main', chatId: '123' }],
    });
  });

  it('upsert replaces an existing destination keyed by name', async () => {
    const svc = service();
    await svc.upsert({ name: 'main', botToken: 'TOKEN-1', chatId: '123' });
    await svc.upsert({ name: 'main', botToken: 'TOKEN-2', chatId: '456' });
    expect(await svc.list()).toEqual([{ name: 'main', chatId: '456' }]);
  });

  it('upsert rejects an empty name with TelegramDestinationError', async () => {
    await expect(
      service().upsert({ name: '   ', botToken: 'T', chatId: '1' }),
    ).rejects.toBeInstanceOf(TelegramDestinationError);
  });

  it('upsert rejects an empty botToken with TelegramDestinationError', async () => {
    await expect(
      service().upsert({ name: 'main', botToken: '', chatId: '1' }),
    ).rejects.toBeInstanceOf(TelegramDestinationError);
  });

  it('upsert rejects an empty chatId with TelegramDestinationError', async () => {
    await expect(
      service().upsert({ name: 'main', botToken: 'T', chatId: '' }),
    ).rejects.toBeInstanceOf(TelegramDestinationError);
  });

  it('remove deletes by name', async () => {
    const svc = service();
    await svc.upsert({ name: 'main', botToken: 'T', chatId: '1' });
    await svc.remove('main');
    expect(await svc.list()).toEqual([]);
  });

  it('remove throws TelegramDestinationNotFoundError for an unknown name', async () => {
    await expect(service().remove('ghost')).rejects.toBeInstanceOf(
      TelegramDestinationNotFoundError,
    );
  });
});
