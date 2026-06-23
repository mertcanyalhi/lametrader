import { describe, expect, it } from 'vitest';
import { InMemoryTelegramDestinationsRepository } from '../notification/in-memory-telegram-destinations-repository.js';
import { loadSettings } from '../settings.js';
import { TelegramNotifier } from './telegram-notifier.js';

/**
 * Sends one real message via the Telegram Bot API. Manual only — relies on
 * `TELEGRAM_DESTINATIONS` (and the chosen destination name in
 * `TELEGRAM_LIVE_DESTINATION`, default `main`) being set in the environment.
 */
describe('TelegramNotifier (live)', () => {
  it('delivers a message to the configured destination', async () => {
    const settings = loadSettings();
    const destinationName = process.env.TELEGRAM_LIVE_DESTINATION ?? 'main';
    if (settings.telegramDestinations.length === 0) {
      throw new Error('TELEGRAM_DESTINATIONS not configured');
    }
    const repo = new InMemoryTelegramDestinationsRepository();
    for (const destination of settings.telegramDestinations) await repo.upsert(destination);
    const notifier = new TelegramNotifier(repo);
    await expect(
      notifier.send(destinationName, `lametrader live test ${new Date().toISOString()}`),
    ).resolves.toBeUndefined();
  });
});
