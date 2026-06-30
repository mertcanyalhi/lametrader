import { type Db, MongoClient } from 'mongodb';

import { getLogger } from '../log.js';
import { loadSettings } from '../settings.js';

/**
 * Scope-bound logger for the one-shot `rules_v2` → `rules` migration.
 */
const log = getLogger('engine.scripts.migrate-rules-v2-to-rules');

/**
 * Run the one-shot migration that drops the legacy `_v2` suffix from the
 * persisted rules surface:
 *
 * 1. Rename the `rules_v2` collection to `rules` (Mongo `renameCollection`).
 * 2. Rename the `events_v2` field to `events` on every watchlist document
 *    via an aggregation `$rename`.
 *
 * The migration is **idempotent** — a second invocation on an already-migrated
 * dataset is a no-op (no collection to rename, no documents with the legacy
 * field).
 *
 * The migration **throws** when both `rules_v2` and `rules` collections exist
 * — that combination is ambiguous (a partial earlier run or a manual seed) and
 * the operator must reconcile it manually before re-running.
 * Loud-failure: an operator running it twice in different shells gets a clear
 * error rather than silent data loss.
 *
 * @param db - a connected MongoDB database handle.
 * @throws when both `rules_v2` and `rules` collections exist on `db`.
 */
export async function migrateRulesV2ToRules(db: Db): Promise<void> {
  await renameRulesCollection(db);
  await renameWatchlistEventsField(db);
}

/**
 * Rename the legacy `rules_v2` collection to `rules`.
 *
 * No-op when `rules_v2` does not exist (already migrated).
 * Throws when both `rules_v2` and `rules` exist — operator must reconcile.
 */
async function renameRulesCollection(db: Db): Promise<void> {
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  const names = new Set(collections.map((entry) => entry.name));
  const hasLegacy = names.has('rules_v2');
  const hasNew = names.has('rules');
  if (hasLegacy && hasNew) {
    throw new Error(
      'Both `rules_v2` and `rules` collections exist; refusing to overwrite. Reconcile manually before re-running the migration.',
    );
  }
  if (!hasLegacy) {
    log.info('skipping `rules_v2` → `rules` collection rename (source collection absent)');
    return;
  }
  await db.renameCollection('rules_v2', 'rules');
  log.info('renamed `rules_v2` collection to `rules`');
}

/**
 * Rename the `events_v2` field to `events` on every document in `watchlist`.
 *
 * Implemented as an aggregation-pipeline `updateMany` so the rename is one
 * server round-trip regardless of document count.
 * The pipeline only sets `events` and unsets `events_v2`; documents without
 * the legacy field are unaffected (Mongo's pipeline `$set` of an undefined
 * field is a no-op).
 */
async function renameWatchlistEventsField(db: Db): Promise<void> {
  const result = await db
    .collection('watchlist')
    .updateMany({ events_v2: { $exists: true } }, [
      { $set: { events: '$events_v2' } },
      { $unset: 'events_v2' },
    ]);
  log.info(
    { matched: result.matchedCount, modified: result.modifiedCount },
    'renamed `events_v2` field to `events` on watchlist documents',
  );
}

/**
 * CLI entry point — connects to Mongo using {@link loadSettings}, runs the
 * migration, and closes the connection.
 *
 * Invoked as:
 *   `node packages/engine/dist/scripts/migrate-rules-v2-to-rules.js`
 *
 * Exits non-zero on any error so a deploy pipeline can fail loudly.
 */
async function main(): Promise<void> {
  const settings = loadSettings();
  const client = new MongoClient(settings.mongoUri);
  await client.connect();
  try {
    await migrateRulesV2ToRules(client.db());
  } finally {
    await client.close();
  }
}

const isCliEntry =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  /migrate-rules-v2-to-rules\.(?:[cm]?js|ts)$/.test(process.argv[1]);

if (isCliEntry) {
  main().catch((err: unknown) => {
    log.error({ err }, 'rules_v2 → rules migration failed');
    process.exit(1);
  });
}
