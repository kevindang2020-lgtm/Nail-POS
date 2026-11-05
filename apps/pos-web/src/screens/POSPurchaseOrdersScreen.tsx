// POSPurchaseOrdersScreen.tsx — Inventory → Purchase Orders. Reuses the fully-built PO backend
// (migration 117): list + status filter, create (vendor + line items), and the lifecycle actions
// approve / receive-in-full / cancel, plus an expandable line detail.
import { Fragment, useCallback, useEffect, useState } from 'react';
import { displayLocale } from '../i18n/format';
import { parseDollarsToCents } from '@aipowersalon/ui';
import { posPurchaseOrdersApi } from '../api/posPurchaseOrdersApi';
import { money, reportError } from './reportsCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';

type PO = { id: string; po_number: string; status: string; vendor_name: string | null; total_cents: number; created_at: string; expected_date: string | null; line_count: number; qty_ordered: number; qty_received: number };
type Line = { id: string; product_id: string; product_name: string; color_number: string | null; quantity_ordered: number; quantity_received: number; unit_cost_cents: number };
type Vendor = { id: string; name: string };
type Product = { id: string; name: string; color_number: string | null };
type LineDraft = { productId: string; quantity: string; unitCost: string };

const STATUSES = ['all', 'draft', 'approved', 'received', 'cancelled'];
const fmtDate = (iso?: string | null) => { if (!iso) return '—'; try { return new Date(iso).toLocaleDateString(displayLocale(), { month: 'short', day: '2-digit', year: 'numeric' }); } catch { return iso; } };
const statusChip = (status: string) => {
  const m: Record<string, { bg: string; fg: string }> = {
    draft: { bg: '#F0F0F0', fg: '#777' }, approved: { bg: '#EAF2FB', fg: '#2D6CBF' },
    received: { bg: '#E9F6EC', fg: '#2E9E54' }, cancelled: { bg: '#FDEEEE', fg: '#C0392B' },
  };
  const s = m[status] || { bg: '#F0F0F0', fg: '#666' };
  return <span style={{ padding: '2px 9px', borderRadius: 7, fontSize: 11.5, fontWeight: 700, background: s.bg, color: s.fg }}>{status[0].toUpperCase() + status.slice(1)}</span>;
};
const emptyLine = (): LineDraft => ({ productId: '', quantity: '1', unitCost: '' });

