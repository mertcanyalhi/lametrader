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
  it('returns false when leftCurrent is null', () => {
    expect(evaluateState(StateOperator.Equals, null, null, bool(true))).toBe(false);
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
  it('returns false on first-ever observation (no prev)', () => {
    expect(evaluateState(StateOperator.ChangesTo, null, enumValue('up'), enumValue('up'))).toBe(
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
  it('returns false on first-ever observation (no prev)', () => {
    expect(evaluateState(StateOperator.ChangesFrom, null, enumValue('down'), enumValue('up'))).toBe(
      false,
    );
  });
});
