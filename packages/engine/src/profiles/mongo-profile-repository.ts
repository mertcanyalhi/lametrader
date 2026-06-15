import type { Profile, ProfileRepository } from '@lametrader/core';
import type { Collection, Db } from 'mongodb';
import type { ProfileDocument } from './mongo-profile-repository.types.js';

/**
 * MongoDB-backed {@link ProfileRepository}.
 *
 * Stores each profile as a document in the `profiles` collection, keyed by id (`_id`).
 */
export class MongoProfileRepository implements ProfileRepository {
  /**
   * The database handle to read/write the `profiles` collection on.
   */
  private readonly db: Db;

  /**
   * @param db - a connected MongoDB database handle.
   */
  constructor(db: Db) {
    this.db = db;
  }

  /**
   * The typed `profiles` collection.
   */
  private get collection(): Collection<ProfileDocument> {
    return this.db.collection<ProfileDocument>('profiles');
  }

  async list(): Promise<Profile[]> {
    const docs = await this.collection.find().toArray();
    return docs.map(toProfile);
  }

  async get(id: string): Promise<Profile | null> {
    const doc = await this.collection.findOne({ _id: id });
    return doc ? toProfile(doc) : null;
  }

  async save(profile: Profile): Promise<void> {
    await this.collection.replaceOne({ _id: profile.id }, toDocument(profile), { upsert: true });
  }

  async remove(id: string): Promise<void> {
    await this.collection.deleteOne({ _id: id });
  }
}

/**
 * Map a stored document to a domain {@link Profile}.
 */
function toProfile(doc: ProfileDocument): Profile {
  return {
    id: doc._id,
    name: doc.name,
    description: doc.description,
    enabled: doc.enabled,
    scope: doc.scope,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * Map a domain {@link Profile} to its stored document.
 */
function toDocument(profile: Profile): ProfileDocument {
  return {
    _id: profile.id,
    name: profile.name,
    description: profile.description,
    enabled: profile.enabled,
    scope: profile.scope,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}
