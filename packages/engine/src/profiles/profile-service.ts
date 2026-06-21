import {
  type FiringStateRepository,
  IndicatorError,
  type IndicatorInstance,
  IndicatorInstanceNotFoundError,
  mergeProfileFields,
  type Profile,
  ProfileConflictError,
  ProfileError,
  ProfileNotFoundError,
  type ProfileRepository,
  ProfileScope,
  type ProfileScopeSpec,
  parseProfileFields,
  type RuleRepository,
  validateIndicatorInputs,
  type WatchlistRepository,
} from '@lametrader/core';
import { nanoid } from 'nanoid';
import type { IndicatorRegistry } from '../indicators/indicator-registry.js';
import type { ProfileServiceOptions } from './profile-service.types.js';

/**
 * Raw input for attaching or replacing an indicator instance on a profile.
 *
 * `inputs` is typed as `Record<string, unknown>` here and validated against the indicator's descriptors by {@link validateIndicatorInputs} before storage.
 */
export interface IndicatorInstanceInput {
  /** Which indicator definition (key) to attach. */
  indicatorKey: string;
  /** Raw input values (validated + defaulted against the definition). */
  inputs?: Record<string, unknown>;
  /** Optional alias. */
  label?: string;
}

/**
 * Application use-case for managing {@link Profile}s.
 *
 * A profile is a named, enable/disable-able template scoped to watched symbols, holding zero or more attached indicators.
 *
 * Depends only on ports: a {@link ProfileRepository} (persistence), a {@link WatchlistRepository} (to validate a `Symbols` scope), and an {@link IndicatorRegistry} (to validate attached-indicator inputs).
 *
 * Id generation and the clock are injectable so tests are deterministic.
 */
export class ProfileService {
  /** Id generator (injectable; defaults to nanoid). */
  private readonly newId: () => string;
  /** Current clock (injectable; defaults to `Date.now`). */
  private readonly now: () => number;
  /** Rule store consulted by the profile-delete cascade (optional). */
  private readonly rules?: RuleRepository;
  /** Firing-state store consulted by the profile-delete cascade (optional). */
  private readonly firingState?: FiringStateRepository;

  /**
   * @param profiles - the profile persistence port.
   * @param watchlist - the watchlist persistence port (for scope validation).
   * @param indicators - the indicator registry (for attached-instance validation).
   * @param options - injectable id generator, clock, and cascade ports.
   */
  constructor(
    private readonly profiles: ProfileRepository,
    private readonly watchlist: WatchlistRepository,
    private readonly indicators: IndicatorRegistry,
    options: ProfileServiceOptions = {},
  ) {
    this.newId = options.newId ?? (() => nanoid());
    this.now = options.now ?? Date.now;
    this.rules = options.rules;
    this.firingState = options.firingState;
  }

  /**
   * List all profiles, with each instance's `summary` derived from the registry.
   */
  async list(): Promise<Profile[]> {
    const all = await this.profiles.list();
    return all.map((profile) => this.enrichProfile(profile));
  }

  /**
   * Get one profile by id, with each embedded instance enriched with `summary`.
   *
   * @throws {@link ProfileNotFoundError} when no profile has that id.
   */
  async get(id: string): Promise<Profile> {
    const stored = await this.getStored(id);
    return this.enrichProfile(stored);
  }

  /**
   * Internal read that skips enrichment — used by methods that re-save the profile
   * (they need the unstamped indicators[] to avoid persisting derived `summary` fields).
   */
  private async getStored(id: string): Promise<Profile> {
    const profile = await this.profiles.get(id);
    if (!profile) {
      throw new ProfileNotFoundError(`profile not found: ${id}`);
    }
    return profile;
  }

