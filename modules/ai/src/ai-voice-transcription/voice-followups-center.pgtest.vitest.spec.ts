// voice-followups-center.pgtest — Voice Transcription Follow-Ups guide (Nov 2 2026; migration 775) on the REAL migrated schema.
// SU = counters + empty-state reason · LI = list (tabs, priority across ALL calls, search, dates, pages, scope) ·
// TK = create task (one task system, link not duplicate) · DR = dismiss / reopen (append-only) · HL = check (read-only).
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { VoiceFollowUpsCenter, VoiceFollowUpError } from './voice-followups-center';

const id = (n: number) => `77750000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1), B = id(2), B2 = id(3), X = id(4), BX = id(5), OWNER = id(10), DESK = id(11), C1 = id(20), CX = id(21);
const WORK = ['ai_voice_transcription.view_transcripts', 'communications.manage', 'customers.view'];
const ctx = (o: any = {}) => ({ tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: WORK, ...o });
let pg: any; let db: any; let vf: VoiceFollowUpsCenter;
const q = async (text: string, params: unknown[] = []) => (await pg.query(text, params)).rows as any[];
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof VoiceFollowUpError ? e.code : (e as Error).message; } }
let n = 100;
async function callWith(items: { type: string; priority: string }[], o: { t?: string; b?: string; daysAgo?: number; cust?: string | null; status?: string } = {}) {
  const C = id(++n);
  await q(`insert into call_transcripts (id, tenant_id, branch_id, provider, provider_call_id, status, redaction_status, customer_id, segment_count, created_at, updated_at)
    values ($1,$2,$3,'retell',$4,$5,'completed',$6,3, now() - ($7 || ' days')::interval, now() - ($7 || ' days')::interval)`,
  [C, o.t ?? T, o.b ?? B, 'call-' + C, o.status ?? 'completed', o.cust === undefined ? C1 : o.cust, String(o.daysAgo ?? 0)]);
  if (items.length || (o.status ?? 'completed') === 'completed') await q(`insert into call_transcript_intelligence (tenant_id, branch_id, transcript_id, provider_call_id, quick_summary, intents, appointment, unresolved)
    values ($1,$2,$3,$4,'x','[]','{}',$5)`, [o.t ?? T, o.b ?? B, C, 'call-' + C, JSON.stringify(items.map((i) => ({ ...i, description: 'd', evidenceSeq: [] })))]);
  return C;
}

beforeAll(async () => {
  pg = await migratedPglite();
  db = kyselyFor(pg);
  vf = new VoiceFollowUpsCenter(db);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'S','Pilot','vf-775','VF775','active'), ($2,'X','Other','vf-775x','VF775X','active')`, [T, X]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$2,'North','active','America/New_York'), ($4,$5,'Other','active','America/New_York')`, [B, T, B2, BX, X]);
  await q(`insert into users (id, tenant_id, full_name, email, status, role) values ($1,$3,'Owner Kim','o@vf.test','active','OWNER'), ($2,$3,'Desk Mai','d@vf.test','active','FRONT_DESK')`, [OWNER, DESK, T]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone) values ($1,$3,$4,'Linh','Pham','Linh Pham','+18565550142'), ($2,$5,$6,'Other','Guest','Other Guest','+18565550142')`, [C1, CX, T, B, X, BX]);
}, 180_000);

describe('Voice follow-ups — counters and the empty state', () => {
  it('SU-01 no calls → "no_calls", never "every call is resolved"', async () => {
    const s: any = await vf.summary(ctx());
    expect(s.counters.open).toBe(0);
    expect(s.emptyReason).toBe('no_calls');
  });
  it('SU-02 a provider error in the last day → "pipeline_errors"; only clean, extracted calls → "none_open"', async () => {
    const E = await callWith([], { status: 'provider_error' });
    expect((await vf.summary(ctx()) as any).emptyReason).toBe('pipeline_errors');
    await q(`update call_transcripts set created_at = now() - interval '3 days' where id = $1`, [E]);
    await callWith([]);
    expect((await vf.summary(ctx()) as any).emptyReason).toBe('none_open');
  });
  it('SU-03 counters: open, urgent (health / safety or high), and the urgent lane oldest first', async () => {
    await callWith([{ type: 'callback_requested', priority: 'high' }, { type: 'refund_requested', priority: 'medium' }], { daysAgo: 1 });
    await callWith([{ type: 'health_safety', priority: 'high' }], { daysAgo: 0 });
    await callWith([{ type: 'pricing_unanswered', priority: 'medium' }], { b: B2 });          // another branch
    await callWith([{ type: 'complaint', priority: 'medium' }], { t: X, b: BX, cust: CX });  // another salon
    const s: any = await vf.summary(ctx());
    expect(s.counters).toMatchObject({ open: 3, urgent: 2, inTask: 0, overdue: 0 });
    expect(s.urgent.map((u: any) => u.type)).toEqual(['health_safety', 'callback_requested']);
    expect(s.urgent[0].priority).toBe('urgent');
    expect(s.emptyReason).toBeNull();
  });
});

