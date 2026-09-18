import type { EstimateResponse } from '@/features/lot/estimate-hooks';
import type { HistoryResponse } from '@/features/lot/history-hooks';
import type { MarketResponse } from '@/features/lot/market-hooks';
import type { TrackedLotsResponse } from '@/features/tracking/tracking-hooks';
import type { AuctionSource, IaaiMarket, Lot, LotInputs, LotInputsPatch, Settings, SettingsPatch, SourceErrorInfo } from '@car-porter/core';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`API ${status}`);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

export function query(params: Record<string, string | number | boolean | undefined | null>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  return search.toString();
}

export interface CatalogItem {
  id: number;
  name: string;
}

export interface CatalogResponse {
  items: CatalogItem[];
  fetchedAt: string;
  stale: boolean;
}

export type LotSourceResult =
  | {
      source: AuctionSource;
      ok: true;
      total: number;
      count: number;
      hasMore: boolean;
      /** The site's own make/model names the search ran with (absent on older cached results). */
      matched?: { makes: string[]; models: string[] };
      fetchedAt: string;
      fromCache: boolean;
      stale: boolean;
      error?: SourceErrorInfo;
    }
  | { source: AuctionSource; ok: false; error: SourceErrorInfo };

export interface LotSearchResponse {
  lots: Lot[];
  sources: LotSourceResult[];
  page: number;
}

export interface LotSearchParams {
  make: string;
  model: string;
  yearFrom: number;
  yearTo: number;
  trim?: string;
  /** empty or missing = all */
  iaaiMarkets?: IaaiMarket[];
}

export interface FxResponse {
  usdToEur: number;
  source: 'ecb' | 'override';
  ecb: { usdToEur: number; date: string; fetchedAt: string; stale: boolean } | null;
  error?: SourceErrorInfo;
}

export type AliasKind = 'make' | 'model';
/** non_car: recognised as an NHTSA motorcycle/trailer/bus make, so not waiting for assignment */
export type AliasStatus = 'unassigned' | 'auto' | 'non_car' | 'manual' | 'ignored';
export type AliasAutoMatch = 'exact' | 'rule' | 'fuzzy' | 'non_car';

/** A make or model name as an auction site spells it, and what it maps to in our catalog. */
export interface AliasEntry {
  source: AuctionSource;
  kind: AliasKind;
  externalName: string;
  /** models: the make the site listed it under; '' for makes */
  make: string;
  lotCount: number | null;
  lastSeenAt: string;
  /** nonCarMake: the NHTSA motorcycle/trailer/bus make it was recognised as */
  auto: { targets: string[]; match: AliasAutoMatch | null; nonCarMake: string | null };
  /** null = no decision by the user */
  manual: { state: 'assigned' | 'ignored' | 'unassigned'; targets: string[] } | null;
  status: AliasStatus;
}

export interface AliasListParams {
  kind: AliasKind;
  source?: AuctionSource;
  make?: string;
  status?: AliasStatus;
  /** only site names searched as this make/model */
  target?: string;
  q?: string;
  limit?: number;
}

export interface AliasListResponse {
  items: AliasEntry[];
  total: number;
  counts: Record<AliasStatus, number>;
}

export type AliasKey = Pick<AliasEntry, 'source' | 'kind' | 'externalName'> & { make?: string };

/** A user decision for one site name ('assign' with no targets unassigns it). */
export type AliasChange = AliasKey &
  ({ action: 'assign'; targets: string[] } | { action: 'ignore' } | { action: 'unassign' } | { action: 'reset' });

/** One of our makes (or models of a make) with how many site names are searched as it. */
export interface CanonicalItem {
  name: string;
  siteNames: number;
  /** site names per auction site */
  bySource: Record<AuctionSource, number>;
  lots: number;
}

export interface AliasScanSource {
  source: AuctionSource;
  phase: 'queued' | 'makes' | 'models' | 'done' | 'failed' | 'cancelled';
  done: number;
  total: number;
  /** requests sent to the site so far */
  requests: number;
  /** makes phase: year range being read; models phase: the make */
  current: string | null;
  failed: { make: string; error: SourceErrorInfo }[];
  error?: SourceErrorInfo;
}

export interface AliasScanStatus {
  state: 'idle' | 'running' | 'done' | 'cancelled';
  make: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  sources: AliasScanSource[];
}

export interface CopartLoginStatus {
  windowOpen: boolean;
}

