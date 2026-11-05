// main.ts — AIPowerSalon API bootstrap.
import './common/utc-clock';   // FIRST: the process runs in UTC before anything reads the clock
import { apiVersionMiddleware } from './common/api-version';
import { trustProxyHops, eventPublisherEnabled, runsBackgroundJob } from '@aipowersalon/config';
import { networkPosture } from './common/network-posture';
import { assertProductionConfig } from './common/production-config';
import 'reflect-metadata';
import { computeAllowedOrigins, isOriginAllowed } from './common/allowed-origins';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import { platformAliasMiddleware } from './common/platform-alias';
import { apiCompression } from './common/http-compression';
import { breakGlassMiddleware, breakGlassConfigProblem, breakGlassMode } from './common/maintenance-break-glass';
import { AppModule } from './app.module';
import { PinoLoggerService } from '@aipowersalon/observability/nest';

async function bootstrap() {
  assertProductionConfig();
  // rawBody: true makes the EXACT request bytes available as req.rawBody (used by the payment webhook controller to
  // verify processor HMAC signatures over the original bytes, not a re-serialized copy). Parsed @Body() still works.
  // Constitution 7 §5: /api/v1/platform/* is an alias of /super-admin/* — rewritten on our own Express instance so it
  // runs before any Nest middleware (see common/platform-alias.ts for why that ordering matters).
  const server = express();
  server.use(platformAliasMiddleware);
  // Constitution 5 §11–13: every route is also /api/v1/*; legacy paths say so in Deprecation/Link headers (api-version.ts)
  server.use(apiVersionMiddleware);
  // Smooth Refresh spec §88: gzip/deflate API responses ≥ 1 KB — never the SSE streams (see common/http-compression.ts).
  server.use(apiCompression());
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server), { rawBody: true });
  // Constitution 12 §50: trust EXACTLY the proxy hops in front of us (Railway's edge = 1), so req.ip is the real
  // client and a client-written X-Forwarded-For entry is ignored. See common/client-ip.ts.
  (app as any).getHttpAdapter?.().getInstance?.().set?.('trust proxy', trustProxyHops());
  // Constitution 12 §50–55: warn loudly when configuration defeats Railway's private network (never a refusal).
  for (const f of networkPosture()) console.error(`[security] network posture: ${f.variable}: ${f.problem}`);
  // Production observability: structured JSON logs (CloudWatch-friendly) via pino. Dev/test keep Nest's default logger,
  // so local output and the test suite are unaffected. Level via LOG_LEVEL.
  if (process.env.NODE_ENV === 'production') {
    app.useLogger(new PinoLoggerService());
    // Constitution 8: the outbox publisher is ON in production unless EVENT_PUBLISHER_ENABLED=off (Oct 3 2026). With it
    // off, screens still refresh (services fall back to direct pushes) but push on queue assignment, loyalty earning,
    // the analytics rollup and the AI usage ledger never run. And it only runs in a process whose PROCESS_ROLE includes
    // background jobs — a web replica on PROCESS_ROLE=api needs a worker service beside it.
    // Constitution 3 Step 6: internal routes (jobs, schedulers, billing, backups) authenticate with service tokens
    // signed by SERVICE_TOKEN_SECRET — a key separate from the session secret. Without it they accept only their
    // legacy shared headers (if still set).
    if (String(process.env.SERVICE_TOKEN_SECRET ?? '').length < 32) {
      console.error('[auth] SERVICE_TOKEN_SECRET is not set (32+ characters): internal routes fall back to their legacy shared headers only. Set it, and call jobs with scripts/call-internal.mjs.');
    }
    if (!eventPublisherEnabled()) {
      console.error('[events] EVENT_PUBLISHER_ENABLED=off: the outbox publisher is OFF — domain events are recorded but never delivered (no push on queue assignment, no loyalty earn, no analytics rollup, no AI usage ledger).');
    } else if (!runsBackgroundJob('critical')) {
      console.error(`[events] this process (PROCESS_ROLE=${process.env.PROCESS_ROLE}) does not run the outbox publisher — make sure a worker service with PROCESS_ROLE=worker (or all) is running, or domain events are recorded but never delivered.`);
    }
  }
  app.setGlobalPrefix('');
  // CORS. Allowlist is env-configurable (WEB_CORS_ORIGINS, comma-separated).
  //
  // ⚠️ CREDENTIALS MUST BE ON. This used to be `credentials: isDev`, on the reasoning that "the browser won't send
  // cookies cross-origin anyway, so leaving it off is safe". That reasoning is inverted, and it broke production:
  //
  //   • The web apps are deployed CROSS-ORIGIN from the API — `pos-web` at pos.aipowersalon.com is built with
  //     VITE_API_BASE=https://api.aipowersalon.com (see DEPLOY_RUNBOOK).
  //   • Every client fetch uses `credentials: "include"`, because it needs the session cookie.
  //   • Per the Fetch spec, a response to a credentialed request is **DISCARDED by the browser** unless it carries
  //     `Access-Control-Allow-Credentials: true`.
  //
  // So with credentials off, EVERY authenticated call from the POS and Admin apps failed in production — including
  // login. The cookie itself was fine (pos.* and api.* share the registrable domain, so SameSite=Lax permits it);
  // the browser was simply throwing the response away.
  //
  // Enabling it is safe here precisely because the allowlist is strict: specific origins, never `*` (browsers
  // forbid `*` with credentials anyway), and Nest echoes back the exact requesting origin.
  // The allow-list is computed ONCE in common/allowed-origins.ts and shared with the realtime gateway (Constitution 9
  // §196) so a credentialed SSE stream is refused at the server for the same origins CORS refuses.
  const allowedOrigins = computeAllowedOrigins();
  app.enableCors({
    origin: (origin, cb) => cb(null, isOriginAllowed(origin, allowedOrigins)),   // explicit list + dev-only localhost/LAN (allowed-origins.ts)
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    // Idempotency-Key (Constitution 5 §61–66): without it here the browser's preflight fails and a refund never leaves the app.
    allowedHeaders: ['Content-Type', 'Authorization', 'x-request-id', 'x-correlation-id', 'Idempotency-Key', 'If-Match',
      // BUILD_PLAN Phase 13 (Constitution 6 §12): the mobile transport names its app, version, platform and install on every call
      'X-Client-Type', 'X-Client-Version', 'X-Client-Platform', 'X-Device-ID',
      'x-client-type', 'x-client-version', 'x-client-platform', 'x-device-id',
      'x-device-token', 'X-Device-Token', 'last-event-id', 'prefer', 'Accept'],
    // Constitution 11 §7/§198: x-request-id is set on EVERY response, but a browser may only read a cross-origin
    // response header that CORS exposes. Without this, every "Reference: req_…" a client tries to show is empty and
    // a crash report can never be matched to the request that caused it. x-correlation-id may be SENT by clients so a
    // multi-request workflow (booking → verify → confirm) keeps one chain.
    // Readable by app code: a replayed answer, and the /api/v1 migration signals (Deprecation / Link / Sunset).
    exposedHeaders: ['x-request-id', 'Idempotent-Replayed', 'Deprecation', 'Link', 'Sunset', 'ETag', 'x-authorization-changed'],   // BUILD_PLAN Phase 9: the session was re-authorized — refetch session / navigation
    credentials: true,   // see above — without this the browser discards every credentialed response
    maxAge: 86400,
  });
  // BUILD_PLAN Phase 11 (Constitution 4 §139): MAINTENANCE_BREAK_GLASS — plain Express middleware, read from the
  // environment per request, NO database. Mounted here: after CORS (a browser can read the 503) and before Nest's own
  // middleware and routes (registered at listen), so it answers even when the session / tenant / DB layers cannot.
  app.use(breakGlassMiddleware());
  { const p = breakGlassConfigProblem(); if (p) console.error(`[maintenance] ${p}`); else if (breakGlassMode() !== 'off') console.error(`[maintenance] MAINTENANCE_BREAK_GLASS=${breakGlassMode()} — the platform is in emergency maintenance`); }
  // Large CSV imports (e.g. 50k+ customer rows ≈ a few MB) ride in the JSON body; the default (~100kb) is far too small.
  // Override-able via MAX_BODY_SIZE. The payment webhook still uses req.rawBody (rawBody:true) for HMAC verification.
  const bodyLimit = process.env.MAX_BODY_SIZE || '25mb';
  (app as any).useBodyParser?.('json', { limit: bodyLimit });
  (app as any).useBodyParser?.('urlencoded', { extended: true, limit: bodyLimit });
  const port = Number(process.env.PORT) || 3001;
  // Constitution 9 graceful shutdown: SIGTERM/SIGINT reach OnApplicationShutdown hooks, so the realtime gateway can tell
  // every connected client to reconnect (to a surviving instance) BEFORE the sockets are torn down.
  app.enableShutdownHooks();
  await app.listen(port, '0.0.0.0');
   
  console.log(`AIPowerSalon API listening on :${port}`);
}
bootstrap();
