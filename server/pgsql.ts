import type { InspectRequest, InspectResult } from '../src/shared/types.js';
import { resolveConnection } from './pgadmin.js';
import { runReadOnlyQuery } from './queryRunner.js';

export async function inspectStructure(request: InspectRequest): Promise<InspectResult> {
  const connection = await resolveConnection(request.profile, request.database);
  const wantsAll = request.kinds.includes('all');
  const result: InspectResult = {
    profile: connection.name || request.profile,
    database: connection.database,
    schema: request.schema,
  };

  if (wantsAll || request.kinds.includes('schemas')) {
    const query = await runReadOnlyQuery(connection, `
      select n.nspname as schema
      from pg_catalog.pg_namespace n
      where n.nspname <> 'information_schema' and n.nspname !~ '^pg_'
      order by n.nspname
    `);
    result.schemas = query.rows.map((row) => String(row.schema));
  }
  if (wantsAll || request.kinds.includes('tables')) {
    result.tables = (await runReadOnlyQuery(connection, `
      select n.nspname as schema, c.relname as name,
             case c.relkind when 'p' then 'partitioned_table' else 'table' end as type
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p') and n.nspname <> 'information_schema' and n.nspname !~ '^pg_'
        and ($1::text is null or n.nspname = $1)
      order by n.nspname, c.relname
    `, [request.schema ?? null])).rows;
  }
  if (wantsAll || request.kinds.includes('views')) {
    result.views = (await runReadOnlyQuery(connection, `
      select n.nspname as schema, c.relname as name,
             case c.relkind when 'm' then 'materialized_view' else 'view' end as type
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('v', 'm') and n.nspname <> 'information_schema' and n.nspname !~ '^pg_'
        and ($1::text is null or n.nspname = $1)
      order by n.nspname, c.relname
    `, [request.schema ?? null])).rows;
  }
  if (request.kinds.includes('columns')) {
    result.columns = (await runReadOnlyQuery(connection, `
      select table_schema as schema, table_name as table, column_name as column,
             ordinal_position, data_type, is_nullable
      from information_schema.columns
      where table_schema <> 'information_schema' and table_schema not like 'pg\\_%'
        and ($1::text is null or table_schema = $1)
      order by table_schema, table_name, ordinal_position
    `, [request.schema ?? null])).rows;
  }
  return result;
}
