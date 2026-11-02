// pgtest-seed.ts — seed a row into the REAL migrated schema, filling whatever NOT NULL columns it demands. Written after
// three producer pgtests seeded technicians with a column that does not exist (`display_name`) behind `.catch(() => {})`:
// the insert failed silently and two of them passed without a technician at all.
export async function seedRow(pg: any, table: string, values: Record<string, unknown>): Promise<void> {
  const cols = (await pg.query(`select column_name, data_type from information_schema.columns where table_name = $1 and is_nullable = 'NO' and column_default is null`, [table])).rows;
  const v: Record<string, unknown> = { ...values };
  for (const c of cols) if (!(c.column_name in v)) v[c.column_name] = /uuid/.test(c.data_type) ? crypto.randomUUID() : /int|numeric/.test(c.data_type) ? 0 : /bool/.test(c.data_type) ? false : /timestamp|date/.test(c.data_type) ? new Date().toISOString() : 'x';
  const keys = Object.keys(v);
  await pg.query(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map((_, i) => '$' + (i + 1)).join(', ')}) ON CONFLICT DO NOTHING`, keys.map((k) => v[k]));
}
export const seedTechnician = (pg: any, id: string, tenantId: string, branchId: string) =>
  seedRow(pg, 'technicians', { id, tenant_id: tenantId, branch_id: branchId, first_name: 'Tia', last_name: 'Tran', full_name: 'Tia Tran' });
