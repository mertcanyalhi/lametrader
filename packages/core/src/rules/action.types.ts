import type { StateValue } from '../state.types.js';

/**
 * The kind of an {@link Action} — what side-effect a rule's `then` clause
 * performs when the rule fires.
 *
 * The string value is the persisted/serialized tag (stable across JSON
 * round-trips).
 *
 * Per ADR 0016, every notification action shares a single `Notification` kind
 * discriminated by `channel`; only `'telegram'` ships today.
 */
export enum ActionKind {
  /** Send a message over a notification channel (channel discriminator). */
  Notification = 'notification',
  /** Set a key in the firing symbol's state to a {@link StateValue}. */
  SetSymbolState = 'setSymbolState',
  /** Remove a key from the firing symbol's state. */
  RemoveSymbolState = 'removeSymbolState',
  /** Set a key in the global (cross-symbol) state. */
  SetGlobalState = 'setGlobalState',
  /** Remove a key from the global state. */
  RemoveGlobalState = 'removeGlobalState',
}

/**
 * The channel a {@link NotificationAction} delivers through.
 *
 * Only `Telegram` ships today.
 * Email / Slack / webhook / in-app land as new variants under the same kind.
 */
export enum NotificationChannel {
  /** Telegram delivery via a named destination. */
  Telegram = 'telegram',
}

/**
 * Send a notification on `channel`.
 *
 * Currently only the Telegram variant is defined (per the YAGNI ladder); new
 * channels add new payload shapes under the same `kind`.
 */
export interface NotificationAction {
  kind: ActionKind.Notification;
  channel: NotificationChannel.Telegram;
  /** The non-empty destination name (resolved to chat-id by config). */
  destinationName: string;
  /** The non-empty message template. */
  template: string;
}

/** Write a {@link StateValue} to the firing symbol's state under `key`. */
export interface SetSymbolStateAction {
  kind: ActionKind.SetSymbolState;
  /** The non-empty state key. */
  key: string;
  /** The value to write. */
  value: StateValue;
}

/** Remove `key` from the firing symbol's state. */
export interface RemoveSymbolStateAction {
  kind: ActionKind.RemoveSymbolState;
  /** The non-empty state key. */
  key: string;
}

/** Write a {@link StateValue} to the global (cross-symbol) state under `key`. */
export interface SetGlobalStateAction {
  kind: ActionKind.SetGlobalState;
  /** The non-empty state key. */
  key: string;
  /** The value to write. */
  value: StateValue;
}

/** Remove `key` from the global state. */
export interface RemoveGlobalStateAction {
  kind: ActionKind.RemoveGlobalState;
  /** The non-empty state key. */
  key: string;
}

/**
 * One side-effect performed by a rule's `then` clause.
 *
 * Tagged union over {@link ActionKind}.
 */
export type Action =
  | NotificationAction
  | SetSymbolStateAction
  | RemoveSymbolStateAction
  | SetGlobalStateAction
  | RemoveGlobalStateAction;
