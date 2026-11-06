// ai-settings.service.ts — receptionist-level settings (get-with-defaults + validated patch). Tenant-scoped
// (server-derived in the controller), permission-gated for writes. Only receptionist-specific settings live here;
// booking rules and notification prefs stay in their existing stores and the UI links out to them. Unknown keys are
// rejected so the settings blob can't be turned into an arbitrary bag.
import type { ReceptionistSettings } from '@aipowersalon/api-contracts/tenant';
export type { ReceptionistSettings };   // owned by packages/api-contracts (Constitution 13 §13)
import { Injectable, Inject } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { hasPermission } from '@aipowersalon/permissions';
import { withCode } from '@aipowersalon/api-contracts';
import { createHash } from 'node:crypto';

export interface SettingsCtx { tenantId: string; branchId: string | null; userId: string; role: string; permissions: string[] }


export const DEFAULT_SETTINGS: ReceptionistSettings = {
  enabled: false,
  defaultLanguage: 'en',
  afterHoursBehavior: 'ai_answers',
  allowInterruptions: true,
  silenceTimeoutSeconds: 8,
  maxCallDurationSeconds: 600,
  recordingEnabled: false,
  recordingConsentMessage: 'This call may be recorded for quality and training purposes.',
};

export class SettingsForbiddenError extends Error { constructor(msg = 'Forbidden') { super(msg); this.name = 'SettingsForbiddenError'; } }
export class SettingsValidationError extends Error { constructor(msg: string) { super(msg); this.name = 'SettingsValidationError'; } }
export class SettingsConflictError extends Error { constructor(public current: number) { super('These settings were changed by someone else. Reload to see their change, then save again.'); this.name = 'SettingsConflictError'; } }

const AFTER_HOURS = ['ai_answers', 'handoff', 'voicemail'];

/** Validate + coerce a partial patch. Rejects unknown keys and out-of-range values. */
export function validatePatch(patch: Record<string, unknown>): Partial<ReceptionistSettings> {
  const out: Partial<ReceptionistSettings> = {};
  for (const [k, v] of Object.entries(patch)) {
    switch (k) {
      case 'enabled': case 'allowInterruptions': case 'recordingEnabled':
        if (typeof v !== 'boolean') throw new SettingsValidationError(`${k} must be a boolean.`); (out as any)[k] = v; break;
      case 'defaultLanguage':
        // Kevin (Oct 28 2026): the AI receptionist speaks ENGLISH ONLY (POSLanguage.pdf §18 — customer communication). An
        // older screen may still send 'es' / 'vi': accepted and stored as English, never refused (the rest of the form saves).
        if (typeof v !== 'string' || !v.trim()) throw new SettingsValidationError('defaultLanguage must be a language code.'); out.defaultLanguage = 'en'; break;
      case 'afterHoursBehavior':
        if (!AFTER_HOURS.includes(String(v))) throw new SettingsValidationError('Invalid afterHoursBehavior.'); out.afterHoursBehavior = v as any; break;
      case 'silenceTimeoutSeconds': {
        const n = Number(v); if (!Number.isInteger(n) || n < 2 || n > 30) throw new SettingsValidationError('silenceTimeoutSeconds must be a whole number 2\u201330.'); out.silenceTimeoutSeconds = n; break;
      }
      case 'maxCallDurationSeconds': {
        const n = Number(v); if (!Number.isInteger(n) || n < 60 || n > 3600) throw new SettingsValidationError('maxCallDurationSeconds must be a whole number 60\u20133600.'); out.maxCallDurationSeconds = n; break;
      }
      case 'recordingConsentMessage':
        if (typeof v !== 'string') throw new SettingsValidationError('recordingConsentMessage must be text.');
        // never silently cut (the body schema allows 2000; this used to keep only the first 500)
        if (v.length > 2000) throw withCode(new SettingsValidationError('recordingConsentMessage must be 2000 characters or fewer.'), 'FIELD_TOO_LONG', { field: 'recordingConsentMessage', max: 2000 });
        out.recordingConsentMessage = v; break;
      default:
        throw new SettingsValidationError(`Unknown setting: ${k}`);
    }
  }
  return out;
}

