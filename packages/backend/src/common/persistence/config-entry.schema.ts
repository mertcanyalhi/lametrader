import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';

/**
 * One persisted config key-value pair in the `config` collection.
 *
 * The dumb key-value shape of the old native-driver `MongoConfigRepository` is
 * preserved exactly: one document per {@link ConfigKey}, the key stored as the
 * document `_id` (a plain string, not an ObjectId — the key *is* the identity),
 * the field value stored under `value` as a `Mixed` type (it holds an array,
 * a string, or an object depending on the key).
 */
@Schema({ collection: 'config', versionKey: false })
export class ConfigEntry {
  /**
   * The config key this document holds (`periods`, `defaultPeriod`,
   * `notifications`) — used verbatim as the string `_id`.
   */
  @Prop({ type: String, required: true })
  _id!: string;

  /**
   * The stored value for the key. `Mixed` because the shape varies by key and
   * the store is deliberately schema-agnostic — assembly and validation live in
   * `ConfigService` / the destinations service, not here.
   */
  @Prop({ type: MongooseSchema.Types.Mixed })
  value?: unknown;
}

/**
 * The compiled Mongoose schema for {@link ConfigEntry}.
 */
export const ConfigEntrySchema = SchemaFactory.createForClass(ConfigEntry);
