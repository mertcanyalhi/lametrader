import { UnknownDestinationError } from '@lametrader/core';
import {
  InMemoryNotifier,
  InMemoryTelegramDestinationsRepository,
  type TelegramDestination,
  TelegramDestinationsService,
} from '@lametrader/engine';
import { describe, expect, it } from 'vitest';
import { runTelegram } from './telegram';

/** Build a destinations service seeded with the given entries. */
async function service(
  destinations: TelegramDestination[] = [],
): Promise<TelegramDestinationsService> {
  const repo = new InMemoryTelegramDestinationsRepository();
  for (const destination of destinations) await repo.upsert(destination);
  return new TelegramDestinationsService(repo);
}

describe('runTelegram list', () => {
  it('prints `(none)` when no destinations are configured', async () => {
    expect(await runTelegram(['list'], await service())).toBe('(none)');
  });

  it('prints one row per destination as `name\\tchatId`', async () => {
    const output = await runTelegram(
      ['list'],
      await service([
        { name: 'main', botToken: '1234567:abcdefXYZW', chatId: '11111' },
        { name: 'alerts', botToken: '9876543:zyxwvuLMNO', chatId: '22222' },
      ]),
    );
    expect(output).toBe('main\t11111\nalerts\t22222');
  });

  it('never echoes the bot token in the list output', async () => {
    const output = await runTelegram(
      ['list'],
      await service([{ name: 'main', botToken: 'top-secret-bot-token', chatId: '1' }]),
    );
    expect(output).not.toContain('top-secret-bot-token');
  });
});

describe('runTelegram test', () => {
  it('sends a message through the notifier and prints `sent`', async () => {
    const notifier = new InMemoryNotifier(['main']);
    const output = await runTelegram(
      ['test', '--destination', 'main', '--message', 'hello'],
      await service(),
      notifier,
    );
    expect(output).toBe('sent');
    expect(notifier.sent).toEqual([{ destinationName: 'main', body: 'hello' }]);
  });

  it('propagates `UnknownDestinationError` from the notifier (caller exits non-zero)', async () => {
    const notifier = new InMemoryNotifier(['main']);
    await expect(
      runTelegram(
        ['test', '--destination', 'missing', '--message', 'hi'],
        await service(),
        notifier,
      ),
    ).rejects.toBeInstanceOf(UnknownDestinationError);
  });

  it("throws when the notifier isn't wired", async () => {
    await expect(
      runTelegram(['test', '--destination', 'main', '--message', 'hi'], await service()),
    ).rejects.toThrow('telegram test requires the notifier port to be wired');
  });

  it('requires --destination', async () => {
    const notifier = new InMemoryNotifier(['main']);
    await expect(
      runTelegram(['test', '--message', 'hi'], await service(), notifier),
    ).rejects.toThrow('telegram test requires --destination');
  });

  it('requires --message', async () => {
    const notifier = new InMemoryNotifier(['main']);
    await expect(
      runTelegram(['test', '--destination', 'main'], await service(), notifier),
    ).rejects.toThrow('telegram test requires --message');
  });
});

describe('runTelegram unknown subcommand', () => {
  it('throws so the entry point prints `error: ...` and exits non-zero', async () => {
    await expect(runTelegram(['bogus'], await service())).rejects.toThrow(
      'unknown telegram subcommand: bogus',
    );
  });
});
