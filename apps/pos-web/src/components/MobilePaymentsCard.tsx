// MobilePaymentsCard.tsx — POS Checkout Workspace card for the Owner & Manager Payment App (mandate §45–§46, §149–§151).
//  • "Payment in progress on Kevin's iPhone · Kevin" when a phone holds the claim on the open ticket — the POS's own
//    pay buttons are refused server-side while it does (CHECKOUT_ALREADY_CLAIMED); the screen says why before anyone tries.
//  • Mobile Payments ● Online / Offline per active phone in this branch, Tap to Pay capable or not.
//  • "Send to phone" — a push to that phone's manager; the queue stays the source of truth.
// Live: refetched on every checkout realtime event (claimed / released / sent / device updated) and the 15 s safety sync.
// No permission to see it (403) → no card. No phones → an honest one-liner, not a fake device.
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { posMobilePaymentsApi, type MobilePaymentClaim, type MobilePaymentPhone } from '../api/posMobilePaymentsApi';
import { useRealtime } from '../realtime/useRealtime';
import { t } from '@aipowersalon/mobile-sdk/i18n';

const card: CSSProperties = { border: '1px solid var(--line)', borderRadius: 12, padding: 10, background: 'var(--card)', marginTop: 10 };

export function MobilePaymentsCard({ ticketId, ticketPaid, onClaimChange }: {
  ticketId: string | null;
  ticketPaid: boolean;
  /** the workspace disables its own Take Payment while a phone holds this ticket */
  onClaimChange?: (claim: MobilePaymentClaim | null) => void;
}) {
  const [phones, setPhones] = useState<MobilePaymentPhone[] | null>(null);
  const [claims, setClaims] = useState<MobilePaymentClaim[]>([]);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([posMobilePaymentsApi.phones(), posMobilePaymentsApi.claims()]);
      setPhones(Array.isArray(p) ? p : []); setClaims(Array.isArray(c) ? c : []);
    } catch (e: any) {
      if (e?.status === 403) setHidden(true);
      else setPhones((x) => x ?? []);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useRealtime('checkout', load);

  const claim = ticketId ? claims.find((c) => c.ticketId === ticketId) ?? null : null;
  useEffect(() => { onClaimChange?.(claim); }, [claim?.ticketId, claim?.deviceId, claim?.expiresAt]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (hidden || phones === null) return null;

  const send = async (p: MobilePaymentPhone) => {
    if (!ticketId) return;
    setBusy(p.deviceId); setNote(null);
    try {
      const r = await posMobilePaymentsApi.sendToPhone(ticketId, p.deviceId);
      const name = p.label || p.userName || t('pos.the_phone');
      setNote(r.sent ? t('pos.sent_to_name_it_appears_in_5qmv', { name: String(name) }) : t('pos.shown_in_name_s_checkout_queue_57dr', { name: String(name), v1: String(r.reason === 'no_push_target' ? t('pos.push_not_set_up_on_that_1w10') : r.reason || t('pos.push_unavailable')) }));
    } catch (e: any) { setNote(e?.message || t('pos.could_not_send_the_checkout_to_1ht6')); }
    finally { setBusy(null); }
  };

  return (
    <div style={card} aria-label={t('pos.mobile_payments')}>
      {claim && (
        <div role="status" style={{ background: '#FFF6E5', color: '#9A6200', borderRadius: 9, padding: '7px 10px', fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>
          {t('pos.payment_in_progress_on')}{' '}{claim.deviceLabel || t('pos.a_payment_phone')}{claim.userName ? ` · ${claim.userName}` : ''} {t('pos.wait_for_it_to_finish_or_1i1d')}
        </div>
      )}
      <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>{t('pos.mobile_payments')}</div>
      {phones.length === 0 && <div className="text-xs text-[var(--muted)]">{t('pos.no_approved_payment_phones_in_this_pfwl')}</div>}
      {phones.map((p) => (
        <div key={p.deviceId} className="flex items-center gap-2 text-xs py-1">
          <span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, background: p.online ? '#2E9E54' : '#B0B0B0', display: 'inline-block' }} />
          <span className="font-bold">{p.label || p.deviceId.slice(0, 8)}</span>
          <span className="text-[var(--muted)]">{p.userName || ''}{p.online ? t('pos.online_4') : t('pos.offline_5')}{p.tapToPayCapable ? t('pos.tap_to_pay') : ''}</span>
          {ticketId && !ticketPaid && !claim && (
            <button className="ml-auto" disabled={busy === p.deviceId} onClick={() => void send(p)}
              style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '4px 10px', fontSize: 12, fontWeight: 700, background: 'var(--card)', cursor: 'pointer' }}>
              {busy === p.deviceId ? t('pos.sending') : t('pos.send_to_phone')}
            </button>
          )}
        </div>
      ))}
      {note && <div role="status" className="text-xs mt-1">{note}</div>}
    </div>
  );
}
