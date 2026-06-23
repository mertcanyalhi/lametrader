import type {
  TelegramDestination,
  TelegramDestinationSummary,
  TelegramDestinationsRepository,
} from '@lametrader/core';
import type { Collection, Db } from 'mongodb';
import type { TelegramDestinationDocument } from './mongo-telegram-destinations-repository.types.js';

/**
 * MongoDB-backed {@link TelegramDestinationsRepository}.
 *
 * Stores one document per destination keyed by `name` in the
 * `telegramDestinations` collection.
 */
export class MongoTelegramDestinationsRepository implements TelegramDestinationsRepository {
  /**
   * @param db - a connected MongoDB database handle.
   * @param now - injectable epoch-ms clock used to stamp `insertedAt` on
   *   first insert. Defaults to `Date.now`.
   */
  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now,
  ) {}

  private get collection(): Collection<TelegramDestinationDocument> {
    return this.db.collection<TelegramDestinationDocument>('telegramDestinations');
  }

  /**
   * Create the unique index on `name`. Idempotent.
   */
  async ensureIndexes(): Promise<void> {
    await this.collection.createIndex(
      { name: 1 },
      { unique: true, name: 'telegram_destinations_name_unique' },
    );
  }

  async list(): Promise<TelegramDestinationSummary[]> {
    const docs = await this.collection.find({}).sort({ insertedAt: 1 }).toArray();
    return docs.map((doc) => ({ name: doc.name, chatId: doc.chatId }));
  }

  async findByName(name: string): Promise<TelegramDestination | null> {
    const doc = await this.collection.findOne({ name });
    if (!doc) return null;
    return { name: doc.name, botToken: doc.botToken, chatId: doc.chatId };
  }

  async upsert(destination: TelegramDestination): Promise<void> {
    await this.collection.updateOne(
      { name: destination.name },
      {
        $set: { botToken: destination.botToken, chatId: destination.chatId },
        $setOnInsert: { name: destination.name, insertedAt: this.now() },
      },
      { upsert: true },
    );
  }

  async remove(name: string): Promise<void> {
    await this.collection.deleteOne({ name });
  }
}
