// audit-export-flags.kysely.repository.ts + service — rule-based export-risk flags with review/dismiss. Scanning reads
// recent data-export audit events, evaluates documented rules, and upserts flags idempotently (one per event+rule).
import { sql } from 'kysely';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { AppDatabase } from '@aipowersalon/database';
import { evaluateExportRisk, median } from './audit-logs-core';
import { canMoveToSql } from '@aipowersalon/database';
import { AUDIT_EXPORT_FLAG } from '../lifecycles';

export interface ExportFlagRow { id: string; event_ref: string; tenant_id: string | null; rule_key: string; rule_version: number; risk: string; reason: string; status: string; review_note: string | null; created_at: string }
const COLS = sql`id::text as id, event_ref, tenant_id::text as tenant_id, rule_key, rule_version, risk, reason, status, review_note, created_at::text as created_at`;
const validUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export class AuditExportFlagsRepository {
  constructor(private readonly db: AppDatabase) {}

  async recentExportEvents(limit = 200): Promise<{ id: string; tenant_id: string | null; actor: string | null; action: string | null; status: string | null; summary: string | null; metadata: any; occurred_at: string }[]> {
    try { return (await sql`select id::text as id, tenant_id::text as tenant_id, coalesce(actor_user_id::text, actor_name) as actor, action, status, summary, metadata, occurred_at::text as occurred_at from audit_events where lower(action) like '%export%' order by occurred_at desc limit ${limit}`.execute(this.db as any)).rows as any[]; } catch { return []; }
  }
  async upsertFlag(i: { eventRef: string; tenantId: string | null; ruleKey: string; ruleVersion: number; risk: string; reason: string }): Promise<boolean> {
    const r = (await sql`insert into audit_export_flags (event_ref, tenant_id, rule_key, rule_version, risk, reason)
      values (${i.eventRef}, ${i.tenantId}, ${i.ruleKey}, ${i.ruleVersion}, ${i.risk}, ${i.reason})
      on conflict (event_ref, rule_key) do nothing returning id`.execute(this.db as any)).rows;
    return r.length > 0;
  }
  async list(status?: string): Promise<ExportFlagRow[]> {
    const q = status ? sql`select ${COLS} from audit_export_flags where status = ${status} order by created_at desc limit 100` : sql`select ${COLS} from audit_export_flags order by created_at desc limit 100`;
    return (await q.execute(this.db as any)).rows as ExportFlagRow[];
  }
  async get(id: string): Promise<ExportFlagRow | null> {
    const r = (await sql`select ${COLS} from audit_export_flags where id = ${id} limit 1`.execute(this.db as any)).rows[0] as ExportFlagRow | undefined;
    return r ?? null;
  }
  async countOpen(): Promise<number> {
    try { const r = (await sql`select count(*)::int as c from audit_export_flags where status = 'open'`.execute(this.db as any)).rows[0] as { c: number }; return r?.c ?? 0; } catch { return 0; }
  }
  async review(id: string, status: string, note: string | null, reviewedBy: string | null): Promise<void> {
    await sql`update audit_export_flags set status = ${status}, review_note = ${note}, reviewed_by = ${reviewedBy}, reviewed_at = now() where id = ${id} and ${canMoveToSql(AUDIT_EXPORT_FLAG, status)}`.execute(this.db as any);
  }
}

export interface AdminCtx { userId?: string; email?: string; ip?: string }
const shape = (r: ExportFlagRow) => ({ id: r.id, eventRef: r.event_ref, ruleKey: r.rule_key, ruleVersion: r.rule_version, risk: r.risk, reason: r.reason, status: r.status, reviewNote: r.review_note, createdAt: r.created_at });

export class AuditExportFlagsService {
  constructor(private readonly repo: AuditExportFlagsRepository) {}

  /** Evaluate recent export events against documented rules; idempotently record any new flags. */
  async scan(_ctx: AdminCtx) {
    const events = await this.repo.recentExportEvents();
    // Per-actor context for the context-aware rules (velocity + volume-spike baseline), computed in-memory from the same
    // fetched window so it is deterministic and inspectable — not a black box.
    const byActor = new Map<string, { at: number; rc: number }[]>();
    for (const ev of events) {
      const key = ev.actor || 'unknown';
      const rc = Number(ev.metadata?.recordCount ?? ev.metadata?.rows ?? 0) || 0;
      if (!byActor.has(key)) byActor.set(key, []);
      byActor.get(key)!.push({ at: new Date(ev.occurred_at).getTime(), rc });
    }
    let created = 0;
    for (const ev of events) {
      const key = ev.actor || 'unknown';
      const at = new Date(ev.occurred_at).getTime();
      const peers = byActor.get(key) || [];
      const actorExportsLastHour = peers.filter((p) => p.at > at - 3600000 && p.at <= at).length;
      const actorMedianRecordCount = median(peers.filter((p) => p.at < at && p.rc > 0).map((p) => p.rc)); // baseline = this actor's PRIOR exports
      const flags = evaluateExportRisk({ action: ev.action, status: ev.status, summary: ev.summary, metadata: ev.metadata, occurredAt: ev.occurred_at }, { actorExportsLastHour, actorMedianRecordCount });
      for (const f of flags) {
        const isNew = await this.repo.upsertFlag({ eventRef: ev.id, tenantId: ev.tenant_id, ruleKey: f.ruleKey, ruleVersion: f.ruleVersion, risk: f.risk, reason: f.reason });
        if (isNew) created++;
      }
    }
    return { ok: true, scanned: events.length, created };
  }

  async list(status?: string) { return { flags: (await this.repo.list(status)).map(shape) }; }

  async review(ctx: AdminCtx, id: string, body: any) {
    const status = String(body?.status ?? '');
    if (!['reviewed', 'dismissed'].includes(status)) throw new BadRequestException('status must be reviewed or dismissed');
    if (status === 'dismissed' && (typeof body?.note !== 'string' || body.note.trim().length < 3)) throw new BadRequestException('a reason is required to dismiss a flag as a false positive');
    const existing = await this.repo.get(id);
    if (!existing) throw new NotFoundException('flag not found');
    await this.repo.review(id, status, typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null, ctx.userId && validUuid(ctx.userId) ? ctx.userId : null);
    return { ok: true, id, status };
  }
}
