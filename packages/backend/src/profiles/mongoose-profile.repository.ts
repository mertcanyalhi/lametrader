import type { Profile, ProfileRepository } from '@lametrader/core';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { ProfileEntry } from './profile-entry.schema.js';

/**
 * Mongoose-backed {@link ProfileRepository}. Stores each profile as one document
 * in the `profiles` collection, keyed by id (`_id`).
 *
 * Replaces the native-driver `MongoProfileRepository`; the shared
 * `runProfileRepositoryContract` suite proves the swap is behaviour-identical.
 * `save` uses a full document replacement (upsert) — the same whole-document
 * semantics as the old `replaceOne`.
 */
@Injectable()
export class MongooseProfileRepository implements ProfileRepository {
  /**
   * @param model - the `profiles`-collection model injected by `@nestjs/mongoose`.
   */
  constructor(@InjectModel(ProfileEntry.name) private readonly model: Model<ProfileEntry>) {}

  async list(): Promise<Profile[]> {
    const docs = await this.model.find().lean().exec();
    return docs.map(toProfile);
  }

  async get(id: string): Promise<Profile | null> {
    const doc = await this.model.findById(id).lean().exec();
    return doc ? toProfile(doc) : null;
  }

  async save(profile: Profile): Promise<void> {
    await this.model.replaceOne({ _id: profile.id }, toDocument(profile), { upsert: true }).exec();
  }

  async remove(id: string): Promise<void> {
    await this.model.deleteOne({ _id: id }).exec();
  }
}

/**
 * Map a stored document to a domain {@link Profile}. `indicators` / `chartStates`
 * default to `[]` for legacy documents written before those fields existed.
 */
function toProfile(doc: ProfileEntry): Profile {
  return {
    id: doc._id,
    name: doc.name,
    description: doc.description,
    enabled: doc.enabled,
    scope: doc.scope,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    indicators: doc.indicators ?? [],
    chartStates: doc.chartStates ?? [],
  };
}

/**
 * Map a domain {@link Profile} to its stored document (`_id` = profile id).
 */
function toDocument(profile: Profile): ProfileEntry {
  return {
    _id: profile.id,
    name: profile.name,
    description: profile.description,
    enabled: profile.enabled,
    scope: profile.scope,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    indicators: profile.indicators,
    chartStates: profile.chartStates,
  };
}
