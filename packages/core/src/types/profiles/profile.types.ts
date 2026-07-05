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
 * A profile's scope, discriminated on `type`.
 *
 * Either every watched symbol, or an explicit subset of them.
 */
export type ProfileScopeSpec = AllScope | SymbolsScope;

/**
 * The mutable fields of a {@link Profile} — everything except its identity and timestamps.
 *
 * Shared by the create/replace/patch validation helpers.
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
 * An indicator attached to a profile, with its inputs already validated against the definition.
 *
 * `version` is the `IndicatorDefinition.version` recorded at attach/replace time so future migrations can run if the indicator's schema bumps.
 *
 * No period is stored: at compute time the indicator runs at each of the symbol's watched periods.
 *
 * `summary` is a derived display string (e.g. `"SMA 14 close"`), produced from the module's `summary(inputs)` function — it is **never persisted**, only added at read time so callers can render an instance without re-running the formatter.
 */
export interface IndicatorInstance {
  /** Generated, stable id (so actions can address this attachment). */
  id: string;
  /** Which indicator definition (key) from the {@link IndicatorRegistry}. */
  indicatorKey: string;
  /** Definition version the inputs were validated against. */
  version: number;
  /** Validated input values keyed by descriptor key. */
  inputs: Record<string, unknown>;
  /** Optional alias (e.g. to tell two attachments of the same indicator apart). */
  label?: string;
  /** Derived display summary (e.g. `"SMA 14 close"`). Set on read by the service, never persisted. */
  summary?: string;
}

/**
 * A persisted profile: the mutable {@link ProfileFields} plus a generated id, creation/update timestamps, and the embedded `indicators` array.
 *
 * A named template holding attached indicators (and later actions).
 *
 * Sub-resource routes (`/profiles/:id/indicators/...`) are the only path that mutates the `indicators` array; profile-level `PUT` / `PATCH` preserve it.
 */
export interface Profile extends ProfileFields {
  /** Generated, stable id. */
  id: string;
  /** Creation time, epoch milliseconds. */
  createdAt: number;
  /** Last-update time, epoch milliseconds. */
  updatedAt: number;
  /** Attached indicators, in attachment order. */
  indicators: IndicatorInstance[];
}

/**
 * Driven port for persisting {@link Profile}s, keyed by id.
 *
 * Implemented by driven adapters (MongoDB); an in-memory adapter backs the unit tier.
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
