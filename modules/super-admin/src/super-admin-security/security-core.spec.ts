import { pct, maskIp, assembleSecurityKpis, assembleFailedLoginTrend, assembleSuspiciousMix, riskRank, sessionStatusTone, isSecurityAuditModule } from './security-core';
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — got ${JSON.stringify(a)}`);
// pct + mask
eq(pct(423, 512), 82.6, 'pct 2fa'); eq(pct(1, 0), 0, 'pct no div0');
eq(maskIp('192.168.1.22'), '192.168.1.xxx', 'ipv4 masked'); eq(maskIp('2001:db8:85a3:0:0:0:0:1'), '2001:db8:85a3::xxxx', 'ipv6 masked'); eq(maskIp(''), '—', 'empty ip');
// KPIs: real vs honest gap + tone
{ const k = assembleSecurityKpis({ twoFaEnabled: 423, twoFaTotal: 512, failedLogins7d: 186, suspiciousSessions: 24, privilegedAccounts: 38, dataExportEvents7d: 56, privacyRequestsOpen: 14 });
  ok(k.twoFaEnabledUsers.available && k.twoFaEnabledUsers.value === 423 && /82.6% of 512/.test(k.twoFaEnabledUsers.note!), '2fa real');
  ok(k.failedLoginActivity.available && k.failedLoginActivity.deltaTone === 'bad', 'failed logins bad-tone');
  ok(k.suspiciousSessions.deltaTone === 'good', 'suspicious good-when-down');
  ok(k.privilegedAccounts.deltaTone === 'review', 'privileged review-tone (not favorable)');
  for (const g of ['securityIncidents', 'complianceStatus', 'encryptionStatus', 'backupStatus', 'sessionPolicyStatus', 'passwordPolicyStatus'] as const) { ok(k[g].available === false && !!k[g].note, `${g} honest gap`); } }
// when real sources wired, gaps resolve
{ const k = assembleSecurityKpis({ securityIncidentsOpen: 7, complianceScorePct: 92.4, encryptionCoveragePct: 100, backupSuccessRatePct: 99.2, sessionPolicyCompliant: true, passwordPolicyCompliant: true });
  ok(k.securityIncidents.available && k.securityIncidents.value === 7, 'incidents resolve when sourced');
  ok(k.complianceStatus.value === '92.4%' && k.encryptionStatus.value === '100%', 'compliance/encryption resolve');
  ok(k.sessionPolicyStatus.value === 'Compliant' && k.passwordPolicyStatus.value === 'Compliant', 'policy status resolve'); }
// trend + suspicious mix
eq(assembleFailedLoginTrend([{ day: 'May 06', count: 86 }]), [{ day: 'May 06', count: 86 }], 'trend maps');
{ const m = assembleSuspiciousMix({ normal: 183, warning: 18, highRisk: 24 }); eq(m.total, 225, 'suspicious total reconciles'); ok(m.segments.find((s) => s.label === 'Normal')!.value === 183, 'normal seg'); }
// risk + tones
ok(riskRank('critical') > riskRank('low'), 'risk order'); eq(sessionStatusTone('active'), 'good', 'active good'); eq(sessionStatusTone('revoked'), 'bad', 'revoked bad'); eq(sessionStatusTone('suspicious'), 'review', 'suspicious review');
ok(isSecurityAuditModule('auth') && isSecurityAuditModule('privacy') && !isSecurityAuditModule('billing'), 'security-audit module filter');
console.log(`security-core: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
