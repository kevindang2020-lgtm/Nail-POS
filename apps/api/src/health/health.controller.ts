// health.controller.ts — public, unauthenticated probes for load balancers / AWS App Runner, and for the synthetic
// monitor. No @RequirePermission and no @UseGuards, so the global RolePermissionGuard passes them and no tenant/auth
// guard applies. Listed in check:public's PUBLIC_BY_DESIGN (a health probe returns no tenant data).
//
// Constitution 11 §84–87:
//   GET /health        — unchanged for existing load-balancer configuration: liveness plus uptime.
//   GET /health/live   — §85 "is this process alive?" Touches nothing external. Never queries a provider.
//   GET /health/ready  — §86 "can this instance safely serve traffic?" Checks the CRITICAL dependency only — the
//                        database — with a short timeout, and answers 503 when it cannot. §87: it deliberately does NOT
//                        check AI, Twilio, email or push. An optional provider being down must never take an instance
//                        out of the load balancer: the POS keeps working without AI, and a readiness probe that
//                        failed on it would turn a degraded feature into a full outage.
// Dependency health for every provider is platform-only, in System Operations (Phase 16), not on a public route.
import { Controller, Get, HttpCode, Inject, Optional, Res, type BeforeApplicationShutdown } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE } from '@aipowersalon/database';
import { BUILD } from '@aipowersalon/observability';
import { cachedSchemaVersion, summarizeSchema } from '../observability/schema-version';

export const READY_PROBE_TIMEOUT_MS = 2_000;

@Controller('health')
export class HealthController implements BeforeApplicationShutdown {
  private readonly startedAt = Date.now();
  private shuttingDown = false;
  /** On SIGTERM the instance stops being READY at once (Oct 6 2026), so the load balancer stops routing new requests to it
   *  while it drains, instead of sending them to a process that is about to close its server. Liveness is unchanged. */
  beforeApplicationShutdown(): void { this.shuttingDown = true; }
  constructor(@Optional() @Inject(DATABASE) private readonly db?: any) {}

  /** BUILD_PLAN Phase 11 (Constitution 4 §131): + `schemaVersion` — the latest applied migration and the pending /
   *  drifted counts against this image's files. Cached 60 s and bounded at 1 s, so a slow or dead database never slows
   *  this probe (it answers `status: 'unknown'` instead); liveness stays 'ok' either way. */
  @Get()
  async health() {
    const schemaVersion = summarizeSchema(await cachedSchemaVersion(this.db));
    return { status: 'ok', uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000), timestamp: new Date().toISOString(), version: BUILD.version, commit: BUILD.commit, schemaVersion };
  }

  @Get('live')
  @HttpCode(200)
  live() { return { status: 'alive' }; }

  /** 200 when every critical dependency answers; 503 naming what failed. Never includes connection details. */
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: any) {
    const failed: string[] = [];
    if (this.shuttingDown) failed.push('shutting_down');
    if (!this.db) failed.push('database_not_configured');
    else {
      try {
        await Promise.race([
          sql`select 1`.execute(this.db),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), READY_PROBE_TIMEOUT_MS)),
        ]);
      } catch { failed.push('database'); }
    }
    if (failed.length) { try { res?.status?.(503); } catch { /* not in an HTTP context (tests) */ } return { status: 'not_ready', failed }; }
    return { status: 'ready' };
  }
}
