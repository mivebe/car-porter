# Car Porter

A personal, locally run tool for importing cars from US auctions to Bulgaria. It finds lots on
**Copart** and **IAAI**, estimates what a lot will really sell for from past **bidfax** sales, checks
the vehicle's earlier auctions (bidfax, stat.vin), calculates the landed cost in EUR, compares it with
Bulgarian marketplace prices (mobile.bg, cars.bg, OLX.bg, AutoScout24 as an EU reference) and gives a
**Worth it / Borderline / Not worth it** verdict. The UI is in English and Bulgarian.

> For personal use only. Scraping these sites may be against their terms of service: keep the request
> volume low (the app caches and pauses between page loads) and don't redistribute the data.

## Requirements

- **Windows, macOS or Linux** with a residential internet connection (datacenter IPs get blocked).
- **Node.js 26** (see `.nvmrc`). With nvm-windows: `nvm install 26.3.0` then `nvm use 26.3.0`.
- **pnpm 10**: `corepack enable` (the version is pinned in `package.json`).
- **Google Chrome** installed normally. Scraping drives the installed Chrome through
  [Patchright](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright), which passes the sites' bot checks
  headless; no separate browser download is needed for the app.

## Setup

```sh
pnpm install
```

Only for the end-to-end tests (Playwright's own Chromium):

```sh
pnpm --filter @car-porter/web exec playwright install chromium
```

## Run

```sh
pnpm dev
```

- Web: <http://127.0.0.1:5173> (Vite, proxies `/api` to the server)
- API: <http://127.0.0.1:3001> (Fastify)

Data is kept in `apps/server/data/` (git-ignored): the SQLite database `car-porter.sqlite` and one
persistent browser profile per site under `browser-profiles/` (cookies, bot-check clearance, logins).
Delete a profile folder to start that site fresh.

### Try it without scraping

Mock mode serves recorded pages instead of the real sites (a Toyota Camry 2018–2020 search has data;
Toyota Corolla and 2018 Camry estimates/markets simulate blocked and broken sources):

```sh
# bash
MOCK_SOURCES=1 DB_FILE=:memory: pnpm dev
# PowerShell
$env:MOCK_SOURCES='1'; $env:DB_FILE=':memory:'; pnpm dev
```

### Server environment variables

| Variable       | Default                              | Purpose                           |
| -------------- | ------------------------------------ | --------------------------------- |
| `PORT`         | `3001`                               | API port                          |
| `DB_FILE`      | `apps/server/data/car-porter.sqlite` | SQLite file, or `:memory:`        |
| `PROFILES_DIR` | `apps/server/data/browser-profiles`  | Persistent browser profiles       |
| `MOCK_SOURCES` | unset                                | `1` = recorded pages, no scraping |
| `LOG_LEVEL`    | `info`                               | Fastify/pino log level            |

The web dev server reads `WEB_PORT` (default `5173`) and `API_URL` (default `http://127.0.0.1:3001`).

## Using it

1. **Search** — pick manufacturer, model and a year range; Copart and IAAI results are merged. Each
   source shows a status badge (count, cache age, or a typed error such as _blocked_).
2. **Open a lot** — the side sheet has manual buttons, so nothing is scraped until you ask:
   - **Estimate price**: past bidfax sales of the same make, model, exact year and trim/engine
     (last 12 months, up to 20 matches / 20 pages by default). Untick outliers; the average becomes
     the purchase price.
   - **Check history**: earlier auctions of this VIN / lot number. Listings often mask the VIN — paste
     it from the photos.
   - **Import cost**: bid + fees (10 % + 20 % + 10 %, or reduced ÷3) + shipping to Rotterdam, converted
     with the ECB rate, + Rotterdam → Sofia + optional Sofia → anywhere in BG.
   - **Check BG market**: matching listings per marketplace with include checkboxes; optional mileage,
     transmission and fuel matching.
   - **Verdict**: margin = BG average − landed cost − repair estimate; _Worth it_ from €3,000.
3. **Track** a lot to see all tracked lots with their estimate, cost, market price and verdict on the
   **Tracking** page (always recalculated from stored data and current settings).
4. **Settings** — every rate, amount, limit and default, the manual exchange rate, language and theme.

Scraped data is cached: lot searches 30 min, estimate/history/market searches 24 h (each section has
a **Refresh** button that bypasses it), past sales and history permanently.

### Copart login (optional)

Search works as a guest. To use your Copart member account, open **Settings → Copart account → Open
Copart login window**: a visible Chrome window opens on the Copart profile; log in there and close
the window. The session is kept in `browser-profiles/copart` and reused by later searches.

## Development

```sh
pnpm typecheck   # all packages
pnpm lint
pnpm test        # Vitest: core logic, parsers on recorded fixtures, API routes, web units
pnpm e2e         # Playwright: web + server in mock mode, in-memory DB
```

Layout:

- `packages/core` — pure shared logic: types, cost calculation (integer cents), matching rules,
  averages, verdict, settings schema.
- `apps/server` — Fastify API, SQLite (`node:sqlite` + Drizzle; migrations in `drizzle/`, applied on
  start), source adapters (`src/sources/`) with network fetching separated from pure parsers.
- `apps/web` — Vite + React + Tailwind/shadcn UI, TanStack Query, i18next (`src/i18n/locales/`).

Conventions:

- Every UI string goes through i18next with `en` and `bg` keys; `apps/web/tests/hardcoded-strings.test.ts`
  fails on hardcoded JSX copy and the locale test on missing keys.
- Parsers are tested against real pages saved in `apps/server/test/fixtures/<source>/`. There are no
  automated live tests: when a site changes its markup the UI shows _parsing failed_; re-record the
  fixtures with the scripts below and fix the parser.
- Schema changes: edit `apps/server/src/db/schema.ts`, then `pnpm --filter @car-porter/server db:generate`.

Manual live checks and fixture recording (hit the real sites):

```sh
pnpm --filter @car-porter/server exec tsx scripts/live-search.ts toyota camry 2018 2020
pnpm --filter @car-porter/server exec tsx scripts/live-estimate.ts toyota camry 2019
pnpm --filter @car-porter/server exec tsx scripts/live-history.ts toyota camry 2019 [VIN]
pnpm --filter @car-porter/server exec tsx scripts/live-market.ts toyota rav4 2019
pnpm --filter @car-porter/server exec tsx scripts/record-bidfax.ts   # also record-history.ts, record-market.ts
```

The full plan and design decisions are in [docs/plans/2026-09-16-car-porter.md](docs/plans/2026-09-16-car-porter.md).
