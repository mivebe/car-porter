const intlLocale = (language: string) => (language === 'bg' ? 'bg-BG' : 'en-US');

export function formatMoney(
  cents: number | null | undefined,
  currency: 'USD' | 'EUR',
  language: string,
  options: { decimals?: boolean } = {},
): string {
  if (cents == null) return '—';
  const digits = options.decimals ? 2 : 0;
  return new Intl.NumberFormat(intlLocale(language), {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(cents / 100);
}

const numberFormats = new Map<string, Intl.NumberFormat>();

export function formatNumber(value: number | null | undefined, language: string): string {
  if (value == null) return '—';
  const locale = intlLocale(language);
  let format = numberFormats.get(locale);
  if (!format) numberFormats.set(locale, (format = new Intl.NumberFormat(locale)));
  return format.format(value);
}

export function formatDateTime(iso: string | null | undefined, language: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(intlLocale(language), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatDate(iso: string | null | undefined, language: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(intlLocale(language), { day: 'numeric', month: 'short', year: 'numeric' }).format(
    date,
  );
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** "5 minutes ago" / "преди 5 минути"; under a minute → "now". */
export function formatRelative(iso: string | null | undefined, language: string, now = new Date()): string {
  if (!iso) return '—';
  const seconds = Math.round((new Date(iso).getTime() - now.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(intlLocale(language), { numeric: 'auto' });
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.trunc(seconds / size), unit);
  }
  return rtf.format(0, 'second');
}

/** "REAR END" → "Rear end"; for descriptive values (damage, fuel, title) rather than names. */
export function sentenceCase(value: string | null | undefined): string {
  if (!value) return '';
  const lower = value.toLowerCase();
  return value === value.toUpperCase() ? lower.charAt(0).toUpperCase() + lower.slice(1) : value;
}

/** "TOYOTA CAMRY" → "Toyota Camry"; keeps short all-caps tokens like "SE", "BMW", "XSE V6". */
export function titleCase(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .split(/\s+/)
    .map((word) => (word.length <= 3 || /\d/.test(word) ? word : word.charAt(0) + word.slice(1).toLowerCase()))
    .join(' ');
}
