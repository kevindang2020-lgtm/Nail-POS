// ai-settings.service.ts — receptionist-level settings (get-with-defaults + validated patch). Tenant-scoped
// (server-derived in the controller), permission-gated for writes. Only receptionist-specific settings live here;
// booking rules and notification prefs stay in their existing stores and the UI links out to them. Unknown keys are
// rejected so the settings blob can't be turned into an arbitrary bag.
import type { ReceptionistSettings } from '@aipowersalon/api-contracts/tenant';
export type { ReceptionistSettings };   // owned by packages/api-contracts (Constitution 13 §13)
import { Injectable, Inject } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { hasPermission } from '@aipowersalon/permissions';

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

const AFTER_HOURS = ['ai_answers', 'handoff', 'voicemail'];

/** Validate + coerce a partial patch. Rejects unknown keys and out-of-range values. */
export function validatePatch(patch: Record<string, unknown>): Partial<ReceptionistSettings> {
  const out: Partial<ReceptionistSettings> = {};
  for (const [k, v] of Object.entries(patch)) {
    switch (k) {
      case 'enabled': case 'allowInterruptions': case 'recordingEnabled':
        if (typeof v !== 'boolean') throw new SettingsValidationError(`${k} must be a boolean.`); (out as any)[k] = v; break;
      case 'defaultLanguage':
        if (typeof v !== 'string' || !v.trim()) throw new SettingsValidationError('defaultLanguage must be a language code.'); out.defaultLanguage = v.trim().slice(0, 12); break;
      case 'afterHoursBehavior':
        if (!AFTER_HOURS.includes(String(v))) throw new SettingsValidationError('Invalid afterHoursBehavior.'); out.afterHoursBehavior = v as any; break;
      case 'silenceTimeoutSeconds': {
        const n = Number(v); if (!Number.isFinite(n) || n < 2 || n > 30) throw new SettingsValidationError('silenceTimeoutSeconds must be 2\u201330.'); out.silenceTimeoutSeconds = Math.round(n); break;
      }
      case 'maxCallDurationSeconds': {
        const n = Number(v); if (!Number.isFinite(n) || n < 60 || n > 3600) throw new SettingsValidationError('maxCallDurationSeconds must be 60\u20133600.'); out.maxCallDurationSeconds = Math.round(n); break;
      }
      case 'recordingConsentMessage':
        if (typeof v !== 'string') throw new SettingsValidationError('recordingConsentMessage must be text.'); out.recordingConsentMessage = v.slice(0, 500); break;
      default:
        throw new SettingsValidationError(`Unknown setting: ${k}`);
    }
  }
  return out;
}

export interface SettingsRepo {
  get(tenantId: string, branchId: string): Promise<Partial<ReceptionistSettings> | null>;
  upsert(tenantId: string, branchId: string, merged: ReceptionistSettings, userId: string): Promise<void>;
}
const SENTINEL = '00000000-0000-0000-0000-000000000000';
const scopeBranch = (branchId: string | null) => branchId || SENTINEL;

@Injectable()
export class AiSettingsService {
  constructor(@Inject('SettingsRepo') private readonly repo: SettingsRepo) {}

  async get(ctx: SettingsCtx): Promise<ReceptionistSettings> {
    const stored = await this.repo.get(ctx.tenantId, scopeBranch(ctx.branchId)).catch(() => null);
    return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
  }

  async update(ctx: SettingsCtx, patch: Record<string, unknown>): Promise<ReceptionistSettings> {
    if (!hasPermission(ctx as any, 'ai.manage')) throw new SettingsForbiddenError('Missing ai.manage');
    const valid = validatePatch(patch || {});
    const current = await this.get(ctx);
    const merged: ReceptionistSettings = { ...current, ...valid };
    await this.repo.upsert(ctx.tenantId, scopeBranch(ctx.branchId), merged, ctx.userId);
    return merged;
  }
}

// ---- repos ----
export class InMemorySettingsRepo implements SettingsRepo {
  private map = new Map<string, ReceptionistSettings>();
  private key = (t: string, b: string) => `${t}:${b}`;
  async get(tenantId: string, branchId: string) { return this.map.get(this.key(tenantId, branchId)) ?? null; }
  async upsert(tenantId: string, branchId: string, merged: ReceptionistSettings) { this.map.set(this.key(tenantId, branchId), merged); }
}

export class KyselySettingsRepo implements SettingsRepo {
  constructor(private readonly db: Kysely<any>) {}
  async get(tenantId: string, branchId: string): Promise<Partial<ReceptionistSettings> | null> {
    const r: any = (await sql`SELECT settings FROM ai_receptionist_settings WHERE tenant_id = ${tenantId} AND branch_id = ${branchId} LIMIT 1`.execute(this.db)).rows[0];
    return r ? (typeof r.settings === 'string' ? JSON.parse(r.settings) : r.settings) : null;
  }
  async upsert(tenantId: string, branchId: string, merged: ReceptionistSettings, userId: string): Promise<void> {
    await sql`INSERT INTO ai_receptionist_settings (tenant_id, branch_id, settings, updated_by_user_id, updated_at)
      VALUES (${tenantId}, ${branchId}, ${JSON.stringify(merged)}::jsonb, ${userId}, now())
      ON CONFLICT (tenant_id, branch_id) DO UPDATE SET settings = EXCLUDED.settings, updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = now()`.execute(this.db);
  }
}