describe('Voice follow-ups — list', () => {
  it('LI-01 one row per call + item; this branch (and salon-wide) only; priority sort spans ALL calls (not the newest 100)', async () => {
    for (let i = 0; i < 3; i++) await callWith([{ type: 'pricing_unanswered', priority: 'medium' }]);
    const old = await callWith([{ type: 'manager_requested', priority: 'high' }], { daysAgo: 200 });
    const all: any = await vf.list(ctx(), { pageSize: '10' });
    expect(all.total).toBe(7);
    expect(all.items.every((x: any) => x.state === 'open')).toBe(true);
    const pr: any = await vf.list(ctx(), { sort: 'priority', pageSize: '10' });
    expect(pr.items.slice(0, 3).map((x: any) => x.type)).toEqual(['health_safety', 'callback_requested', 'manager_requested']);
    expect(pr.items[2].transcriptId).toBe(old);
    const p2: any = await vf.list(ctx(), { pageSize: '10', page: '2' });
    expect(p2.items).toHaveLength(0);
  });
  it('LI-02 search (customer name / phone only with customers.view, type, call id), type filter, dates, invalid range', async () => {
    expect((await vf.list(ctx(), { q: 'Linh' }) as any).total).toBe(7);
    expect((await vf.list(ctx(), { q: '555-0142' }) as any).total).toBe(7);
    expect((await vf.list(ctx({ permissions: ['ai_voice_transcription.view_transcripts'] }), { q: 'Linh' }) as any).total).toBe(0);
    expect((await vf.list(ctx({ permissions: ['ai_voice_transcription.view_transcripts'] }), {}) as any).items[0].customer).toBeNull();
    expect((await vf.list(ctx(), { type: 'refund_requested' }) as any).total).toBe(1);
    expect((await vf.list(ctx(), { preset: 'last_7' }) as any).total).toBe(6);
    expect(await code(vf.list(ctx(), { from: '2026-10-05', to: '2026-10-01' }))).toBe('VF_INVALID_PERIOD');
    expect(await code(vf.list(ctx({ permissions: [] }), {}))).toBe('PERMISSION_DENIED');
  });
});