  /**
   * Create a profile from an input (validated + defaulted).
   *
   * Generates the id and timestamps; the embedded `indicators` array starts empty.
   *
   * @throws {@link ProfileError} on invalid fields or an unwatched scope id.
   * @throws {@link ProfileConflictError} when the name is already in use.
   */
  async create(input: unknown): Promise<Profile> {
    const fields = parseProfileFields(input);
    await this.assertNameAvailable(fields.name);
    await this.assertScopeWatched(fields.scope);
    const ts = this.now();
    const profile: Profile = {
      id: this.newId(),
      ...fields,
      createdAt: ts,
      updatedAt: ts,
      indicators: [],
    };
    await this.profiles.save(profile);
    return this.enrichProfile(profile);
  }

  /**
   * Fully replace a profile's mutable fields (PUT).
   *
   * Preserves `id`, `createdAt`, and the embedded `indicators` array; bumps `updatedAt`.
   *
   * @throws {@link ProfileNotFoundError} when the id is unknown.
   * @throws {@link ProfileError} / {@link ProfileConflictError} on invalid input.
   */
  async replace(id: string, input: unknown): Promise<Profile> {
    const existing = await this.getStored(id);
    const fields = parseProfileFields(input);
    await this.assertNameAvailable(fields.name, id);
    await this.assertScopeWatched(fields.scope);
    const updated: Profile = { ...existing, ...fields, updatedAt: this.now() };
    await this.profiles.save(updated);
    return this.enrichProfile(updated);
  }

  /**
   * Partially update a profile (PATCH).
   *
   * Merges the patch over the current fields, revalidates, and persists; preserves `indicators`.
   *
   * @throws {@link ProfileNotFoundError} when the id is unknown.
   * @throws {@link ProfileError} / {@link ProfileConflictError} on invalid input.
   */
  async update(id: string, patch: unknown): Promise<Profile> {
    const existing = await this.getStored(id);
    const fields = mergeProfileFields(existing, patch);
    await this.assertNameAvailable(fields.name, id);
    await this.assertScopeWatched(fields.scope);
    const updated: Profile = { ...existing, ...fields, updatedAt: this.now() };
    await this.profiles.save(updated);
    return this.enrichProfile(updated);
  }

