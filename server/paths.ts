import os from 'node:os';
import path from 'node:path';

export const projectDir = path.resolve(process.env.PROXYDIABLO_PROJECT_DIR ?? process.cwd());
export const configDirectory = path.join(
  process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'),
  'proxydiablo',
);
export const bridgePath = path.join(configDirectory, 'bridge.json');
export const filtersPath = path.join(configDirectory, 'filters.json');
export const legacyFiltersPath = path.join(
  process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'),
  'pgsqldiablo-ui',
  'filters.json',
);
export const clientDirectory = path.join(projectDir, 'dist');
