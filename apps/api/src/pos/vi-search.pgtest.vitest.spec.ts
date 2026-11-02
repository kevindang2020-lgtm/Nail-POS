// vi-search.pgtest — Vietnamese POS mandate WP-E (§40–§42): accent-insensitive POS search against the real migrated schema.
//   * the SQL fold vi_fold() (migration 694) and the TS fold foldVi() (packages/api-contracts) agree character for character
//   * "nguyen" finds "Nguyễn", "dang" finds "Đặng", accented queries still work, stored names stay byte-identical (§42)
//   * another tenant's rows never appear (scoping is unchanged)
//   * the planner can use the vi_fold expression indexes (the index expression matches the query expression)
import { describe, it, expect, beforeAll } from 'vitest';
import { foldVi } from '@aipowersalon/api-contracts';
import { PosSearchKyselyRepository } from './pos-search.kysely.repository';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

const T = '11111111-1111-1111-1111-111111111111';
const B = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const T2 = '22222222-2222-2222-2222-222222222222';
const B2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const scope: any = { tenantId: T, branchId: B };
const otherScope: any = { tenantId: T2, branchId: null };
let pg: any;
let repo: PosSearchKyselyRepository;

const HUONG = 'Nguyễn Thị Hương';
const TUAN = 'Đặng Minh Tuấn';

beforeAll(async () => {
  pg = await migratedPglite();
  const cust = (t: string, b: string, first: string, last: string, full: string, phone: string) =>
    `INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display, status)
       VALUES (gen_random_uuid(),'${t}','${b}','${first}','${last}','${full}','${phone}','${phone}','active');`;
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES
      ('${T}','Glamour Studio LLC','Glamour Studio','glamour','GLAM01','active'),
      ('${T2}','Other Salon LLC','Other Salon','other','OTHR01','active');
    INSERT INTO branches (id, tenant_id, name) VALUES ('${B}','${T}','Downtown'), ('${B2}','${T2}','Elsewhere');
    ${cust(T, B, 'Hương', 'Nguyễn', HUONG, '+16095550101')}
    ${cust(T, B, 'Tuấn', 'Đặng', TUAN, '+16095550102')}
    ${cust(T, B, 'Olivia', 'Brown', 'Olivia Brown', '+16095550103')}
    ${cust(T2, B2, 'Khác', 'Nguyễn', 'Nguyễn Văn Khác', '+16095550104')}
    ${cust(T2, B2, 'Lan', 'Đặng', 'Đặng Thị Lan', '+16095550105')}
  `);
  // technicians / services: insert only the columns every row needs, discovered from the schema (NOT NULL, no default)
  for (const [table, rows] of [
    ['technicians', [{ tenant_id: T, branch_id: B, full_name: 'Đặng Thu Hà', first_name: 'Hà', last_name: 'Đặng' }, { tenant_id: T2, branch_id: B2, full_name: 'Đặng Văn Nam', first_name: 'Nam', last_name: 'Đặng' }]],
    ['services', [{ tenant_id: T, branch_id: B, name: 'Sơn Gel Móng Tay' }, { tenant_id: T2, branch_id: B2, name: 'Sơn Gel Chân' }]],
  ] as const) {
    for (const row of rows) await insertRow(table, row as Record<string, unknown>);
  }
  repo = new PosSearchKyselyRepository(kyselyFor(pg) as any);
}, 120_000);

/** Insert a row filling every required column the test does not care about with a type-appropriate value. */
async function insertRow(table: string, given: Record<string, unknown>) {
  const cols = (await pg.query(`SELECT column_name, data_type, udt_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1 AND is_nullable='NO' AND column_default IS NULL AND is_generated='NEVER'`, [table])).rows as any[];
  const row: Record<string, unknown> = { ...given };
  for (const c of cols) {
    if (c.column_name in row) continue;
    if (c.column_name === 'id') { row.id = crypto.randomUUID(); continue; }
    const t = String(c.data_type);
    if (t === 'uuid') row[c.column_name] = crypto.randomUUID();
    else if (/int|numeric|double|real/.test(t)) row[c.column_name] = 0;
    else if (t === 'boolean') row[c.column_name] = false;
    else if (/timestamp|date/.test(t)) row[c.column_name] = new Date().toISOString();
    else if (/json/.test(t)) row[c.column_name] = '{}';
    else if (t === 'ARRAY') row[c.column_name] = '{}';
    else row[c.column_name] = 'x';
  }
  const keys = Object.keys(row);
  await pg.query(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`, keys.map((k) => row[k]));
}