  /**
   * Delete a profile by id.
   *
   * When the optional `rules` + `firingState` ports are wired in, every rule
   * belonging to the profile is removed and the rules' persisted firing-state
   * entries are purged — same pattern as the candle cascade in ADR-0009.
   *
   * @throws {@link ProfileNotFoundError} when the id is unknown.
   */
  async remove(id: string): Promise<void> {
    await this.getStored(id);
    if (this.rules !== undefined) {
      const removedRuleIds = await this.rules.removeForProfile(id);
      if (this.firingState !== undefined) {
        for (const ruleId of removedRuleIds) {
          await this.firingState.removeByRule(ruleId);
        }
      }
    }
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
   * List the indicator instances attached to a profile.
   *
   * @throws {@link ProfileNotFoundError} when the profile is unknown.
   */
  async listIndicators(profileId: string): Promise<IndicatorInstance[]> {
    const profile = await this.getStored(profileId);
    return profile.indicators.map((instance) => this.enrichInstance(instance));
  }

  /**
   * Get one attached indicator instance by id, enriched with `summary`.
   *
   * @throws {@link ProfileNotFoundError} when the profile is unknown.
   * @throws {@link IndicatorInstanceNotFoundError} when no instance has that id.
   */
  async getIndicator(profileId: string, instanceId: string): Promise<IndicatorInstance> {
    const profile = await this.getStored(profileId);
    return this.enrichInstance(findInstance(profile, instanceId));
  }

  /**
   * Attach a new indicator instance to a profile.
   *
   * Validates the input against the indicator's descriptors and records the definition's current `version`.
   *
   * @throws {@link ProfileNotFoundError} when the profile is unknown.
   * @throws {@link IndicatorError} when `indicatorKey` is unknown or `inputs` are invalid.
   */
  async addIndicator(profileId: string, input: IndicatorInstanceInput): Promise<IndicatorInstance> {
    const profile = await this.getStored(profileId);
    const instance = this.buildInstance(this.newId(), input);
    const updated: Profile = {
      ...profile,
      indicators: [...profile.indicators, instance],
      updatedAt: this.now(),
    };
    await this.profiles.save(updated);
    return this.enrichInstance(instance);
  }

  /**
   * Replace an attached indicator instance (PUT) — full-replace, preserves the id.
   *
   * @throws {@link ProfileNotFoundError} when the profile is unknown.
   * @throws {@link IndicatorInstanceNotFoundError} when the instance is unknown.
   * @throws {@link IndicatorError} when `indicatorKey` is unknown or `inputs` are invalid.
   */
  async replaceIndicator(
    profileId: string,
    instanceId: string,
    input: IndicatorInstanceInput,
  ): Promise<IndicatorInstance> {
    const profile = await this.getStored(profileId);
    findInstance(profile, instanceId);
    const replacement = this.buildInstance(instanceId, input);
    const updated: Profile = {
      ...profile,
      indicators: profile.indicators.map((existing) =>
        existing.id === instanceId ? replacement : existing,
      ),
      updatedAt: this.now(),
    };
    await this.profiles.save(updated);
    return this.enrichInstance(replacement);
  }

  /**
   * Detach an indicator instance from a profile.
   *
   * @throws {@link ProfileNotFoundError} when the profile is unknown.
   * @throws {@link IndicatorInstanceNotFoundError} when the instance is unknown.
   */
  async removeIndicator(profileId: string, instanceId: string): Promise<void> {
    const profile = await this.getStored(profileId);
    findInstance(profile, instanceId);
    const updated: Profile = {
      ...profile,
      indicators: profile.indicators.filter((existing) => existing.id !== instanceId),
      updatedAt: this.now(),
    };
    await this.profiles.save(updated);
  }

  /**
   * Decorate one stored {@link IndicatorInstance} with its derived `summary` from
   * the indicator module. When the indicator key is unknown locally (e.g. a
   * module was removed after the instance was attached), `summary` is left absent.
   */
  private enrichInstance(instance: IndicatorInstance): IndicatorInstance {
    const module = this.indicators.get(instance.indicatorKey);
    if (!module) return instance;
    // The stored `inputs` were validated against this module's descriptors at
    // attach/replace time, so they satisfy `InferInputs<I>` at runtime — the
    // type info just doesn't survive the `Record<string, unknown>` round-trip
    // through storage.
    return {
      ...instance,
      summary: module.summary(instance.inputs as Parameters<typeof module.summary>[0]),
    };
  }

  /**
   * Decorate a profile's embedded `indicators[]` with `summary` for each instance.
   */
  private enrichProfile(profile: Profile): Profile {
    return {
      ...profile,
      indicators: profile.indicators.map((instance) => this.enrichInstance(instance)),
    };
  }

  /**
   * Look up the indicator module and validate the input, producing a stored instance shape.
   */
  private buildInstance(id: string, input: IndicatorInstanceInput): IndicatorInstance {
    if (typeof input.indicatorKey !== 'string') {
      throw new IndicatorError('indicatorKey must be a string');
    }
    const module = this.indicators.get(input.indicatorKey);
    if (!module) {
      throw new IndicatorError(`unknown indicator: ${input.indicatorKey}`);
    }
    if (input.label !== undefined && typeof input.label !== 'string') {
      throw new IndicatorError('label must be a string');
    }
    const validated = validateIndicatorInputs(module.definition, input.inputs ?? {});
    return {
      id,
      indicatorKey: input.indicatorKey,
      version: module.definition.version,
      inputs: validated,
      ...(input.label !== undefined ? { label: input.label } : {}),
    };
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

/**
 * Locate an indicator instance on a profile or throw {@link IndicatorInstanceNotFoundError}.
 */
function findInstance(profile: Profile, instanceId: string): IndicatorInstance {
  const instance = profile.indicators.find((existing) => existing.id === instanceId);
  if (!instance) {
    throw new IndicatorInstanceNotFoundError(
      `indicator instance not found: ${instanceId} (profile ${profile.id})`,
    );
  }
  return instance;
}
