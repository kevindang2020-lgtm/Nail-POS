// POSGiftCardStockScreen.tsx — Payments & Money → Physical Card Stock (spec §21). Register batches of pre-printed
// physical gift cards (one 16-digit number per line), see stock levels with a low-stock warning, and void damaged cards.
// Numbers are stored only as a hash + last four server-side; this screen never shows a full number.
import { useEffect, useState } from 'react';
import { useInlineConfirm } from '@aipowersalon/ui';
import { posGiftCardStockApi, type StockState } from '../api/posGiftCardsApi';
import { CardScanner } from '../components/CardScanner';
import { scannerSupported } from '../lib/barcode-core';
import { t, enPlural } from '@aipowersalon/mobile-sdk/i18n';
import { codeLabel } from '../components/codeLabel';

const GOLD = 'var(--aps-orange,#A96F22)';
const LINE = 'var(--line,#E7DBC6)';
const MUTED = 'var(--muted,#7A6C57)';
const card: React.CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 12, padding: 16, marginBottom: 12, background: '#fff' };
const input: React.CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 8, padding: '10px 12px', fontSize: 14, width: '100%', boxSizing: 'border-box' };
const btn = (on = true): React.CSSProperties => ({ border: 'none', background: on ? GOLD : LINE, color: on ? '#fff' : MUTED, borderRadius: 8, padding: '9px 16px', fontSize: 14, fontWeight: 700, cursor: on ? 'pointer' : 'default' });
const stockStatus = (s: string) => codeLabel('admin.giftCards.stock', s);

export function POSGiftCardStockScreen() {
  const [state, setState] = useState<StockState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [numbers, setNumbers] = useState('');
  const [scanning, setScanning] = useState(false); const scanSupported = scannerSupported();
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => posGiftCardStockApi.state().then(setState).catch((e: any) => setErr(e?.message || t('pos.could_not_load_stock')));
  useEffect(() => { load(); }, []);

  const register = async () => {
    if (!numbers.trim() || busy) return;
    setBusy(true); setErr(null); setNote(null);
    try {
      const r = await posGiftCardStockApi.register(numbers.trim(), label.trim() || undefined);
      setNote(t('admin.giftCards.added', { count: String(r.added), plural: r.added === 1 ? '' : 's' }) + (r.duplicates ? t('pos.duplicates_already_in_stock', { duplicates: String(r.duplicates) }) : '') + (r.invalid ? t('pos.invalid_invalid', { invalid: String(r.invalid) }) : '') + '.');
      setNumbers(''); setLabel(''); await load();
    } catch (e: any) { setErr(e?.message || t('pos.could_not_register_the_cards')); }
    finally { setBusy(false); }
  };

  const { confirm: askConfirm, confirmUi } = useInlineConfirm();
  const voidCard = (id: string) => askConfirm(t('admin.giftCards.confirmRemove'), () => { void doVoidCard(id); }, { confirmLabel: t('pos.remove_card') });
  const doVoidCard = async (id: string) => {
    setErr(null);
    try { await posGiftCardStockApi.voidCard(id); await load(); } catch (e: any) { setErr(e?.message || t('pos.could_not_void_the_card')); }
  };

  const c = state?.counts;
  return (
    <div className="p-4 sm:p-5 max-w-[640px]">
      {confirmUi}
      {scanning && <CardScanner onScan={(v) => { setNumbers((n) => (n.trim() ? n.trim() + '\n' + v : v)); setScanning(false); }} onClose={() => setScanning(false)} />}
      <h1 style={{ fontFamily: 'Playfair Display, serif', fontSize: 22, color: GOLD, margin: '0 0 4px' }}>{t('pos.physical_card_stock')}</h1>
      <p style={{ fontSize: 13, color: MUTED, margin: '0 0 16px' }}>{t('pos.register_the_pre_printed_physical_gift_c391')}</p>

      {state?.lowStock && <div style={{ background: '#FDECEC', color: '#a12d2d', border: '1px solid #F3C9C9', borderRadius: 8, padding: '8px 12px', fontSize: 13, marginBottom: 12 }}>{t('pos.low_stock_only')}{' '}{c?.available ?? 0} {t('pos.card_2')}{enPlural((c?.available ?? 0) === 1 ? '' : 's')} {t('pos.available_register_more_soon')}</div>}
      {err && <div style={{ color: '#a12d2d', fontSize: 13, marginBottom: 12 }}>{err}</div>}
      {note && <div style={{ color: '#1a7a3a', fontSize: 13, marginBottom: 12 }}>{note}</div>}

      <section style={card} className="grid grid-cols-3 gap-3.5">
        {([[stockStatus('available'), c?.available ?? 0, '#1a7a3a'], [stockStatus('activated'), c?.activated ?? 0, MUTED], [stockStatus('void'), c?.void ?? 0, MUTED]] as [string, number, string][]).map(([lab, v, col]) => (
          <div key={lab} className="text-center">
            <div style={{ fontSize: 26, fontWeight: 800, color: col }}>{v}</div>
            <div style={{ fontSize: 12, color: MUTED }}>{lab}</div>
          </div>
        ))}
      </section>

      <section style={card}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>{t('pos.register_cards')}</div>
        <textarea aria-label={t('pos.card_numbers')} value={numbers} onChange={(e) => setNumbers(e.target.value)} rows={5} placeholder={'4827 1936 5502 8411\n5921 0847 3362 1180'} style={{ ...input, fontFamily: 'ui-monospace, monospace', resize: 'vertical' }} />
        <div className="flex flex-col sm:flex-row gap-2 mt-2">
          {scanSupported && <button type="button" onClick={() => setScanning(true)} className="w-full sm:w-auto" style={{ border: `1px solid ${LINE}`, background: '#fff', color: GOLD, borderRadius: 8, padding: '9px 14px', fontSize: 14, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>{t('pos.scan')}</button>}
          <input aria-label={t('pos.batch_label')} value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('pos.batch_label_optional')} className="w-full sm:flex-1" style={input} />
          <button disabled={busy || !numbers.trim()} onClick={register} className="w-full sm:w-auto" style={{ ...btn(!busy && !!numbers.trim()), whiteSpace: 'nowrap' }}>{busy ? t('pos.adding') : t('pos.add_to_stock')}</button>
        </div>
      </section>

      <section style={card}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>{t('pos.recent_cards')}</div>
        {!state ? <div style={{ color: MUTED }}>{t('pos.loading_u2026')}</div> : state.items.length === 0 ? (
          <div style={{ color: MUTED, fontSize: 13 }}>{t('pos.no_physical_cards_registered_yet')}</div>
        ) : state.items.slice(0, 50).map((it) => (
          <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderTop: `1px solid ${LINE}` }}>
            <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }}>•••• {it.last4}</span>
            {it.batchLabel && <span style={{ fontSize: 12, color: MUTED }}>{it.batchLabel}</span>}
            <span style={{ fontSize: 12, color: it.status === 'available' ? '#1a7a3a' : MUTED, marginLeft: 'auto' }}>{stockStatus(it.status)}</span>
            {it.status === 'available' && <button onClick={() => voidCard(it.id)} style={{ border: `1px solid ${LINE}`, background: 'none', color: GOLD, borderRadius: 7, padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{t('pos.void')}</button>}
          </div>
        ))}
      </section>
    </div>
  );
}
