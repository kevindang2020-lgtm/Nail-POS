// Constitution 5 §45 / G5 — the route collector (scripts/audit-routes.js) and the OpenAPI generator (scripts/openapi.mjs).
// Each fixture below is a shape that was mis-read on the real tree before Step 6 fixed it.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { routesInSource } = require('../../scripts/audit-routes.js');
const gen: any = await import('../../scripts/openapi.mjs');

const one = (src: string) => routesInSource(src, '/fixture.controller.ts');

describe('route collector — controller and decorator parsing', () => {
  it('finds a controller whose class-level decorator carries a trailing // comment (11 voice routes were invisible)', () => {
    const rs = one(`
@Controller('voice')
@UseGuards(VoiceAuthGuard, VoiceKeyRateLimitGuard)  // Constitution 12 §58: a leaked key has a budget
export class VoiceBookingController {
  @Post('tool') tool(@Body() b: any) {}
}`);
    expect(rs.map((r: any) => `${r.method} ${r.path}`)).toEqual(['POST /voice/tool']);
    expect(rs[0].classDecorators.map((d: any) => d.name)).toEqual(['UseGuards']);
  });

  it('finds a controller whose @Controller line itself ends in a // comment', () => {
    const rs = one(`
@Controller('tech')   // the technician app's own surface
export class TechController { @Get('me') me() {} }`);
    expect(rs.map((r: any) => `${r.method} ${r.path}`)).toEqual(['GET /tech/me']);
  });

  it('does not hand the second controller\'s routes to the first (the webhook was filed under /super-admin)', () => {
    const rs = one(`
@Controller('super-admin/voice-transcription')
@UseGuards(SuperAdminGuard)
export class A { @Get('calls') calls() {} }

@Controller('voice-transcription')
@UseGuards(WebhookGuard)  // provider-signed
export class B { @Post('webhook') webhook(@Req() r: any) {} }`);
    expect(rs.map((r: any) => `${r.method} ${r.path} ${r.controller}`)).toEqual([
      'GET /super-admin/voice-transcription/calls A', 'POST /voice-transcription/webhook B']);
  });

  it('reads decorators stacked above a route even when one ends in a // comment (step-up was 13 of 21)', () => {
    const [r] = one(`
@Controller('super-admin')
export class T {
  @RequireStepUp()   // Constitution 7 §8: changing merchant configuration
  @RequirePermission('platform.tenants.manage')
  @Post('tenants/:id/payment-gateway')
  setGateway(@Param('id') id: string, @Body() body: any, @Req() req: any) {}
}`);
    expect(r.decorators.map((d: any) => d.name)).toEqual(['RequireStepUp', 'RequirePermission']);
    expect(r.params).toEqual([{ in: 'Param', name: 'id' }, { in: 'Body', name: null }, { in: 'Req', name: null }]);
  });

  it('reads decorators placed after the route decorator, and a ")" inside a quoted argument does not end the list', () => {
    const [r] = one(`
@Controller('pos')
export class P {
  @Get('x') // read
  @RequirePermission('pos.reports.view')
  @Idempotent({ scope: 'a)b', required: true })
  x(@Query('from') from: string, @Query() q: any) {}
}`);
    expect(r.decorators.map((d: any) => d.name)).toEqual(['RequirePermission', 'Idempotent']);
    expect(r.decorators[1].args).toContain("'a)b'");
    expect(r.params).toEqual([{ in: 'Query', name: 'from' }, { in: 'Query', name: null }]);
  });

  it('includes @Sse streams as GET routes marked stream (the 7 realtime streams were missing)', () => {
    const [r] = one(`@Controller('owner') export class O { @Sse('stream') s() {} }`);
    expect(r).toMatchObject({ method: 'GET', path: '/owner/stream', stream: true });
  });
});