export interface SettingsRepo {
  get(tenantId: string, branchId: string): Promise<Partial<ReceptionistSettings> | null>;
  upsert(tenantId: string, branchId: string, merged: ReceptionistSettings, userId: string, opt?: { expectedVersion?: number; before?: ReceptionistSettings; changedKeys?: string[] }): Promise<number | void>;
  /** the row's version (0 = never saved) */
  version?(tenantId: string, branchId: string): Promise<number>;
  history?(tenantId: string, branchId: string, page: number, pageSize: number): Promise<{ items: SettingsVersion[]; total: number }>;
  /** A9 Nov 6: the newest approval of this exact notice text in any of the given scopes (branch first, then salon) */
  consentApproval?(tenantId: string, scopes: string[], textSha: string): Promise<{ at: string; by: string | null; byName: string | null } | null>;
  approveConsent?(tenantId: string, branchId: string, text: string, textSha: string, userId: string, role: string): Promise<void>;
  recordCheck?(tenantId: string, branchId: string, overall: string, checks: unknown[], userId: string): Promise<{ id: string; at: string }>;
  lastCheck?(tenantId: string, branchId: string): Promise<{ id: string; overall: string; checks: unknown[]; at: string } | null>;
}
export class SettingsConsentError extends Error { constructor(msg: string, readonly code: string) { super(msg); this.name = 'SettingsConsentError'; } }
export const consentSha = (text: string) => createHash('sha256').update(String(text ?? '').trim()).digest('hex');
export interface SettingsCheck { id: string; label: string; state: 'READY' | 'WARNING' | 'FAILED'; detail: string; remedy: string | null }
export interface SettingsVersion { version: number; settings: Partial<ReceptionistSettings>; before: Partial<ReceptionistSettings> | null; changedKeys: string[]; actorUserId: string | null; actorName: string | null; at: string }
export interface SettingsMeta { version: number; source: 'branch' | 'salon' | 'defaults'; scope: 'branch' | 'salon'; appliedToCalls: false;
  consent?: { approved: boolean; approvedAt: string | null; approvedBy: string | null; supported: boolean } }
const SENTINEL = '00000000-0000-0000-0000-000000000000';
const scopeBranch = (branchId: string | null) => branchId || SENTINEL;

@Injectable()
export class AiSettingsService {
  constructor(@Inject('SettingsRepo') private readonly repo: SettingsRepo) {}

