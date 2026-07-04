import { isStreamPath } from './stream.gateway.js';

/**
 * Unit coverage for the {@link isStreamPath} upgrade matcher — the coexistence
 * contract: the gateway claims ONLY `/stream` and leaves every other upgrade
 * (crucially the param'd backfill-progress URL) for its own handler, so both
 * raw-`ws` gateways share one HTTP server.
 */
describe('isStreamPath', () => {
  it('matches the exact /stream path', () => {
    expect(isStreamPath('/stream')).toBe(true);
  });

  it('matches /stream with a query string appended', () => {
    expect(isStreamPath('/stream?token=abc')).toBe(true);
  });

  it('does not match a path that only starts with /stream', () => {
    expect(isStreamPath('/streaming')).toBe(false);
  });

  it('does not match a nested path under /stream', () => {
    expect(isStreamPath('/stream/candles')).toBe(false);
  });

  it('does not match the backfill-progress URL (so that gateway still handles it)', () => {
    expect(isStreamPath('/symbols/crypto:BTCUSDT/backfill/jobs/job-1/progress')).toBe(false);
  });

  it('does not match an unrelated route', () => {
    expect(isStreamPath('/health')).toBe(false);
  });
});
