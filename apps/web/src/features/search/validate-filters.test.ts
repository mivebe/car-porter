import { describe, expect, it } from 'vitest';
import { validateFilters, type FilterDraft } from './validate-filters';

const draft: FilterDraft = { make: 'Toyota', model: 'Camry', yearFrom: '2018', yearTo: '2020', trim: '', iaaiMarkets: ['us'], bodyStyle: '', transmission: '', engine: '' };

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

  it('allows a single year (from = to)', () => {
    expect(validateFilters({ ...draft, yearFrom: '2019', yearTo: '2019' })).toHaveProperty('params');
  });

  it('requires make and model, and valid years when given', () => {
    expect(validateFilters({ ...draft, make: '', model: '', yearFrom: '', yearTo: '12' })).toEqual({
      errors: {
        make: 'search.errors.makeRequired',
        model: 'search.errors.modelRequired',
        yearTo: 'search.errors.yearInvalid',
      },
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
