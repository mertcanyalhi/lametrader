import { randomUUID } from 'node:crypto';
import {
  BOT_TOKEN_MAX,
  CHAT_ID_MAX,
  ConfigKey,
  type ConfigRepository,
  DESTINATION_NAME_MAX,
  NotificationChannel,
  type NotificationConfig,
  type NotificationConfigSummary,
  type NotificationConfigView,
  type TelegramConfigLookup,
  type TelegramNotificationConfig,
} from '@lametrader/core';
import { Inject, Injectable } from '@nestjs/common';
import {
  NotificationConfigConflictError,
  NotificationConfigError,
  NotificationConfigNotFoundError,
} from '../domain/notification-config.js';
import { CONFIG_REPOSITORY } from '../interfaces/config-repository.token.js';

/**
 * The fields needed to create a notification config — the `POST` body after
 * validation. `notificationType` is the channel discriminator; the remaining
 * fields are Telegram's (the only channel today).
 */
export interface CreateNotificationConfigInput {
  /** The channel to create; only `Telegram` is supported today. */
  notificationType: NotificationChannel;
  /** Human-readable, unique alias. */
  name: string;
  /** Bot API token (sensitive). */
  botToken: string;
  /** Target chat id. */
  chatId: string;
}

/**
 * The mutable fields of a notification config — the `PATCH` body. Every field
 * is optional (partial merge); `notificationType` and `id` are immutable and
 * absent here.
 */
export interface UpdateNotificationConfigInput {
  /** New name (must stay unique). */
  name?: string;
  /** New bot token; omitted keeps the stored one. */
  botToken?: string;
  /** New chat id. */
  chatId?: string;
}

/**
 * Use-case for reading and changing the configured notification destinations.
 *
 * Stored as a single `NotificationConfig[]` under {@link ConfigKey.Notifications}
 * in the shared config K/V store — deliberately not its own collection
 * (admin-edited, rare writes, < 10 entries → array-level writes + app-level
 * uniqueness in exchange for one fewer collection; see `config-layer.spec.md`).
 *
 * Identity is a server-generated `id` (the REST `:id`); `name` stays the
 * rule-facing alias the notifier resolves by, so it is kept unique.
 *
 * Concurrency: last-write-wins on the whole array — acceptable at single-tenant
 * scale.
 */
@Injectable()
export class NotificationConfigsService implements TelegramConfigLookup {
  /**
   * @param repo - the shared config K/V repository.
   */
  constructor(@Inject(CONFIG_REPOSITORY) private readonly repo: ConfigRepository) {}

  /**
   * Configured configs as list summaries (id + type + name; no channel-specific
   * or sensitive fields), in insertion order.
   */
  async list(): Promise<NotificationConfigSummary[]> {
    const all = await this.readAll();
    return all.map(({ id, notificationType, name }) => ({ id, notificationType, name }));
  }

  /**
   * The single-config view by id (non-sensitive fields, no `botToken`).
   * Throws {@link NotificationConfigNotFoundError} when the id is unknown.
   */
  async get(id: string): Promise<NotificationConfigView> {
    const all = await this.readAll();
    const found = all.find((c) => c.id === id);
    if (found === undefined) throw notFound(id);
    return toView(found);
  }

  /**
   * Find one Telegram config by name, including its bot token (the notifier's
   * hot path). Returns `null` when no Telegram config with that name exists.
   */
  async findByName(name: string): Promise<TelegramNotificationConfig | null> {
    const all = await this.readAll();
    return (
      all.find((c) => c.notificationType === NotificationChannel.Telegram && c.name === name) ??
      null
    );
  }

  /**
   * Create a config. Trims and validates every field, rejects a duplicate
   * `name` with {@link NotificationConfigConflictError}, assigns a fresh id,
   * persists, and returns the view (no bot token).
   */
  async create(input: CreateNotificationConfigInput): Promise<NotificationConfigView> {
    // Lazy: Telegram is the only channel; a per-channel validation dispatch
    // (and a discriminated payload) lands with the second channel.
    if (input.notificationType !== NotificationChannel.Telegram) {
      throw new NotificationConfigError(`unsupported notificationType: ${input.notificationType}`);
    }
    const name = requireField(input.name, 'name', DESTINATION_NAME_MAX);
    const botToken = requireField(input.botToken, 'botToken', BOT_TOKEN_MAX);
    const chatId = requireField(input.chatId, 'chatId', CHAT_ID_MAX);
    const all = await this.readAll();
    if (all.some((c) => c.name === name)) {
      throw new NotificationConfigConflictError(`A notification named "${name}" already exists`);
    }
    const created: TelegramNotificationConfig = {
      id: randomUUID(),
      notificationType: NotificationChannel.Telegram,
      name,
      botToken,
      chatId,
    };
    all.push(created);
    await this.repo.set(ConfigKey.Notifications, all);
    return toView(created);
  }

