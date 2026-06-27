import { afterEach, describe, expect, it } from 'vitest';

import { _resetLogRoot, getLogger } from './log.js';

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
});
