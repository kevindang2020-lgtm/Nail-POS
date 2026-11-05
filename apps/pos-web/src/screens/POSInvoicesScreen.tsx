// POSInvoicesScreen.tsx — Payments → Invoices. Salon-issued customer invoices with line items and a
// draft -> sent -> paid lifecycle. Reads /pos/invoices/state; creates + transitions status.
import { useCallback, useEffect, useState } from 'react';
import { displayLocale } from '../i18n/format';
import { parseDollarsToCents } from '@aipowersalon/ui';
import { posInvoicesApi } from '../api/posInvoicesApi';
import { money, reportError } from './reportsCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';

type Invoice = { id: string; invoiceNumber: string; customerName: string | null; status: string; issueDate: string; dueDate: string | null; subtotalCents: number; taxCents: number; totalCents: number };
type State = { kpis: { total: number; draft: number; sent: number; paid: number; outstandingCents: number; paidCents: number }; invoices: Invoice[] };
type LineDraft = { description: string; quantity: string; unitPrice: string };

const fmtDate = (iso?: string | null) => { if (!iso) return '—'; try { return new Date(iso + 'T00:00:00').toLocaleDateString(displayLocale(), { month: 'short', day: '2-digit', year: 'numeric' }); } catch { return iso; } };
const statusChip = (status: string) => {
  const map: Record<string, { bg: string; fg: string }> = { draft: { bg: '#F0F0F0', fg: '#666' }, sent: { bg: '#EAF2FB', fg: '#2D6CBF' }, paid: { bg: '#E9F6EC', fg: '#2E9E54' }, void: { bg: '#FDEEEE', fg: '#C0392B' } };
  const m = map[status] || { bg: '#F0F0F0', fg: '#666' };
  return <span style={{ display: 'inline-block', padding: '2px 9px', borderRadius: 7, fontSize: 11.5, fontWeight: 700, background: m.bg, color: m.fg }}>{status[0].toUpperCase() + status.slice(1)}</span>;
};
const emptyLine = (): LineDraft => ({ description: '', quantity: '1', unitPrice: '' });

