import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import type { AliasEntry, CanonicalItem } from '@/lib/api';

const entry = (name: string): AliasEntry => ({
  source: 'copart',
  kind: 'make',
  externalName: name,
  make: '',
  lotCount: 3,
  lastSeenAt: new Date().toISOString(),
  auto: { targets: [], match: null, nonCarMake: null },
  manual: null,
  status: 'unassigned',
});

const POOL = Array.from({ length: 250 }, (_, i) => entry(`SITE NAME ${i + 1}`));
const CANONICAL: CanonicalItem[] = [
  { name: 'Acura', siteNames: 3, bySource: { copart: 2, iaai: 1 }, lots: 40 },
  { name: 'Alfa Romeo', siteNames: 1, bySource: { copart: 1, iaai: 0 }, lots: 5 },
];

vi.mock('./alias-hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./alias-hooks')>()),
  useAliases: (params: { target?: string }) => ({
    // the assigned column asks by target; the pool is everything else
    data: params.target ? { items: [], total: 0, counts: {} } : { items: POOL, total: POOL.length, counts: {} },
    isPending: false,
    isError: false,
  }),
  useCanonicalItems: () => ({ data: { items: CANONICAL }, isPending: false }),
  useChangeAliases: () => ({ mutateAsync: vi.fn() }),
}));

const { AliasBoard } = await import('./alias-board');

const board = () => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <AliasBoard kind="make" make="" q="" active={null} onActiveChange={() => {}} onMakeChange={() => {}} />
  </QueryClientProvider>
);

describe('AliasBoard our makes', () => {
  beforeEach(async () => {
    await act(() => i18n.changeLanguage('en'));
  });

  it('shows site names per site next to the total, and hides a site with none', () => {
    render(board());
    const row = (name: string) => screen.getAllByTestId('alias-canonical-item').find((r) => r.dataset.name === name)!;

    // IAAI, then Copart, then the total
    expect(row('Acura')).toHaveTextContent(/^Acura\s*1\s*2\s*3$/);
    expect(row('Acura').querySelector('[title^="IAAI"]')).toHaveTextContent('1');
    expect(row('Acura').querySelector('[title^="Copart"]')).toHaveTextContent('2');

    expect(row('Alfa Romeo').querySelector('[title^="IAAI"]')).toBeNull();
    expect(row('Alfa Romeo').querySelector('[title^="Copart"]')).toHaveTextContent('1');
  });
});

describe('AliasBoard paging', () => {
  beforeEach(async () => {
    await act(() => i18n.changeLanguage('en'));
  });

  it('renders a first page of cards and reveals the rest on demand', async () => {
    const user = userEvent.setup();
    render(board());

    // a long column would make every drag re-render hundreds of cards
    expect(screen.getAllByTestId('alias-card')).toHaveLength(60);
    const more = screen.getByTestId('alias-show-more');
    expect(more).toHaveTextContent('Show 190 more');

    await user.click(more);
    expect(screen.getAllByTestId('alias-card')).toHaveLength(120);
    expect(screen.getByTestId('alias-show-more')).toHaveTextContent('Show 130 more');

    // 180, 240, then the last 10
    for (let i = 0; i < 3; i++) await user.click(screen.getByTestId('alias-show-more'));
    expect(screen.getAllByTestId('alias-card')).toHaveLength(250);
    expect(screen.queryByTestId('alias-show-more')).not.toBeInTheDocument();
  });
});
