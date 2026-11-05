// tech-dm.pgtest.vitest.spec.ts — Phase 5: customer ↔ technician direct messaging, with the booked-only gate,
// the accepts-messages switch, unread counters, blocking, and participant isolation.
import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { TechProfileService } from './tech-profile.service';

class PgliteDriver {
  constructor(private pg: PGlite) {}
  async init() {}
  async acquireConnection() {
    const pg = this.pg;
    return { async executeQuery(q: any) { const r: any = await pg.query(q.sql, [...(q.parameters ?? [])]); return { rows: r.rows ?? [], numAffectedRows: BigInt(r.affectedRows ?? 0) }; }, streamQuery() { throw new Error('no'); } } as any;
  }
  async beginTransaction(c: any) { await c.executeQuery({ sql: 'begin', parameters: [] }); }
  async commitTransaction(c: any) { await c.executeQuery({ sql: 'commit', parameters: [] }); }
  async rollbackTransaction(c: any) { await c.executeQuery({ sql: 'rollback', parameters: [] }); }
  async releaseConnection() {}
  async destroy() {}
}

const T = 'da000000-0000-0000-0000-000000000001';
const BR = 'da000000-0000-0000-0000-0000000000b1';
const GA = 'da000000-0000-0000-0000-0000000000a1';   // tech profile
const UA = 'da000000-0000-0000-0000-0000000000f1';   // tech's user
const TA = 'da000000-0000-0000-0000-0000000000d1';   // technicians row
const CU = 'da000000-0000-0000-0000-0000000000f2';   // booked customer's user
const CUST = 'da000000-0000-0000-0000-0000000000c1'; // booked customer row
const CU2 = 'da000000-0000-0000-0000-0000000000f3';  // non-booked customer's user
const CUST2 = 'da000000-0000-0000-0000-0000000000c2';
const TK = 'da000000-0000-0000-0000-0000000000e1';   // the booking (ticket)

const techCtx: any = { tenantId: T, branchId: BR, userId: UA, role: 'TECH', permissions: [] };
const custCtx: any = { tenantId: T, branchId: BR, userId: CU, role: 'CUSTOMER', permissions: [] };
const cust2Ctx: any = { tenantId: T, branchId: BR, userId: CU2, role: 'CUSTOMER', permissions: [] };

let svc: TechProfileService;
let pg: PGlite;
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows);

beforeAll(async () => {
  pg = new PGlite();
  const dir = MIGRATIONS_DIR;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0))) {
    try { await pg.exec(readFileSync(join(dir, f), 'utf8').replace(/CREATE\s+EXTENSION[^;]*;/gi, '')); } catch { /* tolerated */ }
  }
  const db = new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg) as any, createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
  svc = new TechProfileService(db as any, null as any);

  await q(`insert into users (id, role) values ($1,'TECHNICIAN'),($2,'CUSTOMER'),($3,'CUSTOMER')`, [UA, CU, CU2]);
  await q(`insert into global_tech_profiles (id, tech_code, public_slug, display_name, is_public, accepts_messages) values ($1,'TA','tech-a','Tech A',true,true)`, [GA]);
  // the salon exists (a customer must belong to a real tenant — fk_customers_tenant, Phase 10 migration 538)
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'DM Salon','DM Salon','dm-salon-p10','DMP10','active') on conflict do nothing`, [T]);
  await q(`insert into technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, is_active, global_tech_profile_id) values ($1,$2,$3,$4,'Tech','A','Tech A',true,$5)`, [TA, T, BR, UA, GA]);
  await q(`insert into customers (id, tenant_id, branch_id, user_id, first_name, last_name, full_name) values ($1,$2,'da000000-0000-0000-0000-0000000000b1',$3,'Booked','Cust','Booked Cust'),($4,$2,'da000000-0000-0000-0000-0000000000b1',$5,'Other','Cust','Other Cust')`, [CUST, T, CU, CUST2, CU2]);
  // the booking that unlocks messaging
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, primary_technician_id) values ($1,$2,$3,$4,$5)`, [TK, T, BR, CUST, TA]);
});

