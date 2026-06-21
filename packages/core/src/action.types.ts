import type { StateValue } from './state.types.js';

/**
 * The kind of an {@link Action} — what side-effect a rule's `then` clause
 * performs when the rule fires.
 *
 * The string value is the persisted/serialized tag (stable across JSON
 * round-trips).
 */
export enum ActionKind {
  /** Set a key in the firing symbol's state to a {@link StateValue}. */
  SetSymbolState = 'setSymbolState',
  /** Remove a key from the firing symbol's state. */
  RemoveSymbolState = 'removeSymbolState',
  /** Set a key in the global (cross-symbol) state. */
  SetGlobalState = 'setGlobalState',
  /** Remove a key from the global state. */
  RemoveGlobalState = 'removeGlobalState',
  /** Send a Telegram message via the named destination. */
  NotifyTelegram = 'notifyTelegram',
}

/**
 * Write a {@link StateValue} to the firing symbol's state under `key`.
 */
export interface SetSymbolStateAction {
  kind: ActionKind.SetSymbolState;
  /** The non-empty state key. */
  key: string;
  /** The value to write. */
  value: StateValue;
}

/**
 * Remove `key` from the firing symbol's state.
 */
export interface RemoveSymbolStateAction {
  kind: ActionKind.RemoveSymbolState;
  /** The non-empty state key. */
  key: string;
}

/**
 * Write a {@link StateValue} to the global (cross-symbol) state under `key`.
 */
export interface SetGlobalStateAction {
  kind: ActionKind.SetGlobalState;
  /** The non-empty state key. */
  key: string;
  /** The value to write. */
  value: StateValue;
}

/**
 * Remove `key` from the global state.
 */
export interface RemoveGlobalStateAction {
  kind: ActionKind.RemoveGlobalState;
  /** The non-empty state key. */
  key: string;
}

/**
 * Send a Telegram message via the named destination, rendering `template` with
 * the firing context.
 */
export interface NotifyTelegramAction {
  kind: ActionKind.NotifyTelegram;
  /** The non-empty destination name (resolved to chat-id by config). */
  destinationName: string;
  /** The non-empty message template. */
  template: string;
}

/**
 * One side-effect performed by a rule's `then` clause.
 *
 * Tagged union over {@link ActionKind}.
 */
export type Action =
  | SetSymbolStateAction
  | RemoveSymbolStateAction
  | SetGlobalStateAction
  | RemoveGlobalStateAction
  | NotifyTelegramAction;
