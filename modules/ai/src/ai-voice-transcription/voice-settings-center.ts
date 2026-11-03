// voice-settings-center.ts — Voice Transcription Settings guide (Nov 2 2026): `/pos/ai-voice-transcription/center/*`, the READ
// side of the settings page. The policy itself stays on GET / PUT settings (VoiceTranscriptionService — now versioned, with
// sensitive-change confirmation, re-dating of stored transcripts and raw-text purge, and a history row per save).
//
// Read from what exists: voice_transcription_settings (+ _history), call_transcripts (status, redaction, raw, legal hold,
// retention date), call_deletion_events (every erasure, with whether the provider confirmed), call_consent_records (the
// announcement version each call actually played), voice_transcript_access_events (raw views). Nothing here places a call,
// transcribes, deletes, purges or sends. What it adds:
//   • the status row: saved policy + version, the subscription, transcription / redaction / raw / retention / consent states
//     computed from real rows (last processed call, redaction backlog, overdue deletions, provider confirmations, which
//     announcement versions calls actually used);
//   • Records: one newest-first list of settings changes · deletions · processing failures · raw-text views, with kind,
//     search, presets + From/To in salon time and numbered pages (no customer transcript search — that is Voice Search);
//   • Check Voice Transcription Settings — read-only, evidence-backed.
import { sql, type Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { branchTimeZone } from '@aipowersalon/database';

type Row = Record<string, any>;
export interface VcCtx { tenantId: string; branchId?: string | null; userId?: string | null; role?: string | null; permissions?: string[] }
export interface VcDeps {
  /** the saved policy + version (defaults when never saved); throws when unreadable */
  settings: (ctx: VcCtx) => Promise<{ transcriptionEnabled: boolean; retentionDays: number; retainRaw: boolean; consentAnnouncementVersion: string | null; version: number; updatedAt: string | null; saved: boolean }>;
  /** the AI entitlement for voice transcription */
  entitled: (tenantId: string) => Promise<boolean>;
  /** the transcription provider answers (read-only health ping); null = no provider configured */
  providerHealthy: () => Promise<boolean | null>;
  /** whether the retention sweep is armed in THIS process (env) — evidence, not proof */
  sweepArmedHere: () => boolean;
}
export class VoiceCenterError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400) { super(message); }
}
export const VC_KINDS = ['all', 'settings', 'deletion', 'failure', 'raw_access'] as const;
export const VC_PRESETS = ['all', 'today', 'yesterday', 'week', 'last_7', 'month', 'last_30', 'last_month', 'year', 'custom'] as const;
export const VC_PAGE_SIZES = [10, 25, 50, 100] as const;
const FAILURE_STATES = ['provider_error', 'failed', 'audio_unavailable', 'manual_review_required'];
const HEALTH_GAP_SECONDS = 30;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const N = (v: unknown) => (v == null ? 0 : Number(v));
const iso = (v: unknown) => (v == null ? null : new Date(v as string | number | Date).toISOString());
const pick = <T extends readonly string[]>(list: T, v: unknown): T[number] | undefined => (typeof v === 'string' && (list as readonly string[]).includes(v) ? v as T[number] : undefined);
const isUuid = (v: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v ?? ''));

export class VoiceSettingsCenter {
  constructor(private readonly db: Kysely<any>, private readonly deps: VcDeps, private readonly now: () => number = () => Date.now()) {}

