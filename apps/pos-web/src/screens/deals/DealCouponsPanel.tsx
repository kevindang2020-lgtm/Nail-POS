// DealCouponsPanel.tsx — BUILD_PLAN Phase 5: a coupon's codes. Generate single-use (or shared) codes in bulk — they are
// shown ONCE, here, to copy or download; the server keeps only a hash and the last four characters. Revoke a code that
// leaked. Wallet coupons (issued to named customers) show who holds them.
import { useCallback, useEffect, useState } from 'react';
import { posDealsApi } from '../../api/posDealsApi';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { humanizeCode } from '../../i18n/status-label';
const couponStatusLabel = (s: string) => { const key = `growth.deals.coupon.${s}`; const v = t(key); return v === key ? humanizeCode(s) : v; };

type Code = { id: string; hint: string; status: string; singleUse: boolean; maxUses: number | null; useCount: number; customerName: string | null; expiresAt: string | null };

export function DealCouponsPanel({ dealId, title, onClose }: { dealId: string; title: string; onClose: () => void }) {
  const [codes, setCodes] = useState<Code[] | null>(null);
  const [qty, setQty] = useState('50');
  const [prefix, setPrefix] = useState('');
  const [singleUse, setSingleUse] = useState(true);
  const [expires, setExpires] = useState('');
  const [fresh, setFresh] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => { try { setCodes(await posDealsApi.coupons(dealId) as Code[]); } catch (e: any) { setError(e?.message || t('pos.could_not_load_codes')); } }, [dealId]);
  useEffect(() => { void load(); }, [load]);

  const generate = async () => {
    setBusy(true); setError(null); setFresh(null);
    try {
      const r: any = await posDealsApi.generateCodes(dealId, { quantity: Number(qty), prefix: prefix.trim() || null, singleUse, expiresAt: expires ? new Date(expires).toISOString() : null });
      setFresh(r.codes); await load();
    } catch (e: any) { setError(e?.message || t('pos.could_not_generate_codes')); }
    finally { setBusy(false); }
  };
  const download = () => {
    if (!fresh) return;
    const url = URL.createObjectURL(new Blob(['code\n' + fresh.join('\n') + '\n'], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `coupon-codes-${dealId.slice(0, 8)}.csv`; a.click(); URL.revokeObjectURL(url);
  };
  const revoke = async (id: string) => {
    if (reason.trim().length < 4) { setError(t('pos.say_why_the_code_is_being_9l4p')); return; }
    try { await posDealsApi.revokeCode(dealId, id, reason.trim()); setRevoking(null); setReason(''); await load(); } catch (e: any) { setError(e?.message || t('pos.could_not_cancel_the_code')); }
  };

  return (
    <section className="panel" data-testid="coupon-codes" style={{ marginBottom: 16 }}>
      <div className="flex justify-between items-center"><div className="p-h">{t('pos.codes_2')}{' '}{title}</div><button className="btn ghost" onClick={onClose}>{t('pos.close')}</button></div>
      <div className="flex flex-wrap gap-3 items-end mt-2">
        <div className="lf"><label>{t('pos.how_many')}</label><input aria-label={t('pos.how_many_codes')} value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric" style={{ width: 80 }} /></div>
        <div className="lf"><label>{t('pos.prefix')}</label><input aria-label={t('pos.code_prefix')} value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase())} placeholder="VIP" style={{ width: 90 }} /></div>
        <label style={{ fontSize: 13 }}><input type="checkbox" aria-label={t('pos.single_use')} checked={singleUse} onChange={(e) => setSingleUse(e.target.checked)} /> {t('pos.single_use')}</label>
        <div className="lf"><label>{t('pos.expires')}</label><input aria-label={t('pos.codes_expire')} type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></div>
        <button className="btn primary" disabled={busy} onClick={() => void generate()}>{busy ? t('pos.generating') : t('pos.generate_codes')}</button>
      </div>
      {fresh && (
        <div data-testid="fresh-codes" style={{ marginTop: 10, padding: 10, background: '#FFF8E6', borderRadius: 8 }}>
          <strong>{t('pos.copy_or_download_these_now_they_1he3')}</strong>
          <pre style={{ maxHeight: 160, overflow: 'auto', fontSize: 12 }}>{fresh.join('\n')}</pre>
          <button className="btn" onClick={download}>{t('pos.download_csv')}</button>
        </div>
      )}
      {error && <div role="alert" style={{ color: '#B4453C', marginTop: 6, fontSize: 13 }}>{error}</div>}
      <table style={{ width: '100%', marginTop: 10, fontSize: 12 }}>
        <thead><tr><th align="left">{t('pos.code')}</th><th align="left">{t('pos.status')}</th><th align="left">{t('pos.uses')}</th><th align="left">{t('pos.customer')}</th><th align="left">{t('pos.expires')}</th><th /></tr></thead>
        <tbody>
          {(codes ?? []).map((c) => (
            <tr key={c.id}>
              <td>••••{c.hint}</td><td>{couponStatusLabel(c.status)}</td><td>{c.useCount}{c.singleUse ? ' / 1' : c.maxUses ? ` / ${c.maxUses}` : ''}</td><td>{c.customerName ?? '—'}</td><td>{c.expiresAt ? c.expiresAt.slice(0, 10) : '—'}</td>
              <td>{c.status === 'active' && (revoking === c.id
                ? <span className="flex gap-1"><input aria-label={t('pos.why_cancel_this_code')} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('pos.reason_2')} /><button className="btn" onClick={() => void revoke(c.id)}>{t('pos.cancel_code')}</button></span>
                : <button className="btn ghost" onClick={() => { setRevoking(c.id); setReason(''); }}>{t('pos.cancel_2')}</button>)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {codes && codes.length === 0 && <div className="sub" style={{ fontSize: 13 }}>{t('pos.no_codes_yet')}</div>}
    </section>
  );
}
