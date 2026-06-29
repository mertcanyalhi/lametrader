import { afterEach, describe, expect, it } from 'vitest';

import { _resetLogRoot, _resetLogScopes, getLogger } from './log.js';

/**
 * Decode the raw line Pino writes onto the destination stream into the
 * structured record we want to assert against.
 */
function parseRecord(line: string): Record<string, unknown> {
  return JSON.parse(line);
}

describe('getLogger', () => {
  afterEach(() => {
    _resetLogRoot();
    _resetLogScopes([]);
  });

  it('returns a Pino child carrying app: engine and scope on every entry', () => {
    const records: Record<string, unknown>[] = [];
    _resetLogRoot({
      write: (line: string) => {
        records.push(parseRecord(line));
      },
    });

    getLogger('test-scope').warn({ k: 'v' }, 'hi');

    expect(records).toEqual([
      {
        level: 40,
        time: expect.any(Number),
        app: 'engine',
        scope: 'test-scope',
        k: 'v',
        msg: 'hi',
      },
    ]);
  });

  it('honors a logScopes entry whose pattern matches the scope name (overrides global level)', () => {
    const records: Record<string, unknown>[] = [];
    _resetLogRoot({
      write: (line: string) => {
        records.push(parseRecord(line));
      },
    });
    _resetLogScopes([{ pattern: 'engine.rules.dispatch', level: 'trace' }]);

    getLogger('engine.rules.dispatch').trace({ k: 'v' }, 'low');

    expect(records).toEqual([
      {
        level: 10,
        time: expect.any(Number),
        app: 'engine',
        scope: 'engine.rules.dispatch',
        k: 'v',
        msg: 'low',
      },
    ]);
  });

  it('matches a "prefix.*" pattern against any scope that starts with prefix.', () => {
    const records: Record<string, unknown>[] = [];
    _resetLogRoot({
      write: (line: string) => {
        records.push(parseRecord(line));
      },
    });
    _resetLogScopes([{ pattern: 'engine.rules.*', level: 'trace' }]);

    getLogger('engine.rules.actions').trace({ k: 'v' }, 'low');

    expect(records).toEqual([
      {
        level: 10,
        time: expect.any(Number),
        app: 'engine',
        scope: 'engine.rules.actions',
        k: 'v',
        msg: 'low',
      },
    ]);
  });

  it('leaves a scope at the global level when no pattern matches', () => {
    const records: Record<string, unknown>[] = [];
    _resetLogRoot({
      write: (line: string) => {
        records.push(parseRecord(line));
      },
    });
    _resetLogScopes([{ pattern: 'engine.api', level: 'trace' }]);

    getLogger('engine.rules.dispatch').trace({ k: 'v' }, 'low');

    expect(records).toEqual([]);
  });

  it('applies the first matching logScopes entry, so narrow patterns can precede broad ones', () => {
    const records: Record<string, unknown>[] = [];
    _resetLogRoot({
      write: (line: string) => {
        records.push(parseRecord(line));
      },
    });
    _resetLogScopes([
      { pattern: 'engine.rules.dispatch', level: 'error' },
      { pattern: 'engine.rules.*', level: 'trace' },
    ]);

    getLogger('engine.rules.dispatch').trace({ k: 'v' }, 'low');

    expect(records).toEqual([]);
  });
});
