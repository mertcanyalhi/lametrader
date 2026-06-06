#!/usr/bin/env node
/**
 * Executable entry point for the `lametrader` CLI.
 *
 * Thin: connect to Mongo, dispatch the command, print the result, disconnect.
 */
import { connectConfigService, loadSettings } from '@lametrader/engine';
import { runConfig } from './config.js';

const [, , command, ...args] = process.argv;

if (command !== 'config') {
  console.error(`unknown command: ${command ?? '(none)'}`);
  process.exit(1);
}

const { mongoUri } = loadSettings();
const { service, close } = await connectConfigService(mongoUri);
try {
  console.log(await runConfig(args, service));
} catch (error) {
  console.error(`error: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await close();
}
