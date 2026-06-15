import {
  mergeProfileFields,
  type Profile,
  ProfileConflictError,
  ProfileError,
  ProfileNotFoundError,
  type ProfileRepository,
  ProfileScope,
  type ProfileScopeSpec,
  parseProfileFields,
  type WatchlistRepository,
} from '@lametrader/core';
import { nanoid } from 'nanoid';
import type { ProfileServiceOptions } from './profile-service.types.js';

/**
 * Application use-case for managing {@link Profile}s.
 *
 * A profile is a named, enable/disable-able template scoped to watched symbols.
 *
 * Depends only on ports: a {@link ProfileRepository} (persistence) and the {@link WatchlistRepository} (to validate that a `Symbols` scope references currently-watched ids).
 *
 * Id generation and the clock are injectable so tests are deterministic.
 */
export class ProfileService {
  /** Id generator (injectable; defaults to nanoid). */
  private readonly newId: () => string;
  /** Current clock (injectable; defaults to `Date.now`). */
  private readonly now: () => number;

  /**
   * @param profiles - the profile persistence port.
   * @param watchlist - the watchlist persistence port (for scope validation).
   * @param options - injectable id generator and clock.
   */
  constructor(
    private readonly profiles: ProfileRepository,
    private readonly watchlist: WatchlistRepository,
    options: ProfileServiceOptions = {},
  ) {
    this.newId = options.newId ?? (() => nanoid());
    this.now = options.now ?? Date.now;
  }

  /**
   * List all profiles.
   */
  list(): Promise<Profile[]> {
    return this.profiles.list();
  }

  /**
   * Get one profile by id.
   *
   * @throws {@link ProfileNotFoundError} when no profile has that id.
   */
  async get(id: string): Promise<Profile> {
    const profile = await this.profiles.get(id);
    if (!profile) {
      throw new ProfileNotFoundError(`profile not found: ${id}`);
    }
    return profile;
  }

  /**
   * Create a profile from an input (validated + defaulted).
   *
   * Generates the id and timestamps.
   *
   * @throws {@link ProfileError} on invalid fields or an unwatched scope id.
   * @throws {@link ProfileConflictError} when the name is already in use.
   */
  async create(input: unknown): Promise<Profile> {
    const fields = parseProfileFields(input);
    await this.assertNameAvailable(fields.name);
    await this.assertScopeWatched(fields.scope);
    const ts = this.now();
    const profile: Profile = { id: this.newId(), ...fields, createdAt: ts, updatedAt: ts };
    await this.profiles.save(profile);
    return profile;
  }

  /**
   * Fully replace a profile's mutable fields (PUT).
   *
   * Preserves `id` and `createdAt`, bumps `updatedAt`.
   *
   * @throws {@link ProfileNotFoundError} when the id is unknown.
   * @throws {@link ProfileError} / {@link ProfileConflictError} on invalid input.
   */
  async replace(id: string, input: unknown): Promise<Profile> {
    const existing = await this.get(id);
    const fields = parseProfileFields(input);
    await this.assertNameAvailable(fields.name, id);
    await this.assertScopeWatched(fields.scope);
    const updated: Profile = { ...existing, ...fields, updatedAt: this.now() };
    await this.profiles.save(updated);
    return updated;
  }

  /**
   * Partially update a profile (PATCH).
   *
   * Merges the patch over the current fields, revalidates, and persists.
   *
   * @throws {@link ProfileNotFoundError} when the id is unknown.
   * @throws {@link ProfileError} / {@link ProfileConflictError} on invalid input.
   */
  async update(id: string, patch: unknown): Promise<Profile> {
    const existing = await this.get(id);
    const fields = mergeProfileFields(existing, patch);
    await this.assertNameAvailable(fields.name, id);
    await this.assertScopeWatched(fields.scope);
    const updated: Profile = { ...existing, ...fields, updatedAt: this.now() };
    await this.profiles.save(updated);
    return updated;
  }

  /**
   * Delete a profile by id.
   *
   * @throws {@link ProfileNotFoundError} when the id is unknown.
   */
  async remove(id: string): Promise<void> {
    await this.get(id);
    await this.profiles.remove(id);
  }

  /**
   * Remove a symbol id from every profile's `Symbols` scope.
   *
   * Called when a symbol leaves the watchlist.
   *
   * A profile whose subset becomes empty is **disabled** and left `Symbols`-scoped, rather than silently widening to `All`.
   */
  async pruneSymbol(symbolId: string): Promise<void> {
    for (const profile of await this.profiles.list()) {
      if (profile.scope.type !== ProfileScope.Symbols) continue;
      if (!profile.scope.symbolIds.includes(symbolId)) continue;
      const symbolIds = profile.scope.symbolIds.filter((id) => id !== symbolId);
      const updated: Profile =
        symbolIds.length === 0
          ? {
              ...profile,
              enabled: false,
              scope: { type: ProfileScope.Symbols, symbolIds: [] },
              updatedAt: this.now(),
            }
          : { ...profile, scope: { type: ProfileScope.Symbols, symbolIds }, updatedAt: this.now() };
      await this.profiles.save(updated);
    }
  }

  /**
   * Throw {@link ProfileConflictError} when `name` is used by a profile other than `exceptId`.
   */
  private async assertNameAvailable(name: string, exceptId?: string): Promise<void> {
    const all = await this.profiles.list();
    if (all.some((profile) => profile.name === name && profile.id !== exceptId)) {
      throw new ProfileConflictError(`profile name already in use: ${name}`);
    }
  }

  /**
   * Throw {@link ProfileError} when a `Symbols` scope references an id that is not currently watched.
   */
  private async assertScopeWatched(scope: ProfileScopeSpec): Promise<void> {
    if (scope.type !== ProfileScope.Symbols) return;
    for (const id of scope.symbolIds) {
      if (!(await this.watchlist.get(id))) {
        throw new ProfileError(`symbol not watched: ${id}`);
      }
    }
  }
}