describe('Voice follow-ups — create task, dismiss, reopen', () => {
  it('TK-01 a task in the ONE task system: reason mapped, priority, assignee, activity + audit + review in one transaction; idempotent', async () => {
    const item = (await vf.list(ctx(), { type: 'callback_requested' }) as any).items[0];
    expect(await code(vf.createTask(ctx({ permissions: ['ai_voice_transcription.view_transcripts'] }), { transcriptId: item.transcriptId, type: 'callback_requested' }))).toBe('PERMISSION_DENIED');
    expect(await code(vf.createTask(ctx(), { transcriptId: item.transcriptId, type: 'callback_requested', assignedUserId: id(99) }))).toBe('FOLLOWUP_ASSIGNEE_INVALID');
    const r: any = await vf.createTask(ctx(), { transcriptId: item.transcriptId, type: 'callback_requested', assignedUserId: DESK, dueLocal: '2026-11-03T10:00' });
    const t = (await q(`select reason, priority, status, assigned_user_id, provider_call_id, source, customer_id from ai_receptionist_follow_ups where id = $1`, [r.followUpId]))[0];
    expect(t).toMatchObject({ reason: 'CALLBACK', priority: 'high', status: 'assigned', assigned_user_id: DESK, provider_call_id: 'call-' + item.transcriptId, source: 'voice_transcription', customer_id: C1 });
    expect((await q(`select event_type from ai_follow_up_activity where follow_up_id = $1`, [r.followUpId])).map((x) => x.event_type)).toEqual(['created']);
    expect((await q(`select count(*)::int as n from audit_events where tenant_id = $1 and action = 'voice_followup.task_created'`, [T]))[0].n).toBe(1);
    expect(await vf.createTask(ctx(), { transcriptId: item.transcriptId, type: 'callback_requested' })).toMatchObject({ followUpId: r.followUpId, duplicate: true });
    const after: any = await vf.list(ctx(), { tab: 'in_task' });
    expect(after.items[0]).toMatchObject({ state: 'in_task', task: { status: 'assigned', assignee: 'Desk Mai' } });
    expect((await vf.summary(ctx()) as any).counters).toMatchObject({ open: 6, inTask: 1 });
  });
  it('TK-02 an open task for the same call and reason already exists (AI receptionist) → LINKED, never a second task', async () => {
    const item = (await vf.list(ctx(), { type: 'refund_requested' }) as any).items[0];
    const pre = (await q(`insert into ai_receptionist_follow_ups (tenant_id, branch_id, reason, priority, status, provider_call_id, source) values ($1,$2,'REFUND_REQUEST','normal','open',$3,'ai_receptionist') returning id`,
      [T, B, 'call-' + item.transcriptId]))[0].id;
    const r: any = await vf.createTask(ctx(), { transcriptId: item.transcriptId, type: 'refund_requested' });
    expect(r).toMatchObject({ followUpId: pre, linked: true });
    expect((await q(`select count(*)::int as n from ai_receptionist_follow_ups where provider_call_id = $1 and reason = 'REFUND_REQUEST'`, ['call-' + item.transcriptId]))[0].n).toBe(1);
  });
  it('TK-03 the task resolved in the task system → the item is resolved; reopen needs a reason and makes it open again', async () => {
    const item = (await vf.list(ctx(), { tab: 'in_task', type: 'callback_requested' }) as any).items[0];
    await q(`update ai_receptionist_follow_ups set status = 'resolved', resolved_at = now() where id = $1`, [item.task.id]);
    expect((await vf.list(ctx(), { tab: 'resolved' }) as any).items.map((x: any) => x.type)).toContain('callback_requested');
    expect(await code(vf.reopen(ctx(), { transcriptId: item.transcriptId, type: 'callback_requested', reason: '' }))).toBe('VF_REASON_REQUIRED');
    await vf.reopen(ctx(), { transcriptId: item.transcriptId, type: 'callback_requested', reason: 'customer called again' });
    expect((await vf.list(ctx(), { type: 'callback_requested' }) as any).items[0].state).toBe('open');
  });
  it('DR-01 dismiss needs a reason, only from open; append-only history newest first', async () => {
    const item = (await vf.list(ctx(), { type: 'pricing_unanswered' }) as any).items[0];
    expect(await code(vf.dismiss(ctx(), { transcriptId: item.transcriptId, type: 'pricing_unanswered', reason: 'no' }))).toBe('VF_REASON_REQUIRED');
    await vf.dismiss(ctx(), { transcriptId: item.transcriptId, type: 'pricing_unanswered', reason: 'price was texted after the call' });
    expect(await code(vf.dismiss(ctx(), { transcriptId: item.transcriptId, type: 'pricing_unanswered', reason: 'again please' }))).toBe('VF_NOT_OPEN');
    const h: any = await vf.history(ctx(), item.transcriptId, 'pricing_unanswered');
    expect(h.items[0]).toMatchObject({ decision: 'dismissed', reason: 'price was texted after the call', by: 'Owner Kim' });
    expect(await code(vf.dismiss(ctx(), { transcriptId: id(999), type: 'complaint', reason: 'not here' }))).toBe('NOT_FOUND');
  });
});

describe('Voice follow-ups — Check Voice Follow-Up System', () => {
  it('HL-01 read-only evidence: an urgent item unreviewed over a day FAILS; nothing is written but the run', async () => {
    await callWith([{ type: 'health_safety', priority: 'high' }], { daysAgo: 2 });
    const before = (await q(`select (select count(*) from voice_followup_reviews)::int as r, (select count(*) from ai_receptionist_follow_ups)::int as f`))[0];
    const r: any = await vf.check(ctx());
    const by = Object.fromEntries(r.checks.map((c: any) => [c.key, c]));
    expect(r.overall).toBe('FAILED');
    expect(by.urgent_reviewed).toMatchObject({ state: 'FAILED' });
    expect(by.urgent_reviewed.count).toBeGreaterThanOrEqual(1);
    expect(by.no_duplicate_tasks.state).toBe('PASSED');
    expect(by.task_links.state).toBe('PASSED');
    expect(by.tenant_isolation.state).toBe('PASSED');
    expect(by.calls_arriving.state).toBe('PASSED');
    expect((await vf.check(ctx()) as any)).toMatchObject({ reused: true, id: r.id });
    expect((await q(`select (select count(*) from voice_followup_reviews)::int as r, (select count(*) from ai_receptionist_follow_ups)::int as f`))[0]).toEqual(before);
  });
});
