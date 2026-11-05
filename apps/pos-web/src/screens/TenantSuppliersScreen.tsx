import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { inventoryApi, type InvVendor, type InvBrand, type PurchaseOrderSummary } from '../api/inventoryApi';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { viIncludes } from '@aipowersalon/api-contracts';
import { ImeSafeInput } from '../components/ImeSafeInput';

import { statusLabel } from '../i18n/status-label';
// Suppliers — the salon-tenant supplier directory, on the REAL inventory vendors + purchase-orders backend
// (/tenant/inventory/vendors, /tenant/inventory/purchase-orders, /tenant/inventory/brands). Supports the supplier
// directory with create/edit/archive, contact details, a per-supplier purchase-order view, and a purchase-orders
// list. Everything reads live data and shows honest empty states; money is integer cents. Full PO authoring/receiving
// lives in the Inventory module (linked), since that's where stock movements are recorded.
const money = (c?: number | null) => (c == null ? '—' : '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const inputStyle: React.CSSProperties = { height: 34, border: '1px solid var(--line)', borderRadius: 9, padding: '0 10px', background: '#FFFDF8', fontFamily: 'inherit', fontSize: 12.5, color: 'var(--text)' };
const OPEN_PO = new Set(['pending', 'approved', 'in_progress', 'submitted', 'ordered', 'partial']);
const poStatusClass = (s: string) => (s === 'received' || s === 'closed' ? 'ok' : s === 'cancelled' ? '' : 'warn');

type FormState = { name: string; contactName: string; phone: string; email: string; website: string; accountNumber: string; paymentTerms: string; leadTimeDays: string };
const emptyForm: FormState = { name: '', contactName: '', phone: '', email: '', website: '', accountNumber: '', paymentTerms: '', leadTimeDays: '' };
const toForm = (v: InvVendor): FormState => ({ name: v.name || '', contactName: v.contact_name || '', phone: v.phone || '', email: v.email || '', website: v.website || '', accountNumber: v.account_number || '', paymentTerms: v.payment_terms || '', leadTimeDays: v.lead_time_days != null ? String(v.lead_time_days) : '' });
const toPayload = (f: FormState) => ({ name: f.name.trim(), contactName: f.contactName.trim() || null, phone: f.phone.trim() || null, email: f.email.trim() || null, website: f.website.trim() || null, accountNumber: f.accountNumber.trim() || null, paymentTerms: f.paymentTerms.trim() || null, leadTimeDays: f.leadTimeDays.trim() === '' ? null : f.leadTimeDays.trim() });

const SupplierField = ({ label, value, onChange, ph, mode }: { label: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; ph?: string; mode?: 'numeric' | 'email' }) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
    <span className="s" style={{ color: '#8A7A66' }}>{label}</span>
    <input value={value} onChange={onChange} placeholder={ph || label} inputMode={mode === 'numeric' ? 'numeric' : undefined} type={mode === 'email' ? 'email' : 'text'} style={inputStyle} />
  </label>
);

