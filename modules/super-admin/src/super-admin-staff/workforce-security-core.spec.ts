import { assembleSecurityAlerts, validateSecurityReview, DEFAULT_THRESHOLDS, SECURITY_REVIEW_AUDIT_TYPE, type SecuritySignal } from './workforce-security-core';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — got ${JSON.stringify(a)}`);
const sig = (type: any, userId: string, count: number, name = 'W', tenant: string | null = 'T', status = 'active'): SecuritySignal => ({ type, userId, name, tenant, status, count });

// below-threshold signals are dropped
{ const a = assembleSecurityAlerts([sig('role_churn', 'u1', 2)]); eq(a.length, 0, 'role churn below threshold dropped (2<3)'); }
{ const a = assembleSecurityAlerts([sig('permission_denials', 'u1', 4)]); eq(a.length, 0, 'denials below threshold dropped (4<5)'); }
{ const a = assembleSecurityAlerts([sig('excessive_sessions', 'u1', 9)]); eq(a.length, 0, 'sessions below threshold dropped (9<10)'); }

// at/above threshold produce alerts with stable keys
{ const a = assembleSecurityAlerts([sig('role_churn', 'u1', 3)]); ok(a.length === 1, 'role churn at threshold alerts'); if (a[0]) { eq(a[0].key, 'role_churn:u1', 'stable key'); eq(a[0].severity, 'warning', 'churn warning'); } }

// terminated_access is always critical, threshold 1
{ const a = assembleSecurityAlerts([sig('terminated_access', 'u9', 1, 'Gone', 'T', 'inactive')]); ok(a.length === 1 && a[0].severity === 'critical', 'terminated access critical at 1'); }

// mfa severity escalates at 5; permission denials at 10
{ const a = assembleSecurityAlerts([sig('mfa_anomalies', 'u1', 3)]); eq(a[0].severity, 'warning', 'mfa 3 → warning'); }
{ const a = assembleSecurityAlerts([sig('mfa_anomalies', 'u1', 5)]); eq(a[0].severity, 'critical', 'mfa 5 → critical'); }
{ const a = assembleSecurityAlerts([sig('permission_denials', 'u1', 10)]); eq(a[0].severity, 'critical', 'denials 10 → critical'); }

// ordering: critical before warning; within same severity, higher count first
{ const a = assembleSecurityAlerts([sig('role_churn', 'u1', 3), sig('terminated_access', 'u2', 1), sig('mfa_anomalies', 'u3', 8)]);
  eq(a.map((x) => x.type), ['mfa_anomalies', 'terminated_access', 'role_churn'], 'critical (higher count first) before warning'); }

// custom thresholds honored
{ const a = assembleSecurityAlerts([sig('role_churn', 'u1', 2)], { ...DEFAULT_THRESHOLDS, role_churn: 2 }); eq(a.length, 1, 'custom threshold lets 2 through'); }

// review validation
ok(!validateSecurityReview({ resolution: 'reviewed', reason: 'a valid reason here' }).ok, 'missing alertKey rejected');
ok(!validateSecurityReview({ alertKey: 'k', resolution: 'nope', reason: 'a valid reason here' }).ok, 'bad resolution rejected');
ok(!validateSecurityReview({ alertKey: 'k', resolution: 'dismissed', reason: 'short' }).ok, 'short reason rejected');
{ const v = validateSecurityReview({ alertKey: 'role_churn:u1', resolution: 'escalated', reason: '  investigating with security  ' }); ok(v.ok, 'valid review'); if (v.ok) { eq(v.reason, 'investigating with security', 'reason trimmed'); eq(v.resolution, 'escalated', 'resolution'); } }

ok(SECURITY_REVIEW_AUDIT_TYPE === 'workforce_security_reviewed', 'audit type stable');

console.log(`workforce-security-core: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
