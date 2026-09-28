import { normalizeText, type Transmission } from './matching.ts';
import type { AliasMapping } from './vehicle-aliases.ts';

/** Our body styles; site body names are mapped onto these (plus any the user creates). */
export const BODY_STYLES = ['Sedan', 'Coupe', 'Convertible', 'Hatchback', 'Wagon', 'SUV', 'Pickup', 'Van'] as const;

/**
 * Words that name a body style, checked in order: "Extended Sport Van" is a van, "Sport Utility
 * Truck" a pickup and "Sports Activity Coupe" (BMW X6) an SUV. Copart cuts names at 8 letters
 * ("CONVERTI", "HATCHBAC", "4DR SPOR", "SPORTS V"), so the cut forms are listed too.
 */
const WORD_RULES: [string, RegExp][] = [
  ['Van', /\b(van|minivan|mini van|sports v|cargo va)\b/],
  ['Convertible', /\b(convertible|converti|cabriolet|cabrio|roadster|road|spyder|spider)\b/],
  [
    'Pickup',
    /\b(pickup|pic|crew|crewmax|supercrew|supercab|styleside|flareside|sport utility truck|sport ut truck|4dr ext|(access|club|crew|double|extended|king|mega|quad|regular|single|standard|super) cab)\b/,
  ],
  ['SUV', /\b(sport utility|sport utility vehicl|suv|utility|sports activity|spor)\b/],
  ['Wagon', /\b(wagon|station|estate)\b/],
  ['Hatchback', /\b(hatchback|hatchbac|hatch|liftback|sportback)\b/],
  ['Coupe', /\b(coupe|fastback)\b/],
  ['Sedan', /\b(sedan|saloon|passengercar)\b/],
];

/** Names that only give the door count: "2-Door", "SEDAN 4D" is already a sedan by word. */
const DOOR_RULES: [string, RegExp][] = [
  ['Coupe', /\b2 ?(d|dr|door)\b/],
  ['Hatchback', /\b[35] ?(d|dr|door)\b/],
  ['Sedan', /\b4 ?(d|dr|door)\b/],
];

function ruleBodyStyle(external: string): string | null {
  const text = normalizeText(external);
  for (const rules of [WORD_RULES, DOOR_RULES]) {
    const hit = rules.find(([, re]) => re.test(text));
    if (hit) return hit[0];
  }
  return null;
}

/**
 * Maps each site body name to at most one of ours: exact (same name, e.g. a user-made
 * "Crew Cab") > rule (the words above, only for body styles in `canonical`).
 */
export function mapBodyStyles(canonical: string[], externals: string[]): AliasMapping[] {
  const byKey = new Map(canonical.map((c) => [normalizeText(c), c]));
  return externals.map((external) => {
    const exact = byKey.get(normalizeText(external));
    if (exact) return { external, canonical: exact, match: 'exact' };
    const rule = ruleBodyStyle(external);
    const target = rule ? byKey.get(normalizeText(rule)) : undefined;
    return target ? { external, canonical: target, match: 'rule' } : { external, canonical: null, match: null };
  });
}

/**
 * Engine displacement in liters with one decimal, from a site's engine value: Copart "6.2L 8",
 * "2  L  4", "2.359737216L 4"; IAAI "6.2 L", "5L". null for "0.0L 0" and unreadable values.
 */
export function siteEngineLiters(value: string): string | null {
  const m = value.trim().match(/^(\d{1,2}(?:\.\d+)?)(?:\s*l\b|\s|$)/i);
  const liters = m ? Math.round(Number(m[1]) * 10) / 10 : 0;
  return liters > 0 && liters < 20 ? liters.toFixed(1) : null;
}

export const TRANSMISSIONS: readonly Transmission[] = ['automatic', 'manual'];

/**
 * Primary damage groups, filtered by in each site's own values: Copart's damage codes and IAAI's
 * damage names (see the adapters). Side corners ("Left Front") count as front or rear, "Front &
 * Rear" as both.
 */
export const DAMAGE_TYPES = [
  'front',
  'rear',
  'side',
  'allOver',
  'rollover',
  'roof',
  'undercarriage',
  'frame',
  'mechanical',
  'hail',
  'water',
  'fire',
  'vandalism',
  'biohazard',
  'minor',
] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];

/**
 * How far a lot was verified to work at check-in, the same meaning on both sites:
 * - runsDrives: Copart "Run and Drive" (CERT-D) = IAAI "Run & Drive": the engine starts, the
 *   transmission engages and the car moves under its own power;
 * - starts: Copart "Engine Start Program" (CERT-S) = IAAI "Starts": the engine starts, driving was
 *   not verified.
 * Anything else (Copart "Enhanced Vehicles" or no program, IAAI "Stationary" / "Can't Test") claims
 * nothing. As a filter it is a minimum: "starts" also finds lots that run and drive.
 */
export const LOT_CONDITIONS = ['starts', 'runsDrives'] as const;
export type LotCondition = (typeof LOT_CONDITIONS)[number];
