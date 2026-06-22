import { UnknownDestinationError } from '@lametrader/core';
import { InMemoryNotifier, type TelegramDestination } from '@lametrader/engine';
import { describe, expect, it } from 'vitest';
import { runTelegram } from './telegram';

describe('runTelegram list', () => {
  it('prints `(none)` when no destinations are configured', async () => {
    expect(await runTelegram(['list'], [])).toBe('(none)');
  });

  it('prints one row per destination with `name`, `chatId`, redacted token', async () => {
    const destinations: TelegramDestination[] = [
      { name: 'main', botToken: '1234567:abcdefXYZW', chatId: '11111' },
      { name: 'alerts', botToken: '9876543:zyxwvuLMNO', chatId: '22222' },
    ];
    const output = await runTelegram(['list'], destinations);
    expect(output).toBe('main\t11111\t****XYZW\nalerts\t22222\t****LMNO');
  });

  it('never echoes the full bot token', async () => {
    const destinations: TelegramDestination[] = [
      { name: 'main', botToken: 'top-secret-bot-token', chatId: '1' },
    ];
    const output = await runTelegram(['list'], destinations);
    expect(output).not.toContain('top-secret-bot-token');
    expect(output).toContain('****');
  });

  it('handles a short token without crashing (still redacts to `****`)', async () => {
    const destinations: TelegramDestination[] = [{ name: 'tiny', botToken: 'ab', chatId: '1' }];
    const output = await runTelegram(['list'], destinations);
    expect(output).toBe('tiny\t1\t****');
  });
});

describe('runTelegram test', () => {
  it('sends a message through the notifier and prints `sent`', async () => {
    const notifier = new InMemoryNotifier(['main']);
    const output = await runTelegram(
      ['test', '--destination', 'main', '--message', 'hello'],
      [],
      notifier,
    );
    expect(output).toBe('sent');
    expect(notifier.sent).toEqual([{ destinationName: 'main', body: 'hello' }]);
  });

  it('propagates `UnknownDestinationError` from the notifier (caller exits non-zero)', async () => {
    const notifier = new InMemoryNotifier(['main']);
    await expect(
      runTelegram(['test', '--destination', 'missing', '--message', 'hi'], [], notifier),
    ).rejects.toBeInstanceOf(UnknownDestinationError);
  });

  it("throws when the notifier isn't wired", async () => {
    await expect(
      runTelegram(['test', '--destination', 'main', '--message', 'hi'], []),
    ).rejects.toThrow('telegram test requires the notifier port to be wired');
  });

  it('requires --destination', async () => {
    const notifier = new InMemoryNotifier(['main']);
    await expect(runTelegram(['test', '--message', 'hi'], [], notifier)).rejects.toThrow(
      'telegram test requires --destination',
    );
  });

  it('requires --message', async () => {
    const notifier = new InMemoryNotifier(['main']);
    await expect(runTelegram(['test', '--destination', 'main'], [], notifier)).rejects.toThrow(
      'telegram test requires --message',
    );
  });
});

describe('runTelegram unknown subcommand', () => {
  it('throws so the entry point prints `error: ...` and exits non-zero', async () => {
    await expect(runTelegram(['bogus'], [])).rejects.toThrow('unknown telegram subcommand: bogus');
  });
});
