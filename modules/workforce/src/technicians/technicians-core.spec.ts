// technicians-core.spec.ts — Nest-free harness for the (async) technicians service + repository.
import { InMemoryTechniciansRepository, TechniciansContext } from './technicians.repository';
import { TechniciansService, ForbiddenError, ValidationError } from './technicians.service';
import { techniciansToCsv, sanitizeTechPermissions } from './technicians.dto';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; console.error('FAIL:', n); } };
const throwsAsync = async (n: string, fn: () => Promise<unknown>, t?: any) => {
  try { await fn(); fail++; console.error('FAIL (no throw):', n); }
  catch (e) { if (t && !(e instanceof t)) { fail++; console.error('FAIL (wrong type):', n); } else pass++; }
};

const svc = () => new TechniciansService(new InMemoryTechniciansRepository());
// technicians.view_pay: pay reads (commission, commission history, payroll summary) need it (mandate §72/§122).
const PERMS = ['pos.technicians.view','technicians.view_pay','pos.technicians.create','pos.technicians.edit','pos.technicians.status_change','pos.technicians.schedule.edit','pos.technicians.skills.edit','pos.technicians.commission.edit','pos.technicians.app_access.edit','pos.technicians.permissions.edit','pos.technicians.import','pos.technicians.export'];
const owner = (over: Partial<TechniciansContext> = {}): TechniciansContext => ({ tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: PERMS, ...over });

