// business-setup-center.pgtest — AI Business Setup guide §15 acceptance matrix on the REAL schema (through 753).
// DATA01–DATA09 readiness from canonical tables (false zeros, defaults, branch / eligibility exclusions, API outage →
// UNKNOWN), FAQ01–FAQ08 lifecycle, SEARCH01–05, DATE04 (salon-day boundary across DST), PAGE01–03, SYNC01–06, SEC01–05.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { BusinessSetupCenter, validateWeek, redact, classifyIntent, type BsCtx } from './business-setup-center';
import { BusinessSetupCenterController } from './business-setup-center.controller';

const P = 'b5753000-0000-4000-8000-0000000';
const id = (s: string) => P + s.padStart(5, '0');
const TA = id('a1'), TB = id('a2'), BA = id('b1'), BA2 = id('b2'), BB = id('b3'), CA = id('c1'), CB = id('c2'), OWNER = id('e1'), FD = id('e2');
const own: BsCtx = { tenantId: TA, branchId: BA, userId: OWNER, role: 'OWNER', permissions: ['ai.use', 'ai.manage'] };
const ownB: BsCtx = { tenantId: TB, branchId: BB, userId: OWNER, role: 'OWNER', permissions: ['ai.use', 'ai.manage'] };
let pg: any; let db: any; let c: BusinessSetupCenter; let k = 0;
const key = () => 'bs-test-key-' + String(++k).padStart(4, '0');
const q1 = async (s: any) => (await s.execute(db)).rows[0];
const row = (ch: any, key2: string) => [...ch.core, ...ch.supplemental].find((x: any) => x.key === key2);
const act = (fid: string, action: string, version: number, extra: Record<string, unknown> = {}) => c.faqAction(own, fid, { action, expectedVersion: version, idempotencyKey: key(), ...extra });

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg); c = new BusinessSetupCenter(db);
  await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${TA}, 'A', 'Salon A', 'bs-a', 'BSA001', 'active'), (${TB}, 'B', 'Salon B', 'bs-b', 'BSB001', 'active')`.execute(db);
  await sql`insert into branches (id, tenant_id, name, timezone) values (${BA}, ${TA}, 'Main', 'America/New_York'), (${BA2}, ${TA}, 'Uptown', 'America/New_York'), (${BB}, ${TB}, 'Main', 'America/New_York')`.execute(db);
  await sql`insert into service_categories (id, tenant_id, branch_id, name) values (${CA}, ${TA}, ${BA}, 'Nails'), (${CB}, ${TB}, ${BB}, 'Nails')`.execute(db);
  await sql`insert into users (id, tenant_id, full_name, email, status, role) values (${OWNER}, ${TA}, 'Olivia Owner', 'o@bs.test', 'active', 'OWNER')`.execute(db);
}, 240_000);

describe('pure helpers', () => {
  it('validateWeek flags invalid days and allows a midnight-spanning day; redact strips phones and e-mails; intents', () => {
    const v = validateWeek({ monday: { isOpen: true, openTime: '09:00', closeTime: '19:00' }, friday: { isOpen: true, openTime: '18:00', closeTime: '02:00' }, sunday: { isOpen: true, openTime: '9am', closeTime: '5pm' } });
    expect(v).toEqual({ openDays: 2, invalidDays: ['sunday'], overnightDays: ['friday'] });
    expect(redact('call me at +1 (609) 555-0142 or ava@x.com')).toBe('call me at [redacted] or [redacted]');
    expect(['What time are you open Sunday?', 'How much is a pedicure?', 'Who can perform nail art?', 'Can I book tomorrow at 3 PM?', 'What is your cancellation policy?'].map(classifyIntent))
      .toEqual(['hours', 'price', 'technician', 'booking', 'policy']);
  });
});

describe('readiness from canonical sources (DATA01–DATA09)', () => {
  it('DATA02 + DATA03 + DATA07: nothing saved → hours NEEDS_SETUP (platform default is not "configured"); zero services / technicians are explained, not guessed', async () => {
    const r = await c.readiness(own);
    expect(row(r, 'business_hours')).toMatchObject({ status: 'NEEDS_SETUP', source: 'Platform default (not saved)' });
    expect(row(r, 'services')).toMatchObject({ status: 'NEEDS_SETUP', rawCount: 0, eligibleCount: 0, detail: 'No services exist in the catalog yet.' });
    expect(row(r, 'technicians')).toMatchObject({ status: 'NEEDS_SETUP', rawCount: 0, eligibleCount: 0, detail: 'No technicians on file.' });
  });
  it('DATA01: saved branch hours are read; an invalid day is FAILED; overnight is a warning', async () => {
    const week = { monday: { isOpen: true, openTime: '09:00', closeTime: '19:00' }, tuesday: { isOpen: true, openTime: '09:00', closeTime: '19:00' }, saturday: { isOpen: true, openTime: '20:00', closeTime: '01:00' }, sunday: { isOpen: false, openTime: null, closeTime: null } };
    await sql`insert into tenant_settings (tenant_id, branch_id, category, settings_json) values (${TA}, ${BA}, 'store-hours-auto-logout', ${JSON.stringify({ storeHours: week })}::jsonb)`.execute(db);
    let h = row(await c.readiness(own), 'business_hours');
    expect(h).toMatchObject({ status: 'READY', source: 'Settings → Store hours (this branch)' });
    expect(h.warnings.join(' ')).toContain('Open past midnight on saturday');
    await sql`update tenant_settings set settings_json = ${JSON.stringify({ storeHours: { ...week, monday: { isOpen: true, openTime: '9', closeTime: '19:00' } } })}::jsonb where tenant_id = ${TA} and branch_id = ${BA}`.execute(db);
    h = row(await c.readiness(own), 'business_hours');
    expect(h).toMatchObject({ status: 'FAILED', exclusions: [{ reason: 'invalid_hours', count: 1 }] });
    await sql`update tenant_settings set settings_json = ${JSON.stringify({ storeHours: week })}::jsonb where tenant_id = ${TA} and branch_id = ${BA}`.execute(db);
  });
  it('DATA04 + DATA05: services exist but some are ineligible — raw vs eligible counts with reasons; another branch\'s service is excluded', async () => {
    await sql`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status, online_booking_enabled) values
      (${id('5a1')}, ${TA}, ${BA}, ${CA}, 'Gel Manicure', 45, 3500, 'active', true),
      (${id('5a2')}, ${TA}, ${BA}, ${CA}, 'Spa Pedicure', 60, 0, 'active', false),
      (${id('5a3')}, ${TA}, ${BA}, ${CA}, 'Old Polish', 20, 1500, 'inactive', true),
      (${id('5a4')}, ${TA}, ${BA2}, ${CA}, 'Uptown Nail Art', 30, 2500, 'active', true)`.execute(db);
    const s = row(await c.readiness(own), 'services');
    expect(s).toMatchObject({ status: 'READY', rawCount: 4, eligibleCount: 2 });
    expect(s.exclusions).toEqual([{ reason: 'inactive_or_archived', count: 1 }, { reason: 'other_branch', count: 1 }]);
    expect(s.warnings.join(' ')).toMatch(/1 bookable service\(s\) have no price.*online booking turned off/);
  });
  it('DATA08 + DATA09: technicians on file but unqualified / unscheduled are explained; Team status vs active flag disagreement is reported', async () => {
    await sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) values
      (${id('7a1')}, ${TA}, ${BA}, 'Lan', 'Ng', 'Lan Ng', 'active', true),
      (${id('7a2')}, ${TA}, ${BA}, 'Mai', 'Tr', 'Mai Tr', 'off_shift', true),
      (${id('7a3')}, ${TA}, ${BA}, 'Old', 'Tech', 'Old Tech', 'inactive', false),
      (${id('7a4')}, ${TA}, ${BA2}, 'Uma', 'Up', 'Uma Up', 'active', true)`.execute(db);
    let t = row(await c.readiness(own), 'technicians');
    expect(t).toMatchObject({ status: 'NEEDS_SETUP', rawCount: 4, eligibleCount: 2, detail: 'Technicians are on file but none has a service qualification.' });
    expect(t.exclusions).toEqual([{ reason: 'inactive', count: 1 }, { reason: 'other_branch', count: 1 }]);
    expect(t.warnings.join(' ')).toContain('1 technician(s) have a Team status that disagrees');
    await sql`insert into technician_services (tenant_id, branch_id, technician_id, service_id) values (${TA}, ${BA}, ${id('7a1')}, ${id('5a1')})`.execute(db);
    await sql`insert into technician_schedules (tenant_id, branch_id, technician_id, day_of_week, start_time, end_time, is_working) values (${TA}, ${BA}, ${id('7a1')}, 1, '09:00', '17:00', true)`.execute(db);
    t = row(await c.readiness(own), 'technicians');
    expect(t).toMatchObject({ status: 'READY', eligibleCount: 2 });
    expect(t.warnings.join(' ')).toMatch(/1 active technician\(s\) have no service qualification.*1 active technician\(s\) have no working schedule/);
  });
  it('DATA06: an outage is UNKNOWN with a trace reference — never a zero', async () => {
    const broken = new BusinessSetupCenter(kyselyFor({ query: async () => { throw new Error('db down'); } } as any));
    const r = await broken.readiness(own);
    for (const k2 of ['business_hours', 'services', 'technicians', 'faqs']) { const x = row(r, k2); expect(x.status).toBe('UNKNOWN'); expect(x.rawCount).toBeNull(); expect(x.traceId).toMatch(/^bs_/); }
  });
  it('SEC01: another salon sees only its own numbers', async () => {
    const s = row(await c.readiness(ownB), 'services');
    expect(s).toMatchObject({ rawCount: 0, eligibleCount: 0 });
  });
});