export const api = {
  settings: () => request<Settings>('/api/settings'),
  updateSettings: (patch: SettingsPatch) =>
    request<Settings>('/api/settings', { method: 'PATCH', body: JSON.stringify(patch) }),
  fx: () => request<FxResponse>('/api/fx'),
  lotInputs: (id: string) => request<LotInputs>(`/api/lots/${encodeURIComponent(id)}/inputs`),
  updateLotInputs: (id: string, patch: LotInputsPatch) =>
    request<LotInputs>(`/api/lots/${encodeURIComponent(id)}/inputs`, { method: 'PATCH', body: JSON.stringify(patch) }),
  estimate: (id: string) => request<EstimateResponse>(`/api/lots/${encodeURIComponent(id)}/estimate`),
  runEstimate: (id: string, refresh: boolean) =>
    request<EstimateResponse>(`/api/lots/${encodeURIComponent(id)}/estimate`, { method: 'POST', body: JSON.stringify({ refresh }) }),
  setEstimateSelection: (id: string, recordId: string, included: boolean) =>
    request<{ excludedIds: string[] }>(`/api/lots/${encodeURIComponent(id)}/estimate/selection`, {
      method: 'PUT',
      body: JSON.stringify({ recordId, included }),
    }),
  history: (id: string) => request<HistoryResponse>(`/api/lots/${encodeURIComponent(id)}/history`),
  runHistory: (id: string, refresh: boolean) =>
    request<HistoryResponse>(`/api/lots/${encodeURIComponent(id)}/history`, { method: 'POST', body: JSON.stringify({ refresh }) }),
  market: (id: string) => request<MarketResponse>(`/api/lots/${encodeURIComponent(id)}/market`),
  runMarket: (id: string, refresh: boolean) =>
    request<MarketResponse>(`/api/lots/${encodeURIComponent(id)}/market`, { method: 'POST', body: JSON.stringify({ refresh }) }),
  setMarketSelection: (id: string, listingId: string, included: boolean) =>
    request<{ excludedIds: string[] }>(`/api/lots/${encodeURIComponent(id)}/market/selection`, {
      method: 'PUT',
      body: JSON.stringify({ listingId, included }),
    }),
  makes: () => request<CatalogResponse>('/api/catalog/makes'),
  models: (make: string) => request<CatalogResponse>(`/api/catalog/models?${query({ make })}`),
  aliases: (params: AliasListParams) => request<AliasListResponse>(`/api/aliases?${query({ ...params })}`),
  aliasMakes: (source?: AuctionSource) =>
    request<{ items: { name: string; unassigned: number }[] }>(`/api/aliases/makes?${query({ source })}`),
  aliasCanonical: (params: { kind: AliasKind; make?: string; source?: AuctionSource }) =>
    request<{ items: CanonicalItem[] }>(`/api/aliases/canonical?${query({ ...params })}`),
  aliasSummary: () => request<{ unassigned: Record<AliasKind, number> }>('/api/aliases/summary'),
  changeAliases: (changes: AliasChange[]) =>
    request<{ updated: number }>('/api/aliases/assignment', { method: 'PUT', body: JSON.stringify({ changes }) }),
  aliasScan: () => request<AliasScanStatus>('/api/aliases/scan'),
  startAliasScan: (make?: string) =>
    request<AliasScanStatus>('/api/aliases/scan', { method: 'POST', body: JSON.stringify({ make: make ?? null }) }),
  cancelAliasScan: () => request<AliasScanStatus>('/api/aliases/scan', { method: 'DELETE' }),
  searchLots: (params: LotSearchParams & { page: number; refresh?: boolean }) =>
    request<LotSearchResponse>(
      `/api/lots/search?${query({ ...params, iaaiMarkets: params.iaaiMarkets?.join(','), refresh: params.refresh ? 1 : undefined })}`,
    ),
  lot: (id: string) =>
    request<{ lot: Lot; fetchedAt: string; trackedAt: string | null }>(`/api/lots/${encodeURIComponent(id)}`),
  tracked: () => request<TrackedLotsResponse>('/api/tracked'),
  copartLogin: () => request<CopartLoginStatus>('/api/copart/login'),
  openCopartLogin: () => request<CopartLoginStatus>('/api/copart/login', { method: 'POST' }),
  track: (id: string) =>
    request<{ lotId: string; trackedAt: string }>(`/api/tracked/${encodeURIComponent(id)}`, { method: 'PUT' }),
  untrack: (id: string) => request<null>(`/api/tracked/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