  /** Effective settings: the branch's own row over the salon-wide row over the defaults. A read failure is an ERROR (Nov 3
   *  audit): it used to return the defaults, and a save right after then overwrote the stored settings with them. */
  async get(ctx: SettingsCtx): Promise<ReceptionistSettings & { meta?: SettingsMeta }> {
    const salon = await this.repo.get(ctx.tenantId, SENTINEL);
    const branch = ctx.branchId ? await this.repo.get(ctx.tenantId, scopeBranch(ctx.branchId)) : null;
    const version = this.repo.version ? await this.repo.version(ctx.tenantId, scopeBranch(ctx.branchId)) : 0;
    // Receptionist Settings guide: say where the values come from, and honestly that the live call runtime does not read them yet
    const meta: SettingsMeta = { version, source: branch ? 'branch' : salon ? 'salon' : 'defaults', scope: ctx.branchId ? 'branch' : 'salon', appliedToCalls: false };
    const eff: ReceptionistSettings = { ...DEFAULT_SETTINGS, ...(salon ?? {}), ...(branch ?? {}), defaultLanguage: 'en' };   // English only, whatever was stored before Oct 28 2026
    const ap = await this.approval(ctx, eff.recordingConsentMessage);
    meta.consent = { approved: !!ap, approvedAt: ap?.at ?? null, approvedBy: ap?.byName ?? null, supported: !!this.repo.consentApproval };
    return { ...eff, meta };
  }
  private async approval(ctx: SettingsCtx, text: string) {
    if (!this.repo.consentApproval) return null;
    const scopes = ctx.branchId ? [scopeBranch(ctx.branchId), SENTINEL] : [SENTINEL];
    return this.repo.consentApproval(ctx.tenantId, scopes, consentSha(text));
  }
  /** A9 Nov 6: an OWNER approves the exact recording notice (for this branch, or the salon when no branch is chosen). */
  async approveConsent(ctx: SettingsCtx, text: unknown) {
    if (!hasPermission(ctx as unknown as Parameters<typeof hasPermission>[0], 'ai.manage')) throw new SettingsForbiddenError('Missing ai.manage');
    if (String(ctx.role ?? '').toUpperCase() !== 'OWNER') throw new SettingsConsentError('Only an owner can approve the recording notice.', 'AI_RCPT_OWNER_ONLY');
    const t = typeof text === 'string' ? text.trim() : '';
    if (!t) throw withCode(new SettingsValidationError('Type the recording notice to approve.'), 'VALIDATION_FAILED', { field: 'text' });
    if (t.length > 2000) throw withCode(new SettingsValidationError('The recording notice must be 2000 characters or fewer.'), 'FIELD_TOO_LONG', { field: 'text', max: 2000 });
    if (!this.repo.approveConsent) throw new SettingsConsentError('Approvals cannot be stored here.', 'AI_RCPT_CONSENT_NOT_APPROVED');
    await this.repo.approveConsent(ctx.tenantId, scopeBranch(ctx.branchId), t, consentSha(t), ctx.userId, String(ctx.role));
    return this.get(ctx);
  }
  /** A9 Nov 6: Check Receptionist Settings — read-only, recorded. Never calls the provider and changes no setting. */
  async check(ctx: SettingsCtx) {
    const checks: SettingsCheck[] = [];
    const add = (id: string, label: string, state: SettingsCheck['state'], detail: string, remedy: string | null = null) => checks.push({ id, label, state, detail, remedy });
    let s: (ReceptionistSettings & { meta?: SettingsMeta }) | null = null;
    try { s = await this.get(ctx); add('read', 'Settings can be read', 'READY', `Using the ${s.meta?.source} values (version ${s.meta?.version ?? 0}).`); }
    catch (e) { add('read', 'Settings can be read', 'FAILED', `The settings could not be read: ${String((e as Error)?.message ?? e).slice(0, 120)}`, 'Try again; if it repeats, contact AIPowerSalon support.'); }
    if (s) {
      if (s.recordingEnabled && !s.meta?.consent?.approved) add('consent', 'Recording notice approved', 'FAILED', 'Recording is on, but no owner has approved the current recording notice.', 'An owner approves the notice on this page, or recording is turned off.');
      else if (s.recordingEnabled) add('consent', 'Recording notice approved', 'READY', `Approved${s.meta?.consent?.approvedBy ? ` by ${s.meta.consent.approvedBy}` : ''}.`);
      else add('consent', 'Recording notice approved', s.meta?.consent?.approved ? 'READY' : 'WARNING', s.meta?.consent?.approved ? 'Recording is off; the notice is approved for when it is turned on.' : 'Recording is off. The notice is not approved yet.', s.meta?.consent?.approved ? null : 'An owner approves the notice before recording is turned on.');
      if (s.recordingEnabled && !/record/i.test(s.recordingConsentMessage)) add('notice_words', 'Recording notice says “recorded”', 'WARNING', 'The notice does not say the call is recorded.', 'Say plainly that the call may be recorded.');
      else add('notice_words', 'Recording notice says “recorded”', 'READY', s.recordingEnabled ? 'The notice tells callers the call may be recorded.' : 'Not needed while recording is off.');
      if (s.silenceTimeoutSeconds * 2 >= s.maxCallDurationSeconds) add('timing', 'Silence and call length', 'WARNING', `The silence timeout (${s.silenceTimeoutSeconds} s) is long next to the call limit (${s.maxCallDurationSeconds} s).`, 'Shorten the silence timeout or raise the call limit.');
      else add('timing', 'Silence and call length', 'READY', `Silence timeout ${s.silenceTimeoutSeconds} s; calls end after ${s.maxCallDurationSeconds} s.`);
      add('history', 'Change history kept', this.repo.history ? 'READY' : 'WARNING', this.repo.history ? 'Every save keeps a version you can compare and restore.' : 'This store keeps no history.');
      // honest: the live call agent does not read these values yet (Retell runtime config — external)
      add('runtime', 'Live calls use these settings', 'WARNING', 'Live calls do not read these settings yet; the voice agent keeps its own provider configuration.', 'Kept as a known gap until the voice agent is connected to read them.');
    }
    const overall: 'READY' | 'WARNING' | 'FAILED' = checks.some((c) => c.state === 'FAILED') ? 'FAILED' : checks.some((c) => c.state === 'WARNING') ? 'WARNING' : 'READY';
    const run = this.repo.recordCheck ? await this.repo.recordCheck(ctx.tenantId, scopeBranch(ctx.branchId), overall, checks, ctx.userId) : null;
    return { overall, checks, checkedAt: run?.at ?? new Date().toISOString(), runId: run?.id ?? null, recorded: !!run };
  }
  async lastCheck(ctx: SettingsCtx) { return this.repo.lastCheck ? this.repo.lastCheck(ctx.tenantId, scopeBranch(ctx.branchId)) : null;
  }
  async history(ctx: SettingsCtx, page = 1, pageSize = 20) {
    const size = [10, 20, 50].includes(pageSize) ? pageSize : 20; const p = Math.max(1, Math.trunc(page) || 1);
    const r = this.repo.history ? await this.repo.history(ctx.tenantId, scopeBranch(ctx.branchId), p, size) : { items: [], total: 0 };
    return { ...r, page: p, pageSize: size, totalPages: Math.max(1, Math.ceil(r.total / size)) };
  }

