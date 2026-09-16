const TRANSLITERATION: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

export interface VinCheck {
  normalized: string;
  /** 17 chars, only allowed characters (no I, O, Q), not masked. */
  valid: boolean;
  /** Contains mask characters such as `*`. */
  masked: boolean;
  /**
   * North-American check digit (position 9). Only a warning: non-US VINs often don't use it.
   * null when the VIN isn't structurally valid.
   */
  checkDigitValid: boolean | null;
}

export function normalizeVin(vin: string): string {
  return vin.replace(/[\s-]/g, '').toUpperCase();
}

export function checkVin(input: string): VinCheck {
  const normalized = normalizeVin(input);
  const masked = /[*#_?]/.test(normalized);
  const valid = !masked && /^[A-HJ-NPR-Z0-9]{17}$/.test(normalized);
  if (!valid) return { normalized, valid, masked, checkDigitValid: null };

  const sum = [...normalized].reduce((acc, ch, i) => {
    const value = /\d/.test(ch) ? Number(ch) : TRANSLITERATION[ch]!;
    return acc + value * WEIGHTS[i]!;
  }, 0);
  const remainder = sum % 11;
  const expected = remainder === 10 ? 'X' : String(remainder);
  return { normalized, valid, masked, checkDigitValid: normalized[8] === expected };
}

/** Picks the VIN to use: a valid user-pasted override wins over the lot's (possibly masked) VIN. */
export function effectiveVin(lotVin: string | null, override: string | null): string | null {
  if (override && checkVin(override).valid) return normalizeVin(override);
  if (lotVin && checkVin(lotVin).valid) return normalizeVin(lotVin);
  return null;
}
