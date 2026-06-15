import { defaultIndicators, type IndicatorRegistry } from '@lametrader/engine';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { buildAppDeps } from '../testing/app-deps';

/**
 * Build an app whose indicator catalog is the real `defaultIndicators()` registry, so the controller is exercised against the shipped reference modules (`sma`, `vwma`).
 */
function buildApp(registry: IndicatorRegistry = defaultIndicators()) {
  return createApp(buildAppDeps({ indicators: registry }));
}

describe('GET /indicators', () => {
  it('returns 200 with every registered definition', async () => {
    const registry = defaultIndicators();
    const app = buildApp(registry);
    const res = await app.inject({ method: 'GET', url: '/indicators' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(registry.list());
  });
});

describe('GET /indicators/:key', () => {
  it('returns 200 with the matching definition (sma)', async () => {
    const registry = defaultIndicators();
    const app = buildApp(registry);
    const res = await app.inject({ method: 'GET', url: '/indicators/sma' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(registry.get('sma')?.definition);
  });

  it('returns 200 with the matching definition (vwma)', async () => {
    const registry = defaultIndicators();
    const app = buildApp(registry);
    const res = await app.inject({ method: 'GET', url: '/indicators/vwma' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(registry.get('vwma')?.definition);
  });

  it('returns 404 with { error } for an unknown key', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/indicators/unknown-key' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'indicator not found: unknown-key' });
  });
});
