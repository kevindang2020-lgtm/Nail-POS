import { describe, it, expect } from 'vitest';
import { PATH_METADATA, METHOD_METADATA, GUARDS_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { SuperAdminAutomationController } from './super-admin-automation.controller';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { AutomationActionsService } from './automation-actions.service';

function routesOf(ctrl: any) {
  const proto = ctrl.prototype;
  const method = (m: number) => RequestMethod[m] ?? String(m);
  return Object.getOwnPropertyNames(proto)
    .filter((nm) => nm !== 'constructor' && typeof proto[nm] === 'function' && Reflect.getMetadata(PATH_METADATA, proto[nm]) !== undefined)
    .map((nm) => ({ name: nm, path: String(Reflect.getMetadata(PATH_METADATA, proto[nm])), method: method(Reflect.getMetadata(METHOD_METADATA, proto[nm])) }));
}

// The engine must never expose arbitrary code / SQL / shell / unvalidated HTTP execution.
const FORBIDDEN = [/eval/i, /\bexec\b/i, /\bsql\b/i, /shell/i, /script/i, /arbitrary/i, /raw.?http/i, /command/i];

describe('Automation Rules — backend boundary', () => {
  const routes = routesOf(SuperAdminAutomationController);
  it('is SuperAdminGuard-gated', () => {
    expect((Reflect.getMetadata(GUARDS_METADATA, SuperAdminAutomationController) ?? [])).toContain(SuperAdminGuard);
  });
  it('exposes only overview + controlled rule actions — no arbitrary-execution routes', () => {
    expect(new Set(routes.map((r) => r.path))).toEqual(new Set(['overview', 'rules', 'rules/:id/test', 'test', 'rules/:id/status', 'exceptions', 'failures/:id/retry']));
    for (const r of routes) for (const pat of FORBIDDEN) expect(`${r.name} ${r.path}`).not.toMatch(pat);
  });
  it('overview is GET; write-actions are POST', () => {
    const byPath = Object.fromEntries(routes.map((r) => [r.path, r.method]));
    expect(byPath['overview']).toBe('GET');
    for (const p of ['rules', 'rules/:id/test', 'test', 'rules/:id/status', 'exceptions', 'failures/:id/retry']) expect(byPath[p]).toBe('POST');
  });
});

// test-mode safety without a DB (no ruleId ⇒ no execution row written; pure dry-run)
const actions = () => new AutomationActionsService(null);

describe('Automation test mode is safe', () => {
  it('is always a dry run; allowlists actions and skips disallowed / sensitive-without-permission', async () => {
    const res = await actions().testRule({ userId: 'u' }, {
      triggerId: 'TENANT_PAYMENT_FAILED',
      conditions: { logic: 'and', conditions: [{ field: 'amount', operator: 'gt', value: 100 }] },
      actions: [{ type: 'send_email' }, { type: 'exec_shell' }, { type: 'activate_payment_configuration' }],
      context: { amount: 250 },
    });
    expect(res.dryRun).toBe(true);
    expect(res.triggerMatched).toBe(true);
    expect(res.conditionsPassed).toBe(true);
    expect(res.resolvedActions).toEqual(['send_email']);                 // only allowlisted, non-sensitive
    expect(res.skippedActions.some((s) => s.includes('exec_shell'))).toBe(true);            // arbitrary action refused
    expect(res.skippedActions.some((s) => s.includes('activate_payment_configuration'))).toBe(true); // sensitive needs permission
  });
  it('flags a trigger outside the catalog and fails closed on conditions', async () => {
    const res = await actions().testRule({ userId: 'u' }, { triggerId: 'DROP TABLE', actions: [{ type: 'send_email' }], conditions: { logic: 'and', conditions: [{ field: 'x', operator: 'eq', value: 1 }] }, context: { x: 2 } });
    expect(res.triggerMatched).toBe(false);
    expect(res.warnings).toContain('trigger_not_in_catalog');
    expect(res.conditionsPassed).toBe(false);
  });
  it('lets a sensitive action resolve only with the sensitive permission', async () => {
    const res = await actions().testRule({ userId: 'u', canManageSensitive: true }, { triggerId: 'MERCHANT_APPLICATION_APPROVED', actions: [{ type: 'activate_payment_configuration' }], context: {} });
    expect(res.resolvedActions).toEqual(['activate_payment_configuration']);
  });
});
