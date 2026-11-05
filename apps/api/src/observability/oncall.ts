// oncall.ts — BUILD_PLAN Phase 14 C: the Super Admin "On-call & monitoring" surface (Constitution 11 §262–265, §92–95,
// §114–117) and the public alert-acknowledgement link.
//
// Reads are super_admin.system_operations.view. Editing the chain or designating the synthetic test salon is
// super_admin.system.manage + step-up + a reason + audit (who gets woken at 3 a.m., and which salon a probe may read, are
// both security-relevant settings). Acknowledging an alert is super_admin.system.manage WITHOUT step-up — during an
// incident a fresh password prompt is friction in the one place nobody can afford it, and acknowledging only stops the
// chain; it hides nothing (the alert stays open until it resolves).
//
// The public link (public/alert-ack) is excluded from the session middleware (it carries its own signed, single-use,
// expiring token — alert-escalation.ts). GET renders a confirmation page and changes nothing; POST acknowledges.
import { SuperAdminGuard, RequirePermission, RequireStepUp, ValidatedBody } from '@aipowersalon/permissions/guards';
import { S, type BodySchema } from '@aipowersalon/permissions';
import { AuditService } from '@aipowersalon/audit';
import { DATABASE } from '@aipowersalon/database';
import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Injectable, NotFoundException, Optional, Param, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { sql } from 'kysely';
import { AlertEscalation, CHANNELS, OWNERS, maskDestination, validDestination, type AckResult } from './alert-escalation';
import { BackupReportsService, evaluateBackups, BACKUP_MAX_AGE_HOURS } from './backup-reports';
import { readSloValidations } from './slo-validation';
import type {
  AlertAckLinkToken, BackupMonitoring, OnCallAcknowledgement, OnCallBoard, OnCallContactInput, OnCallContactRemoval, OnCallContacts, SloValidation,
  SyntheticMonitoring, SyntheticTestSalonInput,
} from '@aipowersalon/api-contracts/platform';

