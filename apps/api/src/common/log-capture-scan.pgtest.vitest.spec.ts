// log-capture-scan.pgtest — Security Deep Scan §128: a security test that CAPTURES what the API writes while it serves
// representative flows and scans it for card numbers, Authorization / Bearer values, refresh tokens, passwords and provider
// API keys. Not a unit test of the redactor: a real Nest app (the production exception filter + request-context middleware,
// the REAL identity AuthModule over a migrated Postgres, the REAL payment webhook module, the real CardPointe client against
// a local processor that echoes what it was sent), with every log destination captured:
//   • the application logger (setLogSink — what the console sink would print, after redaction),
//   • the Nest logger as production installs it (PinoLoggerService over a capturing destination),
//   • console.* and process.stdout / stderr (anything that bypasses the logger).
// Flows: tenant sign-in with a wrong then the right password; refresh-token rotation and a REUSED refresh token; a native
// Bearer request; a card sale whose processor answers 500 echoing the PAN / CVV / Basic credential; a refund the processor
// refuses the same way; a payment webhook from an unknown merchant and one with a bad signature, both carrying a PAN and a
// provider key; an unexpected exception whose message carries every secret shape; Nest-level log lines through pino.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import 'reflect-metadata';
import { createServer } from 'node:http';
import { Controller, Global, Module, Post, Body, Get, MiddlewareConsumer, NestModule, RequestMethod } from '@nestjs/common';
import { NestFactory, APP_FILTER } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import { Writable } from 'node:stream';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { DATABASE } from '@aipowersalon/database';
import { hashPassword } from '@aipowersalon/auth';
import { setLogSink } from '@aipowersalon/observability';
import { PinoLoggerService, RequestContextMiddleware, PlatformExceptionFilter } from '@aipowersalon/observability/nest';
import { AuthModule } from '@aipowersalon/identity';
import { PaymentWebhookModule, processorFromEnv } from '@aipowersalon/payments';
import { SecurityEvents } from '@aipowersalon/security-center';
import { MFA_ATTEMPT_LIMITER } from '@aipowersalon/security';
import { ProviderSecretsModule } from './provider-secrets.module';
import { RateLimitModule } from './rate-limit.module';
import { leaksIn } from '../../test-support/log-leak-scan';

// ── the secrets this run sends (exact values) ────────────────────────────────────────────────────────────────────
const PAN = '4111111111111111', PAN2 = '5500005555555559', CVV = '737';
const PASSWORD = 'Correct-Horse-91!', WRONG = 'Wrong-Battery-27!';
const PROVIDER_KEY = 'sk-proj-' + 'AbCdEf0123456789'.repeat(2);
const AWS_KEY = 'AKIA' + 'ABCDEFGHIJKLMNOP';
const CP_USER = 'cp-merchant-user', CP_PASS = 'cp-merchant-pass-77';

const T = 'f9000000-0000-4000-8000-0000000000aa', B = 'f9100000-0000-4000-8000-0000000000aa', U = 'f9200000-0000-4000-8000-0000000000aa';
const captured: string[] = [];
const exact: string[] = [PAN, PAN2, PASSWORD, WRONG, PROVIDER_KEY, AWS_KEY, CP_PASS, Buffer.from(`${CP_USER}:${CP_PASS}`).toString('base64')];

let pg: any; let app: any; let base = ''; let processor: any; const restore: Array<() => void> = [];

@Controller('flow')
class FlowController {
  @Post('card-sale') async sale(@Body() b: any) { return processorFromEnv()!.authorizeAndCapture({ account: b.account, expiry: '1229', cvv: b.cvv, amountCents: 5000, orderId: 'order-1' } as any); }
  @Post('refund') async refund(@Body() b: any) { return processorFromEnv()!.refund({ retref: b.retref, amountCents: 5000 } as any); }
  @Get('boom') boom() { throw new Error(`unexpected: card ${PAN} cvv ${CVV} Authorization: Bearer ${PROVIDER_KEY} key ${AWS_KEY} refresh rt_${'Zz9-'.repeat(11)}`); }
}
@Global() @Module({ providers: [{ provide: DATABASE, useFactory: () => kyselyFor(pg) }, { provide: MFA_ATTEMPT_LIMITER, useValue: null },
  { provide: SecurityEvents, useFactory: (db: any) => new SecurityEvents(db), inject: [DATABASE] }], exports: [DATABASE, MFA_ATTEMPT_LIMITER, SecurityEvents] })
class Infra {}
@Module({ imports: [Infra, ProviderSecretsModule, RateLimitModule, AuthModule, PaymentWebhookModule], controllers: [FlowController], providers: [{ provide: APP_FILTER, useClass: PlatformExceptionFilter }] })
class LogCaptureApp implements NestModule { configure(c: MiddlewareConsumer) { c.apply(RequestContextMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL }); } }

