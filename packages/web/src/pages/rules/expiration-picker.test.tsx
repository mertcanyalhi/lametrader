// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { Theme } from '@radix-ui/themes';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ExpirationKind } from '../../lib/rule-form-schema.js';
import { ExpirationPicker } from './expiration-picker';

function Harness({
  initialKind = ExpirationKind.Never,
  initialValue = '',
  error,
}: {
  initialKind?: ExpirationKind;
  initialValue?: string;
  error?: string;
}): ReactNode {
  const [kind, setKind] = useState<ExpirationKind>(initialKind);
  const [value, setValue] = useState<string>(initialValue);
  return (
    <Theme>
      <div data-testid="snapshot">{JSON.stringify({ kind, value })}</div>
      <ExpirationPicker
        kind={kind}
        onKindChange={setKind}
        value={value}
        onValueChange={setValue}
        error={error}
      />
    </Theme>
  );
}

function snapshot(): { kind: ExpirationKind; value: string } {
  return JSON.parse(screen.getByTestId('snapshot').textContent ?? 'null');
}

describe('ExpirationPicker', () => {
  afterEach(() => {
    cleanup();
  });

  it('hides the datetime input when the kind is "Never"', () => {
    render(<Harness initialKind={ExpirationKind.Never} />);
    expect(screen.queryByLabelText('Expiration date')).toBeNull();
  });

  it('reveals the datetime input when the kind is "On date"', () => {
    render(<Harness initialKind={ExpirationKind.OnDate} initialValue="2030-01-01T12:00" />);
    expect(screen.getByLabelText('Expiration date')).toHaveValue('2030-01-01T12:00');
  });

  it('switches the kind snapshot when the user picks the other radio option', async () => {
    render(<Harness initialKind={ExpirationKind.Never} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('radio', { name: 'On date' }));

    expect(snapshot().kind).toEqual(ExpirationKind.OnDate);
  });

  it('renders the inline error message when one is supplied', () => {
    render(
      <Harness
        initialKind={ExpirationKind.OnDate}
        error="Expiration date must be in the future."
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Expiration date must be in the future.');
  });
});
