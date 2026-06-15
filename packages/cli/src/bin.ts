#!/usr/bin/env node
/**
 * Executable entry point for the `lametrader` CLI.
 *
 * Thin: connect to Mongo, dispatch the command, print the result, disconnect.
 */
import { connectServices, loadSettings } from '@lametrader/engine';
import { runCandles } from './candles.js';
import { runConfig } from './config.js';
import { runProfiles } from './profile.js';
import { runSymbols } from './symbols.js';

const [, , command, ...args] = process.argv;
const { mongoUri, pollIntervals } = loadSettings();

if (
  command !== 'config' &&
  command !== 'symbols' &&
  command !== 'profile' &&
  command !== 'candles'
) {
  console.error(`unknown command: ${command ?? '(none)'}`);
  process.exitCode = 1;
} else {
  // One-shot CLI: build the services (the polling loop is never started) and
  // dispatch. connectServices requires poll intervals even though we don't poll.
  const { config, symbols, profiles, backfill, close } = await connectServices(mongoUri, {
    pollIntervals,
  });
  try {
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
    }
  } catch (error) {
    console.error(`error: ${(error as Error).message}`);
    process.exitCode = 1;
  } finally {
    await close();
  }
}
