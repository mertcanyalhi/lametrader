import {
  ConfigService,
  InMemoryConfigRepository,
  TelegramDestinationsService,
} from '@lametrader/engine';
import { describe, expect, it } from 'vitest';
import { runConfig } from './config';

/**
 * Real `ConfigService` + `TelegramDestinationsService` over a shared
 * in-memory K/V repository — exercises CLI command wiring without I/O.
 */
function buildDeps() {
  const repo = new InMemoryConfigRepository();
  return {
    config: new ConfigService(repo),
    telegramDestinations: new TelegramDestinationsService(repo),
  };
}

describe('runConfig get', () => {
  it('prints the current config as JSON', async () => {
    const output = await runConfig(['get'], buildDeps());
    expect(JSON.parse(output)).toEqual({ periods: ['1h', '1d'], defaultPeriod: '1d' });
  });
});

describe('runConfig set', () => {
  it('persists the given values and echoes the result', async () => {
    const deps = buildDeps();
    const output = await runConfig(['set', '--periods', '1h,1d', '--default-period', '1d'], deps);
    expect(JSON.parse(output)).toEqual({ periods: ['1h', '1d'], defaultPeriod: '1d' });
    expect(await deps.config.get()).toEqual({ periods: ['1h', '1d'], defaultPeriod: '1d' });
  });
});

describe('runConfig notifications', () => {
  it('dispatches `notifications telegram list` to the destinations subgroup', async () => {
    const deps = buildDeps();
    await deps.telegramDestinations.upsert({
      name: 'main',
      botToken: 'TOKEN-1',
      chatId: '123',
    });
    const output = await runConfig(['notifications', 'telegram', 'list'], deps);
    expect(output).toBe('main\t123');
  });
});
