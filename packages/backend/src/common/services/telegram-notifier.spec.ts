import type { TelegramDestination } from '@lametrader/core';
import { UnknownDestinationError } from '../../domain/notifier.js';
import { InMemoryConfigRepository } from '../persistence/in-memory-config.repository.js';
import { TelegramDestinationsService } from './telegram-destinations.service.js';
import { TelegramNotifier, TelegramSendError } from './telegram-notifier.js';

/**
 * Build a notifier with the given destinations and a fetch recorder.
 */
async function build(
  response: { ok: boolean; status: number } = { ok: true, status: 200 },
  destinations: TelegramDestination[] = [
    { name: 'main', botToken: 'TOKEN-1', chatId: '123' },
    { name: 'alerts', botToken: 'TOKEN-2', chatId: '456' },
  ],
) {
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
  const service = new TelegramDestinationsService(new InMemoryConfigRepository());
  for (const destination of destinations) await service.upsert(destination);
  const notifier = new TelegramNotifier(service, { fetch: fetchMock });
  return { notifier, calls, service };
}

describe('TelegramNotifier', () => {
  it('POSTs to the Bot API with the destination token + chat id and message body', async () => {
    const { notifier, calls } = await build();
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
    const { notifier, calls } = await build();
    await notifier.send('alerts', 'beep');
    expect(calls[0]?.url).toBe('https://api.telegram.org/botTOKEN-2/sendMessage');
    expect(calls[0]?.init.body).toBe(JSON.stringify({ chat_id: '456', text: 'beep' }));
  });

  it('throws UnknownDestinationError when the name is not registered', async () => {
    const { notifier } = await build();
    await expect(notifier.send('missing', 'hi')).rejects.toBeInstanceOf(UnknownDestinationError);
  });

  it('throws TelegramSendError on a non-2xx Bot API response, carrying the status', async () => {
    const { notifier } = await build({ ok: false, status: 401 });
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
    const service = new TelegramDestinationsService(new InMemoryConfigRepository());
    await service.upsert({ name: 'main', botToken: 'TOKEN-1', chatId: '123' });
    const notifier = new TelegramNotifier(service, { fetch: fetchMock });
    const err = (await notifier.send('main', 'hi').catch((e) => e)) as TelegramSendError;
    expect(err).toBeInstanceOf(TelegramSendError);
    expect({ name: err.name, destinationName: err.destinationName, status: err.status }).toEqual({
      name: 'TelegramSendError',
      destinationName: 'main',
      status: null,
    });
  });

  it('the TelegramSendError instance is detectable via instanceof', async () => {
    const { notifier } = await build({ ok: false, status: 500 });
    await expect(notifier.send('main', 'hi')).rejects.toBeInstanceOf(TelegramSendError);
  });

  it('picks up a destination added via the service after the notifier was built', async () => {
    const { notifier, service } = await build({ ok: true, status: 200 }, [
      { name: 'main', botToken: 'TOKEN-1', chatId: '123' },
    ]);
    await service.upsert({ name: 'late', botToken: 'LATE', chatId: '999' });
    await expect(notifier.send('late', 'hi')).resolves.toBeUndefined();
  });
});