function captureWrites() {
  const keep = (o: any, k: string) => { const orig = o[k]; o[k] = (...a: any[]) => { captured.push(a.map((x) => (typeof x === 'string' ? x : (() => { try { return JSON.stringify(x); } catch { return String(x); } })())).join(' ')); return true; }; restore.push(() => { o[k] = orig; }); };
  for (const k of ['log', 'info', 'warn', 'error', 'debug']) keep(console, k);
  for (const s of [process.stdout, process.stderr]) { const orig = s.write.bind(s); (s as any).write = (chunk: any, ...rest: any[]) => { captured.push(String(chunk)); const cb = rest.find((r) => typeof r === 'function'); if (cb) cb(); return true; }; restore.push(() => { (s as any).write = orig; }); }
  setLogSink({ write: (rec) => captured.push(JSON.stringify(rec)) }); restore.push(() => setLogSink(null));
}

const cookiesOf = (r: Response) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]);

beforeAll(async () => {
  pg = await migratedPglite();
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'LOGS', 'LOGS', 'log-scan', 'LOGSCAN1', 'active') ON CONFLICT DO NOTHING;
    INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B}', '${T}', 'Main', 'active') ON CONFLICT DO NOTHING;`);
  await pg.query(`INSERT INTO users (id, tenant_id, branch_id, full_name, email, password_hash, status, role) VALUES ($1, $2, $3, 'Log Owner', 'owner@log-scan.test', $4, 'active', 'OWNER') ON CONFLICT DO NOTHING`, [U, T, B, await hashPassword(PASSWORD)]);
  await pg.query(`INSERT INTO user_branch_access (tenant_id, branch_id, user_id, access_level) VALUES ($1, $2, $3, 'manager') ON CONFLICT DO NOTHING`, [T, B, U]);
  await pg.query(`UPDATE tenants SET owner_user_id = $2 WHERE id = $1`, [T, U]);
  // the "processor": answers every call with an error that echoes the request (headers included), as real gateways do
  processor = createServer((req, res) => { let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => { res.writeHead(req.url?.includes('refund') ? 502 : 500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'bad request', echo: body, authorization: req.headers.authorization })); }); });
  await new Promise<void>((r) => processor.listen(0, '127.0.0.1', () => r()));
  Object.assign(process.env, { AUTH_SESSION_SECRET: 'log-capture-session-secret-0123456789abcdef', CARDPOINTE_BASE_URL: `http://127.0.0.1:${processor.address().port}`, CARDPOINTE_MERCHID: '496160873888', CARDPOINTE_USERNAME: CP_USER, CARDPOINTE_PASSWORD: CP_PASS, LOG_LEVEL: 'debug',
    // merged Nov 7 2026: the strict reuse rule (no grace window) so the replayed token takes the reuse path and its log is scanned
    REFRESH_REUSE_GRACE_SECONDS: '0' });
  captureWrites();
  const server = express(); server.set('trust proxy', 1); server.use(express.json());
  const dest = new Writable({ write(chunk, _e, cb) { captured.push(String(chunk)); cb(); } });
  app = await NestFactory.create(LogCaptureApp, new ExpressAdapter(server), { logger: new PinoLoggerService(dest as any), bodyParser: false });
  // vitest's transform emits no design:paramtypes, so Nest leaves the constructor parameters that rely on the TYPE (no
  // @Inject) undefined; hand them their real, factory-built providers from the container (everything else is as wired)
  const byName = (name: string) => { for (const m of (app as any).container.getModules().values()) for (const w of [...m.providers.values(), ...m.controllers.values()]) if (w?.name === name || (typeof w?.token === 'function' && w.token.name === name)) return w.instance; return null; };
  const authCtl = byName('AuthController'); authCtl.login ??= byName('LoginService'); authCtl.branches ??= byName('BranchSelectionService');
  const whCtl = byName('PaymentWebhookController'); whCtl.svc ??= byName('PaymentWebhookService');
  expect(authCtl.login && authCtl.branches && whCtl.svc, 'the real providers were found').toBeTruthy();
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
}, 180_000);
afterAll(async () => { for (const r of restore.reverse()) r(); await app?.close(); processor?.close(); for (const k of ['CARDPOINTE_BASE_URL', 'CARDPOINTE_MERCHID', 'CARDPOINTE_USERNAME', 'CARDPOINTE_PASSWORD', 'LOG_LEVEL', 'REFRESH_REUSE_GRACE_SECONDS']) delete process.env[k]; });

const post = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

