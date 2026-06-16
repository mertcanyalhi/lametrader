import { Moon, Sun } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { getStoredTheme, setTheme } from '../../lib/theme.js';
import { Theme } from '../../lib/theme.types.js';
import { Button } from '../ui/button.js';
import { SimpleTooltip } from '../ui/tooltip.js';

/**
 * Top app bar: app brand on the left, a compact theme-toggle button on the
 * right. The brand sits inside a `<header role="banner">` so layout tests can
 * scope to the topbar region without exposing internal markup.
 */
export function Topbar(): ReactNode {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-card px-4">
      <div className="text-sm font-semibold tracking-tight">lametrader</div>
      <ThemeToggle />
    </header>
  );
}

/**
 * Icon-only theme toggle. The visible label comes from a Radix `<Tooltip>` on
 * hover/focus; the accessible name comes from `aria-label` (an icon-only
 * button needs a real accessible name — a tooltip alone is a description, not
 * a name). Never `title=`.
 */
function ThemeToggle(): ReactNode {
  const [theme, setLocalTheme] = useState<Theme>(getStoredTheme);
  const Icon = theme === Theme.Dark ? Sun : Moon;

  const toggle = (): void => {
    const next = theme === Theme.Dark ? Theme.Light : Theme.Dark;
    setTheme(next);
    setLocalTheme(next);
  };

  return (
    <SimpleTooltip content="Toggle theme">
      <Button variant="ghost" size="icon" aria-label="Toggle theme" onClick={toggle}>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </Button>
    </SimpleTooltip>
  );
}
