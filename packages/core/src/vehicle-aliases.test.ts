import { describe, expect, it } from 'vitest';
import { editDistance, externalNamesFor, mapMakes, mapModels, modelTokens } from './vehicle-aliases.ts';

// NHTSA names (the canonical catalog), trimmed to what the cases need
const MAKES = ['Mercedes-Benz', 'Mercury', 'Toyota', 'Chevrolet', 'Nissan', 'Ram', 'Dodge', 'BMW', 'Mazda', 'Land Rover'];
const MERCEDES = [
  'Sprinter', 'SL-Class', 'SLK-Class', 'E-Class', 'CLS-Class', 'CLA-Class', 'GLA-Class', 'C-Class', 'S-Class',
  'SLS-Class', 'B-Class', 'M-Class', 'GL-Class', 'G-Class', 'GLK-Class', 'CL-Class', 'CLK-Class', 'AMG GT',
  'GLC-Class', 'GLE-Class', 'Metris', 'SLC-Class', 'ML-Class', 'GLS-Class', '300', 'A-Class', 'GLB-Class',
  'EQS-Class Sedan', 'EQS-Class SUV', 'eSprinter', 'CLE',
];
const TOYOTA = ['Corolla', 'Prius', 'RAV4', 'Camry', 'Camry Solara', 'Corolla Cross', 'Prius Prime (PHEV)', 'C-HR', 'GR86', '86'];

// real values from the sites' search facets (2026-09-17)
const IAAI_MERCEDES = [
  'AMG C 43', 'AMG C 63', 'AMG CLA 45', 'AMG GLE 43 COUPE', 'AMG GT 63 4-DOOR COUPE', 'C', 'C 300', 'C 350E',
  'C 450 AMG', 'C 63 AMG', 'C-CLASS', 'C240', 'C300 4MATIC', 'CLA 250', 'CLE 300', 'CLK 350', 'CLS 550',
  'E 350', 'GLE 450 COUPE', 'GT S AMG', 'ESPRINTER 2500', 'SPRINTER 2500', '300 SERIES', 'EQS 450+ SUV',
];
const COPART_MERCEDES = ['C', 'C-CLASS', 'C CLASS C300 4D SPOR', 'C-CLASS C300 4MATIC', 'CLA', 'CLS', 'GLC COUPE', 'AMG GT', '300 C'];

const canonicalOf = (rows: ReturnType<typeof mapModels>, external: string) =>
  rows.filter((r) => r.external === external).map((r) => r.canonical);

describe('mapMakes', () => {
  it('ties spelling variants, abbreviations and typos to one canonical make', () => {
    const rows = mapMakes(MAKES, [
      'MERCEDES-BENZ', 'MERCEDES BENZ', 'MERCEDES', 'MERC', 'MERCERDES', 'MERCEDES-BENZ- C300', 'MERCURY',
      'CHEV', 'NISS', 'RAM TRUCKS', 'LAND ROVER', 'TOYO', 'GREAT DANE',
    ]);
    expect(Object.fromEntries(rows.map((r) => [r.external, [r.canonical, r.match]]))).toEqual({
      'MERCEDES-BENZ': ['Mercedes-Benz', 'exact'],
      'MERCEDES BENZ': ['Mercedes-Benz', 'exact'],
      MERCEDES: ['Mercedes-Benz', 'exact'],
      MERC: ['Mercedes-Benz', 'exact'],
      MERCERDES: ['Mercedes-Benz', 'fuzzy'],
      'MERCEDES-BENZ- C300': ['Mercedes-Benz', 'rule'],
      MERCURY: ['Mercury', 'exact'],
      CHEV: ['Chevrolet', 'exact'],
      NISS: ['Nissan', 'rule'],
      'RAM TRUCKS': ['Ram', 'rule'],
      'LAND ROVER': ['Land Rover', 'exact'],
      TOYO: ['Toyota', 'rule'],
      'GREAT DANE': [null, null],
    });
  });
});

