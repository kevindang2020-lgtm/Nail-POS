// voice-calls-center.pgtest — Voice Transcription Search + Call History guides (Nov 3 2026; migration 777) on the REAL schema.
// SU = counters + empty reason · LI = search / history (what matches, scope, filters, dates, pages, excerpts never raw) ·
// DT = details overlay (audited, scoped, request never "booked") · HL = Check Voice Transcription System (read-only).
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { VoiceCallsCenter, VoiceCallsError, safeExcerpt } from './voice-calls-center';
import { KyselyVoiceTranscriptionRepository } from './ai-voice-transcription.kysely.repository';
import { VoiceTranscriptionService } from './ai-voice-transcription.service';
import { InMemoryVoiceEntitlement } from './ai-voice-transcription-entitlement';
import { MockTranscriptionProvider } from './ai-voice-transcription.provider';

const id = (n: number) => `77770000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1), B = id(2), B2 = id(3), X = id(4), BX = id(5), OWNER = id(10), C1 = id(20), C2 = id(21), CX = id(22);
const VIEW = ['ai_voice_transcription.view_transcripts'];
const ALL = [...VIEW, 'customers.view'];
const ctx = (o: any = {}) => ({ tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: ALL, ...o });
let pg: any; let db: any; let vc: VoiceCallsCenter;
const q = async (text: string, params: unknown[] = []) => (await pg.query(text, params)).rows as any[];
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof VoiceCallsError ? e.code : (e as Error).message; } }
let n = 100;
async function call(o: { t?: string; b?: string | null; cust?: string | null; status?: string; dir?: string; hoursAgo?: number; lines?: string[]; summary?: string | null;
  intents?: string[]; items?: { type: string; priority: string }[]; lang?: string; redaction?: string; ref?: string } = {}) {
  const C = id(++n);
  const t = o.t ?? T;
  await q(`insert into call_transcripts (id, tenant_id, branch_id, provider, provider_call_id, direction, status, redaction_status, customer_id, primary_language, segment_count, created_at, updated_at)
    values ($1,$2,$3,'retell',$4,$5,$6,$7,$8,$9,$10, now() - ($11 || ' hours')::interval, now() - ($11 || ' hours')::interval)`,
  [C, t, o.b === undefined ? B : o.b, o.ref ?? 'call-' + C, o.dir ?? 'inbound', o.status ?? 'completed', o.redaction ?? 'completed', o.cust === undefined ? C1 : o.cust, o.lang ?? 'en',
    (o.lines ?? []).length, String(o.hoursAgo ?? 1)]);
  let seq = 0;
  for (const l of o.lines ?? []) await q(`insert into call_transcript_segments (tenant_id, branch_id, transcript_id, seq, speaker_role, redacted_text, raw_text) values ($1,$2,$3,$4,'customer',$5,$6)`,
    [t, o.b === undefined ? B : o.b, C, ++seq, l, 'RAW ' + l]);
  if (o.summary !== null && (o.status ?? 'completed') === 'completed') await q(`insert into call_transcript_intelligence (tenant_id, branch_id, transcript_id, provider_call_id, quick_summary, intents, appointment, unresolved)
    values ($1,$2,$3,$4,$5,$6,$7,$8)`, [t, o.b === undefined ? B : o.b, C, 'call-' + C, o.summary ?? 'Caller asked a question',
    JSON.stringify((o.intents ?? []).map((i) => ({ intent: i, confidence: 0.9, evidenceSeq: [1] }))),
    JSON.stringify({ requestedServices: ['gel manicure'], requestedTechnician: null, preferredDate: 'Saturday', preferredTime: null, guests: null, confidence: 0.6 }),
    JSON.stringify((o.items ?? []).map((i) => ({ ...i, description: 'd', evidenceSeq: [1] })))]);
  return C;
}

beforeAll(async () => {
  pg = await migratedPglite();
  db = kyselyFor(pg);
  vc = new VoiceCallsCenter(db);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'S','Pilot','vc-777','VC777','active'), ($2,'X','Other','vc-777x','VC777X','active')`, [T, X]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','UTC'), ($3,$2,'North','active','UTC'), ($4,$5,'Other','active','UTC')`, [B, T, B2, BX, X]);
  await q(`insert into users (id, tenant_id, full_name, email, status, role) values ($1,$2,'Owner Kim','o@vc.test','active','OWNER')`, [OWNER, T]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone) values ($1,$4,$5,'Linh','Pham','Linh Pham','+18565550142'),
    ($2,$4,$5,'Mai','Tran','Mai Tran','+12155550199'), ($3,$6,$7,'Other','Guest','Other Guest','+18565550142')`, [C1, C2, CX, T, B, X, BX]);
  await q(`set timezone = 'UTC'`);
}, 180_000);

describe('Voice calls — empty states', () => {
  it('SU-01 no calls → "no_calls"; transcription turned off → "disabled" (never "nothing matches")', async () => {
    expect((await vc.summary(ctx()) as any).emptyReason).toBe('no_calls');
    expect((await vc.list(ctx(), {}) as any)).toMatchObject({ items: [], total: 0, totalPages: 1 });
    await q(`insert into voice_transcription_settings (tenant_id, transcription_enabled) values ($1, false)`, [T]);
    expect((await vc.summary(ctx()) as any).emptyReason).toBe('disabled');
    await q(`delete from voice_transcription_settings where tenant_id = $1`, [T]);
  });
  it('SU-02 needs the transcript permission', async () => {
    expect(await code(vc.list(ctx({ permissions: ['customers.view'] }), {}))).toBe('PERMISSION_DENIED');
    expect(await code(vc.check(ctx({ permissions: [] })))).toBe('PERMISSION_DENIED');
  });
});

let A: string, Bc: string, Cc: string, D: string, E: string, F: string, G: string;
describe('Search and Call History', () => {
  beforeAll(async () => {
    A = await call({ hoursAgo: 2, lines: ['Hi, do you have time for a gel manicure on Saturday?', 'My card is [CARD]'], intents: ['new_booking'], items: [{ type: 'callback_requested', priority: 'high' }] });
    Bc = await call({ hoursAgo: 5, cust: C2, lines: ['I want a refund for my pedicure'], intents: ['refund'], summary: 'Refund request for pedicure', lang: 'vi' });
    Cc = await call({ hoursAgo: 30, cust: null, dir: 'outbound', lines: ['Calling to confirm tomorrow'], intents: ['confirmation'] });
    D = await call({ hoursAgo: 3, status: 'processing', summary: null, lines: [] });
    E = await call({ hoursAgo: 4, b: B2, lines: ['gel manicure at North'] });                   // another branch
    F = await call({ hoursAgo: 4, t: X, b: BX, cust: CX, lines: ['gel manicure elsewhere'] });   // another salon
    G = await call({ hoursAgo: 6, b: null, lines: ['salon-wide line gel'] });                   // salon-wide number
  });
  it('LI-01 history: newest first, this branch + salon-wide calls, never another branch or salon; row model', async () => {
    const l: any = await vc.list(ctx(), {});
    expect(l.items.map((r: any) => r.id)).toEqual([A, D, Bc, G, Cc]);
    const a = l.items[0];
    expect(a).toMatchObject({ direction: 'inbound', statusGroup: 'completed', hasSummary: true, customer: 'Linh Pham', phoneLast4: '0142', customerLinked: true, intents: ['new_booking'] });
    expect(a.followUp).toEqual({ state: 'open', open: 1, inTask: 0, items: 1 });
    expect(l.items.find((r: any) => r.id === D)).toMatchObject({ statusGroup: 'processing', hasSummary: false });
    expect((await vc.list(ctx({ branchId: null }), {}) as any).total).toBe(6);   // salon-wide login: both branches, never another salon
  });
  it('LI-02 search: transcript words (redacted text only), summary, intent, customer name, phone digits, call id — each says what matched', async () => {
    const s1: any = await vc.list(ctx(), { q: 'gel manicure' });
    expect(s1.items.map((r: any) => r.id)).toEqual([A]);
    expect(s1.items[0]).toMatchObject({ matchType: 'transcript' });
    expect(s1.items[0].excerpt).toContain('gel manicure');
    expect((await vc.list(ctx(), { q: 'RAW' }) as any).total).toBe(0);                     // raw text is never searched
    expect((await vc.list(ctx(), { q: 'refund' }) as any).items[0]).toMatchObject({ id: Bc });
    expect((await vc.list(ctx(), { q: 'Mai Tran' }) as any).items.map((r: any) => [r.id, r.matchType])).toEqual([[Bc, 'customer']]);
    expect((await vc.list(ctx(), { q: '555-0142' }) as any).items.map((r: any) => [r.id, r.matchType])).toEqual([[A, 'phone'], [D, 'phone'], [G, 'phone']]);
    expect((await vc.list(ctx(), { q: 'call-' + Cc }) as any).items.map((r: any) => [r.id, r.matchType])).toEqual([[Cc, 'call_id']]);
    expect((await vc.list(ctx(), { q: 'confirmation' }) as any).items.map((r: any) => r.id)).toEqual([Cc]);
  });
  it('LI-03 without customers.view: no names, no phones, no name or phone search', async () => {
    const l: any = await vc.list(ctx({ permissions: VIEW }), {});
    expect(l.items[0]).toMatchObject({ customer: null, phoneLast4: null, customerLinked: true });
    expect((await vc.list(ctx({ permissions: VIEW }), { q: 'Mai Tran' }) as any).total).toBe(0);
    expect((await vc.list(ctx({ permissions: VIEW }), { q: '0142' }) as any).total).toBe(0);
  });
  it('LI-04 filters: status group, direction, language, intent, follow-up state', async () => {
    expect((await vc.list(ctx(), { status: 'processing' }) as any).items.map((r: any) => r.id)).toEqual([D]);
    expect((await vc.list(ctx(), { direction: 'outbound' }) as any).items.map((r: any) => r.id)).toEqual([Cc]);
    expect((await vc.list(ctx(), { language: 'vi' }) as any).items.map((r: any) => r.id)).toEqual([Bc]);
    expect((await vc.list(ctx(), { intent: 'refund' }) as any).items.map((r: any) => r.id)).toEqual([Bc]);
    expect((await vc.list(ctx(), { followUp: 'open' }) as any).items.map((r: any) => r.id)).toEqual([A]);
    expect((await vc.list(ctx(), { followUp: 'none' }) as any).total).toBe(4);
  });
  it('LI-05 dates in salon time: presets and From/To; From after To refused', async () => {
    const today = (await vc.list(ctx(), {}) as any).period.today as string;
    expect((await vc.list(ctx(), { preset: 'custom', from: today, to: today }) as any).items.map((r: any) => r.id).includes(Cc)).toBe(new Date(Date.now() - 30 * 3600e3).toISOString().slice(0, 10) === today);
    expect(await code(vc.list(ctx(), { preset: 'custom', from: today, to: '2020-01-01' }))).toBe('VC_INVALID_PERIOD');
    expect(await code(vc.list(ctx(), { preset: 'custom', from: 'nope', to: today }))).toBe('VC_INVALID_PERIOD');
    expect((await vc.list(ctx(), { preset: 'last_7' }) as any).total).toBe(5);
  });
  it('LI-06 pages: numbered, totals, stable order; page sizes fall back to 25; oldest first', async () => {
    const p1: any = await vc.list(ctx(), { pageSize: 10 });
    expect(p1).toMatchObject({ total: 5, totalPages: 1, pageSize: 10 });
    expect((await vc.list(ctx(), { pageSize: 10, page: 2 }) as any).items).toEqual([]);
    expect((await vc.list(ctx(), { pageSize: 3 }) as any).pageSize).toBe(25);
    expect((await vc.list(ctx(), { sort: 'oldest' }) as any).items.map((r: any) => r.id)).toEqual([Cc, G, Bc, D, A]);
  });
  it('LI-07 an excerpt is re-redacted: a card number that slipped into stored text never reaches the screen', () => {
    expect(safeExcerpt('my card is 4111 1111 1111 1111 thanks', ['card'])).not.toContain('4111 1111');
  });
});

describe('Call details overlay', () => {
  it('DT-01 transcript in order with speakers, summary, the request marked unverified (never booked), follow-up items; audited', async () => {
    const d: any = await vc.call(ctx(), A);
    expect(d.call).toMatchObject({ id: A, statusGroup: 'completed', branch: 'Main' });
    expect(d.transcript.map((s: any) => s.seq)).toEqual([1, 2]);
    expect(d.transcript[0].text).toContain('gel manicure');
    expect(JSON.stringify(d)).not.toContain('RAW ');
    expect(d.request).toMatchObject({ services: ['gel manicure'], date: 'Saturday', state: 'requested_unverified' });
    expect(d.followUps).toEqual([expect.objectContaining({ type: 'callback_requested', state: 'open', taskId: null })]);
    expect(d.customer).toMatchObject({ linked: true, name: 'Linh Pham', phoneLast4: '0142' });
    const a = await q(`select action, resource_id from audit_events where tenant_id = $1 and action = 'voice_transcript.viewed'`, [T]);
    expect(a.map((r) => r.resource_id)).toContain(A);
  });
  it('DT-02 another branch, another salon, a bad id → not found', async () => {
    expect(await code(vc.call(ctx(), E))).toBe('VC_CALL_NOT_FOUND');
    expect(await code(vc.call(ctx(), F))).toBe('VC_CALL_NOT_FOUND');
    expect(await code(vc.call(ctx(), 'x'))).toBe('VC_CALL_NOT_FOUND');
    expect((await vc.call(ctx({ branchId: null }), E) as any).call.id).toBe(E);
  });
  it('DT-03 the old detail page and lists are branch-scoped too: a branch login cannot open or list another branch\'s call, even by asking for it', async () => {
    const svc = new VoiceTranscriptionService(new KyselyVoiceTranscriptionRepository(db), new MockTranscriptionProvider(), new InMemoryVoiceEntitlement(() => true));
    const sctx = { tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: ['ai_voice_transcription.view', 'ai_voice_transcription.view_transcripts'] } as any;
    await expect(svc.getTranscript(sctx, E)).rejects.toThrow();
    expect((await svc.getTranscript(sctx, A)).header.id).toBe(A);
    expect((await svc.getTranscript(sctx, G)).header.id).toBe(G);                         // salon-wide call
    const listed = (await svc.listTranscripts(sctx, { branchId: B2, limit: 100 })).items.map((h: any) => h.id);
    expect(listed).not.toContain(E);
    const found = (await svc.search(sctx, { q: 'gel', branchId: B2 })).items.map((i: any) => i.header.id);
    expect(found).not.toContain(E);
    expect(found).toContain(A);
  });
});

describe('Check Voice Transcription System', () => {
  const byKey = (h: any) => Object.fromEntries(h.checks.map((c: any) => [c.key, c]));
  it('HL-01 healthy enough: calls arriving, redaction done, nothing searchable leaks; no provider key → warning; read-only; reused within 30 s', async () => {
    const before = (await q(`select count(*)::int as n from call_transcripts`))[0].n;
    const h: any = await vc.check(ctx());
    const k = byKey(h);
    expect(k.calls_arriving.state).toBe('PASSED');
    expect(k.provider_connection.state).toBe('WARNING');
    expect(k.redaction.state).toBe('PASSED');
    expect(k.no_card_numbers_searchable.state).toBe('PASSED');
    expect(k.deletions_propagated.state).toBe('PASSED');
    expect(k.tenant_isolation.state).toBe('PASSED');
    expect(k.branch_mapping).toMatchObject({ state: 'WARNING', count: 1 });   // the salon-wide call, two branches
    expect(h.overall).toBe('WARNING');
    expect(h.checks[0].state).toBe('WARNING');
    expect((await q(`select count(*)::int as n from call_transcripts`))[0].n).toBe(before);
    expect((await vc.check(ctx()) as any).reused).toBe(true);
  });
  it('HL-02 a card number in searchable text, an unredacted finished call, a deleted call whose text survived → FAILED; last success kept', async () => {
    await q(`update voice_system_health_runs set created_at = now() - interval '1 hour' where tenant_id = $1`, [T]);
    await call({ hoursAgo: 1, lines: ['card 4111 1111 1111 1111'] });
    const U = await call({ hoursAgo: 2, redaction: 'pending', lines: ['x'] });
    await q(`update call_transcripts set updated_at = now() - interval '2 hours' where id = $1`, [U]);
    const Z = await call({ hoursAgo: 3, lines: ['deleted words'] });
    await q(`update call_transcripts set deleted_at = now() where id = $1`, [Z]);
    await q(`insert into voice_integration_keys (tenant_id, branch_id, label, prefix, secret_hash, last_used_at) values ($1,$2,'Retell','vk_live_x','h1', now())`, [T, B]);
    const k = byKey(await vc.check(ctx()));
    expect(k.no_card_numbers_searchable).toMatchObject({ state: 'FAILED', count: 1 });
    expect(k.redaction).toMatchObject({ state: 'FAILED', count: 1 });
    expect(k.deletions_propagated.state).toBe('FAILED');
    expect(k.provider_connection.state).toBe('PASSED');
    expect(k.redaction.lastPassedAt).not.toBeNull();
  });
});
