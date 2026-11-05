// POSSellGiftCardScreen.tsx — Payments & Money → Sell Gift Card. A gift card is sold as part of a checkout: the
// receptionist picks an open ticket, chooses an amount (within the tenant's configured presets/limits) and optional
// recipient, and the card is created PENDING against that ticket. It activates only when the ticket is paid — so an
// abandoned checkout never issues stored value. Amounts are integer cents; the backend re-enforces every rule.
import { useCallback, useEffect, useState } from 'react';
import { parseDollarsToCents } from '@aipowersalon/ui';
import { posSettingsApi } from '../api/posSettingsApi';
import { posCheckoutApi } from '../api/posCheckoutApi';
import { CardScanner } from '../components/CardScanner';
import { scannerSupported } from '../lib/barcode-core';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

const GOLD = 'var(--aps-orange,#A96F22)';
const LINE = 'var(--line,#E7DBC6)';
const MUTED = 'var(--muted,#7A6C57)';
const money = (c: number) => '$' + (c / 100).toFixed(2);

type GCSettings = { enabled: boolean; posSalesEnabled: boolean; presetAmountsCents: number[]; customAmountEnabled: boolean; minAmountCents: number; maxAmountCents: number; sendToFriendEnabled: boolean };
type Ticket = { ticketId: string; ticketNumber: string; customerName: string; totalDueCents: number; status: string };

const sectionStyle: React.CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 12, padding: 16, marginBottom: 12, background: '#fff' };
const inputStyle: React.CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 10px', fontSize: 14 };

