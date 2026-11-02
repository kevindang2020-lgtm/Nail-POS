import { useEffect, useState } from 'react';
import { ownerCompensationApi, type Agreement, type WorkerClassification } from '../api/ownerApi';

const STATUS_LABEL: Record<string, string> = { draft: 'Draft', sent: 'Sent — awaiting acknowledgment', acknowledged: 'Acknowledged', superseded: 'Superseded' };
const statusColor = (s: string) => (s === 'acknowledged' ? 'var(--owner-success)' : s === 'superseded' ? 'var(--owner-muted, #999)' : 'inherit');
const termsSummary = (t: Record<string, unknown>) => {
  const parts: string[] = [];
  if (t.commissionPercent != null) parts.push(`${t.commissionPercent}% commission`);
  if (t.classification) parts.push(String(t.classification));
  if (t.notes) parts.push(String(t.notes));
  return parts.join(' · ');
};

/**
 * Compensation Agreements (spec §19). The owner records a technician's compensation terms as an agreement; the technician
 * acknowledges it from their own app. A new agreement supersedes the technician's prior one (versioned history). This
 * records what was agreed — it doesn't itself change how pay is computed. Rendered inside the Commission & Payroll screen.
 */
export function AgreementsPanel() {
  const [agreements, setAgreements] = useState<Agreement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [techId, setTechId] = useState('');
  const [title, setTitle] = useState('');
  const [commission, setCommission] = useState('');
  const [cls, setCls] = useState<WorkerClassification | ''>('');
  const [notes, setNotes] = useState('');

  const load = () => { setError(null); ownerCompensationApi.agreements().then(setAgreements).catch((e) => { setAgreements([]); setError(e?.message || 'Failed to load agreements'); }); };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!techId.trim() || !title.trim()) { setError('Enter a technician ID and a title'); return; }
    setBusy(true); setError(null);
    const terms: Record<string, unknown> = {};
    if (commission.trim()) terms.commissionPercent = Number(commission);
    if (cls) terms.classification = cls;
    if (notes.trim()) terms.notes = notes.trim();
    try { await ownerCompensationApi.createAgreement({ technicianId: techId.trim(), title: title.trim(), terms }); setTechId(''); setTitle(''); setCommission(''); setCls(''); setNotes(''); load(); }
    catch (e: any) { setError(e?.message || 'Could not create the agreement'); } finally { setBusy(false); }
  };

  return (
    <div className="owner-chartcard">
      <div className="head"><div className="t">Compensation Agreements</div>{busy ? <div className="u">Working…</div> : null}</div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>Record a technician's agreed compensation terms. They acknowledge it from their own app; a new agreement supersedes the previous one. This is a record of what was agreed — it doesn't change how pay is calculated.</div>
      {error ? <div role="alert" style={{ fontSize: 13, color: 'var(--owner-danger)', marginBottom: 8 }}>{error}</div> : null}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end', marginBottom: 8 }}>
        <label style={{ fontSize: 12 }}>Technician ID<br /><input aria-label="Agreement technician" value={techId} onChange={(e) => setTechId(e.target.value)} className="owner-input" style={{ width: 110 }} /></label>
        <label style={{ fontSize: 12 }}>Title<br /><input aria-label="Agreement title" value={title} onChange={(e) => setTitle(e.target.value)} className="owner-input" placeholder="e.g. 2026 compensation" /></label>
        <label style={{ fontSize: 12 }}>Commission %<br /><input aria-label="Agreement commission" value={commission} onChange={(e) => setCommission(e.target.value)} className="owner-input" inputMode="decimal" style={{ width: 90 }} /></label>
        <label style={{ fontSize: 12 }}>Classification<br /><select aria-label="Agreement classification" value={cls} onChange={(e) => setCls(e.target.value as WorkerClassification | '')} className="owner-input"><option value="">—</option><option value="employee">Employee</option><option value="contractor">Contractor</option><option value="booth_renter">Booth renter</option></select></label>
        <button className="owner-btn" disabled={busy} onClick={create}>Create & send</button>
      </div>
      <label style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>Notes<br /><input aria-label="Agreement notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="owner-input" style={{ width: '100%', maxWidth: 420 }} placeholder="any additional terms" /></label>

      {agreements === null ? <div className="muted" style={{ fontSize: 13 }}>Loading…</div>
        : agreements.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>No agreements yet.</div>
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {agreements.map((a) => (
              <div key={a.id} style={{ border: '1px solid var(--owner-border, #eee)', borderRadius: 6, padding: 8, fontSize: 12.5 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span><b>{a.title}</b> · Tech {a.technicianId} · v{a.version}</span>
                  <span style={{ color: statusColor(a.status), fontWeight: 600 }}>{STATUS_LABEL[a.status] || a.status}</span>
                </div>
                {termsSummary(a.terms) ? <div className="muted">{termsSummary(a.terms)}</div> : null}
                {a.acknowledgedAt ? <div style={{ color: 'var(--owner-success)', fontSize: 12 }}>Acknowledged {new Date(a.acknowledgedAt).toLocaleDateString()}</div> : null}
              </div>
            ))}
          </div>}
    </div>
  );
}