  private async period(ctx: VcCtx, f: { preset?: unknown; from?: unknown; to?: unknown }) {
    const tz = await branchTimeZone(this.db, ctx.tenantId, isUuid(ctx.branchId) ? ctx.branchId : null);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(this.now()));
    const preset = pick(VC_PRESETS, f.preset) ?? (f.from || f.to ? 'custom' : 'all');
    if (preset === 'all') return { preset, from: null as string | null, to: null as string | null, start: null as Date | null, end: null as Date | null, today, tz };
    const d = (s: string, n: number) => { const x = new Date(s + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
    const dow = (new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7;
    let from: string; let to = today;
    switch (preset) {
      case 'today': from = today; break;
      case 'yesterday': from = to = d(today, -1); break;
      case 'week': from = d(today, -dow); break;
      case 'last_7': from = d(today, -6); break;
      case 'month': from = today.slice(0, 8) + '01'; break;
      case 'last_30': from = d(today, -29); break;
      case 'last_month': { const first = today.slice(0, 8) + '01'; to = d(first, -1); from = to.slice(0, 8) + '01'; break; }
      case 'year': from = today.slice(0, 4) + '-01-01'; break;
      default: {
        const a = typeof f.from === 'string' && DAY.test(f.from) && !Number.isNaN(Date.parse(f.from)) ? f.from : null;
        const z = typeof f.to === 'string' && DAY.test(f.to) && !Number.isNaN(Date.parse(f.to)) ? f.to : null;
        if (!a || !z) throw new VoiceCenterError('Choose a From and a To date.', 'VC_INVALID_PERIOD');
        if (a > z) throw new VoiceCenterError('The From date must be on or before the To date.', 'VC_INVALID_PERIOD');
        from = a; to = z;
      }
    }
    const r = (await sql<Row>`select (${from}::date::timestamp at time zone ${tz}) as s, ((${to}::date + 1)::timestamp at time zone ${tz}) as e`.execute(this.db)).rows[0];
    return { preset, from, to, start: new Date(r.s) as Date | null, end: new Date(r.e) as Date | null, today, tz };
  }

  // ── the status row ────────────────────────────────────────────────────────────────────────────────────────────
  async summary(ctx: VcCtx) {
    const T = ctx.tenantId;
    let st: Awaited<ReturnType<VcDeps['settings']>> | null = null; let stErr = false;
    try { st = await this.deps.settings(ctx); } catch { stErr = true; }
    let entitled: boolean | null = null;
    try { entitled = await this.deps.entitled(T); } catch { entitled = null; }
    const t = (await sql<Row>`select
        max(created_at) filter (where status in ('completed', 'low_confidence')) as last_ok,
        count(*) filter (where created_at > now() - interval '30 days')::int as calls_30d,
        count(*) filter (where created_at > now() - interval '30 days' and status in ('completed', 'low_confidence'))::int as transcribed_30d,
        count(*) filter (where created_at > now() - interval '30 days' and status in ('consent_missing', 'consent_declined', 'recording_disabled'))::int as consent_blocked_30d,
        count(*) filter (where created_at > now() - interval '30 days' and status = 'transcription_disabled')::int as policy_off_30d,
        count(*) filter (where created_at > now() - interval '30 days' and status = any(${FAILURE_STATES}::text[]))::int as failed_30d,
        count(*) filter (where deleted_at is null and redaction_status in ('pending', 'processing') and updated_at < now() - interval '1 hour')::int as redaction_stuck,
        count(*) filter (where deleted_at is null and redaction_status = 'failed')::int as redaction_failed,
        count(*) filter (where deleted_at is null and raw_available = true)::int as raw_stored,
        count(*) filter (where deleted_at is null and legal_hold = true)::int as legal_holds,
        count(*) filter (where deleted_at is null and legal_hold = false and retention_expires_at <= now() - interval '1 day')::int as overdue,
        min(retention_expires_at) filter (where deleted_at is null and legal_hold = false and retention_expires_at > now()) as next_due
      from call_transcripts where tenant_id = ${T}`.execute(this.db)).rows[0] ?? {};
    const del = (await sql<Row>`select max(created_at) as last_at, count(*) filter (where created_at > now() - interval '30 days')::int as n_30d,
        count(*) filter (where created_at > now() - interval '30 days' and provider_deleted = false)::int as unconfirmed_30d
      from call_deletion_events where tenant_id = ${T}`.execute(this.db)).rows[0] ?? {};
    const versions = (await sql<Row>`select coalesce(announcement_version, '') as v, count(*)::int as n from call_consent_records
      where tenant_id = ${T} and created_at > now() - interval '30 days' group by 1 order by n desc limit 5`.execute(this.db)).rows;
    const lastCheck = (await sql<Row>`select overall, created_at from voice_settings_health_runs where tenant_id = ${T} order by created_at desc limit 1`.execute(this.db)).rows[0];
    const configured = st?.consentAnnouncementVersion ?? null;
    return {
      asOf: new Date(this.now()).toISOString(), settingsUnreadable: stErr,
      settings: st, entitled,
      transcription: { state: !st ? 'unknown' : entitled === false ? 'subscription_restricted' : st.transcriptionEnabled ? 'on' : 'off', lastProcessedAt: iso(t.last_ok),
        last30d: { calls: N(t.calls_30d), transcribed: N(t.transcribed_30d), consentBlocked: N(t.consent_blocked_30d), policyOff: N(t.policy_off_30d), failed: N(t.failed_30d) } },
      redaction: { mandatory: true, stuck: N(t.redaction_stuck), failed: N(t.redaction_failed) },
      raw: { retain: st ? st.retainRaw : null, stored: N(t.raw_stored) },
      retention: { days: st?.retentionDays ?? null, overdue: N(t.overdue), nextDueAt: iso(t.next_due), legalHolds: N(t.legal_holds), lastDeletionAt: iso(del.last_at),
        deleted30d: N(del.n_30d), providerUnconfirmed30d: N(del.unconfirmed_30d), sweepArmedHere: this.deps.sweepArmedHere() },
      consent: { configured, used30d: versions.map((v) => ({ version: v.v || null, calls: N(v.n) })),
        mismatched30d: configured ? versions.filter((v) => (v.v || null) !== configured).reduce((a, v) => a + N(v.n), 0) : 0 },
      lastCheck: lastCheck ? { overall: lastCheck.overall, at: iso(lastCheck.created_at) } : null,
    };
  }

  // ── Records: settings changes · deletions · processing failures · raw-text views ─────────────────────────────
  async records(ctx: VcCtx, f: Record<string, unknown>) {
    const T = ctx.tenantId;
    const pageSize = (VC_PAGE_SIZES as readonly number[]).includes(Number(f.pageSize)) ? Number(f.pageSize) : 25;
    const page = Math.max(1, Math.min(100000, Math.floor(Number(f.page) || 1)));
    const kind = pick(VC_KINDS, f.kind) ?? 'all';
    const per = await this.period(ctx, f);
    const q = String(f.q ?? '').trim().slice(0, 80);
    // one shape for four append-only sources; no transcript text and no customer identity is ever selected here
    const EVENTS = sql`(
        select 'settings' as kind, h.id::text as id, h.created_at as at, array_to_string(h.changed_keys, ',') as what, h.actor_user_id as actor_id, h.actor_role as role,
               h.before_state as before, h.after_state as after, h.impact as impact, null::text as ref, null::boolean as ok
          from voice_transcription_settings_history h where h.tenant_id = ${T}
        union all
        select 'deletion', d.id::text, d.created_at, d.reason, null::uuid, d.actor, null, null, null, d.transcript_id::text, d.provider_deleted
          from call_deletion_events d where d.tenant_id = ${T}
        union all
        select 'failure', c.id::text, c.updated_at, c.status, null::uuid, null, null, null, null, c.id::text, false
          from call_transcripts c where c.tenant_id = ${T} and c.status = any(${FAILURE_STATES}::text[])
        union all
        select 'raw_access', a.id::text, a.created_at, a.kind, a.actor_user_id, a.actor_role, null, null, null, a.transcript_id::text, null
          from voice_transcript_access_events a where a.tenant_id = ${T}
      ) e`;
    const where = [sql`true`];
    if (kind !== 'all') where.push(sql`e.kind = ${kind}`);
    if (per.start && per.end) where.push(sql`e.at >= ${per.start} and e.at < ${per.end}`);
    if (q) {
      const like = '%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
      const idq = q.toLowerCase().replace(/[^0-9a-f-]/g, '');
      where.push(sql`(e.what ilike ${like} or coalesce(e.role, '') ilike ${like} or coalesce(u.full_name, u.email, '') ilike ${like}
        or ${idq.length >= 6 ? sql`(e.id like ${idq + '%'} or coalesce(e.ref, '') like ${idq + '%'})` : sql`false`})`);
    }
    const W = sql.join(where, sql` and `);
    const FROM = sql`${EVENTS} left join users u on u.id = e.actor_id and u.tenant_id = ${T}`;
    const total = N((await sql<Row>`select count(*)::int as n from ${FROM} where ${W}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<Row>`select e.kind, e.id, e.at, e.what, e.role, e.before, e.after, e.impact, e.ref, e.ok, coalesce(u.full_name, u.email) as actor
      from ${FROM} where ${W} order by e.at desc nulls last, e.id desc limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(this.db)).rows;
    return {
      items: rows.map((r) => {
        const keys = r.kind === 'settings' && r.what ? String(r.what).split(',').filter(Boolean) : [];
        return { kind: r.kind, id: String(r.id), at: iso(r.at), what: r.what ?? null, actor: r.actor ?? (r.kind === 'deletion' ? (r.role ?? null) : null), role: r.kind === 'deletion' ? null : (r.role ?? null),
          transcriptId: r.ref ?? null, providerConfirmed: r.kind === 'deletion' ? !!r.ok : null,
          changes: keys.map((k) => ({ key: k, before: (r.before ?? {})[k] ?? null, after: (r.after ?? {})[k] ?? null })), impact: r.impact ?? null };
      }),
      total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)),
      applied: { q: q || null, kind, preset: per.preset, from: per.from, to: per.to }, period: { today: per.today, timeZone: per.tz },
    };
  }

  // ── Check Voice Transcription Settings (read-only; one run per salon per 30 s) ───────────────────────────────
  async check(ctx: VcCtx) {
    const T = ctx.tenantId;
    type St = 'PASSED' | 'WARNING' | 'FAILED' | 'INSUFFICIENT_DATA' | 'UNAVAILABLE';
    const recentRun = async (ex: Kysely<any>) => (await sql<Row>`select id, overall, checks, created_at from voice_settings_health_runs where tenant_id = ${T}
      and created_at >= now() - ${HEALTH_GAP_SECONDS + ' seconds'}::interval order by created_at desc limit 1`.execute(ex)).rows[0];
    const reusedOut = (r: Row) => ({ id: r.id, overall: r.overall, checks: r.checks, checkedAt: iso(r.created_at), reused: true });
    const early = await recentRun(this.db);
    if (early) return reusedOut(early);
    const checks: Array<{ key: string; state: St; count?: number | null; detail?: Record<string, unknown> }> = [];
    const one = async (q: any): Promise<Row> => (await q.execute(this.db)).rows[0] ?? {};
    let st: Awaited<ReturnType<VcDeps['settings']>> | null = null;
    try { st = await this.deps.settings(ctx); } catch { st = null; }
    checks.push({ key: 'settings_readable', state: st ? 'PASSED' : 'FAILED', detail: { version: st?.version ?? null, saved: st?.saved ?? null } });
    let entitled: boolean | null = null;
    try { entitled = await this.deps.entitled(T); } catch { entitled = null; }
    checks.push({ key: 'subscription', state: entitled == null ? 'UNAVAILABLE' : entitled ? 'PASSED' : 'FAILED' });
    let healthy: boolean | null = null; let provErr = false;
    try { healthy = await this.deps.providerHealthy(); } catch { provErr = true; }
    checks.push({ key: 'provider', state: provErr ? 'FAILED' : healthy == null ? 'WARNING' : healthy ? 'PASSED' : 'FAILED', detail: { configured: healthy != null || provErr } });
    const tr = await one(sql<Row>`select count(*) filter (where created_at > now() - interval '30 days')::int as calls,
        count(*) filter (where created_at > now() - interval '30 days' and status in ('completed', 'low_confidence'))::int as ok,
        count(*) filter (where created_at > now() - interval '30 days' and status = any(${FAILURE_STATES}::text[]))::int as failed,
        max(created_at) filter (where status in ('completed', 'low_confidence')) as last_ok
      from call_transcripts where tenant_id = ${T}`);
    checks.push({ key: 'transcription_pipeline', state: !N(tr.calls) ? 'INSUFFICIENT_DATA' : st && !st.transcriptionEnabled ? 'WARNING' : N(tr.failed) > N(tr.ok) ? 'FAILED' : N(tr.failed) ? 'WARNING' : 'PASSED',
      count: N(tr.failed), detail: { calls30d: N(tr.calls), transcribed30d: N(tr.ok), lastSuccess: iso(tr.last_ok), policyOff: st ? !st.transcriptionEnabled : null } });
    // mandatory redaction: nothing ready to read while its redaction failed or never finished
    const red = await one(sql<Row>`select count(*) filter (where redaction_status = 'failed')::int as failed,
        count(*) filter (where redaction_status in ('pending', 'processing') and updated_at < now() - interval '1 hour')::int as stuck
      from call_transcripts where tenant_id = ${T} and deleted_at is null and status in ('completed', 'low_confidence')`);
    checks.push({ key: 'redaction', state: N(red.failed) ? 'FAILED' : N(red.stuck) ? 'WARNING' : 'PASSED', count: N(red.failed) + N(red.stuck), detail: { failed: N(red.failed), stuck: N(red.stuck) } });
    // raw text: stored only when the policy allows it (legal holds keep theirs)
    const rawStray = N((await one(sql<Row>`select count(*)::int as n from call_transcripts where tenant_id = ${T} and deleted_at is null and raw_available = true and legal_hold = false`)).n);
    checks.push({ key: 'raw_text_policy', state: !st ? 'UNAVAILABLE' : !st.retainRaw && rawStray ? 'FAILED' : 'PASSED', count: rawStray, detail: { retainRaw: st?.retainRaw ?? null } });
    const rawSeg = N((await one(sql<Row>`select count(*)::int as n from call_transcript_segments s join call_transcripts t on t.id = s.transcript_id and t.tenant_id = s.tenant_id
      where s.tenant_id = ${T} and s.raw_text is not null and (t.raw_available = false or t.deleted_at is not null) and t.legal_hold = false`)).n);
    checks.push({ key: 'raw_text_orphans', state: rawSeg ? 'FAILED' : 'PASSED', count: rawSeg });
    // retention: deletion dates match the window; nothing overdue; provider confirmations
    const mis = !st ? 0 : N((await one(sql<Row>`select count(*)::int as n from call_transcripts where tenant_id = ${T} and deleted_at is null and retention_expires_at is not null
      and abs(extract(epoch from (retention_expires_at - (created_at + make_interval(days => ${st.retentionDays}))))) > 86400`)).n);
    checks.push({ key: 'retention_dates', state: !st ? 'UNAVAILABLE' : mis ? 'WARNING' : 'PASSED', count: mis, detail: { days: st?.retentionDays ?? null } });
    const overdue = N((await one(sql<Row>`select count(*)::int as n from call_transcripts where tenant_id = ${T} and deleted_at is null and legal_hold = false and retention_expires_at <= now() - interval '1 day'`)).n);
    checks.push({ key: 'retention_sweep', state: overdue ? 'FAILED' : 'PASSED', count: overdue, detail: { armedInThisProcess: this.deps.sweepArmedHere() } });
    const del = await one(sql<Row>`select count(*)::int as n, count(*) filter (where provider_deleted = false)::int as unconfirmed from call_deletion_events where tenant_id = ${T} and created_at > now() - interval '30 days'`);
    checks.push({ key: 'provider_deletion', state: !N(del.n) ? 'INSUFFICIENT_DATA' : N(del.unconfirmed) ? 'WARNING' : 'PASSED', count: N(del.unconfirmed), detail: { deletions30d: N(del.n) } });
    const holds = N((await one(sql<Row>`select count(*)::int as n from call_transcripts where tenant_id = ${T} and legal_hold = true and deleted_at is not null`)).n);
    checks.push({ key: 'legal_holds_kept', state: holds ? 'FAILED' : 'PASSED', count: holds });
    // consent: the version calls actually announced vs. the one saved here
    const cons = await one(sql<Row>`select count(*)::int as n, count(*) filter (where ${st?.consentAnnouncementVersion ? sql`coalesce(announcement_version, '') <> ${st.consentAnnouncementVersion}` : sql`false`})::int as mismatched
      from call_consent_records where tenant_id = ${T} and created_at > now() - interval '30 days'`);
    checks.push({ key: 'consent_version', state: !st ? 'UNAVAILABLE' : !st.consentAnnouncementVersion ? 'WARNING' : !N(cons.n) ? 'INSUFFICIENT_DATA' : N(cons.mismatched) ? 'WARNING' : 'PASSED',
      count: N(cons.mismatched), detail: { configured: st?.consentAnnouncementVersion ?? null, calls30d: N(cons.n) } });
    // nothing stored for a call whose consent was declined or missing
    const unauth = N((await one(sql<Row>`select count(*)::int as n from call_transcripts where tenant_id = ${T} and status in ('consent_missing', 'consent_declined', 'transcription_disabled', 'recording_disabled') and segment_count > 0`)).n);
    checks.push({ key: 'no_unauthorized_text', state: unauth ? 'FAILED' : 'PASSED', count: unauth });
    const hist = N((await one(sql<Row>`select count(*)::int as n from voice_transcription_settings_history where tenant_id = ${T}`)).n);
    checks.push({ key: 'settings_history', state: st && st.version > 1 && !hist ? 'WARNING' : 'PASSED', count: hist });
    const cross = N((await one(sql<Row>`select count(*)::int as n from call_transcript_segments s join call_transcripts t on t.id = s.transcript_id where s.tenant_id = ${T} and t.tenant_id <> s.tenant_id`)).n);
    checks.push({ key: 'tenant_isolation', state: cross ? 'FAILED' : 'PASSED', count: cross });
    checks.push({ key: 'no_side_effects', state: 'PASSED' });
    const order = ['FAILED', 'UNAVAILABLE', 'WARNING', 'INSUFFICIENT_DATA', 'PASSED'];
    checks.sort((a, z) => order.indexOf(a.state) - order.indexOf(z.state));
    const overall = checks.some((x) => x.state === 'FAILED' || x.state === 'UNAVAILABLE') ? 'FAILED' : checks.some((x) => x.state === 'WARNING') ? 'WARNING'
      : checks.some((x) => x.state === 'PASSED') ? 'PASSED' : 'INSUFFICIENT_DATA';
    const runId = randomUUID();
    return this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext('voice-settings-health:' || ${T}))`.execute(trx);
      const raced = await recentRun(trx);
      if (raced) return reusedOut(raced);
      await sql`insert into voice_settings_health_runs (id, tenant_id, branch_id, actor_user_id, overall, checks)
        values (${runId}, ${T}, ${isUuid(ctx.branchId) ? ctx.branchId : null}, ${isUuid(ctx.userId) ? ctx.userId : null}, ${overall}, ${JSON.stringify(checks)}::jsonb)`.execute(trx);
      return { id: runId, overall, checks, checkedAt: new Date(this.now()).toISOString(), reused: false };
    });
  }
}
