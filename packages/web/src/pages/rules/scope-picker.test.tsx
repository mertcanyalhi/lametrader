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
  it('renders a single-symbol popover trigger for the Symbol kind', () => {
    render(<Harness initial={{ kind: RuleScopeKind.Symbol, symbolId: 'crypto:BTCUSDT' }} />);
    expect(screen.getByLabelText('Rule symbol')).toBeDefined();
    expect(screen.queryByLabelText('Rule symbols')).toEqual(null);
  });

  it('renders a multi-checkbox group for the Symbols kind', () => {
    render(<Harness initial={{ kind: RuleScopeKind.Symbols, symbolIds: ['crypto:BTCUSDT'] }} />);
    expect(screen.getByRole('group', { name: 'Rule symbols' })).toBeDefined();
  });

  it('renders nothing extra for the AllSymbols kind', () => {
    render(<Harness initial={{ kind: RuleScopeKind.AllSymbols }} />);
    expect(screen.queryByLabelText('Rule symbol')).toEqual(null);
    expect(screen.queryByLabelText('Rule symbols')).toEqual(null);
  });
});

describe('ScopePicker — Symbol filter combobox', () => {
  it('exposes a filter input inside the popover when the trigger opens', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ kind: RuleScopeKind.Symbol, symbolId: '' }} />);
    await user.click(screen.getByLabelText('Rule symbol'));
    expect(screen.getByLabelText('Filter symbols')).toBeDefined();
  });

  it('narrows the listbox to symbols matching the filter (case-insensitive)', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ kind: RuleScopeKind.Symbol, symbolId: '' }} />);
    await user.click(screen.getByLabelText('Rule symbol'));
    await user.type(screen.getByLabelText('Filter symbols'), 'eth');
    const listbox = screen.getByRole('listbox', { name: 'Filtered symbols' });
    const options = Array.from(listbox.querySelectorAll('[role="option"]')).map(
      (option) => option.textContent,
    );
    expect(options).toEqual(['crypto:ETHUSDT']);
  });

  it('selects the picked symbol on click and closes the popover', async () => {
    const user = userEvent.setup();
    const snapshots: RuleScope[] = [];
    render(
      <Harness
        initial={{ kind: RuleScopeKind.Symbol, symbolId: '' }}
        onSnapshot={(scope) => snapshots.push(scope)}
      />,
    );
    await user.click(screen.getByLabelText('Rule symbol'));
    await user.click(screen.getByRole('option', { name: 'crypto:ETHUSDT' }));
    expect(snapshots).toEqual([{ kind: RuleScopeKind.Symbol, symbolId: 'crypto:ETHUSDT' }]);
  });
});

describe('ScopePicker — Symbols filter multi-select', () => {
  it('exposes a filter input above the checkbox group', () => {
    render(<Harness initial={{ kind: RuleScopeKind.Symbols, symbolIds: [] }} />);
    expect(screen.getByLabelText('Filter symbols')).toBeDefined();
  });

  it('hides non-matching symbols from the checkbox group while filtered', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ kind: RuleScopeKind.Symbols, symbolIds: [] }} />);
    await user.type(screen.getByLabelText('Filter symbols'), 'sol');
    const group = screen.getByRole('group', { name: 'Rule symbols' });
    const visible = Array.from(group.querySelectorAll('label')).map((label) =>
      label.textContent?.trim(),
    );
    expect(visible).toEqual(['crypto:SOLUSDT']);
  });

  it('toggles a checkbox without dropping previously-selected hidden ids', async () => {
    const user = userEvent.setup();
    const snapshots: RuleScope[] = [];
    render(
      <Harness
        initial={{ kind: RuleScopeKind.Symbols, symbolIds: ['crypto:BTCUSDT'] }}
        onSnapshot={(scope) => snapshots.push(scope)}
      />,
    );
    await user.type(screen.getByLabelText('Filter symbols'), 'sol');
    await user.click(screen.getByRole('checkbox'));
    expect(snapshots).toEqual([
      {
        kind: RuleScopeKind.Symbols,
        symbolIds: ['crypto:BTCUSDT', 'crypto:SOLUSDT'],
      },
    ]);
  });
});
