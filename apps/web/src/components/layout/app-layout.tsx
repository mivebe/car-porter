import { ArrowLeftRight, ListChecks, Search, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router';
import { useAliasSummary } from '@/features/aliases/alias-hooks';
import { CountBadge } from '@/features/aliases/count-badge';
import { useSyncPreferences } from '@/lib/preferences';
import { cn } from '@/lib/utils';
import { HeaderControls } from './header-controls';
import { Logo } from './logo';

const NAV_ITEMS = [
  { to: '/', key: 'nav.search', icon: Search, end: true },
  { to: '/tracking', key: 'nav.tracking', icon: ListChecks, end: false },
  { to: '/aliases', key: 'nav.aliases', icon: ArrowLeftRight, end: false },
] as const;

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'relative flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground',
    isActive && 'text-foreground after:absolute after:inset-x-3 after:-bottom-3 after:h-0.5 after:rounded-full after:bg-brand',
  );

export function AppLayout() {
  const { t } = useTranslation();
  useSyncPreferences();
  const aliasSummary = useAliasSummary();
  const unassigned = aliasSummary.data ? Object.values(aliasSummary.data.unassigned).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        {/* accent hairline fading out along the header's bottom edge */}
        <div className="pointer-events-none absolute inset-x-0 -bottom-px h-px bg-linear-to-r from-transparent via-brand/60 to-transparent" />
        <div className="mx-auto flex h-14 max-w-screen-2xl items-center gap-6 px-4">
          <div className="flex items-center gap-2 font-semibold tracking-wide">
            <Logo className="size-7" />
            <span>{t('app.name')}</span>
          </div>
          <nav className="flex items-center gap-1">
            {NAV_ITEMS.map(({ to, key, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={navLinkClass}
              >
                <Icon className="size-4" />
                <span className="hidden sm:inline">{t(key)}</span>
                {to === '/aliases' && unassigned > 0 && (
                  <CountBadge
                    aria-label={t('aliases.unassignedCount', { count: unassigned })}
                    data-testid="nav-unassigned"
                  >
                    {unassigned}
                  </CountBadge>
                )}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <HeaderControls />
            <NavLink to="/settings" aria-label={t('nav.settings')} className={navLinkClass}>
              <Settings className="size-4" />
            </NavLink>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-screen-2xl flex-1 px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
