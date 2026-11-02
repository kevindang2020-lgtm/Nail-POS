import { useCallback, useMemo, useState } from 'react';
import { parseDollarsToCents } from '@aipowersalon/ui';
import { useT } from '@aipowersalon/mobile-sdk';
import { mobileCheckoutApi, type TipPreset } from '../api/mobileCheckoutApi';
import { formatCents, computeTipCents } from '../util/format';
import { SESSION_ID, DEVICE_ID } from '../util/session';
import { usePayNav } from '../shell/nav';
import { rememberActiveAttempt } from '../util/activeAttempt';
import { ReturnToStaff } from './ReturnToStaff';

// CUSTOMER HANDOFF MODE (mandate §57–§61, §133, §185–§186): the manager hands the phone over. Only the salon name, the
// total, the tip choice and "Proceed to Payment" are shown — no queue, no history, no other customer, no navigation
// (PayLayout renders no tab bar while nav.locked; nav.back is refused). The tip is the customer's private choice
// (§185): the manager sees the final total on the Success screen, not the selection. Large targets, large type, labels
// for VoiceOver. Money stays server-calculated: the chosen tip goes to proceed-to-payment, the backend recalculates the
// total against the current checkout version and the intent is created for THAT amount (§54–§55).
type TipChoice = 'none' | 'p15' | 'p20' | 'p25' | 'custom';
const TIPS: { key: TipChoice; pct?: number }[] = [{ key: 'p15', pct: 15 }, { key: 'p20', pct: 20 }, { key: 'p25', pct: 25 }, { key: 'custom' }, { key: 'none' }];

export function HandoffScreen({ ticketId, version, subtotalCents, balanceCents, tipCents, salonName }: { ticketId: string; version: string; subtotalCents: number; balanceCents: number; tipCents: number; salonName?: string }) {
  const tr = useT();
  const nav = usePayNav();
  const [tip, setTip] = useState<TipChoice>('none');
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [cancelAsk, setCancelAsk] = useState(false);

  const customCents = parseDollarsToCents(custom) ?? 0;
  const chosenTip = tip === 'none' ? 0 : tip === 'custom' ? Math.max(0, customCents) : computeTipCents(subtotalCents, TIPS.find((x) => x.key === tip)!.pct!);
  const previewTotal = balanceCents - tipCents + chosenTip;   // the ticket's current tip is replaced by the customer's choice (preview only)
  const tipApi = useMemo<TipPreset>(() => (tip === 'custom' ? { customCents: Math.max(0, customCents) } : tip), [tip, customCents]);

  const proceed = useCallback(async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await mobileCheckoutApi.proceed(ticketId, { sessionId: SESSION_ID, deviceId: DEVICE_ID, tip: tipApi, expectedVersion: version });
      if (!res.canProceed || !res.idempotencyKey) { setMsg(res.message || tr('pay.tap.notAvailable')); return; }
      rememberActiveAttempt({ ticketId, idempotencyKey: res.idempotencyKey, amountCents: res.balanceCents, handoff: true });
      nav.openTapToPay(ticketId, res.idempotencyKey, res.balanceCents, { handoff: true });
    } catch (e: any) { setMsg(e?.message || tr('pay.tap.backendDown')); }
    finally { setBusy(false); }
  }, [ticketId, tipApi, version, nav, tr]);

  return (
    <div className="pay-handoffscreen" role="main" aria-label={tr('pay.handoff.total')}>
      <div className="pay-handoff-salon">{salonName || 'AI PowerSalon'}</div>
      <div className="pay-handoff-total">
        <div className="lbl">{tr('pay.handoff.total')}</div>
        <div className="amt" aria-live="polite">{formatCents(previewTotal)}</div>
      </div>

      <div className="pay-handoff-tips">
        <div className="q">{tr('pay.handoff.addTip')}</div>
        <div className="grid" role="group" aria-label={tr('pay.handoff.addTip')}>
          {TIPS.map((t) => (
            <button key={t.key} className={`pay-handoff-tip ${tip === t.key ? 'active' : ''}`} aria-pressed={tip === t.key} onClick={() => setTip(t.key)}>
              {t.pct ? <><span className="pct">{t.pct}%</span><span className="sub">{formatCents(computeTipCents(subtotalCents, t.pct))}</span></> : t.key === 'custom' ? tr('pay.handoff.custom') : tr('pay.handoff.noTip')}
            </button>
          ))}
        </div>
        {tip === 'custom' && (
          <div className="pay-customtip big"><span style={{ fontWeight: 800 }}>$</span>
            <input inputMode="decimal" placeholder="0.00" aria-label={tr('pay.handoff.custom')} value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^0-9.]/g, ''))} />
          </div>
        )}
      </div>

      {msg && <div className="pay-proceedresult block" role="alert">{msg}</div>}

      <div className="pay-stickyfoot">
        <button className="pay-btn big" disabled={busy} onClick={proceed}>{busy ? tr('pay.ticket.checking') : `${tr('pay.handoff.proceed')} · ${formatCents(previewTotal)}`}</button>
        <button className="pay-linkbtn" style={{ marginTop: 10 }} onClick={() => setCancelAsk(true)}>{tr('pay.handoff.cancel')}</button>
      </div>
      {/* §61: leaving handoff goes through the staff's own proof — the customer cannot swipe back into the queue */}
      {cancelAsk && <ReturnToStaff onDone={() => nav.returnToStaff()} onDismiss={() => setCancelAsk(false)} />}
    </div>
  );
}
