import { useEffect, useState } from 'react';
import { superAdminCompensationApi, type TenantCompensationSummary } from '../api/superAdminCompensationApi';
import { superAdminApi } from '../api/superAdminApi';

export function SuperAdminCompensationScreen() {
  const [rows, setRows] = useState<TenantCompensationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Commission Oversight Security state
  const [oversight, setOversight] = useState<{ activeCodes: any[]; history: any[] }>({ activeCodes: [], history: [] });
  const [genTenantId, setGenTenantId] = useState<string>('');
  const [lastGenCode, setLastGenCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [allTenants, setAllTenants] = useState<Array<{ id: string; n: string }>>([]);

  // Pagination states
  const [auditPage, setAuditPage] = useState<number>(1);
  const [auditPageSize, setAuditPageSize] = useState<number>(5);

  const [summaryPage, setSummaryPage] = useState<number>(1);
  const [summaryPageSize, setSummaryPageSize] = useState<number>(5);

  const loadData = () => {
    superAdminCompensationApi.overview().then(setRows).catch((e) => { setRows([]); setError(e?.message || 'Failed to load compensation overview'); });
    superAdminApi.state({ page: 1, pageSize: 200 } as any).then((r: any) => {
      if (r?.tenants) setAllTenants(r.tenants.map((t: any) => ({ id: t.id, n: t.n || t.displayName || t.id })));
    }).catch(() => {});
    superAdminApi.getCommissionOversight().then((r: any) => {
      if (r?.ok) {
        setOversight({ activeCodes: r.activeCodes || [], history: r.history || [] });
      }
    }).catch(() => {});
  };

  useEffect(() => { loadData(); }, []);

  const handleGenerateCode = async () => {
    setBusy(true); setNote(null);
    try {
      const payload = genTenantId ? { tenantId: genTenantId } : {};
      const res = await superAdminApi.generateCommissionAuthCode(payload);
      if (res?.code) {
        setLastGenCode(res.code);
        setNote(`Generated Authorization Code: ${res.code}`);
        loadData();
      } else {
        setNote('Failed to generate code.');
      }
    } catch (e: any) {
      setNote(e?.message || 'Failed to generate code.');
    } finally {
      setBusy(false);
    }
  };

  const th: React.CSSProperties = { padding: '10px 12px', textAlign: 'left', borderBottom: '2px solid #E5E7EB', fontWeight: 600, color: '#374151', fontSize: 13 };
  const td: React.CSSProperties = { padding: '10px 12px', borderBottom: '1px solid #F3F4F6', fontSize: 13 };

  // Pagination Math
  const auditHistory = oversight.history || [];
  const auditTotalPages = Math.ceil(auditHistory.length / auditPageSize) || 1;
  const currentAuditRows = auditHistory.slice((auditPage - 1) * auditPageSize, auditPage * auditPageSize);

  const summaryRows = rows || [];
  const summaryTotalPages = Math.ceil(summaryRows.length / summaryPageSize) || 1;
  const currentSummaryRows = summaryRows.slice((summaryPage - 1) * summaryPageSize, summaryPage * summaryPageSize);

  return (
    <div style={{ padding: 20, maxWidth: '100%', overflowX: 'hidden' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700, color: '#111827' }}>Compensation Oversight & Security Control</h1>
        <p style={{ color: '#6B7280', margin: 0, fontSize: 14 }}>
          Manage Admin Authorization Codes for commission changes and audit all commission percentage updates across all salons.
        </p>
      </div>

      {note ? <div style={{ background: '#ECFDF5', color: '#047857', border: '1px solid #A7F3D0', padding: '8px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13, fontWeight: 600 }}>{note}</div> : null}
      {error ? <div role="alert" style={{ color: '#DC2626', marginBottom: 16, fontSize: 13 }}>{error}</div> : null}

      {/* ADMIN AUTHORIZATION CODE GENERATOR */}
      <div style={{ background: '#FFFDF9', border: '1px solid #F3E8D2', borderRadius: 12, padding: 18, marginBottom: 24, boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#92400E' }}> Generate Admin Authorization Code</h3>
          <span style={{ fontSize: 11, background: '#FEF3C7', color: '#92400E', padding: '2px 8px', borderRadius: 999, fontWeight: 700 }}>Super Admin Only</span>
        </div>
        <p style={{ margin: '0 0 14px', fontSize: 12.5, color: '#78350F', lineHeight: 1.5 }}>
          When a Salon Owner requests authorization to change a technician’s commission percentage, generate an Authorization Code below and provide it to the owner.
        </p>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={genTenantId}
            onChange={(e) => setGenTenantId(e.target.value)}
            style={{ height: 42, padding: '0 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 13, background: '#FFF' }}
          >
            <option value="">All Salons (Universal Code)</option>
            {allTenants.map((t) => (
              <option key={t.id} value={t.id}>{t.n}</option>
            ))}
          </select>
          <button
            className="btn"
            disabled={busy}
            onClick={handleGenerateCode}
            
          >
            {busy ? 'Generating…' : 'Generate Code for Owner'}
          </button>
          {lastGenCode ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto', background: '#FFF', padding: '4px 10px', border: '1px solid #F59E0B', borderRadius: 8 }}>
              <span style={{ fontSize: 12, color: '#78350F' }}>Code:</span>
              <strong style={{ fontSize: 14, color: '#B45309', fontFamily: 'monospace' }}>{lastGenCode}</strong>
              <button
                style={{ border: 0, background: '#FEF3C7', color: '#92400E', padding: '3px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 700 }}
                onClick={() => { navigator.clipboard.writeText(lastGenCode); setNote('Authorization code copied to clipboard!'); }}
              >
                Copy
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {/* LIVE COMMISSION CHANGE HISTORY AUDIT LOG WITH PAGINATION */}
      <div style={{ background: '#FFF', border: '1px solid #E5E7EB', borderRadius: 12, padding: 18, marginBottom: 24, maxWidth: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#111827' }}>📋 Live Commission Security Audit Log</h3>
          <span style={{ fontSize: 12, color: '#6B7280' }}>Total Entries: {auditHistory.length}</span>
        </div>

        {auditHistory.length === 0 ? (
          <div style={{ color: '#9CA3AF', fontSize: 13, padding: 12, textAlign: 'center' }}>No commission changes recorded yet.</div>
        ) : (
          <>
            <div style={{ overflowX: 'auto', width: '100%' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13, minWidth: 900 }}>
                <thead>
                  <tr>
                    <th style={th}>Salon Name</th>
                    <th style={th}>Commission Type</th>
                    <th style={th}>Change</th>
                    <th style={th}>Requested By</th>
                    <th style={th}>Authorized By</th>
                    <th style={th}>Code Used</th>
                    <th style={th}>Date & Time</th>
                  </tr>
                </thead>
                <tbody>
                  {currentAuditRows.map((h) => {
                    const isSalonDefault = h.targetType === 'owner_creation' || h.targetType === 'salon_default';
                    return (
                      <tr key={h.id}>
                        <td style={{ ...td, fontWeight: 600 }}>{h.tenantName || 'Salon (' + h.tenantId + ')'}</td>
                        <td style={td}>
                          <span style={{
                            fontSize: 11.5,
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: 6,
                            background: isSalonDefault ? '#EFF6FF' : '#F3E8FF',
                            color: isSalonDefault ? '#1D4ED8' : '#6B21A8',
                            border: `1px solid ${isSalonDefault ? '#BFDBFE' : '#E9D5FF'}`
                          }}>
                            {isSalonDefault ? 'Salon Default' : 'Technician Override'}
                          </span>
                          {!isSalonDefault && (h.techName || h.techEmail) ? (
                            <div style={{ fontSize: 11.5, marginTop: 4, color: '#374151', fontWeight: 600 }}>
                              👤 {h.techName || 'Technician'} {h.techEmail ? <span style={{ color: '#6B7280', fontWeight: 400 }}>({h.techEmail})</span> : null}
                            </div>
                          ) : null}
                        </td>
                        <td style={td}><span style={{ fontWeight: 700, color: '#059669' }}>{h.oldCommissionPercent}% → {h.newCommissionPercent}%</span></td>
                        <td style={td}>{h.requestedByName} <span style={{ color: '#9CA3AF', fontSize: 11 }}>({h.requestedByRole})</span></td>
                        <td style={{ ...td, fontWeight: 600, color: '#2563EB' }}>{h.authorizedByName || 'Super Admin'}</td>
                        <td style={td}>{h.authCodeUsed ? <code style={{ background: '#F3F4F6', padding: '2px 6px', borderRadius: 4, fontSize: 11.5 }}>{h.authCodeUsed}</code> : '—'}</td>
                        <td style={td}>{new Date(h.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* AUDIT LOG PAGINATION FOOTER */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, paddingTop: 12, borderTop: '1px solid #F3F4F6', fontSize: 12.5, color: '#4B5563' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>Rows per page:</span>
                <select
                  value={auditPageSize}
                  onChange={(e) => { setAuditPageSize(Number(e.target.value)); setAuditPage(1); }}
                  style={{ height: 28, padding: '0 6px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 12 }}
                >
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>Page <strong>{auditPage}</strong> of <strong>{auditTotalPages}</strong></span>
                <button
                  disabled={auditPage <= 1}
                  onClick={() => setAuditPage((p) => Math.max(1, p - 1))}
                  style={{ height: 28, padding: '0 10px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#FFF', cursor: auditPage <= 1 ? 'not-allowed' : 'pointer', opacity: auditPage <= 1 ? 0.5 : 1 }}
                >
                  Prev
                </button>
                <button
                  disabled={auditPage >= auditTotalPages}
                  onClick={() => setAuditPage((p) => Math.min(auditTotalPages, p + 1))}
                  style={{ height: 28, padding: '0 10px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#FFF', cursor: auditPage >= auditTotalPages ? 'not-allowed' : 'pointer', opacity: auditPage >= auditTotalPages ? 0.5 : 1 }}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* TENANT COMPENSATION OVERVIEW TABLE WITH PAGINATION */}
      <div style={{ background: '#FFF', border: '1px solid #E5E7EB', borderRadius: 12, padding: 18, maxWidth: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#111827' }}>Salon Compensation Configuration Summary</h3>
          <span style={{ fontSize: 12, color: '#6B7280' }}>Total Salons: {summaryRows.length}</span>
        </div>

        {rows === null ? <div>Loading…</div>
          : summaryRows.length === 0 ? <div style={{ color: '#6B7280' }}>No tenants have configured compensation yet.</div>
            : (
              <>
                <div style={{ overflowX: 'auto', width: '100%' }}>
                  <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13, minWidth: 900 }}>
                    <thead><tr>
                      <th style={th}>Tenant</th><th style={th}>Active rules</th><th style={th}>Tier plans</th><th style={th}>Bonus rules</th><th style={th}>Classifications</th><th style={th}>Agreements</th>
                    </tr></thead>
                    <tbody>
                      {currentSummaryRows.map((r) => (
                        <tr key={r.tenantId}>
                          <td style={{ ...td, fontWeight: 600 }}>{r.tenantName || r.tenantId}</td>
                          <td style={td}>{r.activeRules}</td>
                          <td style={td}>{r.tierPlans}</td>
                          <td style={td}>{r.bonusRules}</td>
                          <td style={td}>{r.classifications}</td>
                          <td style={td}>{r.acknowledgedAgreements}/{r.agreements} acknowledged</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* SUMMARY TABLE PAGINATION FOOTER */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, paddingTop: 12, borderTop: '1px solid #F3F4F6', fontSize: 12.5, color: '#4B5563' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>Rows per page:</span>
                    <select
                      value={summaryPageSize}
                      onChange={(e) => { setSummaryPageSize(Number(e.target.value)); setSummaryPage(1); }}
                      style={{ height: 28, padding: '0 6px', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 12 }}
                    >
                      <option value={5}>5</option>
                      <option value={10}>10</option>
                      <option value={25}>25</option>
                    </select>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>Page <strong>{summaryPage}</strong> of <strong>{summaryTotalPages}</strong></span>
                    <button
                      disabled={summaryPage <= 1}
                      onClick={() => setSummaryPage((p) => Math.max(1, p - 1))}
                      style={{ height: 28, padding: '0 10px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#FFF', cursor: summaryPage <= 1 ? 'not-allowed' : 'pointer', opacity: summaryPage <= 1 ? 0.5 : 1 }}
                    >
                      Prev
                    </button>
                    <button
                      disabled={summaryPage >= summaryTotalPages}
                      onClick={() => setSummaryPage((p) => Math.min(summaryTotalPages, p + 1))}
                      style={{ height: 28, padding: '0 10px', border: '1px solid #D1D5DB', borderRadius: 6, background: '#FFF', cursor: summaryPage >= summaryTotalPages ? 'not-allowed' : 'pointer', opacity: summaryPage >= summaryTotalPages ? 0.5 : 1 }}
                    >
                      Next
                    </button>
                  </div>
                </div>
              </>
            )}
      </div>
    </div>
  );
}
