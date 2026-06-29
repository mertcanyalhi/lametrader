// @vitest-environment jsdom
import { Period, RulesV2, SymbolType, type WatchedSymbol } from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import { cleanup, render, screen } from '@testing-library/react';
import { type ReactNode, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ScopePickerV2 } from './scope-picker-v2';

afterEach(() => {
  cleanup();
});

const SYMBOLS: WatchedSymbol[] = [
  {
    id: 'crypto:BTCUSDT',
    type: SymbolType.Crypto,
    description: 'BTC/USDT',
    exchange: 'Binance',
    periods: [Period.OneHour],
  },
  {
    id: 'crypto:ETHUSDT',
    type: SymbolType.Crypto,
    description: 'ETH/USDT',
    exchange: 'Binance',
    periods: [Period.OneHour],
  },
];

function Harness({ initial }: { initial: RulesV2.RuleScope }): ReactNode {
  const [value, setValue] = useState<RulesV2.RuleScope>(initial);
  return (
    <Theme>
      <ScopePickerV2 value={value} onChange={setValue} watchedSymbols={SYMBOLS} />
    </Theme>
  );
}

describe('ScopePickerV2', () => {
  it('renders a single-symbol dropdown for the Symbol kind', () => {
    render(
      <Harness initial={{ kind: RulesV2.RuleScopeKind.Symbol, symbolId: 'crypto:BTCUSDT' }} />,
    );
    expect(screen.getByLabelText('Rule symbol')).toBeDefined();
    expect(screen.queryByLabelText('Rule symbols')).toEqual(null);
  });

  it('renders a multi-checkbox list for the Symbols kind', () => {
    render(
      <Harness initial={{ kind: RulesV2.RuleScopeKind.Symbols, symbolIds: ['crypto:BTCUSDT'] }} />,
    );
    expect(screen.getByRole('group', { name: 'Rule symbols' })).toBeDefined();
  });

  it('renders nothing extra for the AllSymbols kind', () => {
    render(<Harness initial={{ kind: RulesV2.RuleScopeKind.AllSymbols }} />);
    expect(screen.queryByLabelText('Rule symbol')).toEqual(null);
    expect(screen.queryByLabelText('Rule symbols')).toEqual(null);
  });
});