let F1 = '';
describe('FAQ lifecycle (FAQ01–FAQ08, SYNC04)', () => {
  it('FAQ01 + FAQ02: Add FAQ makes one durable DRAFT; a double tap with the same key is the same FAQ; a draft is never AI knowledge', async () => {
    const k1 = key();
    const a = await c.createFaq(own, { question: 'Do you take walk-ins?', answer: 'Yes, when a technician is free.', category: 'General', idempotencyKey: k1 });
    const b = await c.createFaq(own, { question: 'Do you take walk-ins?', answer: 'Yes, when a technician is free.', category: 'General', idempotencyKey: k1 });
    expect(b).toEqual({ id: a.id, replayed: true }); F1 = a.id;
    expect((await q1(sql`select count(*)::int n from ai_receptionist_faqs where tenant_id = ${TA}`)).n).toBe(1);
    const d = await c.faq(own, F1);
    expect(d).toMatchObject({ status: 'draft', version: 1, aiServable: false });
    expect(d.revisions).toHaveLength(1);
    expect((await c.knowledge(TA, BA)).faqs).toEqual([]);
  });
  it('FAQ04 + FAQ05: submit → reject sends it to Needs review (still not AI-servable); approve publishes it', async () => {
    let v = (await act(F1, 'submit', 1)).version;
    expect((await c.faq(own, F1)).status).toBe('pending_review');
    v = (await act(F1, 'reject', v, { reason: 'Mention the wait time' })).version;
    expect((await c.faq(own, F1)).status).toBe('needs_review');
    expect((await c.knowledge(TA, BA)).faqs).toEqual([]);
    v = (await act(F1, 'edit', v, { question: 'Do you take walk-ins?', answer: 'Yes, when a technician is free — usually a 15 minute wait.', category: 'General' })).version;
    v = (await act(F1, 'approve', v)).version;
    const kn = await c.knowledge(TA, BA);
    expect(kn.faqs.map((f) => f.answer)).toEqual(['Yes, when a technician is free — usually a 15 minute wait.']);
    expect((await c.faq(own, F1)).events.map((e: any) => e.action)).toEqual(['approved', 'edited', 'rejected', 'submitted', 'created']);
  });
  it('FAQ03 + SYNC04: editing an APPROVED FAQ is a pending change — the live text and the AI answer stay until approval', async () => {
    const d0 = await c.faq(own, F1);
    const v = (await act(F1, 'edit', d0.version, { question: 'Do you take walk-ins?', answer: 'No walk-ins this month.', category: 'General', reason: 'Holiday season' })).version;
    const d = await c.faq(own, F1);
    expect(d).toMatchObject({ status: 'approved', hasPendingChange: true, answer: 'Yes, when a technician is free — usually a 15 minute wait.', draftAnswer: 'No walk-ins this month.' });
    expect((await c.knowledge(TA, BA)).faqs[0].answer).toBe('Yes, when a technician is free — usually a 15 minute wait.');
    const v2 = (await act(F1, 'reject', v, { reason: 'Not this month after all' })).version;
    const d2 = await c.faq(own, F1);
    expect(d2).toMatchObject({ status: 'approved', hasPendingChange: false, answer: 'Yes, when a technician is free — usually a 15 minute wait.' });
    expect(d2.version).toBe(v2);
  });
  it('version conflict and invalid moves are refused with codes; the replay of a key is a no-op', async () => {
    await expect(act(F1, 'archive', 1, { reason: 'x' })).rejects.toMatchObject({ code: 'AI_FAQ_VERSION_CONFLICT', status: 409 });
    const v = (await c.faq(own, F1)).version;
    await expect(act(F1, 'submit', v)).rejects.toMatchObject({ code: 'AI_FAQ_NOTHING_PENDING' });
    await expect(act(F1, 'archive', v)).rejects.toMatchObject({ code: 'AI_FAQ_REASON_REQUIRED' });
    const k2 = key();
    const a = await c.faqAction(own, F1, { action: 'archive', expectedVersion: v, reason: 'Seasonal', idempotencyKey: k2 });
    const b = await c.faqAction(own, F1, { action: 'archive', expectedVersion: v, reason: 'Seasonal', idempotencyKey: k2 });
    expect(b).toMatchObject({ replayed: true, status: 'archived' }); expect(a.status).toBe('archived');
  });
  it('FAQ06: archive keeps every revision and event; restore never re-publishes (Needs review), approve again to serve', async () => {
    const d = await c.faq(own, F1);
    expect(d).toMatchObject({ status: 'archived', aiServable: false });
    expect((await c.knowledge(TA, BA)).faqs).toEqual([]);
    const revs = d.revisions.length;
    const v = (await act(F1, 'restore', d.version)).version;
    const r = await c.faq(own, F1);
    expect(r).toMatchObject({ status: 'needs_review', aiServable: false }); expect(r.revisions.length).toBe(revs);
    await act(F1, 'approve', v);
    expect((await c.knowledge(TA, BA)).faqs).toHaveLength(1);
    await expect(sql`delete from ai_receptionist_faq_events where faq_id = ${F1}`.execute(db)).rejects.toThrow(/append-only/);
    await expect(sql`update ai_receptionist_faq_revisions set answer = 'x' where faq_id = ${F1}`.execute(db)).rejects.toThrow(/append-only/);
  });
  it('FAQ04 + SEC03: without ai.manage the controller refuses to create or approve (403); reading is allowed', async () => {
    const ctl = new BusinessSetupCenterController(c);
    const fd = { ctx: { tenantId: TA, branchId: BA, userId: FD, role: 'FRONT_DESK', permissions: ['ai.use'] } };
    await expect((async () => ctl.create(fd, { question: 'q', answer: 'a', idempotencyKey: key() }))()).rejects.toMatchObject({ status: 403 });
    await expect((async () => ctl.act(fd, F1, { action: 'approve', expectedVersion: 1, idempotencyKey: key() }))()).rejects.toMatchObject({ status: 403 });
    expect((await ctl.faqs(fd, {})).totalItems).toBe(1);
  });
  it('SEC01: tenant B cannot read or act on tenant A\'s FAQ', async () => {
    await expect(c.faq(ownB, F1)).rejects.toMatchObject({ code: 'AI_FAQ_NOT_FOUND', status: 404 });
    await expect(c.faqAction(ownB, F1, { action: 'archive', expectedVersion: 1, reason: 'x', idempotencyKey: key() })).rejects.toMatchObject({ code: 'AI_FAQ_NOT_FOUND' });
    expect((await c.knowledge(TB, BB)).faqs).toEqual([]);
  });
});

