import type { Config, ConfigRepository } from '@lametrader/core';
import { ConfigService } from '@lametrader/engine';
import { describe, expect, it } from 'vitest';
import { runConfig } from './config';

/**
 * Real `ConfigService` over an in-memory repository, for testing the CLI
 * command wiring without I/O.
 */
function buildService(initial: Config | null = null) {
  let stored: Config | null = initial;
  const repo: ConfigRepository = {
    load: async () => stored,
    save: async (config) => {
      stored = config;
    },
  };
  return new ConfigService(repo);
}

describe('runConfig get', () => {
  it('prints the current config as JSON', async () => {
    const output = await runConfig(['get'], buildService());
    expect(JSON.parse(output)).toEqual({ periods: ['1h', '1d'], defaultPeriod: '1d' });
  });
});

describe('runConfig set', () => {
  it('persists the given values and echoes the result', async () => {
    const service = buildService();
    const output = await runConfig(
      ['set', '--periods', '1h,1d', '--default-period', '1d'],
      service,
    );
    expect(JSON.parse(output)).toEqual({ periods: ['1h', '1d'], defaultPeriod: '1d' });
    expect(await service.get()).toEqual({ periods: ['1h', '1d'], defaultPeriod: '1d' });
  });
});
