import { describe, expect, it } from 'vitest';
import { addExactFilter, applyFilters, defaultFilterRules, isColumnFiltered, toggleExactFilter } from '../src/shared/filters';

describe('filters', () => {
  it('filters default sensitive columns', () => {
    const rules = defaultFilterRules();
    expect(isColumnFiltered('email', rules)).toBe(true);
    expect(isColumnFiltered('Staff Email Address', rules)).toBe(true);
    expect(isColumnFiltered('safe_count', rules)).toBe(false);
  });

  it('replaces non-null sensitive values with column marker', () => {
    const result = applyFilters(
      {
        columns: [{ name: 'email' }, { name: 'safe_count' }],
        rows: [{ email: 'a@example.com', safe_count: 3 }],
        rowCount: 1,
        durationMs: 4,
      },
      defaultFilterRules(),
    );
    expect(result.filteredColumns).toEqual(['email']);
    expect(result.rows[0]).toEqual({ email: '[email]', safe_count: 3 });
  });

  it('honors per-tab exempt columns', () => {
    const result = applyFilters(
      {
        columns: [{ name: 'email' }, { name: 'name' }, { name: 'safe_count' }],
        rows: [{ email: 'a@example.com', name: 'Ada', safe_count: 3 }],
        rowCount: 1,
        durationMs: 4,
      },
      defaultFilterRules(),
      ['name'],
    );
    expect(result.filteredColumns).toEqual(['email']);
    expect(result.rows[0]).toEqual({ email: '[email]', name: 'Ada', safe_count: 3 });
  });

  it('adds exact filters without duplicates', () => {
    const once = addExactFilter([], 'custom');
    const twice = addExactFilter(once, 'CUSTOM');
    expect(twice).toHaveLength(1);
    expect(isColumnFiltered('custom', twice)).toBe(true);
  });

  it('toggles exact filters off when clicked again', () => {
    const enabled = toggleExactFilter([], 'accidental_column');
    expect(isColumnFiltered('accidental_column', enabled)).toBe(true);
    const disabled = toggleExactFilter(enabled, 'accidental_column');
    expect(isColumnFiltered('accidental_column', disabled)).toBe(false);
  });
});
