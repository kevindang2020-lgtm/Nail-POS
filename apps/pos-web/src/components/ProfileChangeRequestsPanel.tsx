// ProfileChangeRequestsPanel.tsx — Technician Profile mandate §95 publicProfileChangesRequireApproval.
// The salon's switch (owner / manager, pos.technicians.edit) and the queue of PUBLIC-profile edits by technicians
// employed here that are waiting for a decision. Approve applies the edit as she typed it; Reject sends it back with
// a note. The decision carries the request's version — a request that changed since it was loaded is refused by the
// server (VERSION_CONFLICT) and the list reloads. Nothing here is tenant-private: only public fields are ever held.
import { useCallback, useEffect, useState } from 'react';
import { useInlineAsk } from '@aipowersalon/ui';
import { posTechniciansApi, type ProfileChangeRequest } from '../api/posTechniciansApi';
import { useCan } from './usePermissions';
import { useRealtime } from '../realtime/useRealtime';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { fmtInZone } from '../i18n/format';

// field → catalogue key; translated when read (a language switch re-labels in place)
const LABEL_KEY: Record<string, string> = { displayName: 'pos.display_name', title: 'pos.title', bio: 'pos.bio', yearsExperience: 'people.profileChange.field.yearsExperience', specialties: 'pos.specialties', certifications: 'people.profileChange.field.certifications', styleTags: 'people.profileChange.field.styleTags', languages: 'pos.languages', profileLinks: 'people.profileChange.field.links', profileLinkVisibility: 'people.profileChange.field.linkVisibility' };
const show = (v: unknown) => (v == null || v === '' ? '—' : Array.isArray(v) ? (v.length ? v.join(', ') : '—') : typeof v === 'object' ? Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k}: ${x}`).join(' · ') || '—' : String(v));

export function ProfileChangeRequestsPanel() {
  const can = useCan();
  const [policy, setPolicy] = useState<boolean | null>(null);
  const [reqs, setReqs] = useState<ProfileChangeRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { ask, askUi } = useInlineAsk();

  const load = useCallback(() => {
    posTechniciansApi.profilePolicy().then((p) => setPolicy(!!p?.publicProfileChangesRequireApproval)).catch(() => setPolicy((v) => v));
    posTechniciansApi.profileChanges().then((r) => { setReqs(Array.isArray(r?.requests) ? r.requests : []); setError(null); }).catch((e: any) => setError(e?.message || t('pos.could_not_load_profile_change_requests')));
  }, []);
  useEffect(() => { load(); }, [load]);
  useRealtime('technicians', load);

  const flip = async () => {
    if (policy == null) return;
    setBusy('policy'); setNote(null);
    try { const r = await posTechniciansApi.setProfilePolicy(!policy); setPolicy(!!r.publicProfileChangesRequireApproval); setNote(!policy ? t('pos.public_profile_edits_by_your_technicians_17cu') : t('pos.public_profile_edits_now_go_live_2emc')); }
    catch (e: any) { setNote(e?.message || t('pos.could_not_change_the_setting')); } finally { setBusy(null); }
  };
  const decide = async (r: ProfileChangeRequest, decision: 'approve' | 'reject', reason?: string) => {
    setBusy(r.requestId); setNote(null);
    try {
      await posTechniciansApi.decideProfileChange(r.requestId, decision, r.version, reason);
      setNote(decision === 'approve' ? t('pos.displayname_s_profile_changes_are_live', { displayName: String(r.displayName) }) : t('pos.displayname_s_changes_were_sent_back', { displayName: String(r.displayName) }));
    } catch (e: any) { setNote(e?.message || t('pos.decision_failed')); }
    finally { setBusy(null); load(); }
  };

  // Nothing to show and no permission to change the switch → stay out of the way
  if (!can('pos.technicians.edit') && (!reqs || reqs.length === 0)) return null;
  return (
    <section className="panel" style={{ marginBottom: 12 }} aria-label={t('pos.public_profile_change_approval')}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 800, fontSize: 13.5 }}>{t('pos.public_profile_changes')}{reqs && reqs.length ? <span className="pill warn" style={{ marginLeft: 6 }}>{reqs.length}</span> : null}</div>
        {can('pos.technicians.edit') ? (
          <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
            <input type="checkbox" checked={!!policy} disabled={policy == null || busy === 'policy'} onChange={flip} aria-label={t('pos.require_manager_approval_for_technicians_public_13ub')} />
            {t('pos.require_approval_before_a_technician_s_gcns')}
          </label>
        ) : null}
      </div>
      {error ? <div className="err" style={{ marginTop: 6 }}>{error}</div> : null}
      {note ? <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }} role="status">{note}</div> : null}
      {askUi}
      {reqs && reqs.length === 0 && policy ? <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{t('pos.no_profile_changes_are_waiting')}</div> : null}
      {reqs?.map((r) => (
        <div key={r.requestId} style={{ borderTop: '1px solid #EFEAE1', padding: '10px 0', display: 'grid', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <strong style={{ fontSize: 13 }}>{r.displayName}</strong>
            <span className="muted" style={{ fontSize: 11.5 }}>{t('pos.requested')}{' '}{fmtInZone(r.requestedAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
            {can('pos.technicians.edit') ? (
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <button className="btn" disabled={busy === r.requestId} onClick={() => decide(r, 'approve')}>{t('pos.approve')}</button>
                <button className="btn ghost" disabled={busy === r.requestId} onClick={() => ask(t('people.profileChange.sendBackWhy', { name: r.displayName }), (reason) => { void decide(r, 'reject', reason); }, { confirmLabel: t('pos.send_back'), inputLabel: t('people.profileChange.noteToTechnician') })}>{t('pos.send_back')}</button>
              </span>
            ) : null}
          </div>
          <table className="tbl" style={{ fontSize: 12 }}>
            <thead><tr><th>{t('pos.field')}</th><th>{t('pos.now')}</th><th>{t('pos.requested_2')}</th></tr></thead>
            <tbody>
              {Object.keys(r.changes).map((k) => (
                <tr key={k}><td style={{ fontWeight: 600 }}>{LABEL_KEY[k] ? t(LABEL_KEY[k]) : k}</td><td className="muted">{show(r.current?.[k])}</td><td>{show(r.changes[k])}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}
