import type { FiringStateRepository } from '@lametrader/core';
import { expect, it } from 'vitest';

/**
 * The shared behavioural contract every {@link FiringStateRepository} must
 * satisfy. Run against the in-memory adapter in the unit tier and the Mongo
 * adapter in the e2e tier.
 *
 * @param make - builds a fresh, empty repository under test.
 */
export function runFiringStateRepositoryContract(
  make: () => FiringStateRepository | Promise<FiringStateRepository>,
): void {
  it('getActive returns false for an unset (rule, symbol) pair', async () => {
    const repo = await make();
    expect(await repo.getActive('r', 's')).toBe(false);
  });

  it('setActive(true) then getActive round-trips the value', async () => {
    const repo = await make();
    await repo.setActive('r', 's', true);
    expect(await repo.getActive('r', 's')).toBe(true);
  });

  it('setActive(false) clears the flag', async () => {
    const repo = await make();
    await repo.setActive('r', 's', true);
    await repo.setActive('r', 's', false);
    expect(await repo.getActive('r', 's')).toBe(false);
  });

  it('rule pairs are independent', async () => {
    const repo = await make();
    await repo.setActive('r1', 's', true);
    expect(await repo.getActive('r2', 's')).toBe(false);
  });

  it('symbol pairs are independent', async () => {
    const repo = await make();
    await repo.setActive('r', 's1', true);
    expect(await repo.getActive('r', 's2')).toBe(false);
  });

  it('removeByRule clears every (ruleId, symbolId) entry for that rule', async () => {
    const repo = await make();
    await repo.setActive('r1', 's1', true);
    await repo.setActive('r1', 's2', true);
    await repo.setActive('r2', 's1', true);
    await repo.removeByRule('r1');
    expect(await repo.getActive('r1', 's1')).toBe(false);
    expect(await repo.getActive('r1', 's2')).toBe(false);
    expect(await repo.getActive('r2', 's1')).toBe(true);
  });

  it('removeByRule is idempotent (no-op when the rule has no entries)', async () => {
    const repo = await make();
    await expect(repo.removeByRule('missing')).resolves.toBeUndefined();
  });
}
