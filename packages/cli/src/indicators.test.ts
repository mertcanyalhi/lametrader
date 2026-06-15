import { IndicatorNotFoundError } from '@lametrader/core';
import { defaultIndicators } from '@lametrader/engine';
import { describe, expect, it } from 'vitest';
import { runIndicators } from './indicators.js';

describe('runIndicators', () => {
  it('list prints every registered definition as JSON', async () => {
    const registry = defaultIndicators();
    expect(JSON.parse(await runIndicators(['list'], registry))).toEqual(registry.list());
  });

  it('show <key> prints the matching definition as JSON', async () => {
    const registry = defaultIndicators();
    expect(JSON.parse(await runIndicators(['show', 'sma'], registry))).toEqual(
      registry.get('sma')?.definition,
    );
  });

  it('show <key> throws IndicatorNotFoundError on an unknown key', async () => {
    const registry = defaultIndicators();
    await expect(runIndicators(['show', 'unknown-key'], registry)).rejects.toBeInstanceOf(
      IndicatorNotFoundError,
    );
  });

  it('throws on an unknown subcommand', async () => {
    const registry = defaultIndicators();
    await expect(runIndicators(['bogus'], registry)).rejects.toThrow();
  });
});
