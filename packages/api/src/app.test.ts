import type { Config, ConfigRepository } from '@lametrader/core';
import { ConfigService } from '@lametrader/engine';
import { describe, expect, it } from 'vitest';
import { createApp } from './app';

/**
 * App backed by a real `ConfigService` over an in-memory repository, for testing
 * app-level concerns (docs, not-found handling) without I/O.
 */
function buildApp() {
  let stored: Config | null = null;
  const repo: ConfigRepository = {
    load: async () => stored,
    save: async (config) => {
      stored = config;
    },
  };
  return createApp({ config: new ConfigService(repo) });
}

describe('app', () => {
  it('returns a uniform 404 for unknown routes', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Route GET:/nope not found' });
  });

  it('serves an OpenAPI document that includes the config path', async () => {
    const app = buildApp();
    await app.ready();
    const spec = app.swagger();
    expect(spec.openapi).toBeTruthy();
    expect(Object.keys(spec.paths)).toContain('/config');
  });

  it('reports a real semver version in the OpenAPI document (not a stale literal)', async () => {
    const app = buildApp();
    await app.ready();
    const spec = app.swagger();
    expect(spec.info.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(spec.info.version).not.toBe('0.0.0');
  });
});