describe('search, filters, dates, pages (SEARCH01–05, DATE04, PAGE01–03)', () => {
  it('PAGE01–03 + SEARCH01/02: 23 FAQs page 10 at a time with no duplicates; the newest is first; partial search and filters combine', async () => {
    for (let i = 1; i <= 22; i++) await c.createFaq(own, { question: `Question number ${i}`, answer: i % 2 ? 'Parking is behind the salon.' : 'We accept cards.', category: i % 2 ? 'Parking' : 'Payment', idempotencyKey: key() });
    const seen = new Set<string>(); let total = 0;
    for (const page of [1, 2, 3]) { const r = await c.faqs(own, { page, pageSize: 10 }); total = r.totalItems; r.items.forEach((x) => seen.add(x.id)); if (page === 1) expect(r.items[0].question).toBe('Question number 22'); }
    expect(total).toBe(23); expect(seen.size).toBe(23);
    expect((await c.faqs(own, { q: 'parking', pageSize: 50 })).totalItems).toBe(11);
    expect((await c.faqs(own, { q: 'parking', status: 'draft', category: 'parking', pageSize: 50 })).totalItems).toBe(11);
    expect((await c.faqs(own, { q: 'parking', status: 'approved' })).totalItems).toBe(0);
    expect((await c.faqs(own, { pageSize: 13 })).pageSize).toBe(20);
  });
  it('DATE04: the To date includes its whole salon-local day; the From date starts at local midnight — across the DST change', async () => {
    const x = (await c.faqs(own, { q: 'number 1', pageSize: 10, sort: 'oldest' })).items[0].id;
    const y = (await c.faqs(own, { q: 'number 2', pageSize: 10, sort: 'oldest' })).items[0].id;
    await sql`alter table ai_receptionist_faqs disable trigger user`.execute(db).catch(() => undefined);
    await sql`update ai_receptionist_faqs set created_at = '2026-03-08T04:59:00Z' where id = ${x}`.execute(db);   // Mar 7, 23:59 EST
    await sql`update ai_receptionist_faqs set created_at = '2026-03-09T03:59:00Z' where id = ${y}`.execute(db);   // Mar 8, 23:59 EDT (after the change)
    expect((await c.faqs(own, { from: '2026-03-07', to: '2026-03-07' })).items.map((i) => i.id)).toEqual([x]);
    expect((await c.faqs(own, { from: '2026-03-08', to: '2026-03-08' })).items.map((i) => i.id)).toEqual([y]);
    await expect(c.faqs(own, { from: '2026-03-09', to: '2026-03-08' })).rejects.toMatchObject({ code: 'AI_SETUP_INVALID_FILTER' });
  });
  it('SEARCH03 + SEARCH05: services and technicians are searched in their canonical tables, this salon only', async () => {
    expect((await c.search(own, { scope: 'services', q: 'gel' })).items.map((i) => i.title)).toEqual(['Gel Manicure']);
    expect((await c.search(own, { scope: 'technicians', q: 'lan' })).items.map((i) => i.title)).toEqual(['Lan Ng']);
    expect((await c.search(ownB, { scope: 'services', q: 'gel' })).totalItems).toBe(0);
    expect((await c.search(ownB, { scope: 'faqs', q: 'parking' })).totalItems).toBe(0);
  });
});

