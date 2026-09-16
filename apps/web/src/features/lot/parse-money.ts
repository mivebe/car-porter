/** "5,000" / "5 000" / "5000.50" → cents; empty → null; invalid → undefined. */
export function parseMoneyInput(text: string): number | null | undefined {
  const cleaned = text.replace(/[\s,$€]/g, '');
  if (cleaned === '') return null;
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return undefined;
  return Math.round(Number(cleaned) * 100);
}
