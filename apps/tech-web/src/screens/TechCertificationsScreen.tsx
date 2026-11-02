// TechCertificationsScreen — the technician's own certifications (merge Oct 12 2026; the other chat's phase-3 screen on
// AUTH's /tech/certifications). She adds and edits them (with an optional document); the SALON verifies. Only an
// UNVERIFIED row can be edited or removed — a verified one feeds service eligibility and is changed by the salon.
// Expiry reminders arrive at 30 / 14 / 7 days (certification-expiry scheduler).
import { useCallback, useEffect, useState } from 'react';
import { techApi, type TechCertificationView } from '../api/techApi';
import { MyWorkShell } from './TechMyWorkScreens';

const STATUS: Record<string, { l: string; cls: string }> = { UNVERIFIED: { l: 'Waiting for the salon to verify', cls: 'tech-chip warn' }, VERIFIED: { l: 'Verified', cls: 'tech-chip' }, REVOKED: { l: 'Revoked', cls: 'tech-chip neutral' }, EXPIRED: { l: 'Expired', cls: 'tech-chip neutral' } };
type Draft = { id?: string; name: string; issuer: string; issuedAt: string; expiresAt: string; file: File | null };
const empty: Draft = { name: '', issuer: '', issuedAt: '', expiresAt: '', file: null };

export function TechCertificationsScreen() {
  const [rows, setRows] = useState<TechCertificationView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(() => techApi.certifications()
    .then((r) => { setRows(Array.isArray(r) ? r : []); setError(null); })
    .catch((e: any) => { setRows((p) => p ?? []); setError(e?.message || 'Could not load your certifications.'); }), []);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) { setError('Give the certification a name.'); return; }
    if (draft.issuedAt && draft.expiresAt && draft.expiresAt < draft.issuedAt) { setError('The expiry date must be after the issue date.'); return; }
    setBusy(true); setError(null);
    try {
      let documentKey: string | undefined;
      if (draft.file) documentKey = (await techApi.uploadSkillDocument(draft.file)).key;
      const body = { name: draft.name.trim(), issuer: draft.issuer.trim() || null, issuedAt: draft.issuedAt || null, expiresAt: draft.expiresAt || null, ...(documentKey ? { documentKey } : {}) };
      if (draft.id) await techApi.updateCertification(draft.id, body); else await techApi.addCertification(body);
      setDraft(null); await load();
    } catch (e: any) { setError(e?.message || 'Could not save the certification.'); }
    finally { setBusy(false); }
  };
  const remove = async (cid: string) => {
    setBusy(true); setError(null); setConfirmId(null);
    try { await techApi.deleteCertification(cid); await load(); } catch (e: any) { setError(e?.message || 'Could not remove it.'); } finally { setBusy(false); }
  };

  return (
    <MyWorkShell title="Certifications">
      <div className="tech-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>Licenses and certificates you hold. The salon verifies them; some services can only be booked with you once the matching certification is verified.</div>
      {error ? <div className="tech-state" role="alert" style={{ color: '#B3261E', marginBottom: 10 }}>{error}</div> : null}
      {rows === null ? <div className="tech-skel" style={{ height: 60, borderRadius: 12 }} /> : rows.length === 0 && !draft ? <div className="tech-muted" style={{ marginBottom: 10 }}>No certifications yet.</div> : rows.map((c) => (
        <div key={c.id} className="tech-card" style={{ padding: 12, marginBottom: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <strong>{c.name}</strong>
            <span className={STATUS[c.verificationStatus]?.cls ?? 'tech-chip neutral'}>{STATUS[c.verificationStatus]?.l ?? c.verificationStatus}</span>
          </div>
          <div className="tech-muted" style={{ fontSize: 12.5, marginTop: 4 }}>
            {c.issuer ? `${c.issuer} · ` : ''}{c.expiresAt ? `Expires ${c.expiresAt.slice(0, 10)}${c.daysToExpiry != null && c.daysToExpiry >= 0 && c.daysToExpiry <= 30 ? ` — in ${c.daysToExpiry} days` : ''}` : 'No expiry'}{c.hasDocument ? ' · document attached' : ''}
          </div>
          {c.revokedReason ? <div className="tech-muted" style={{ fontSize: 12.5, marginTop: 4 }}>Salon note: {c.revokedReason}</div> : null}
          {c.verificationStatus === 'UNVERIFIED' ? (confirmId === c.id ? (
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="tech-btn danger-outline" disabled={busy} onClick={() => remove(c.id)}>Yes, remove</button>
              <button className="tech-btn ghost" onClick={() => setConfirmId(null)}>Keep it</button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="tech-btn outline" onClick={() => setDraft({ id: c.id, name: c.name, issuer: c.issuer ?? '', issuedAt: c.issuedAt?.slice(0, 10) ?? '', expiresAt: c.expiresAt?.slice(0, 10) ?? '', file: null })}>Edit</button>
              <button className="tech-btn ghost" onClick={() => setConfirmId(c.id)}>Remove</button>
            </div>
          )) : null}
        </div>
      ))}
      {draft ? (
        <div className="tech-card" style={{ padding: 14, marginTop: 8 }} aria-label={draft.id ? 'Edit certification' : 'Add certification'}>
          <label className="tech-label">Name<input className="tech-input" aria-label="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={120} /></label>
          <label className="tech-label">Issued by (optional)<input className="tech-input" aria-label="Issued by" value={draft.issuer} onChange={(e) => setDraft({ ...draft, issuer: e.target.value })} maxLength={120} /></label>
          <label className="tech-label">Issued on (optional)<input className="tech-input" type="date" aria-label="Issued on" value={draft.issuedAt} onChange={(e) => setDraft({ ...draft, issuedAt: e.target.value })} /></label>
          <label className="tech-label">Expires on (optional)<input className="tech-input" type="date" aria-label="Expires on" value={draft.expiresAt} onChange={(e) => setDraft({ ...draft, expiresAt: e.target.value })} /></label>
          <label className="tech-label">Document photo or PDF (optional)<input className="tech-input" type="file" accept="image/*,application/pdf" aria-label="Document" onChange={(e) => setDraft({ ...draft, file: e.target.files?.[0] ?? null })} /></label>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="tech-btn gold" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
            <button className="tech-btn ghost" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      ) : <button className="tech-btn outline" style={{ width: '100%', marginTop: 8 }} onClick={() => setDraft({ ...empty })}>Add a certification</button>}
    </MyWorkShell>
  );
}
