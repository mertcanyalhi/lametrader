#!/usr/bin/env node
/**
 * Executable entry point for the `lametrader` CLI.
 *
 * Thin: connect to Mongo, dispatch the command, print the result, disconnect.
 */
import { connectConfigService, connectSymbolService, loadSettings } from '@lametrader/engine';
import { runConfig } from './config.js';
import { runSymbols } from './symbols.js';

const [, , command, ...args] = process.argv;
const { mongoUri } = loadSettings();

try {
  switch (command) {
    case 'config': {
      const { service, close } = await connectConfigService(mongoUri);
      try {
        console.log(await runConfig(args, service));
      } finally {
        await close();
      }
      break;
    }
    case 'symbols': {
      const { service, close } = await connectSymbolService(mongoUri);
      try {
        console.log(await runSymbols(args, service));
      } finally {
        await close();
      }
      break;
    }
    default:
      console.error(`unknown command: ${command ?? '(none)'}`);
      process.exitCode = 1;
  }
} catch (error) {
  console.error(`error: ${(error as Error).message}`);
  process.exitCode = 1;
}
