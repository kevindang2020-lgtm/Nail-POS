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
    expect(h.checks.map((c: any) => c.key)).toEqual(['notes_readable', 'legacy_mirror', 'safety_review_backlog', 'corrections_open', 'read_failures', 'warning_latency', 'version_conflicts', 'no_side_effects']);
    // Customer Notes 10: nothing in the request log yet → not measured (never "0 % failures")
    expect(h.checks.find((c: any) => c.key === 'read_failures')).toMatchObject({ state: 'READY', count: 0, detail: { measured: false, reads: 0, failedPercent: null } });
    expect(h.checks.find((c: any) => c.key === 'warning_latency')?.detail).toMatchObject({ measured: false, p95Ms: null });
    expect(h.checks.find((c: any) => c.key === 'corrections_open')).toMatchObject({ state: 'WARNING', count: 1 });
    expect((await q(sql`select count(*)::int as n from customer_note_reviews`))[0].n).toBe(before);
  });
});

describe('Customer Notes 01 — context-aware relevance (nothing hidden)', () => {
  it('a visit ranks safety first, then visit notes of the same service / technician / branch, then preferences; without a visit the session branch and technician rank them', async () => {
    const VY = id(120), TA = id(121), TB = id(122), TC = id(123), S1 = id(131), S2 = id(132), S3 = id(133);
    await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status, notes_json, notes_updated_at, created_at, updated_at)
      values (${VY}, ${T}, ${B}, 'Vy', 'Visits', 'Vy Visits', '+16095550120', 'active', ${notes({ allergyNotes: 'Acetone', servicePreferences: 'Gel only', salonNotes: 'Prefers window seat' })}::jsonb, now() - interval '9 days', now(), now())`);
    // the owner is also technician TA (technicians.user_id) — the "assigned technician" when no visit is given
    await q(sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, is_active, user_id) values
      (${TA}, ${T}, ${B}, 'Ann', 'A', 'Ann A', true, ${OWNER}), (${TB}, ${T}, ${B2}, 'Bea', 'B', 'Bea B', true, null), (${TC}, ${T}, ${B}, 'Cy', 'C', 'Cy C', true, null)`);
    const visit = async (tid: number, branch: string, tech: string, svc: string, note: string | null, ago: string) => {
      await q(sql`insert into tickets (id, tenant_id, branch_id, customer_id, primary_technician_id, status, total_cents, ticket_number, service_done_notes, service_done_at, created_at, paid_at)
        values (${id(tid)}, ${T}, ${branch}, ${VY}, ${tech}, 'paid', 4000, ${tid}, ${note}, now() - ${ago}::interval, now() - ${ago}::interval, now() - ${ago}::interval)`);
      await q(sql`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents)
        values (${T}, ${branch}, ${id(tid)}, ${svc}, ${tech}, 'Svc', 4000, 30, 4000)`);
    };
    await visit(910, B, TA, S1, 'Visit A — same service and technician', '5 days');
    await visit(911, B2, TB, S2, 'Visit B — same branch only', '3 days');
    await visit(912, B, TC, S3, 'Visit C — nothing in common', '1 day');
    await visit(913, B2, TA, S1, null, '1 hour');             // the visit being served now: Second branch, Ann, service S1
    const order = (d: any) => d.entries.map((e: any) => e.category === 'visit' ? e.ticketId : e.category);
    const d = await cn.detail(owner(), VY, { ticketId: id(913) });
    expect(order(d)).toEqual(['allergy', id(910), 'service_preference', id(911), 'general', id(912)]);
    const byTicket = Object.fromEntries(d.entries.filter((e: any) => e.ticketId).map((e: any) => [e.ticketId, e.relevance]));
    expect(byTicket[id(910)]).toEqual({ score: 50, reasons: ['same_service', 'same_technician'] });
    expect(byTicket[id(911)]).toEqual({ score: 10, reasons: ['same_branch'] });
    expect(byTicket[id(912)]).toEqual({ score: 0, reasons: [] });
    expect(d.entries.find((e: any) => e.category === 'allergy')?.relevance).toEqual({ score: 100, reasons: ['safety'] });
    expect(d.context).toEqual({ ticketId: id(913), branch: true, technicians: 1, services: 1 });
    // no visit: the session's branch (Main) and the signed-in technician (Ann) rank them; every note is still there
    const s = await cn.detail(owner(), VY);
    expect(order(s)).toEqual(['allergy', id(910), 'service_preference', id(912), 'general', id(911)]);
    expect(s.entries.find((e: any) => e.ticketId === id(910))?.relevance).toEqual({ score: 30, reasons: ['same_technician', 'same_branch'] });
    expect(s.context).toEqual({ ticketId: null, branch: true, technicians: 1, services: 0 });
    expect(s.entries).toHaveLength(d.entries.length);
    // another customer's visit, a made-up id and a visit outside a confined role's branches are "not found"
    expect(await code(cn.detail(owner(), VY, { ticketId: id(900) }))).toBe('CUSTOMER_NOTES_NOT_FOUND');
    expect(await code(cn.detail(owner(), VY, { ticketId: 'x' }))).toBe('CUSTOMER_NOTES_NOT_FOUND');
    expect(await code(cn.detail(confinedB2(), VY, { ticketId: id(910) }))).toBe('CUSTOMER_NOTES_NOT_FOUND');
  });
});