describe('customer ↔ technician DMs (Phase 5)', () => {
  it('a customer who has not booked cannot open a thread', async () => {
    await expect(svc.customerOpenThread(cust2Ctx, 'tech-a')).rejects.toMatchObject({ code: 'not_booked' });
  });

  it('respects the technician accepts-messages switch', async () => {
    await q(`update global_tech_profiles set accepts_messages=false where id=$1`, [GA]);
    await expect(svc.customerOpenThread(custCtx, 'tech-a')).rejects.toMatchObject({ code: 'messaging_off' });
    await q(`update global_tech_profiles set accepts_messages=true where id=$1`, [GA]);
  });

  it('a booked customer opens a thread, both sides message, unread counters track the recipient', async () => {
    const opened: any = await svc.customerOpenThread(custCtx, 'tech-a');
    const threadId = opened.threadId;
    expect(opened.status).toBe('active');

    await svc.customerSendMessage(custCtx, threadId, 'Hi! Loved my last set — can I rebook the same design?');
    // technician sees the thread with one unread, then reading clears it
    const tThreads: any = await svc.technicianListThreads(techCtx);
    expect(tThreads.threads[0].technicianUnread).toBe(1);
    const tMsgs: any = await svc.technicianListMessages(techCtx, threadId);
    expect(tMsgs.messages.map((m: any) => m.sender)).toEqual(['customer']);
    expect((await svc.technicianListThreads(techCtx)).threads[0].technicianUnread).toBe(0);

    await svc.technicianSendMessage(techCtx, threadId, 'Of course — how about Friday?');
    const cMsgs: any = await svc.customerListMessages(custCtx, threadId);
    expect(cMsgs.messages.map((m: any) => m.sender)).toEqual(['customer', 'technician']);
  });

  it('blocking closes the thread to further messages', async () => {
    const opened: any = await svc.customerOpenThread(custCtx, 'tech-a');
    await svc.blockThread(custCtx, opened.threadId, 'customer');
    await expect(svc.customerSendMessage(custCtx, opened.threadId, 'more')).rejects.toMatchObject({ code: 'blocked' });
    await expect(svc.technicianSendMessage(techCtx, opened.threadId, 'reply')).rejects.toMatchObject({ code: 'blocked' });
  });

  it('a non-participant cannot read a thread', async () => {
    const opened: any = await svc.customerOpenThread(custCtx, 'tech-a');
    await expect(svc.customerListMessages(cust2Ctx, opened.threadId)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('super admin scoped pause hides the public profile and blocks messaging (enforced on the customer paths)', async () => {
    await q(`update global_tech_profiles set admin_profile_hidden=true where id=$1`, [GA]);
    await expect(svc.customerPublicProfile(custCtx, 'tech-a')).rejects.toMatchObject({ code: 'not_found' });
    await q(`update global_tech_profiles set admin_profile_hidden=false, admin_messaging_paused=true where id=$1`, [GA]);
    await expect(svc.customerOpenThread(custCtx, 'tech-a')).rejects.toMatchObject({ code: 'messaging_off' });
    await q(`update global_tech_profiles set admin_messaging_paused=false where id=$1`, [GA]);
  });

  it('verification + moderation: request → pending → super admin verifies; a report enters the queue and resolves', async () => {
    expect((await svc.requestVerification(techCtx)).verificationStatus).toBe('pending');
    expect((await svc.saListPendingVerifications()).verifications.map((v: any) => v.publicSlug)).toContain('tech-a');
    await svc.saSetVerification(techCtx, GA, 'verified');
    expect(((await q(`select verification_status from global_tech_profiles where id=$1`, [GA]))[0] as any).verification_status).toBe('verified');
    expect((await svc.saListPendingVerifications()).verifications.length).toBe(0);
    const opened: any = await svc.customerOpenThread(custCtx, 'tech-a');
    await svc.reportThread(custCtx, opened.threadId, 'customer', 'inappropriate');
    const mine = (await svc.saListDmReports()).reports.find((r: any) => r.threadId === opened.threadId);
    expect(mine).toBeTruthy();
    await svc.saResolveDmReport(techCtx, mine.reportId, 'block_thread');
    expect((await svc.saListDmReports()).reports.find((r: any) => r.reportId === mine.reportId)).toBeUndefined();
    expect(((await q(`select status from tech_dm_threads where id=$1`, [opened.threadId]))[0] as any).status).toBe('blocked_by_technician');
  });

  it('analytics aggregate only real recorded events, and the client-reported channel is whitelisted', async () => {
    await svc.customerPublicProfile(custCtx, 'tech-a'); // a real profile load → profile_view
    // opening a thread (done in earlier tests) recorded message_open; add taps.
    await svc.customerRecordEvent(custCtx, 'tech-a', 'link_click', 'instagram');
    await svc.customerRecordEvent(custCtx, 'tech-a', 'link_click', 'instagram');
    await svc.customerRecordEvent(custCtx, 'tech-a', 'post_tap', 'post-xyz');
    await expect(svc.customerRecordEvent(custCtx, 'tech-a', 'profile_view')).rejects.toMatchObject({ code: 'invalid' }); // can't forge views
    const a: any = await svc.technicianAnalytics(techCtx, 30);
    expect(a.totals.profileViews).toBeGreaterThanOrEqual(1);
    expect(a.totals.messagesOpened).toBeGreaterThanOrEqual(1);
    expect(a.totals.linkClicks).toBe(2);
    expect(a.totals.postTaps).toBe(1);
    expect(a.topLinks[0]).toEqual({ ref: 'instagram', count: 2 });
    expect(a.dailyViews.length).toBeGreaterThanOrEqual(1);
  });
});
