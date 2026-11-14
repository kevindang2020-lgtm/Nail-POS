// walkin-selection.vitest.spec.ts — the pure 4A rules (no database): what a customer may see, how a pick is re-priced,
// and the idempotency fingerprint. The real-schema proof is walkin-selection.pgtest.vitest.spec.ts.
import { describe, it, expect } from 'vitest';
import { EMPTY_BRANCH_OVERRIDE, cleanBranchPatch, cleanLines, cleanNotes, priceWalkInSelection, publicWalkInCatalog, walkInPayloadHash, walkInRevision, walkInRules, withBranchWalkIn, type WalkInCatalogRow } from './walkin-selection';
import { DEFAULT_SETTINGS } from './go-check-in.dto';

const row = (o: Partial<WalkInCatalogRow>): WalkInCatalogRow => ({
  serviceId: 's', serviceName: 'Svc', description: null, priceCents: 1000, durationMinutes: 30, serviceStatus: 'active', archived: false, customerVisible: true, serviceSort: 0,
  categoryId: 'c', categoryName: 'Manicure', categoryDescription: null, categoryIconKey: null, categoryStatus: 'active', categorySort: 0, ...o,
});
const settings = { ...DEFAULT_SETTINGS, enabled: true };
const rows = [
  row({ serviceId: 'gel', serviceName: 'Gel', priceCents: 4500, durationMinutes: 45, categoryId: 'm', categoryName: 'Manicure', categorySort: 1 }),
  row({ serviceId: 'spa', serviceName: 'Spa Pedi', priceCents: 6000, durationMinutes: 50, categoryId: 'p', categoryName: 'Pedicure', categorySort: 2 }),
  row({ serviceId: 'tip', serviceName: 'French', priceCents: 800, durationMinutes: 10, categoryId: 'a', categoryName: 'Add-ons', categorySort: 3 }),
  row({ serviceId: 'hid', serviceName: 'Art', customerVisible: false, categoryId: 'n', categoryName: 'Nail Art', categorySort: 4 }),   // online-booking flag off — still shown (full services)
  row({ serviceId: 'off', serviceName: 'Retired', serviceStatus: 'inactive', categoryId: 'w', categoryName: 'Waxing', categorySort: 5 }),
];

describe('publicWalkInCatalog', () => {
  it('tiles = categories with a visible main service, in order; add-ons ride with every service; no empty tile', () => {
    const c = publicWalkInCatalog(rows, settings);
    expect(c.categories.map((x) => x.name)).toEqual(['Manicure', 'Pedicure', 'Nail Art']);
    expect(c.services.map((x) => [x.id, x.addOnIds])).toEqual([['gel', ['tip']], ['spa', ['tip']], ['hid', ['tip']]]);
    expect(walkInRules(settings)).toMatchObject({ requireServices: true, allowTechnicianPreference: true });
  });
  it('the revision moves with any customer-facing fact and with the switches — not with an inactive row', () => {
    const r = walkInRevision(rows, walkInRules(settings));
    expect(walkInRevision(rows.map((x) => (x.serviceId === 'gel' ? { ...x, priceCents: 4600 } : x)), walkInRules(settings))).not.toBe(r);
    expect(walkInRevision(rows.map((x) => (x.serviceId === 'gel' ? { ...x, serviceName: 'Gel Polish' } : x)), walkInRules(settings))).not.toBe(r);
    expect(walkInRevision(rows, walkInRules({ ...settings, walkinShowPrices: false }))).not.toBe(r);
    expect(walkInRevision(rows.map((x) => (x.serviceId === 'off' ? { ...x, priceCents: 1 } : x)), walkInRules(settings))).toBe(r);
  });
});