describe('§128 log capture: no PAN / Bearer / refresh token / password / provider key reaches a log', () => {
  it('drives the flows and scans everything that was written', async () => {
    // ── login: wrong password, then the right one ──
    const bad = await post('/auth/login', { portal: 'tenant', salonCode: 'LOGSCAN1', identifier: 'owner@log-scan.test', password: WRONG });
    expect(bad.status).toBeGreaterThanOrEqual(200);
    const ok = await post('/auth/login', { portal: 'tenant', salonCode: 'LOGSCAN1', identifier: 'owner@log-scan.test', password: PASSWORD }, { origin: 'capacitor://localhost' });
    const okBody: any = await ok.json();
    if (process.env.LOG_CAPTURE_DEBUG) (await import('node:fs')).writeFileSync(process.env.LOG_CAPTURE_DEBUG, captured.join('\n'));
    expect(ok.status, JSON.stringify(okBody)).toBe(200);
    const c1 = cookiesOf(ok);
    for (const c of c1) exact.push(c.slice(c.indexOf('=') + 1));
    if (okBody.accessToken) exact.push(okBody.accessToken);
    if (okBody.refreshToken) exact.push(okBody.refreshToken);
    const refresh1 = okBody.refreshToken ?? c1.find((c) => c.includes('_refresh='))?.split('=')[1];
    expect(refresh1, 'a refresh token was issued').toBeTruthy();
    // ── refresh rotation (native: body token + Bearer access), then the OLD token again (reuse → family burned) ──
    const r2 = await post('/auth/refresh', { refreshToken: refresh1 }, { authorization: `Bearer ${okBody.accessToken}`, origin: 'capacitor://localhost' });
    const r2b: any = await r2.json().catch(() => ({}));
    if (r2b.refreshToken) exact.push(r2b.refreshToken); if (r2b.accessToken) exact.push(r2b.accessToken);
    const reuse = await post('/auth/refresh', { refreshToken: refresh1 }, { authorization: `Bearer ${okBody.accessToken}`, origin: 'capacitor://localhost' });
    expect(reuse.status).toBe(401);
    // ── a native Bearer request ──
    await fetch(base + '/auth/me', { headers: { authorization: `Bearer ${r2b.accessToken ?? okBody.accessToken}` } });
    // ── payment: the processor refuses the sale and the refund, echoing PAN / CVV / Basic credential ──
    const sale = await post('/flow/card-sale', { account: PAN, cvv: CVV });
    expect(sale.status).toBeGreaterThanOrEqual(400);
    const refund = await post('/flow/refund', { retref: '123456789012' });
    expect(refund.status).toBeGreaterThanOrEqual(400);
    // ── webhooks: unknown merchant; a body that carries a PAN + a provider key + a Bearer header ──
    const wh = await post('/webhooks/payments/cardpointe', { merchid: '000000000000', eventType: 'txn.settled', account: PAN2, apiKey: PROVIDER_KEY, note: `token ${AWS_KEY}` }, { authorization: `Bearer ${PROVIDER_KEY}`, 'x-webhook-signature': 'deadbeef' });
    expect(wh.status).toBe(400);
    // ── an unexpected exception whose message carries every shape ──
    expect((await fetch(base + '/flow/boom')).status).toBe(500);
    // ── Nest-level lines through pino, as production writes them ──
    const pinoDirect = new PinoLoggerService(new Writable({ write(chunk, _e, cb) { captured.push(String(chunk)); cb(); } }) as any);
    pinoDirect.error(`processor said: card ${PAN} Authorization: Basic ${Buffer.from(`${CP_USER}:${CP_PASS}`).toString('base64')}`, 'stack with Bearer ' + PROVIDER_KEY, 'Payments');
    pinoDirect.warn(`refresh ${refresh1} replayed`);
    await new Promise((r) => setTimeout(r, 300));

    const text = captured.join('\n');
    expect(text.length, 'the flows wrote log lines (the capture is not vacuous)').toBeGreaterThan(1500);
    expect(text).toMatch(/request\.(failed|rejected)/);
    expect(text).toMatch(/\*\*\*\*1111/);   // the PAN arrived and was masked, not dropped silently
    const found = leaksIn(text, exact.filter((v) => v && v.length >= 8));
    expect(found, found.map((f) => `${f.kind}: …${f.context}…`).join('\n')).toEqual([]);
    // the webhook ledger stores a safe payload too (no PAN at rest in payment_gateway_events)
    const rows = (await pg.query(`select payload_json_safe::text as p from payment_gateway_events`)).rows.map((r: any) => r.p).join('\n');
    expect(leaksIn(rows, [PAN2, PROVIDER_KEY, AWS_KEY])).toEqual([]);
  }, 120_000);

  it('the scanner itself finds each shape (not vacuous)', () => {
    const kinds = (s: string) => leaksIn(s, []).map((f) => f.kind);
    expect(kinds(`x ${PAN} y`)).toContain('pan');
    expect(kinds('Authorization: Bearer abcdefghijklmnop12345')).toContain('bearer');
    expect(kinds('Bearer [REDACTED]')).toEqual([]);
    expect(kinds('rt_' + 'a'.repeat(43))).toContain('refresh_token');
    expect(kinds(PROVIDER_KEY)).toContain('provider_key');
    expect(kinds('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U')).toContain('jwt');
    expect(kinds('order 1234567890123456')).toEqual([]);   // fails Luhn → not a card
    expect(leaksIn('the pw was Correct-Horse-91!', [PASSWORD]).map((f) => f.kind)).toEqual(['exact']);
  });
});