(async () => {
  // access
  await throwsAsync('customer blocked', () => svc().getState(owner({ role: 'CUSTOMER' })), ForbiddenError);
  await throwsAsync('customer_display blocked', () => svc().getState(owner({ role: 'CUSTOMER_DISPLAY' })), ForbiddenError);
  await throwsAsync('super_admin blocked', () => svc().getState(owner({ role: 'SUPER_ADMIN' })), ForbiddenError);
  await throwsAsync('missing view blocked', () => svc().getState(owner({ permissions: [] })), ForbiddenError);

  // isolation
  const other = await svc().getState(owner({ tenantId: 'other999' }));
  ok('tenant isolation: other tenant empty', other.kpisFull.totalTechnicians === 0 && other.rows.items.length === 0);

  // state + KPIs
  const st = await svc().getState(owner());
  ok('seed has technicians', st.kpisFull.totalTechnicians >= 5);
  ok('kpis: active < total (suspended present)', st.kpisFull.activeTechnicians < st.kpisFull.totalTechnicians);
  ok('kpis: inService counted', st.kpisFull.inService >= 1);
  ok('kpis: onBreak counted', st.kpisFull.onBreak >= 1);
  ok('rows carry separate status + workingStatus', st.rows.items.every((r) => !!r.status && !!r.workingStatus));
  ok('facets present', st.filterFacets.shiftStatuses.includes('on_shift') && st.filterFacets.skillGroups.length >= 1);

  // filters
  ok('filter status=active', (await svc().list(owner(), { status: 'active' })).items.length >= 3);
  const inSvc = await svc().getState(owner(), { workingStatus: 'in_service' });
  ok('filter workingStatus=in_service', inSvc.rows.items.every((r) => r.workingStatus === 'in_service') && inSvc.rows.items.length >= 1);
  const missingMap = await svc().getState(owner(), { missingMapping: 'true' });
  ok('filter missingMapping', missingMap.rows.items.every((r) => r.servicesCount === 0) && missingMap.rows.items.length >= 1);
  const search = await svc().list(owner(), { search: 'Mia' });
  ok('search matches name', search.items.length >= 1 && /Mia/i.test(search.items[0].fullName));
  const paged = await svc().getState(owner(), { page: 1, pageSize: 2 });
  ok('pagination respected', paged.rows.items.length === 2 && paged.rows.pagination.totalPages >= 3);

  // create + validation
  await throwsAsync('create requires first name', () => svc().create(owner(), { firstName: '', lastName: 'X' } as any), ValidationError);
  await throwsAsync('create requires last name', () => svc().create(owner(), { firstName: 'X', lastName: '' } as any), ValidationError);
  await throwsAsync('create rejects bad email', () => svc().create(owner(), { firstName: 'X', lastName: 'Y', email: 'nope' } as any), ValidationError);
  await throwsAsync('create rejects commission > 100', () => svc().create(owner(), { firstName: 'X', lastName: 'Y', defaultCommissionPercent: 150 } as any), ValidationError);
  await throwsAsync('create needs create perm', () => svc().create(owner({ permissions: ['pos.technicians.view'] }), { firstName: 'X', lastName: 'Y' } as any), ForbiddenError);
  const s2 = svc();
  const created = await s2.create(owner(), { firstName: 'Quinn', lastName: 'Diaz', skillGroups: ['gel'], defaultCommissionPercent: 45 });
  ok('create returns row', !!created.technicianId && created.displayName === 'Quinn');
  ok('create increments total', (await s2.getState(owner())).kpisFull.totalTechnicians === st.kpisFull.totalTechnicians + 1);
  ok('audit: created', s2.auditLog().some((l) => l.actionType === 'pos_technician_created'));
  await throwsAsync('duplicate email rejected', async () => { const s = svc(); await s.create(owner(), { firstName: 'A', lastName: 'B', email: 'dupe@x.com' }); await s.create(owner(), { firstName: 'C', lastName: 'D', email: 'dupe@x.com' }); }, ValidationError);

  // update
  const s3 = svc();
  ok('update edits name', (await s3.update(owner(), 't_mia', { fullName: 'Mia Updated' })).displayName === 'Mia Updated');
  ok('audit: updated before/after', s3.auditLog().some((l) => l.actionType === 'pos_technician_updated' && !!l.before && !!l.after));

  // status changes
  await throwsAsync('suspend requires reason', () => svc().suspend(owner(), 't_mia', { status: 'suspended' } as any), ValidationError);
  const s4 = svc();
  ok('suspend with reason ok', (await s4.suspend(owner(), 't_mia', { status: 'suspended', reason: 'No-call no-show' } as any)).status === 'suspended');
  await s4.archive(owner(), 't_ava');
  ok('archive keeps technician in roster (history)', (await s4.getState(owner())).kpisFull.totalTechnicians === st.kpisFull.totalTechnicians);
  ok('reactivate sets active', (await s4.reactivate(owner(), 't_ava')).status === 'active');
  await throwsAsync('status change needs status_change perm', () => svc().activate(owner({ permissions: ['pos.technicians.view'] }), 't_mia'), ForbiddenError);
  ok('audit: status events', ['pos_technician_suspended','pos_technician_archived','pos_technician_reactivated'].every((a) => s4.auditLog().some((l) => l.actionType === a)));

  // schedule / shift / skills / services
  const s5 = svc();
  ok('get schedule', !!(await s5.getSchedule(owner(), 't_mia')).weekly);
  ok('set schedule', !!(await s5.setSchedule(owner(), 't_mia', { weekly: { monday: { isWorking: true, startTime: '10:00', endTime: '17:00' } }, unavailableDates: [] })).weekly.monday);
  await throwsAsync('schedule needs schedule.edit', () => svc().setSchedule(owner({ permissions: ['pos.technicians.view'] }), 't_mia', { weekly: {}, unavailableDates: [] }), ForbiddenError);
  ok('set shift updates status', (await s5.setShift(owner(), 't_mia', { shiftStatus: 'clocked_out', onBreak: false })).shiftStatus === 'clocked_out');
  ok('set skills', (await s5.setSkills(owner(), 't_mia', { skillGroups: ['gel','nail_art'] })).skillGroups.length === 2);
  await throwsAsync('skills needs skills.edit', () => svc().setSkills(owner({ permissions: ['pos.technicians.view'] }), 't_mia', { skillGroups: [] }), ForbiddenError);
  ok('set services maps', (await s5.setServices(owner(), 't_mia', { serviceIds: ['svc_a','svc_b','svc_c'] })).serviceIds.length === 3);

  // commission / payroll
  const s6 = svc();
  await throwsAsync('commission > 100 rejected', () => s6.setCommission(owner(), 't_mia', { defaultPercent: 120, byService: [], byCategory: [], tipHandling: 'keep', payrollPeriod: 'biweekly' }), ValidationError);
  ok('set commission', (await s6.setCommission(owner(), 't_mia', { defaultPercent: 50, byService: [], byCategory: [], tipHandling: 'keep', payrollPeriod: 'biweekly' })).defaultPercent === 50);
  await throwsAsync('commission needs commission.edit', () => svc().setCommission(owner({ permissions: ['pos.technicians.view'] }), 't_mia', { defaultPercent: 50, byService: [], byCategory: [], tipHandling: 'keep', payrollPeriod: 'biweekly' }), ForbiddenError);
  ok('payroll summary loads', (await s6.payrollSummary(owner(), 't_mia')).periodLabel === 'Current period');

  // app access — payment grant gated to owner/manager
  const s7 = svc();
  ok('set app access', (await s7.setAppAccess(owner(), 't_ava', { enabled: true, pinEnabled: true, allowedBranches: ['br_cherryhill'], allowedSections: ['Home'], canAcceptTicket: true, canStartService: true, canMarkDone: true, canRequestBreak: true, canViewEarnings: true, canEditNotes: true, canProcessPayment: false })).enabled === true);
  await throwsAsync('front desk cannot grant payment via app access', () => svc().setAppAccess(owner({ role: 'FRONT_DESK' }), 't_ava', { enabled: true, pinEnabled: true, allowedBranches: [], allowedSections: [], canAcceptTicket: true, canStartService: true, canMarkDone: true, canRequestBreak: true, canViewEarnings: true, canEditNotes: true, canProcessPayment: true }), ForbiddenError);

  // permissions — sanitize + no escalation + sensitive gate
  const s8 = svc();
  ok('get permissions', (await s8.getPermissions(owner(), 't_mia')).matrix.length >= 1);
  await throwsAsync('reject non-tech permission (no super-admin escalation)', () => svc().setPermissions(owner(), 't_mia', { matrix: [{ permission: 'super_admin.all', allowed: true }] }), ValidationError);
  await throwsAsync('front desk cannot enable sensitive perm', () => svc().setPermissions(owner({ role: 'FRONT_DESK' }), 't_mia', { matrix: [{ permission: 'pos.tech.process_payment', allowed: true }] }), ForbiddenError);
  ok('owner can set tech permissions', (await s8.setPermissions(owner(), 't_mia', { matrix: [{ permission: 'pos.tech.view_schedule', allowed: true }] })).matrix.length === 1);
  ok('sanitizer drops unknown keys', sanitizeTechPermissions([{ permission: 'pos.tech.mark_done', allowed: true }, { permission: 'owner.secret', allowed: true }]).rejected.length === 1);
  ok('audit: sub-resource events', ['pos_technician_schedule_updated','pos_technician_skills_updated','pos_technician_commission_updated','pos_technician_app_access_updated','pos_technician_permissions_updated'].every((a) => { const all = [...s5.auditLog(), ...s6.auditLog(), ...s7.auditLog(), ...s8.auditLog()]; return all.some((l) => l.actionType === a); }));

  // The edit drawer's status is no longer ignored — it goes through the lifecycle path (Technician Profile merge)
  const sE = svc();
  ok('edit status inactive applies the lifecycle', (await sE.update(owner(), 't_ava', { status: 'inactive' } as any)).status === 'inactive');
  ok('edit status change is audited as a lifecycle change', sE.auditLog().some((l) => l.actionType === 'pos_technician_status_changed_via_edit'));
  await throwsAsync('edit status change still needs status_change', () => svc().update(owner({ permissions: PERMS.filter((p) => p !== 'pos.technicians.status_change') }), 't_ava', { status: 'inactive' } as any), ForbiddenError);
  ok('edit without a status change needs no status_change', !!(await svc().update(owner({ permissions: PERMS.filter((p) => p !== 'pos.technicians.status_change') }), 't_ava', { fullName: 'Ava Lee' } as any)));
  await throwsAsync('suspend is not offered through a generic edit', () => svc().update(owner(), 't_ava', { status: 'suspended' } as any), ValidationError);
  ok('a profile edit never writes commission (stripped + audited)', await (async () => { const s = svc(); const r = await s.update(owner(), 't_ava', { commissionSplitPercent: 99 } as any); return r.commissionPercent !== 99 && s.auditLog().some((l) => l.actionType === 'pos_technician_commission_edit_stripped'); })());
  await throwsAsync('commission read needs view_pay', () => svc().getCommission(owner({ permissions: PERMS.filter((p) => p !== 'technicians.view_pay') }), 't_ava'), ForbiddenError);
  await throwsAsync('payroll summary needs view_pay', () => svc().payrollSummary(owner({ permissions: PERMS.filter((p) => p !== 'technicians.view_pay') }), 't_ava'), ForbiddenError);

  // export / import
  ok('export csv', (await svc().export(owner(), {})).csv.includes('Name'));
  await throwsAsync('export needs export perm', () => svc().export(owner({ permissions: ['pos.technicians.view'] }), {}), ForbiddenError);
  // import is real since Oct 13 2026 (Technician Profile §112): an empty file is refused; a dry run previews without writing
  await throwsAsync('import refuses an empty file', () => svc().import(owner(), { csv: '' }), ValidationError);
  ok('csv formula safe', techniciansToCsv(['A'], [['=cmd'], ['ok']]).includes("'=cmd"));

  // audit base
  const sV = svc(); await sV.getState(owner());
  ok('audit: viewed tenant-scoped', sV.auditLog().some((l) => l.actionType === 'pos_technicians_viewed' && l.tenantId === 'luxe001'));

  console.log(`\ntechnicians-core: ${pass}/${pass + fail} passed` + (fail ? ` (${fail} FAILED)` : ' OK'));
  if (fail) process.exit(1);
})();
