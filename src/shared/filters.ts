import type { FilterRule, FilteredResult, QueryResult } from './types.js';

export const DEFAULT_FILTER_PATTERNS = [
  '*password*',
  '*passwd*',
  '*token*',
  '*secret*',
  '*email*',
  '*mail*',
  '*phone*',
  '*telefono*',
  '*tlf*',
  '*user*',
  '*usuario*',
  '*username*',
  '*name*',
  '*nombre*',
  '*address*',
  '*direccion*',
  '*dob*',
  '*birth*',
  '*dni*',
  '*nif*',
  '*id_number*',
];

export function defaultFilterRules(now = new Date()): FilterRule[] {
  return DEFAULT_FILTER_PATTERNS.map((pattern) => ({
    id: `default:${pattern}`,
    pattern,
    mode: 'glob',
    enabled: true,
    createdAt: now.toISOString(),
  }));
}

export function applyFilters(result: QueryResult, rules: FilterRule[], exemptColumns: string[] = []): FilteredResult {
  const exemptSet = new Set(exemptColumns.map((column) => column.toLowerCase()));
  const filteredColumns = result.columns
    .map((column) => column.name)
    .filter((columnName) => !exemptSet.has(columnName.toLowerCase()) && isColumnFiltered(columnName, rules));
  const filteredSet = new Set(filteredColumns);

  return {
    ...result,
    filteredColumns,
    rows: result.rows.map((row) => {
      const next: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        next[key] = filteredSet.has(key) && value !== null && value !== undefined ? `[${key}]` : value;
      }
      return next;
    }),
  };
}

export function isColumnFiltered(columnName: string, rules: FilterRule[]): boolean {
  return rules.some((rule) => {
    if (!rule.enabled || !rule.pattern.trim()) return false;
    const column = columnName.toLowerCase();
    const pattern = rule.pattern.toLowerCase();
    if (rule.mode === 'exact') return column === pattern;
    return globToRegExp(pattern).test(column);
  });
}

export function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

export function addExactFilter(rules: FilterRule[], columnName: string): FilterRule[] {
  const exists = rules.some(
    (rule) => rule.mode === 'exact' && rule.pattern.toLowerCase() === columnName.toLowerCase(),
  );
  if (exists) return rules;
  return [
    ...rules,
    {
      id: `exact:${columnName}:${Date.now()}`,
      pattern: columnName,
      mode: 'exact',
      enabled: true,
      createdAt: new Date().toISOString(),
    },
  ];
}

export function toggleExactFilter(rules: FilterRule[], columnName: string): FilterRule[] {
  const existing = rules.find(
    (rule) => rule.mode === 'exact' && rule.pattern.toLowerCase() === columnName.toLowerCase(),
  );
  if (existing) {
    return rules.filter((rule) => rule.id !== existing.id);
  }
  return addExactFilter(rules, columnName);
}
