// SkipLineDrawer.tsx — POS front-desk overlay for Skip-the-Line payments. A fixed slide-over (does not disturb the
// desktop-fit Checkout grid) that polls /pos/checkout/skip-line/state and lets staff resend / cancel / move-to-front-desk.
import { useCallback, useEffect, useState } from 'react';
import { posSkipLineApi, type SkipLineStateItem } from '../api/posSkipLineApi';
import { useRealtime } from '../realtime/useRealtime';
import { t } from '@aipowersalon/mobile-sdk/i18n';

import { statusLabel } from '../i18n/status-label';
const money = (c: number) => '$' + ((c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const STATUS_BG: Record<string, string> = { sent_to_customer: '#E8F0FE', processing: '#E8F0FE', requires_action: '#FFF4E0', cash_pending_tech_confirmation: '#FFF4E0', cash_issue_needs_front_desk: '#FDE7E7', failed: '#FDE7E7' };
const STATUS_FG: Record<string, string> = { sent_to_customer: '#1A56DB', processing: '#1A56DB', requires_action: '#9A6700', cash_pending_tech_confirmation: '#9A6700', cash_issue_needs_front_desk: '#B42318', failed: '#B42318' };

export function SkipLineDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [items, setItems] = useState<SkipLineStateItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => { try { const r = await posSkipLineApi.state(); setItems(r.items || []); setError(null); } catch (e: any) { setError(e?.message || t('pos.could_not_load_skip_the_line_nj0r')); } }, []);
  useEffect(() => { if (open) void load(); }, [open, load]);
  // Smooth Refresh spec §95: no widget owns a setInterval. While open, the drawer rides the sync layer — skip-line
  // payment events (routed to the 'checkout' screen) refetch at once; a 5 s safety sync covers missed ones; closed = off.
  useRealtime('checkout', () => { if (open) void load(); }, { intervalMs: open ? 5_000 : 0 });

  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key); setNote(null);
    try { await fn(); setNote(ok); await load(); } catch (e: any) { setNote(e?.message || t('pos.action_failed')); } finally { setBusy(null); }
  };

  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={t('pos.skip_the_line_payments')} style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(30,24,16,0.38)' }} />
      <aside style={{ position: 'relative', width: 'min(460px, 92vw)', height: '100vh', background: '#FBF6EC', boxShadow: '-12px 0 40px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 18px', borderBottom: '1px solid rgba(169,111,34,0.2)' }}>
          <div style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: 19, fontWeight: 700, flex: 1 }}>{t('pos.skip_the_line')}</div>
          <button className="btn ghost" onClick={() => load()} disabled={busy !== null}>{t('pos.refresh')}</button>
          <button className="btn ghost" onClick={onClose} aria-label={t('pos.close')}>✕</button>
        </div>
        <div style={{ padding: '12px 18px', overflow: 'auto', flex: 1 }}>
          {note ? <div style={{ marginBottom: 10, padding: '8px 10px', borderRadius: 8, background: '#EAF7EE', color: '#0E7A43', fontSize: 13 }} role="status">{note}</div> : null}
          {error ? <div style={{ padding: '10px 12px', borderRadius: 8, background: '#FDE7E7', color: '#B42318' }} role="alert">{error}</div>
            : !items ? <div className="muted">{t('pos.loading')}</div>
            : items.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 12px', color: '#8A7A60' }}>
                <div style={{ fontSize: 30 }} aria-hidden>📲</div>
                <div style={{ marginTop: 8, fontWeight: 700 }}>{t('pos.no_app_or_cash_payments_in_1pjo')}</div>
                <div style={{ marginTop: 4, fontSize: 13 }}>{t('pos.sent_payment_prompts_and_pending_cash_w70g')}</div>
              </div>
            ) : items.map((it) => (
              <div key={it.intentId} style={{ background: '#fff', border: '1px solid rgba(169,111,34,0.18)', borderRadius: 12, padding: 14, marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <div style={{ fontWeight: 800 }}>{it.customerName || t('pos.customer')}</div>
                  <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 9px', borderRadius: 999, background: STATUS_BG[it.status] || '#EEE', color: STATUS_FG[it.status] || '#555' }}>{statusLabel('paymentIntent', it.status)}</span>
                </div>
                <div style={{ fontSize: 12.5, color: '#8A7A60', marginTop: 3 }}>{it.ticketNumber} · {statusLabel('paymentMethod', it.method)} · {money(it.amountCents)}</div>
                {it.unsettled ? <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: '#FFF4E0', color: '#9A6700', fontSize: 12.5 }} role="status">{t('pos.skip_line_unsettled_note')}</div> : null}
                <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                  {it.unsettled ? <button className="btn" style={{ fontSize: 12 }} disabled={busy === it.ticketId + 'verify'} onClick={() => act(it.ticketId + 'verify', async () => {
                    const r = await posSkipLineApi.verifyAppPayment(it.ticketId);
                    const o = r.results[0];
                    if (o && o.outcome !== 'approved' && o.outcome !== 'declined' && o.outcome !== 'released') throw new Error(o.reason || t('pos.skip_line_verify_pending'));
                  }, t('pos.skip_line_verify_done'))}>{t('pos.verify_payment')}</button> : null}
                  <button className="btn ghost" style={{ fontSize: 12 }} disabled={busy === it.ticketId + 'resend' || !!it.unsettled} onClick={() => act(it.ticketId + 'resend', () => posSkipLineApi.sendAppPayment(it.ticketId), 'Payment prompt re-sent.')}>{t('pos.resend')}</button>
                  <button className="btn ghost" style={{ fontSize: 12 }} disabled={busy === it.ticketId + 'cancel' || !!it.unsettled} onClick={() => act(it.ticketId + 'cancel', () => posSkipLineApi.cancelAppPayment(it.ticketId), 'App payment cancelled.')}>{t('pos.cancel')}</button>
                  <button className="btn ghost" style={{ fontSize: 12 }} disabled={busy === it.ticketId + 'fd' || !!it.unsettled} onClick={() => act(it.ticketId + 'fd', () => posSkipLineApi.moveToFrontDesk(it.ticketId), 'Moved to front-desk checkout.')}>{t('pos.front_desk')}</button>
                </div>
              </div>
            ))}
        </div>
      </aside>
    </div>
  );
}
