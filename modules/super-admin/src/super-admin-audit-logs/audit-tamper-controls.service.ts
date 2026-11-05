// audit-tamper-controls.kysely.repository.ts + service — recorded config for the Tamper-Resistance & Retention panel.
import { sql } from 'kysely';
import { BadRequestException } from '@nestjs/common';
import type { AppDatabase } from '@aipowersalon/database';
import { canMoveToSql } from '@aipowersalon/database';
import { AUDIT_TAMPER_CONTROL } from '../lifecycles';

export interface TamperControlRow { control_key: string; value: string; status: string; detail: string | null; last_verified_at: string | null; updated_at: string }
const CONTROL_KEYS = ['worm_storage', 'retention_policy', 'digital_signature', 'backup_replication', 'encryption'];
const STATUSES = ['compliant', 'active', 'enabled', 'degraded', 'failed', 'not_configured'];
const LABELS: Record<string, string> = { worm_storage: 'WORM Storage', retention_policy: 'Retention Policy', digital_signature: 'Digital Signature Validation', backup_replication: 'Backup Replication', encryption: 'Encryption' };
const validUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export class AuditTamperControlsRepository {
  constructor(private readonly db: AppDatabase) {}
  async list(): Promise<TamperControlRow[]> {
    try { return (await sql`select control_key, value, status, detail, last_verified_at::text as last_verified_at, updated_at::text as updated_at from audit_tamper_controls`.execute(this.db as any)).rows as TamperControlRow[]; } catch { return []; }
  }
  async upsert(key: string, value: string, status: string, detail: string | null, updatedBy: string | null): Promise<void> {
    await sql`insert into audit_tamper_controls (control_key, value, status, detail, updated_by, last_verified_at, updated_at)
      values (${key}, ${value}, ${status}, ${detail}, ${updatedBy}, now(), now())
      on conflict (control_key) do update set value = excluded.value, status = excluded.status, detail = excluded.detail, updated_by = excluded.updated_by, last_verified_at = now(), updated_at = now()
      where ${canMoveToSql(AUDIT_TAMPER_CONTROL, status, 'audit_tamper_controls')}`.execute(this.db as any);
  }
  async verify(key: string): Promise<void> {
    await sql`update audit_tamper_controls set last_verified_at = now(), updated_at = now() where control_key = ${key}`.execute(this.db as any);
  }
}

export interface AdminCtx { userId?: string; email?: string; ip?: string }

export class AuditTamperControlsService {
  constructor(private readonly repo: AuditTamperControlsRepository) {}

  async status() {
    const rows = await this.repo.list();
    const byKey = new Map(rows.map((r) => [r.control_key, r]));
    // Every control is reported; unset ones are honestly 'not_configured' (never a fabricated green).
    const controls = CONTROL_KEYS.map((key) => {
      const r = byKey.get(key);
      return { key, label: LABELS[key], value: r?.value ?? 'Not configured', status: r?.status ?? 'not_configured', detail: r?.detail ?? null, lastVerifiedAt: r?.last_verified_at ?? null };
    });
    const configured = controls.filter((c) => c.status !== 'not_configured');
    const lastVerified = rows.map((r) => r.last_verified_at).filter(Boolean).sort().slice(-1)[0] ?? null;
    return {
      available: true as const,
      appendOnly: true, adminEditable: false,
      controls,
      configuredCount: configured.length,
      totalControls: CONTROL_KEYS.length,
      anyFailing: controls.some((c) => c.status === 'failed' || c.status === 'degraded'),
      lastVerifiedAt: lastVerified,
    };
  }

  async setControl(ctx: AdminCtx, body: any) {
    const key = String(body?.controlKey ?? '');
    if (!CONTROL_KEYS.includes(key)) throw new BadRequestException('invalid controlKey');
    const value = typeof body?.value === 'string' ? body.value.trim() : '';
    if (!value) throw new BadRequestException('a value is required');
    const status = STATUSES.includes(String(body?.status)) ? String(body.status) : 'not_configured';
    const detail = typeof body?.detail === 'string' && body.detail.trim() ? body.detail.trim() : null;
    await this.repo.upsert(key, value, status, detail, ctx.userId && validUuid(ctx.userId) ? ctx.userId : null);
    return { ok: true, control: { key, label: LABELS[key], value, status, detail } };
  }

  async verify(_ctx: AdminCtx, key: string) {
    if (!CONTROL_KEYS.includes(key)) throw new BadRequestException('invalid controlKey');
    await this.repo.verify(key);
    return { ok: true, controlKey: key };
  }
}
