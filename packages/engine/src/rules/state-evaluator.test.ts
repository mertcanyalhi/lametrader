import { StateOperator, type StateValue, StateValueType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';

import { evaluateState } from './state-evaluator.js';

const num = (value: number): StateValue => ({ type: StateValueType.Number, value });
const bool = (value: boolean): StateValue => ({ type: StateValueType.Bool, value });
const enumValue = (value: string): StateValue => ({ type: StateValueType.Enum, value });
const str = (value: string): StateValue => ({ type: StateValueType.String, value });

describe('evaluateState — Equals', () => {
  it('matches identical Bool values', () => {
    expect(evaluateState(StateOperator.Equals, null, bool(true), bool(true))).toBe(true);
  });
  it('differs on different Bool values', () => {
    expect(evaluateState(StateOperator.Equals, null, bool(true), bool(false))).toBe(false);
  });
  it('matches identical Enum values', () => {
    expect(evaluateState(StateOperator.Equals, null, enumValue('up'), enumValue('up'))).toBe(true);
  });
  it('matches identical Number values', () => {
    expect(evaluateState(StateOperator.Equals, null, num(42), num(42))).toBe(true);
  });
  it('matches identical String values', () => {
    expect(evaluateState(StateOperator.Equals, null, str('hi'), str('hi'))).toBe(true);
  });
  it('returns false on type mismatch', () => {
    expect(evaluateState(StateOperator.Equals, null, bool(true), enumValue('true'))).toBe(false);
  });
  it('returns true on (null, null) — both unset are equal', () => {
    expect(evaluateState(StateOperator.Equals, null, null, null)).toBe(true);
  });
  it('returns false on (null, concrete) — null is distinct from any concrete value', () => {
    expect(evaluateState(StateOperator.Equals, null, null, bool(true))).toBe(false);
  });
  it('returns false on (concrete, null) — null is distinct from any concrete value', () => {
    expect(evaluateState(StateOperator.Equals, null, bool(true), null)).toBe(false);
  });
});

describe('evaluateState — NotEquals', () => {
  it('returns true on different Bool values', () => {
    expect(evaluateState(StateOperator.NotEquals, null, bool(true), bool(false))).toBe(true);
  });
  it('returns false on identical Bool values', () => {
    expect(evaluateState(StateOperator.NotEquals, null, bool(true), bool(true))).toBe(false);
  });
  it('returns true on different Enum values', () => {
    expect(evaluateState(StateOperator.NotEquals, null, enumValue('up'), enumValue('down'))).toBe(
      true,
    );
  });
  it('returns false on type mismatch (defensive — not equal but not actionable)', () => {
    expect(evaluateState(StateOperator.NotEquals, null, bool(true), enumValue('true'))).toBe(false);
  });
  it('returns false on (null, null) — Equals XOR NotEquals = true', () => {
    expect(evaluateState(StateOperator.NotEquals, null, null, null)).toBe(false);
  });
  it('returns true on (null, concrete) — bootstrap pattern fires on first observation', () => {
    expect(evaluateState(StateOperator.NotEquals, null, null, enumValue('SELL'))).toBe(true);
  });
  it('returns true on (concrete, null)', () => {
    expect(evaluateState(StateOperator.NotEquals, null, enumValue('SELL'), null)).toBe(true);
  });
});

describe('evaluateState — ChangesTo', () => {
  it('fires when prev was not the target and current is the target', () => {
    expect(
      evaluateState(StateOperator.ChangesTo, enumValue('down'), enumValue('up'), enumValue('up')),
    ).toBe(true);
  });
  it('does not fire when prev was already the target', () => {
    expect(
      evaluateState(StateOperator.ChangesTo, enumValue('up'), enumValue('up'), enumValue('up')),
    ).toBe(false);
  });
  it('does not fire when current is not the target', () => {
    expect(
      evaluateState(StateOperator.ChangesTo, enumValue('down'), enumValue('flat'), enumValue('up')),
    ).toBe(false);
  });
  it('fires on (prev=null, current=target) — null edge counts as transition into target', () => {
    expect(evaluateState(StateOperator.ChangesTo, null, enumValue('up'), enumValue('up'))).toBe(
      true,
    );
  });
  it('does not fire on (prev=null, current=other) — current must match the target', () => {
    expect(evaluateState(StateOperator.ChangesTo, null, enumValue('down'), enumValue('up'))).toBe(
      false,
    );
  });
});

describe('evaluateState — ChangesFrom', () => {
  it('fires when prev was the source and current is not', () => {
    expect(
      evaluateState(StateOperator.ChangesFrom, enumValue('up'), enumValue('down'), enumValue('up')),
    ).toBe(true);
  });
  it('does not fire when prev was not the source', () => {
    expect(
      evaluateState(
        StateOperator.ChangesFrom,
        enumValue('down'),
        enumValue('flat'),
        enumValue('up'),
      ),
    ).toBe(false);
  });
  it('does not fire when current is still the source', () => {
    expect(
      evaluateState(StateOperator.ChangesFrom, enumValue('up'), enumValue('up'), enumValue('up')),
    ).toBe(false);
  });
  it('fires on (prev=source, current=null) — null edge counts as transition out of source', () => {
    expect(evaluateState(StateOperator.ChangesFrom, enumValue('up'), null, enumValue('up'))).toBe(
      true,
    );
  });
  it('does not fire on (prev=null, current=anything) — can not change from a source never observed', () => {
    expect(evaluateState(StateOperator.ChangesFrom, null, enumValue('down'), enumValue('up'))).toBe(
      false,
    );
  });
});
