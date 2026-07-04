import type { Profile, ProfileRepository } from '@lametrader/core';

/**
 * A {@link ProfileRepository} backed by an in-memory map, keyed by id.
 *
 * Real (not a test double): backs the unit tier and the shared repository
 * contract, and is the fake substituted for the Mongoose adapter via a Nest DI
 * override in unit tests.
 */
export class InMemoryProfileRepository implements ProfileRepository {
  /**
   * Profiles keyed by id.
   */
  private readonly map = new Map<string, Profile>();

  /**
   * @param seed - profiles to pre-populate with.
   */
  constructor(seed: Profile[] = []) {
    for (const profile of seed) {
      this.map.set(profile.id, profile);
    }
  }

  async list(): Promise<Profile[]> {
    return [...this.map.values()];
  }

  async get(id: string): Promise<Profile | null> {
    return this.map.get(id) ?? null;
  }

  async save(profile: Profile): Promise<void> {
    this.map.set(profile.id, profile);
  }

  async remove(id: string): Promise<void> {
    this.map.delete(id);
  }
}
