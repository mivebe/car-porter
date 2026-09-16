export const SOURCE_ERROR_CODES = [
  'blocked',
  'login_required',
  'parse_failed',
  'timeout',
  'not_found',
  'network',
  'unknown',
] as const;
export type SourceErrorCode = (typeof SOURCE_ERROR_CODES)[number];

export interface SourceErrorInfo {
  code: SourceErrorCode;
  message: string;
}

/** Status of one data source inside a response, rendered as a per-source badge in the UI. */
export type SourceStatus =
  | { source: string; ok: true; fetchedAt: string; fromCache: boolean; stale?: boolean }
  | { source: string; ok: false; error: SourceErrorInfo };
