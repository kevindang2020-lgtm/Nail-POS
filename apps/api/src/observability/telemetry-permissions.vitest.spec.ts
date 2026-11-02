// telemetry-permissions.vitest.spec — BUILD_PLAN Phase 14 A (Constitution 11 §181 "not every support agent should see security
// traces, financial diagnostics, customer-specific logs"): the telemetry read is split into two keys.
//   super_admin.telemetry.view            the search, aggregate-safe projection (support, developer support, auditor)
//   super_admin.telemetry.sensitive.view  per-request rows as stored — tenant ids, routes with ids, error messages
//                                         (super admin, platform admin, security, operations — never support / auditor)
// The controller decides the projection from the CALLER's permissions (never from a query flag), and a non-sensitive caller
// may not filter by tenant (that alone would reveal which salon a request belonged to).
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { platformPermissionsFor, PERMISSIONS, platformDomainKeyFor, PLATFORM_ROLES } from '@aipowersalon/permissions';
import { TelemetrySearchController } from './telemetry-store';

const VIEW = 'super_admin.telemetry.view', SENS = 'super_admin.telemetry.sensitive.view';

describe('§181 the two keys and who holds them', () => {
  it('both keys are in the catalog', () => {
    expect(PERMISSIONS).toContain(VIEW);
    expect(PERMISSIONS).toContain(SENS);
  });
  const holds = (role: string) => { const p = platformPermissionsFor(role); return [p.includes(VIEW as any), p.includes(SENS as any)]; };
  it.each([
    ['PLATFORM_SUPER_ADMIN', true, true], ['PLATFORM_ADMIN', true, true], ['PLATFORM_SECURITY', true, true], ['PLATFORM_OPERATIONS', true, true],
    ['PLATFORM_SUPPORT', true, false], ['PLATFORM_DEVELOPER_SUPPORT', true, false], ['PLATFORM_AUDITOR', true, false],
    ['PLATFORM_FINANCE', false, false], ['PLATFORM_BILLING_ADMIN', false, false], ['PLATFORM_ONBOARDING', false, false], ['PLATFORM_AI_ADMIN', false, false],
  ])('%s → view %s, sensitive %s', (role, v, s) => { expect(holds(role)).toEqual([v, s]); });
  it('every platform role is classified above (a new role must decide)', () => { expect(PLATFORM_ROLES.length).toBe(11); });
  it('the /super-admin/observability paths are classified (system domain) — never default-denied as unclassified', () => {
    expect(platformDomainKeyFor('/super-admin/observability/requests', 'GET')).toBe('super_admin.system_operations.view');
  });
});

describe('the controller', () => {
  it('every handler requires super_admin.telemetry.view (not the broad system_operations key)', () => {
    const proto = TelemetrySearchController.prototype as any;
    for (const h of ['requests', 'request', 'correlation', 'trace', 'logs']) expect(Reflect.getMetadata('perm', proto[h]), h).toBe(VIEW);
  });

  const calls: Array<{ fn: string; opts: any; f?: any }> = [];
  const svc: any = new Proxy({}, { get: (_t, fn: string) => (a: any, b: any) => { calls.push({ fn, f: typeof a === 'object' ? a : undefined, opts: b }); return {}; } });
  const ctl = new TelemetrySearchController(svc);
  const req = (perms: string[]) => ({ ctx: { userId: 'u1', role: 'SUPER_ADMIN', permissions: perms } });

  it('the projection follows the caller: view only → redacted; with the sensitive key → full', () => {
    calls.length = 0;
    ctl.requests({}, req([VIEW])); ctl.request('req_1', req([VIEW])); ctl.trace('a'.repeat(32), req([VIEW])); ctl.correlation('c_12345678', req([VIEW])); ctl.logs({}, req([VIEW]));
    expect(calls.map((c) => c.opts.sensitive)).toEqual([false, false, false, false, false]);
    calls.length = 0;
    ctl.requests({}, req([VIEW, SENS])); ctl.request('req_1', req([VIEW, SENS])); ctl.trace('a'.repeat(32), req([VIEW, SENS])); ctl.logs({}, req([VIEW, SENS]));
    expect(calls.map((c) => c.opts.sensitive)).toEqual([true, true, true, true]);
  });
  it('a query parameter can never ask for the sensitive view', () => {
    calls.length = 0;
    ctl.requests({ sensitive: 'true', redacted: 'false' }, req([VIEW]));
    expect(calls[0].opts.sensitive).toBe(false);
  });
  it('filtering by tenant without the sensitive key is refused (403); with it, the filter passes through', () => {
    const tenantId = '0a0a0a0a-1111-4222-8333-444444444444';
    expect(() => ctl.requests({ tenantId }, req([VIEW]))).toThrow(ForbiddenException);
    expect(() => ctl.logs({ tenantId }, req([VIEW]))).toThrow(ForbiddenException);
    calls.length = 0;
    ctl.requests({ tenantId }, req([VIEW, SENS]));
    expect(calls[0].f.tenantId).toBe(tenantId);
  });
  it('a request with no session context is treated as non-sensitive (fail closed)', () => {
    calls.length = 0;
    ctl.logs({}, {} as any);
    expect(calls[0].opts.sensitive).toBe(false);
  });
});
