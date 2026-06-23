import type { TelegramDestinationsRepository } from '@lametrader/core';
import { expect, it } from 'vitest';

/**
 * The shared behavioural contract every
 * {@link TelegramDestinationsRepository} must satisfy.
 *
 * Run against the in-memory adapter in the unit tier and the Mongo adapter
 * in the e2e tier.
 *
 * @param make - builds a fresh, empty repository under test.
 */
export function runTelegramDestinationsRepositoryContract(
  make: () => TelegramDestinationsRepository | Promise<TelegramDestinationsRepository>,
): void {
  it('list returns an empty array on a fresh repository', async () => {
    const repo = await make();
    expect(await repo.list()).toEqual([]);
  });

  it('upsert then list returns the destination summary without the bot token', async () => {
    const repo = await make();
    await repo.upsert({ name: 'main', botToken: 'TOKEN-1', chatId: '123' });
    expect(await repo.list()).toEqual([{ name: 'main', chatId: '123' }]);
  });

  it('findByName returns the full destination including the bot token', async () => {
    const repo = await make();
    await repo.upsert({ name: 'main', botToken: 'TOKEN-1', chatId: '123' });
    expect(await repo.findByName('main')).toEqual({
      name: 'main',
      botToken: 'TOKEN-1',
      chatId: '123',
    });
  });

  it('findByName returns null for an unknown name', async () => {
    const repo = await make();
    expect(await repo.findByName('ghost')).toBeNull();
  });

  it('upsert replaces an existing destination keyed by name', async () => {
    const repo = await make();
    await repo.upsert({ name: 'main', botToken: 'TOKEN-1', chatId: '123' });
    await repo.upsert({ name: 'main', botToken: 'TOKEN-2', chatId: '456' });
    expect({
      summary: await repo.list(),
      full: await repo.findByName('main'),
    }).toEqual({
      summary: [{ name: 'main', chatId: '456' }],
      full: { name: 'main', botToken: 'TOKEN-2', chatId: '456' },
    });
  });

  it('remove deletes a destination and is idempotent for unknown names', async () => {
    const repo = await make();
    await repo.upsert({ name: 'main', botToken: 'TOKEN-1', chatId: '123' });
    await repo.remove('main');
    await repo.remove('ghost');
    expect(await repo.list()).toEqual([]);
  });

  it('list preserves insertion order across multiple destinations', async () => {
    const repo = await make();
    await repo.upsert({ name: 'main', botToken: 'TOKEN-1', chatId: '1' });
    await repo.upsert({ name: 'alerts', botToken: 'TOKEN-2', chatId: '2' });
    await repo.upsert({ name: 'ops', botToken: 'TOKEN-3', chatId: '3' });
    expect((await repo.list()).map((d) => d.name)).toEqual(['main', 'alerts', 'ops']);
  });
}
