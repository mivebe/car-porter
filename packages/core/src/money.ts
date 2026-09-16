const EPSILON = 1e-9;

/** Rounds half away from zero, tolerant of binary float noise (e.g. 0.285 * 100). */
export function roundHalfUp(value: number): number {
  const sign = value < 0 ? -1 : 1;
  return sign * Math.floor(Math.abs(value) + 0.5 + EPSILON);
}

export function toCents(amount: number): number {
  return roundHalfUp(amount * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

/** Converts cents between currencies with a rate (e.g. USD→EUR 0.9). */
export function convertCents(cents: number, rate: number): number {
  return roundHalfUp(cents * rate);
}

export function sumCents(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
