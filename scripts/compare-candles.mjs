#!/usr/bin/env node
/**
 * Compare candles stored in Mongo against what the owning source returns now.
 *
 * Usage:
 *   node scripts/compare-candles.mjs <id> --period <p> [--from <ms> --to <ms>]
 *   node scripts/compare-candles.mjs stock:CSCO --period 1d
 *   node scripts/compare-candles.mjs crypto:ETHBTC --period 1h fx:TRY --period 1d
 *
 * The source is resolved from the id's asset class (crypto->binance, else yahoo).
 * With no --from/--to it compares over the span the DB already holds.
 * Asserts: every candle's values + timestamp match, no missing/extra candles.
 * Exits non-zero if any symbol diverges.
 */
import { parseArgs } from 'node:util';
import { Period, symbolType } from '@lametrader/core';
import { defaultMarketDataSources, loadSettings, MongoCandleRepository } from '@lametrader/engine';
import { MongoClient } from 'mongodb';

// ponytail: relative tolerance for float OHLCV equality; tighten if a real source ever rounds tighter.
const TOLERANCE = 1e-8;

/** Parse `<id> --period <p> [--from --to]` groups; one group per id positional. */
function parseSpecs(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      period: { type: 'string', multiple: true },
      from: { type: 'string', multiple: true },
      to: { type: 'string', multiple: true },
    },
  });
  const periods = values.period ?? [];
  if (positionals.length === 0) throw new Error('need at least one <id>');
  if (periods.length !== positionals.length) throw new Error('each id needs exactly one --period');
  return positionals.map((id, i) => ({
    id,
    period: periods[i],
    from: values.from?.[i] === undefined ? undefined : Number(values.from[i]),
    to: values.to?.[i] === undefined ? undefined : Number(values.to[i]),
  }));
}

/** Numeric own-fields of a candle to assert on (everything but time/type). */
function values(candle) {
  const { time, type, ...rest } = candle;
  return rest;
}

/** Diff DB vs source candle sets; returns mismatch/missing/extra lists. */
function diff(dbCandles, srcCandles) {
  const db = new Map(dbCandles.map((c) => [c.time, c]));
  const src = new Map(srcCandles.map((c) => [c.time, c]));
  const missing = []; // in source, absent from DB
  const extra = []; // in DB, absent from source
  const mismatch = []; // same time, differing values

  for (const [time, s] of src) {
    const d = db.get(time);
    if (!d) {
      missing.push(time);
      continue;
    }
    const sv = values(s);
    const dv = values(d);
    const fields = [...new Set([...Object.keys(sv), ...Object.keys(dv)])];
    const bad = fields.filter((f) => {
      const a = dv[f];
      const b = sv[f];
      if (a === undefined || b === undefined) return true;
      return Math.abs(a - b) > TOLERANCE * Math.max(1, Math.abs(a), Math.abs(b));
    });
    if (bad.length) mismatch.push({ time, fields: bad, db: dv, src: sv });
  }
  for (const time of db.keys()) if (!src.has(time)) extra.push(time);
  return { missing, extra, mismatch };
}

const settings = loadSettings();
const sources = defaultMarketDataSources();
const client = new MongoClient(settings.mongoUri);
await client.connect();
const repo = new MongoCandleRepository(client.db());

let failed = false;
try {
  for (const spec of parseSpecs(process.argv.slice(2))) {
    const { id } = spec;
    const period = spec.period;
    if (!Object.values(Period).includes(period)) throw new Error(`unknown period: ${period}`);
    const source = sources.find((s) => s.types.includes(symbolType(id)));
    if (!source) throw new Error(`no source for ${id}`);

    // Window: explicit, else the span the DB already holds (max+1 → inclusive).
    let { from, to } = spec;
    if (from === undefined || to === undefined) {
      const all = await repo.range(id, period, 0, Number.MAX_SAFE_INTEGER);
      if (all.length === 0) {
        console.log(`\n${id} ${period}: DB empty — nothing to compare`);
        continue;
      }
      from ??= all[0].time;
      to ??= all[all.length - 1].time + 1;
    }

    const batch = await source.fetchCandles(id, period, { from, to });
    let srcCandles = batch.candles.filter((c) => c.time >= from && c.time < to);
    // A truncated batch only covers part of [from,to) (the provider caps the
    // count, dropping either end). Outside that span we can't tell missing/extra
    // from "source didn't return it", so clamp the comparison to source coverage.
    let lo = from;
    let hi = to;
    if (!batch.complete && srcCandles.length > 0) {
      lo = srcCandles[0].time;
      hi = srcCandles[srcCandles.length - 1].time + 1;
    }
    srcCandles = srcCandles.filter((c) => c.time >= lo && c.time < hi);
    const dbCandles = await repo.range(id, period, lo, hi);
    const { missing, extra, mismatch } = diff(dbCandles, srcCandles);

    const ok = !missing.length && !extra.length && !mismatch.length;
    failed ||= !ok;
    console.log(
      `\n${id} ${period}  [${new Date(lo).toISOString()} .. ${new Date(hi).toISOString()})` +
        `\n  DB: ${dbCandles.length}  source: ${srcCandles.length}` +
        (batch.complete ? '' : '  (source truncated — compared over source coverage only)') +
        `\n  ${ok ? 'OK — identical' : `DIVERGED: ${missing.length} missing, ${extra.length} extra, ${mismatch.length} mismatched`}`,
    );
    for (const t of missing.slice(0, 10))
      console.log(`    missing in DB: ${new Date(t).toISOString()}`);
    for (const t of extra.slice(0, 10))
      console.log(`    extra in DB:   ${new Date(t).toISOString()}`);
    for (const m of mismatch.slice(0, 10))
      console.log(
        `    mismatch ${new Date(m.time).toISOString()} [${m.fields}]  db=${JSON.stringify(m.db)} src=${JSON.stringify(m.src)}`,
      );
  }
} finally {
  await client.close();
}
process.exit(failed ? 1 : 0);
