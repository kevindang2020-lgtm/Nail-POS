// Constitution 5 G4 — the global ValidationPipe (common/validation.ts) over real HTTP through the real exception filter,
// and the check:mass-assignment classifier (scripts/check-mass-assignment.mjs) on fixtures.
//
// vitest compiles with esbuild, which does NOT emit `design:paramtypes`. Without it every body looks untyped and the
// pipe skips it — the DTO tests would pass while proving nothing. So the metadata tsc emits in the real build is
// declared explicitly below (the live check against dist/ covers the compiled form).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import 'reflect-metadata';
import { Body, Controller, Module, Post } from '@nestjs/common';
import { APP_FILTER, APP_PIPE, NestFactory } from '@nestjs/core';
import { IsInt, IsString, MaxLength } from 'class-validator';
import { PlatformExceptionFilter } from '@aipowersalon/observability/nest';
import { createValidationPipe, VALIDATION_OPTIONS } from './validation';

class CreateThingDto { @IsString() @MaxLength(40) name!: string; @IsInt() qty!: number; }
class UndecoratedDto { name!: string; }

@Controller('t')
class TCtl {
  @Post('dto') dto(@Body() b: CreateThingDto) { return { got: b }; }
  @Post('undecorated') und(@Body() b: UndecoratedDto) { return { got: b }; }
  @Post('untyped') untyped(@Body() b: any) { return { got: b }; }
}
Reflect.defineMetadata('design:paramtypes', [CreateThingDto], TCtl.prototype, 'dto');
Reflect.defineMetadata('design:paramtypes', [UndecoratedDto], TCtl.prototype, 'und');
Reflect.defineMetadata('design:paramtypes', [Object], TCtl.prototype, 'untyped');

@Module({ controllers: [TCtl], providers: [
  { provide: APP_PIPE, useFactory: createValidationPipe },   // the same registration as app.module
  { provide: APP_FILTER, useClass: PlatformExceptionFilter },
] })
class TModule {}

let app: any; let base = '';
const post = async (path: string, body: unknown) => {
  const r = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json(), raw: '' };
};

describe('global ValidationPipe (Constitution 5 G4)', () => {
  beforeAll(async () => { app = await NestFactory.create(TModule, { logger: false }); await app.listen(0); base = `http://127.0.0.1:${app.getHttpServer().address().port}`; });
  afterAll(async () => { await app?.close(); });

  it('a valid class DTO passes through unchanged', async () => {
    const r = await post('/t/dto', { name: 'Gel', qty: 2 });
    expect(r.status).toBe(201); expect(r.body.got).toEqual({ name: 'Gel', qty: 2 });
  });

  it('an extra field (mass assignment) is a 400 VALIDATION_FAILED naming the field — and never echoes the value', async () => {
    const r = await post('/t/dto', { name: 'Gel', qty: 2, role: 'OWNER', secret: 'hunter2-password' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(r.body.error.details)).toContain('property role should not exist');
    expect(JSON.stringify(r.body)).not.toContain('hunter2-password');
  });

  it('no implicit conversion: "2" is not an integer', async () => {
    const r = await post('/t/dto', { name: 'Gel', qty: '2' });
    expect(r.status).toBe(400); expect(r.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('a class with NO validation decorators is refused outright — why the runtime scan of existing bodies mattered', async () => {
    expect((await post('/t/undecorated', { name: 'x' })).status).toBe(400);
  });

  it('an untyped body (every existing route on Oct 4 2026) is untouched, extra fields and all', async () => {
    const r = await post('/t/untyped', { name: 'x', role: 'OWNER', nested: { a: 1 } });
    expect(r.status).toBe(201); expect(r.body.got).toEqual({ name: 'x', role: 'OWNER', nested: { a: 1 } });
  });

  it('the options are the September decision and cannot be mutated at runtime', () => {
    expect(VALIDATION_OPTIONS).toMatchObject({ whitelist: true, forbidNonWhitelisted: true, transform: false, forbidUnknownValues: true });
    expect(Object.isFrozen(VALIDATION_OPTIONS)).toBe(true);
    // Nest's default 400 sends constraint messages only, so value-echo is not observable over HTTP today; the option is
    // pinned here because a future custom exceptionFactory would otherwise put submitted passwords in the response.
    expect(VALIDATION_OPTIONS.validationError).toEqual({ target: false, value: false });
  });
});

const ma: any = await import('../../scripts/check-mass-assignment.mjs');
const kinds = (src: string) => ma.writesIn(src).map((w: any) => `${w.name}:${ma.classify(src, w)}`);

describe('check:mass-assignment classifier', () => {
  it('spreading the request into a write fails', () => {
    expect(kinds(`async u(id, body) { const set = { ...body, updated_at: now }; await db.updateTable('users').set(set).where('id','=',id).execute(); }`))
      .toEqual(['set:SPREAD-OF-INPUT']);
  });
  it('aliasing the request fails, and req.body in a write fails directly', () => {
    expect(kinds(`async u(req) { const patch = req.body; await db.updateTable('users').set(patch).execute(); }`)).toEqual(['patch:ALIAS']);
    expect(kinds(`async u(req) { await db.insertInto('users').values({ ...req.body }).execute(); }`)).toEqual(['req.body:REQUEST-BODY']);
  });
  it('copying every key of the input fails; copying keys from an allow-list passes', () => {
    expect(kinds(`async u(input) { const set: any = {}; for (const k of Object.keys(input)) set[k] = input[k]; await db.updateTable('t').set(set).execute(); }`))
      .toEqual(['set:DYNAMIC-KEYS']);
    expect(kinds(`async u(input) { const set: any = {}; for (const k of ALLOWED_FIELDS) if (input[k] !== undefined) set[k] = input[k]; await db.updateTable('t').set(set).execute(); }`))
      .toEqual(['set:explicit']);
  });
  it('a row built field by field passes', () => {
    expect(kinds(`async u(input) { const vals = { name: String(input.name), qty: Number(input.qty) }; await db.insertInto('t').values(vals).execute(); }`))
      .toEqual(['vals:explicit']);
  });
  it('an object received as a parameter needs review (its callers decide)', () => {
    expect(kinds(`async updatePlan(id: string, patch: Record<string, unknown>) { await db.updateTable('plans').set({ ...patch, updated_at: now }).execute(); }`))
      .toEqual(['patch:PARAM-DIRECT']);
  });
  it('a mapper call inside the argument is not itself a write site', () => {
    expect(kinds(`async ins(e) { await this.db.insertInto('ledger').values(this.values(e)).execute(); }`)).toEqual([]);
  });
  it('the real tree passes with its reviewed list, and every reviewed entry still exists', () => {
    const sites = ma.scan();
    expect(sites.filter((s: any) => !['explicit', 'PARAM-DIRECT'].includes(s.kind))).toEqual([]);
    expect(sites.length).toBeGreaterThan(50);
  });
});
