// customer-notes-center.pgtest — Customer Notes SUNMI guide (Nov 9 2026, migration 843) on the REAL schema.
// CN = cards / list / review / scope / health. Every customer and note below is a FIXTURE.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { CustomerNotesCenter, CustomerNotesError } from './customer-notes-center';

const P = 'c8430000-0000-4000-8000-';
const id = (n: number) => P + String(n).padStart(12, '0');
const T = id(1), B = id(2), B2 = id(3), X = id(4), BX = id(5), OWNER = id(10);
const C = { lan: id(101), mai: id(102), bo: id(103), arch: id(104), b2: id(105), xena: id(106), legacy: id(107) };
let db: any; let cn: CustomerNotesCenter;
const q = async (s: any) => (await s.execute(db)).rows as any[];
const owner = () => ({ tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: ['pos.customers.notes.view', 'pos.customers.notes.edit'] }) as any;
const confinedB2 = () => ({ tenantId: T, branchId: B2, userId: OWNER, role: 'FRONT_DESK', permissions: ['pos.customers.notes.view'], authz: { scope: 'BRANCH', branchIds: [B2] } }) as any;
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof CustomerNotesError ? e.code : (e as Error).message; } }
const notes = (o: Record<string, unknown>) => JSON.stringify({ salonNotes: '', allergyNotes: '', preferredStyle: '', preferredTechnician: '', servicePreferences: '', warnings: '', customerVisible: false, ...o });

