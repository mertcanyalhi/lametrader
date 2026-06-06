/**
 * Shape of the persisted config document in the `config` collection.
 */
export interface ConfigDocument {
  /** The singleton id. */
  _id: string;
  /** Stored period strings. */
  periods: string[];
  /** Stored default period string. */
  defaultPeriod: string;
}
