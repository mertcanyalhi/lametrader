/**
 * How a profile selects which watched symbols it applies to.
 */
export enum ProfileScope {
  /** Every watched symbol (the default). */
  All = 'all',
  /** An explicit subset of watched symbols. */
  Symbols = 'symbols',
}

/**
 * A profile scoped to every watched symbol.
 */
export interface AllScope {
  /** Discriminant: applies to all watched symbols. */
  type: ProfileScope.All;
}

/**
 * A profile scoped to an explicit subset of watched symbol ids.
 */
export interface SymbolsScope {
  /** Discriminant: applies to an explicit subset. */
  type: ProfileScope.Symbols;
  /** The watched symbol ids this profile applies to (non-empty when persisted). */
  symbolIds: string[];
}

/**
 * A profile's scope, discriminated on `type`: all watched symbols, or an explicit
 * subset of them.
 */
export type ProfileScopeSpec = AllScope | SymbolsScope;

/**
 * The mutable fields of a {@link Profile} — everything except its identity and
 * timestamps. Shared by the create/replace/patch validation helpers.
 */
export interface ProfileFields {
  /** Human-readable, unique name. */
  name: string;
  /** Free-text description (may be empty). */
  description: string;
  /** Whether the profile is active; disabling turns off its monitoring/actions. */
  enabled: boolean;
  /** Which watched symbols the profile applies to. */
  scope: ProfileScopeSpec;
}

/**
 * A persisted profile: the mutable {@link ProfileFields} plus a generated id and
 * creation/update timestamps. A named template that will later hold indicators and
 * actions.
 */
export interface Profile extends ProfileFields {
  /** Generated, stable id. */
  id: string;
  /** Creation time, epoch milliseconds. */
  createdAt: number;
  /** Last-update time, epoch milliseconds. */
  updatedAt: number;
}

/**
 * Driven port for persisting {@link Profile}s, keyed by id. Implemented by driven
 * adapters (MongoDB); an in-memory adapter backs the unit tier.
 */
export interface ProfileRepository {
  /**
   * All stored profiles.
   */
  list(): Promise<Profile[]>;
  /**
   * One profile by id, or `null` if none exists.
   */
  get(id: string): Promise<Profile | null>;
  /**
   * Upsert a profile, keyed by id (re-saving an id replaces it).
   */
  save(profile: Profile): Promise<void>;
  /**
   * Delete a profile by id. Idempotent (no-op when absent).
   */
  remove(id: string): Promise<void>;
}