export function POSInvoicesScreen() {
  const [s, setS] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState('');
  const [taxDollars, setTaxDollars] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setS(await posInvoicesApi.state() as State); }
    catch (e: any) { setError(reportError(e, 'invoices')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const draftTotal = lines.reduce((a, l) => a + Math.max(0, parseDollarsToCents(l.unitPrice) ?? 0) * Math.max(0, parseInt(l.quantity || '0', 10) || 0), 0) + Math.max(0, parseDollarsToCents(taxDollars) ?? 0);

  const create = async () => {
    setBusy('create'); setNote(null);
    const payloadLines = lines.filter((l) => l.description.trim() && (parseInt(l.quantity, 10) || 0) > 0)
      .map((l) => ({ description: l.description.trim(), quantity: parseInt(l.quantity, 10) || 1, unitPriceCents: Math.max(0, parseDollarsToCents(l.unitPrice) ?? 0) }));
    if (payloadLines.length === 0) { setNote(t('pos.add_at_least_one_line_item_1775')); setBusy(null); return; }
    try {
      await posInvoicesApi.create({ dueDate: dueDate || null, notes: notes || null, taxCents: Math.max(0, parseDollarsToCents(taxDollars) ?? 0), lines: payloadLines });
      setShowAdd(false); setLines([emptyLine()]); setDueDate(''); setTaxDollars(''); setNotes(''); await load();
    } catch (e: any) { setNote(e?.message || t('pos.could_not_create_the_invoice')); }
    finally { setBusy(null); }
  };
  const setStatus = async (id: string, status: string) => {
    setBusy(id); setNote(null);
    try { await posInvoicesApi.setStatus(id, status); await load(); }
    catch (e: any) { setNote(e?.message || t('pos.could_not_update_the_invoice')); }
    finally { setBusy(null); }
  };
  const upLine = (i: number, k: keyof LineDraft, v: string) => setLines((ls) => ls.map((l, idx) => idx === i ? { ...l, [k]: v } : l));

  return (
    <div className="work">
      <div className="vh" style={{ marginBottom: 10 }}><h1>{t('pos.invoices')}</h1><div className="sub">{t('pos.bill_customers_and_track_what_s_1959')}</div></div>

      {loading ? <div className="state">{t('pos.loading_invoices')}</div>
        : error ? <div className="err" style={{ marginTop: 12 }}>{error}</div>
        : s ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 mb-3.5 mt-2.5">
            <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.outstanding')}</div><div className="v" style={{ color: 'var(--aps-orange)' }}>{money(s.kpis.outstandingCents)}</div><div className="d">{s.kpis.sent} {t('pos.sent_2')}</div></div>
            <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.paid_3')}</div><div className="v">{money(s.kpis.paidCents)}</div><div className="d">{s.kpis.paid} {t('pos.invoices_2')}</div></div>
            <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.drafts')}</div><div className="v">{s.kpis.draft}</div></div>
            <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.total')}</div><div className="v">{s.kpis.total}</div></div>
          </div>

          {!showAdd && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn primary" onClick={() => { setShowAdd(true); setNote(null); }}>{t('pos.new_invoice')}</button>
            </div>
          )}
          {note ? <div className="err" style={{ marginTop: 10 }}>{note}</div> : null}

          {showAdd ? (
            <section className="panel" style={{ marginTop: 10 }}>
              <div className="flex justify-between items-center mb-4 border-b border-[#E7DCC9] pb-3">
                <div className="p-h" style={{ margin: 0 }}>{t('pos.new_invoice_2')}</div>
                <button className="btn ghost" style={{ height: 32, padding: '0 12px', fontSize: 11.5 }} onClick={() => setShowAdd(false)}>{t('pos.close')}</button>
              </div>
              <div className="flex flex-col gap-3">
                {lines.map((l, i) => (
                  <div key={i} className="flex flex-wrap sm:flex-nowrap gap-3 items-end">
                    <label className="lf !mb-0 w-full sm:flex-1 min-w-[200px]">
                      <span>{t('pos.description')}</span>
                      <input placeholder={t('pos.item_description')} value={l.description} onChange={(e) => upLine(i, 'description', e.target.value)} />
                    </label>
                    <div className="flex flex-1 sm:flex-none gap-3 items-end">
                      <label className="lf !mb-0">
                        <span>{t('pos.qty')}</span>
                        <input type="number" min="1" placeholder="1" className="w-[70px]" value={l.quantity} onChange={(e) => upLine(i, 'quantity', e.target.value)} />
                      </label>
                      <label className="lf !mb-0">
                        <span>{t('pos.unit')}</span>
                        <input type="number" min="0" step="0.01" placeholder="0.00" className="w-[110px]" value={l.unitPrice} onChange={(e) => upLine(i, 'unitPrice', e.target.value)} />
                      </label>
                      <button className="btn ghost shrink-0" style={{ height: 38, padding: '0 12px', marginBottom: 2 }} onClick={() => setLines((ls) => ls.length > 1 ? ls.filter((_, idx) => idx !== i) : [emptyLine()])}>×</button>
                    </div>
                  </div>
                ))}
              </div>
              <button className="btn ghost" style={{ marginTop: 12, height: 32, fontSize: 12, padding: '0 12px' }} onClick={() => setLines((ls) => [...ls, emptyLine()])}>{t('pos.add_line')}</button>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 mt-6 border-t border-[#E7DCC9] pt-4">
                <label className="lf !mb-0"><span>{t('pos.due_date')}</span><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
                <label className="lf !mb-0"><span>{t('pos.tax_3')}</span><input type="number" min="0" step="0.01" value={taxDollars} onChange={(e) => setTaxDollars(e.target.value)} placeholder="0.00" /></label>
                <label className="lf !mb-0 sm:col-span-2"><span>{t('pos.notes')}</span><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('pos.optional_notes_for_the_customer')} /></label>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
                <div style={{ fontWeight: 800, fontSize: 16 }}>{t('pos.total_2')}{' '}{money(draftTotal)}</div>
                <button className="btn primary" disabled={busy === 'create'} onClick={create}>{busy === 'create' ? t('pos.creating') : t('pos.create_invoice')}</button>
              </div>
            </section>
          ) : null}

          <section className="panel" style={{ padding: 0, overflow: 'hidden', marginTop: 12 }}>
            <div className="p-h" style={{ padding: '14px 14px 0' }}>{t('pos.all_invoices')}</div>
            {s.invoices.length === 0 ? <div className="state" style={{ padding: 16 }}>{t('pos.no_invoices_yet')}</div> : (
              <div className="overflow-x-auto">
                <div className="min-w-[800px]">
                  <table className="tbl">
                    <thead><tr><th>{t('pos.number')}</th><th>{t('pos.customer')}</th><th>{t('pos.issued')}</th><th>{t('pos.due')}</th><th>{t('pos.status')}</th><th style={{ textAlign: 'right' }}>{t('pos.total')}</th><th style={{ width: 190 }}></th></tr></thead>
                    <tbody>{s.invoices.map((inv) => (
                      <tr key={inv.id}>
                        <td style={{ fontWeight: 700 }}>{inv.invoiceNumber}</td>
                        <td>{inv.customerName || <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(inv.issueDate)}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(inv.dueDate)}</td>
                        <td>{statusChip(inv.status)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(inv.totalCents)}</td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {inv.status === 'draft' ? <button className="btn ghost" disabled={busy === inv.id} onClick={() => setStatus(inv.id, 'sent')}>{t('pos.send')}</button> : null}
                          {inv.status === 'sent' ? <button className="btn ghost" disabled={busy === inv.id} onClick={() => setStatus(inv.id, 'paid')}>{t('pos.mark_paid')}</button> : null}
                          {inv.status !== 'paid' && inv.status !== 'void' ? <button className="btn ghost" style={{ marginLeft: 6 }} disabled={busy === inv.id} onClick={() => setStatus(inv.id, 'void')}>{t('pos.void')}</button> : null}
                        </td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        </>
      ) : <div className="state">{t('pos.no_data')}</div>}
    </div>
  );
}
