import type {
  TelegramDestination,
  TelegramDestinationSummary,
  TelegramDestinationsRepository,
} from '@lametrader/core';

/**
 * In-memory {@link TelegramDestinationsRepository} for the unit tier and the
 * notifier's test doubles. Keyed by `name`; `list()` returns entries in
 * insertion order with the bot token stripped.
 */
export class InMemoryTelegramDestinationsRepository implements TelegramDestinationsRepository {
  private readonly byName = new Map<string, TelegramDestination>();

  async list(): Promise<TelegramDestinationSummary[]> {
    return Array.from(this.byName.values(), ({ name, chatId }) => ({ name, chatId }));
  }

  async findByName(name: string): Promise<TelegramDestination | null> {
    return this.byName.get(name) ?? null;
  }

  async upsert(destination: TelegramDestination): Promise<void> {
    this.byName.set(destination.name, { ...destination });
  }

  async remove(name: string): Promise<void> {
    this.byName.delete(name);
  }
}
