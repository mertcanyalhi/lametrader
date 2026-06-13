import { Period } from '@lametrader/core';
import type { BackfillSummary } from '@lametrader/engine';
import { describe, expect, it } from 'vitest';
import { type BackfillProgressFrame, BackfillProgressHub } from './backfill-progress-hub.js';

/** A representative terminal summary. */
const SUMMARY: BackfillSummary = {
  id: 'crypto:BTCUSDT',
  period: Period.OneHour,
  from: 1000,
  to: 2000,
  fetched: 2,
  saved: 2,
  complete: true,
};

describe('BackfillProgressHub', () => {
  it('delivers progress frames then the summary frame to a subscriber', () => {
    const hub = new BackfillProgressHub();
    const frames: BackfillProgressFrame[] = [];
    hub.subscribe('crypto:BTCUSDT', (frame) => frames.push(frame));

    hub.progress('crypto:BTCUSDT', { saved: 500, total: 1200 });
    hub.summary('crypto:BTCUSDT', SUMMARY);

    expect(frames).toEqual([
      { type: 'progress', saved: 500, total: 1200 },
      { type: 'summary', summary: SUMMARY },
    ]);
  });

  it('fans a frame out to every subscriber of the id', () => {
    const hub = new BackfillProgressHub();
    const a: BackfillProgressFrame[] = [];
    const b: BackfillProgressFrame[] = [];
    hub.subscribe('crypto:BTCUSDT', (frame) => a.push(frame));
    hub.subscribe('crypto:BTCUSDT', (frame) => b.push(frame));

    hub.progress('crypto:BTCUSDT', { saved: 1, total: 1 });

    expect(a).toEqual([{ type: 'progress', saved: 1, total: 1 }]);
    expect(b).toEqual([{ type: 'progress', saved: 1, total: 1 }]);
  });

  it('stops delivering after unsubscribe', () => {
    const hub = new BackfillProgressHub();
    const frames: BackfillProgressFrame[] = [];
    const unsubscribe = hub.subscribe('crypto:BTCUSDT', (frame) => frames.push(frame));

    unsubscribe();
    hub.progress('crypto:BTCUSDT', { saved: 1, total: 1 });

    expect(frames).toEqual([]);
  });

  it('only delivers frames for the subscribed id', () => {
    const hub = new BackfillProgressHub();
    const frames: BackfillProgressFrame[] = [];
    hub.subscribe('crypto:BTCUSDT', (frame) => frames.push(frame));

    hub.progress('stock:AAPL', { saved: 1, total: 1 });

    expect(frames).toEqual([]);
  });

  it('publishing with no subscribers is a no-op', () => {
    const hub = new BackfillProgressHub();
    expect(() => hub.progress('crypto:BTCUSDT', { saved: 1, total: 1 })).not.toThrow();
  });
});