const reason = S.text(2000);
const hhmm: BodySchema = S.nullable(S.string({ pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' }));
export const ONCALL_CONTACT_BODY: BodySchema = S.object({
  position: S.integer({ minimum: 1, maximum: 50 }),
  role: S.enumOf(['primary', 'secondary', 'incident_commander', 'other']),
  name: S.text(120),
  channel: S.enumOf(CHANNELS),
  destination: S.text(254),
  owners: S.nullable(S.array(S.enumOf(OWNERS), { maxItems: OWNERS.length })),
  quietStart: hhmm, quietEnd: hhmm,
  timezone: S.nullable(S.text(64)),
  active: S.nullable(S.boolean()),
  reason,
}, ['position', 'role', 'name', 'channel', 'destination', 'reason']);
export const ONCALL_DELETE_BODY: BodySchema = S.object({ reason }, ['reason']);
export const SYNTHETIC_SETTINGS_BODY: BodySchema = S.object({ testTenantId: S.nullable(S.uuid()), reason }, ['reason']);

const validTz = (tz: string) => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } };
const actorOf = (req: any) => ({ userId: (req?.ctx?.userId as string | undefined) ?? null });

@Injectable()
export class OnCallService {
  constructor(
    @Optional() @Inject(DATABASE) private readonly db: any,
    @Optional() private readonly escalation?: AlertEscalation,
    @Optional() private readonly backups?: BackupReportsService,
    @Optional() private readonly audit?: AuditService,
  ) {}
  private need() { if (!this.db) throw new BadRequestException('No database'); return this.db; }

  async contacts(): Promise<OnCallContacts> {
    const rows = this.db ? (await sql<any>`select id, position, role, name, channel, destination, owners, quiet_start, quiet_end, timezone, active, updated_at from oncall_contacts order by position, created_at`.execute(this.db)).rows : [];
    return { contacts: rows.map((r: any) => ({ id: r.id, position: r.position, role: r.role, name: r.name, channel: r.channel, destination: r.destination,
      owners: r.owners ?? [], quietStart: r.quiet_start, quietEnd: r.quiet_end, timezone: r.timezone, active: r.active, updatedAt: new Date(r.updated_at).toISOString() })),
      owners: OWNERS, channels: CHANNELS };
  }

  private check(b: any) {
    const destination = String(b.destination ?? '').trim();
    if (!validDestination(b.channel, destination)) throw new BadRequestException(b.channel === 'sms' ? 'SMS needs an E.164 number like +16095551234.' : b.channel === 'push' ? 'Push needs the Super Admin user id.' : 'Not a valid email address.');
    const tz = String(b.timezone ?? 'America/New_York').trim();
    if (!validTz(tz)) throw new BadRequestException('Unknown time zone.');
    if ((b.quietStart == null) !== (b.quietEnd == null)) throw new BadRequestException('Quiet hours need both a start and an end.');
    if (!String(b.reason ?? '').trim()) throw new BadRequestException('A reason is required.');
    return { destination, tz };
  }

  async upsert(id: string | null, b: any, actor: { userId: string | null }) {
    const db = this.need(); const { destination, tz } = this.check(b);
    const owners = [...new Set<string>(b.owners ?? [])];
    let row: any;
    if (id) {
      row = (await sql<any>`update oncall_contacts set position = ${b.position}, role = ${b.role}, name = ${String(b.name).trim()}, channel = ${b.channel},
            destination = ${destination}, owners = ${owners}::text[], quiet_start = ${b.quietStart ?? null}, quiet_end = ${b.quietEnd ?? null}, timezone = ${tz},
            active = ${b.active ?? true}, updated_at = now(), updated_by = ${actor.userId} where id = ${id} returning id, position, role, name, channel, destination`.execute(db)).rows[0];
      if (!row) throw new NotFoundException('Contact not found');
    } else {
      row = (await sql<any>`insert into oncall_contacts (position, role, name, channel, destination, owners, quiet_start, quiet_end, timezone, active, created_by, updated_by)
            values (${b.position}, ${b.role}, ${String(b.name).trim()}, ${b.channel}, ${destination}, ${owners}::text[], ${b.quietStart ?? null}, ${b.quietEnd ?? null}, ${tz}, ${b.active ?? true}, ${actor.userId}, ${actor.userId})
            returning id, position, role, name, channel, destination`.execute(db)).rows[0];
    }
    await this.audit?.recordPlatform({ userId: actor.userId, role: 'SUPER_ADMIN', module: 'system_operations', action: id ? 'oncall_contact_updated' : 'oncall_contact_added',
      resourceType: 'oncall_contact', resourceId: row.id, summary: `${row.role} #${row.position} ${row.name} via ${row.channel} (${maskDestination(row.channel, row.destination)})`, reason: String(b.reason).trim() } as any);
    return this.contacts();
  }

  async remove(id: string, b: any, actor: { userId: string | null }) {
    const db = this.need();
    if (!String(b?.reason ?? '').trim()) throw new BadRequestException('A reason is required.');
    const row = (await sql<any>`delete from oncall_contacts where id = ${id} returning id, name, role`.execute(db)).rows[0];
    if (!row) throw new NotFoundException('Contact not found');
    await this.audit?.recordPlatform({ userId: actor.userId, role: 'SUPER_ADMIN', module: 'system_operations', action: 'oncall_contact_removed', resourceType: 'oncall_contact', resourceId: id, summary: `${row.role} ${row.name}`, reason: String(b.reason).trim() } as any);
    return this.contacts();
  }

  async synthetic(): Promise<SyntheticMonitoring> {
    if (!this.db) return { testTenant: null, probes: [] };
    const s = (await sql<any>`select s.test_tenant_id, s.reason, s.updated_at, t.display_name from synthetic_monitoring_settings s left join tenants t on t.id = s.test_tenant_id where s.id`.execute(this.db)).rows[0];
    const probes = (await sql<any>`select probe, outcome, detail, duration_ms, consecutive_failures, ran_at from synthetic_probe_results order by probe`.execute(this.db)).rows;
    return {
      testTenant: s?.test_tenant_id ? { id: s.test_tenant_id, name: s.display_name ?? null, reason: s.reason, updatedAt: new Date(s.updated_at).toISOString() } : null,
      probes: probes.map((p: any) => ({ probe: p.probe, outcome: p.outcome, detail: p.detail, durationMs: p.duration_ms, consecutiveFailures: p.consecutive_failures, ranAt: new Date(p.ran_at).toISOString() })),
    };
  }

  async setSynthetic(b: any, actor: { userId: string | null }) {
    const db = this.need();
    const r = String(b?.reason ?? '').trim(); if (!r) throw new BadRequestException('A reason is required.');
    const tenantId = b?.testTenantId ?? null;
    if (tenantId && !(await sql`select 1 from tenants where id = ${tenantId}`.execute(db)).rows.length) throw new NotFoundException('Salon not found');
    await sql`insert into synthetic_monitoring_settings (id, test_tenant_id, reason, updated_at, updated_by) values (true, ${tenantId}, ${r}, now(), ${actor.userId})
              on conflict (id) do update set test_tenant_id = excluded.test_tenant_id, reason = excluded.reason, updated_at = now(), updated_by = excluded.updated_by`.execute(db);
    await this.audit?.recordPlatform({ userId: actor.userId, role: 'SUPER_ADMIN', module: 'system_operations', action: 'synthetic_test_salon_changed', resourceType: 'tenant', resourceId: tenantId ?? undefined,
      summary: tenantId ? `synthetic probes may read test salon ${tenantId}` : 'synthetic test salon cleared', reason: r } as any);
    return this.synthetic();
  }

  /** Backups (§114–117): the evaluation the aggregator uses, plus the staleness rule's numbers. */
  async backupStatus(now = Date.now()): Promise<BackupMonitoring> {
    const s = await this.backups?.summary(now).catch(() => null) ?? null;
    return { summary: s, evaluation: evaluateBackups(s, now), maxAgeHours: BACKUP_MAX_AGE_HOURS };
  }

  async board(): Promise<OnCallBoard> { return (await this.escalation?.board()) ?? { alerts: [] }; }
  async slos(): Promise<SloValidation[]> { return this.db ? readSloValidations(this.db) : []; }
}

@UseGuards(SuperAdminGuard)
@Controller('super-admin/oncall')
export class OnCallController {
  constructor(private readonly svc: OnCallService, private readonly escalation: AlertEscalation) {}
  @Get('contacts') @RequirePermission('super_admin.system_operations.view') contacts(): Promise<OnCallContacts> { return this.svc.contacts(); }
  @RequireStepUp()
  @Post('contacts') @RequirePermission('super_admin.system.manage')
  add(@Body(ValidatedBody(ONCALL_CONTACT_BODY)) b: OnCallContactInput, @Req() req: any): Promise<OnCallContacts> { return this.svc.upsert(null, b, actorOf(req)); }
  @RequireStepUp()
  @Put('contacts/:id') @RequirePermission('super_admin.system.manage')
  update(@Param('id') id: string, @Body(ValidatedBody(ONCALL_CONTACT_BODY)) b: OnCallContactInput, @Req() req: any): Promise<OnCallContacts> { return this.svc.upsert(String(id), b, actorOf(req)); }
  @RequireStepUp()
  @Post('contacts/:id/remove') @RequirePermission('super_admin.system.manage')
  remove(@Param('id') id: string, @Body(ValidatedBody(ONCALL_DELETE_BODY)) b: OnCallContactRemoval, @Req() req: any): Promise<OnCallContacts> { return this.svc.remove(String(id), b, actorOf(req)); }
  @Get('alerts') @RequirePermission('super_admin.system_operations.view') alerts(): Promise<OnCallBoard> { return this.svc.board(); }
  @Post('alerts/:id/acknowledge') @RequirePermission('super_admin.system.manage')
  async acknowledge(@Param('id') id: string, @Req() req: any): Promise<OnCallAcknowledgement> {
    const r = await this.escalation.acknowledge(String(id), actorOf(req).userId);
    if (!r.acknowledged) throw new NotFoundException('Alert not found');
    return r;
  }
  @Get('synthetic') @RequirePermission('super_admin.system_operations.view') synthetic(): Promise<SyntheticMonitoring> { return this.svc.synthetic(); }
  @RequireStepUp()
  @Put('synthetic') @RequirePermission('super_admin.system.manage')
  setSynthetic(@Body(ValidatedBody(SYNTHETIC_SETTINGS_BODY)) b: SyntheticTestSalonInput, @Req() req: any): Promise<SyntheticMonitoring> { return this.svc.setSynthetic(b, actorOf(req)); }
  @Get('backups') @RequirePermission('super_admin.system_operations.view') backups(): Promise<BackupMonitoring> { return this.svc.backupStatus(); }
  @Get('slos') @RequirePermission('super_admin.system_operations.view') slos(): Promise<SloValidation[]> { return this.svc.slos(); }
}

// ── The public link ──────────────────────────────────────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const FAIL_TEXT: Record<string, string> = {
  not_configured: 'Acknowledgement links are not configured on this server. Acknowledge the alert in Super Admin → On-call.',
  malformed: 'This link is not valid. Acknowledge the alert in Super Admin → On-call.',
  bad_signature: 'This link is not valid. Acknowledge the alert in Super Admin → On-call.',
  expired: 'This link has expired. Acknowledge the alert in Super Admin → On-call.',
  used_or_unknown: 'This link has already been used (or the alert was already acknowledged). Nothing more to do here.',
};
export function ackPage(kind: 'confirm' | 'done' | 'fail', r: AckResult, token: string): string {
  const body = kind === 'confirm' && r.ok
    ? `<h1>Acknowledge alert?</h1><p>${esc(r.alertTitle)}</p><form method="post" action="?t=${encodeURIComponent(token)}"><button type="submit">Acknowledge — I am on it</button></form><p>This stops the on-call escalation. The alert stays open until it resolves.</p>`
    : kind === 'done' && r.ok ? `<h1>Acknowledged</h1><p>${esc(r.alertTitle)}</p><p>Escalation stopped. Details in Super Admin → System Operations.</p>`
    : `<h1>Not acknowledged</h1><p>${esc(FAIL_TEXT[(r as any).reason] ?? FAIL_TEXT.malformed)}</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>AIPowerSalon alert</title></head><body>${body}</body></html>`;
}

function sendPage(res: any, html: string) {
  // The API's CSP forbids forms (form-action 'none'); this one page posts to itself and nowhere else.
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.type?.('html'); res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}

@Controller('public/alert-ack')
export class AlertAckPublicController {
  constructor(private readonly escalation: AlertEscalation) {}
  /** Shows what would be acknowledged. Changes nothing — mail scanners prefetch links. */
  @Get() async confirm(@Query('t') t: AlertAckLinkToken, @Res() res: any): Promise<void> {
    const r = await this.escalation.peekToken(String(t ?? ''));
    sendPage(res, ackPage(r.ok ? 'confirm' : 'fail', r, String(t ?? '')));
  }
  @Post() @HttpCode(200) async acknowledge(@Query('t') t: AlertAckLinkToken, @Res() res: any): Promise<void> {
    const r = await this.escalation.acknowledgeByToken(String(t ?? ''));
    sendPage(res, ackPage(r.ok ? 'done' : 'fail', r, ''));
  }
}
