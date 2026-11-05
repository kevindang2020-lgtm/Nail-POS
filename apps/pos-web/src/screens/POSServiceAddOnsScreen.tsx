import { useInlineConfirm } from '@aipowersalon/ui';
import { parseDollarsToCents } from '@aipowersalon/money';
// POSServiceAddOnsScreen.tsx — Services → Add-ons. Full CRUD catalog management for add-ons.
// Create, edit, archive/reactivate add-ons globally. Wired to /pos/service-add-ons/* endpoints.
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { posServiceAddOnsApi } from '../api/posServiceAddOnsApi';
import { money, reportError } from './reportsCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { ImeSafeInput } from '../components/ImeSafeInput';
import { viIncludes } from '@aipowersalon/api-contracts';

type Row = { serviceId: string; serviceName: string; categoryName: string; addOnId: string; name: string; priceCents: number; durationDeltaMinutes: number; isTaxable: boolean; isActive: boolean };
type State = { kpis: { totalAddOns: number; activeAddOns: number; servicesWithAddOns: number; averagePriceCents: number }; addOns: Row[] };

const inputStyle: React.CSSProperties = { height: 34, border: '1px solid var(--line)', borderRadius: 9, padding: '0 10px', background: '#FFFDF8', fontFamily: 'inherit', fontSize: 12.5, color: 'var(--text)', boxSizing: 'border-box' };

