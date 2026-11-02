// Customer Data Oversight — pure overview aggregate. Turns a tenant-scoped projection of real customer records
// (plus a few real counts from existing infra) into the exact KPI/chart/table shapes the page renders. Everything
// derives from the governance engine so the modules reconcile. Anything the schema can't back is marked
// available:false (NotConnected) and never given a fabricated number.

import {
  classifyPhone, classifyEmail, consentFor, recordCompleteness,
  duplicateRiskByCustomer, detectCrossTenantAlerts, dataIntegrityScore,
  type CustomerLike, type DuplicateRisk,
} from './customer-data-governance-core';

export interface Kpi { key: string; label: string; value: string | null; trend?: string; trendUp?: boolean | null; supporting?: string; available: boolean; to?: string }
export interface DirectoryRow {
  id: string; name: string; avatarUrl?: string | null; tenantId: string; tenantName: string | null; branchId: string | null; branchName: string | null;
  phoneStatus: string; emailStatus: string; completeness: number; duplicateRisk: DuplicateRisk; consentStatus: string;
  privacyRequest: string; importSource: string; lastUpdated: string;
}

/** Real counts coming from existing infrastructure; pass null when the source isn't connected. */
export interface OverviewInputs {
  records: (CustomerLike & { tenantName?: string | null; branchName?: string | null; importSource?: string | null; privacyRequestLabel?: string | null })[];
  now: Date;
  privacy?: { total: number; pending: number; byStatus: { key: string; label: string; count: number }[] } | null;
  exportRequests?: { total: number; pending: number } | null;
  deletionRequests?: { total: number; pending: number } | null;
  // No backing table yet → pass null; rendered NotConnected.
  failedImports?: number | null;
  importSuccessRate?: number | null; // % of import rows that imported cleanly, when the import subsystem is connected
  legalHold?: { total: number; tenantCount: number } | null;
  recentMerges?: { id: string; sourceCustomerId: string; targetCustomerId: string; mergedByUserId: string | null; mergedAt: string }[] | null;
  recentActivity?: { action: string; entityType: string | null; entityId: string | null; actorUserId: string | null; at: string }[] | null;
}

const INCOMPLETE_BELOW = 100; // a record is "incomplete" if it is missing/invalid on any required field

