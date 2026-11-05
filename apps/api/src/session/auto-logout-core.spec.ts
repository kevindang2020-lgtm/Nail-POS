// auto-logout-core.spec.ts — covers the pure auto-logout helpers: HH:mm parsing/formatting, the deterministic UTC logout
// instant (business date + close + grace + tz offset), countdown remaining, active-warning selection, and the role-based
// exemption / extend rules (who a tenant's closing time logs out, and who may extend). esbuild + node, ok() style.
import { parseHHmm, to12Hour, buildLogoutAtIso, remainingSeconds, pickActiveWarning, isExemptFromAutoLogout, canExtendSession, needsSundayCloseTime } from './auto-logout.dto';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; console.error('FAIL:', n); } };

// ---- parseHHmm ----
ok('parses a valid HH:mm', JSON.stringify(parseHHmm('19:30')) === JSON.stringify({ h: 19, m: 30 }) && JSON.stringify(parseHHmm('7:05')) === JSON.stringify({ h: 7, m: 5 }));
ok('rejects out-of-range hours/minutes', parseHHmm('24:00') === null && parseHHmm('12:60') === null);
ok('rejects garbage / empty / wrong shape', parseHHmm('abc') === null && parseHHmm('') === null && parseHHmm('9:5') === null);

// ---- to12Hour ----
ok('formats 24h to 12h with AM/PM', to12Hour('19:30') === '7:30 PM' && to12Hour('13:00') === '1:00 PM');
ok('handles the noon/midnight edges', to12Hour('00:05') === '12:05 AM' && to12Hour('12:00') === '12:00 PM');
ok('empty for null / invalid', to12Hour(null) === '' && to12Hour('nope') === '');

// ---- buildLogoutAtIso (deterministic arithmetic) ----
ok('logout instant = local close + grace, shifted by the tz offset', buildLogoutAtIso('2026-06-18', '20:00', 15, -240) === '2026-06-19T00:15:00.000Z');
ok('negative grace is clamped to zero', buildLogoutAtIso('2026-06-18', '20:00', -5, -240) === '2026-06-19T00:00:00.000Z');
ok('bad date or time yields null', buildLogoutAtIso('not-a-date', '20:00', 0, 0) === null && buildLogoutAtIso('2026-06-18', '99:99', 0, 0) === null);

// ---- remainingSeconds ----
ok('remaining counts down and floors', remainingSeconds('2026-06-18T00:00:00.000Z', '2026-06-18T00:01:30.000Z') === 90);
ok('past logout clamps to 0; no logout → null', remainingSeconds('2026-06-18T00:02:00.000Z', '2026-06-18T00:00:00.000Z') === 0 && remainingSeconds('2026-06-18T00:00:00.000Z', null) === null);

// ---- pickActiveWarning (smallest crossed threshold) ----
ok('warning is the smallest threshold the countdown has reached', pickActiveWarning(25 * 60, [30, 15, 5]) === 30 && pickActiveWarning(12 * 60, [30, 15, 5]) === 15 && pickActiveWarning(4 * 60, [30, 15, 5]) === 5);
ok('no warning before any threshold, or with no countdown', pickActiveWarning(40 * 60, [30, 15, 5]) === null && pickActiveWarning(null, [30, 15, 5]) === null);

// ---- isExemptFromAutoLogout (role policy) ----
ok('SUPER_ADMIN is always exempt', isExemptFromAutoLogout('SUPER_ADMIN' as any, { exemptOwnerAdmin: false, applyToManagers: true }));
ok('OWNER/ADMIN exempt only when toggled', isExemptFromAutoLogout('OWNER' as any, { exemptOwnerAdmin: true, applyToManagers: false }) && !isExemptFromAutoLogout('OWNER' as any, { exemptOwnerAdmin: false, applyToManagers: false }));
ok('MANAGER exempt unless applyToManagers', isExemptFromAutoLogout('MANAGER' as any, { exemptOwnerAdmin: false, applyToManagers: false }) && !isExemptFromAutoLogout('MANAGER' as any, { exemptOwnerAdmin: false, applyToManagers: true }));
ok('front-of-house is never exempt', !isExemptFromAutoLogout('RECEPTION' as any, { exemptOwnerAdmin: true, applyToManagers: false }));

// ---- canExtendSession ----
ok('managers/owners/admins may always extend', canExtendSession('OWNER' as any, false) && canExtendSession('MANAGER' as any, false) && canExtendSession('SUPER_ADMIN' as any, false));
ok('reception may extend only when allowed; techs never', canExtendSession('RECEPTION' as any, true) && !canExtendSession('RECEPTION' as any, false) && !canExtendSession('TECH' as any, true));

// ---- needsSundayCloseTime ----
ok('Sunday open with no close time needs attention', needsSundayCloseTime({ sunday: { isOpen: true, closeTime: null } } as any) && !needsSundayCloseTime({ sunday: { isOpen: true, closeTime: '17:00' } } as any) && !needsSundayCloseTime({ sunday: { isOpen: false, closeTime: null } } as any));

console.log(`\nauto-logout-core: ${pass}/${pass + fail} passed` + (fail ? ` (${fail} FAILED)` : ' OK'));
if (fail) process.exit(1);
