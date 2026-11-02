// services-core.spec.ts — Nest-free harness for the (async) services service + repository.
// Verifies isolation, server-side filters, CRUD + validation, archive history-safety, categories,
// sub-resources + per-action permissions, export safety, import disabled reason, audit, honest KPIs.
import { InMemoryServicesRepository, ServicesContext } from './services.repository';
import { ServicesService, ForbiddenError, ValidationError } from './services.service';
import { servicesToCsv } from './services.dto';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; console.error('FAIL:', n); } };
const throwsAsync = async (n: string, fn: () => Promise<unknown>, t?: any) => {
  try { await fn(); fail++; console.error('FAIL (no throw):', n); }
  catch (e) { if (t && !(e instanceof t)) { fail++; console.error('FAIL (wrong type):', n); } else pass++; }
};

const svc = () => new ServicesService(new InMemoryServicesRepository());
const PERMS = ['pos.services.view','pos.services.create','pos.services.edit','pos.services.archive','pos.services.import','pos.services.export','pos.services.pricing.edit','pos.services.commission.edit','pos.services.technician_mapping.edit'];
const owner = (over: Partial<ServicesContext> = {}): ServicesContext => ({ tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: PERMS, ...over });

(async () => {
  // --- access ---
  await throwsAsync('customer blocked', () => svc().getState(owner({ role: 'CUSTOMER' })), ForbiddenError);
  await throwsAsync('customer_display blocked', () => svc().getState(owner({ role: 'CUSTOMER_DISPLAY' })), ForbiddenError);
  await throwsAsync('super_admin blocked', () => svc().getState(owner({ role: 'SUPER_ADMIN' })), ForbiddenError);
  await throwsAsync('missing pos.services.view blocked', () => svc().getState(owner({ permissions: [] })), ForbiddenError);

  // --- isolation ---
  const other = await svc().getState(owner({ tenantId: 'other999' }));
  ok('tenant isolation: other tenant has no services', other.kpisFull.totalServices === 0 && other.rows.items.length === 0);

  // --- state + honest KPIs ---
  const st = await svc().getState(owner());
  ok('seed has services', st.kpisFull.totalServices >= 6);
  ok('kpis: active < total (has inactive/archived)', st.kpisFull.activeServices < st.kpisFull.totalServices);
  ok('kpis: missing price detected', st.kpisFull.servicesMissingPrice >= 1);
  ok('kpis: missing duration detected', st.kpisFull.servicesMissingDuration >= 1);
  ok('kpis: missing tech mapping detected', st.kpisFull.servicesWithoutTechMapping >= 1);
  ok('rows carry toggles', typeof st.rows.items[0].bookingEnabled === 'boolean' && typeof st.rows.items[0].isTaxable === 'boolean');
  ok('filter facets present', st.filterFacets.categories.length >= 3 && st.filterFacets.statuses.includes('archived'));

  // --- server-side filters ---
  const mani = await svc().list(owner(), { categoryId: 'cat_mani' });
  ok('filter categoryId narrows', mani.items.length > 0 && mani.items.every((i) => i.categoryId === 'cat_mani'));
  const activeOnly = await svc().list(owner(), { status: 'active' });
  ok('filter status=active', activeOnly.items.every((i) => i.status === 'active'));
  const missing = await svc().list(owner(), { missingPrice: 'true' });
  ok('filter missingPrice', missing.items.length >= 1 && missing.items.every((i) => i.priceCents === 0));
  const search = await svc().list(owner(), { search: 'pedicure' });
  ok('search matches category/name', search.items.length >= 1);
  const paged = await svc().list(owner(), { categoryId: 'cat_mani', page: 1, pageSize: 1 });
  ok('pagination: pageSize respected', paged.items.length === 1 && paged.pagination.totalItems >= 2 && paged.pagination.totalPages >= 2);

  // --- create + validation ---
  await throwsAsync('create requires name', () => svc().create(owner(), { name: '', categoryId: 'cat_mani', durationMinutes: 30, priceCents: 1000, status: 'active' }), ValidationError);
  await throwsAsync('create requires valid duration', () => svc().create(owner(), { name: 'X', categoryId: 'cat_mani', durationMinutes: 0, priceCents: 1000, status: 'active' }), ValidationError);
  await throwsAsync('create rejects foreign category', () => svc().create(owner(), { name: 'X', categoryId: 'cat_nope', durationMinutes: 30, priceCents: 1000, status: 'active' }), ValidationError);
  await throwsAsync('create needs pos.services.create', () => svc().create(owner({ permissions: ['pos.services.view'] }), { name: 'X', categoryId: 'cat_mani', durationMinutes: 30, priceCents: 1000, status: 'active' }), ForbiddenError);
  const s2 = svc();
  const created = await s2.create(owner(), { name: 'Nail Art Detail', categoryId: 'cat_mani', durationMinutes: 25, priceCents: 2200, status: 'active' });
  ok('create returns row', !!created.serviceId && created.name === 'Nail Art Detail');
  ok('create increments total', (await s2.getState(owner())).kpisFull.totalServices === st.kpisFull.totalServices + 1);
  ok('audit: pos_service_created', s2.auditLog().some((l) => l.actionType === 'pos_service_created'));

  // --- update + price permission ---
  const s3 = svc();
  const upd = await s3.update(owner(), 'svc_sig_mani', { name: 'Signature Manicure Plus' });
  ok('update edits name', upd.name === 'Signature Manicure Plus');
  await throwsAsync('price change needs pricing.edit', () => svc().update(owner({ permissions: ['pos.services.view','pos.services.edit'] }), 'svc_sig_mani', { priceCents: 5000 }), ForbiddenError);
  ok('audit: pos_service_updated has before/after', s3.auditLog().some((l) => l.actionType === 'pos_service_updated' && !!l.before && !!l.after));

  // --- archive / reactivate (history-safe) ---
  const s4 = svc();
  const arch = await s4.archive(owner(), 'svc_sig_mani');
  ok('archive returns archived=true (history kept)', arch.archived === true);
  ok('archived service still counted in total', (await s4.getState(owner())).kpisFull.totalServices === st.kpisFull.totalServices);
  const re = await s4.reactivate(owner(), 'svc_sig_mani');
  ok('reactivate sets active', re.isActive === true);
  ok('audit: archive + reactivate', s4.auditLog().some((l) => l.actionType === 'pos_service_archived') && s4.auditLog().some((l) => l.actionType === 'pos_service_reactivated'));
  const del = await svc().hardDelete(owner(), 'svc_sig_mani');
  ok('hardDelete with history → archived, not deleted', del.ok === false && del.reasonCode === 'SERVICE_HAS_HISTORY');
  // BUILD_PLAN Phase 9: a hard delete is decided by pos.services.edit (services.edit — owners and managers), not role names
  await throwsAsync('hardDelete needs owner/manager (services.edit)', () => svc().hardDelete(owner({ role: 'FRONT_DESK', permissions: PERMS.filter((p) => p !== 'pos.services.edit') }), 'svc_sig_mani'), ForbiddenError);
  await throwsAsync('Phase 9: an OWNER-role token with services.edit DENIED cannot hard-delete', () => svc().hardDelete(owner({ permissions: PERMS.filter((p) => p !== 'pos.services.edit') }), 'svc_sig_mani'), ForbiddenError);

  // --- categories ---
  const s5 = svc();
  const cat = await s5.createCategory(owner(), 'Waxing');
  ok('category create', !!cat.categoryId && cat.name === 'Waxing');
  ok('category update', (await s5.updateCategory(owner(), cat.categoryId, { name: 'Waxing & Brows' })).name === 'Waxing & Brows');
  await throwsAsync('archive category with active services needs confirm', () => s5.archiveCategory(owner(), 'cat_mani'), ValidationError);
  ok('archive category with confirm ok', (await s5.archiveCategory(owner(), 'cat_mani', true)).ok === true);
  ok('reorder returns ordered', (await s5.reorderCategories(owner(), ['cat_pedi','cat_enh'])).length >= 2);
  ok('audit: category events', s5.auditLog().some((l) => l.actionType === 'pos_service_category_created') && s5.auditLog().some((l) => l.actionType === 'pos_service_categories_reordered'));

  // --- sub-resources + perms ---
  const s6 = svc();
  ok('get add-ons', Array.isArray(await s6.getAddOns(owner(), 'svc_sig_mani')));
  ok('set add-ons', (await s6.setAddOns(owner(), 'svc_sig_mani', [{ addOnId: 'ao1', name: 'Gel Top', priceCents: 500, durationDeltaMinutes: 5, isTaxable: true, isActive: true }])).length === 1);
  await throwsAsync('mapping needs technician_mapping.edit', () => svc().setMapping(owner({ permissions: ['pos.services.view','pos.services.edit'] }), 'svc_sig_mani', []), ForbiddenError);
  ok('set mapping ok with perm', (await s6.setMapping(owner(), 'svc_sig_mani', [{ technicianId: 't_mia', displayName: 'Mia', isActive: true }])).length === 1);
  await throwsAsync('commission needs commission.edit', () => svc().setCommission(owner({ permissions: ['pos.services.view','pos.services.edit'] }), 'svc_sig_mani', { type: 'percent', value: 50 }), ForbiddenError);
  ok('set commission ok with perm', (await s6.setCommission(owner(), 'svc_sig_mani', { type: 'percent', value: 55 })).value === 55);
  ok('set tax flows to taxable', (await s6.setTax(owner(), 'svc_sig_mani', { isTaxable: false, exemptAllowed: true })).isTaxable === false);
  ok('audit: sub-resource events', ['pos_service_addons_updated','pos_service_technician_mapping_updated','pos_service_commission_updated','pos_service_tax_updated'].every((a) => s6.auditLog().some((l) => l.actionType === a)));

  // --- export / import ---
  const exp = await svc().export(owner(), {});
  ok('export csv', exp.format === 'csv' && exp.csv.includes('Name'));
  await throwsAsync('export needs export perm', () => svc().export(owner({ permissions: ['pos.services.view'] }), {}), ForbiddenError);
  const prev = await svc().importPreview(owner(), 'Name,Category,Price,Duration,Status\nImported Mani,Manicures,55.00,40,active');
  ok('import preview classifies a new service', prev.ok === true && prev.willCreate === 1 && prev.errorCount === 0);
  const s7 = svc();
  const before7 = (await s7.list(owner())).items.length;
  const cmt = await s7.importCommit(owner(), 'Name,Category,Price,Duration,Status\nImported Mani,Manicures,55.00,40,active');
  ok('import commit creates the service', cmt.created === 1 && (await s7.list(owner())).items.length === before7 + 1);
  await throwsAsync('import needs import perm', () => svc().importCommit(owner({ permissions: ['pos.services.view'] }), 'Name,Price,Duration\nX,10,10'), ForbiddenError);
  ok('csv neutralizes formula', servicesToCsv(['A'], [['=HYPERLINK(1)'], ['ok']]).includes("'=HYPERLINK"));

  // --- audit base ---
  const sA = svc(); await sA.getState(owner());
  ok('audit: pos_services_viewed + tenant scoped', sA.auditLog().some((l) => l.actionType === 'pos_services_viewed' && l.tenantId === 'luxe001'));

  console.log(`\nservices-core: ${pass}/${pass + fail} passed` + (fail ? ` (${fail} FAILED)` : ' OK'));
  if (fail) process.exit(1);
})();
