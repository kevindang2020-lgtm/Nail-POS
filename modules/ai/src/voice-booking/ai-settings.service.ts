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
}
export interface SettingsVersion { version: number; settings: Partial<ReceptionistSettings>; before: Partial<ReceptionistSettings> | null; changedKeys: string[]; actorUserId: string | null; actorName: string | null; at: string }
export interface SettingsMeta { version: number; source: 'branch' | 'salon' | 'defaults'; scope: 'branch' | 'salon'; appliedToCalls: false }
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
    return { ...DEFAULT_SETTINGS, ...(salon ?? {}), ...(branch ?? {}), defaultLanguage: 'en', meta };   // English only, whatever was stored before Oct 28 2026
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
}