  async update(ctx: SettingsCtx, patch: Record<string, unknown>): Promise<ReceptionistSettings & { meta?: SettingsMeta }> {
    if (!hasPermission(ctx as any, 'ai.manage')) throw new SettingsForbiddenError('Missing ai.manage');
    const { expectedVersion: ev, ...rest } = (patch || {}) as Record<string, unknown> & { expectedVersion?: unknown };
    const valid = validatePatch(rest);
    const { meta: _m, ...current } = await this.get(ctx);
    const merged: ReceptionistSettings = { ...current, ...valid };
    const changedKeys = (Object.keys(valid) as (keyof ReceptionistSettings)[]).filter((k) => JSON.stringify(current[k]) !== JSON.stringify(merged[k]));
    const expectedVersion = ev == null ? undefined : Number(ev);
    if (expectedVersion !== undefined && !Number.isInteger(expectedVersion)) throw withCode(new SettingsValidationError('expectedVersion must be a whole number.'), 'VALIDATION_FAILED', { field: 'expectedVersion' });
    // A9 Nov 6: recording may only be on with an owner-approved notice. Checked only when this save turns recording on or
    // changes the notice while recording is on — saves of other settings never fail on it.
    if (merged.recordingEnabled && (changedKeys.includes('recordingEnabled') || changedKeys.includes('recordingConsentMessage')) && this.repo.consentApproval
      && !(await this.approval(ctx, merged.recordingConsentMessage)))
      throw new SettingsConsentError('An owner must approve this recording notice before recording can be on.', 'AI_RCPT_CONSENT_NOT_APPROVED');
    await this.repo.upsert(ctx.tenantId, scopeBranch(ctx.branchId), merged, ctx.userId, { expectedVersion, before: current, changedKeys });
    return (await this.get(ctx));
  }
}