  /**
   * Partially update a config by id. Merges the provided (trimmed, validated)
   * fields over the stored one; an omitted field is unchanged. A rename onto
   * another config's name throws {@link NotificationConfigConflictError}; an
   * unknown id throws {@link NotificationConfigNotFoundError}.
   */
  async update(id: string, patch: UpdateNotificationConfigInput): Promise<NotificationConfigView> {
    const all = await this.readAll();
    const index = all.findIndex((c) => c.id === id);
    if (index === -1) throw notFound(id);
    const current = all[index] as TelegramNotificationConfig;
    const next: TelegramNotificationConfig = { ...current };
    if (patch.name !== undefined)
      next.name = requireField(patch.name, 'name', DESTINATION_NAME_MAX);
    if (patch.botToken !== undefined)
      next.botToken = requireField(patch.botToken, 'botToken', BOT_TOKEN_MAX);
    if (patch.chatId !== undefined) next.chatId = requireField(patch.chatId, 'chatId', CHAT_ID_MAX);
    if (next.name !== current.name && all.some((c) => c.id !== id && c.name === next.name)) {
      throw new NotificationConfigConflictError(
        `A notification named "${next.name}" already exists`,
      );
    }
    all[index] = next;
    await this.repo.set(ConfigKey.Notifications, all);
    return toView(next);
  }

  /**
   * Delete a config by id. Throws {@link NotificationConfigNotFoundError} when
   * the id is unknown so the API surfaces a 404 instead of silently accepting.
   */
  async remove(id: string): Promise<void> {
    const all = await this.readAll();
    const next = all.filter((c) => c.id !== id);
    if (next.length === all.length) throw notFound(id);
    await this.repo.set(ConfigKey.Notifications, next);
  }

  /**
   * Read the configs array from the K/V store, defaulting to `[]` when nothing
   * is stored, and shallow-cloning so callers can safely mutate. Validates the
   * stored value's outer shape (an array of Telegram configs with the required
   * string fields) so a corrupt store surfaces as an explicit error.
   */
  private async readAll(): Promise<NotificationConfig[]> {
    const raw = await this.repo.get(ConfigKey.Notifications);
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) {
      throw new NotificationConfigError(`notifications must be an array (got: ${typeof raw})`);
    }
    return raw.map((entry) => parseEntry(entry));
  }
}

/** Trim a field and enforce non-empty + max length, or throw a 400 domain error. */
function requireField(value: string, label: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed === '') throw new NotificationConfigError(`${label} is required`);
  if (trimmed.length > max) {
    throw new NotificationConfigError(`${label} must be ${max} characters or fewer`);
  }
  return trimmed;
}

/** Strip the sensitive `botToken` to produce the read view. */
function toView(config: TelegramNotificationConfig): NotificationConfigView {
  const { botToken: _botToken, ...view } = config;
  return view;
}

/** A not-found error naming the missing id. */
function notFound(id: string): NotificationConfigNotFoundError {
  return new NotificationConfigNotFoundError(`No notification config with id "${id}"`);
}

/** Validate one stored entry has the full Telegram-config shape, or throw. */
function parseEntry(entry: unknown): NotificationConfig {
  const e = entry as Record<string, unknown>;
  if (
    entry === null ||
    typeof entry !== 'object' ||
    typeof e.id !== 'string' ||
    e.notificationType !== NotificationChannel.Telegram ||
    typeof e.name !== 'string' ||
    typeof e.botToken !== 'string' ||
    typeof e.chatId !== 'string'
  ) {
    throw new NotificationConfigError(
      'notifications entries must each be { id, notificationType, name, botToken, chatId }',
    );
  }
  return {
    id: e.id,
    notificationType: NotificationChannel.Telegram,
    name: e.name,
    botToken: e.botToken,
    chatId: e.chatId,
  };
}
