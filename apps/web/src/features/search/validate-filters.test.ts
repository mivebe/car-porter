import { describe, expect, it } from 'vitest';
import { validateFilters } from './validate-filters';

const draft = { make: 'Toyota', model: 'Camry', yearFrom: '2018', yearTo: '2020' };

describe('validateFilters', () => {
  it('returns parsed params for valid input', () => {
    expect(validateFilters({ ...draft, make: ' Toyota ' })).toEqual({
      params: { make: 'Toyota', model: 'Camry', yearFrom: 2018, yearTo: 2020 },
    });
  });

  it('allows a single year (from = to)', () => {
    expect(validateFilters({ ...draft, yearFrom: '2019', yearTo: '2019' })).toHaveProperty('params');
  });

  it('requires make, model and valid years', () => {
    expect(validateFilters({ make: '', model: '', yearFrom: '', yearTo: '12' })).toEqual({
      errors: {
        make: 'search.errors.makeRequired',
        model: 'search.errors.modelRequired',
        yearFrom: 'search.errors.yearInvalid',
        yearTo: 'search.errors.yearInvalid',
      },
    });
  });

  it('rejects year ranges in the wrong order', () => {
    expect(validateFilters({ ...draft, yearFrom: '2021', yearTo: '2020' })).toEqual({
      errors: { yearTo: 'search.errors.yearOrder' },
    });
  });
});