export function POSSellGiftCardScreen() {
  const [settings, setSettings] = useState<GCSettings | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [amountCents, setAmountCents] = useState<number | null>(null);
  const [customDollars, setCustomDollars] = useState('');
  const [ticketId, setTicketId] = useState('');
  const [gift, setGift] = useState(false);
  const [physical, setPhysical] = useState(false); const [physicalNumber, setPhysicalNumber] = useState(''); const [physicalPin, setPhysicalPin] = useState('');
  const [scanning, setScanning] = useState(false); const scanSupported = scannerSupported();
  const [rName, setRName] = useState(''); const [rPhone, setRPhone] = useState(''); const [rEmail, setREmail] = useState(''); const [rMsg, setRMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ reference: string; ticketNumber: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, t] = await Promise.all([posSettingsApi.getCategory('gift-card-settings'), posCheckoutApi.tickets({})]);
      setSettings(s as GCSettings);
      const rows: Ticket[] = (((t as any)?.tickets ?? t) as Ticket[] || []).filter((x) => x.status !== 'paid' && x.status !== 'completed');
      setTickets(rows);
    } catch { setErr(tx('pos.could_not_load_the_gift_card_16js')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div style={{ padding: 20, color: MUTED }}>{tx('pos.loading')}</div>;
  if (!settings) return <div style={{ padding: 20 }}><div style={{ color: '#a12d2d', fontSize: 13 }}>{err || tx('pos.no_settings')}</div></div>;

  if (!settings.enabled) return <div className="p-4 sm:p-5 max-w-[640px]"><Header /><div style={sectionStyle}>{tx('pos.gift_cards_are_turned_off_for_1j5p')}{' '}<strong>{tx('pos.gift_card_settings')}</strong> {tx('pos.to_sell_them')}</div></div>;
  if (!settings.posSalesEnabled) return <div className="p-4 sm:p-5 max-w-[640px]"><Header /><div style={sectionStyle}>{tx('pos.selling_gift_cards_at_the_pos_uy93')}{' '}<strong>{tx('pos.gift_card_settings')}</strong>.</div></div>;

  if (done) {
    return (
      <div className="p-4 sm:p-5 max-w-[640px]">
        <Header />
        <div style={{ ...sectionStyle, borderColor: GOLD }}>
          <div style={{ fontWeight: 700, color: GOLD, marginBottom: 6 }}>{tx('pos.gift_card_added_to_the_sale')}</div>
          <p style={{ fontSize: 14, margin: '0 0 4px' }}>{tx('pos.card')}{' '}<strong>{done.reference}</strong> {tx('pos.is_on_ticket')}{' '}<strong>{done.ticketNumber}</strong>.</p>
          <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>{tx('pos.it_activates_and_becomes_redeemable_once_1l6i')}</p>
          <button className="w-full sm:w-auto mt-3" style={{ border: 'none', background: GOLD, color: '#fff', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600 }} onClick={() => { setDone(null); setAmountCents(null); setCustomDollars(''); setTicketId(''); setGift(false); setPhysical(false); setPhysicalNumber(''); setPhysicalPin(''); setRName(''); setRPhone(''); setREmail(''); setRMsg(''); load(); }}>{tx('pos.sell_another')}</button>
        </div>
      </div>
    );
  }

  const min = settings.minAmountCents, max = settings.maxAmountCents;
  const setCustom = (v: string) => { setCustomDollars(v); const c = parseDollarsToCents(v); setAmountCents(c != null && c > 0 ? c : null); };
  const amountValid = amountCents != null && amountCents >= min && amountCents <= max;
  const physicalDigits = physicalNumber.replace(/\D+/g, '');
  const physicalValid = !physical || /^\d{16}$/.test(physicalDigits);
  const canSubmit = amountValid && !!ticketId && physicalValid && !busy;

  const submit = async () => {
    if (!canSubmit || amountCents == null) return;
    setBusy(true); setErr(null);
    try {
      const res: any = await posCheckoutApi.createGiftCardSale(ticketId, { amountCents, cardNumber: physical ? physicalDigits : undefined, pin: physical && physicalPin.trim() ? physicalPin.trim() : undefined, recipient: gift ? { name: rName || undefined, phone: rPhone || undefined, email: rEmail || undefined, message: rMsg || undefined } : undefined });
      const tk = tickets.find((x) => x.ticketId === ticketId);
      setDone({ reference: res.reference, ticketNumber: tk?.ticketNumber || ticketId });
    } catch (e: any) {
      const m = String(e?.message || '');
      setErr(m.includes('403') ? tx('pos.you_don_t_have_permission_to_1fsb') : (m || tx('pos.could_not_add_the_gift_card')));
    } finally { setBusy(false); }
  };

  return (
    <div className="p-4 sm:p-5 max-w-[640px]">
      <Header />
      {err && <div style={{ color: '#a12d2d', fontSize: 13, marginBottom: 12 }}>{err}</div>}

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
        <div style={{ fontWeight: 700, marginBottom: 8 }}>{tx('pos.card_type')}</div>
        <div className="flex flex-col sm:flex-row gap-2">
          <button onClick={() => setPhysical(false)} className="w-full sm:w-auto" style={{ border: `1px solid ${!physical ? GOLD : LINE}`, background: !physical ? GOLD : '#fff', color: !physical ? '#fff' : 'inherit', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{tx('pos.digital_blank')}</button>
          <button onClick={() => setPhysical(true)} className="w-full sm:w-auto" style={{ border: `1px solid ${physical ? GOLD : LINE}`, background: physical ? GOLD : '#fff', color: physical ? '#fff' : 'inherit', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{tx('pos.physical_from_stock')}</button>
        </div>
        {physical && (
          <div style={{ marginTop: 10 }}>
            <div className="flex flex-col sm:flex-row gap-2">
              <input value={physicalNumber} onChange={(e) => setPhysicalNumber(e.target.value)} placeholder={tx('pos.scan_or_enter_the_card_s_qzrk')} aria-label={tx('pos.physical_card_number')} className="w-full sm:flex-1" style={{ ...inputStyle, boxSizing: 'border-box', fontFamily: 'ui-monospace, monospace' }} />
              {scanSupported && <button type="button" onClick={() => setScanning(true)} className="w-full sm:w-auto" style={{ border: `1px solid ${LINE}`, background: '#fff', color: GOLD, borderRadius: 8, padding: '8px 14px', fontSize: 14, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>{tx('pos.scan')}</button>}
            </div>
            <input value={physicalPin} onChange={(e) => setPhysicalPin(e.target.value)} placeholder={tx('pos.pin_optional_required_to_redeem_if_iyft')} aria-label={tx('pos.physical_card_pin')} style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', marginTop: 8, fontFamily: 'ui-monospace, monospace' }} />
            <p style={{ fontSize: 12, color: MUTED, margin: '6px 0 0' }}>{physicalNumber && !physicalValid ? tx('pos.enter_the_full_16_digit_number_q4j6') : tx('pos.the_card_must_already_be_registered_1hz1')}</p>
            {scanning && <CardScanner onScan={(v) => { setPhysicalNumber(v); setScanning(false); }} onClose={() => setScanning(false)} />}
          </div>
        )}
      </section>

      <section style={sectionStyle}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>{tx('pos.recipient')}</div>
        <div className="flex flex-col sm:flex-row gap-2">
          <button onClick={() => setGift(false)} className="w-full sm:w-auto" style={{ border: `1px solid ${!gift ? GOLD : LINE}`, background: !gift ? GOLD : '#fff', color: !gift ? '#fff' : 'inherit', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{tx('pos.for_the_buyer')}</button>
          {settings.sendToFriendEnabled && <button onClick={() => setGift(true)} className="w-full sm:w-auto" style={{ border: `1px solid ${gift ? GOLD : LINE}`, background: gift ? GOLD : '#fff', color: gift ? '#fff' : 'inherit', borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{tx('pos.send_to_a_friend')}</button>}
        </div>
        {gift && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input value={rName} onChange={(e) => setRName(e.target.value)} placeholder={tx('pos.recipient_name')} aria-label={tx('pos.recipient_name')} style={inputStyle} />
            <div className="flex flex-col sm:flex-row gap-2">
              <input value={rPhone} onChange={(e) => setRPhone(e.target.value)} placeholder={tx('pos.phone_sms')} aria-label={tx('pos.recipient_phone')} className="w-full sm:flex-1" style={inputStyle} />
              <input value={rEmail} onChange={(e) => setREmail(e.target.value)} placeholder={tx('pos.email')} aria-label={tx('pos.recipient_email')} className="w-full sm:flex-1" style={inputStyle} />
            </div>
            <input value={rMsg} onChange={(e) => setRMsg(e.target.value)} placeholder={tx('pos.personal_message_optional')} aria-label={tx('pos.message')} style={inputStyle} />
          </div>
        )}
      </section>

      <section style={sectionStyle}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>{tx('pos.add_to_a_checkout')}</div>
        {tickets.length === 0 ? (
          <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>{tx('pos.no_open_checkouts_a_gift_card_1txe')}</p>
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
        {busy ? tx('pos.adding') : amountValid ? tx('pos.add_amountcents_gift_card_to_the_1mrt', { amountCents: String(money(amountCents!)) }) : tx('pos.add_gift_card_to_the_checkout')}
      </button>
      <p style={{ fontSize: 12, color: MUTED, marginTop: 10 }}>{tx('pos.the_card_is_created_pending_and_cad3')}</p>
    </div>
  );
}

function Header() {
  return (
    <div style={{ marginBottom: 12 }}>
      <h1 style={{ fontFamily: 'Playfair Display, serif', fontSize: 22, color: GOLD, margin: '0 0 4px' }}>{tx('pos.sell_gift_card')}</h1>
      <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>{tx('pos.add_a_digital_gift_card_to_1ofh')}</p>
    </div>
  );
}