// ---- repos ----
export class InMemorySettingsRepo implements SettingsRepo {
  private map = new Map<string, ReceptionistSettings>();
  private ver = new Map<string, number>();
  private hist: (SettingsVersion & { k: string })[] = [];
  private key = (t: string, b: string) => `${t}:${b}`;
  async get(tenantId: string, branchId: string) { return this.map.get(this.key(tenantId, branchId)) ?? null; }
  async version(tenantId: string, branchId: string) { return this.ver.get(this.key(tenantId, branchId)) ?? 0; }
  async upsert(tenantId: string, branchId: string, merged: ReceptionistSettings, userId?: string, opt: { expectedVersion?: number; before?: ReceptionistSettings; changedKeys?: string[] } = {}) {
    const k = this.key(tenantId, branchId); const cur = this.ver.get(k) ?? 0;
    if (opt.expectedVersion !== undefined && opt.expectedVersion !== cur) throw new SettingsConflictError(cur);
    this.map.set(k, merged); this.ver.set(k, cur + 1);
    this.hist.unshift({ k, version: cur + 1, settings: merged, before: opt.before ?? null, changedKeys: opt.changedKeys ?? [], actorUserId: userId ?? null, actorName: null, at: new Date().toISOString() });
    return cur + 1;
  }
  private approvals: { t: string; b: string; sha: string; at: string; by: string }[] = [];
  private runs: { t: string; b: string; id: string; overall: string; checks: unknown[]; at: string }[] = [];
  async consentApproval(tenantId: string, scopes: string[], sha: string) {
    for (const b of scopes) { const a = this.approvals.filter((x) => x.t === tenantId && x.b === b && x.sha === sha).pop(); if (a) return { at: a.at, by: a.by, byName: null }; }
    return null;
  }
  async approveConsent(tenantId: string, branchId: string, _text: string, sha: string, userId: string) { this.approvals.push({ t: tenantId, b: branchId, sha, at: new Date().toISOString(), by: userId }); }
  async recordCheck(tenantId: string, branchId: string, overall: string, checks: unknown[]) { const r = { t: tenantId, b: branchId, id: String(this.runs.length + 1), overall, checks, at: new Date().toISOString() }; this.runs.push(r); return { id: r.id, at: r.at }; }
  async lastCheck(tenantId: string, branchId: string) { const r = this.runs.filter((x) => x.t === tenantId && x.b === branchId).pop(); return r ? { id: r.id, overall: r.overall, checks: r.checks, at: r.at } : null; }
  async history(tenantId: string, branchId: string, page: number, pageSize: number) {
    const all = this.hist.filter((h) => h.k === this.key(tenantId, branchId));
    return { items: all.slice((page - 1) * pageSize, page * pageSize).map(({ k: _k, ...h }) => h), total: all.length };
  }
}