export function buildCustomerDataOverview(input: OverviewInputs) {
  const { records } = input;
  const total = records.length;
  const tenants = new Set(records.map((r) => r.tenantId));

  // per-record derivations (single pass reused everywhere → reconciliation by construction)
  const dupRisk = duplicateRiskByCustomer(records);
  let invalidPhone = 0, missingPhone = 0, invalidEmail = 0, missingEmail = 0, incomplete = 0, consented = 0, completenessSum = 0;
  const consentDist = { consented: 0, not_consented: 0, unknown: 0 };
  const dupDist = { high: 0, medium: 0, low: 0 };
  const byTenant = new Map<string, { name: string | null; count: number }>();
  const growth = new Map<string, number>(); // yyyy-mm-dd → new records

  for (const r of records) {
    const ph = classifyPhone(r.normalizedPhone); if (ph === 'invalid') invalidPhone++; else if (ph === 'missing') missingPhone++;
    const em = classifyEmail(r.email); if (em === 'invalid') invalidEmail++; else if (em === 'missing') missingEmail++;
    const comp = recordCompleteness(r); completenessSum += comp.score; if (comp.score < INCOMPLETE_BELOW) incomplete++;
    const con = consentFor(r); consentDist[con.status]++; if (con.status === 'consented') consented++;
    const risk = dupRisk.get(r.id) ?? 'none'; if (risk !== 'none') dupDist[risk as 'high' | 'medium' | 'low']++;
    const bt = byTenant.get(r.tenantId) ?? { name: r.tenantName ?? null, count: 0 }; bt.count++; byTenant.set(r.tenantId, bt);
    const day = (r.createdAt || '').slice(0, 10); if (day) growth.set(day, (growth.get(day) ?? 0) + 1);
  }

  const duplicateRecords = dupDist.high + dupDist.medium + dupDist.low;
  const crossAlerts = detectCrossTenantAlerts(records);
  const avgCompleteness = total ? Math.round((completenessSum / total) * 10) / 10 : 0;
  const consentRate = total ? Math.round((consented / total) * 1000) / 10 : 0;
  const integrity = dataIntegrityScore({ total, invalidPhone, invalidEmail, incomplete, duplicateRecords, crossTenantIncidents: crossAlerts.length });

  const kpi = (key: string, label: string, value: string | null, opts: Partial<Kpi> = {}): Kpi => ({ key, label, value, available: value !== null, ...opts });
  const pct = (n: number) => `${n}%`;

  const kpis: Kpi[] = [
    kpi('total_customers', 'Total Customers', total.toLocaleString(), { to: '/customer-data-oversight' }),
    kpi('customers_by_tenant', 'Customers by Tenant', tenants.size.toLocaleString(), { supporting: 'Active Tenants' }),
    kpi('duplicate_records', 'Duplicate Records', duplicateRecords.toLocaleString(), { to: '/customer-data-oversight/duplicates' }),
    kpi('incomplete_records', 'Incomplete Records', incomplete.toLocaleString()),
    kpi('invalid_phone', 'Invalid Phone Numbers', invalidPhone.toLocaleString()),
    kpi('invalid_email', 'Invalid Email Addresses', invalidEmail.toLocaleString()),
    kpi('failed_imports', 'Failed Imports', input.failedImports == null ? null : input.failedImports.toLocaleString(), { to: '/customer-data-oversight/imports' }),
    kpi('privacy_requests', 'Privacy Requests', input.privacy ? input.privacy.total.toLocaleString() : null, { supporting: input.privacy ? `Pending ${input.privacy.pending}` : undefined, to: '/customer-data-oversight/privacy' }),
    kpi('export_requests', 'Data Export Requests', input.exportRequests ? input.exportRequests.total.toLocaleString() : null, { supporting: input.exportRequests ? `Pending ${input.exportRequests.pending}` : undefined }),
    kpi('deletion_requests', 'Data Deletion Requests', input.deletionRequests ? input.deletionRequests.total.toLocaleString() : null, { supporting: input.deletionRequests ? `Pending ${input.deletionRequests.pending}` : undefined }),
    kpi('consent_status', 'Customer Consent Status', pct(consentRate), { supporting: 'Consented' }),
    kpi('cross_tenant', 'Suspicious Cross-Tenant', crossAlerts.length.toLocaleString(), { supporting: 'Integrity alerts' }),
    kpi('legal_hold', 'Under Legal Hold', input.legalHold ? input.legalHold.total.toLocaleString() : null, { supporting: input.legalHold ? `Across ${input.legalHold.tenantCount} Tenants` : undefined }),
    kpi('avg_completeness', 'Avg. Record Completeness', pct(avgCompleteness)),
    kpi('integrity_score', 'Data Integrity Score', `${integrity} / 100`),
  ];

  const directory: DirectoryRow[] = records.map((r) => ({
    id: r.id, name: r.fullName ?? '—', avatarUrl: r.avatarUrl ?? null, tenantId: r.tenantId, tenantName: r.tenantName ?? null, branchId: r.branchId, branchName: r.branchName ?? null,
    phoneStatus: classifyPhone(r.normalizedPhone), emailStatus: classifyEmail(r.email), completeness: recordCompleteness(r).score,
    duplicateRisk: dupRisk.get(r.id) ?? 'none', consentStatus: consentFor(r).status, privacyRequest: r.privacyRequestLabel ?? 'None',
    importSource: r.importSource ?? 'Unknown', lastUpdated: r.updatedAt,
  }));

  const healthAlerts = [
    { key: 'duplicate_records', label: 'Duplicate records', count: duplicateRecords, available: true, to: '/customer-data-oversight/duplicates' },
    { key: 'failed_imports', label: 'Failed imports', count: input.failedImports ?? null, available: input.failedImports != null, to: '/customer-data-oversight/imports' },
    { key: 'invalid_phone', label: 'Invalid phone numbers', count: invalidPhone, available: true },
    { key: 'invalid_email', label: 'Invalid email addresses', count: invalidEmail, available: true },
    { key: 'privacy_pending', label: 'Privacy requests pending', count: input.privacy?.pending ?? null, available: !!input.privacy, to: '/customer-data-oversight/privacy' },
    { key: 'export_requests', label: 'Data export requests', count: input.exportRequests?.total ?? null, available: !!input.exportRequests },
    { key: 'deletion_requests', label: 'Data deletion requests', count: input.deletionRequests?.total ?? null, available: !!input.deletionRequests },
    { key: 'cross_tenant', label: 'Suspicious cross-tenant records', count: crossAlerts.length, available: true },
    { key: 'legal_hold', label: 'Legal hold records', count: input.legalHold?.total ?? null, available: !!input.legalHold },
  ];

  const customersByTenant = [...byTenant.entries()].map(([id, v]) => ({ tenantId: id, label: v.name ?? id, count: v.count }))
    .sort((a, b) => b.count - a.count).slice(0, 8);
  const growthTrend = [...growth.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, n]) => ({ date, newRecords: n }));

  const integrityIssues = {
    total: incomplete + invalidPhone + invalidEmail, // OCCURRENCES, not unique customers (documented; one record may have several)
    categories: [
      { key: 'incomplete', label: 'Incomplete Records', count: incomplete },
      { key: 'invalid_phone', label: 'Invalid Phone Numbers', count: invalidPhone },
      { key: 'invalid_email', label: 'Invalid Email Addresses', count: invalidEmail },
    ],
    note: 'One record may have multiple issues — total is issue occurrences, not unique customers.',
  };

  return {
    kpis,
    directory,
    directoryTotal: total,
    healthAlerts,
    customersByTenant,
    customersByTenantTotal: total,
    duplicateDistribution: { total: duplicateRecords, segments: [
      { key: 'high', label: 'High Risk', count: dupDist.high },
      { key: 'medium', label: 'Medium Risk', count: dupDist.medium },
      { key: 'low', label: 'Low Risk', count: dupDist.low },
    ] },
    consentOverview: { ratePct: consentRate, segments: [
      { key: 'consented', label: 'Consented', count: consentDist.consented },
      { key: 'not_consented', label: 'Not Consented', count: consentDist.not_consented },
      { key: 'unknown', label: 'Unknown', count: consentDist.unknown },
    ] },
    growthTrend,
    growthDefinition: 'New customer records created per day in the selected scope/period.',
    integrityIssues,
    integrityScore: integrity,
    suspiciousCrossTenant: { count: crossAlerts.length, alerts: crossAlerts },
    // Not yet backed by schema → honest NotConnected:
    importSuccess: { available: input.failedImports != null, successRatePct: input.importSuccessRate ?? null },
    privacyRequestStatus: input.privacy ? { available: true, total: input.privacy.total, segments: input.privacy.byStatus } : { available: false, total: 0, segments: [] },
    recentMerges: { available: input.recentMerges != null, rows: input.recentMerges ?? [] as unknown[] },
    recentActivity: { available: input.recentActivity != null, rows: input.recentActivity ?? [] as unknown[] },
  };
}