describe('vi_fold (SQL) agrees with foldVi (TS)', () => {
  it('for every Vietnamese letter and every Latin letter with a diacritic in U+00C0–U+024F / U+1E00–U+1EFF', async () => {
    const chars: string[] = [];
    for (const [a, b] of [[0xc0, 0x24f], [0x1e00, 0x1eff]]) for (let c = a; c <= b; c++) {
      const ch = String.fromCodePoint(c);
      if (/^[A-Za-z]$/.test(ch.normalize('NFD').replace(/[̀-ͯ]/g, ''))) chars.push(ch);
    }
    chars.push('Đ', 'đ');
    const r = await pg.query(`SELECT s, vi_fold(s) AS f FROM unnest($1::text[]) AS s`, [chars]);
    const mismatches = (r.rows as any[]).filter((x) => x.f !== foldVi(x.s)).map((x) => `${x.s}: sql=${x.f} ts=${foldVi(x.s)}`);
    expect(mismatches).toEqual([]);
    expect(r.rows.length).toBe(chars.length);
  });

  it('for Vietnamese names (precomposed and decomposed), mixed case and messy whitespace', async () => {
    const names = [HUONG, TUAN, 'ĐOÀN THỊ ỬNG', '  Trần   Văn\tẤn ', 'Phạm Quỳnh Như', HUONG.normalize('NFD'), TUAN.normalize('NFD'), 'Olivia Brown', ''];
    const r = await pg.query(`SELECT s, vi_fold(s) AS f FROM unnest($1::text[]) WITH ORDINALITY AS u(s, i) ORDER BY i`, [names]);
    expect((r.rows as any[]).map((x) => x.f)).toEqual(names.map(foldVi));
    expect((await pg.query(`SELECT vi_fold('Nguyễn') AS a, vi_fold('Đặng') AS b`)).rows[0]).toEqual({ a: 'nguyen', b: 'dang' });
  });

  it('is IMMUTABLE (so it can back an index)', async () => {
    const r = await pg.query(`SELECT provolatile FROM pg_proc WHERE proname = 'vi_fold'`);
    expect((r.rows as any[]).map((x) => x.provolatile)).toEqual(['i']);
  });
});

describe('POS global search — accent-insensitive', () => {
  it('"nguyen" finds "Nguyễn Thị Hương"; "dang" finds "Đặng Minh Tuấn"', async () => {
    expect((await repo.customers(scope, 'nguyen', 10)).map((r) => r.title)).toEqual([HUONG]);
    expect((await repo.customers(scope, 'dang', 10)).map((r) => r.title)).toEqual([TUAN]);
    expect((await repo.customers(scope, 'NGUYEN THI', 10)).map((r) => r.title)).toEqual([HUONG]);
    expect((await repo.customers(scope, 'huong', 10)).map((r) => r.title)).toEqual([HUONG]);
  });

  it('accented queries still work (exact and partial accents)', async () => {
    expect((await repo.customers(scope, 'Nguyễn', 10)).map((r) => r.title)).toEqual([HUONG]);
    expect((await repo.customers(scope, 'Đặng Minh', 10)).map((r) => r.title)).toEqual([TUAN]);
    expect((await repo.customers(scope, 'Nguyen Thị', 10)).map((r) => r.title)).toEqual([HUONG]);
    expect((await repo.customers(scope, 'Olivia', 10)).map((r) => r.title)).toEqual(['Olivia Brown']);
  });

  it('technicians and services fold too', async () => {
    expect((await repo.technicians(scope, 'dang thu', 10)).map((r) => r.title)).toEqual(['Đặng Thu Hà']);
    expect((await repo.services(scope, 'son gel mong', 10)).map((r) => r.title)).toEqual(['Sơn Gel Móng Tay']);
    expect((await repo.services(scope, 'Sơn Gel', 10)).map((r) => r.title)).toEqual(['Sơn Gel Móng Tay']);
  });

  it('stored names are byte-identical — the fold is only a search key (§42)', async () => {
    const r = await pg.query(`SELECT full_name FROM customers WHERE tenant_id = $1 ORDER BY full_name`, [T]);
    expect((r.rows as any[]).map((x) => x.full_name).sort()).toEqual(['Olivia Brown', HUONG, TUAN].sort());
    expect(Buffer.from((await repo.customers(scope, 'nguyen', 10))[0].title, 'utf8').equals(Buffer.from(HUONG, 'utf8'))).toBe(true);
  });

  it('another tenant\'s rows never appear, and the other tenant sees only its own', async () => {
    for (const q of ['nguyen', 'Nguyễn', 'dang', 'Đặng']) {
      const titles = (await repo.customers(scope, q, 10)).map((r) => r.title);
      expect(titles).not.toContain('Nguyễn Văn Khác');
      expect(titles).not.toContain('Đặng Thị Lan');
    }
    expect((await repo.technicians(scope, 'dang', 10)).map((r) => r.title)).toEqual(['Đặng Thu Hà']);
    expect((await repo.services(scope, 'son gel', 10)).map((r) => r.title)).toEqual(['Sơn Gel Móng Tay']);
    expect((await repo.customers(otherScope, 'nguyen', 10)).map((r) => r.title)).toEqual(['Nguyễn Văn Khác']);
    expect((await repo.customers(otherScope, 'dang', 10)).map((r) => r.title)).toEqual(['Đặng Thị Lan']);
  });

  it('LIKE wildcards in the query are literal, not patterns', async () => {
    expect(await repo.customers(scope, '%', 10)).toEqual([]);
    expect(await repo.customers(scope, 'ngu_en', 10)).toEqual([]);
  });
});

