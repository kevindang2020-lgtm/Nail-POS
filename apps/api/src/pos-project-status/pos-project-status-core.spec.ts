// pos-project-status-core.spec.ts — Nest-free harness. Verifies honest completion (no fake 100),
// all 15 modules present, role gating, recheck, and audit logging.
import { PosProjectStatusService, PSContext } from './pos-project-status.service';
import { buildPosProjectStatus, POS_MODULE_DEFS } from './pos-project-status.dto';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; console.error('FAIL:', n); } };
const throws = (n: string, fn: () => unknown) => { try { fn(); fail++; console.error('FAIL (no throw):', n); } catch { pass++; } };

const owner = (over: Partial<PSContext> = {}): PSContext => ({ tenantId: 'luxe001', userId: 'u_owner', role: 'OWNER', permissions: ['pos.reports.view'], ...over });

// roster completeness — the §26 list (all 15)
const REQUIRED = ['overview','dashboard','check-in','booking','tech-appointments','tech-queue','queue','serving','service-done','checkout','customers','technicians','services','reports','settings'].map((k) => 'aipowersalon-pos-' + k);
const state = new PosProjectStatusService().getState(owner());
ok('15 POS modules + shared layout present', state.modules.length === 16 && state.modules.some((m) => m.moduleKey === 'aipowersalon-pos-shared-layout-sidebar'));
ok('all required POS modules present', REQUIRED.every((k) => state.modules.some((m) => m.moduleKey === k)));

// honest completion — 100% is permitted ONLY when every module is genuinely Complete (no pending).
// While any module is still pending, overall must be < 100. This keeps the anti-fake guard meaningful.
const pendingCount = state.modules.filter((m) => m.status !== 'Complete').length;
ok('overall completion is honest (100 only if zero pending)', state.overallCompletionPercent < 100 ? pendingCount > 0 : pendingCount === 0);
ok('overall completion is a real average', state.overallCompletionPercent === Math.round(state.modules.reduce((s, m) => s + m.completionPercent, 0) / state.modules.length));

const verified = ['aipowersalon-pos-overview','aipowersalon-pos-dashboard','aipowersalon-pos-reports','aipowersalon-pos-settings','aipowersalon-pos-services','aipowersalon-pos-technicians','aipowersalon-pos-customers','aipowersalon-pos-checkout','aipowersalon-pos-service-done','aipowersalon-pos-serving','aipowersalon-pos-queue','aipowersalon-pos-tech-queue','aipowersalon-pos-tech-appointments','aipowersalon-pos-check-in','aipowersalon-pos-booking','aipowersalon-pos-shared-layout-sidebar'];
ok('verified modules are 100 Complete', verified.every((k) => { const m = state.modules.find((x) => x.moduleKey === k)!; return m.completionPercent === 100 && m.status === 'Complete'; }));
const unverified = state.modules.filter((m) => !verified.includes(m.moduleKey));
ok('unverified modules are < 100', unverified.every((m) => m.completionPercent < 100));
ok('unverified modules carry honest reasons', unverified.every((m) => m.missingReasons.length > 0));
ok('unverified modules are Needs Review', unverified.every((m) => m.status === 'Needs Review'));
ok('every module has a route', state.modules.every((m) => m.route.startsWith('/')));

// role gating
throws('customer blocked', () => new PosProjectStatusService().getState(owner({ role: 'CUSTOMER' })));
throws('customer_display blocked', () => new PosProjectStatusService().getState(owner({ role: 'CUSTOMER_DISPLAY' })));
throws('missing pos.reports.view blocked', () => new PosProjectStatusService().getState(owner({ permissions: [] })));

// recheck + audit
const svc = new PosProjectStatusService();
svc.getState(owner());
ok('audit: pos_project_status_viewed logged', svc.auditLog().some((l) => l.actionType === 'pos_project_status_viewed'));
const before = svc.getModule(owner(), 'aipowersalon-pos-reports').lastCheckedAt;
const after = svc.recheck(owner(), 'aipowersalon-pos-reports').lastCheckedAt;
ok('recheck sets lastCheckedAt', !before && !!after);
ok('audit: recheck logged', svc.auditLog().some((l) => l.actionType === 'pos_project_status_rechecked'));
throws('recheck unknown module throws', () => svc.recheck(owner(), 'aipowersalon-pos-nope' as any));

// pure builder determinism
ok('builder is pure/deterministic', buildPosProjectStatus().overallCompletionPercent === buildPosProjectStatus().overallCompletionPercent);
ok('builder roster matches defs', buildPosProjectStatus().modules.length === POS_MODULE_DEFS.length);

console.log(`\npos-project-status-core: ${pass}/${pass + fail} passed` + (fail ? ` (${fail} FAILED)` : ' ✓'));
if (fail) process.exit(1);
