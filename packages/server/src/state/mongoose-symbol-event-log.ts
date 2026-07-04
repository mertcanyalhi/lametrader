import type { RuleEventEntry } from '@lametrader/core';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { SymbolEventDoc } from './symbol-event-doc.schema.js';
import type { SymbolEventLog } from './symbol-event-log.types.js';

/**
 * Mongoose-backed {@link SymbolEventLog}: reads a symbol's mirrored rule-engine
 * events off the `watchlist` document's embedded `events` array (ADR-0014).
 *
 * Mirrors the read side of the native-driver `MongoEventLog.symbolEvents` — a
 * single projected document read, filtered/ordered in memory by the
 * {@link import('./state-history.service.js').StateHistoryService}. The rule
 * engine's orchestrator is what appends these entries; this adapter only reads
 * them back.
 */
@Injectable()
export class MongooseSymbolEventLog implements SymbolEventLog {
  /**
   * @param model - the read projection of the `watchlist` collection's `events`
   *   array, injected by `@nestjs/mongoose`.
   */
  constructor(@InjectModel(SymbolEventDoc.name) private readonly model: Model<SymbolEventDoc>) {}

  async symbolEvents(symbolId: string): Promise<RuleEventEntry[]> {
    const doc = await this.model.findById(symbolId, { events: 1 }).lean().exec();
    return doc?.events ?? [];
  }
}
