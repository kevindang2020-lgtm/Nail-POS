// POSGiftCardLookupScreen.tsx — Payments & Money → Gift Card Lookup. Reception enters the customer's 16-digit number
// (or the card code) to see the balance, status, and whether it's redeemable here BEFORE applying it at checkout
// (spec §14). The backend returns only safe fields — never the redeemable code or purchaser info — and a miss is a plain
// "not found" so a guessed number is never confirmed.
import { useState } from 'react';
import { useInlineConfirm } from '@aipowersalon/ui';
import { posCheckoutApi } from '../api/posCheckoutApi';
import { CardScanner } from '../components/CardScanner';
import { scannerSupported } from '../lib/barcode-core';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { codeLabel } from '../components/codeLabel';
import { fmtMoney } from '../i18n/format';

const GOLD = 'var(--aps-orange,#A96F22)';
const LINE = 'var(--line,#E7DBC6)';
const MUTED = 'var(--muted,#7A6C57)';
const money = (c: number) => fmtMoney(c);
const sectionStyle: React.CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 12, padding: 16, marginBottom: 12, background: '#fff' };
const inputStyle: React.CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 8, padding: '10px 12px', fontSize: 15 };

type Result = { found: boolean; reference?: string; cardNumberMasked?: string; balanceCents?: number; status?: string; redeemableHere?: boolean; viaNetwork?: boolean };
type Replaced = { ok: boolean; reason?: string; newReference?: string; newCardNumber?: string; newCardNumberMasked?: string; balanceCents?: number };
// a gift card's status code → its label, read at render (admin.giftCards.status.<code>)
const statusText = (s: string) => codeLabel('admin.giftCards.status', s);

