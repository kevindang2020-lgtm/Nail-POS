// POSReloadGiftCardScreen.tsx — Payments & Money → Reload Gift Card. Tops up an EXISTING card as part of a checkout:
// the receptionist enters the card's code, an amount (within the tenant's configured limits), and picks an open ticket.
// The reload is attached PENDING and the balance is credited only when that ticket is paid — an abandoned checkout never
// adds value. Amounts are integer cents; the backend re-enforces every rule and never exposes the card's stored value.
import { useCallback, useEffect, useState } from 'react';
import { parseDollarsToCents } from '@aipowersalon/ui';
import { posSettingsApi } from '../api/posSettingsApi';
import { posCheckoutApi } from '../api/posCheckoutApi';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

const GOLD = 'var(--aps-orange,#A96F22)';
const LINE = 'var(--line,#E7DBC6)';
const MUTED = 'var(--muted,#7A6C57)';
const money = (c: number) => '$' + (c / 100).toFixed(2);

type GCSettings = { enabled: boolean; posSalesEnabled: boolean; presetAmountsCents: number[]; customAmountEnabled: boolean; minAmountCents: number; maxAmountCents: number };
type Ticket = { ticketId: string; ticketNumber: string; customerName: string; totalDueCents: number; status: string };

const sectionStyle: React.CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 12, padding: 16, marginBottom: 12, background: '#fff' };
const inputStyle: React.CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 10px', fontSize: 14 };

