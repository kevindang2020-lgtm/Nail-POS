// media-lifecycle.pgtest — BUILD_PLAN Phase 11 (Constitution 4 §169/§170): the daily `media.lifecycle` job against the
// REAL migrated schema. It deletes the stored OBJECTS of media rows soft-deleted longer ago than the policy's object_days
// (rows deleted inside the look-back window, so a missed day is caught on the next), never the object of a live row or
// of a row deleted too recently, never anything of a salon under an active tenant legal hold; it never deletes or edits
// the ROW; it sweeps abandoned partial uploads; and the real policy file's media class names live tables/columns.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { MediaLifecycleService, loadMediaPolicy, lifecycleStores, type MediaLifecyclePolicy } from './media-lifecycle';

const A = 'a1000000-0000-4000-8000-00000000000a';
const B = 'b1000000-0000-4000-8000-00000000000b';
let pg: any; let db: any;
const q = async (s: string, p: unknown[] = []) => (await pg.query(s, p)).rows;
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

const POLICY: MediaLifecyclePolicy = {
  object_days: 7, lookback_days: 3, temp_upload_hours: 24,
  tables: {
    support_ticket_attachments: { key_column: 'storage_key', deleted_column: 'deleted_at' },
    display_ad_media: { key_column: 'storage_key', variants_column: 'variants', deleted_column: 'deleted_at' },
  },
};

class FakeStorage {
  removed: string[] = []; sweptBefore: Date | null = null;
  async put() { return { url: '' }; }
  async remove(k: string) { this.removed.push(k); }
  resolvePath() { return null; }
  async sweepAbandoned(cutoff: Date) { this.sweptBefore = cutoff; return 2; }
}

