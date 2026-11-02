import { useState } from 'react';
import { posMembershipEnrollApi } from '../api/posMembershipEnrollApi';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { codeLabel } from '../components/codeLabel';

// MembershipManageModal — cancel / pause / resume a single membership from the Memberships Overview. Status change only
// (no charge, no refund); the backend validates every transition against the membership state machine, and this modal
// only surfaces actions that are valid for the current status. A concurrent change comes back as 409 → we refresh the
// list rather than guess. Cancel-at-period-end stops auto-renew but keeps benefits until the paid period ends.

const GOLD = '#A96F22';

export type ManageMember = { membershipId: string; customerName: string; planName: string; status: string; nextBillingAt: string | null };

// Local mirror of the server status machine for the targets this modal drives — purely to hide clearly-invalid actions.
// The backend remains the source of truth and re-validates every request.
const TO_CANCELING = ['active', 'trial', 'grace', 'past_due', 'paused'];
const TO_CANCELED = ['trial', 'grace', 'past_due', 'paused', 'canceling'];
const CAN_PAUSE = ['active'];
const CAN_RESUME = ['paused', 'canceling'];

// a membership status code → people.membership.status.<code> (WP-C2's labels), read at render
const statusText = (code: string) => codeLabel('people.membership.status', code);

const fmtDate = (s: string | null): string => { if (!s) return '—'; const d = new Date(s); return isNaN(+d) ? '—' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); };

type Pending = { kind: 'cancel-eop' | 'cancel-now' | 'pause' | 'resume'; label: string; danger?: boolean };

export function MembershipManageModal({ member, onClose, onDone }: { member: ManageMember; onClose: () => void; onDone: (msg: string) => void }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const s = member.status;
  const actions: Pending[] = [];
  if (CAN_PAUSE.includes(s)) actions.push({ kind: 'pause', label: t('pos.pause_membership') });
  if (CAN_RESUME.includes(s)) actions.push({ kind: 'resume', label: s === 'canceling' ? t('pos.reactivate_membership') : t('pos.resume_membership') });
  if (TO_CANCELING.includes(s)) actions.push({ kind: 'cancel-eop', label: t('pos.cancel_at_end_of_period'), danger: true });
  if (TO_CANCELED.includes(s)) actions.push({ kind: 'cancel-now', label: t('pos.cancel_immediately'), danger: true });

  async function run() {
    if (!pending) return;
    setBusy(true); setErr(null);
    try {
      const id = member.membershipId;
      if (pending.kind === 'pause') await posMembershipEnrollApi.pause({ membershipId: id });
      else if (pending.kind === 'resume') await posMembershipEnrollApi.resume({ membershipId: id });
      else if (pending.kind === 'cancel-eop') await posMembershipEnrollApi.cancel({ membershipId: id, atPeriodEnd: true, reason: reason.trim() || null });
      else await posMembershipEnrollApi.cancel({ membershipId: id, atPeriodEnd: false, reason: reason.trim() || null });
      const MSG_KEY: Record<Pending['kind'], string> = { 'pause': 'admin.membership.paused', 'resume': 'admin.membership.resumed', 'cancel-eop': 'admin.membership.endsAtPeriodEnd', 'cancel-now': 'admin.membership.canceled' };
      onDone(t(MSG_KEY[pending.kind], { name: member.customerName })); onClose();
    } catch (e: any) {
      if (e?.status === 409) { onDone(t('admin.membership.changedRefreshed')); onClose(); return; }
      setErr(e?.message || t('pos.could_not_update_the_membership'));
      setBusy(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(40,30,20,0.38)', display: 'grid', placeItems: 'center', zIndex: 50, padding: 16 }} onClick={onClose}>
      <div className="panel" style={{ width: 'min(440px, 96vw)', maxHeight: '90vh', overflow: 'auto', background: 'var(--aps-card,#fff)' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
          <h2 style={{ margin: 0 }}>{t('pos.manage_membership')}</h2>
          <button className="btn" style={{ marginLeft: 'auto', padding: '2px 8px' }} onClick={onClose}>{t('pos.close')}</button>
        </div>

        <div style={{ padding: '8px 10px', border: '1px solid var(--line,#E2D6C2)', borderRadius: 8, background: '#FBF6EC' }}>
          <div style={{ fontWeight: 700 }}>{member.customerName}</div>
          <div className="muted" style={{ fontSize: 13 }}>{member.planName || t('pos.membership_2')}</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>{t('pos.status_2')}{' '}<strong>{statusText(s)}</strong> {t('pos.next_billing')}{' '}{fmtDate(member.nextBillingAt)}</div>
        </div>

        {!pending ? (
          <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
            {actions.length === 0 ? (
              <div className="muted" style={{ fontSize: 13 }}>{t('pos.no_lifecycle_actions_are_available_for_hpr9')}{' '}{(statusText(s)).toLowerCase()} {t('pos.membership')}</div>
            ) : actions.map((a) => (
              <button key={a.kind} className="btn" style={{ textAlign: 'left', fontWeight: 600, ...(a.danger ? { borderColor: 'var(--danger,#A33B3B)', color: 'var(--danger,#A33B3B)' } : {}) }} onClick={() => { setReason(''); setErr(null); setPending(a); }}>{a.label}</button>
            ))}
          </div>
        ) : (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{pending.label}?</div>
            {(pending.kind === 'cancel-eop' || pending.kind === 'cancel-now') && (
              <>
                <div style={{ fontSize: 12, color: '#6A5A46', marginTop: 6 }}>{pending.kind === 'cancel-eop' ? t('pos.auto_renew_stops_now_benefits_remain_ohcj') : t('pos.ends_the_membership_now_no_refund_l9qk')}</div>
                <input style={{ display: 'block', width: '100%', marginTop: 8, padding: '8px 10px', border: '1px solid var(--line,#E2D6C2)', borderRadius: 8, fontSize: 14, boxSizing: 'border-box', background: '#fff' }} placeholder={t('pos.reason_optional')} value={reason} onChange={(e) => setReason(e.target.value)} />
              </>
            )}
            {err && <div style={{ color: 'var(--danger,#A33B3B)', fontSize: 12, marginTop: 8 }}>{err}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn" onClick={() => { setPending(null); setErr(null); }} disabled={busy}>{t('pos.back')}</button>
              <button className="btn" style={{ marginLeft: 'auto', background: pending.danger ? 'var(--danger,#A33B3B)' : GOLD, color: '#fff', border: 'none', fontWeight: 700, opacity: busy ? 0.6 : 1 }} onClick={run} disabled={busy}>{busy ? t('pos.working') : t('pos.confirm')}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