describe('preview, health, assistant (SYNC01–06, SEC04)', () => {
  it('Preview answers from approved sources only, records a redacted run, and never books, holds or texts (SEC04)', async () => {
    const before = await q1(sql`select (select count(*) from appointment_schedule_locks)::int a, (select count(*) from notifications)::int n`);
    const hours = await c.preview(own, { question: 'What time are you open Monday? my cell is 609-555-0142' });
    expect(hours).toMatchObject({ intent: 'hours', outcome: 'answered', isPreview: true });
    expect(hours.answer).toContain('Monday: 09:00–19:00'); expect(hours.question).not.toContain('555');
    const price = await c.preview(own, { question: 'How much is a gel manicure?' });
    expect(price).toMatchObject({ outcome: 'answered', answer: expect.stringContaining('$35.00') });
    const nopr = await c.preview(own, { question: 'How much is the spa pedicure?' });
    expect(nopr).toMatchObject({ outcome: 'not_configured' });
    const who = await c.preview(own, { question: 'Who can do a gel manicure?' });
    expect(who.answer).toContain('Lan');
    expect((await c.preview(own, { question: 'Can I book tomorrow at 3 PM?' })).outcome).toBe('handoff');
    expect((await c.preview(own, { question: 'Where do I park?' })).outcome).toBe('handoff');   // the parking FAQs are drafts — never used
    expect((await c.preview(own, { question: 'What is your cancellation policy?' })).outcome).toBe('not_configured');
    expect(await q1(sql`select (select count(*) from appointment_schedule_locks)::int a, (select count(*) from notifications)::int n`)).toEqual(before);
    expect((await c.history(own, { basis: 'preview' })).totalItems).toBe(7);
  });
  it('SYNC01 + SYNC02: a price or hours change is in the next answer (read live, no stale copy)', async () => {
    await sql`update services set price_cents = 3900 where id = ${id('5a1')}`.execute(db);
    expect((await c.preview(own, { question: 'How much is a gel manicure?' })).answer).toContain('$39.00');
    await sql`update tenant_settings set settings_json = jsonb_set(settings_json, '{storeHours,monday}', '{"isOpen":false,"openTime":null,"closeTime":null}') where tenant_id = ${TA} and branch_id = ${BA}`.execute(db);
    expect((await c.preview(own, { question: 'Are you open Monday?' })).answer).toContain('Monday: closed');
  });
  it('SYNC05 + SYNC06: the health check lists each source separately; the provider is never "ready" from settings; it changes nothing', async () => {
    const before = await q1(sql`select (select count(*) from ai_receptionist_faqs)::int f, (select count(*) from ai_receptionist_faq_events)::int e`);
    const h = await c.health(own);
    expect(h.checks.map((x: any) => x.key)).toEqual(['tenant_branch', 'business_hours', 'services', 'technicians', 'staff_schedule', 'booking', 'approved_faqs', 'knowledge_sync', 'agent_knowledge', 'audit_jobs']);
    expect(h.checks.find((x: any) => x.key === 'knowledge_sync').status).toBe('READY');
    expect(h.checks.find((x: any) => x.key === 'agent_knowledge').status).toBe('DISABLED');
    expect(await q1(sql`select (select count(*) from ai_receptionist_faqs)::int f, (select count(*) from ai_receptionist_faq_events)::int e`)).toEqual(before);
  });
  it('Assistant: suggestions with reasons (missing price, unqualified service, unscheduled technician, FAQ gaps); it changes nothing', async () => {
    const a = await c.assistant(own);
    const keys = a.suggestions.map((s) => s.key);
    expect(keys).toEqual(expect.arrayContaining([`service_price:${id('5a2')}`, `service_no_tech:${id('5a2')}`, `tech_no_schedule:${id('7a2')}`, 'faq_gap:cancellation']));
    expect(keys).not.toContain('faq_gap:walk_ins');
    expect(a.suggestions.find((s) => s.key === 'faq_gap:cancellation')!.action.draftQuestion).toBe('What is your cancellation policy?');
  });
});
