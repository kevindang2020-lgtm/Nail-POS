// ReceptionCopilotUsageScreen.tsx — Super Admin → AI → Reception Copilot. Read-only, cross-tenant rollup of Reception
// Copilot activity sourced from the audit trail (GET /super-admin/copilot/usage): total confirmed actions plus a
// breakdown by action and by tenant. No per-customer or message-body data is shown. Honest states: a clear "no data"
// message and an explicit not-available state rather than fabricated numbers.
import { useEffect, useState } from 'react';
import { superAdminAiApi, type AdminCopilotUsage } from '../api/superAdminAiApi';

const GOLD = 'var(--g7,#A96F22)';
const LINE = 'var(--line,#E7DBC6)';
const CARD: React.CSSProperties = { background: 'var(--card,#fff)', border: `1px solid ${LINE}`, borderRadius: 12, padding: 16, marginBottom: 14 };
const titleCase = (s: string) => s.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export default function ReceptionCopilotUsageScreen() {
  const [data, setData] = useState<AdminCopilotUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    superAdminAiApi.copilotUsage()
      .then((d) => { if (live) setData(d); })
      .catch(() => { if (live) setError(true); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  return (
    <div style={{ padding: 20, maxWidth: 880 }}>
      <h1 style={{ fontFamily: 'Playfair Display, serif', fontSize: 24, margin: '0 0 4px' }}>Reception Copilot</h1>
      <p style={{ fontSize: 13, color: '#7A6C57', margin: '0 0 16px' }}>Platform-wide activity from the staff Reception Copilot, drawn from the audit trail. Confirmed actions only — no customer details or message contents are shown here.</p>

      {loading && <div style={{ fontSize: 13, color: '#9B8B78' }}>Loading usage…</div>}
      {!loading && error && <div style={{ ...CARD, color: '#B85B4D', fontSize: 13 }}>Couldn’t load Reception Copilot usage right now.</div>}
      {!loading && !error && data && !data.available && (
        <div style={{ ...CARD, color: '#7A6C57', fontSize: 13 }}>Reception Copilot usage isn’t available in this environment yet.</div>
      )}
      {!loading && !error && data && data.available && (
        <>
          <div style={CARD}>
            <div style={{ fontSize: 12, color: '#9B8B78', textTransform: 'uppercase', letterSpacing: 0.4 }}>Total confirmed actions</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: GOLD }}>{data.total.toLocaleString()}</div>
          </div>

          <div style={CARD}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>By action</div>
            {data.byAction.length === 0 ? (
              <div style={{ fontSize: 12.5, color: '#9B8B78' }}>No Reception Copilot actions recorded yet.</div>
            ) : data.byAction.map((a) => (
              <div key={a.action} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${LINE}`, fontSize: 12.5 }}>
                <span>{titleCase(a.action)}</span><span style={{ fontWeight: 700 }}>{a.count.toLocaleString()}</span>
              </div>
            ))}
          </div>

          <div style={CARD}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>By tenant</div>
            {data.byTenant.length === 0 ? (
              <div style={{ fontSize: 12.5, color: '#9B8B78' }}>No tenants have used the Reception Copilot yet.</div>
            ) : data.byTenant.slice(0, 25).map((t) => (
              <div key={t.tenantId} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${LINE}`, fontSize: 12.5 }}>
                <span style={{ fontFamily: 'monospace', color: '#7A6C57' }}>{t.tenantId}</span><span style={{ fontWeight: 700 }}>{t.count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
