import type { LucideIcon } from 'lucide-react';
import { CandlestickChart, List, Scale, Settings as SettingsIcon, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import { cn } from '../../lib/cn.js';
import { isRulesV2Enabled } from '../../lib/feature-flags.js';

/**
 * A single nav entry definition: path, label, and the icon shown next to it
 * (and shown alone on the icon rail when the sidebar is collapsed).
 */
interface NavItem {
  /** Route path the link points to. */
  path: string;
  /** Human-readable label (the accessible name; the link's visible text when expanded). */
  label: string;
  /** Icon component (always visible). */
  icon: LucideIcon;
}

/**
 * The primary destinations of the app, in rendered order.
 *
 * The `Rules v2` entry is feature-flag-gated per ADR 0016 / #396: it only
 * appears when {@link isRulesV2Enabled} resolves to `true`. Default off — the
 * editor doesn't surface to users until the hard cutover.
 */
function buildNavItems(): NavItem[] {
  const items: NavItem[] = [
    { path: '/', label: 'Watchlist', icon: List },
    { path: '/chart', label: 'Chart', icon: CandlestickChart },
    { path: '/rules', label: 'Rules', icon: Scale },
  ];
  if (isRulesV2Enabled()) {
    items.push({ path: '/rules-v2', label: 'Rules v2', icon: Sparkles });
  }
  items.push({ path: '/settings', label: 'Settings', icon: SettingsIcon });
  return items;
}

/**
 * Persistent left sidebar with the primary nav.
 *
 * Active-route highlighting comes from `react-router`'s `<NavLink>`, which
 * sets `aria-current="page"` on the matching link.
 *
 * Collapse behaviour:
 * - Below 1024 px the CSS rules force the icon rail regardless of {@link collapsed}.
 * - At ≥ 1024 px the {@link collapsed} prop controls expansion — `true` keeps
 *   the icon rail; `false` widens to show labels.
 *
 * `data-collapsed` on the `<aside>` mirrors the prop for tests + downstream CSS.
 */
export function Sidebar({ collapsed }: { collapsed: boolean }): ReactNode {
  const navItems = buildNavItems();
  return (
    <aside
      aria-label="Primary"
      data-collapsed={collapsed ? 'true' : 'false'}
      className={cn(
        'flex w-14 shrink-0 flex-col border-r border-border bg-card',
        collapsed ? 'lg:w-14' : 'lg:w-56',
      )}
    >
      <BrandMark collapsed={collapsed} />
      <nav aria-label="Primary navigation" className="flex flex-1 flex-col gap-1 p-2">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            aria-label={item.label}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-2 py-2 text-sm font-medium',
                'transition-colors hover:bg-accent hover:text-accent-foreground',
                isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
              )
            }
          >
            <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span
              className={cn('hidden', collapsed ? 'lg:hidden' : 'lg:inline')}
              aria-hidden="true"
            >
              {item.label}
            </span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}

function BrandMark({ collapsed }: { collapsed: boolean }): ReactNode {
  return (
    <div
      role="img"
      aria-label="lametrader"
      className="flex h-12 shrink-0 items-center border-b border-border px-3 text-lg tracking-tight text-foreground"
    >
      <span aria-hidden="true" className={cn('hidden', collapsed ? 'lg:hidden' : 'lg:inline')}>
        <span className="font-light">lame</span>
        <span className="font-bold">trader</span>
      </span>
      <span aria-hidden="true" className={cn('inline', collapsed ? 'lg:inline' : 'lg:hidden')}>
        <span className="font-light">l</span>
        <span className="font-bold">t</span>
      </span>
    </div>
  );
}
