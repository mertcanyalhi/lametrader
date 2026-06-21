import { ConfigKey, defaultConfig, Period } from '@lametrader/core';
import { describe, expect, it } from 'vitest';
import { ConfigService } from './config-service';
import { InMemoryConfigRepository } from './in-memory-config-repository';

describe('ConfigService.get', () => {
  it('returns the default config when the repository is empty', async () => {
    const service = new ConfigService(new InMemoryConfigRepository());
    expect(await service.get()).toEqual({
      periods: [Period.OneHour, Period.OneDay],
      defaultPeriod: Period.OneDay,
    });
  });

  it('returns the persisted config when one exists', async () => {
    const repo = new InMemoryConfigRepository();
    await repo.set(ConfigKey.Periods, [Period.FourHours]);
    await repo.set(ConfigKey.DefaultPeriod, Period.FourHours);
    const service = new ConfigService(repo);
    expect(await service.get()).toEqual({
      periods: [Period.FourHours],
      defaultPeriod: Period.FourHours,
    });
  });

  it('throws on partial/corrupt stored state (defaultPeriod outside periods)', async () => {
    const repo = new InMemoryConfigRepository();
    await repo.set(ConfigKey.Periods, [Period.OneHour, Period.FourHours]);
    await repo.set(ConfigKey.DefaultPeriod, Period.OneDay);
    const service = new ConfigService(repo);
    await expect(service.get()).rejects.toThrow('defaultPeriod 1d is not in periods');
  });

  it('memoizes the config so a store change behind its back is not re-read', async () => {
    const repo = new InMemoryConfigRepository();
    const service = new ConfigService(repo);
    await service.get();
    await repo.set(ConfigKey.Periods, [Period.FourHours]);
    await repo.set(ConfigKey.DefaultPeriod, Period.FourHours);
    expect(await service.get()).toEqual({
      periods: [Period.OneHour, Period.OneDay],
      defaultPeriod: Period.OneDay,
    });
  });
});

describe('ConfigService.replace', () => {
  it('validates, persists, and returns the stored config', async () => {
    const repo = new InMemoryConfigRepository();
    const service = new ConfigService(repo);
    const result = await service.replace({ periods: ['1h', '4h', '1d'], defaultPeriod: '4h' });
    expect(result).toEqual({
      periods: [Period.OneHour, Period.FourHours, Period.OneDay],
      defaultPeriod: Period.FourHours,
    });
    expect(await new ConfigService(repo).get()).toEqual(result);
  });

  it('refreshes the memo so a later get on the same service returns the new config', async () => {
    const repo = new InMemoryConfigRepository();
    const service = new ConfigService(repo);
    await service.get();
    await service.replace({ periods: ['4h'], defaultPeriod: '4h' });
    expect(await service.get()).toEqual({
      periods: [Period.FourHours],
      defaultPeriod: Period.FourHours,
    });
  });

  it('throws and persists nothing on an invalid payload', async () => {
    const repo = new InMemoryConfigRepository();
    const service = new ConfigService(repo);
    await expect(service.replace({ periods: [], defaultPeriod: '1d' })).rejects.toThrow(
      'periods must not be empty',
    );
    expect(await new ConfigService(repo).get()).toEqual(defaultConfig());
  });
});

describe('ConfigService.patch', () => {
  it('merges over the current config, persists, and returns the result', async () => {
    const repo = new InMemoryConfigRepository();
    await new ConfigService(repo).replace(defaultConfig());
    const result = await new ConfigService(repo).patch({ defaultPeriod: '1h' });
    expect(result).toEqual({
      periods: [Period.OneHour, Period.OneDay],
      defaultPeriod: Period.OneHour,
    });
    expect(await new ConfigService(repo).get()).toEqual(result);
  });

  it('throws and persists nothing when the merged result is invalid', async () => {
    const repo = new InMemoryConfigRepository();
    await new ConfigService(repo).replace(defaultConfig());
    const service = new ConfigService(repo);
    await expect(service.patch({ periods: ['1h', '4h'] })).rejects.toThrow(
      'defaultPeriod 1d is not in periods',
    );
    expect(await new ConfigService(repo).get()).toEqual(defaultConfig());
  });
});
