import { IconButton, Tooltip } from '@radix-ui/themes';
import { Moon, PanelLeft, Sun } from 'lucide-react';
import type { ReactNode } from 'react';
import { Theme } from '../../lib/theme.types.js';
import { useTheme } from '../../lib/theme-context.js';

/**
 * Props passed in from the surrounding {@link AppShell}: the current sidebar
 * collapse state and the callback that flips it. The shell owns the state so
 * the sidebar and the topbar trigger stay aligned without a shared context.
 */
interface TopbarProps {
  /** `true` when the sidebar is collapsed to an icon rail. */
  sidebarCollapsed: boolean;
  /** Flip the sidebar between expanded and collapsed. */
  onToggleSidebar: () => void;
}

/**
 * Top app bar: a sidebar-toggle icon button on the left and a theme-toggle
 * icon button on the right. No brand label — the page `<title>` is the only
 * place the app name appears.
 *
 * Both icon buttons use Radix Themes' `IconButton` (styled framework primitive)
 * wrapped in a Radix Themes `Tooltip` for the visible hover label. The
 * accessible name comes from `aria-label` so screen readers still announce
 * each control by name (a tooltip is a description, not a name).
 */
export function Topbar({ sidebarCollapsed, onToggleSidebar }: TopbarProps): ReactNode {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-card px-4">
      <Tooltip content={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
        <IconButton variant="ghost" aria-label="Toggle sidebar" onClick={onToggleSidebar}>
          <PanelLeft className="h-4 w-4" aria-hidden="true" />
        </IconButton>
      </Tooltip>
      <ThemeToggle />
    </header>
  );
}

/**
 * Icon-only theme toggle backed by Radix Themes' `IconButton` + `Tooltip`.
 * Reads/writes the theme through the surrounding `<ThemeProvider>` so any
 * other subscriber (the Radix Themes `<Theme appearance>`) re-renders in sync.
 */
function ThemeToggle(): ReactNode {
  const { theme, setTheme } = useTheme();
  const Icon = theme === Theme.Dark ? Sun : Moon;
  const next = theme === Theme.Dark ? Theme.Light : Theme.Dark;

  return (
    <Tooltip content="Toggle theme">
      <IconButton variant="ghost" aria-label="Toggle theme" onClick={() => setTheme(next)}>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </IconButton>
    </Tooltip>
  );
}
