import { useEffect, useState } from 'react';
import { techCompensationApi, type TechAgreement } from '../api/techApi';

const termsSummary = (t: Record<string, unknown>) => {
  const parts: string[] = [];
  if (t.commissionPercent != null) parts.push(`${t.commissionPercent}% commission`);
  if (t.classification) parts.push(String(t.classification));
  if (t.notes) parts.push(String(t.notes));
  return parts.join(' · ');
};

/**
 * TechAgreementsPanel (spec §19) — the technician sees their own compensation agreements and acknowledges (signs off) a
 * sent one. Rendered inside the (reachable) tech payroll screen; hidden when there are no agreements.
 */
export function TechAgreementsPanel() {
  const [agreements, setAgreements] = useState<TechAgreement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => { setError(null); techCompensationApi.agreements().then(setAgreements).catch((e) => { setAgreements([]); setError(e?.message || 'Could not load your agreements'); }); };
  useEffect(() => { load(); }, []);

  const acknowledge = async (id: string) => {
    setBusy(true); setError(null);
    try { await techCompensationApi.acknowledgeAgreement(id); load(); }
    catch (e: any) { setError(e?.message || 'Could not acknowledge'); } finally { setBusy(false); }
  };

  if (agreements === null || agreements.length === 0) return error ? <div style={{ color: 'var(--tech-danger,#C0492F)', fontSize: 13, marginTop: 16 }}>{error}</div> : null;

  return (
    <div style={{ marginTop: 22 }}>
      <div style={{ fontWeight: 700, marginBottom: 8, fontFamily: 'Playfair Display, serif', fontSize: 17 }}>Compensation Agreements</div>
      {error && <div style={{ color: 'var(--tech-danger,#C0492F)', fontSize: 13, marginBottom: 8 }}>{error}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {agreements.map((a) => (
          <div key={a.id} style={{ border: '1px solid var(--tech-line,#E7DBC6)', borderRadius: 12, padding: 12, background: 'var(--tech-surface,#fff)' }}>
            <div style={{ fontWeight: 600, color: 'var(--tech-text,#2C2118)' }}>{a.title}</div>
            {termsSummary(a.terms) ? <div style={{ fontSize: 13, color: 'var(--tech-muted,#7A6C57)', marginTop: 2 }}>{termsSummary(a.terms)}</div> : null}
            {a.status === 'acknowledged'
              ? <div style={{ color: 'var(--tech-success,#2E9E54)', fontSize: 13, marginTop: 6, fontWeight: 600 }}>✓ Acknowledged{a.acknowledgedAt ? ` ${new Date(a.acknowledgedAt).toLocaleDateString()}` : ''}</div>
              : <button disabled={busy} onClick={() => acknowledge(a.id)} style={{ marginTop: 8, padding: '8px 16px', borderRadius: 10, border: 'none', background: 'var(--tech-accent,#B08D57)', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>Acknowledge</button>}
          </div>
        ))}
      </div>
    </div>
  );
}