export function POSGiftCardLookupScreen() {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [replaceBusy, setReplaceBusy] = useState(false);
  const [replaceErr, setReplaceErr] = useState<string | null>(null);
  const [replaced, setReplaced] = useState<Replaced | null>(null);

  const lookup = async (val?: string) => {
    const query = (val ?? input).trim();
    if (!query || busy) return;
    setBusy(true); setErr(null); setResult(null); setReplaced(null); setReplaceErr(null);
    try { setResult(await posCheckoutApi.giftCardLookup(query)); }
    catch (e: any) { setErr(String(e?.message || '').includes('403') ? t('pos.you_don_t_have_permission_to_1ljk') : t('pos.could_not_look_up_that_gift_xr0n')); }
    finally { setBusy(false); }
  };
  const [scanning, setScanning] = useState(false);
  const supported = scannerSupported();
  const { confirm: askConfirm, confirmUi } = useInlineConfirm();
  const onScan = (v: string) => { setInput(v); setScanning(false); lookup(v); };

  const doReplace = () => {
    if (replaceBusy) return;
    askConfirm(t('admin.giftCards.confirmReplace'), () => { void runReplace(); }, { confirmLabel: t('pos.issue_replacement') });
  };
  const runReplace = async () => {
    setReplaceBusy(true); setReplaceErr(null);
    try {
      const r = await posCheckoutApi.replaceGiftCard(input.trim());
      if (r.ok) setReplaced(r);
      else setReplaceErr(r.reason === 'no_balance' ? t('pos.this_card_has_no_balance_to_oes4') : r.reason === 'not_replaceable' ? t('pos.this_card_can_t_be_replaced') : t('pos.could_not_replace_this_card'));
    } catch (e: any) { setReplaceErr(String(e?.message || '').includes('403') ? t('pos.you_don_t_have_permission_to_1n7m') : t('pos.could_not_replace_this_card')); }
    finally { setReplaceBusy(false); }
  };

  const canLook = !!input.trim() && !busy;

  return (
    <div className="p-4 sm:p-5 max-w-[560px]">
      {confirmUi}
      {scanning && <CardScanner onScan={onScan} onClose={() => setScanning(false)} />}
      <div style={{ marginBottom: 12 }}>
        <h1 style={{ fontFamily: 'Playfair Display, serif', fontSize: 22, color: GOLD, margin: '0 0 4px' }}>{t('pos.gift_card_lookup')}</h1>
        <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>{t('pos.check_a_gift_card_u2019s_balance_1nej')}</p>
      </div>

      <section style={sectionStyle}>
        <label htmlFor="gc-lookup" style={{ fontWeight: 700, display: 'block', marginBottom: 8 }}>{t('pos.gift_card_number_or_code')}</label>
        <div className="flex flex-col sm:flex-row gap-2">
          <input id="gc-lookup" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') lookup(); }} placeholder="4827 1936 5502 8411" aria-label={t('pos.gift_card_number_or_code')} className="w-full sm:flex-1" style={{ ...inputStyle, fontFamily: 'ui-monospace, monospace' }} />
          <div className="flex gap-2">
            {supported && <button onClick={() => setScanning(true)} className="flex-1 sm:flex-none" style={{ border: `1px solid ${LINE}`, background: '#fff', color: GOLD, borderRadius: 8, padding: '10px 14px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>{t('pos.scan')}</button>}
            <button disabled={!canLook} onClick={() => lookup()} className="flex-1 sm:flex-none" style={{ border: 'none', background: canLook ? GOLD : LINE, color: canLook ? '#fff' : MUTED, borderRadius: 8, padding: '10px 18px', fontSize: 14, fontWeight: 700, cursor: canLook ? 'pointer' : 'default' }}>{busy ? t('pos.looking') : t('pos.look_up')}</button>
          </div>
        </div>
      </section>

      {err && <div style={{ color: '#a12d2d', fontSize: 13, marginBottom: 12 }}>{err}</div>}

      {result && !result.found && (
        <section style={{ ...sectionStyle, borderColor: '#a12d2d' }}>
          <div style={{ fontWeight: 700, color: '#a12d2d', marginBottom: 2 }}>{t('pos.not_found')}</div>
          <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>{t('pos.gift_card_could_not_be_found_13er')}</p>
        </section>
      )}

      {result && result.found && (
        <section style={{ ...sectionStyle, borderColor: GOLD }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
            <div style={{ fontWeight: 800, letterSpacing: 1 }}>{result.reference}</div>
            <div style={{ marginLeft: 'auto', fontSize: 24, fontWeight: 800 }}>{money(result.balanceCents || 0)}</div>
          </div>
          {result.cardNumberMasked && <div style={{ fontSize: 13, color: MUTED, fontFamily: 'ui-monospace, monospace', marginBottom: 6 }}>{result.cardNumberMasked}</div>}
          <div style={{ fontSize: 13.5, color: MUTED }}>
            {statusText(result.status || '')}{' \u00b7 '}
            {result.viaNetwork
              ? (result.redeemableHere
                  ? <span style={{ color: '#1a7a3a', fontWeight: 700 }}>{t('pos.redeemable_here_network_card')}</span>
                  : <span style={{ color: GOLD, fontWeight: 700 }}>{t('pos.network_card_issued_at_another_salon')}</span>)
              : result.redeemableHere
                ? <span style={{ color: '#1a7a3a', fontWeight: 700 }}>{t('pos.redeemable_at_this_salon')}</span>
                : <span style={{ color: '#a12d2d', fontWeight: 700 }}>{t('pos.not_redeemable_here')}</span>}
          </div>
          {result.viaNetwork
            ? <p style={{ fontSize: 12, color: MUTED, margin: '10px 0 0' }}>{t('pos.issued_at_another_salon_in_your_1db6')}</p>
            : <p style={{ fontSize: 12, color: MUTED, margin: '10px 0 0' }}>{t('pos.to_apply_it_enter_this_same_vqr8')}</p>}
          {['frozen', 'lost_stolen', 'suspended'].includes(result.status || '') && !replaced && (
            <div style={{ marginTop: 12, borderTop: `1px solid ${LINE}`, paddingTop: 12 }}>
              <p style={{ fontSize: 12.5, color: MUTED, margin: '0 0 8px' }}>{t('pos.reported_lost_or_stolen_issue_a_1o9u')}</p>
              {/* Gift Cards · 05 Safe Replacement Preview: what the replacement will do, before the confirm — read-only */}
              <div data-testid="replace-preview" style={{ fontSize: 12.5, background: '#FBF6EC', borderRadius: 8, padding: '8px 10px', margin: '0 0 8px' }}>
                <div>{t('gc.replacePreview.moves', { amount: result.balanceCents == null ? '—' : money(result.balanceCents), from: result.cardNumberMasked ?? result.reference ?? '—' })}</div>
                <div>{t('gc.replacePreview.newCard')}</div>
                <div style={{ fontWeight: 700, color: '#a12d2d' }}>{t('gc.replacePreview.irreversible')}</div>
              </div>
              <button disabled={replaceBusy} onClick={doReplace} style={{ border: 'none', background: replaceBusy ? LINE : GOLD, color: replaceBusy ? MUTED : '#fff', borderRadius: 8, padding: '9px 16px', fontSize: 13.5, fontWeight: 700, cursor: replaceBusy ? 'default' : 'pointer' }}>{replaceBusy ? t('pos.replacing') : t('pos.replace_this_card')}</button>
              {replaceErr && <div style={{ color: '#a12d2d', fontSize: 13, marginTop: 8 }}>{replaceErr}</div>}
            </div>
          )}
          {replaced && replaced.ok && (
            <div style={{ marginTop: 12, borderTop: `1px solid ${LINE}`, paddingTop: 12 }}>
              <div style={{ fontWeight: 700, color: '#1a7a3a', marginBottom: 4 }}>{t('pos.replacement_issued')}</div>
              <div style={{ fontSize: 14 }}>{t('pos.new_card')}{' '}<strong>{replaced.newReference}</strong>{' \u00b7 '}{money(replaced.balanceCents || 0)}</div>
              {replaced.newCardNumber && <div style={{ fontSize: 13, color: MUTED, marginTop: 6 }}>{t('pos.write_this_on_the_new_card')}{' '}<span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, letterSpacing: 1 }}>{replaced.newCardNumber.replace(/(.{4})/g, '$1 ').trim()}</span></div>}
              <p style={{ fontSize: 12, color: MUTED, margin: '8px 0 0' }}>{t('pos.shown_once')}{' '}{'\u2014'} {t('pos.the_old_card_is_now_retired')}</p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
