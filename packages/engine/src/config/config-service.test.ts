import { type Config, type ConfigRepository, defaultConfig, Period } from '@lametrader/core';
import { describe, expect, it } from 'vitest';
import { ConfigService } from './config-service';

/**
 * In-memory `ConfigRepository` fake for the unit tier — no I/O.
 */
class FakeConfigRepository implements ConfigRepository {
  stored: Config | null;

  constructor(initial: Config | null = null) {
    this.stored = initial;
  }

  async load(): Promise<Config | null> {
    return this.stored;
  }

  async save(config: Config): Promise<void> {
    this.stored = config;
  }
}

describe('ConfigService.get', () => {
  it('returns the default config when the repository is empty', async () => {
    const service = new ConfigService(new FakeConfigRepository());
    expect(await service.get()).toEqual({
      periods: [Period.OneHour, Period.OneDay],
      defaultPeriod: Period.OneDay,
    });
  });

  it('returns the persisted config when one exists', async () => {
    const stored: Config = { periods: [Period.FourHours], defaultPeriod: Period.FourHours };
    const service = new ConfigService(new FakeConfigRepository(stored));
    expect(await service.get()).toEqual({
      periods: [Period.FourHours],
      defaultPeriod: Period.FourHours,
    });
  });
});

describe('ConfigService.replace', () => {
  it('validates, persists, and returns the stored config', async () => {
    const repo = new FakeConfigRepository();
    const service = new ConfigService(repo);
    const result = await service.replace({ periods: ['1h', '4h', '1d'], defaultPeriod: '4h' });
    expect(result).toEqual({
      periods: [Period.OneHour, Period.FourHours, Period.OneDay],
      defaultPeriod: Period.FourHours,
    });
    expect(repo.stored).toEqual(result);
  });

  it('throws and persists nothing on an invalid payload', async () => {
    const repo = new FakeConfigRepository();
    const service = new ConfigService(repo);
    await expect(service.replace({ periods: [], defaultPeriod: '1d' })).rejects.toThrow(
      'periods must not be empty',
    );
    expect(repo.stored).toEqual(null);
  });
});

describe('ConfigService.patch', () => {
  it('merges over the current config, persists, and returns the result', async () => {
    const repo = new FakeConfigRepository(defaultConfig());
    const service = new ConfigService(repo);
    const result = await service.patch({ defaultPeriod: '1h' });
    expect(result).toEqual({
      periods: [Period.OneHour, Period.OneDay],
      defaultPeriod: Period.OneHour,
    });
    expect(repo.stored).toEqual(result);
  });

  it('throws and persists nothing when the merged result is invalid', async () => {
    const repo = new FakeConfigRepository(defaultConfig());
    const service = new ConfigService(repo);
    await expect(service.patch({ periods: ['1h', '4h'] })).rejects.toThrow(
      'defaultPeriod 1d is not in periods',
    );
    expect(repo.stored).toEqual(defaultConfig());
  });
});
