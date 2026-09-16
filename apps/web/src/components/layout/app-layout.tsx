import { CarFront, ListChecks, Search, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router';
import { cn } from '@/lib/utils';
import { HeaderControls } from './header-controls';

const NAV_ITEMS = [
  { to: '/', key: 'nav.search', icon: Search, end: true },
  { to: '/tracking', key: 'nav.tracking', icon: ListChecks, end: false },
  { to: '/settings', key: 'nav.settings', icon: Settings, end: false },
] as const;

export function AppLayout() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-screen-2xl items-center gap-6 px-4">
          <div className="flex items-center gap-2 font-semibold">
            <CarFront className="size-5" />
            <span>{t('app.name')}</span>
          </div>
          <nav className="flex items-center gap-1">
            {NAV_ITEMS.map(({ to, key, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground',
                    isActive && 'bg-accent text-foreground',
                  )
                }
              >
                <Icon className="size-4" />
                <span className="hidden sm:inline">{t(key)}</span>
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto">
            <HeaderControls />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-screen-2xl flex-1 px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
