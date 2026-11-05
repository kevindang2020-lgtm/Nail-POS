import { describe, it, expect } from 'vitest';
import { PATH_METADATA, METHOD_METADATA, GUARDS_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { SuperAdminQueueController } from './super-admin-queue.controller';
import { SuperAdminGuard } from '@aipowersalon/permissions/guards';
import { LiveQueueService, type RawLiveQueueData, type LiveQueueFilters } from './live-queue.service';

// Enumerate the controller's declared routes from Nest metadata.
function routesOf(ctrl: any): { name: string; path: string; method: string }[] {
  const proto = ctrl.prototype;
  const methodName = (m: number) => RequestMethod[m] ?? String(m);
  return Object.getOwnPropertyNames(proto)
    .filter((n) => n !== 'constructor' && typeof proto[n] === 'function')
    .filter((n) => Reflect.getMetadata(PATH_METADATA, proto[n]) !== undefined)
    .map((n) => ({ name: n, path: String(Reflect.getMetadata(PATH_METADATA, proto[n])), method: methodName(Reflect.getMetadata(METHOD_METADATA, proto[n])) }));
}

const MUTATION_PATTERNS = [
  /reorder/i, /assign/i, /serve/i, /start[-_ ]?service/i, /complete/i, /checkout/i, /check[-_ ]?out/i,
  /capture[-_ ]?payment/i, /\bremove\b/i, /\bmove\b/i, /priority/i, /reassign/i, /\bcall\b/i, /\bskip\b/i,
];

describe('Live Queue Monitor — backend-enforced monitoring boundary', () => {
  const routes = routesOf(SuperAdminQueueController);

  it('is SuperAdminGuard-gated at the controller (platform role boundary)', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, SuperAdminQueueController) ?? [];
    expect(guards).toContain(SuperAdminGuard);
  });

  it('exposes ONLY read + oversight routes — no queue-mutation endpoints', () => {
    // The complete, intended route surface. Reads are GET; oversight write-actions create support artifacts only.
    const expected = new Set(['overview', 'live-overview', 'incidents', 'notify-branch', 'support-session', ':queueId/retry-sync', 'export', 'export-xlsx', 'export-pdf', 'snapshot']);
    const actual = new Set(routes.map((r) => r.path));
    expect(actual).toEqual(expected);
    // None of the routes may be a queue-state mutation (reorder/assign/serve/complete/checkout/remove/move/priority…).
    for (const r of routes) {
      for (const pat of MUTATION_PATTERNS) {
        expect(`${r.name} ${r.path}`).not.toMatch(pat);
      }
    }
  });

  it('keeps every write-action as POST and every data route as GET', () => {
    const byPath = Object.fromEntries(routes.map((r) => [r.path, r.method]));
    expect(byPath['overview']).toBe('GET');
    expect(byPath['live-overview']).toBe('GET');
    expect(byPath['export']).toBe('GET');
    expect(byPath['export-xlsx']).toBe('GET');
    expect(byPath['export-pdf']).toBe('GET');
    for (const p of ['incidents', 'notify-branch', 'support-session', ':queueId/retry-sync', 'snapshot']) expect(byPath[p]).toBe('POST');
  });
});

// ---- tenant/branch isolation: the service must pass scope + tenant/branch filters straight through to the repo, and
// the repo applies them in SQL (andTenant/tenant predicate). Here we assert the pass-through and clamping contract. ----
const EMPTY_DATA: RawLiveQueueData = {
  aggItems: [], pageItems: [], pageTotal: 0, branchMeta: [], techStatus: [],
  devices: { total: 0, offline: 0 }, today: { totalQueues: 0, totalCustomers: 0, completedServices: 0 }, hourly: [],
};

describe('Live Queue Monitor — tenant/branch isolation contract', () => {
  it('passes tenant/branch filters and an explicit scope to the repository', async () => {
    let seen: LiveQueueFilters | null = null;
    const svc = new LiveQueueService({ liveQueueData: async (f) => { seen = f; return EMPTY_DATA; } });
    const scope = { tenantId: '11111111-1111-1111-1111-111111111111' } as any;
    const filters = svc.parseFilters({ tenantId: '11111111-1111-1111-1111-111111111111', branchId: 'b2222222-2222-2222-2222-222222222222', page: 2, pageSize: 25 }, scope);
    await svc.getOverview({}, filters);
    expect(seen!.tenantId).toBe('11111111-1111-1111-1111-111111111111');
    expect(seen!.branchId).toBe('b2222222-2222-2222-2222-222222222222');
    expect(seen!.scope).toBe(scope);
    expect(seen!.page).toBe(2);
    expect(seen!.pageSize).toBe(25);
  });

  it('clamps pagination and never lets a client widen the page size past the cap', () => {
    const svc = new LiveQueueService({ liveQueueData: async () => EMPTY_DATA });
    const f = svc.parseFilters({ page: -5, pageSize: 99999 });
    expect(f.page).toBeGreaterThanOrEqual(1);
    expect(f.pageSize).toBeLessThanOrEqual(100);
  });
});