describe('OpenAPI generator — facts from the enforcing code', () => {
  it('realm comes from the permissions package (what RealmGuard runs)', () => {
    expect(gen.realmOf('/pos/customers')).toBe('staff');
    expect(gen.realmOf('/customer/me')).toBe('customer');
    expect(gen.realmOf('/super-admin/tenants')).toBe('super_admin');
    expect(gen.realmOf('/auth/login')).toBe('shared');
  });

  it('public = the session middleware exclude list, method included', () => {
    expect(gen.PUBLIC_RULES.length).toBeGreaterThan(10);
    expect(gen.isPublic('GET', '/customer/salons/nearby')).toBe(true);
    expect(gen.isPublic('GET', '/pos/customers')).toBe(false);
    // the exclude list names GET only for media — another verb is not public
    expect(gen.isPublic('GET', '/media/a/b.png')).toBe(true);
    expect(gen.isPublic('DELETE', '/media/a/b.png')).toBe(false);
  });

  it('paths: :param → {param}, trailing * → {path}', () => {
    expect(gen.openapiPath('/pos/a/:appointmentId/cancel')).toBe('/pos/a/{appointmentId}/cancel');
    expect(gen.openapiPath('/media/*')).toBe('/media/{path}');
  });

  it('a manifest line records every security fact, so changing any of them is a diff', () => {
    const [r] = one(`
@Controller('super-admin')
@UseGuards(SuperAdminGuard)
export class T {
  @RequireStepUp()
  @RequirePermission('platform.tenants.manage')
  @Idempotent({ required: true })
  @Post('tenants/:id/refund')
  refund(@Param('id') id: string) {}
}`);
    expect(gen.manifestLine(gen.factsOf(r))).toBe(
      'POST /super-admin/tenants/{id}/refund  realm=super_admin  auth=session  domain=tenants  perm=platform.tenants.manage  resource=PLATFORM/realm  step-up  idempotency=required  guards=SuperAdminGuard');
  });

  it('voice routes are api_key, infrastructure is unversioned', () => {
    const [v] = one(`@Controller('voice') @UseGuards(VoiceAuthGuard) export class V { @Post('tool') t() {} }`);
    expect(gen.factsOf(v)).toMatchObject({ auth: 'api_key', v1: true });
    const [w] = one(`@Controller('webhooks') export class W { @Post('twilio') t() {} }`);
    expect(gen.factsOf(w).v1).toBe(false);
  });

  it('two handlers claiming one METHOD + path are reported, not silently merged', () => {
    const rs = one(`@Controller('pos') export class A { @Get('x/:a') a() {} @Get('x/:b') b() {} }`);
    expect(gen.buildManifest(rs).duplicates).toEqual(['GET /pos/x/{}']);   // different param names, same route to Nest
    const same = one(`@Controller('pos') export class A { @Get('x') a() {} @Get('x') b() {} }`);
    expect(gen.buildManifest(same).duplicates).toEqual(['GET /pos/x']);
    expect(gen.buildManifest(one(`@Controller('pos') export class A { @Get('x') a() {} @Post('x') b() {} }`)).duplicates).toEqual([]);
  });

  it('the spec validator catches undeclared path params and duplicate operation ids', () => {
    const bad = { paths: {
      '/a/{id}': { get: { operationId: 'X', parameters: [] } },
      '/b': { get: { operationId: 'X' } },
    } };
    const p = gen.validateSpec(bad);
    expect(p.some((x: string) => /path template \{id\}/.test(x))).toBe(true);
    expect(p.some((x: string) => /duplicate operationId X/.test(x))).toBe(true);
  });

  it('the real tree: every route in the spec, all valid, stable operation ids, error codes from the registry', () => {
    const spec = gen.buildSpec();
    expect(gen.validateSpec(spec)).toEqual([]);
    const ops = Object.values(spec.paths).flatMap((i: any) => Object.keys(i).filter((k) => k !== 'servers'));
    expect(ops.length).toBe(gen.buildManifest().lines.length);
    expect(spec.components.schemas.ErrorEnvelope.properties.error.properties.code.enum).toContain('VERSION_CONFLICT');
  });
});
