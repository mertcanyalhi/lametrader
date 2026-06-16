import { CandlestickChart, List, Settings as SettingsIcon } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import { cn } from '../../lib/cn.js';

/**
 * A single nav entry definition: path, label, and the icon shown next to it
 * (and shown alone on the icon rail below 1024 px wide).
 */
interface NavItem {
  /** Route path the link points to. */
  path: string;
  /** Human-readable label (the accessible name; the link's visible text ≥ 1024 px). */
  label: string;
  /** Icon component (always visible). */
  icon: LucideIcon;
}

/**
 * The three primary destinations of the app. Order is the rendered order.
 */
const NAV_ITEMS: NavItem[] = [
  { path: '/', label: 'Watchlist', icon: List },
  { path: '/chart', label: 'Chart', icon: CandlestickChart },
  { path: '/settings', label: 'Settings', icon: SettingsIcon },
];

/**
 * Persistent left sidebar with the primary nav.
 *
 * Active-route highlighting is handled by `react-router`'s `<NavLink>`, which
 * sets `aria-current="page"` on the matching link.
 * Below 1024 px the label text is hidden (Tailwind `lg:` breakpoint) so the
 * sidebar gracefully collapses to an icon rail.
 */
export function Sidebar(): ReactNode {
  return (
    <aside
      aria-label="Primary"
      className="flex w-14 shrink-0 flex-col border-r border-border bg-card lg:w-56"
    >
      <nav aria-label="Primary navigation" className="flex flex-1 flex-col gap-1 p-2">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            aria-label={item.label}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-2 py-2 text-sm font-medium',
                'transition-colors hover:bg-accent hover:text-accent-foreground',
                isActive
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground',
              )
            }
          >
            <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="hidden lg:inline" aria-hidden="true">
              {item.label}
            </span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