export function POSPurchaseOrdersScreen() {
  const [pos, setPos] = useState<PO[] | null>(null);
  const [filter, setFilter] = useState('all');
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [lines, setLines] = useState<Record<string, Line[]>>({});
  // create form
  const [vendorId, setVendorId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [draftLines, setDraftLines] = useState<LineDraft[]>([emptyLine()]);

  const load = useCallback(async (status: string) => {
    setError(null);
    try { const r = await posPurchaseOrdersApi.list(status === 'all' ? undefined : status); setPos((r?.purchaseOrders || []) as PO[]); }
    catch (e: any) { setError(reportError(e, t('admin.noun.purchaseOrders'))); }
  }, []);
  useEffect(() => { load(filter); }, [load, filter]);
  useEffect(() => {
    posPurchaseOrdersApi.vendors().then((r) => setVendors((r?.vendors || []) as Vendor[])).catch(() => {});
    posPurchaseOrdersApi.products().then((r) => setProducts((r?.products || []) as Product[])).catch(() => {});
  }, []);

  const toggleDetail = async (id: string) => {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    if (!lines[id]) { try { const r = await posPurchaseOrdersApi.get(id); setLines((m) => ({ ...m, [id]: (r?.lines || []) as Line[] })); } catch { /* ignore */ } }
  };

  const act = async (fn: () => Promise<any>, id: string) => {
    setBusy(id); setNote(null);
    try { await fn(); setLines((m) => { const c = { ...m }; delete c[id]; return c; }); await load(filter); }
    catch (e: any) { setNote(e?.message || t('pos.action_failed')); }
    finally { setBusy(null); }
  };
  const approve = (id: string) => act(() => posPurchaseOrdersApi.approve(id), id);
  const cancel = (id: string) => act(() => posPurchaseOrdersApi.cancel(id), id);
  const receive = async (id: string) => {
    setBusy(id); setNote(null);
    try {
      const r = await posPurchaseOrdersApi.get(id);
      const toReceive = ((r?.lines || []) as Line[]).map((l) => ({ lineId: l.id, quantity: Math.max(0, l.quantity_ordered - l.quantity_received) })).filter((x) => x.quantity > 0);
      if (toReceive.length === 0) { setNote(t('pos.nothing_left_to_receive')); setBusy(null); return; }
      await posPurchaseOrdersApi.receive(id, toReceive);
      setLines((m) => { const c = { ...m }; delete c[id]; return c; }); await load(filter);
    } catch (e: any) { setNote(e?.message || t('pos.could_not_receive_the_order')); }
    finally { setBusy(null); }
  };

  const createPO = async () => {
    setBusy('create'); setNote(null);
    const payloadLines = draftLines.filter((l) => l.productId && (parseInt(l.quantity, 10) || 0) > 0)
      .map((l) => ({ productId: l.productId, quantityOrdered: parseInt(l.quantity, 10) || 1, unitCostCents: Math.max(0, parseDollarsToCents(l.unitCost) ?? 0) }));
    if (payloadLines.length === 0) { setNote(t('pos.add_at_least_one_product_with_jqls')); setBusy(null); return; }
    try {
      await posPurchaseOrdersApi.create({ vendorId: vendorId || null, expectedDate: expectedDate || null, lines: payloadLines });
      setShowAdd(false); setVendorId(''); setExpectedDate(''); setDraftLines([emptyLine()]); await load(filter);
    } catch (e: any) { setNote(e?.message || t('pos.could_not_create_the_purchase_order')); }
    finally { setBusy(null); }
  };
  const upLine = (i: number, k: keyof LineDraft, v: string) => setDraftLines((ls) => ls.map((l, idx) => idx === i ? { ...l, [k]: v } : l));

  if (error) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  if (!pos) return <div className="work"><div className="state">{t('pos.loading_purchase_orders')}</div></div>;

  const draftTotal = draftLines.reduce((a, l) => a + Math.max(0, parseDollarsToCents(l.unitCost) ?? 0) * Math.max(0, parseInt(l.quantity || '0', 10) || 0), 0);
  const openCount = pos.filter((p) => p.status === 'draft' || p.status === 'approved').length;
  const openValue = pos.filter((p) => p.status === 'draft' || p.status === 'approved').reduce((a, p) => a + (p.total_cents || 0), 0);

  return (
    <div className="work">
      <div className="mb-6 flex flex-col xl:flex-row gap-3 justify-between items-start xl:items-center">
        <div className="vh"><h1>{t('pos.purchase_orders')}</h1><div className="sub">{t('pos.order_stock_from_vendors_and_receive_wuf8')}</div></div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-3.5">
        <div className="kpi w-full" style={{ margin: 0 }}><div className="l">{t('pos.open_orders')}</div><div className="v" style={{ color: 'var(--aps-orange)' }}>{openCount}</div></div>
        <div className="kpi w-full" style={{ margin: 0 }}><div className="l">{t('pos.open_value')}</div><div className="v" style={{ fontSize: 18 }}>{money(openValue)}</div></div>
        <div className="kpi w-full" style={{ margin: 0 }}><div className="l">{t('pos.total')}</div><div className="v">{pos.length}</div></div>
      </div>

     <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center mt-3 gap-2">
  <div 
    className="inv-tabs min-w-0 max-w-full flex-1 overflow-x-auto whitespace-nowrap flex overflow-y-hidden" 
    style={{ marginBottom: 0 }}
  >
    {STATUSES.map((st) => (
      <button 
        key={st} 
        className={`shrink-0 ${filter === st ? 'active' : ''}`} 
        onClick={() => setFilter(st)}
      >
        {st[0].toUpperCase() + st.slice(1)}
      </button>
    ))}
  </div>
        <button className={showAdd ? "btn shrink-0" : "btn primary shrink-0"} onClick={() => { setShowAdd((v) => !v); setNote(null); }}>{showAdd ? t('pos.close') : t('pos.new_po')}</button>
</div>
      {note ? <div className="err" style={{ marginTop: 10 }}>{note}</div> : null}

      {showAdd ? (
        <section className="panel" style={{ marginTop: 10 }}>
          <div className="p-h">{t('pos.new_purchase_order')}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-2">
            <label style={{ fontSize: 12.5 }}>{t('pos.vendor')}
              <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} style={{ width: '100%', padding: 8, marginTop: 4 }}>
                <option value="">{t('pos.select_vendor')}</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 12.5 }}>{t('pos.expected_date')}<input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} style={{ width: '100%', padding: 8, marginTop: 4 }} /></label>
          </div>
          {draftLines.map((l, i) => (
            <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_70px_110px_30px] gap-2 mt-2 items-center">
              <select value={l.productId} onChange={(e) => upLine(i, 'productId', e.target.value)} style={{ padding: 8 }}>
                <option value="">{t('pos.product_2')}</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.color_number ? ` (#${p.color_number})` : ''}</option>)}
              </select>
              <input type="number" min="1" placeholder={t('pos.qty')} value={l.quantity} onChange={(e) => upLine(i, 'quantity', e.target.value)} style={{ padding: 8 }} />
              <input type="number" min="0" step="0.01" placeholder={t('pos.unit')} value={l.unitCost} onChange={(e) => upLine(i, 'unitCost', e.target.value)} style={{ padding: 8 }} />
              <button className="btn ghost self-end sm:self-center" style={{ padding: '4px 8px' }} onClick={() => setDraftLines((ls) => ls.length > 1 ? ls.filter((_, idx) => idx !== i) : [emptyLine()])}>×</button>
            </div>
          ))}
          <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => setDraftLines((ls) => [...ls, emptyLine()])}>{t('pos.add_line')}</button>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
            <div style={{ fontWeight: 700 }}>{t('pos.subtotal')}{' '}{money(draftTotal)}</div>
            <button className="btn primary" disabled={busy === 'create'} onClick={createPO}>{busy === 'create' ? t('pos.creating') : t('pos.create_po')}</button>
          </div>
        </section>
      ) : null}

      <section className="panel" style={{ padding: 0, overflow: 'hidden', marginTop: 12 }}>
        {pos.length === 0 ? <div className="state" style={{ padding: 16 }}>{t('pos.no_purchase_orders')}{filter !== 'all' ? t('pos.with_status_filter', { filter: String(filter) }) : ''}.</div> : (
          <div className="overflow-x-auto">
            <div className="min-w-[800px]">
              <table className="tbl">
                <thead><tr><th>{t('pos.po')}</th><th>{t('pos.vendor')}</th><th>{t('pos.created')}</th><th>{t('pos.items')}</th><th>{t('pos.status')}</th><th style={{ textAlign: 'right' }}>{t('pos.total')}</th><th style={{ width: 240 }}></th></tr></thead>
                <tbody>{pos.map((p) => (
                  <Fragment key={p.id}>
                    <tr key={p.id}>
                      <td style={{ fontWeight: 700 }}><button onClick={() => toggleDetail(p.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, padding: 0, color: 'var(--aps-orange)' }}>{p.po_number}</button></td>
                      <td>{p.vendor_name || <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(p.created_at)}</td>
                      <td>{p.line_count} · {p.qty_received}/{p.qty_ordered} {t('pos.recv')}</td>
                      <td>{statusChip(p.status)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(p.total_cents)}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {p.status === 'draft' ? <button className="btn ghost" disabled={busy === p.id} onClick={() => approve(p.id)}>{t('pos.approve')}</button> : null}
                        {p.status === 'approved' ? <button className="btn ghost" disabled={busy === p.id} onClick={() => receive(p.id)}>{t('pos.receive')}</button> : null}
                        {p.status === 'draft' || p.status === 'approved' ? <button className="btn ghost" style={{ marginLeft: 6 }} disabled={busy === p.id} onClick={() => cancel(p.id)}>{t('pos.cancel')}</button> : null}
                      </td>
                    </tr>
                    {expanded === p.id ? (
                      <tr key={p.id + '-d'}><td colSpan={7} style={{ background: '#FBF7EF', padding: 0 }}>
                        {!lines[p.id] ? <div className="state" style={{ padding: 12 }}>{t('pos.loading_lines')}</div> : lines[p.id].length === 0 ? <div className="state" style={{ padding: 12 }}>{t('pos.no_line_items')}</div> : (
                          <table className="tbl" style={{ margin: 0 }}>
                            <thead><tr><th>{t('pos.product')}</th><th style={{ textAlign: 'right' }}>{t('pos.ordered')}</th><th style={{ textAlign: 'right' }}>{t('pos.received')}</th><th style={{ textAlign: 'right' }}>{t('pos.unit_cost')}</th></tr></thead>
                            <tbody>{lines[p.id].map((l) => (
                              <tr key={l.id}>
                                <td>{l.product_name}{l.color_number ? <span style={{ color: 'var(--muted)' }}> · #{l.color_number}</span> : null}</td>
                                <td style={{ textAlign: 'right' }}>{l.quantity_ordered}</td>
                                <td style={{ textAlign: 'right' }}>{l.quantity_received}</td>
                                <td style={{ textAlign: 'right' }}>{l.unit_cost_cents != null ? money(l.unit_cost_cents) : '—'}</td>
                              </tr>
                            ))}</tbody>
                          </table>
                        )}
                      </td></tr>
                    ) : null}
                  </Fragment>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