describe('the vi_fold expression indexes are usable', () => {
  it('EXPLAIN on a seeded customers table uses idx_customers_full_name_vi_fold_trgm', async () => {
    await pg.exec(`
      INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status)
        SELECT gen_random_uuid(), '${T2}', '${B2}', 'F' || g, 'L' || g, (ARRAY['Trần','Lê','Phạm','Hoàng','Võ'])[1 + g % 5] || ' Khách ' || g, '+1609' || lpad(g::text, 7, '0'), 'active'
        FROM generate_series(1, 3000) g;
      ANALYZE customers;`);
    const plan = async (sqlText: string, params: unknown[] = []) => (await pg.query(`EXPLAIN ${sqlText}`, params)).rows.map((r: any) => r['QUERY PLAN']).join('\n');
    // Seq scans off: on a few thousand rows a seq scan is legitimately cheaper, and the question here is whether the index
    // expression MATCHES the query expression after vi_fold is inlined (if it did not, the planner would have no index
    // path at all and would still seq-scan with enable_seqscan off).
    await pg.exec(`SET enable_seqscan = off`);
    try {
      expect(await plan(`SELECT id FROM customers WHERE vi_fold(full_name) LIKE '%' || vi_fold('nguyen thi') || '%'`)).toContain('idx_customers_full_name_vi_fold_trgm');
      // the repository binds the query as a parameter — the planner still matches the index expression
      expect(await plan(`SELECT id FROM customers WHERE vi_fold(full_name) LIKE '%' || vi_fold($1) || '%'`, ['nguyen thi'])).toContain('idx_customers_full_name_vi_fold_trgm');
      // the repository's own tenant-scoped shape (tenant filter AND the OR of raw / folded / email) stays index-driven —
      // the planner may lead with the tenant index (the selective path on a multi-tenant table); it never falls to a seq scan
      expect(await plan(`SELECT id FROM customers WHERE tenant_id = $1 AND (full_name ILIKE $2 OR vi_fold(full_name) LIKE '%' || vi_fold($3) || '%' OR email ILIKE $2) AND status <> 'archived'`, [T, '%nguyen thi%', 'nguyen thi'])).not.toContain('Seq Scan');
      expect(await plan(`SELECT id FROM technicians WHERE vi_fold(full_name) LIKE '%dang thu%'`)).toContain('idx_technicians_full_name_vi_fold_trgm');
      expect(await plan(`SELECT id FROM services WHERE vi_fold(name) LIKE '%son gel%'`)).toContain('idx_services_name_vi_fold_trgm');
    } finally { await pg.exec(`RESET enable_seqscan`); }
    // and the search still finds the right row on the bigger table
    expect((await repo.customers(scope, 'nguyen', 10)).map((r) => r.title)).toEqual([HUONG]);
  });
});