export class KyselySettingsRepo implements SettingsRepo {
  constructor(private readonly db: Kysely<any>) {}
  async get(tenantId: string, branchId: string): Promise<Partial<ReceptionistSettings> | null> {
    const r: any = (await sql`SELECT settings FROM ai_receptionist_settings WHERE tenant_id = ${tenantId} AND branch_id = ${branchId} LIMIT 1`.execute(this.db)).rows[0];
    return r ? (typeof r.settings === 'string' ? JSON.parse(r.settings) : r.settings) : null;
  }
  async version(tenantId: string, branchId: string): Promise<number> {
    const r: any = (await sql`SELECT version FROM ai_receptionist_settings WHERE tenant_id = ${tenantId} AND branch_id = ${branchId}`.execute(this.db)).rows[0];
    return Number(r?.version ?? 0);
  }
  /** one transaction: the row lock, the version check (a save from an older screen is refused), the new version and its history row */
  async upsert(tenantId: string, branchId: string, merged: ReceptionistSettings, userId: string, opt: { expectedVersion?: number; before?: ReceptionistSettings; changedKeys?: string[] } = {}): Promise<number> {
    const uid = /^[0-9a-f-]{36}$/i.test(String(userId)) ? userId : null;
    return this.db.transaction().execute(async (trx) => {
      const cur: any = (await sql`SELECT version FROM ai_receptionist_settings WHERE tenant_id = ${tenantId} AND branch_id = ${branchId} FOR UPDATE`.execute(trx)).rows[0];
      const v = Number(cur?.version ?? 0);
      if (opt.expectedVersion !== undefined && opt.expectedVersion !== v) throw new SettingsConflictError(v);
      await sql`INSERT INTO ai_receptionist_settings (tenant_id, branch_id, settings, updated_by_user_id, updated_at, version)
        VALUES (${tenantId}, ${branchId}, ${JSON.stringify(merged)}::jsonb, ${uid}, now(), ${v + 1})
        ON CONFLICT (tenant_id, branch_id) DO UPDATE SET settings = EXCLUDED.settings, updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = now(), version = EXCLUDED.version`.execute(trx);
      await sql`INSERT INTO ai_receptionist_settings_history (tenant_id, branch_id, version, settings, before, changed_keys, actor_user_id)
        VALUES (${tenantId}, ${branchId}, ${v + 1}, ${JSON.stringify(merged)}::jsonb, ${opt.before ? JSON.stringify(opt.before) : null}::jsonb, ${opt.changedKeys ?? []}::text[], ${uid})`.execute(trx);
      return v + 1;
    });
  }
  async history(tenantId: string, branchId: string, page: number, pageSize: number) {
    const total = Number((await sql<{ n: number }>`SELECT count(*)::int AS n FROM ai_receptionist_settings_history WHERE tenant_id = ${tenantId} AND branch_id = ${branchId}`.execute(this.db)).rows[0]?.n ?? 0);
    const rows: any[] = (await sql`SELECT h.version, h.settings, h.before, h.changed_keys, h.actor_user_id, h.created_at, u.full_name
      FROM ai_receptionist_settings_history h LEFT JOIN users u ON u.id = h.actor_user_id AND u.tenant_id = h.tenant_id
      WHERE h.tenant_id = ${tenantId} AND h.branch_id = ${branchId} ORDER BY h.version DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`.execute(this.db)).rows;
    return { total, items: rows.map((r) => ({ version: Number(r.version), settings: r.settings ?? {}, before: r.before ?? null, changedKeys: r.changed_keys ?? [], actorUserId: r.actor_user_id ?? null,
      actorName: r.full_name ?? null, at: new Date(r.created_at).toISOString() })) };
  }
  async consentApproval(tenantId: string, scopes: string[], sha: string) {
    for (const b of scopes) {
      const r: any = (await sql`SELECT a.created_at, a.approved_by, u.full_name FROM ai_receptionist_consent_approvals a LEFT JOIN users u ON u.id = a.approved_by AND u.tenant_id = a.tenant_id
        WHERE a.tenant_id = ${tenantId} AND a.branch_id = ${b}::uuid AND a.text_sha256 = ${sha} ORDER BY a.created_at DESC LIMIT 1`.execute(this.db)).rows[0];
      if (r) return { at: new Date(r.created_at).toISOString(), by: r.approved_by ?? null, byName: r.full_name ?? null };
    }
    return null;
  }
  async approveConsent(tenantId: string, branchId: string, text: string, sha: string, userId: string, role: string) {
    const uid = /^[0-9a-f-]{36}$/i.test(String(userId)) ? userId : null;
    await sql`INSERT INTO ai_receptionist_consent_approvals (tenant_id, branch_id, text_sha256, consent_text, approved_by, approved_role) VALUES (${tenantId}, ${branchId}::uuid, ${sha}, ${text}, ${uid}, ${role})`.execute(this.db);
  }
  async recordCheck(tenantId: string, branchId: string, overall: string, checks: unknown[], userId: string) {
    const uid = /^[0-9a-f-]{36}$/i.test(String(userId)) ? userId : null;
    const r: any = (await sql`INSERT INTO ai_receptionist_settings_checks (tenant_id, branch_id, overall, checks, run_by) VALUES (${tenantId}, ${branchId}::uuid, ${overall}, ${JSON.stringify(checks)}::jsonb, ${uid}) RETURNING id, created_at`.execute(this.db)).rows[0];
    return { id: String(r.id), at: new Date(r.created_at).toISOString() };
  }
  async lastCheck(tenantId: string, branchId: string) {
    const r: any = (await sql`SELECT c.id, c.overall, c.checks, c.created_at FROM ai_receptionist_settings_checks c WHERE c.tenant_id = ${tenantId} AND c.branch_id = ${branchId}::uuid ORDER BY c.created_at DESC LIMIT 1`.execute(this.db)).rows[0];
    return r ? { id: String(r.id), overall: String(r.overall), checks: r.checks ?? [], at: new Date(r.created_at).toISOString() } : null;
  }
}
