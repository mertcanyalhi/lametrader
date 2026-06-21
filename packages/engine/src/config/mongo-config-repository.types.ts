/**
 * Shape of a persisted config key-value pair in the `config` collection. One
 * document per {@link ConfigKey}; the `_id` is the key.
 */
export interface ConfigDocument {
  /** The config key this document holds. */
  _id: string;
  /** The stored value for the key. */
  value: unknown;
}
