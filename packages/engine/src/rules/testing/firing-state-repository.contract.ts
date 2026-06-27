import type { FiringStateRepository } from '@lametrader/core';
import { expect, it } from 'vitest';

/**
 * The shared behavioural contract every {@link FiringStateRepository} must
 * satisfy. Run against the in-memory adapter in the unit tier and the Mongo
 * adapter in the e2e tier.
 *
 * The Mongo adapter writes the latch as a sub-doc on each rule document
 * (ADR 0012), so writes only apply to rules that exist. `make` accepts the
 * set of rule ids the test will reference so the adapter under test can be
 * seeded accordingly.
 *
 * @param make - builds a fresh repository under test, seeded with stub rule
 *   documents for the given ids.
 */
export function runFiringStateRepositoryContract(
  make: (ruleIds: string[]) => FiringStateRepository | Promise<FiringStateRepository>,
): void {
  it('getActive returns false for an unset (rule, symbol) pair', async () => {
    const repo = await make(['r']);
    expect(await repo.getActive('r', 's')).toBe(false);
  });

  it('setActive(true) then getActive round-trips the value', async () => {
    const repo = await make(['r']);
    await repo.setActive('r', 's', true);
    expect(await repo.getActive('r', 's')).toBe(true);
  });

  it('setActive(false) clears the flag', async () => {
    const repo = await make(['r']);
    await repo.setActive('r', 's', true);
    await repo.setActive('r', 's', false);
    expect(await repo.getActive('r', 's')).toBe(false);
  });

  it('rule pairs are independent', async () => {
    const repo = await make(['r1', 'r2']);
    await repo.setActive('r1', 's', true);
    expect(await repo.getActive('r2', 's')).toBe(false);
  });

  it('symbol pairs are independent', async () => {
    const repo = await make(['r']);
    await repo.setActive('r', 's1', true);
    expect(await repo.getActive('r', 's2')).toBe(false);
  });

  it('two symbols on the same rule keep independent slots', async () => {
    const repo = await make(['r']);
    await repo.setActive('r', 's1', true);
    await repo.setActive('r', 's2', false);
    expect(await repo.getActive('r', 's1')).toBe(true);
    expect(await repo.getActive('r', 's2')).toBe(false);
  });
}
