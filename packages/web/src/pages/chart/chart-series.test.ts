import { SymbolType } from '@lametrader/core';
import { describe, expect, it } from 'vitest';
import { Theme } from '../../lib/theme.types.js';
import { chartColors, showsVolume } from './chart-series.js';

describe('showsVolume', () => {
  it('is true for asset classes with volume (crypto, stock, fund) and false for fx', () => {
    expect({
      crypto: showsVolume(SymbolType.Crypto),
      stock: showsVolume(SymbolType.Stock),
      fund: showsVolume(SymbolType.Fund),
      fx: showsVolume(SymbolType.Fx),
    }).toEqual({ crypto: true, stock: true, fund: true, fx: false });
  });
});

describe('chartColors', () => {
  it('returns distinct dark and light palettes for the candle and volume series', () => {
    expect({ dark: chartColors(Theme.Dark), light: chartColors(Theme.Light) }).toEqual({
      dark: {
        background: '#111113',
        textColor: '#b0b4ba',
        gridColor: '#26282c',
        markerColor: '#3d63dd',
        upColor: '#30a46c',
        downColor: '#e5484d',
        volumeUpColor: '#30a46c80',
        volumeDownColor: '#e5484d80',
      },
      light: {
        background: '#ffffff',
        textColor: '#60646c',
        gridColor: '#e8e8ec',
        markerColor: '#3358d4',
        upColor: '#30a46c',
        downColor: '#e5484d',
        volumeUpColor: '#30a46c80',
        volumeDownColor: '#e5484d80',
      },
    });
  });
});
