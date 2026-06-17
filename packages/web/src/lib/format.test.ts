import { describe, expect, it } from 'vitest';
import {
  formatChange,
  formatChangePct,
  formatPrice,
  formatVolume,
  priceDecimals,
} from './format.js';

describe('formatPrice', () => {
  it('keeps two decimals for values at or above 1000, lets [1, 1000) widen to four, and grows for smaller values so significant figures survive', () => {
    expect({
      large: formatPrice(50_000),
      mid: formatPrice(123.3),
      one: formatPrice(1),
      fx: formatPrice(1.0805),
      subOne: formatPrice(0.5432),
      hundredths: formatPrice(0.05432),
      tiny: formatPrice(0.000034),
      zero: formatPrice(0),
    }).toEqual({
      large: '50,000.00',
      mid: '123.30',
      one: '1.00',
      fx: '1.0805',
      subOne: '0.5432',
      hundredths: '0.05432',
      tiny: '0.000034',
      zero: '0.00',
    });
  });

  it('preserves the sign for negative prices using the same magnitude-aware decimals', () => {
    expect({
      mid: formatPrice(-123.3),
      tiny: formatPrice(-0.000034),
    }).toEqual({
      mid: '-123.30',
      tiny: '-0.000034',
    });
  });
});

describe('formatChange', () => {
  it('renders an explicit sign with magnitude-aware decimals (matching the price scale)', () => {
    expect({
      positive: formatChange(1500),
      negative: formatChange(-2.5),
      small: formatChange(0.0015),
      tiny: formatChange(-0.000034),
      zero: formatChange(0),
    }).toEqual({
      positive: '+1,500.00',
      negative: '-2.50',
      small: '+0.0015',
      tiny: '-0.000034',
      zero: '0.00',
    });
  });
});

describe('formatChangePct', () => {
  it('renders a signed percentage to two decimals', () => {
    expect({
      positive: formatChangePct(0.0345),
      negative: formatChangePct(-0.0386),
      zero: formatChangePct(0),
    }).toEqual({
      positive: '+3.45%',
      negative: '-3.86%',
      zero: '0.00%',
    });
  });
});

describe('priceDecimals', () => {
  it('uses two decimals at or above 1 and grows for smaller values to keep significant figures', () => {
    expect({
      large: priceDecimals(50_000),
      mid: priceDecimals(123.3),
      one: priceDecimals(1),
      subOne: priceDecimals(0.5432),
      lowUnit: priceDecimals(0.000718),
      tiny: priceDecimals(0.000034),
      zero: priceDecimals(0),
    }).toEqual({
      large: 2,
      mid: 2,
      one: 2,
      subOne: 4,
      lowUnit: 7,
      tiny: 8,
      zero: 2,
    });
  });
});

describe('formatVolume', () => {
  it('renders human-readable magnitudes with K, M, and B suffixes', () => {
    expect({
      bare: formatVolume(999),
      thousand: formatVolume(258_270),
      million: formatVolume(12_300_000),
      billion: formatVolume(1_500_000_000),
      zero: formatVolume(0),
    }).toEqual({
      bare: '999',
      thousand: '258.27K',
      million: '12.30M',
      billion: '1.50B',
      zero: '0',
    });
  });

  it('keeps fractional sub-thousand volumes legible instead of rounding them to zero', () => {
    expect({
      fractional: formatVolume(0.34),
      smallInteger: formatVolume(258),
      hundreds: formatVolume(742.5),
    }).toEqual({
      fractional: '0.34',
      smallInteger: '258',
      hundreds: '742.5',
    });
  });
});
