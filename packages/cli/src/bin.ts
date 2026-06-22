#!/usr/bin/env node
/**
 * Executable entry point for the `lametrader` CLI.
 *
 * Thin: connect to Mongo, dispatch the command, print the result, disconnect.
 */
import { connectServices, loadSettings } from '@lametrader/engine';
import { runCandles } from './candles.js';
import { runConfig } from './config.js';
import { runIndicators } from './indicators.js';
import { runProfiles } from './profile.js';
import { runRules } from './rules.js';
import { runSymbols } from './symbols.js';

const [, , command, ...args] = process.argv;
const { mongoUri, pollIntervals } = loadSettings();

if (
  command !== 'config' &&
  command !== 'symbols' &&
  command !== 'profile' &&
  command !== 'candles' &&
  command !== 'indicators' &&
  command !== 'rules'
) {
  console.error(`unknown command: ${command ?? '(none)'}`);
  process.exitCode = 1;
} else {
  // One-shot CLI: build the services (the polling loop is never started) and
  // dispatch. connectServices requires poll intervals even though we don't poll.
  // The connect is inside the try so a failed Mongo connection prints a clean
  // `error: <message>` rather than escaping as an unhandled rejection.
  let close: (() => Promise<void>) | undefined;
  try {
    const {
      config,
      symbols,
      profiles,
      rules,
      backfill,
      indicators,
      indicatorCompute,
      close: disconnect,
    } = await connectServices(mongoUri, { pollIntervals });
    close = disconnect;
    switch (command) {
      case 'config':
        console.log(await runConfig(args, config));
        break;
      case 'symbols':
        console.log(await runSymbols(args, symbols));
        break;
      case 'profile':
        console.log(await runProfiles(args, profiles));
        break;
      case 'candles':
        console.log(await runCandles(args, backfill));
        break;
      case 'indicators':
        console.log(await runIndicators(args, indicators, indicatorCompute));
        break;
      case 'rules':
        console.log(await runRules(args, rules));
        break;
    }
  } catch (error) {
    console.error(`error: ${(error as Error).message}`);
    process.exitCode = 1;
  } finally {
    await close?.();
  }
}
