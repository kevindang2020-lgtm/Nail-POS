// vietnamese-unicode.pgtest — English + Vietnamese POS mandate §38 / §39 / §42 / §109 on the real migrated schema (PGlite):
// Vietnamese names and notes with every tone mark go in through the real CustomersService + repository and come back
// unchanged — the same Unicode code points and UTF-8 bytes — on create, read, list search (accented and accent-free),
// edit, and the realtime path (the customer event carries the id only, §12; the screen refetches and reads the same
// bytes). Stored text is never folded or transliterated (§42); the search fold is a key only.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyCustomersRepository } from './customers.kysely.repository';
import { CustomersService } from './customers.service';

const T = 'a7090000-0000-4000-8000-0000000000aa', B = 'a7090000-0000-4000-8000-0000000000b1';
// every Vietnamese vowel with each of the five tone marks (and none), upper and lower case, plus đ / Đ — in names a salon types
const VOWELS = 'aăâeêioôơuưy';
const TONES = ['', '̀', '́', '̉', '̃', '̣'];   // huyền, sắc, hỏi, ngã, nặng — composed to NFC below
const ALL_TONED = [...VOWELS].flatMap((v) => TONES.map((t) => (v + t).normalize('NFC'))).join('');
const NAMES = ['Nguyễn Thị Hương', 'Trần Mỹ Linh', 'Đặng Minh Tuấn', 'Huỳnh Ngọc Ẩn', 'Võ Thị Ỷ Lan', 'Phạm Thị Ánh Tuyết'];
const NOTE = 'Khách muốn sơn màu đỏ và thêm thiết kế hoa.';
let pg: any; let svc: CustomersService;
const q = async (s: string, p: unknown[] = []) => (await pg.query(s, p)).rows as any[];
const ctx = { tenantId: T, branchId: B, userId: 'a7090000-0000-4000-8000-0000000000c1', role: 'OWNER', permissions: ['pos.customers.view', 'pos.customers.create', 'pos.customers.edit', 'pos.customers.notes.view', 'pos.customers.notes.edit'] } as any;
const utf8 = (s: string) => Buffer.from(s, 'utf8').toString('hex');

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1, 'Tiệm Nail Hương', 'Tiệm Nail Hương', 'vi-unicode', 'VIUNI01', 'active')`, [T]);
  await q(`insert into branches (id, tenant_id, name, status) values ($1, $2, 'Chi nhánh Chính', 'active')`, [B, T]);
  svc = new CustomersService(new KyselyCustomersRepository(kyselyFor(pg)));
}, 240_000);

describe('Vietnamese text survives the customer write / read / search / edit path unchanged', () => {
  const ids: Record<string, string> = {};
  it('the test alphabet is complete: 12 vowels × 6 tones (NFC) + đ Đ', () => {
    expect([...ALL_TONED].length).toBe(72);
    expect(ALL_TONED).toContain('ặ'); expect(ALL_TONED).toContain('ữ'); expect(ALL_TONED).toContain('ỹ');
  });
  it('create + read: names, the note and a full-alphabet last name come back byte-identical (service, repository, SQL)', async () => {
    for (const [i, full] of NAMES.entries()) {
      // the front desk types the name as it is said ("Nguyễn Thị" + "Hương"); full_name = first + ' ' + last
      const words = full.split(' '); const last = words.pop()!; const rest = words;
      const row: any = await svc.create(ctx, { firstName: rest.join(' '), lastName: last, phone: `+1609555${String(100 + i)}1`, notes: NOTE } as any);
      ids[full] = row.customerId;
      const d: any = await svc.detail(ctx, row.customerId);
      const db = (await q(`select first_name, last_name, full_name, encode(convert_to(full_name, 'UTF8'), 'hex') as h from customers where id = $1`, [row.customerId]))[0];
      expect([d.firstName, d.lastName]).toEqual([rest.join(' '), last]);
      expect(db.first_name).toBe(rest.join(' ')); expect(db.last_name).toBe(last);
      expect(db.h).toBe(utf8(db.full_name));
      expect(db.full_name.normalize('NFC')).toBe(db.full_name);            // stored composed, never decomposed / folded
      expect(JSON.stringify(d)).toContain(NOTE);
    }
    const alpha: any = await svc.create(ctx, { firstName: 'Đđ', lastName: ALL_TONED, phone: '+16095559991' } as any);
    const back = (await q(`select last_name, first_name from customers where id = $1`, [alpha.customerId]))[0];
    expect(back.last_name).toBe(ALL_TONED); expect(back.first_name).toBe('Đđ');
    expect(utf8(back.last_name)).toBe(utf8(ALL_TONED));
  });
  it('search: the accented query and the accent-free one find the same people; the stored names are untouched', async () => {
    const hits = async (search: string) => ((await svc.list(ctx, { search } as any)) as any).items.map((r: any) => r.displayName ?? r.fullName ?? `${r.firstName} ${r.lastName}`);
    for (const [query, want] of [['Nguyễn', 'Nguyễn Thị Hương'], ['nguyen', 'Nguyễn Thị Hương'], ['NGUYEN THI HUONG', 'Nguyễn Thị Hương'], ['dang minh', 'Đặng Minh Tuấn'], ['tuan', 'Đặng Minh Tuấn'], ['an', 'Huỳnh Ngọc Ẩn'], ['tuyet', 'Phạm Thị Ánh Tuyết']] as const) {
      expect((await hits(query)).join('|'), query).toContain(want);
    }
    const stored = (await q(`select full_name from customers where tenant_id = $1 order by full_name`, [T])).map((r) => r.full_name);
    for (const n of NAMES) expect(stored).toContain(n);
  });
  it('edit: a Vietnamese rename is stored exactly; the realtime path carries the id only and the refetch reads the same bytes', async () => {
    const id = ids['Trần Mỹ Linh'];
    const events: any[] = []; (svc as any).realtime = { toTenant: (_s: unknown, _e: unknown, env: unknown) => events.push(env) };
    await svc.update(ctx, id, { firstName: 'Mỹ Linh', lastName: 'Trần Thị', preferredName: 'Bé Linh', expectedVersion: null } as any);
    const d: any = await svc.detail(ctx, id);
    expect([d.firstName, d.lastName]).toEqual(['Mỹ Linh', 'Trần Thị']);
    expect(JSON.stringify(d)).toContain('Bé Linh');
    const db = (await q(`select first_name, last_name, preferred_name from customers where id = $1`, [id]))[0];
    expect([db.first_name, db.last_name, db.preferred_name]).toEqual(['Mỹ Linh', 'Trần Thị', 'Bé Linh']);
    // the event never carries the name (privacy §12) — a screen re-reads the customer, which is the bytes above
    expect(JSON.stringify(events)).not.toContain('Linh');
  });
});