describe('Customer Notes 10 — accuracy and response-time monitors from the request log', () => {
  it('read failure rate, warning retrieval latency (p95) and version conflicts over 24 h for this salon only; old rows and other salons never count; nothing is written', async () => {
    const line = (tenant: string, route: string, status: number, ms: number, method = 'GET', ago = '1 hour') => q(sql`insert into telemetry_log_events
      (ts, level, service, tenant_id, route, status, duration_ms, msg, fields) values (now() - ${ago}::interval, 'info', 'api', ${tenant}, ${route}, ${status}, ${ms}, 'request.completed', ${JSON.stringify({ method })}::jsonb)`);
    // 20 reads: 18 ok + 2 failed (10 %), of them 10 detail reads — 9 fast and 1 very slow; 6 notes saves / reviews, 5 refused 409
    for (let i = 0; i < 8; i++) await line(T, '/api/v1/pos/customer-notes/notes', 200, 80);
    await line(T, '/api/v1/pos/customer-notes/notes', 500, 90); await line(T, '/api/v1/pos/customer-notes/summary', 503, 90);
    for (let i = 0; i < 9; i++) await line(T, '/api/v1/pos/customer-notes/notes/detail', 200, 100 + i * 10);
    await line(T, '/api/v1/pos/customer-notes/notes/detail', 200, 9000);
    await line(T, '/api/v1/pos/customer-notes/review', 200, 120, 'POST');
    for (let i = 0; i < 3; i++) await line(T, '/api/v1/pos/customer-notes/review', 409, 60, 'POST');
    for (let i = 0; i < 2; i++) await line(T, '/api/v1/pos/customers/:customerId/notes', 409, 60, 'PATCH');
    // never counted: an old failure, another salon's failures, an unrelated route
    await line(T, '/api/v1/pos/customer-notes/notes', 500, 90, 'GET', '3 days');
    for (let i = 0; i < 30; i++) await line(X, '/api/v1/pos/customer-notes/notes', 500, 5000);
    await line(T, '/api/v1/pos/tickets', 500, 90);
    const before = (await q(sql`select count(*)::int as n from telemetry_log_events`))[0].n;
    const h = await cn.check(owner());
    const by = Object.fromEntries(h.checks.map((c: any) => [c.key, c]));
    expect(by.read_failures).toEqual({ key: 'read_failures', state: 'WARNING', count: 2, detail: { measured: true, reads: 20, failed: 2, failedPercent: 10 } });
    expect(by.warning_latency.state).toBe('WARNING');
    expect(by.warning_latency.detail).toMatchObject({ measured: true, requests: 10, limitMs: 1500 });
    expect(by.warning_latency.detail.p95Ms).toBeGreaterThan(1500);
    expect(by.version_conflicts).toEqual({ key: 'version_conflicts', state: 'WARNING', count: 5, detail: { measured: true, writes: 6, conflicts: 5 } });
    expect((await q(sql`select count(*)::int as n from telemetry_log_events`))[0].n).toBe(before);
  });
});
