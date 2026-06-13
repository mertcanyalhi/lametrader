#!/usr/bin/env node
/**
 * Executable entry point for the `lametrader` CLI.
 *
 * Thin: connect to Mongo, dispatch the command, print the result, disconnect.
 */
import { connectServices, loadSettings } from '@lametrader/engine';
import { runCandles } from './candles.js';
import { runConfig } from './config.js';
import { runSymbols } from './symbols.js';

const [, , command, ...args] = process.argv;
const { mongoUri } = loadSettings();

if (command !== 'config' && command !== 'symbols' && command !== 'candles') {
  console.error(`unknown command: ${command ?? '(none)'}`);
  process.exitCode = 1;
} else {
  const { config, symbols, backfill, close } = await connectServices(mongoUri);
  try {
    switch (command) {
      case 'config':
        console.log(await runConfig(args, config));
        break;
      case 'symbols':
        console.log(await runSymbols(args, symbols));
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