describe('mapModels', () => {
  it('expands a Mercedes class to every IAAI spelling of it, and nothing else', () => {
    const rows = mapModels('Mercedes-Benz', MERCEDES, IAAI_MERCEDES);
    expect(externalNamesFor(rows, 'C-Class').sort()).toEqual(
      ['AMG C 43', 'AMG C 63', 'C', 'C 300', 'C 350E', 'C 450 AMG', 'C 63 AMG', 'C-CLASS', 'C240', 'C300 4MATIC'].sort(),
    );
    expect(canonicalOf(rows, 'GLE 450 COUPE')).toEqual(['GLE-Class']);
    expect(canonicalOf(rows, 'AMG GLE 43 COUPE')).toEqual(['GLE-Class']);
    expect(canonicalOf(rows, 'GT S AMG')).toEqual(['AMG GT']);
    expect(canonicalOf(rows, 'AMG GT 63 4-DOOR COUPE')).toEqual(['AMG GT']);
    expect(canonicalOf(rows, 'ESPRINTER 2500')).toEqual(['eSprinter']);
    expect(canonicalOf(rows, 'SPRINTER 2500')).toEqual(['Sprinter']);
    expect(canonicalOf(rows, '300 SERIES')).toEqual(['300']);
    expect(canonicalOf(rows, 'EQS 450+ SUV')).toEqual([null]); // NHTSA splits EQS into Sedan/SUV
  });

  it('handles Copart model spellings', () => {
    const rows = mapModels('Mercedes-Benz', MERCEDES, COPART_MERCEDES);
    expect(externalNamesFor(rows, 'c-class').sort()).toEqual(['C', 'C CLASS C300 4D SPOR', 'C-CLASS', 'C-CLASS C300 4MATIC']);
    expect(canonicalOf(rows, 'GLC COUPE')).toEqual(['GLC-Class']);
    expect(canonicalOf(rows, '300 C')).toEqual(['300']);
  });

  it('tolerates punctuation and typos, preferring the most specific model', () => {
    const rows = mapModels('Toyota', TOYOTA, [
      'Camry', 'Camary', 'Camray', 'Camry Solara', 'Camry Hybrid', 'Carolla', 'Corola', 'Coroalla', 'Corolla Cross',
      'Corola Cross', 'Rav 4', 'Rav-4', 'Rav4 Hybrid', 'Prius Prime', 'C-hr', 'Gr 86', 'Gr86', '86',
    ]);
    expect(externalNamesFor(rows, 'Camry')).toEqual(['Camry', 'Camary', 'Camray', 'Camry Hybrid']);
    expect(externalNamesFor(rows, 'Camry Solara')).toEqual(['Camry Solara']);
    expect(externalNamesFor(rows, 'Corolla')).toEqual(['Carolla', 'Corola', 'Coroalla']);
    expect(externalNamesFor(rows, 'Corolla Cross')).toEqual(['Corolla Cross', 'Corola Cross']);
    expect(externalNamesFor(rows, 'RAV4')).toEqual(['Rav 4', 'Rav-4', 'Rav4 Hybrid']);
    expect(externalNamesFor(rows, 'Prius Prime (PHEV)')).toEqual(['Prius Prime']);
    expect(externalNamesFor(rows, 'C-HR')).toEqual(['C-hr']);
    expect(externalNamesFor(rows, 'GR86')).toEqual(['Gr 86', 'Gr86']);
    expect(externalNamesFor(rows, '86')).toEqual(['86']);
  });

  it('puts BMW three-digit names under their series as well as their own model', () => {
    const rows = mapModels('BMW', ['3 Series', '330i', 'M3', '5 Series', 'X5'], ['330I', '328D', 'M340I', '3 SERIES', 'M3', '530I', 'X5 M']);
    expect(externalNamesFor(rows, '3 Series')).toEqual(['330I', '328D', 'M340I', '3 SERIES']);
    expect(externalNamesFor(rows, '330i')).toEqual(['330I']);
    expect(externalNamesFor(rows, 'M3')).toEqual(['M3']);
    expect(externalNamesFor(rows, 'X5')).toEqual(['X5 M']);
  });

  it('falls back to a missing suffix letter or an extra leading word', () => {
    const bmw = mapModels('BMW', ['530i', '530e', '540i', 'X5'], ['530', '540', 'X5']);
    expect(canonicalOf(bmw, '530')).toEqual(['530i', '530e']);
    expect(canonicalOf(bmw, '540')).toEqual(['540i']);
    const toyota = mapModels('Toyota', TOYOTA.concat('Supra'), ['GR SUPRA', 'GR86', 'SUPRA']);
    expect(externalNamesFor(toyota, 'Supra')).toEqual(['GR SUPRA', 'SUPRA']);
    expect(canonicalOf(toyota, 'GR86')).toEqual(['GR86']);
  });

  it('drops a leading make name', () => {
    expect(modelTokens('MAZDA3', 'Mazda')).toEqual(['3']);
    expect(modelTokens('Range Rover Sport', 'Land Rover')).toEqual(['range', 'rover', 'sport']);
  });
});

describe('editDistance', () => {
  it('counts transpositions as one edit and stops past the cap', () => {
    expect(editDistance('camry', 'camyr')).toBe(1);
    expect(editDistance('corolla', 'coroalla')).toBe(1);
    expect(editDistance('abc', 'xyzabc', 2)).toBe(3);
  });
});
