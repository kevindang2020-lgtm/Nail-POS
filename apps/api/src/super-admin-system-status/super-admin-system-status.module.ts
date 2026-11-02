import { Body, Controller, Get, Param, Post, Query, Req, UseGuards, Module } from '@nestjs/common';
import { IncidentWorkflowService } from './incident-workflow';
import { SuperAdminGuard, ValidatedBody } from '@aipowersalon/permissions/guards';
import { DATABASE, type AppDatabase, ListQueries } from '@aipowersalon/database';
import { SystemStatusService } from './system-status.service';
import { InMemorySystemStatusRepo, type SystemStatusRepo } from './system-status.repository';
import { KyselySystemStatusRepo } from './system-status.kysely.repository';
import { PlatformInfrastructureService } from './platform-infrastructure';   // storage + deployments panels (Oct 21 2026)
import { InProcessEmitter } from '../realtime/realtime.gateway';
import { evaluateRealtimeHealth } from '../realtime/realtime-health';
import { PresenceService } from '../realtime/presence';
import { PlatformLiveOpsService } from '../realtime/platform-live-ops';
import { SuperAdminRealtimeController } from './super-admin-realtime.controller';
import { Optional } from '@nestjs/common';
import { SystemStatusControllerListQueries } from './super-admin-system-status.module.list-queries';
import { INCIDENT_COMMANDER_BODY, INCIDENT_CREATE_BODY, INCIDENT_STATUS_BODY, INCIDENT_TIMELINE_BODY, MAINTENANCE_BODY, NOTIFY_TENANTS_BODY, POST_INCIDENT_REPORT_BODY, PUBLIC_UPDATE_BODY } from './request-schemas';

