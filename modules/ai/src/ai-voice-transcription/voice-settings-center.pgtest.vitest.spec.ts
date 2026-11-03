// voice-settings-center.pgtest — Voice Transcription Settings guide (Nov 2 2026; migration 774) on the REAL migrated schema.
// SV = saving (version, confirmation, re-dating, raw purge, history) · FC = fail closed · RA = raw access log ·
// SU = status row · RC = Records · HL = Check Voice Transcription Settings (read-only).
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyVoiceTranscriptionRepository } from './ai-voice-transcription.kysely.repository';
import { VoiceTranscriptionService } from './ai-voice-transcription.service';
import { InMemoryVoiceEntitlement } from './ai-voice-transcription-entitlement';
import { VoiceSettingsConflictError, VoiceSettingsConfirmRequiredError, VoiceSettingsUnavailableError } from './ai-voice-transcription.dto';
import { VoiceSettingsCenter, VoiceCenterError } from './voice-settings-center';

const id = (n: number) => `77740000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1), B = id(2), X = id(3), BX = id(4), OWNER = id(10), MGR = id(11);
const ALL = ['ai_voice_transcription.view', 'ai_voice_transcription.view_transcripts', 'ai_voice_transcription.manage_rules', 'ai_voice_transcription.manage_settings', 'ai_voice_transcription.view_raw'];
const ctx = (o: any = {}) => ({ tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: ALL, ...o });
const provider = { name: 'retell', async fetchTranscript() { return { segments: [], meta: { direction: 'inbound' as const, handler: 'ai' as const, agentChannel: 0 }, durationSeconds: 0, providerTranscriptRef: 'r' }; }, async deleteRecording() { return { deleted: true }; }, async healthy() { return true; } };
let pg: any; let db: any; let repo: KyselyVoiceTranscriptionRepository; let svc: VoiceTranscriptionService; let vc: VoiceSettingsCenter;
let healthy: boolean | null = true; let entitled = true;
const q = async (text: string, params: unknown[] = []) => (await pg.query(text, params)).rows as any[];
async function err(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e; } }
let n = 100;
async function call(o: { t?: string; daysAgo?: number; status?: string; raw?: boolean; hold?: boolean; redaction?: string; deleted?: boolean; expiresInDays?: number | null; segRaw?: string | null } = {}) {
  const C = id(++n);
  const days = o.daysAgo ?? 0;
  await q(`insert into call_transcripts (id, tenant_id, branch_id, provider, provider_call_id, status, redaction_status, raw_available, legal_hold, retention_expires_at, deleted_at, segment_count, created_at, updated_at)
    values ($1,$2,$3,'retell',$4,$5,$6,$7,$8, ${o.expiresInDays === null ? 'null' : `now() - interval '${days} days' + interval '${o.expiresInDays ?? 365} days'`}, ${o.deleted ? 'now()' : 'null'}, 1,
      now() - interval '${days} days', now() - interval '${days} days')`,
  [C, o.t ?? T, o.t === X ? BX : B, 'call-' + C, o.status ?? 'completed', o.redaction ?? 'completed', !!o.raw, !!o.hold]);
  await q(`insert into call_transcript_segments (tenant_id, branch_id, transcript_id, seq, redacted_text, raw_text) values ($1,$2,$3,0,'my card is [REDACTED]',$4)`,
    [o.t ?? T, o.t === X ? BX : B, C, o.segRaw === undefined ? (o.raw ? 'my card is 4111' : null) : o.segRaw]);
  return C;
}

beforeAll(async () => {
  pg = await migratedPglite();
  db = kyselyFor(pg);
  repo = new KyselyVoiceTranscriptionRepository(db);
  svc = new VoiceTranscriptionService(repo, provider, new InMemoryVoiceEntitlement(() => true), 365, false);
  vc = new VoiceSettingsCenter(db, {
    settings: (c) => svc.settingsView(c as any) as any, entitled: async () => entitled, providerHealthy: async () => healthy, sweepArmedHere: () => false,
  });
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'S','Pilot','vc-774','VC774','active'), ($2,'X','Other','vc-774x','VC774X','active')`, [T, X]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$4,'Other','active','America/New_York')`, [B, T, BX, X]);
  await q(`insert into users (id, tenant_id, full_name, email, status, role) values ($1,$3,'Owner Kim','o@vc.test','active','OWNER'), ($2,$3,'Manager Lan','m@vc.test','active','MANAGER')`, [OWNER, MGR, T]);
}, 180_000);

describe('Voice settings — saving', () => {
  it('SV-01 never saved: defaults with version 0; the first save is version 1 with a history row', async () => {
    expect(await svc.getSettings(ctx())).toMatchObject({ transcriptionEnabled: true, retentionDays: 365, retainRaw: false, version: 0, saved: false });
    const r: any = await svc.updateSettings(ctx(), { consentAnnouncementVersion: 'v2' }, { expectedVersion: 0 });
    expect(r).toMatchObject({ version: 1, consentAnnouncementVersion: 'v2' });
    expect(await err(svc.updateSettings(ctx(), { consentAnnouncementVersion: 'v 2; drop' }))).toMatchObject({ message: expect.stringContaining('consentAnnouncementVersion') });
  });
  it('SV-02 a stale expectedVersion is refused', async () => {
    const e = await err(svc.updateSettings(ctx(), { retentionDays: 400 }, { expectedVersion: 0 }));
    expect(e).toBeInstanceOf(VoiceSettingsConflictError);
    expect((e as VoiceSettingsConflictError).currentVersion).toBe(1);
  });
  it('SV-03 shortening retention needs confirm; the 409 carries the impact; confirmed, EVERY live transcript is re-dated (not only new calls)', async () => {
    const old = await call({ daysAgo: 60 });                     // would be due under a 30-day window
    const held = await call({ daysAgo: 60, hold: true });         // on legal hold: re-dated but never due
    const recent = await call({ daysAgo: 5 });
    await call({ t: X, daysAgo: 60 });                            // another salon is untouched
    const e = await err(svc.updateSettings(ctx(), { retentionDays: 30 }, { expectedVersion: 1 }));
    expect(e).toBeInstanceOf(VoiceSettingsConfirmRequiredError);
    expect((e as VoiceSettingsConfirmRequiredError).impact).toEqual({ sensitive: ['retention_shortened'], transcripts: 3, dueNow: 1, rawToPurge: 0 });
    const r: any = await svc.updateSettings(ctx({ userId: MGR, role: 'MANAGER' }), { retentionDays: 30 }, { expectedVersion: 1, confirm: true });
    expect(r.version).toBe(2);
    const dates = await q(`select id, retention_expires_at <= now() as due, round(extract(epoch from (retention_expires_at - created_at)) / 86400) as days from call_transcripts where id = any($1)`, [[old, held, recent]]);
    expect(dates.every((d) => Number(d.days) === 30)).toBe(true);
    expect(dates.find((d) => d.id === recent).due).toBe(false);
    expect((await q(`select round(extract(epoch from (retention_expires_at - created_at)) / 86400) as days from call_transcripts where tenant_id = $1`, [X]))[0].days).toBe('365');
    // lengthening is not sensitive
    expect(((await svc.updateSettings(ctx(), { retentionDays: 90 }, { expectedVersion: 2 })) as any).version).toBe(3);
  });
  it('SV-04 raw text ON needs confirm; raw OFF needs confirm and PURGES stored raw text except under legal hold', async () => {
    expect(await err(svc.updateSettings(ctx(), { retainRaw: true }, { expectedVersion: 3 }))).toBeInstanceOf(VoiceSettingsConfirmRequiredError);
    await svc.updateSettings(ctx(), { retainRaw: true }, { expectedVersion: 3, confirm: true });
    const r1 = await call({ raw: true }); const r2 = await call({ raw: true, hold: true });
    const e = await err(svc.updateSettings(ctx(), { retainRaw: false }, { expectedVersion: 4 }));
    expect((e as VoiceSettingsConfirmRequiredError).impact).toMatchObject({ sensitive: ['raw_off'], rawToPurge: 1 });
    await svc.updateSettings(ctx(), { retainRaw: false }, { expectedVersion: 4, confirm: true });
    const rows = await q(`select t.id, t.raw_available, s.raw_text from call_transcripts t join call_transcript_segments s on s.transcript_id = t.id where t.id = any($1)`, [[r1, r2]]);
    expect(rows.find((x) => x.id === r1)).toMatchObject({ raw_available: false, raw_text: null });
    expect(rows.find((x) => x.id === r2)).toMatchObject({ raw_available: true, raw_text: 'my card is 4111' });
  });
  it('SV-05 turning transcription off needs confirm; every save is one history row with before → after and impact', async () => {
    expect(await err(svc.updateSettings(ctx(), { transcriptionEnabled: false }, { expectedVersion: 5 }))).toBeInstanceOf(VoiceSettingsConfirmRequiredError);
    await svc.updateSettings(ctx(), { transcriptionEnabled: false }, { expectedVersion: 5, confirm: true });
    const h = await q(`select version, changed_keys, impact, actor_user_id from voice_transcription_settings_history where tenant_id = $1 order by version`, [T]);
    expect(h.map((x) => x.version)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(h[1]).toMatchObject({ changed_keys: ['retentionDays'], actor_user_id: MGR });
    expect(h[1].impact).toMatchObject({ sensitive: ['retention_shortened'], dueNow: 1 });
    expect(h[5].changed_keys).toEqual(['transcriptionEnabled']);
    await svc.updateSettings(ctx(), { transcriptionEnabled: true }, { expectedVersion: 6 });
  });
});

describe('Voice settings — fail closed and raw access', () => {
  it('FC-01 an unreadable settings row stops ingest (it used to transcribe on the defaults)', async () => {
    const broken = new VoiceTranscriptionService({ ...repo, getSettings: async () => { throw new Error('db down'); } } as any, provider, new InMemoryVoiceEntitlement(() => true));
    expect(await err(broken.ingest(ctx(), { provider: 'retell', providerCallId: 'x-1' }))).toBeInstanceOf(VoiceSettingsUnavailableError);
  });
  it('RA-01 a raw-text view is logged BEFORE it is returned; a failed log refuses the view', async () => {
    await q(`update voice_transcription_settings set retain_raw = true where tenant_id = $1`, [T]);
    const C = await call({ raw: true });
    const raw = await svc.getRawTranscript(ctx(), C);
    expect(raw[0].rawText).toBe('my card is 4111');
    expect((await q(`select actor_user_id, kind from voice_transcript_access_events where transcript_id = $1`, [C]))).toEqual([{ actor_user_id: OWNER, kind: 'view_raw' }]);
    const noLog = new VoiceTranscriptionService(Object.assign(Object.create(Object.getPrototypeOf(repo)), repo, { recordRawAccess: async () => { throw new Error('audit down'); } }), provider, new InMemoryVoiceEntitlement(() => true));
    expect(await err(noLog.getRawTranscript(ctx(), C))).toMatchObject({ message: 'audit down' });
    await q(`update voice_transcription_settings set retain_raw = false where tenant_id = $1`, [T]);
  });
});

describe('Voice settings — status row and records', () => {
  it('SU-01 states come from real rows: last processed, consent versions actually used, overdue deletions, raw stored', async () => {
    await q(`insert into call_consent_records (tenant_id, branch_id, provider, provider_call_id, consent_status, announcement_version) values ($1,$2,'retell','c-a','granted','v1'), ($1,$2,'retell','c-b','granted','v2')`, [T, B]);
    await call({ daysAgo: 400, expiresInDays: 30 });                          // long overdue, not erased
    await q(`insert into call_deletion_events (tenant_id, branch_id, transcript_id, provider, provider_call_id, reason, segments_deleted, provider_deleted, actor) values ($1,$2,null,'retell','gone','retention_expired',3,false,'system:retention')`, [T, B]);
    const s: any = await vc.summary(ctx());
    expect(s.settings).toMatchObject({ version: 7, retentionDays: 90, consentAnnouncementVersion: 'v2' });
    expect(s.transcription.state).toBe('on');
    expect(s.consent).toMatchObject({ configured: 'v2', mismatched30d: 1 });
    expect(s.retention).toMatchObject({ days: 90, providerUnconfirmed30d: 1, sweepArmedHere: false });
    expect(s.retention.overdue).toBeGreaterThanOrEqual(1);
    expect(s.redaction.mandatory).toBe(true);
    entitled = false;
    expect((await vc.summary(ctx()) as any).transcription.state).toBe('subscription_restricted');
    entitled = true;
  });
  it('RC-01 Records: settings · deletion · failure · raw_access, newest first, kind filter, search, pages; never transcript text', async () => {
    await call({ status: 'provider_error' });
    const all: any = await vc.records(ctx(), { pageSize: '10' });
    expect(all.total).toBeGreaterThanOrEqual(10);
    const ts = all.items.map((x: any) => x.at);
    expect([...ts].sort().reverse()).toEqual(ts);
    expect(JSON.stringify(all)).not.toContain('4111');
    const st: any = await vc.records(ctx(), { kind: 'settings' });
    expect(st.total).toBe(7);
    expect(st.items.find((x: any) => x.what === 'retentionDays' && x.changes[0].after === 30)).toMatchObject({ actor: 'Manager Lan', changes: [{ key: 'retentionDays', before: 365, after: 30 }] });
    expect((await vc.records(ctx(), { kind: 'deletion' }) as any).items[0]).toMatchObject({ providerConfirmed: false, what: 'retention_expired' });
    expect((await vc.records(ctx(), { kind: 'raw_access' }) as any).items[0]).toMatchObject({ actor: 'Owner Kim', what: 'view_raw' });
    expect((await vc.records(ctx(), { kind: 'failure' }) as any).items[0].what).toBe('provider_error');
    expect((await vc.records(ctx(), { q: 'manager lan' }) as any).total).toBe(1);
    expect((await vc.records(ctx({ tenantId: X }), { kind: 'settings' }) as any).total).toBe(0);
    expect(await err(vc.records(ctx(), { from: '2026-10-05', to: '2026-10-01' }))).toBeInstanceOf(VoiceCenterError);
  });
});

describe('Voice settings — Check Voice Transcription Settings', () => {
  it('HL-01 read-only evidence; overdue deletions, mismatched consent, unconfirmed provider deletions and stray raw text are named', async () => {
    await call({ raw: true });                                               // raw stored while the policy says OFF
    const before = (await q(`select count(*)::int as n from call_transcripts`))[0].n;
    healthy = null;                                                          // no provider configured
    const r: any = await vc.check(ctx());
    const by = Object.fromEntries(r.checks.map((c: any) => [c.key, c]));
    expect(r.overall).toBe('FAILED');
    expect(by.retention_sweep.state).toBe('FAILED');
    expect(by.raw_text_policy).toMatchObject({ state: 'FAILED', count: 2 });   // this one and RA-01's (the policy was flipped in SQL, not saved)
    expect(by.consent_version.state).toBe('WARNING');
    expect(by.provider_deletion.state).toBe('WARNING');
    expect(by.provider.state).toBe('WARNING');
    expect(by.settings_readable.state).toBe('PASSED');
    expect(by.no_unauthorized_text.state).toBe('PASSED');
    expect(by.tenant_isolation.state).toBe('PASSED');
    expect((await vc.check(ctx()) as any)).toMatchObject({ reused: true, id: r.id });
    expect((await q(`select count(*)::int as n from call_transcripts`))[0].n).toBe(before);
    healthy = true;
  });
  it('HL-02 text stored for a call whose consent was missing FAILS', async () => {
    await q(`delete from voice_settings_health_runs`);
    await call({ status: 'consent_missing' });
    const r: any = await vc.check(ctx());
    expect(r.checks.find((c: any) => c.key === 'no_unauthorized_text')).toMatchObject({ state: 'FAILED', count: 1 });
  });
});
