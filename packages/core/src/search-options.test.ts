import { describe, expect, it } from 'vitest';
import { BODY_STYLES, siteEngineLiters, mapBodyStyles } from './search-options.ts';

const ours = [...BODY_STYLES];
const mapped = (externals: string[], canonical = ours) =>
  Object.fromEntries(mapBodyStyles(canonical, externals).map((m) => [m.external, m.canonical]));

describe('mapBodyStyles', () => {
  // real facet values (2026-09-18)
  it('maps Copart body names, including its 8-letter cuts', () => {
    expect(
      mapped([
        'SEDAN 4DR', 'SEDAN 4D', 'Sedan', 'COUPE 3D', 'CONVERTI', 'HATCHBAC', 'HATCHBACK 4DR', '4DR SPOR',
        'SPORT UTILITY VEHICLE (SUV)', 'SPORTS V', 'MINI-VAN', 'VAN PASSENGER', 'STATION', 'WAGON', 'CREW PIC',
        '4DR EXT CAB PICKUP', 'CLUB CAB', 'SPORT UTILITY TRUCK', 'ROADSTER', 'PASSENGERCAR', 'CHASSIS AND CAB',
        'BUS', 'EXTENDED',
      ]),
    ).toEqual({
      'SEDAN 4DR': 'Sedan',
      'SEDAN 4D': 'Sedan',
      Sedan: 'Sedan',
      'COUPE 3D': 'Coupe',
      CONVERTI: 'Convertible',
      HATCHBAC: 'Hatchback',
      'HATCHBACK 4DR': 'Hatchback',
      '4DR SPOR': 'SUV',
      'SPORT UTILITY VEHICLE (SUV)': 'SUV',
      'SPORTS V': 'Van',
      'MINI-VAN': 'Van',
      'VAN PASSENGER': 'Van',
      STATION: 'Wagon',
      WAGON: 'Wagon',
      'CREW PIC': 'Pickup',
      '4DR EXT CAB PICKUP': 'Pickup',
      'CLUB CAB': 'Pickup',
      'SPORT UTILITY TRUCK': 'Pickup',
      ROADSTER: 'Convertible',
      PASSENGERCAR: 'Sedan',
      'CHASSIS AND CAB': null,
      BUS: null,
      EXTENDED: null,
    });
  });

  it('maps IAAI body names and door-count-only names', () => {
    expect(
      mapped([
        'Sedan 4 Dr.', '4Matic Sedan', 'Coupe 2 Door', 'Sports Activity Coupe', 'Quattro Cabriolet', 'Hatchback 5 Door',
        'Wagon 4 Dr.', 'Suv 4 Door', 'Awd Sport Utility', 'Crew Cab', 'Supercrew', 'Regular Cab Styleside',
        'Extended Sport Van', 'Crew Van', '2-Door', '4-Door', '5-Door', 'N/A', 'Chassis',
      ]),
    ).toEqual({
      'Sedan 4 Dr.': 'Sedan',
      '4Matic Sedan': 'Sedan',
      'Coupe 2 Door': 'Coupe',
      'Sports Activity Coupe': 'SUV',
      'Quattro Cabriolet': 'Convertible',
      'Hatchback 5 Door': 'Hatchback',
      'Wagon 4 Dr.': 'Wagon',
      'Suv 4 Door': 'SUV',
      'Awd Sport Utility': 'SUV',
      'Crew Cab': 'Pickup',
      Supercrew: 'Pickup',
      'Regular Cab Styleside': 'Pickup',
      'Extended Sport Van': 'Van',
      'Crew Van': 'Van',
      '2-Door': 'Coupe',
      '4-Door': 'Sedan',
      '5-Door': 'Hatchback',
      'N/A': null,
      Chassis: null,
    });
  });

  it('prefers a same-named body style of the user and skips rules for removed ones', () => {
    expect(mapBodyStyles([...ours, 'Crew Cab'], ['CREW CAB', 'Crew Pickup'])).toEqual([
      { external: 'CREW CAB', canonical: 'Crew Cab', match: 'exact' },
      { external: 'Crew Pickup', canonical: 'Pickup', match: 'rule' },
    ]);
    expect(mapped(['WAGON'], ['Sedan'])).toEqual({ WAGON: null });
  });
});

describe('siteEngineLiters', () => {
  it('reads the displacement from both sites', () => {
    const values = ['6.2L 8', '6.2L  8', '2  L  4', '2.359737216L 4', '2', '6.2 L', '5L', '2.0L', '0.0L 0', '0', 'U', ''];
    expect(values.map(siteEngineLiters)).toEqual(['6.2', '6.2', '2.0', '2.4', '2.0', '6.2', '5.0', '2.0', null, null, null, null]);
  });
});
