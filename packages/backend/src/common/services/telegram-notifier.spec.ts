import { NotificationChannel } from '@lametrader/core';
import { UnknownDestinationError } from '../domain/notifier.js';
import { InMemoryConfigRepository } from '../persistence/in-memory-config.repository.js';
import {
  type CreateNotificationConfigInput,
  NotificationConfigsService,
} from './notification-configs.service.js';
import { TelegramNotifier, TelegramSendError } from './telegram-notifier.js';

/** A Telegram create payload. */
function telegram(name: string, botToken: string, chatId: string): CreateNotificationConfigInput {
  return { notificationType: NotificationChannel.Telegram, name, botToken, chatId };
}

/**
 * Build a notifier with the given destinations and a fetch recorder.
 */
async function build(
  response: { ok: boolean; status: number } = { ok: true, status: 200 },
  destinations: CreateNotificationConfigInput[] = [
    telegram('main', 'TOKEN-1', '123'),
    telegram('alerts', 'TOKEN-2', '456'),
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
  const service = new NotificationConfigsService(new InMemoryConfigRepository());
  for (const destination of destinations) await service.create(destination);
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
    const service = new NotificationConfigsService(new InMemoryConfigRepository());
    await service.create(telegram('main', 'TOKEN-1', '123'));
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
      telegram('main', 'TOKEN-1', '123'),
    ]);
    await service.create(telegram('late', 'LATE', '999'));
    await expect(notifier.send('late', 'hi')).resolves.toBeUndefined();
  });
});
