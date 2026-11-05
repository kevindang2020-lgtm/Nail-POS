// project-status-core.spec.ts — framework-free harness (run via esbuild->node).
import { POS_SETTINGS_MODULES } from './project-status.dto';
import { ProjectStatusService, NotFoundError } from './project-status.service';

let passed = 0, failed = 0;
function ok(name: string, cond: boolean) { if (cond) passed++; else { failed++; console.error('FAIL: ' + name); } }
function threw(fn: () => void, t?: any): boolean { try { fn(); return false; } catch (e) { return t ? e instanceof t : true; } }

ok('registry has parent + 17 sections (18)', POS_SETTINGS_MODULES.length === 18);
ok('exactly one parent', POS_SETTINGS_MODULES.filter((m) => m.isParent).length === 1);

const svc = new ProjectStatusService();
const { parent, sections } = svc.getPosSettings();
ok('17 section statuses', sections.length === 17);
ok('parent build completion is 100 (all sections code-complete)', parent.completionPercent === 100);
ok('parent status Complete on build axis', parent.status === 'Complete');
ok('parent has NO build gaps, surfaces go-live items separately', parent.missingReasons.length === 0 && Array.isArray(parent.goLivePending) && parent.goLivePending!.length >= 1);

const pay = svc.getModule('aipowersalon-pos-settings-payments-checkout');
ok('payments build-complete (100)', pay.completionPercent === 100 && pay.status === 'Complete');
ok('payments surfaces go-live item (live MID), not a build gap', pay.missingReasons.length === 0 && !!pay.goLivePending && /Fiserv/i.test(pay.goLivePending[0]));

const tax = svc.getModule('aipowersalon-pos-settings-tax');
ok('a fully-built section is 100 Complete', tax.completionPercent === 100 && tax.status === 'Complete');

ok('unknown module throws NotFound', threw(() => svc.getModule('nope'), NotFoundError));

// recheck refreshes lastCheckedAt
ok('before recheck, lastCheckedAt undefined', !svc.getModule('aipowersalon-pos-settings-tax').lastCheckedAt);
const re = svc.recheck('aipowersalon-pos-settings-tax');
ok('after recheck, lastCheckedAt set', !!re.lastCheckedAt);

ok('getAll returns parent + 17 = 18', svc.getAll().length === 18);

// spec §14: per-section sectionKey + same-page deepLink + route /pos/settings
const paySec = svc.getModule('aipowersalon-pos-settings-payments-checkout');
ok('section has sectionKey', paySec.sectionKey === 'payments-checkout');
ok('section deepLink is same-page query', paySec.deepLink === '/pos/settings?section=payments-checkout');
ok('section route is /pos/settings', paySec.route === '/pos/settings');
ok('parent has no sectionKey', !svc.getPosSettings().parent.sectionKey);

console.log(`\nproject-status-core: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
