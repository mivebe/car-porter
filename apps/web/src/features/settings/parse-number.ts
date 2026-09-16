/**
 * "30,000" / "30 000" / "1500.5" / "0,92" → number; empty → null; anything else → NaN (flagged by
 * validation). Commas grouping thousands ("1,500") are separators, any other comma is a decimal point.
 */
export function parseNumberInput(text: string): number | null {
  // \s includes non-breaking spaces (bg-BG number grouping)
  const compact = text.replace(/\s/g, '');
  if (compact === '') return null;
  const thousands = compact.includes('.') || /^[1-9]\d{0,2}(,\d{3})+$/.test(compact);
  const normalized = thousands ? compact.replace(/,/g, '') : compact.replace(',', '.');
  return /^\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : Number.NaN;
}