export function POSReloadGiftCardScreen() {
  const [settings, setSettings] = useState<GCSettings | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [amountCents, setAmountCents] = useState<number | null>(null);
  const [customDollars, setCustomDollars] = useState('');
  const [ticketId, setTicketId] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ reference: string; ticketNumber: string; amountCents: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, t] = await Promise.all([posSettingsApi.getCategory('gift-card-settings'), posCheckoutApi.tickets({})]);
      setSettings(s as GCSettings);
      const rows: Ticket[] = (((t as any)?.tickets ?? t) as Ticket[] || []).filter((x) => x.status !== 'paid' && x.status !== 'completed');
      setTickets(rows);
    } catch { setErr(tx('pos.could_not_load_the_reload_screen')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div style={{ padding: 20, color: MUTED }}>{tx('pos.loading')}</div>;
  if (!settings) return <div style={{ padding: 20 }}><div style={{ color: '#a12d2d', fontSize: 13 }}>{err || tx('pos.no_settings')}</div></div>;
  if (!settings.enabled) return <div className="p-4 sm:p-5 max-w-[640px]"><Header /><div style={sectionStyle}>{tx('pos.gift_cards_are_turned_off_for_1j5p')}{' '}<strong>{tx('pos.gift_card_settings')}</strong> {tx('pos.to_reload_them')}</div></div>;

  if (done) {
    return (
      <div className="p-4 sm:p-5 max-w-[640px]">
        <Header />
        <div style={{ ...sectionStyle, borderColor: GOLD }}>
          <div style={{ fontWeight: 700, color: GOLD, marginBottom: 6 }}>{tx('pos.reload_added_to_the_sale')}</div>
          <p style={{ fontSize: 14, margin: '0 0 4px' }}>A {money(done.amountCents)} {tx('pos.reload_for_card')}{' '}<strong>{done.reference}</strong> {tx('pos.is_on_ticket')}{' '}<strong>{done.ticketNumber}</strong>.</p>
          <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>{tx('pos.the_balance_is_credited_once_that_1d85')}</p>
          <button className="w-full sm:w-auto mt-3" style={{ border: 'none', background: GOLD, color: '#fff', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600 }} onClick={() => { setDone(null); setCode(''); setAmountCents(null); setCustomDollars(''); setTicketId(''); load(); }}>{tx('pos.reload_another')}</button>
        </div>
      </div>
    );
  }

  const min = settings.minAmountCents, max = settings.maxAmountCents;
  const setCustom = (v: string) => { setCustomDollars(v); const c = (parseDollarsToCents(v || '0') ?? 0); setAmountCents(Number.isFinite(c) && c > 0 ? c : null); };
  const amountValid = amountCents != null && amountCents >= min && amountCents <= max;
  const canSubmit = amountValid && !!ticketId && code.trim().length > 0 && !busy;

  const submit = async () => {
    if (!canSubmit || amountCents == null) return;
    setBusy(true); setErr(null);
    try {
      const res: any = await posCheckoutApi.createGiftCardReload(ticketId, { code: code.trim(), amountCents });
      const tk = tickets.find((x) => x.ticketId === ticketId);
      setDone({ reference: res.reference, ticketNumber: tk?.ticketNumber || ticketId, amountCents });
    } catch (e: any) {
      const m = String(e?.message || '');
      setErr(m.includes('403') ? tx('pos.you_don_t_have_permission_to_743q') : (m.includes('not found') ? tx('pos.no_gift_card_matches_that_code') : (m || tx('pos.could_not_add_the_reload'))));
    } finally { setBusy(false); }
  };

  return (
    <div className="p-4 sm:p-5 max-w-[640px]">
      <Header />
      {err && <div style={{ color: '#a12d2d', fontSize: 13, marginBottom: 12 }}>{err}</div>}

      <section style={sectionStyle}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>{tx('pos.gift_card_3')}</div>
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={tx('pos.scan_or_enter_the_gift_card_sntf')} aria-label={tx('pos.gift_card_code')} style={{ ...inputStyle, width: '100%', fontFamily: 'ui-monospace, monospace' }} />
        <p style={{ fontSize: 12, color: MUTED, margin: '8px 0 0' }}>{tx('pos.enter_the_code_printed_on_the_tsme')}</p>
      </section>

      <section style={sectionStyle}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>{tx('pos.amount_2')}</div>
        <div className="flex flex-wrap gap-2">
          {settings.presetAmountsCents.map((c) => (
            <button key={c} onClick={() => { setAmountCents(c); setCustomDollars(''); }}
              className="flex-auto sm:flex-none" style={{ border: `1px solid ${amountCents === c ? GOLD : LINE}`, background: amountCents === c ? GOLD : '#fff', color: amountCents === c ? '#fff' : 'inherit', borderRadius: 8, padding: '8px 14px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              {money(c)}
            </button>
          ))}
        </div>
        {settings.customAmountEnabled && (
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: MUTED }}>{tx('pos.custom_3')}</span>
            <input value={customDollars} onChange={(e) => setCustom(e.target.value)} inputMode="decimal" aria-label={tx('pos.custom_amount')} placeholder="0.00" style={{ ...inputStyle, width: 110, textAlign: 'right' }} />
          </div>
        )}
        <p style={{ fontSize: 12, color: MUTED, margin: '8px 0 0' }}>{tx('pos.between')}{' '}{money(min)} {tx('pos.and')}{' '}{money(max)}.{amountCents != null && !amountValid ? tx('pos.that_amount_is_outside_the_allowed_waig') : ''}</p>
      </section>

      <section style={sectionStyle}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>{tx('pos.add_to_a_checkout')}</div>
        {tickets.length === 0 ? (
          <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>{tx('pos.no_open_checkouts_a_reload_is_zjql')}</p>
        ) : (
          <select value={ticketId} onChange={(e) => setTicketId(e.target.value)} aria-label={tx('pos.open_checkout')} style={{ ...inputStyle, width: '100%' }}>
            <option value="">{tx('pos.choose_an_open_checkout')}</option>
            {tickets.map((t) => <option key={t.ticketId} value={t.ticketId}>{t.ticketNumber} — {t.customerName} ({money(t.totalDueCents)} {tx('pos.due_2')}</option>)}
          </select>
        )}
      </section>

      <button disabled={!canSubmit} onClick={submit}
        className="w-full"
        style={{ border: 'none', background: canSubmit ? GOLD : LINE, color: canSubmit ? '#fff' : MUTED, borderRadius: 10, padding: '12px 18px', fontSize: 15, fontWeight: 700, cursor: canSubmit ? 'pointer' : 'default' }}>
        {busy ? tx('pos.adding') : amountValid ? tx('pos.add_amountcents_reload_to_the_checkout', { amountCents: String(money(amountCents!)) }) : tx('pos.add_reload_to_the_checkout')}
      </button>
      <p style={{ fontSize: 12, color: MUTED, marginTop: 10 }}>{tx('pos.the_reload_is_pending_and_the_1g33')}</p>
    </div>
  );
}

function Header() {
  return (
    <div style={{ marginBottom: 12 }}>
      <h1 style={{ fontFamily: 'Playfair Display, serif', fontSize: 22, color: GOLD, margin: '0 0 4px' }}>{tx('pos.reload_gift_card')}</h1>
      <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>{tx('pos.top_up_an_existing_gift_card_12rr')}</p>
    </div>
  );
}
