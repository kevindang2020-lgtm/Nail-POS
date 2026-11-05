// metrics.controller.ts — BUILD_PLAN Phase 11 (Constitution 4 §101, Constitution 11 §188): GET /metrics, the Prometheus
// scrape of this process's metrics registry (HTTP, DB, jobs, providers, realtime, tracing exporter counters).
//
// WHO MAY READ IT. Metrics hold no tenant data (labels are route templates, job types, providers — never a tenant, §38)
// but they describe the platform's internals and load, so the route is not open in production:
//   METRICS_TOKEN set      → `Authorization: Bearer <token>` required everywhere (constant-time compare); else 401.
//   no token, production   → 404, as if the route did not exist. Operations configures the token to turn it on.
//   no token, elsewhere    → open (a local Prometheus / docker-compose scrape with nothing to configure).
// It needs no session (the token is its authentication), so it is excluded from the session middleware in app.module.ts
// and listed as public-by-design in check:public. No @RequirePermission: there is no principal to hold one.
import { Controller, Get, HttpException, HttpStatus, Req, Res } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { registry } from '@aipowersalon/observability';

export type MetricsAccess = 'ok' | 'open' | 'unauthorized' | 'not_found';

const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest();

export function metricsAccess(authorization: unknown, env: NodeJS.ProcessEnv = process.env): MetricsAccess {
  const token = String(env.METRICS_TOKEN ?? '').trim();
  if (!token) return env.NODE_ENV === 'production' ? 'not_found' : 'open';
  const m = /^Bearer\s+(.+)$/i.exec(typeof authorization === 'string' ? authorization.trim() : '');
  if (!m) return 'unauthorized';
  // Equal-length digests: timingSafeEqual needs equal lengths, and comparing hashes leaks neither the token nor its length.
  return timingSafeEqual(digest(m[1].trim()), digest(token)) ? 'ok' : 'unauthorized';
}

@Controller('metrics')
export class MetricsController {
  @Get()
  scrape(@Req() req: any, @Res() res: any): void {
    const access = metricsAccess(req?.headers?.authorization);
    if (access === 'not_found') throw new HttpException({ message: `Cannot GET /metrics`, error: 'Not Found', statusCode: 404 }, HttpStatus.NOT_FOUND);
    if (access === 'unauthorized') {
      try { res.setHeader('WWW-Authenticate', 'Bearer realm="metrics"'); } catch { /* headers sent */ }
      throw new HttpException({ message: 'A valid metrics token is required', statusCode: 401 }, HttpStatus.UNAUTHORIZED);
    }
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    // A Buffer, so Express keeps the Prometheus content type exactly (with a string it re-orders the charset parameter).
    res.status(200).send(Buffer.from(registry.exposition(), 'utf8'));
  }
}
