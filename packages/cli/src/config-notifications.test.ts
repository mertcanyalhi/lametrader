import { TelegramDestinationNotFoundError, UnknownDestinationError } from '@lametrader/core';
import {
  InMemoryConfigRepository,
  InMemoryNotifier,
  type TelegramDestination,
  TelegramDestinationsService,
} from '@lametrader/engine';
import { describe, expect, it } from 'vitest';
import { runConfigNotifications } from './config-notifications';

/** Build a destinations service seeded with the given entries. */
async function service(
  destinations: TelegramDestination[] = [],
): Promise<TelegramDestinationsService> {
  const svc = new TelegramDestinationsService(new InMemoryConfigRepository());
  for (const destination of destinations) await svc.upsert(destination);
  return svc;
}

describe('runConfigNotifications telegram list', () => {
  it('prints `(none)` when no destinations are configured', async () => {
    expect(await runConfigNotifications(['telegram', 'list'], await service())).toBe('(none)');
  });

  it('prints one row per destination as `name\\tchatId`', async () => {
    const output = await runConfigNotifications(
      ['telegram', 'list'],
      await service([
        { name: 'main', botToken: '1234567:abcdefXYZW', chatId: '11111' },
        { name: 'alerts', botToken: '9876543:zyxwvuLMNO', chatId: '22222' },
      ]),
    );
    expect(output).toBe('main\t11111\nalerts\t22222');
  });

  it('never echoes the bot token in the list output', async () => {
    const output = await runConfigNotifications(
      ['telegram', 'list'],
      await service([{ name: 'main', botToken: 'top-secret-bot-token', chatId: '1' }]),
    );
    expect(output).not.toContain('top-secret-bot-token');
  });
});

describe('runConfigNotifications telegram set', () => {
  it('upserts a destination and prints `set <name>`', async () => {
    const svc = await service();
    const output = await runConfigNotifications(
      ['telegram', 'set', '--name', 'main', '--bot-token', 'TOKEN-1', '--chat-id', '123'],
      svc,
    );
    expect(output).toBe('set main');
    expect(await svc.list()).toEqual([{ name: 'main', chatId: '123' }]);
  });

  it('requires --name', async () => {
    await expect(
      runConfigNotifications(
        ['telegram', 'set', '--bot-token', 'T', '--chat-id', '1'],
        await service(),
      ),
    ).rejects.toThrow('telegram set requires --name');
  });

  it('requires --bot-token', async () => {
    await expect(
      runConfigNotifications(
        ['telegram', 'set', '--name', 'main', '--chat-id', '1'],
        await service(),
      ),
    ).rejects.toThrow('telegram set requires --bot-token');
  });

  it('requires --chat-id', async () => {
    await expect(
      runConfigNotifications(
        ['telegram', 'set', '--name', 'main', '--bot-token', 'T'],
        await service(),
      ),
    ).rejects.toThrow('telegram set requires --chat-id');
  });
});

describe('runConfigNotifications telegram delete', () => {
  it('removes the destination and prints `deleted <name>`', async () => {
    const svc = await service([{ name: 'main', botToken: 'TOKEN-1', chatId: '123' }]);
    const output = await runConfigNotifications(['telegram', 'delete', '--name', 'main'], svc);
    expect(output).toBe('deleted main');
    expect(await svc.list()).toEqual([]);
  });

  it('propagates TelegramDestinationNotFoundError for an unknown name', async () => {
    await expect(
      runConfigNotifications(['telegram', 'delete', '--name', 'ghost'], await service()),
    ).rejects.toBeInstanceOf(TelegramDestinationNotFoundError);
  });

  it('requires --name', async () => {
    await expect(runConfigNotifications(['telegram', 'delete'], await service())).rejects.toThrow(
      'telegram delete requires --name',
    );
  });
});

describe('runConfigNotifications telegram test', () => {
  it('sends a message through the notifier and prints `sent`', async () => {
    const notifier = new InMemoryNotifier(['main']);
    const output = await runConfigNotifications(
      ['telegram', 'test', '--destination', 'main', '--message', 'hello'],
      await service(),
      notifier,
    );
    expect(output).toBe('sent');
    expect(notifier.sent).toEqual([{ destinationName: 'main', body: 'hello' }]);
  });

  it('propagates `UnknownDestinationError` from the notifier (caller exits non-zero)', async () => {
    const notifier = new InMemoryNotifier(['main']);
    await expect(
      runConfigNotifications(
        ['telegram', 'test', '--destination', 'missing', '--message', 'hi'],
        await service(),
        notifier,
      ),
    ).rejects.toBeInstanceOf(UnknownDestinationError);
  });

  it("throws when the notifier isn't wired", async () => {
    await expect(
      runConfigNotifications(
        ['telegram', 'test', '--destination', 'main', '--message', 'hi'],
        await service(),
      ),
    ).rejects.toThrow('telegram test requires the notifier port to be wired');
  });

  it('requires --destination', async () => {
    const notifier = new InMemoryNotifier(['main']);
    await expect(
      runConfigNotifications(['telegram', 'test', '--message', 'hi'], await service(), notifier),
    ).rejects.toThrow('telegram test requires --destination');
  });

  it('requires --message', async () => {
    const notifier = new InMemoryNotifier(['main']);
    await expect(
      runConfigNotifications(
        ['telegram', 'test', '--destination', 'main'],
        await service(),
        notifier,
      ),
    ).rejects.toThrow('telegram test requires --message');
  });
});

describe('runConfigNotifications unknown', () => {
  it('throws when the channel is unknown', async () => {
    await expect(runConfigNotifications(['email', 'list'], await service())).rejects.toThrow(
      'unknown config notifications channel: email',
    );
  });

  it('throws when the telegram subcommand is unknown', async () => {
    await expect(runConfigNotifications(['telegram', 'bogus'], await service())).rejects.toThrow(
      'unknown telegram subcommand: bogus',
    );
  });
});
