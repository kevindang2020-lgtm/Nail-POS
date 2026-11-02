// MembershipRequestsPanel.tsx — P3: pending tech join/transfer requests into THIS salon, with profile preview
// and Approve / Reject. Approval creates the technicians row here and activates the membership (backend-owned).
import { useCallback, useEffect, useState } from 'react';
import { posTechniciansApi } from '../api/posTechniciansApi';
import { t } from '@aipowersalon/mobile-sdk/i18n';

export function MembershipRequestsPanel({ onChanged }: { onChanged?: () => void }) {
  const [reqs, setReqs] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => {
    posTechniciansApi.membershipRequests().then((r: any) => { setReqs(r.requests); setError(null); }).catch((e: any) => setError(e?.message || t('pos.could_not_load_requests')));
  }, []);
  useEffect(() => { load(); }, [load]);

  const decide = async (id: string, decision: 'approve' | 'reject', name: string) => {
    setBusy(id); setNote(null);
    try {
      const r: any = await posTechniciansApi.decideMembershipRequest(id, decision);
      setNote(decision === 'approve' ? (r?.transferred ? t('pos.name_transferred_here_her_employment_at_1509', { name: String(name) }) : t('pos.name_is_now_connected_to_this_1dh8', { name: String(name) })) : t('pos.request_from_name_was_rejected', { name: String(name) }));
      load(); onChanged?.();
    } catch (e: any) { setNote(e?.message || t('pos.decision_failed')); }   // §156: the server's sentence (TRANSFER_NOT_ALLOWED says why)
    finally { setBusy(null); }
  };

  if (!reqs || reqs.length === 0) return note ? <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }} role="status">{note}</div> : null;
  return (
    <section className="panel" style={{ marginBottom: 12 }} aria-label={t('pos.technician_join_requests')}>
      <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 8 }}>{t('pos.technician_join_requests')}{' '}<span className="pill warn" style={{ marginLeft: 6 }}>{reqs.length}</span></div>
      {error ? <div className="err">{error}</div> : null}
      {note ? <div className="muted" style={{ fontSize: 12.5, marginBottom: 6 }} role="status">{note}</div> : null}
      {reqs.map((r) => (
        <div key={r.requestId} className="row" style={{ alignItems: 'center' }}>
          <div style={{ width: 36, height: 36, borderRadius: 99, overflow: 'hidden', border: '1.5px solid #C9962E', background: '#F2E7D5', flex: '0 0 auto', display: 'grid', placeItems: 'center', fontSize: 14 }}>
            {r.avatarUrl ? <img src={r.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '👤'}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="t">{r.displayName} <span className="s">· {r.overallRating}★ ({r.ratingCount}) · {r.portfolioPhotoCount} {t('pos.photos')}{r.yearsExperience != null ? t('pos.yearsexperience_yrs', { yearsExperience: String(r.yearsExperience) }) : ''}</span>
              {/* §60/§61: a transfer — approving ends her employment at her current salon. Which salon is never shown here. */}
              {r.isTransfer ? <span className="pill warn" style={{ marginLeft: 6 }} title={t('pos.approving_moves_her_here_and_ends_1vs3')}>{t('pos.transfer')}</span> : null}
            </div>
            {r.message ? <div className="s">“{r.message}”</div> : null}
          </div>
          <button className="btn" disabled={busy === r.requestId} onClick={() => decide(r.requestId, 'approve', r.displayName)}>{t('pos.approve')}</button>
          <button className="btn ghost" disabled={busy === r.requestId} onClick={() => decide(r.requestId, 'reject', r.displayName)}>{t('pos.reject')}</button>
        </div>
      ))}
    </section>
  );
}
