import {
  type TelegramDestination,
  TelegramDestinationError,
  TelegramDestinationNotFoundError,
  type TelegramDestinationSummary,
  type TelegramDestinationsRepository,
} from '@lametrader/core';

/**
 * Use-case façade over a {@link TelegramDestinationsRepository}. Validates
 * inputs at the boundary and surfaces the right domain errors so the API
 * controller can map them cleanly (400 / 404).
 */
export class TelegramDestinationsService {
  constructor(private readonly repo: TelegramDestinationsRepository) {}

  /** Configured destinations, name + chat id (no bot tokens). */
  async list(): Promise<TelegramDestinationSummary[]> {
    return this.repo.list();
  }

  /**
   * Upsert a destination. `name`, `botToken`, and `chatId` must all be
   * non-empty (trimmed) — the in-memory and Mongo repos store them as-is.
   *
   * Same-name upsert replaces the previous bot token + chat id.
   */
  async upsert(destination: TelegramDestination): Promise<TelegramDestinationSummary> {
    const name = destination.name.trim();
    const botToken = destination.botToken.trim();
    const chatId = destination.chatId.trim();
    if (name === '') throw new TelegramDestinationError('name is required');
    if (botToken === '') throw new TelegramDestinationError('botToken is required');
    if (chatId === '') throw new TelegramDestinationError('chatId is required');
    await this.repo.upsert({ name, botToken, chatId });
    return { name, chatId };
  }

  /**
   * Delete a destination by name. Throws
   * {@link TelegramDestinationNotFoundError} when the name is unknown so the
   * API surfaces a 404 instead of silently accepting the request.
   */
  async remove(name: string): Promise<void> {
    const found = await this.repo.findByName(name);
    if (found === null) {
      throw new TelegramDestinationNotFoundError(`No telegram destination named "${name}"`);
    }
    await this.repo.remove(name);
  }
}