export function TenantSuppliersScreen() {
  const nav = useNavigate();
  const [vendors, setVendors] = useState<InvVendor[]>([]);
  const [pos, setPos] = useState<PurchaseOrderSummary[]>([]);
  const [brands, setBrands] = useState<InvBrand[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [poStatus, setPoStatus] = useState('');
  const [selId, setSelId] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);

  const reload = useCallback(() => {
    setError(null);
    Promise.all([
      inventoryApi.vendors().then((d) => setVendors(d?.vendors || [])),
      inventoryApi.purchaseOrders().then((d) => setPos(d?.purchaseOrders || [])).catch(() => setPos([])),
      inventoryApi.brands().then((d) => setBrands(d?.brands || [])).catch(() => setBrands([])),
    ]).catch((e: any) => setError(e?.message || t('pos.failed_to_load_suppliers'))).finally(() => setLoaded(true));
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const openCreate = () => { setCreateOpen(true); setEditId(null); setForm(emptyForm); setNote(null); };
  const openEdit = (v: InvVendor) => { setEditId(v.id); setCreateOpen(false); setForm(toForm(v)); setNote(null); };

  const create = async () => {
    if (!form.name.trim()) { setNote(t('pos.supplier_name_is_required')); return; }
    setNote(null); setBusy('create');
    try { await inventoryApi.createVendor(toPayload(form)); setCreateOpen(false); setForm(emptyForm); reload(); }
    catch (e: any) { setNote(e?.message || t('pos.create_failed')); }
    finally { setBusy(null); }
  };
  const saveEdit = async (id: string) => {
    if (!form.name.trim()) { setNote(t('pos.supplier_name_is_required')); return; }
    setNote(null); setBusy('edit');
    try { await inventoryApi.updateVendor(id, toPayload(form)); setEditId(null); reload(); }
    catch (e: any) { setNote(e?.message || t('pos.save_failed')); }
    finally { setBusy(null); }
  };
  const archive = async (id: string) => {
    setNote(null); setBusy('arch' + id);
    try { await inventoryApi.archiveVendor(id); if (selId === id) setSelId(null); if (editId === id) setEditId(null); reload(); }
    catch (e: any) { setNote(e?.message || t('pos.archive_failed')); }
    finally { setBusy(null); }
  };

  if (error) return <div className="work"><div className="err">{error}</div></div>;
  if (!loaded) return <div className="work"><div className="state">{t('pos.loading_suppliers')}</div></div>;

  const q = search.trim();
  // accent-insensitive (WP-E foldVi): "nguyen" finds "Nguyễn"
  const shown = q ? vendors.filter((v) => viIncludes(v.name, q) || viIncludes(v.contact_name, q) || viIncludes(v.email, q)) : vendors;
  const openPos = pos.filter((p) => OPEN_PO.has(p.status));
  const openValue = openPos.reduce((a, p) => a + (p.total_cents || 0), 0);
  const sel = vendors.find((v) => v.id === selId) || null;
  const selPos = sel ? pos.filter((p) => (p.vendor_name || '').toLowerCase() === sel.name.toLowerCase()) : [];
  const poShown = poStatus ? pos.filter((p) => p.status === poStatus) : pos;
  const poStatuses = [...new Set(pos.map((p) => p.status))];

  return (
    <div className="work">
      <div className="vh flex flex-col sm:flex-row gap-3 justify-between items-start sm:items-center">
        <div><h1>{t('pos.suppliers')}</h1><div className="sub">{t('pos.supplier_directory_contacts_purchase_orders_and_mls9')}</div></div>
        <button className="btn sm:ml-auto w-full sm:w-auto" onClick={openCreate}>{t('pos.add_supplier')}</button>
      </div>

      {note ? <div className="err" style={{ marginBottom: 12 }}>{note}</div> : null}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2.5 mb-3.5 mt-2.5">
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.total_suppliers')}</div><div className="v">{vendors.length}</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.active_pos')}</div><div className="v" style={openPos.length ? { color: '#A96F22' } : undefined}>{openPos.length}</div><div className="s" style={{ color: '#8A7A66', marginTop: 2 }}>{pos.length} {t('pos.total_3')}</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.open_po_value')}</div><div className="v">{openValue > 0 ? money(openValue) : '—'}</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.brands')}</div><div className="v">{brands.length || '—'}</div><div className="s" style={{ color: '#8A7A66', marginTop: 2 }}>{t('pos.in_catalog')}</div></div>
      </div>

      {(createOpen || editId) ? (
        <section className="panel">
          <h2>{editId ? t('pos.edit_supplier') : t('pos.add_supplier_2')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
            <SupplierField label={t('pos.supplier_name')} value={form.name} onChange={set('name')} />
            <SupplierField label={t('pos.contact_name')} value={form.contactName} onChange={set('contactName')} />
            <SupplierField label={t('pos.phone')} value={form.phone} onChange={set('phone')} />
            <SupplierField label={t('pos.email')} value={form.email} onChange={set('email')} mode="email" />
            <SupplierField label={t('pos.website')} value={form.website} onChange={set('website')} />
            <SupplierField label={t('pos.account_number')} value={form.accountNumber} onChange={set('accountNumber')} />
            <SupplierField label={t('pos.payment_terms')} value={form.paymentTerms} onChange={set('paymentTerms')} ph={t('pos.e_g_net_30')} />
            <SupplierField label={t('pos.lead_time_days')} value={form.leadTimeDays} onChange={set('leadTimeDays')} mode="numeric" />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            {editId
              ? <button className="btn" disabled={busy === 'edit'} onClick={() => saveEdit(editId)}>{busy === 'edit' ? t('pos.saving_2') : t('pos.save_changes')}</button>
              : <button className="btn" disabled={busy === 'create'} onClick={create}>{busy === 'create' ? t('pos.creating') : t('pos.create_supplier')}</button>}
            <button className="btn ghost" onClick={() => { setCreateOpen(false); setEditId(null); setNote(null); }}>{t('pos.cancel')}</button>
          </div>
        </section>
      ) : null}

      <div className="grid grid-cols-1 xl:grid-cols-[1.3fr_1fr] gap-3 mt-3">
        <section className="panel" style={{ marginBottom: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><h2 style={{ margin: 0 }}>{t('pos.supplier_directory')}</h2><span className="s" style={{ color: '#8A7A66' }}>· {vendors.length}</span></div>
          <ImeSafeInput placeholder={t('pos.search_name_contact_or_email')} value={search} onValue={setSearch} style={{ width: '100%', height: 34, border: '1px solid var(--line)', borderRadius: 10, padding: '0 12px', background: '#FFFDF8', fontFamily: 'inherit', fontSize: 13, margin: '10px 0' }} />
          {vendors.length === 0 ? (
            <div className="muted">{t('pos.no_suppliers_yet')}{' '}<button className="btn ghost" style={{ padding: '3px 9px', fontSize: 12, marginLeft: 6 }} onClick={openCreate}>{t('pos.add_your_first_supplier')}</button></div>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[700px]">
                <div className="row" style={{ fontSize: 10.5, color: '#8A7A66', fontWeight: 700, textTransform: 'uppercase' }}><div style={{ flex: 1 }}>{t('pos.supplier')}</div><div style={{ width: 120 }}>{t('pos.contact')}</div><div style={{ width: 110 }}>{t('pos.terms')}</div><div style={{ width: 56 }}>{t('pos.lead')}</div><div style={{ width: 110 }} /></div>
                <div className="list" style={{ maxHeight: 'calc(100vh - 360px)', minHeight: 160 }}>
                  {shown.length === 0 ? <div className="muted">{t('pos.no_suppliers_match')}</div> : null}
                  {shown.map((v) => (
                    <div className="row" key={v.id} style={{ cursor: 'pointer', background: selId === v.id ? '#FBF4E8' : undefined }} onClick={() => setSelId(v.id)}>
                      <div style={{ flex: 1, minWidth: 120 }}><div className="t">{v.name}</div><div className="s">{v.email || v.website || '—'}</div></div>
                      <div className="s" style={{ width: 120 }}>{v.contact_name || '—'}{v.phone ? <div>{v.phone}</div> : null}</div>
                      <div className="s" style={{ width: 110 }}>{v.payment_terms || '—'}</div>
                      <div className="s" style={{ width: 56 }}>{v.lead_time_days != null ? `${v.lead_time_days}d` : '—'}</div>
                      <div style={{ width: 110, display: 'flex', gap: 4 }}>
                        <button className="btn ghost" style={{ padding: '3px 6px', fontSize: 12 }} onClick={(e) => { e.stopPropagation(); openEdit(v); }}>{t('pos.edit')}</button>
                        <button className="btn ghost" style={{ padding: '3px 6px', fontSize: 12 }} disabled={busy === 'arch' + v.id} onClick={(e) => { e.stopPropagation(); archive(v.id); }}>{busy === 'arch' + v.id ? '…' : t('pos.archive')}</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="panel" style={{ marginBottom: 0 }}>
          <h2>{t('pos.supplier_detail')}</h2>
          {!sel ? <div className="muted" style={{ marginTop: 10 }}>{t('pos.select_a_supplier_to_see_contact_1tly')}</div> : (
            <div style={{ marginTop: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div className="t" style={{ fontSize: 15, fontWeight: 800 }}>{sel.name}</div><button className="btn ghost" style={{ marginLeft: 'auto', padding: '3px 9px', fontSize: 12 }} onClick={() => openEdit(sel)}>{t('pos.edit')}</button></div>
              <div className="list" style={{ marginTop: 6 }}>
                <div className="row"><div className="t" style={{ flex: 1 }}>{t('pos.contact')}</div><div style={{ marginLeft: 'auto' }}>{sel.contact_name || '—'}</div></div>
                <div className="row"><div className="t" style={{ flex: 1 }}>{t('pos.phone')}</div><div style={{ marginLeft: 'auto' }}>{sel.phone || '—'}</div></div>
                <div className="row"><div className="t" style={{ flex: 1 }}>{t('pos.email')}</div><div style={{ marginLeft: 'auto' }}>{sel.email || '—'}</div></div>
                <div className="row"><div className="t" style={{ flex: 1 }}>{t('pos.website')}</div><div style={{ marginLeft: 'auto' }}>{sel.website || '—'}</div></div>
                <div className="row"><div className="t" style={{ flex: 1 }}>{t('pos.account_2')}</div><div style={{ marginLeft: 'auto' }}>{sel.account_number || '—'}</div></div>
                <div className="row"><div className="t" style={{ flex: 1 }}>{t('pos.payment_terms')}</div><div style={{ marginLeft: 'auto' }}>{sel.payment_terms || '—'}</div></div>
                <div className="row"><div className="t" style={{ flex: 1 }}>{t('pos.lead_time')}</div><div style={{ marginLeft: 'auto' }}>{sel.lead_time_days != null ? t('pos.lead_time_days_days', { lead_time_days: String(sel.lead_time_days) }) : '—'}</div></div>
              </div>
              <div className="s" style={{ fontWeight: 700, margin: '10px 0 4px' }}>{t('pos.purchase_orders')}{' '}<span style={{ color: '#8A7A66' }}>· {selPos.length}</span></div>
              {selPos.length === 0 ? <div className="muted">{t('pos.no_purchase_orders_for_this_supplier')}</div> : (
                <div className="overflow-x-auto">
                  <div className="min-w-[400px]">
                    <div className="list">
                      {selPos.map((p) => (
                        <div className="row" key={p.id}><div className="t" style={{ flex: 1 }}>{p.po_number || p.id.slice(0, 8)}</div><span className="s" style={{ marginRight: 8 }}>{p.expected_date || '—'}</span><span className="r" style={{ marginRight: 8 }}>{money(p.total_cents)}</span><span className={'pill ' + poStatusClass(p.status)}>{statusLabel('purchaseOrder', p.status)}</span></div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      <section className="panel" style={{ marginTop: 12 }}>
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2 style={{ margin: 0 }}>{t('pos.purchase_orders')}</h2><span className="s" style={{ color: '#8A7A66' }}>· {pos.length}</span>
          </div>
          <select value={poStatus} onChange={(e) => setPoStatus(e.target.value)} className="w-full sm:w-auto sm:ml-auto" style={{ ...inputStyle, height: 32 }}>
            <option value="">{t('pos.all_statuses')}</option>
            {poStatuses.map((x) => <option key={x} value={x}>{statusLabel('purchaseOrder', x)}</option>)}
          </select>
          <button className="btn ghost w-full sm:w-auto" onClick={() => nav('/tenant/inventory')}>{t('pos.manage_in_inventory')}</button>
        </div>
        {pos.length === 0 ? (
          <div className="muted" style={{ marginTop: 10 }}>{t('pos.no_purchase_orders_yet_create_and_1db3')}</div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[700px]">
              <div className="list" style={{ marginTop: 8, maxHeight: 260 }}>
                <div className="row" style={{ fontSize: 10.5, color: '#8A7A66', fontWeight: 700, textTransform: 'uppercase' }}><div style={{ width: 110 }}>{t('pos.po')}</div><div style={{ flex: 1 }}>{t('pos.supplier')}</div><div style={{ width: 100 }}>{t('pos.expected')}</div><div style={{ width: 80, textAlign: 'right' }}>{t('pos.total')}</div><div style={{ width: 80 }}>{t('pos.status')}</div></div>
                {poShown.map((p) => (
                  <div className="row" key={p.id}><div className="t" style={{ width: 110 }}>{p.po_number || p.id.slice(0, 8)}</div><div style={{ flex: 1 }}>{p.vendor_name || '—'}</div><div className="s" style={{ width: 100 }}>{p.expected_date || '—'}</div><div className="r" style={{ width: 80 }}>{money(p.total_cents)}</div><span className={'pill ' + poStatusClass(p.status)} style={{ width: 80 }}>{statusLabel('purchaseOrder', p.status)}</span></div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
