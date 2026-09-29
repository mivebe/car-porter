import { describe, expect, it } from 'vitest';
import { validateFilters, type FilterDraft } from './validate-filters';

const draft: FilterDraft = { make: 'Toyota', model: 'Camry', yearFrom: '2018', yearTo: '2020', trim: '', iaaiMarkets: ['us'], bodyStyle: '', transmission: '', engine: '', damage: [], condition: '', keys: '' };

describe('validateFilters', () => {
  it('returns parsed params for valid input', () => {
    expect(validateFilters({ ...draft, make: ' Toyota ' })).toEqual({
      params: { make: 'Toyota', model: 'Camry', yearFrom: 2018, yearTo: 2020, iaaiMarkets: ['us'] },
    });
  });

  it('passes a trim only when set, and the IAAI markets', () => {
    expect(validateFilters({ ...draft, trim: ' ZL1 ', iaaiMarkets: ['us', 'ca'] })).toEqual({
      params: { make: 'Toyota', model: 'Camry', yearFrom: 2018, yearTo: 2020, trim: 'ZL1', iaaiMarkets: ['us', 'ca'] },
    });
  });

  it('passes body style, transmission and engine liters', () => {
    expect(validateFilters({ ...draft, bodyStyle: 'Coupe', transmission: 'manual', engine: '6,2' })).toEqual({
      params: { make: 'Toyota', model: 'Camry', yearFrom: 2018, yearTo: 2020, iaaiMarkets: ['us'], bodyStyle: 'Coupe', transmission: 'manual', engine: '6.2' },
    });
    expect(validateFilters({ ...draft, engine: '2' })).toMatchObject({ params: { engine: '2.0' } });
    for (const engine of ['6.2L', '0', 'abc', '123']) {
      expect(validateFilters({ ...draft, engine })).toEqual({ errors: { engine: 'search.errors.engineInvalid' } });
    }
  });

  it('passes damage, condition and keys only when set', () => {
    expect(validateFilters({ ...draft, damage: ['front', 'hail'], condition: 'starts', keys: 'yes' })).toMatchObject({
      params: { damage: ['front', 'hail'], condition: 'starts', keys: true },
    });
    expect(validateFilters({ ...draft, keys: 'no' })).toMatchObject({ params: { keys: false } });
    const { params } = validateFilters(draft) as { params: object };
    expect(params).not.toHaveProperty('damage');
    expect(params).not.toHaveProperty('condition');
    expect(params).not.toHaveProperty('keys');
  });

  it('allows a single year (from = to)', () => {
    expect(validateFilters({ ...draft, yearFrom: '2019', yearTo: '2019' })).toHaveProperty('params');
  });

  it('searches without make and model, but needs valid years when given', () => {
    expect(validateFilters({ ...draft, make: '', model: '', yearFrom: '', yearTo: '' })).toEqual({
      params: { iaaiMarkets: ['us'] },
    });
    expect(validateFilters({ ...draft, make: 'Toyota', model: '', trim: 'SE' })).toEqual({
      params: { make: 'Toyota', yearFrom: 2018, yearTo: 2020, iaaiMarkets: ['us'] },
    });
    expect(validateFilters({ ...draft, make: '', yearTo: '12' })).toEqual({
      errors: { yearTo: 'search.errors.yearInvalid' },
    });
  });

  it('drops a model or trim left without a make or model', () => {
    expect(validateFilters({ ...draft, make: '', trim: 'SE' })).toEqual({
      params: { yearFrom: 2018, yearTo: 2020, iaaiMarkets: ['us'] },
    });
  });

  it('leaves out years that are not chosen', () => {
    expect(validateFilters({ ...draft, yearFrom: '', yearTo: '' })).toEqual({
      params: { make: 'Toyota', model: 'Camry', iaaiMarkets: ['us'] },
    });
    expect(validateFilters({ ...draft, yearTo: '' })).toMatchObject({ params: { yearFrom: 2018 } });
  });

  it('rejects year ranges in the wrong order', () => {
    expect(validateFilters({ ...draft, yearFrom: '2021', yearTo: '2020' })).toEqual({
      errors: { yearTo: 'search.errors.yearOrder' },
    });
  });
});