async function seedTenant(id: string) {
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1, 'L', 'D', $2, $3) on conflict do nothing`, [id, `t-${id.slice(0, 8)}`, `C${id.slice(0, 4)}`]);
}
async function ticket(tenant: string): Promise<string> {
  return (await q(`insert into support_tickets (tenant_id, created_by_user_id, ticket_number, subject) values ($1, $1, $2, 'help') returning id`, [tenant, `TCK-${Math.random().toString(36).slice(2, 10)}`]))[0].id;
}
async function attachment(tenant: string, key: string, deletedDaysAgo: number | null) {
  const t = await ticket(tenant);
  await q(`insert into support_ticket_attachments (tenant_id, ticket_id, storage_key, file_name, content_type, size_bytes, deleted_at)
           values ($1, $2, $3, 'f.png', 'image/png', 10, $4)`, [tenant, t, key, deletedDaysAgo === null ? null : daysAgo(deletedDaysAgo)]);
}
async function adMedia(tenant: string, key: string, deletedDaysAgo: number | null) {
  const variants = { large: { key: `${key}-large` }, medium: { key: `${key}-medium` }, thumb: { key: `${key}-thumb` } };
  await q(`insert into display_ad_media (tenant_id, mime_type, width, height, byte_size, total_bytes, sha256, storage_key, variants, deleted_at)
           values ($1, 'image/png', 10, 10, 10, 40, $2, $3, $4, $5)`, [tenant, 'a'.repeat(64), key, JSON.stringify(variants), deletedDaysAgo === null ? null : daysAgo(deletedDaysAgo)]);
}

beforeAll(async () => { pg = await migratedPglite(); db = kyselyFor(pg); });
beforeEach(async () => {
  await pg.exec(`delete from support_ticket_attachments; delete from display_ad_media; delete from customer_legal_holds;`);
  for (const t of [A, B]) await seedTenant(t);
});

describe('media.lifecycle — objects of long-deleted rows', () => {
  it('removes objects of rows deleted 7–10 days ago only; live rows, recent deletions and rows past the look-back stay', async () => {
    await attachment(A, 'A/live', null);
    await attachment(A, 'A/recent', 2);
    await attachment(A, 'A/due', 8);
    await attachment(A, 'A/too-old', 30);   // purged on an earlier run (or by the app at delete time)
    await adMedia(B, 'B/ad', 9);
    await adMedia(B, 'B/ad-live', null);
    const st = new FakeStorage();
    const r = await new MediaLifecycleService(db, st as any, { policy: POLICY }).run();
    expect(st.removed.sort()).toEqual(['A/due', 'B/ad', 'B/ad-large', 'B/ad-medium', 'B/ad-thumb']);
    expect(r.tables).toEqual([
      { table: 'support_ticket_attachments', rows: 1, held: 0, objects: 1 },
      { table: 'display_ad_media', rows: 1, held: 0, objects: 4 },
    ]);
  });
  it('never deletes or edits the ROW (its own retention policy owns it)', async () => {
    await attachment(A, 'A/due', 8);
    const before = await q(`select * from support_ticket_attachments`);
    await new MediaLifecycleService(db, new FakeStorage() as any, { policy: POLICY }).run();
    expect(await q(`select * from support_ticket_attachments`)).toEqual(before);
  });
  it('an ACTIVE tenant legal hold protects that salon (counted as held); a released hold does not', async () => {
    await attachment(A, 'A/due', 8);
    await attachment(B, 'B/due', 8);
    await q(`insert into customer_legal_holds (tenant_id, scope, matter_ref, reason) values ($1, 'tenant', 'M-1', 'litigation')`, [A]);
    await q(`insert into customer_legal_holds (tenant_id, scope, matter_ref, reason, status) values ($1, 'tenant', 'M-2', 'old', 'released')`, [B]);
    const st = new FakeStorage();
    const r = await new MediaLifecycleService(db, st as any, { policy: POLICY }).run();
    expect(st.removed).toEqual(['B/due']);
    expect(r.tables[0]).toEqual({ table: 'support_ticket_attachments', rows: 1, held: 1, objects: 1 });
  });
  it('idempotent: a second run issues the same (harmless) deletes and nothing else', async () => {
    await attachment(A, 'A/due', 8);
    const st = new FakeStorage();
    const svc = new MediaLifecycleService(db, st as any, { policy: POLICY });
    await svc.run(); await svc.run();
    expect(st.removed).toEqual(['A/due', 'A/due']);
  });
  it('sweeps abandoned partial uploads older than temp_upload_hours', async () => {
    const st = new FakeStorage();
    const now = new Date('2026-10-08T12:00:00Z');
    const r = await new MediaLifecycleService(db, st as any, { policy: POLICY, now: () => now.getTime() }).run();
    expect(st.sweptBefore?.toISOString()).toBe('2026-10-07T12:00:00.000Z');
    expect(r.abandoned).toBe(2);
  });
  it('each table is cleaned in ITS store: support attachments in the private store, ad media in the public one; both swept', async () => {
    await attachment(A, 'A/due', 8);
    await adMedia(B, 'B/ad', 9);
    const pub = new FakeStorage(); const priv = new FakeStorage();
    const p: MediaLifecyclePolicy = { ...POLICY, tables: { support_ticket_attachments: { ...POLICY.tables.support_ticket_attachments, store: 'support_attachments' }, display_ad_media: POLICY.tables.display_ad_media } };
    const r = await new MediaLifecycleService(db, { media: pub as any, support_attachments: priv as any }, { policy: p }).run();
    expect(priv.removed).toEqual(['A/due']);
    expect(pub.removed.sort()).toEqual(['B/ad', 'B/ad-large', 'B/ad-medium', 'B/ad-thumb']);
    expect(r.abandoned).toBe(4);
  });
  it('one table failing does not stop the other', async () => {
    await adMedia(B, 'B/ad', 9);
    const bad: MediaLifecyclePolicy = { ...POLICY, tables: { no_such_table: { key_column: 'k', deleted_column: 'd' }, ...POLICY.tables } };
    const st = new FakeStorage();
    const r = await new MediaLifecycleService(db, st as any, { policy: bad }).run();
    expect(r.tables[0]).toMatchObject({ table: 'no_such_table', error: expect.any(String) });
    expect(st.removed).toContain('B/ad');
  });
});

describe('the REAL policy file', () => {
  it('classes.media exists and every table/column it names is live in the migrated schema', async () => {
    const file = resolve(__dirname, '..', '..', 'db', 'retention-policy.json');
    const p = loadMediaPolicy(file);
    expect(p).not.toBeNull();
    expect(p!.temp_upload_hours).toBe(24);
    expect(p!.tables.support_ticket_attachments.store).toBe('support_attachments');   // the PRIVATE store, never the public one
    expect(JSON.parse(readFileSync(file, 'utf8')).classes.media.default_policy).toBe('hard_delete_after_days');
    for (const [table, t] of Object.entries(p!.tables)) {
      const cols = (await q(`select column_name from information_schema.columns where table_name = $1`, [table])).map((r: any) => r.column_name);
      for (const c of [t.key_column, t.deleted_column, t.variants_column].filter(Boolean)) expect(cols, `${table}.${c}`).toContain(c);
      expect(Object.keys(lifecycleStores({} as any)), `${table} store`).toContain(t.store ?? 'media');
      expect(cols, `${table}.tenant_id`).toContain('tenant_id');
    }
  });
});
