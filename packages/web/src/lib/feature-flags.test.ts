// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { isRulesV2Enabled, RULES_V2_STORAGE_KEY } from './feature-flags';

describe('isRulesV2Enabled', () => {
  afterEach(() => {
    window.localStorage.removeItem(RULES_V2_STORAGE_KEY);
  });

  it('resolves to false when neither the URL param nor localStorage flips the flag on', () => {
    expect(isRulesV2Enabled('')).toEqual(false);
  });

  it('resolves to true when localStorage carries the literal string true', () => {
    window.localStorage.setItem(RULES_V2_STORAGE_KEY, 'true');
    expect(isRulesV2Enabled('')).toEqual(true);
  });

  it('resolves to false when localStorage carries any value other than the literal string true', () => {
    window.localStorage.setItem(RULES_V2_STORAGE_KEY, '1');
    expect(isRulesV2Enabled('')).toEqual(false);
  });

  it('resolves to true when the URL carries ?rulesV2=1 (overriding an absent localStorage entry)', () => {
    expect(isRulesV2Enabled('?rulesV2=1')).toEqual(true);
  });

  it('resolves to false when the URL carries ?rulesV2=0 (overriding localStorage being on)', () => {
    window.localStorage.setItem(RULES_V2_STORAGE_KEY, 'true');
    expect(isRulesV2Enabled('?rulesV2=0')).toEqual(false);
  });

  it('falls back to localStorage when the URL carries an unrecognized rulesV2 value', () => {
    window.localStorage.setItem(RULES_V2_STORAGE_KEY, 'true');
    expect(isRulesV2Enabled('?rulesV2=maybe')).toEqual(true);
  });
});
