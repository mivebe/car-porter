import type { EstimateResponse } from '@/features/lot/estimate-hooks';
import type { HistoryResponse } from '@/features/lot/history-hooks';
import type { AuctionSource, Lot, LotInputs, LotInputsPatch, Settings, SettingsPatch, SourceErrorInfo } from '@car-porter/core';

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
}

export interface FxResponse {
  usdToEur: number;
  source: 'ecb' | 'override';
  ecb: { usdToEur: number; date: string; fetchedAt: string; stale: boolean } | null;
  error?: SourceErrorInfo;
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
  makes: () => request<CatalogResponse>('/api/catalog/makes'),
  models: (make: string) => request<CatalogResponse>(`/api/catalog/models?${query({ make })}`),
  searchLots: (params: LotSearchParams & { page: number; refresh?: boolean }) =>
    request<LotSearchResponse>(`/api/lots/search?${query({ ...params, refresh: params.refresh ? 1 : undefined })}`),
  lot: (id: string) => request<{ lot: Lot; fetchedAt: string }>(`/api/lots/${encodeURIComponent(id)}`),
};
