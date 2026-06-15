import { type ProfileFields, ProfileScope, type ProfileScopeSpec } from './profile.types.js';

/**
 * Raised when a profile input fails validation (bad name, scope, or field type).
 *
 * Distinct type so driving adapters map it to a client error (HTTP 400) rather than a server fault.
 */
export class ProfileError extends Error {
  /**
   * @param message - the human-readable validation failure reason.
   */
  constructor(message: string) {
    super(message);
    this.name = 'ProfileError';
  }
}

/**
 * Raised when a profile does not exist (on get/update/remove).
 *
 * Driving adapters map it to HTTP 404.
 */
export class ProfileNotFoundError extends Error {
  /**
   * @param message - the human-readable not-found reason.
   */
  constructor(message: string) {
    super(message);
    this.name = 'ProfileNotFoundError';
  }
}

/**
 * Raised when creating or renaming a profile to a name already in use.
 *
 * Driving adapters map it to HTTP 409.
 */
export class ProfileConflictError extends Error {
  /**
   * @param message - the human-readable conflict reason.
   */
  constructor(message: string) {
    super(message);
    this.name = 'ProfileConflictError';
  }
}

/**
 * Validate and normalize an unknown scope input into a {@link ProfileScopeSpec}.
 *
 * An explicit `Symbols` scope with an **empty** `symbolIds` normalizes to `All` — an empty subset never persists.
 *
 * @throws {@link ProfileError} on an unknown `type` or a non-string id.
 */
export function parseProfileScope(input: unknown): ProfileScopeSpec {
  const obj = (input ?? {}) as { type?: unknown; symbolIds?: unknown };
  if (obj.type === ProfileScope.All) {
    return { type: ProfileScope.All };
  }
  if (obj.type === ProfileScope.Symbols) {
    if (!Array.isArray(obj.symbolIds)) {
      throw new ProfileError('scope.symbolIds must be an array');
    }
    const symbolIds: string[] = [];
    for (const raw of obj.symbolIds) {
      if (typeof raw !== 'string' || raw.length === 0) {
        throw new ProfileError(`invalid symbol id: ${String(raw)}`);
      }
      symbolIds.push(raw);
    }
    if (symbolIds.length === 0) {
      return { type: ProfileScope.All };
    }
    return { type: ProfileScope.Symbols, symbolIds };
  }
  throw new ProfileError(`unknown scope type: ${String(obj.type)}`);
}

/**
 * Validate and normalize an unknown input into the mutable {@link ProfileFields}.
 *
 * Applies defaults: description `''`, enabled `true`, scope `All`.
 *
 * @throws {@link ProfileError} on a blank `name` or a wrong-typed `description`/`enabled`.
 */
export function parseProfileFields(input: unknown): ProfileFields {
  const obj = (input ?? {}) as {
    name?: unknown;
    description?: unknown;
    enabled?: unknown;
    scope?: unknown;
  };
  if (typeof obj.name !== 'string' || obj.name.trim().length === 0) {
    throw new ProfileError('name must be a non-empty string');
  }
  if (obj.description !== undefined && typeof obj.description !== 'string') {
    throw new ProfileError('description must be a string');
  }
  if (obj.enabled !== undefined && typeof obj.enabled !== 'boolean') {
    throw new ProfileError('enabled must be a boolean');
  }
  return {
    name: obj.name,
    description: obj.description === undefined ? '' : obj.description,
    enabled: obj.enabled === undefined ? true : obj.enabled,
    scope: obj.scope === undefined ? { type: ProfileScope.All } : parseProfileScope(obj.scope),
  };
}

/**
 * Apply a partial patch over current {@link ProfileFields} and revalidate the result.
 *
 * Fields absent from `patch` are taken from `current`.
 */
export function mergeProfileFields(current: ProfileFields, patch: unknown): ProfileFields {
  const obj = (patch ?? {}) as {
    name?: unknown;
    description?: unknown;
    enabled?: unknown;
    scope?: unknown;
  };
  return parseProfileFields({
    name: obj.name ?? current.name,
    description: obj.description ?? current.description,
    enabled: obj.enabled ?? current.enabled,
    scope: obj.scope ?? current.scope,
  });
}
