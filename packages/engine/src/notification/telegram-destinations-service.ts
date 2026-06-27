import {
  ConfigKey,
  type ConfigRepository,
  type TelegramDestination,
  TelegramDestinationError,
  type TelegramDestinationLookup,
  TelegramDestinationNotFoundError,
  type TelegramDestinationSummary,
} from '@lametrader/core';

/**
 * Use-case for reading and changing the configured Telegram destinations.
 *
 * Stored as a single `TelegramDestination[]` under
 * {@link ConfigKey.TelegramDestinations} in the shared K/V config store —
 * deliberately not its own collection. See `specs/config-layer.spec.md`
 * (Notification destinations sub-resource → Storage choice) for the
 * trade-off (admin-edited, rare writes, < 10 entries → array-level writes +
 * app-level uniqueness in exchange for one fewer collection + port + adapter).
 *
 * Concurrency: last-write-wins on the whole array — acceptable at single-
 * tenant scale.
 */
export class TelegramDestinationsService implements TelegramDestinationLookup {
  /**
   * @param repo - the shared config K/V repository.
   */
  constructor(private readonly repo: ConfigRepository) {}

  /**
   * Configured destinations, name + chat id (no bot tokens).
   */
  async list(): Promise<TelegramDestinationSummary[]> {
    const all = await this.readAll();
    return all.map(({ name, chatId }) => ({ name, chatId }));
  }

  /**
   * Find one destination by name, including its bot token.
   * Returns `null` when the name is unknown.
   */
  async findByName(name: string): Promise<TelegramDestination | null> {
    const all = await this.readAll();
    return all.find((d) => d.name === name) ?? null;
  }

  /**
   * Upsert a destination. `name`, `botToken`, and `chatId` must all be
   * non-empty (trimmed). Same-name upsert replaces the previous bot token +
   * chat id (in-place, preserving order); a new name appends.
   */
  async upsert(destination: TelegramDestination): Promise<TelegramDestinationSummary> {
    const name = destination.name.trim();
    const botToken = destination.botToken.trim();
    const chatId = destination.chatId.trim();
    if (name === '') throw new TelegramDestinationError('name is required');
    if (botToken === '') throw new TelegramDestinationError('botToken is required');
    if (chatId === '') throw new TelegramDestinationError('chatId is required');
    const next: TelegramDestination = { name, botToken, chatId };
    const all = await this.readAll();
    const index = all.findIndex((d) => d.name === name);
    if (index === -1) {
      all.push(next);
    } else {
      all[index] = next;
    }
    await this.repo.set(ConfigKey.TelegramDestinations, all);
    return { name, chatId };
  }

  /**
   * Delete a destination by name. Throws
   * {@link TelegramDestinationNotFoundError} when the name is unknown so the
   * API surfaces a 404 instead of silently accepting the request.
   */
  async remove(name: string): Promise<void> {
    const all = await this.readAll();
    const next = all.filter((d) => d.name !== name);
    if (next.length === all.length) {
      throw new TelegramDestinationNotFoundError(`No telegram destination named "${name}"`);
    }
    await this.repo.set(ConfigKey.TelegramDestinations, next);
  }

  /**
   * Read the destinations array from the K/V store, defaulting to `[]` when
   * nothing is stored yet, and shallow-cloning so callers can safely mutate.
   * Validates the stored value's outer shape (array of objects with the
   * required string fields) so a corrupt store surfaces as an explicit error
   * rather than a malformed return.
   */
  private async readAll(): Promise<TelegramDestination[]> {
    const raw = await this.repo.get(ConfigKey.TelegramDestinations);
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) {
      throw new TelegramDestinationError(
        `telegramDestinations must be an array (got: ${typeof raw})`,
      );
    }
    return raw.map((entry) => {
      if (
        entry === null ||
        typeof entry !== 'object' ||
        typeof (entry as Record<string, unknown>).name !== 'string' ||
        typeof (entry as Record<string, unknown>).botToken !== 'string' ||
        typeof (entry as Record<string, unknown>).chatId !== 'string'
      ) {
        throw new TelegramDestinationError(
          'telegramDestinations entries must each be { name, botToken, chatId } strings',
        );
      }
      const { name, botToken, chatId } = entry as TelegramDestination;
      return { name, botToken, chatId };
    });
  }
}
