import fs from 'node:fs';
import type { FilterRule } from '../src/shared/types.js';
import { defaultFilterRules } from '../src/shared/filters.js';
import { configDirectory, filtersPath, legacyFiltersPath } from './paths.js';

export function loadFilters(): FilterRule[] {
  if (!fs.existsSync(filtersPath) && fs.existsSync(legacyFiltersPath)) {
    try {
      const legacy = JSON.parse(fs.readFileSync(legacyFiltersPath, 'utf8')) as FilterRule[];
      if (Array.isArray(legacy)) {
        saveFilters(legacy);
        return legacy;
      }
    } catch {
      // Invalid legacy state is ignored in favor of safe defaults.
    }
  }
  if (!fs.existsSync(filtersPath)) return defaultFilterRules();
  try {
    const parsed = JSON.parse(fs.readFileSync(filtersPath, 'utf8')) as FilterRule[];
    return Array.isArray(parsed) ? parsed : defaultFilterRules();
  } catch {
    return defaultFilterRules();
  }
}

export function saveFilters(filters: FilterRule[]): void {
  fs.mkdirSync(configDirectory, { recursive: true, mode: 0o700 });
  fs.chmodSync(configDirectory, 0o700);
  fs.writeFileSync(filtersPath, JSON.stringify(filters, null, 2), { mode: 0o600 });
  fs.chmodSync(filtersPath, 0o600);
}