describe('priceWalkInSelection', () => {
  const cat = publicWalkInCatalog(rows, settings);
  it('ok lines total with their add-ons; a stale shown price is "changed"; an unknown id or a disallowed add-on is "unavailable"', () => {
    const p = priceWalkInSelection(cat, [{ serviceId: 'gel', addOnIds: ['tip'], shownPriceCents: 4500, shownName: 'Gel' }, { serviceId: 'spa', shownPriceCents: 5000 }], cat.revision);
    expect(p).toMatchObject({ estimatedTotalCents: 4500 + 800 + 6000, estimatedMinutes: 105, confirmable: false, warnings: ['SERVICE_CHANGED'] });
    expect(p.lines.map((l) => l.state)).toEqual(['ok', 'changed']);
    const u = priceWalkInSelection(cat, [{ serviceId: 'off' }, { serviceId: 'gel', addOnIds: ['spa'] }], cat.revision);
    expect(u.lines[0].state).toBe('unavailable');
    expect(u.lines[1].addOns[0].state).toBe('unavailable');
    expect(u.confirmable).toBe(false);
  });
  it('a stale revision is never confirmable; nothing picked is confirmable only when services are not required', () => {
    expect(priceWalkInSelection(cat, [{ serviceId: 'gel', shownPriceCents: 4500, shownName: 'Gel' }], 'old').confirmable).toBe(false);
    expect(priceWalkInSelection(cat, [], cat.revision)).toMatchObject({ confirmable: false, warnings: ['SERVICES_REQUIRED'], estimatedTotalCents: 0 });
    const optional = publicWalkInCatalog(rows, { ...settings, walkinRequireServices: false });
    expect(priceWalkInSelection(optional, [], optional.revision).confirmable).toBe(true);
  });
  it('prices hidden → no total shown (null), never a made-up zero', () => {
    const hidden = publicWalkInCatalog(rows, { ...settings, walkinShowPrices: false });
    expect(priceWalkInSelection(hidden, [{ serviceId: 'gel', shownPriceCents: null, shownName: 'Gel' }], hidden.revision)).toMatchObject({ estimatedTotalCents: null, confirmable: true });
  });
});

describe('request hygiene', () => {
  it('cleanLines: de-duplicated by service, bounded, ids only', () => {
    expect(cleanLines([{ serviceId: 'a', addOnIds: ['x', 'x', 7] }, { serviceId: 'a' }, { serviceId: '' }, 'junk', { serviceId: 'b', shownPriceCents: '1200' }]))
      .toEqual([{ serviceId: 'a', addOnIds: ['x'] }, { serviceId: 'b', addOnIds: [], shownPriceCents: 1200 }]);
    expect(cleanLines(Array.from({ length: 40 }, (_, i) => ({ serviceId: 's' + i })))).toHaveLength(12);
  });
  it('the fingerprint ignores line / add-on order but not content', () => {
    const base = { customerName: 'Mai', phone: '(856) 555-0101', lines: [{ serviceId: 'a', addOnIds: ['x', 'y'] }, { serviceId: 'b' }], skipServices: false, approvedRevision: 'r1' };
    const h = walkInPayloadHash(base);
    expect(walkInPayloadHash({ ...base, phone: '8565550101', lines: [{ serviceId: 'b' }, { serviceId: 'a', addOnIds: ['y', 'x'] }] })).toBe(h);
    expect(walkInPayloadHash({ ...base, lines: [{ serviceId: 'a' }] })).not.toBe(h);
    expect(walkInPayloadHash({ ...base, approvedRevision: 'r2' })).not.toBe(h);
  });
  it('notes: trimmed, single-spaced, at most 200 characters, no control characters', () => {
    expect(cleanNotes('  short\n\tnails  ')).toBe('short nails');
    expect(cleanNotes('x'.repeat(500))).toHaveLength(200);
  });
});

describe('per-location walk-in switches (migration 993)', () => {
  it('a location\'s set switch wins, null follows the salon, other switches are never touched', () => {
    const merged = withBranchWalkIn({ ...settings, walkinShowPrices: true, enabled: true }, { ...EMPTY_BRANCH_OVERRIDE, walkinShowPrices: false });
    expect(merged.walkinShowPrices).toBe(false);
    expect(merged.walkinShowDurations).toBe(settings.walkinShowDurations);
    expect(merged.enabled).toBe(true);
    expect(withBranchWalkIn(settings, null)).toBe(settings);
  });
  it('a PUT body keeps only the six keys with a boolean or null', () => {
    expect(cleanBranchPatch({ walkinShowPrices: false, walkinAllowAddOns: null, enabled: false, walkinShowDurations: 'no' })).toEqual({ walkinShowPrices: false, walkinAllowAddOns: null });
    expect(cleanBranchPatch(null)).toEqual({});
  });
});