beforeAll(async () => {
  db = kyselyFor(await migratedPglite()); cn = new CustomerNotesCenter(db);
  await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'S', 'Pilot', 'cn-843', 'CN843', 'active'), (${X}, 'X', 'Other', 'cn-843x', 'CN843X', 'active')`);
  await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'America/New_York'), (${B2}, ${T}, 'Second', 'America/New_York'), (${BX}, ${X}, 'Other', 'America/New_York')`);
  await q(sql`insert into users (id, tenant_id, full_name, email, status, role) values (${OWNER}, ${T}, 'Owner Kim', 'o@cn.test', 'active', 'OWNER')`);
  const cust: Array<[string, string, string, string, string | null]> = [
    [C.lan, 'Lan Pham', T, B, notes({ allergyNotes: 'Customer-reported sensitivity to acrylic adhesive', warnings: 'Avoid electric file near cuticle', preferredStyle: 'Short almond', salonNotes: 'Likes quiet chairs' })],
    [C.mai, 'Mai Tran', T, B, notes({ servicePreferences: 'Gel pedicure', preferredTechnician: 'Lan' })],
    [C.bo, 'Bo Nguyen', T, B, null],
    [C.arch, 'Archie Gone', T, B, notes({ warnings: 'Archived customer warning' })],
    [C.b2, 'Bea Second', T, B2, notes({ allergyNotes: 'Latex' })],
    [C.xena, 'Xena Other', X, BX, notes({ warnings: 'Other salon warning', allergyNotes: 'Other salon allergy' })],
    [C.legacy, 'Leo Legacy', T, B, null],
  ];
  for (const [cid, name, tenant, branch, json] of cust)
    await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status, notes_json, notes_updated_at, created_at, updated_at)
      values (${cid}, ${tenant}, ${branch}, ${name.split(' ')[0]}, ${name.split(' ')[1]}, ${name}, ${'+1609555' + cid.slice(-4)}, 'active', ${json}::jsonb, now() - interval '2 days', now(), now())`);
  await q(sql`update customers set archived_at = now() where id = ${C.arch}`);
  await q(sql`update customers set notes = 'Legacy salon note', safety_notes = 'Legacy warning' where id = ${C.legacy}`);   // written before migration 347
  // a technician's Service Done note on Bo's visit (Main) — the "visit" category
  await q(sql`insert into tickets (id, tenant_id, branch_id, customer_id, status, total_cents, ticket_number, service_done_notes, service_done_at, created_at, paid_at)
    values (${id(900)}, ${T}, ${B}, ${C.bo}, 'paid', 4500, 1, 'Used soak-off; nails thin on left hand', now() - interval '1 day', now() - interval '1 day', now() - interval '1 day')`);
}, 180_000);

describe('Customer Notes workspace', () => {
  it('CN-01 the four cards count only live, visible notes (archived and other salons stay out; legacy columns count)', async () => {
    const s = await cn.summary(owner());
    // Lan, Mai, Bo (visit), Bea, Leo (legacy) — not Archie (archived), not Xena (other salon)
    expect(s.cards.customersWithNotes).toBe(5);
    expect(s.cards.safetyWarnings).toBe(2);           // Lan + Leo's legacy warning
    expect(s.cards.preferencesRecorded).toBe(3);      // Lan style · Mai service pref · Mai technician pref
    expect(s.cards.needsReview).toBe(4);              // Lan allergy + warning, Bea allergy, Leo warning — none reviewed yet
  });
  it('CN-02 one row per category, the six categories map from the notes staff keep; a visit note is its own row', async () => {
    const r = await cn.list(owner(), { pageSize: 100 });
    const lan = r.items.filter((i: any) => i.customerId === C.lan).map((i: any) => i.category).sort();
    expect(lan).toEqual(['allergy', 'general', 'service_preference', 'warning']);
    expect(r.items.find((i: any) => i.category === 'visit')).toMatchObject({ customerId: C.bo, ticketId: id(900), review: 'not_required' });
    expect(r.items.find((i: any) => i.customerId === C.legacy && i.category === 'general')?.preview.text).toBe('Legacy salon note');
    expect(r.items.some((i: any) => i.customerId === C.xena || i.customerId === C.arch)).toBe(false);
    expect(r.items.every((i: any) => i.phone == null || i.phone.startsWith('(•••)'))).toBe(true);   // masked
  });
  it('CN-03 filters: category · review · search by name or note words (accent-insensitive) · too-short search refused', async () => {
    expect((await cn.list(owner(), { category: 'allergy' })).items.map((i: any) => i.customer).sort()).toEqual(['Bea Second', 'Lan Pham']);
    expect((await cn.list(owner(), { review: 'needs_review' })).total).toBe(4);
    expect((await cn.list(owner(), { q: 'adhesive' })).items.map((i: any) => i.category)).toEqual(['allergy']);
    expect((await cn.list(owner(), { q: 'lan pham' })).items.every((i: any) => i.customerId === C.lan)).toBe(true);
    expect(await code(cn.list(owner(), { q: 'a' }))).toBe('CUSTOMER_NOTES_SEARCH_TOO_SHORT');
  });
  it('CN-04 review: confirming the CURRENT text clears "needs review"; an edit afterwards puts it back; a stale hash is refused', async () => {
    const d = await cn.detail(owner(), C.lan);
    const allergy = d.entries.find((e: any) => e.category === 'allergy')!;
    expect(allergy.review).toBe('needs_review');
    const after = await cn.review(owner(), { customerId: C.lan, category: 'allergy', contentHash: allergy.hash, decision: 'confirmed' });
    expect(after.entries.find((e: any) => e.category === 'allergy')!.review).toBe('reviewed');
    expect(after.history[0]).toMatchObject({ category: 'allergy', decision: 'confirmed', reviewer: 'Owner Kim', current: true });
    expect((await cn.summary(owner())).cards.needsReview).toBe(3);
    // the note is edited → the old review no longer covers it
    await q(sql`update customers set notes_json = jsonb_set(notes_json, '{allergyNotes}', '"Acrylic adhesive and latex"'), notes_updated_at = now() where id = ${C.lan}`);
    expect((await cn.detail(owner(), C.lan)).entries.find((e: any) => e.category === 'allergy')!.review).toBe('needs_review');
    expect(await code(cn.review(owner(), { customerId: C.lan, category: 'allergy', contentHash: allergy.hash, decision: 'confirmed' }))).toBe('CUSTOMER_NOTES_CHANGED');
    // a correction needs a reason; only safety notes are reviewed
    const w = (await cn.detail(owner(), C.lan)).entries.find((e: any) => e.category === 'warning')!;
    expect(await code(cn.review(owner(), { customerId: C.lan, category: 'warning', contentHash: w.hash, decision: 'needs_correction' }))).toBe('CUSTOMER_NOTES_REASON_REQUIRED');
    expect((await cn.review(owner(), { customerId: C.lan, category: 'warning', contentHash: w.hash, decision: 'needs_correction', reason: 'Ask the customer again' })).entries.find((e: any) => e.category === 'warning')!.review).toBe('needs_correction');
    expect(await code(cn.review(owner(), { customerId: C.mai, category: 'general', contentHash: w.hash, decision: 'confirmed' }))).toBe('CUSTOMER_NOTES_INVALID_REVIEW');
  });
  it('CN-05 a branch-confined role sees only its customers; another salon and archived profiles are "not found"', async () => {
    const r = await cn.list(confinedB2(), { pageSize: 100 });
    expect([...new Set(r.items.map((i: any) => i.customerId))]).toEqual([C.b2]);
    expect(await code(cn.detail(confinedB2(), C.lan))).toBe('CUSTOMER_NOTES_NOT_FOUND');
    expect(await code(cn.detail(owner(), C.xena))).toBe('CUSTOMER_NOTES_NOT_FOUND');
    expect(await code(cn.detail(owner(), C.arch))).toBe('CUSTOMER_NOTES_NOT_FOUND');
  });
  it('CN-06 dates: "Updated" filters by when the notes were saved; reviewed date filters by the review', async () => {
    expect((await cn.list(owner(), { preset: 'today' })).items.map((i: any) => i.customerId)).toEqual(expect.arrayContaining([C.lan]));   // Lan's notes were edited today
    expect((await cn.list(owner(), { preset: 'today' })).items.some((i: any) => i.customerId === C.mai)).toBe(false);   // saved 2 days ago
    expect((await cn.list(owner(), { preset: 'today', dateField: 'reviewed' })).items.map((i: any) => `${i.customerId}:${i.category}`)).toEqual([`${C.lan}:warning`]);
    expect(await code(cn.list(owner(), { preset: 'custom', from: '2026-11-09', to: '2026-11-01' }))).toBe('CUSTOMER_NOTES_INVALID_PERIOD');
  });
  it('CN-07 the health check is read-only and names what it saw', async () => {
    const before = (await q(sql`select count(*)::int as n from customer_note_reviews`))[0].n;
    const h = await cn.check(owner());
    expect(h.checks.map((c: any) => c.key)).toEqual(['notes_readable', 'legacy_mirror', 'safety_review_backlog', 'corrections_open', 'no_side_effects']);
    expect(h.checks.find((c: any) => c.key === 'corrections_open')).toMatchObject({ state: 'WARNING', count: 1 });
    expect((await q(sql`select count(*)::int as n from customer_note_reviews`))[0].n).toBe(before);
  });
});
