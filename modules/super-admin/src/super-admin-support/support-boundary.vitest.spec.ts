import { describe, it, expect } from 'vitest';
import { PATH_METADATA, METHOD_METADATA, GUARDS_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { SuperAdminSupportController } from './super-admin-support.module';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { SupportActionsService } from './support-actions.service';

function routesOf(ctrl: any) {
  const proto = ctrl.prototype;
  const method = (m: number) => RequestMethod[m] ?? String(m);
  return Object.getOwnPropertyNames(proto)
    .filter((nm) => nm !== 'constructor' && typeof proto[nm] === 'function' && Reflect.getMetadata(PATH_METADATA, proto[nm]) !== undefined)
    .map((nm) => ({ name: nm, path: String(Reflect.getMetadata(PATH_METADATA, proto[nm])), method: method(Reflect.getMetadata(METHOD_METADATA, proto[nm])) }));
}

describe('Support Center — backend boundary', () => {
  const routes = routesOf(SuperAdminSupportController);
  it('is SuperAdminGuard-gated', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, SuperAdminSupportController) ?? []).toContain(SuperAdminGuard);
  });
  it('exposes overview (GET) + ticket create (POST) only', () => {
    const byPath = Object.fromEntries(routes.map((r) => [r.path, r.method]));
    expect(new Set(routes.map((r) => r.path))).toEqual(new Set(['overview', 'tickets', 'tickets/:id', 'tickets/:id/reply', 'tickets/:id/status', 'tickets/:id/internal-note']));
    expect(byPath['overview']).toBe('GET');
    expect(byPath['tickets']).toBe('POST');
  });
});

// Create-ticket validation without touching the real ticket creator (stub throws if reached improperly).
const stubTickets = { createTicket: async () => ({ ok: true, ticket: { id: 't1' } }) } as any;
const actions = () => new SupportActionsService(stubTickets, null);

describe('Support Center create-ticket validation', () => {
  it('requires a valid tenant and a subject', async () => {
    expect((await actions().createTicket({ userId: 'u' }, { subject: 'x' })).error).toBe('tenant_required');
    expect((await actions().createTicket({ userId: 'u' }, { tenantId: 'not-a-uuid', subject: 'x' })).error).toBe('tenant_required');
    expect((await actions().createTicket({ userId: 'u' }, { tenantId: '11111111-1111-1111-1111-111111111111' })).error).toBe('subject_required');
    expect((await actions().createTicket({ userId: 'u' }, { tenantId: '11111111-1111-1111-1111-111111111111', subject: 'x', branchId: 'bad' })).error).toBe('invalid_branch');
  });
  it('delegates to the ticket creator when valid', async () => {
    const r = await actions().createTicket({ userId: 'u' }, { tenantId: '11111111-1111-1111-1111-111111111111', subject: 'Payment failing' });
    expect(r.ok).toBe(true);
  });
});
