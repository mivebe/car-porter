import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import {
  createBrowserRouter,
  createMemoryRouter,
  RouterProvider,
  type RouteObject,
} from 'react-router';
import { AppLayout } from '@/components/layout/app-layout';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ThemeProvider } from '@/lib/theme';
import { SearchPage } from '@/pages/search-page';
import { SettingsPage } from '@/pages/settings-page';
import { TrackingPage } from '@/pages/tracking-page';

const routes: RouteObject[] = [
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <SearchPage /> },
      { path: 'tracking', element: <TrackingPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
];

/** `initialPath` switches to an in-memory router (used by tests). */
export function App({ initialPath }: { initialPath?: string }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }),
  );
  const [router] = useState(() =>
    initialPath
      ? createMemoryRouter(routes, { initialEntries: [initialPath] })
      : createBrowserRouter(routes),
  );

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <RouterProvider router={router} />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
