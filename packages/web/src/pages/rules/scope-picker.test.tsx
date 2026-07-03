// @vitest-environment jsdom
import {
  Period,
  type RuleScope,
  RuleScopeKind,
  SymbolType,
  type WatchedSymbol,
} from '@lametrader/core';
import { Theme } from '@radix-ui/themes';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { type ReactNode, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ScopePicker } from './scope-picker';

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
  {
    id: 'crypto:SOLUSDT',
    type: SymbolType.Crypto,
    description: 'SOL/USDT',
    exchange: 'Binance',
    periods: [Period.OneHour],
  },
];

function Harness({
  initial,
  symbols = SYMBOLS,
  onSnapshot,
}: {
  initial: RuleScope;
  symbols?: WatchedSymbol[];
  onSnapshot?: (scope: RuleScope) => void;
}): ReactNode {
  const [value, setValue] = useState<RuleScope>(initial);
  return (
    <Theme>
      <ScopePicker
        value={value}
        onChange={(next) => {
          setValue(next);
          onSnapshot?.(next);
        }}
        watchedSymbols={symbols}
      />
    </Theme>
  );
}

describe('ScopePicker', () => {
  it('renders a single-symbol combobox for the Symbol kind', () => {
    render(<Harness initial={{ kind: RuleScopeKind.Symbol, symbolId: 'crypto:BTCUSDT' }} />);
    expect(screen.getByRole('combobox', { name: 'Rule symbol' })).toBeDefined();
    expect(screen.queryByRole('combobox', { name: 'Rule symbols' })).toEqual(null);
  });

  it('renders a multi-symbol combobox for the Symbols kind', () => {
    render(<Harness initial={{ kind: RuleScopeKind.Symbols, symbolIds: ['crypto:BTCUSDT'] }} />);
    expect(screen.getByRole('combobox', { name: 'Rule symbols' })).toBeDefined();
  });

  it('renders no symbol combobox for the AllSymbols kind', () => {
    render(<Harness initial={{ kind: RuleScopeKind.AllSymbols }} />);
    expect(screen.queryByRole('combobox', { name: 'Rule symbol' })).toEqual(null);
    expect(screen.queryByRole('combobox', { name: 'Rule symbols' })).toEqual(null);
  });
});

describe('ScopePicker — Symbol combobox', () => {
  it('lists watched symbols alphabetically regardless of watchlist order', async () => {
    const user = userEvent.setup();
    const unsorted: WatchedSymbol[] = [SYMBOLS[2], SYMBOLS[0], SYMBOLS[1]] as WatchedSymbol[];
    render(<Harness initial={{ kind: RuleScopeKind.Symbol, symbolId: '' }} symbols={unsorted} />);
    await user.click(screen.getByRole('combobox', { name: 'Rule symbol' }));
    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual(['crypto:BTCUSDT', 'crypto:ETHUSDT', 'crypto:SOLUSDT']);
  });

  it('narrows the options to symbols matching the typed filter (case-insensitive)', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ kind: RuleScopeKind.Symbol, symbolId: '' }} />);
    await user.type(screen.getByRole('combobox', { name: 'Rule symbol' }), 'eth');
    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual(['crypto:ETHUSDT']);
  });

  it('selects the picked symbol on click', async () => {
    const user = userEvent.setup();
    const snapshots: RuleScope[] = [];
    render(
      <Harness
        initial={{ kind: RuleScopeKind.Symbol, symbolId: '' }}
        onSnapshot={(scope) => snapshots.push(scope)}
      />,
    );
    await user.click(screen.getByRole('combobox', { name: 'Rule symbol' }));
    await user.click(screen.getByRole('option', { name: 'crypto:ETHUSDT' }));
    expect(snapshots).toEqual([{ kind: RuleScopeKind.Symbol, symbolId: 'crypto:ETHUSDT' }]);
  });

  it('displays the selected symbol even when it is absent from the watchlist', () => {
    render(<Harness initial={{ kind: RuleScopeKind.Symbol, symbolId: 'crypto:XRPUSDT' }} />);
    expect(screen.getByText('crypto:XRPUSDT')).toBeDefined();
  });
});

describe('ScopePicker — Symbols multi-combobox', () => {
  it('narrows the options to symbols matching the typed filter', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ kind: RuleScopeKind.Symbols, symbolIds: [] }} />);
    await user.type(screen.getByRole('combobox', { name: 'Rule symbols' }), 'sol');
    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual(['crypto:SOLUSDT']);
  });

  it('adds the picked symbol to the selection without dropping prior picks', async () => {
    const user = userEvent.setup();
    const snapshots: RuleScope[] = [];
    render(
      <Harness
        initial={{ kind: RuleScopeKind.Symbols, symbolIds: ['crypto:BTCUSDT'] }}
        onSnapshot={(scope) => snapshots.push(scope)}
      />,
    );
    await user.click(screen.getByRole('combobox', { name: 'Rule symbols' }));
    await user.click(screen.getByRole('option', { name: 'crypto:SOLUSDT' }));
    expect(snapshots).toEqual([
      {
        kind: RuleScopeKind.Symbols,
        symbolIds: ['crypto:BTCUSDT', 'crypto:SOLUSDT'],
      },
    ]);
  });

  it('displays a selected symbol even when it is absent from the watchlist', () => {
    render(<Harness initial={{ kind: RuleScopeKind.Symbols, symbolIds: ['crypto:XRPUSDT'] }} />);
    expect(screen.getByText('crypto:XRPUSDT')).toBeDefined();
  });
});
