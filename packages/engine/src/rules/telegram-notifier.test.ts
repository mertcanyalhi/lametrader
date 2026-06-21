import { UnknownDestinationError } from '@lametrader/core';
import { describe, expect, it } from 'vitest';
import { TelegramNotifier, TelegramSendError } from './telegram-notifier.js';

/**
 * Build a notifier with one mock destination and a fetch recorder.
 */
function build(response: { ok: boolean; status: number } = { ok: true, status: 200 }) {
  const calls: Array<{
    url: string;
    init: { method: string; headers: Record<string, string>; body: string };
  }> = [];
  const fetchMock = async (
    url: string,
    init: { method: string; headers: Record<string, string>; body: string },
  ) => {
    calls.push({ url, init });
    return response;
  };
  const notifier = new TelegramNotifier(
    [
      { name: 'main', botToken: 'TOKEN-1', chatId: '123' },
      { name: 'alerts', botToken: 'TOKEN-2', chatId: '456' },
    ],
    { fetch: fetchMock },
  );
  return { notifier, calls };
}

describe('TelegramNotifier', () => {
  it('POSTs to the Bot API with the destination token + chat id and message body', async () => {
    const { notifier, calls } = build();
    await notifier.send('main', 'hello');
    expect(calls).toEqual([
      {
        url: 'https://api.telegram.org/botTOKEN-1/sendMessage',
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: '123', text: 'hello' }),
        },
      },
    ]);
  });

  it('routes to the correct destination when several are registered', async () => {
    const { notifier, calls } = build();
    await notifier.send('alerts', 'beep');
    expect(calls[0]?.url).toBe('https://api.telegram.org/botTOKEN-2/sendMessage');
    expect(calls[0]?.init.body).toBe(JSON.stringify({ chat_id: '456', text: 'beep' }));
  });

  it('throws UnknownDestinationError when the name is not registered', async () => {
    const { notifier } = build();
    await expect(notifier.send('missing', 'hi')).rejects.toBeInstanceOf(UnknownDestinationError);
  });

  it('throws TelegramSendError on a non-2xx Bot API response, carrying the status', async () => {
    const { notifier } = build({ ok: false, status: 401 });
    const err = (await notifier.send('main', 'hi').catch((e) => e)) as TelegramSendError;
    expect(err).toBeInstanceOf(TelegramSendError);
    expect({ name: err.name, destinationName: err.destinationName, status: err.status }).toEqual({
      name: 'TelegramSendError',
      destinationName: 'main',
      status: 401,
    });
  });

  it('throws TelegramSendError with status=null when the transport itself fails', async () => {
    const fetchMock = async () => {
      throw new Error('network down');
    };
    const notifier = new TelegramNotifier([{ name: 'main', botToken: 'TOKEN-1', chatId: '123' }], {
      fetch: fetchMock,
    });
    const err = (await notifier.send('main', 'hi').catch((e) => e)) as TelegramSendError;
    expect(err).toBeInstanceOf(TelegramSendError);
    expect({ name: err.name, destinationName: err.destinationName, status: err.status }).toEqual({
      name: 'TelegramSendError',
      destinationName: 'main',
      status: null,
    });
  });

  it('the TelegramSendError instance is detectable via instanceof', async () => {
    const { notifier } = build({ ok: false, status: 500 });
    await expect(notifier.send('main', 'hi')).rejects.toBeInstanceOf(TelegramSendError);
  });
});