@UseGuards(SuperAdminGuard)
@ListQueries(SystemStatusControllerListQueries)
@Controller('super-admin/system-status')
export class SystemStatusController {
  constructor(private readonly svc: SystemStatusService, private readonly bus: InProcessEmitter, private readonly incidents: IncidentWorkflowService, private readonly infra: PlatformInfrastructureService, @Optional() private readonly presence?: PresenceService) {}
  /** the Storage and Deployments panels: database size + heaviest tables, where media lives, the running build, the schema ledger */
  @Get('infrastructure') async infrastructure() { const [storage, deployments] = await Promise.all([this.infra.storage(), this.infra.deployments()]); return { storage, deployments }; }
  @Get('overview') overview(@Query() q: any) { return this.svc.getOverview({ statusLevel: q?.statusLevel || undefined, serviceGroup: q?.serviceGroup || undefined, incidentStatus: q?.incidentStatus || undefined }); }
  @Post('incidents') createIncident(@Body(ValidatedBody(INCIDENT_CREATE_BODY, { strict: true })) b: any) { return this.svc.createIncident({ title: b?.title, componentKey: b?.componentKey, severity: b?.severity, impact: b?.impact, affectedTenants: b?.affectedTenants }); }
  // Constitution 11 §169–176: every status change goes through the workflow's single rule set and writes the timeline.
  @Post('incidents/:id/status') updateStatus(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(INCIDENT_STATUS_BODY, { strict: true })) b: any) { return this.incidents.transition(id, b?.status, { actor: r?.ctx?.userId ?? null, resolution: b?.resolution }); }
  @Post('incidents/:id/commander') assignCommander(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(INCIDENT_COMMANDER_BODY, { strict: true })) b: any) { return this.incidents.assignCommander(id, b?.commander, r?.ctx?.userId ?? null); }
  @Post('incidents/:id/timeline') addTimeline(@Req() r: any, @Param('id') id: string, @Body(ValidatedBody(INCIDENT_TIMELINE_BODY, { strict: true })) b: any) { return this.incidents.addEntry(id, b?.kind, b?.body, r?.ctx?.userId ?? null, b?.ref ?? null); }
  @Get('incidents/:id/timeline') timeline(@Param('id') id: string) { return this.incidents.timeline(id); }
  @Post('alerts/:alertId/promote') promote(@Req() r: any, @Param('alertId') alertId: string) { return this.incidents.promoteAlert(alertId, r?.ctx?.userId ?? null); }
  @Get('postmortems-owed') postmortemsOwed() { return this.incidents.postmortemsOwed(); }
  @Post('public-updates') publishUpdate(@Body(ValidatedBody(PUBLIC_UPDATE_BODY, { strict: true })) b: any) { return this.svc.publishUpdate({ title: b?.title, body: b?.body, audience: b?.audience, incidentId: b?.incidentId }); }
  @Post('maintenance') scheduleMaintenance(@Body(ValidatedBody(MAINTENANCE_BODY, { strict: true })) b: any) { return this.svc.scheduleMaintenance({ service: b?.service, scope: b?.scope, windowStart: b?.windowStart, windowEnd: b?.windowEnd, tenantImpact: b?.tenantImpact, owner: b?.owner }); }
  @Post('post-incident-reports') createReport(@Body(ValidatedBody(POST_INCIDENT_REPORT_BODY, { strict: true })) b: any) { return this.svc.createPostIncidentReport({ title: b?.title, incidentReference: b?.incidentReference, summary: b?.summary, rootCause: b?.rootCause, owner: b?.owner }); }
  @Post('notify-tenants') notify(@Body(ValidatedBody(NOTIFY_TENANTS_BODY, { strict: true })) b: any) { return this.svc.notifyTenants({ message: b?.message, channel: b?.channel, audience: b?.audience, incidentReference: b?.incidentReference, sentBy: b?.sentBy }); }

  // ── §34 REAL-TIME SYNCHRONIZATION — this node's live delivery health. Counters and room KEYS only; no tenant
  // content ever leaves this endpoint. Multi-node note is included so the reader knows the scope of the numbers.
  @Get('realtime')
  async realtime() {
    const m = this.bus.metrics.snapshot();
    const roomList = this.bus.roomsSnapshot();
    const tenantChannels = roomList.filter((r) => r.room.startsWith('tenant:')).length;
    const posClients = roomList.filter((r) => /^tenant:.*:branch:/.test(r.room)).reduce((a, r) => a + r.subscribers, 0);
    const otherClients = this.bus.totalSubscribers() - posClients;
    return {
      // Constitution 9 §143/§147: one verdict from the incident evaluator, with the signals that produced it.
      ...evaluateRealtimeHealth({
        activeConnections: this.bus.totalSubscribers(), reconnectsPerMinute: m.reconnectsPerMinute, authFailuresPerMinute: m.authFailuresPerMinute,
        latencyP95Ms: m.latencyP95Ms, eventsPerMinute: m.eventsPerMinute, backbone: process.env.REALTIME_REDIS_URL || process.env.REDIS_URL ? 'redis' : 'in-process',
        backbonePublishFailures: m.backbonePublishFailures, slowClientDisconnects: m.slowClientDisconnects,
      }),
      backbone: process.env.REALTIME_REDIS_URL || process.env.REDIS_URL ? 'redis' : 'in-process (single node)',
      // §143 "Connections by Tenant" — from the presence registry, which is cross-instance when Redis-backed
      presence: this.presence ? await this.presence.platformView() : null,
      counters: { resyncsRequired: m.resyncsRequired, authzTerminations: m.authzTerminations, slowClientDrops: m.slowClientDrops, slowClientResyncs: m.slowClientResyncs,
        slowClientDisconnects: m.slowClientDisconnects, originRejected: m.originRejected, connectsRateLimited: m.connectsRateLimited, backbonePublishFailures: m.backbonePublishFailures,
        reconnectsPerMinute: m.reconnectsPerMinute, authFailuresPerMinute: m.authFailuresPerMinute },
      scope: 'this API node (per-node metrics; Redis fan-out carries events across nodes)',
      connectedPosClients: posClients,
      connectedOtherClients: otherClients,
      activeTenantChannels: tenantChannels,
      eventsPerMinute: m.eventsPerMinute,
      eventsDelivered: m.eventsDelivered,
      failedDeliveries: m.eventsDropped,
      reconnects: m.reconnects,
      connectionsOpened: m.connectionsOpened,
      connectionsClosed: m.connectionsClosed,
      latencyP50Ms: m.latencyP50Ms, latencyP95Ms: m.latencyP95Ms, latencyP99Ms: m.latencyP99Ms,
    };
  }

  // ── §35 tenant diagnostics — "My Booking page isn't updating." Shows whether THIS tenant has live channels on
  // this node, per-branch subscriber counts, and the last events delivered to its rooms (event names only).
  @Get('realtime/tenant/:tenantId')
  async realtimeTenant(@Param('tenantId') tenantId: string) {
    const prefix = `tenant:${tenantId}:`;
    const channels = this.bus.roomsSnapshot().filter((r) => r.room.startsWith(prefix));
    const recent = this.bus.log.filter((e) => e.room.startsWith(prefix)).slice(-10)
      .map((e) => ({ room: e.room, event: e.event }));
    // §144: devices connected by kind, from the presence registry (cross-instance when Redis-backed), without content.
    const pv = this.presence ? await this.presence.tenantView(tenantId) : null;
    const byRole = (r: string) => pv ? pv.connections.filter((c) => c.role === r).length : null;
    return {
      tenantId,
      presence: pv ? { total: pv.total, byBranch: pv.byBranch, posDevices: (byRole('OWNER') ?? 0) + (byRole('MANAGER') ?? 0) + (byRole('FRONT_DESK') ?? 0) + (byRole('RECEPTION') ?? 0),
        technicianApps: byRole('TECHNICIAN'), lastActivity: pv.connections.map((c) => c.lastHeartbeatAt).sort().pop() ?? null } : null,
      connectedChannels: channels,
      totalSubscribers: channels.reduce((a, c) => a + c.subscribers, 0),
      lastEvents: recent,
      note: channels.length === 0 ? 'No live connections for this tenant on this node — the POS may be closed, offline, or connected to another node.' : undefined,
    };
  }
}

@Module({
  controllers: [SystemStatusController, SuperAdminRealtimeController],
  providers: [IncidentWorkflowService, { provide: 'SYSTEM_STATUS_REPO', useFactory: (db: AppDatabase): SystemStatusRepo => (db ? new KyselySystemStatusRepo(db) : new InMemorySystemStatusRepo()), inject: [DATABASE, PlatformLiveOpsService] },
    { provide: SystemStatusService, useFactory: (repo: SystemStatusRepo) => new SystemStatusService(repo), inject: ['SYSTEM_STATUS_REPO'] },
    { provide: PlatformInfrastructureService, useFactory: (db: AppDatabase) => new PlatformInfrastructureService(db ?? null), inject: [DATABASE] },
    // Constitution 9 Phase 20's platform projection (PlatformLiveOpsService) is provided by the global RealtimeModule since
    // B-14 (Oct 20 2026) — injected here, not owned here, so the events layer no longer imports this module
  ],
  exports: [SystemStatusService],
})
export class SuperAdminSystemStatusModule {}
