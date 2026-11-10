// AccessRequestPanel.tsx — tenant SELF-SERVICE requester surface for the access-request workflow (§26). A signed-in
// user files a role-elevation request (with a business reason, optional time-box), tracks status, and cancels an
// open one. Identity/tenant are server-derived — this panel never sends a user id. Approvals happen in the Super
// Admin console. Honest: high-risk (OWNER) requests are flagged; nothing here grants access on its own.
import { useEffect, useState } from 'react';
import { posMeAccessRequestsApi, type RequestableRolesResponse } from '../api/posMeAccessRequestsApi';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { codeLabel } from '../components/codeLabel';
import { statusLabel } from '../i18n/status-label';
import { fmtInZone } from '../i18n/format';
import { reportError } from './reportsCommon';

const cardBox: React.CSSProperties = { background: 'var(--card, #FFFCF6)', border: '1px solid var(--line)', borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', minHeight: 0 };
const statusTone: Record<string, string> = { submitted: 'warn', under_review: 'warn', approved: 'ok', rejected: 'danger', cancelled: '', expired: '' };

const when = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: '2-digit', hour: 'numeric', minute: '2-digit' }) || '—' : '—');

export function AccessRequestPanel({ currentRole }: { currentRole?: string | null }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [role, setRole] = useState('');
  const [reason, setReason] = useState('');
  const [duration, setDuration] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  // the requestable roles come from the server policy (batch 8 decision 6) — never a list in this file
  const [roleOpts, setRoleOpts] = useState<RequestableRolesResponse['roles'] | null>(null);

  // newest first (the server orders by created_at desc); a failed read says so instead of showing "no requests"
  const load = () => { setLoadErr(null); return posMeAccessRequestsApi.listMine().then((r: any) => setRows(r?.rows || [])).catch((e) => { setRows(null); setLoadErr(reportError(e, t('pos.my_requests'))); }); };
  const loadRoles = () => posMeAccessRequestsApi.roles().then((r) => setRoleOpts(r?.roles ?? [])).catch((e) => { setRoleOpts(null); setLoadErr(reportError(e, t('pos.requested_role'))); });
  useEffect(() => { load(); loadRoles(); }, []);

  const options = (roleOpts ?? []).filter((r) => r.state !== 'held' && r.state !== 'not_requestable');
  const openSame = (rows ?? []).some((r) => r.requestedRole === role && (r.status === 'submitted' || r.status === 'under_review'));
  const ready = !!role && reason.trim().length >= 5 && !busy && !openSame;

  const submit = async () => {
    if (!ready) return;
    setBusy(true); setMsg(null);
    try {
      const r: any = await posMeAccessRequestsApi.create({ requestedRole: role, reason: reason.trim(), requestedDurationDays: duration ? Number(duration) : null });
      setMsg(r.highRisk ? t('pos.request_submitted_this_is_a_privileged_1f61') : t('pos.request_submitted_for_review'));
      setRole(''); setReason(''); setDuration('');
      await load(); await loadRoles();
    } catch (e: any) { setMsg(e?.message || t('pos.could_not_submit_the_request')); } finally { setBusy(false); }
  };
  const cancel = async (id: string) => {
    setBusy(true); setMsg(null);
    try { await posMeAccessRequestsApi.cancel(id); await load(); } catch (e: any) { setMsg(e?.message || t('pos.could_not_cancel')); } finally { setBusy(false); }
  };

  return (
    <section style={cardBox}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontWeight: 800, fontSize: 13 }}>{t('pos.request_access')}</div>
        <span className="pill" style={{ fontSize: 10 }}>{t('pos.you')}{' '}{currentRole ? statusLabel('role', currentRole) : '—'}</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>{t('pos.ask_for_a_higher_role_or_tkop')}</div>

      <div style={{ display: 'grid', gap: 6, marginBottom: 8 }}>
        <select aria-label={t('pos.requested_role')} value={role} onChange={(e) => setRole(e.target.value)} style={{ padding: '8px 9px' }}>
          <option value="">{t('pos.select_a_role')}</option>
          {options.map((r) => <option key={r.role} value={r.role}>{codeLabel('admin.role', r.role, 'role')}{r.highRisk ? ` (${t('pos.high_risk')})` : ''}{r.state === 'open_request' ? ` · ${t('arq.openTag')}` : ''}</option>)}
        </select>
        <textarea aria-label={t('pos.reason_2')} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('pos.business_reason_at_least_5_characters')} rows={2} style={{ padding: '8px 9px', resize: 'vertical' }} />
        <input aria-label={t('pos.duration_in_days')} value={duration} onChange={(e) => setDuration(e.target.value.replace(/[^0-9]/g, ''))} placeholder={t('pos.duration_in_days_optional_blank_permanent')} style={{ padding: '8px 9px' }} />
        <button className="btn" disabled={!ready} style={!ready ? { opacity: 0.5 } : undefined} onClick={submit}>{busy ? t('pos.submitting') : t('pos.submit_request')}</button>
      </div>
      {openSame ? <div className="sub" data-testid="arq-dup" style={{ fontSize: 11, marginBottom: 6 }}>{t('arq.duplicate')}</div> : null}
      {msg ? <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>{msg}</div> : null}
      <div className="sub" data-testid="arq-policy" style={{ fontSize: 10.5, marginBottom: 6 }}>{t('arq.policy')}</div>

      <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--muted)', margin: '4px 0 4px' }}>{t('pos.my_requests')}</div>
      <div className="list" style={{ maxHeight: 'none' }}>
        {loadErr ? <div className="row err" data-testid="arq-error" style={{ fontSize: 12 }}>{loadErr} <button className="btn ghost" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => void load()}>{t('pos.retry')}</button></div>
          : rows === null ? <div className="row" style={{ fontSize: 12, color: 'var(--muted)' }}>{t('pos.loading')}</div>
          : rows.length === 0 ? <div className="row" style={{ fontSize: 12, color: 'var(--muted)' }}>{t('pos.no_requests_yet')}</div>
            : rows.map((r) => (
              <div className="row" key={r.id} style={{ alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 12.5 }}>{r.currentRole ? statusLabel('role', r.currentRole) : '—'} → {statusLabel('role', r.requestedRole)} {r.highRisk ? <span className="pill warn" style={{ fontSize: 9 }}>{t('pos.high_risk')}</span> : null}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{r.reason}{r.requestedDurationDays ? ` · ${r.requestedDurationDays}d` : t('pos.permanent')}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--muted)' }} data-testid="arq-when">{t('arq.submitted', { at: when(r.createdAt) })}{r.decidedAt ? ` · ${t('arq.decided', { at: when(r.decidedAt) })}` : ''}{r.expiresAt ? ` · ${t('arq.expires', { at: when(r.expiresAt) })}` : ''}</div>
                  {r.decisionNotes ? <div style={{ fontSize: 10.5 }} data-testid="arq-notes">{t('arq.notes')}: {r.decisionNotes}</div> : null}
                </div>
                <span className={'pill ' + (statusTone[r.status] || '')} style={{ fontSize: 10 }}>{codeLabel('admin.access.request.status', r.status, ['skillRequest', 'deal'])}</span>
                {(r.status === 'submitted' || r.status === 'under_review') ? <button className="btn ghost" style={{ fontSize: 11, padding: '3px 8px' }} disabled={busy} onClick={() => cancel(r.id)}>{t('pos.cancel')}</button> : null}
              </div>
            ))}
      </div>
    </section>
  );
}