export function POSServiceAddOnsScreen() {
  const nav = useNavigate();
  const [s, setS] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Create form
  const [createOpen, setCreateOpen] = useState(false);
  const [cName, setCName] = useState('');
  const [cPrice, setCPrice] = useState('');
  const [cDuration, setCDuration] = useState('');
  const [cTaxable, setCTaxable] = useState(false);

  // Edit form
  const [editId, setEditId] = useState<string | null>(null);
  const [eName, setEName] = useState('');
  const [ePrice, setEPrice] = useState('');
  const [eDuration, setEDuration] = useState('');
  const [eTaxable, setETaxable] = useState(false);

  // Search/filter
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | 'active' | 'inactive'>('');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setS(await posServiceAddOnsApi.state() as State); }
    catch (e: any) { setError(reportError(e, 'add-ons')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const refetch = () => load();

  const createAddOn = async () => {
    if (!cName.trim()) { setNote(t('pos.add_on_name_is_required')); return; }
    const price = parseDollarsToCents(cPrice || '0'); if (price === null) { setError(t('pos.enter_a_valid_price_dollars_and_1qkm')); return; }
    const dur = parseInt(cDuration || '0', 10);
    if (price < 0) { setNote(t('pos.price_must_be_zero_or_positive')); return; }
    if (dur < 0) { setNote(t('pos.duration_must_be_zero_or_positive')); return; }
    setNote(null); setBusy('create');
    try {
      await posServiceAddOnsApi.create({ name: cName.trim(), priceCents: price, durationDeltaMinutes: dur, isTaxable: cTaxable });
      setCreateOpen(false); setCName(''); setCPrice(''); setCDuration(''); setCTaxable(false);
      setNote(t('pos.add_on_created'));
      await refetch();
    } catch (e: any) { setNote(e?.message || t('pos.create_failed')); }
    finally { setBusy(null); }
  };

  const openEdit = (r: Row) => {
    if (editId === r.addOnId) { setEditId(null); return; }
    setEditId(r.addOnId);
    setEName(r.name);
    setEPrice((r.priceCents / 100).toFixed(2));
    setEDuration(String(r.durationDeltaMinutes || 0));
    setETaxable(r.isTaxable);
    setNote(null);
  };

  const saveEdit = async (addOnId: string) => {
    if (!eName.trim()) { setNote(t('pos.name_is_required')); return; }
    const price = parseDollarsToCents(ePrice || '0'); if (price === null) { setError(t('pos.enter_a_valid_price_dollars_and_1qkm')); return; }
    const dur = parseInt(eDuration || '0', 10);
    setNote(null); setBusy(addOnId + 'edit');
    try {
      await posServiceAddOnsApi.update(addOnId, { name: eName.trim(), priceCents: price, durationDeltaMinutes: dur, isTaxable: eTaxable });
      setEditId(null); setNote(t('pos.add_on_updated'));
      await refetch();
    } catch (e: any) { setNote(e?.message || t('pos.save_failed')); }
    finally { setBusy(null); }
  };

  const { confirm: confirmAction, confirmUi } = useInlineConfirm();
  const archiveAddOn = (addOnId: string, name: string) => {
    confirmAction(t('people.addOns.archiveConfirm', { name }), () => { void doArchive(addOnId); }, { confirmLabel: t('pos.archive'), destructive: true });
  };
  const doArchive = async (addOnId: string) => {
    setNote(null); setBusy(addOnId + 'arch');
    try {
      await posServiceAddOnsApi.archive(addOnId);
      setNote(t('pos.name_archived', { name: String(name) }));
      await refetch();
    } catch (e: any) { setNote(e?.message || t('pos.archive_failed')); }
    finally { setBusy(null); }
  };

  const reactivateAddOn = async (addOnId: string, name: string) => {
    setNote(null); setBusy(addOnId + 'react');
    try {
      await posServiceAddOnsApi.reactivate(addOnId);
      setNote(t('pos.name_reactivated', { name: String(name) }));
      await refetch();
    } catch (e: any) { setNote(e?.message || t('pos.reactivate_failed')); }
    finally { setBusy(null); }
  };

  if (loading) return <div className="work"><div className="state">{t('pos.loading_add_ons')}</div></div>;
  if (error) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  if (!s) return <div className="work"><div className="state">{t('pos.no_data')}</div></div>;

  let rows = s.addOns || [];
  if (search.trim()) {
    const q = search.trim();   // accent-insensitive (WP-E foldVi)
    rows = rows.filter((a) => viIncludes(a.name, q) || viIncludes(a.serviceName, q) || viIncludes(a.categoryName, q));
  }
  if (statusFilter === 'active') rows = rows.filter((a) => a.isActive);
  if (statusFilter === 'inactive') rows = rows.filter((a) => !a.isActive);

  return (
    <div className="work">
      {confirmUi}
      <div className="mb-6 flex flex-col xl:flex-row gap-3 justify-between items-start xl:items-center">
        <div><h1>{t('pos.add_ons_2')}</h1><div className="sub">{t('pos.manage_add_on_services_across_your_1vxj')}</div></div>
        <button className="btn" onClick={() => { setCreateOpen((v) => !v); setNote(null); }}>{createOpen ? t('pos.close') : t('pos.new_add_on')}</button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-3.5">
        <div className="kpi w-full" style={{ margin: 0 }}><div className="l">{t('pos.total_add_ons')}</div><div className="v" style={{ color: 'var(--aps-orange)' }}>{s.kpis.totalAddOns}</div></div>
        <div className="kpi w-full" style={{ margin: 0 }}><div className="l">{t('pos.active_3')}</div><div className="v">{s.kpis.activeAddOns}</div></div>
        <div className="kpi w-full" style={{ margin: 0 }}><div className="l">{t('pos.services_offering')}</div><div className="v">{s.kpis.servicesWithAddOns}</div></div>
        <div className="kpi w-full" style={{ margin: 0 }}><div className="l">{t('pos.avg_price')}</div><div className="v">{money(s.kpis.averagePriceCents)}</div></div>
      </div>

      {note ? <div className="err" style={{ margin: '12px 0' }}>{note}</div> : null}

      {/* Create Add-On Form */}
      {createOpen ? (
        <section className="panel" style={{ marginTop: 12 }}>
          <h2>{t('pos.create_new_add_on')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5 mt-2.5">
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#4A4032', marginBottom: 4 }}>{t('pos.name_2')}</label>
              <input placeholder={t('pos.e_g_french_tips')} value={cName} onChange={(e) => setCName(e.target.value)} style={{ ...inputStyle, width: '100%' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#4A4032', marginBottom: 4 }}>{t('pos.price_2')}</label>
              <input type="number" step="0.50" min="0" placeholder="10.00" value={cPrice} onChange={(e) => setCPrice(e.target.value)} style={{ ...inputStyle, width: '100%' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#4A4032', marginBottom: 4 }}>{t('pos.extra_duration_min')}</label>
              <input type="number" min="0" placeholder="10" value={cDuration} onChange={(e) => setCDuration(e.target.value)} style={{ ...inputStyle, width: '100%' }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 20 }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, cursor: 'pointer' }}>
                <input type="checkbox" checked={cTaxable} onChange={(e) => setCTaxable(e.target.checked)} /> {t('pos.taxable')}
              </label>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn" disabled={busy === 'create'} onClick={createAddOn}>{busy === 'create' ? t('pos.creating') : t('pos.create_add_on')}</button>
            <button className="btn ghost" onClick={() => setCreateOpen(false)}>{t('pos.cancel')}</button>
          </div>
        </section>
      ) : null}

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, margin: '12px 0', flexWrap: 'wrap' }}>
        <ImeSafeInput
          type="search"
          placeholder={t('pos.search_add_ons')}
          value={search}
          onValue={setSearch}
          style={{ ...inputStyle, flex: '1 1 200px', minWidth: 180, maxWidth:400 }}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} style={{ ...inputStyle }}>
          <option value="">{t('pos.all_statuses')}</option>
          <option value="active">{t('pos.active_only')}</option>
          <option value="inactive">{t('pos.inactive_only')}</option>
        </select>
      </div>

      {/* Add-ons table */}
      <section className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="p-h" style={{ padding: '14px 14px 0' }}>{t('pos.all_add_ons')}{rows.length})</div>
        {rows.length === 0 ? (
          <div className="state" style={{ padding: 16 }}>{t('pos.no_add_ons_match_your_filters')}{' '}<button className="btn ghost" style={{ padding: '2px 8px' }} onClick={() => setCreateOpen(true)}>{t('pos.create_one')}</button></div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[800px]">
              <table className="tbl">
                <thead><tr><th>{t('pos.add_on_2')}</th><th>{t('pos.service_3')}</th><th>{t('pos.category')}</th><th style={{ textAlign: 'right' }}>{t('pos.price')}</th><th style={{ textAlign: 'right' }}>{t('pos.time_2')}</th><th>{t('pos.taxable')}</th><th>{t('pos.status')}</th><th>{t('pos.actions')}</th></tr></thead>
            <tbody>{rows.map((a) => (
              <React.Fragment key={a.serviceId + ':' + a.addOnId}>
                <tr style={a.isActive ? undefined : { opacity: 0.55 }}>
                  <td style={{ fontWeight: 700 }}>{a.name}</td>
                  <td>{a.serviceName}</td>
                  <td style={{ color: 'var(--muted)' }}>{a.categoryName}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(a.priceCents)}</td>
                  <td style={{ textAlign: 'right' }}>{a.durationDeltaMinutes ? `+${a.durationDeltaMinutes}m` : '—'}</td>
                  <td>{a.isTaxable ? t('pos.yes') : t('pos.no')}</td>
                  <td><span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 6, fontSize: 11.5, fontWeight: 700, background: a.isActive ? '#E9F6EC' : '#F0F0F0', color: a.isActive ? '#2E9E54' : '#888' }}>{a.isActive ? t('pos.active_3') : t('pos.inactive_2')}</span></td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn ghost" style={{ padding: '2px 6px', fontSize: 11 }} onClick={() => openEdit(a)}>{editId === a.addOnId ? t('pos.close') : t('pos.edit')}</button>
                      {a.isActive ? (
                        <button className="btn ghost" style={{ padding: '2px 6px', fontSize: 11, color: 'var(--danger)' }} disabled={busy === a.addOnId + 'arch'} onClick={() => archiveAddOn(a.addOnId, a.name)}>{t('pos.archive')}</button>
                      ) : (
                        <button className="btn ghost" style={{ padding: '2px 6px', fontSize: 11 }} disabled={busy === a.addOnId + 'react'} onClick={() => reactivateAddOn(a.addOnId, a.name)}>{t('pos.reactivate')}</button>
                      )}
                    </div>
                  </td>
                </tr>
                {editId === a.addOnId ? (
                  <tr>
                    <td colSpan={8} style={{ background: '#FFFDF8', padding: 12 }}>
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5">
                        <div>
                          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, marginBottom: 4 }}>{t('pos.name')}</label>
                          <input value={eName} onChange={(e) => setEName(e.target.value)} style={{ ...inputStyle, width: '100%' }} />
                        </div>
                        <div>
                          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, marginBottom: 4 }}>{t('pos.price_2')}</label>
                          <input type="number" step="0.50" min="0" value={ePrice} onChange={(e) => setEPrice(e.target.value)} style={{ ...inputStyle, width: '100%' }} />
                        </div>
                        <div>
                          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, marginBottom: 4 }}>{t('pos.duration_min')}</label>
                          <input type="number" min="0" value={eDuration} onChange={(e) => setEDuration(e.target.value)} style={{ ...inputStyle, width: '100%' }} />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 16 }}>
                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                            <input type="checkbox" checked={eTaxable} onChange={(e) => setETaxable(e.target.checked)} /> {t('pos.taxable')}
                          </label>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                        <button className="btn" disabled={busy === a.addOnId + 'edit'} onClick={() => saveEdit(a.addOnId)}>{busy === a.addOnId + 'edit' ? t('pos.saving_2') : t('pos.save_changes_2')}</button>
                        <button className="btn ghost" onClick={() => setEditId(null)}>{t('pos.cancel')}</button>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </React.Fragment>
            ))}
            </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Quick navigation */}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button className="btn ghost" onClick={() => nav('/services')}>{t('pos.back_to_services')}</button>
        <button className="btn ghost" onClick={() => nav('/tenant/services/categories')}>{t('pos.categories')}</button>
        <button className="btn ghost" onClick={() => nav('/tenant/services/pricing')}>{t('pos.pricing')}</button>
      </div>
    </div>
  );
}
