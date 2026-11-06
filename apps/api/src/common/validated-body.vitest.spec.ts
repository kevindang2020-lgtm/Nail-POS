// BUILD_PLAN Phase 12 (#17): @Body(ValidatedBody(schema)) over real HTTP — the same global pipe + exception filter
// registration as app.module — and the check:validated-bodies gate on fixtures.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import 'reflect-metadata';
import { Body, Controller, Module, Post } from '@nestjs/common';
import { APP_FILTER, APP_PIPE, NestFactory } from '@nestjs/core';
import { PlatformExceptionFilter } from '@aipowersalon/observability/nest';
import { ValidatedBody } from '@aipowersalon/permissions/guards';
import { S } from '@aipowersalon/permissions';
import { createValidationPipe } from './validation';

const REFUND = S.object({ ticketId: S.uuid(), amountCents: S.cents({ exclusiveMinimum: 0 }), reason: S.text(200) }, ['ticketId', 'amountCents'], { 'x-forbidden': ['status'] });
@Controller('v')
class VCtl {
  @Post('refund') refund(@Body(ValidatedBody(REFUND)) b: unknown) { return { got: b }; }
}
Reflect.defineMetadata('design:paramtypes', [Object], VCtl.prototype, 'refund');
@Module({ controllers: [VCtl], providers: [{ provide: APP_PIPE, useFactory: createValidationPipe }, { provide: APP_FILTER, useClass: PlatformExceptionFilter }] })
class VModule {}

let app: any; let base = '';
const post = async (path: string, body: unknown) => {
  const r = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const T = '11111111-1111-4111-8111-111111111111';

describe('ValidatedBody over HTTP (the standard envelope)', () => {
  beforeAll(async () => { app = await NestFactory.create(VModule, { logger: false }); await app.listen(0); base = `http://127.0.0.1:${app.getHttpServer().address().port}`; });
  afterAll(async () => { await app?.close(); });

  it('a valid body reaches the handler with unknown fields stripped', async () => {
    const r = await post('/v/refund', { ticketId: T, amountCents: 500, reason: 'wrong colour', clientNonce: 'x' });
    expect(r.status).toBe(201); expect(r.body.got).toEqual({ ticketId: T, amountCents: 500, reason: 'wrong colour' });
  });
  it('a bad body → 400 VALIDATION_FAILED, field paths in error.details.fields, the value never echoed', async () => {
    const r = await post('/v/refund', { ticketId: 'nope', amountCents: '500', reason: 'card 4111111111111111 '.repeat(20) });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_FAILED');
    expect(r.body.error.details.fields.map((f: any) => f.path)).toEqual(['ticketId', 'amountCents', 'reason']);
    expect(r.body.code).toBe('VALIDATION_FAILED');   // the compatibility twin older apps read
    expect(JSON.stringify(r.body)).not.toContain('4111111111111111');
  });
  it('a dangerous field (status on a money row, tenantId anywhere undeclared) is refused, not dropped', async () => {
    expect((await post('/v/refund', { ticketId: T, amountCents: 1, status: 'REFUNDED' })).body.error.details.fields).toEqual([{ path: 'status', message: 'may not be set by the client', rule: 'NOT_ALLOWED' }]);   // `rule`: the machine-readable reason (request-schema.ts)
    expect((await post('/v/refund', { ticketId: T, amountCents: 1, tenantId: T })).status).toBe(400);
  });
});

// ── the gate ─────────────────────────────────────────────────────────────────────────────────────────────────────
const gate: any = await import('../../scripts/check-validated-bodies.mjs');
const src = (s: string) => () => s;
describe('check:validated-bodies classifier', () => {
  const R = (handler: string) => [{ method: 'POST', path: '/x', file: 'f.ts', controller: 'C', handler }];
  const file = `@Controller('x') export class C {
    @Post('a') a(@Body(ValidatedBody(A_BODY)) b: any) { return b; }
    @Post('b') async b(@Req() r: any, @Body() b: any): Promise<any> { return b; }
    @Post('c') c(@Body('name') n: string) { return n; }
    @Post('d') d(@Req() req: any) { return this.svc.x(req.body); }
    @Post('e') e(@Req() req: any) { const v = validateBody(E, req.body); return v; }
    @Post('f') f(@Param('id') id: string) { return this.svc.f(id); }
  }`;
  it('validated / unvalidated / none, per handler', () => {
    const st = (h: string) => gate.analyse(R(h), src(file))[0].status;
    expect(['a', 'b', 'c', 'd', 'e', 'f'].map(st)).toEqual(['validated', 'unvalidated', 'unvalidated', 'unvalidated', 'validated', 'none']);
  });
  it('coverage counts only routes that read a body', () => {
    expect(gate.coverage([{ status: 'validated' }, { status: 'unvalidated' }, { status: 'none' }])).toMatchObject({ mutating: 3, withBody: 2, validated: 1, pct: 50 });
  });
  it('the real tree: every unvalidated body route is in the allowlist, and no allowlist entry is stale', async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const { routes } = require('../../scripts/audit-routes.js');
    const { readFileSync } = await import('node:fs');
    const allowed = JSON.parse(readFileSync(new URL('../../scripts/validated-bodies.allowlist.json', import.meta.url), 'utf8')).routes;
    const rows = gate.analyse(routes);
    const debt = rows.filter((r: any) => r.status === 'unvalidated' || r.status === 'unknown').map((r: any) => r.key);
    expect(debt.filter((k: string) => !(k in allowed))).toEqual([]);
    expect(Object.keys(allowed).filter((k) => !debt.includes(k))).toEqual([]);
    expect(gate.coverage(rows).validated).toBeGreaterThanOrEqual(15);
  });
});
