// HardwarePackagesScreen.tsx — Super-Admin Hardware Packages (replaces the basic HardwareScreen).
import { useEffect, useState } from 'react';
import { useInlineConfirm, useEventCallback } from '@aipowersalon/ui';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { hwApi, useSuperAdminHardwareState, type HwPackage, type HwDetail } from '../api/superAdminHardwarePackagesApi';

const STATUS_LABEL: Record<string, string> = { not_ordered: 'Not Ordered', ready_to_ship: 'Ready to Ship', ordered: 'Ordered', processing: 'Processing', shipped: 'Shipped', delivered: 'Delivered', installed: 'Installed', complete: 'Complete', cancelled: 'Cancelled', returned: 'Returned' };
const STATUS_PAIR: Record<string, [string, string]> = { not_ordered: ['#FBE7E4', '#C0392B'], ready_to_ship: ['#FBF0DC', '#B7791F'], ordered: ['#EAF1FF', '#2F6FED'], processing: ['#EAF1FF', '#2F6FED'], shipped: ['#F3ECFB', '#7C3AED'], delivered: ['#E7F5EC', '#1F9254'], installed: ['#E7F5EC', '#1F9254'], complete: ['#E7F5EC', '#1F9254'], cancelled: ['#F0EFF4', '#6B7280'], returned: ['#FBE7E4', '#C0392B'] };
const PAY_LABEL: Record<string, string> = { unpaid: 'Unpaid', pending: 'Pending', deposit_paid: 'Deposit Paid', financing: 'Financing', partially_paid: 'Partially Paid', paid: 'Paid', paid_off: 'Paid Off', refunded: 'Refunded' };
const PAY_PAIR: Record<string, [string, string]> = { unpaid: ['#FBE7E4', '#C0392B'], pending: ['#FBF0DC', '#B7791F'], deposit_paid: ['#FBF0DC', '#B7791F'], financing: ['#EAF1FF', '#2F6FED'], partially_paid: ['#FBF0DC', '#B7791F'], paid: ['#E7F5EC', '#1F9254'], paid_off: ['#E7F5EC', '#1F9254'], refunded: ['#F0EFF4', '#6B7280'] };
const TYPE_LABEL: Record<string, string> = { pro_plus: 'Pro Plus Package', pro: 'Pro Package', standard: 'Standard Package' };
const CARRIER_LABEL: Record<string, string> = { fedex: 'FedEx', ups: 'UPS', usps: 'USPS', dhl: 'DHL', other: 'Other' };
const STATUS_DONUT: Record<string, string> = { not_ordered: '#C0392B', ready_to_ship: '#B7791F', shipped: '#7C3AED', delivered: '#1F9254', installed_complete: '#2F6FED' };
const ACTION_LABEL: Record<string, string> = { hardware_package_created: 'Package created', hardware_package_assigned: 'Package assigned', hardware_package_status_changed: 'Status changed', hardware_package_payment_status_changed: 'Payment updated', hardware_package_tracking_updated: 'Tracking updated', hardware_package_device_added: 'Device added', hardware_package_note_added: 'Note added', hardware_package_cancelled: 'Package cancelled', hardware_package_returned: 'Package returned', tenant_hardware_status_updated: 'Hardware status updated' };

const badge = ([bg, fg]: [string, string]): React.CSSProperties => ({ background: bg, color: fg, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, whiteSpace: 'nowrap' });
const money = (c: number | null | undefined) => (c == null ? '—' : `$${(c / 100).toLocaleString('en-US')}`);
const initials = (s: string | null) => (s || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '');
const ago = (iso: string) => { const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000)); if (s < 60) return `${s}s ago`; const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`; const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`; return `${Math.floor(h / 24)}d ago`; };
const norm = (s: string) => ({ not_started: 'not_ordered', pending_approval: 'not_ordered', ready: 'ready_to_ship', activated: 'complete', on_hold: 'processing' } as Record<string, string>)[s] || s;
const errMsg = (e: any) => e?.status === 403 ? 'You do not have permission for this action.' : e?.status === 409 ? (String(e?.message).includes('transition') ? 'This hardware package status cannot be changed from the current state.' : String(e?.message).includes('serial') ? 'This device serial number already exists.' : String(e?.message).includes('active_package') ? 'This tenant already has an active hardware package.' : 'This action conflicts with the current state.') : e?.message || 'Something went wrong. Please try again.';
const isDupErr = (e: any) => e?.status === 409 && String(e?.message).includes('active_package');

const KPI = ({ label, value, trend, goodWhenUp, icon, bg, fg }: { label: string; value: string; trend?: number; goodWhenUp: boolean; icon: string; bg: string; fg: string }) => {
  const t = trend ?? 0; const good = goodWhenUp ? t >= 0 : t <= 0;
  return (
    <div
      className="kpi"
      style={{
        background: '#FFFDF8',
        border: '1px solid var(--line)',
        borderRadius: 14,
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
        <span className="l" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>{label}</span>
        <span style={{ width: 24, height: 24, borderRadius: 6, background: bg, color: fg, display: 'grid', placeItems: 'center', fontSize: 12 }}>{icon}</span>
      </div>
      <div className="v" style={{ fontFamily: 'Playfair Display, serif', fontSize: 20, fontWeight: 700, color: 'var(--text)', marginTop: 6 }}>{value}</div>
      {trend != null ? <div style={{ fontSize: 10.5, color: good ? '#1F9254' : '#C0392B', marginTop: 4, fontWeight: 600 }}>{t >= 0 ? '▲' : '▼'} {Math.abs(t)}% vs last month</div> : null}
    </div>
  );
};

export function HardwarePackagesScreen() {
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const tenantId = sp.get('tenantId') || '';
  const query = { search: sp.get('search') || '', status: sp.get('status') || 'all', paymentStatus: sp.get('paymentStatus') || 'all', packageType: sp.get('packageType') || 'all', carrier: sp.get('carrier') || 'all', dateFrom: sp.get('dateFrom') || '', tenantId, page: Number(sp.get('page')) || 1, limit: 10 };
  const { state, loading, error, reload } = useSuperAdminHardwareState(query);
  const [search, setSearch] = useState(query.search);
  const { confirm: askConfirm, confirmUi } = useInlineConfirm();
  const [selId, setSelId] = useState<string | null>(null);
  const [detail, setDetail] = useState<HwDetail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [, setMenuId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number; id: string } | null>(null);
  const [showAssign, setShowAssign] = useState(false);
  const [trackFor, setTrackFor] = useState<HwPackage | null>(null);
  const [editFor, setEditFor] = useState<HwPackage | null>(null);

  const setParam = (patch: Record<string, string>) => setSp((prev) => { const next = new URLSearchParams(prev); Object.entries(patch).forEach(([k, v]) => { if (!v || v === 'all') next.delete(k); else next.set(k, v); }); if (!('page' in patch)) next.delete('page'); return next; }, { replace: true });
  const clearFilters = () => { setSearch(''); const keep = new URLSearchParams(); if (tenantId) keep.set('tenantId', tenantId); setSp(keep, { replace: true }); };
  const pushSearch = useEventCallback(() => { if (search !== query.search) setParam({ search }); });
  useEffect(() => { const t = setTimeout(pushSearch, 350); return () => clearTimeout(t); }, [search, pushSearch]);

  const effectiveSel = selId || state?.selectedPackage?.package.id || null;
  // fires when the effective selection changes; reads the board's preloaded detail as it is then
  const loadDetail = useEventCallback(() => {
    if (!effectiveSel) { setDetail(null); return; }
    if (state?.selectedPackage && state.selectedPackage.package.id === effectiveSel && !selId) { setDetail(state.selectedPackage); return; }
    hwApi.detail(effectiveSel).then(setDetail).catch(() => setDetail(null));
  });
  useEffect(() => { loadDetail(); }, [effectiveSel, loadDetail]);

  const act = async (key: string, fn: () => Promise<any>) => { setBusy(key); setNote(null); setMenuId(null); try { await fn(); reload(); if (effectiveSel) hwApi.detail(effectiveSel).then(setDetail).catch(() => {}); } catch (e: any) { setNote(errMsg(e)); } finally { setBusy(null); } };
  const doExport = async () => { setBusy('export'); setNote(null); try { await hwApi.downloadCsv(query); } catch (e: any) { setNote(errMsg(e)); } finally { setBusy(null); } };

  const s = state?.summary;
  const sel = (name: string, value: string, opts: { v: string; t: string }[]) => (
    <select value={value} onChange={(e) => setParam({ [name]: e.target.value })} style={INPUT}>{opts.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}</select>
  );

  return (
    <div className="work" style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%', overflowY: 'auto' }}>
      {confirmUi}
      {/* HEADER BAR */}
      <div className="vh" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 24, fontWeight: 700, color: 'var(--text)' }}>Hardware Packages</h1>
          <div className="sub" style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>Manage tenant hardware orders, shipments, installations, device assignments, and payment status.</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn ghost" disabled={busy === 'export'} onClick={doExport} style={{ height: 36, fontWeight: 700 }}>{busy === 'export' ? 'Exporting…' : '↓ Export'}</button>
          <button className="btn ghost" onClick={reload} style={{ height: 36, fontWeight: 700 }}>↻ Refresh</button>
          <button className="btn" onClick={() => { setShowAssign(true); setNote(null); }} style={{ height: 36, fontWeight: 800 }}>+ Assign Package</button>
        </div>
      </div>

      {tenantId ? <div style={{ padding: '4px 10px', borderRadius: 8, background: '#FFF9EF', border: '1px solid #E2C686', fontSize: 12, color: '#8B5A18', display: 'inline-flex', alignItems: 'center', gap: 6 }}>Filtered to tenant · <button className="btn ghost sm" onClick={() => setParam({ tenantId: '' })} style={{ padding: '0 6px', height: 20 }}>Clear</button></div> : null}
      {note ? <div style={{ padding: '8px 12px', borderRadius: 8, background: '#FFF9EF', border: '1px solid #E2C686', fontSize: 12.5, color: '#8B5A18' }}>{note}</div> : null}
      {error ? <div style={{ padding: '10px 14px', borderRadius: 8, background: '#FBE7E4', border: '1px solid #F3C4BE', fontSize: 13, color: '#C0392B' }}>{error} <button className="btn ghost sm" onClick={reload} style={{ marginLeft: 8 }}>Retry</button></div> : null}

      {/* 8 LUXURY KPI CARDS */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-2.5">
        <KPI label="Total Packages" value={(s?.totalPackages ?? 0).toLocaleString()} trend={s?.trends.totalPackages} goodWhenUp icon="📦" bg="#EAF1FF" fg="#2F6FED" />
        <KPI label="Not Ordered" value={(s?.notOrdered ?? 0).toLocaleString()} trend={s?.trends.notOrdered} goodWhenUp={false} icon="⏳" bg="#FBE7E4" fg="#C0392B" />
        <KPI label="Ready to Ship" value={(s?.readyToShip ?? 0).toLocaleString()} trend={s?.trends.readyToShip} goodWhenUp icon="📋" bg="#FBF0DC" fg="#B7791F" />
        <KPI label="Shipped" value={(s?.shipped ?? 0).toLocaleString()} trend={s?.trends.shipped} goodWhenUp icon="🚚" bg="#F3ECFB" fg="#7C3AED" />
        <KPI label="Delivered" value={(s?.delivered ?? 0).toLocaleString()} trend={s?.trends.delivered} goodWhenUp icon="📬" bg="#E7F5EC" fg="#1F9254" />
        <KPI label="Installed | Complete" value={(s?.installedComplete ?? 0).toLocaleString()} trend={s?.trends.installedComplete} goodWhenUp icon="✓" bg="#E7F5EC" fg="#1F9254" />
        <KPI label="Pending Payment" value={(s?.pendingPayment ?? 0).toLocaleString()} trend={s?.trends.pendingPayment} goodWhenUp={false} icon="⚠️" bg="#FBF0DC" fg="#B7791F" />
        <KPI label="Paid Off" value={(s?.paidOff ?? 0).toLocaleString()} trend={s?.trends.paidOff} goodWhenUp icon="🏦" bg="#E7F5EC" fg="#1F9254" />
      </div>

      {/* FILTER ROW */}
      <div className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by salon name, owner, package..." style={{ ...INPUT, flex: 1, minWidth: 200 }} />
        {sel('status', query.status, [{ v: 'all', t: 'All Statuses' }, ...Object.keys(STATUS_LABEL).map((k) => ({ v: k, t: STATUS_LABEL[k] }))])}
        {sel('paymentStatus', query.paymentStatus, [{ v: 'all', t: 'All Payments' }, ...Object.keys(PAY_LABEL).map((k) => ({ v: k, t: PAY_LABEL[k] }))])}
        {sel('packageType', query.packageType, [{ v: 'all', t: 'All Types' }, ...Object.keys(TYPE_LABEL).map((k) => ({ v: k, t: TYPE_LABEL[k] }))])}
        {sel('carrier', query.carrier, [{ v: 'all', t: 'All Carriers' }, ...Object.keys(CARRIER_LABEL).map((k) => ({ v: k, t: CARRIER_LABEL[k] }))])}
        <input type="date" value={query.dateFrom} onChange={(e) => setParam({ dateFrom: e.target.value })} style={{ ...INPUT, width: 140 }} />
        <button className="btn ghost sm !min-h-9" onClick={clearFilters} style={{ height: 34, fontWeight: 700 }}>Clear Filters</button>
      </div>

      {/* MAIN TABLE (LEFT) + DETAIL PANEL (RIGHT) */}
      <div
        className={`grid grid-cols-1 ${effectiveSel
            ? 'lg:grid-cols-[minmax(0,1fr)_350px]'
            : ''
          } gap-3.5 items-start`}
      >
        <div className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, boxShadow: '0 2px 10px rgba(169, 111, 34, 0.04)' }}>
          {loading && !state ? <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>Loading hardware packages…</div>
            : (state?.packages.length ?? 0) === 0 ? <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)', fontSize: 13, background: '#FFFBF2', borderRadius: 10, border: '1px dashed var(--line)' }}>{query.search || query.status !== 'all' ? 'No packages match your filters.' : 'No hardware packages yet.'}</div>
            : (
              <div style={{ overflowX: 'auto', width: '100%' }}>
                <table className="ttable" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 850 }}>
                  <thead>
                    <tr style={{ background: '#FFFBF2', borderBottom: '1px solid var(--line)', textAlign: 'left', color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      <th style={{ padding: '10px 12px' }}>Tenant / Salon</th>
                      <th style={{ padding: '10px 12px' }}>Owner</th>
                      <th style={{ padding: '10px 12px' }}>City / State</th>
                      <th style={{ padding: '10px 12px' }}>Package</th>
                      <th style={{ padding: '10px 12px', textAlign: 'center' }}>Devices</th>
                      <th style={{ padding: '10px 12px' }}>Status</th>
                      <th style={{ padding: '10px 12px' }}>Payment</th>
                      <th style={{ padding: '10px 12px' }}>Shipping / Tracking</th>
                      <th style={{ padding: '10px 12px' }}>Updated</th>
                      <th style={{ padding: '10px 8px', width: 32 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {state!.packages.map((p, idx) => {
                      const isSel = effectiveSel === p.id;
                      return (
                        <tr
                          key={p.id}
                          onClick={() => setSelId(p.id)}
                          style={{
                            borderBottom: '1px solid var(--line)',
                            background: isSel ? '#FFF3E9' : idx % 2 === 1 ? '#FFFDF8' : '#FFFFFF',
                            cursor: 'pointer',
                            transition: 'background 0.15s ease',
                          }}
                          onMouseEnter={(e) => { if (!isSel) e.currentTarget.style.background = '#FFF9EF'; }}
                          onMouseLeave={(e) => { if (!isSel) e.currentTarget.style.background = idx % 2 === 1 ? '#FFFDF8' : '#FFFFFF'; }}
                        >
                          <td style={{ padding: '12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ width: 28, height: 28, borderRadius: 8, background: '#FFF9EF', border: '1px solid #E2C686', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 800, color: '#8B5A18' }}>
                                {initials(p.salonName)}
                              </span>
                              <div>
                                <div style={{ fontWeight: 700, color: 'var(--text)' }}>{p.salonName || '—'}</div>
                                <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10.5, color: 'var(--muted)' }}>{p.salonCode || '—'}</div>
                              </div>
                            </div>
                          </td>
                          <td style={{ padding: '12px' }}>{p.ownerName || '—'}</td>
                          <td style={{ padding: '12px', color: 'var(--muted)' }}>{[p.city, p.state].filter(Boolean).join(', ') || '—'}</td>
                          <td style={{ padding: '12px', fontWeight: 600 }}>{p.packageName || TYPE_LABEL[p.packageType || 'standard'] || '—'}</td>
                          <td style={{ padding: '12px', textAlign: 'center', fontWeight: 700 }}>{p.deviceCount ?? '—'}</td>
                          <td style={{ padding: '12px' }}><span style={badge(STATUS_PAIR[norm(p.status)] || ['#F0EFF4', '#6B7280'])}>{STATUS_LABEL[norm(p.status)] || p.status}</span></td>
                          <td style={{ padding: '12px' }}><span style={badge(PAY_PAIR[p.paymentStatus] || ['#F0EFF4', '#6B7280'])}>{PAY_LABEL[p.paymentStatus] || p.paymentStatus}</span></td>
                          <td style={{ padding: '12px', fontSize: 12 }}>
                            {p.trackingNumber ? (
                              <div>
                                <span style={{ fontWeight: 600 }}>{CARRIER_LABEL[p.shippingCarrier || 'other'] || p.shippingCarrier}</span>
                                <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10.5, color: 'var(--muted)' }}>{p.trackingNumber}</div>
                              </div>
                            ) : '—'}
                          </td>
                          <td style={{ padding: '12px', fontSize: 11.5, color: 'var(--muted)' }}>
                            <div>{fmtDate(p.updatedAt)}</div>
                            <div style={{ fontSize: 10.5 }}>{fmtTime(p.updatedAt)}</div>
                          </td>
                          <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                            <button
                              className="btn ghost sm  w-10"
                              style={{ height: 36, padding: '0 6px' }}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (menuPos?.id === p.id) {
                                  setMenuPos(null);
                                } else {
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  const spaceBelow = window.innerHeight - rect.bottom;
                                  const top = spaceBelow < 360 ? Math.max(10, rect.top - 340) : rect.bottom + 4;
                                  setMenuPos({ top, right: Math.max(12, window.innerWidth - rect.right), id: p.id });
                                }
                              }}
                            >
                              ⋮
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

          {/* FLOATING ACTION MENU (OUTSIDE TABLE OVERFLOW) */}
          {menuPos && (() => {
            const p = state?.packages.find((item) => item.id === menuPos.id);
            if (!p) return null;
            return (
              <>
                <div
                  style={{ position: 'fixed', inset: 0, zIndex: 998 }}
                  onClick={() => setMenuPos(null)}
                />
                <div
                  className="amenu"
                  style={{
                    position: 'fixed',
                    top: menuPos.top,
                    right: menuPos.right,
                    zIndex: 999,
                    background: '#FFFDF8',
                    border: '1px solid var(--line)',
                    borderRadius: 12,
                    boxShadow: '0 12px 36px rgba(0,0,0,0.22), 0 2px 8px rgba(169, 111, 34, 0.12)',
                    minWidth: 185,
                    maxHeight: 'min(380px, calc(100vh - 40px))',
                    overflowY: 'auto',
                    padding: 6,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {([
                    ['View Details', () => { setSelId(p.id); setMenuPos(null); }],
                    ['Edit Package', () => { setEditFor(p); setMenuPos(null); }],
                    ['Mark Ready to Ship', () => { setMenuPos(null); act('rs' + p.id, () => hwApi.setStatus(p.id, 'ready_to_ship')); }],
                    ['Mark Shipped', () => { setMenuPos(null); act('sh' + p.id, () => hwApi.setStatus(p.id, 'shipped')); }],
                    ['Mark Delivered', () => { setMenuPos(null); act('dl' + p.id, () => hwApi.setStatus(p.id, 'delivered')); }],
                    ['Mark Installed', () => { setMenuPos(null); act('in' + p.id, () => hwApi.setStatus(p.id, 'installed')); }],
                    ['Mark Complete', () => { setMenuPos(null); act('cp' + p.id, () => hwApi.setStatus(p.id, 'complete')); }],
                    ['Update Tracking', () => { setTrackFor(p); setMenuPos(null); }],
                    ['Open Tenant', () => { setMenuPos(null); if (p.tenantId) nav(`/tenants?tenantId=${encodeURIComponent(p.tenantId)}`); }],
                    ['Open Billing', () => { setMenuPos(null); nav('/hardware-payments'); }],
                    ['View Audit Logs', () => { setMenuPos(null); nav('/audit-logs'); }],
                    ['Cancel Package', () => { setMenuPos(null); askConfirm('Cancel this hardware package? The tenant keeps its billing history.', () => act('cn' + p.id, () => hwApi.cancel(p.id)), { confirmLabel: 'Cancel package' }); }],
                    ['Return Package', () => { setMenuPos(null); askConfirm('Mark this package returned?', () => act('rt' + p.id, () => hwApi.returnPkg(p.id)), { confirmLabel: 'Mark returned', destructive: false }); }],
                  ] as [string, () => void][]).map(([lbl, fn]) => (
                    <button key={lbl} onClick={fn} className="btn ghost sm" style={{ textAlign: 'left', width: '100%', fontSize: 11.5 }}>{lbl}</button>
                  ))}
                </div>
              </>
            );
          })()}

          {state && state.pagination.totalItems > 0 ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, fontSize: 12, color: 'var(--muted)' }}>
              <span>Showing {(state.pagination.page - 1) * state.pagination.limit + 1} to {Math.min(state.pagination.page * state.pagination.limit, state.pagination.totalItems)} of {state.pagination.totalItems.toLocaleString()} results</span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button className="btn ghost sm" disabled={state.pagination.page <= 1} onClick={() => setParam({ page: String(state.pagination.page - 1) })}>‹</button>
                <span>Page {state.pagination.page} / {state.pagination.totalPages}</span>
                <button className="btn ghost sm" disabled={state.pagination.page >= state.pagination.totalPages} onClick={() => setParam({ page: String(state.pagination.page + 1) })}>›</button>
              </div>
            </div>
          ) : null}
        </div>

        {/* DETAIL PANEL (RIGHT RAIL) */}
        <DetailPanel detail={detail} busy={busy} onAct={act} onTrack={() => detail && setTrackFor(detail.package)} onOpenTenant={(tid) => nav(`/tenants?tenantId=${encodeURIComponent(tid)}`)} />
      </div>

      {/* LOWER 3 ANALYTICS PANELS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
        <div className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
          <h2 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Packages by Status</h2>
          <Donut data={state?.packagesByStatus ?? []} total={s?.totalPackages ?? 0} onPick={(st) => setParam({ status: st === 'installed_complete' ? 'installed' : st })} />
          <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 8, textAlign: 'center' }}>Installed includes Delivered</div>
        </div>

        <div className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
          <h2 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700 }}>Top Package Types</h2>
          {(state?.topPackageTypes ?? []).length === 0 ? <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>No data yet.</div> : (<>
            {state!.topPackageTypes.map((t) => (
              <div key={t.type} style={{ marginBottom: 10, cursor: 'pointer' }} onClick={() => setParam({ packageType: t.type })}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                  <span>{TYPE_LABEL[t.type] || t.type}</span>
                  <span style={{ fontWeight: 700 }}>{t.count.toLocaleString()} · {t.pct}%</span>
                </div>
                <div style={{ height: 6, background: '#FFF9EF', borderRadius: 99, border: '1px solid #E2C686' }}>
                  <div style={{ width: `${t.pct}%`, height: '100%', borderRadius: 99, background: 'linear-gradient(90deg, #D4AF37, #A96F22)' }} />
                </div>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 800, borderTop: '1px solid var(--line)', paddingTop: 6, marginTop: 6 }}>
              <span>Total</span><span>{(s?.totalPackages ?? 0).toLocaleString()} · 100%</span>
            </div>
          </>)}
        </div>

        <div className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Recent Hardware Activity</h2>
            <button className="btn ghost sm" onClick={() => nav('/audit-logs')}>View All</button>
          </div>
          {(state?.recentHardwareActivity ?? []).length === 0 ? <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>Recent hardware activity will appear here.</div> :
            state!.recentHardwareActivity.map((a) => (
              <div key={a.id} style={{ display: 'flex', gap: 8, padding: '6px 0', fontSize: 12, alignItems: 'center', borderBottom: '1px solid var(--line)' }}>
                <span style={{ width: 22, height: 22, borderRadius: 6, background: '#FFF9EF', border: '1px solid #E2C686', display: 'grid', placeItems: 'center', fontSize: 10, color: '#8B5A18' }}>•</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>{a.salonName || '—'}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{ACTION_LABEL[a.actionType] || a.actionType}</div>
                </div>
                <span style={{ color: 'var(--muted)', fontSize: 11 }}>{ago(a.createdAt)}</span>
              </div>
            ))}
        </div>
      </div>

      {/* RECENT HARDWARE EVENTS TIMELINE */}
      <div className="panel" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 16, boxShadow: '0 2px 8px rgba(169, 111, 34, 0.04)', paddingBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Recent Hardware Events</h2>
          <button className="btn ghost sm" onClick={() => nav('/audit-logs')}>View All Events</button>
        </div>
        {(state?.recentHardwareEvents ?? []).length === 0 ? <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>Recent hardware events will appear here.</div> : (
          <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 6 }}>
            {state!.recentHardwareEvents.map((e, i) => (
              <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ minWidth: 180, padding: 10, border: '1px solid var(--line)', borderRadius: 10, background: '#FFFFFF' }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)' }}>{ACTION_LABEL[e.actionType] || e.actionType}</div>
                  <div style={{ fontSize: 11.5, color: '#8B5A18' }}>🏪 {e.salonName || '—'}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>{fmtDate(e.createdAt)} · {fmtTime(e.createdAt)}</div>
                </div>
                {i < state!.recentHardwareEvents.length - 1 ? <span style={{ color: 'var(--muted)' }}>→</span> : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {showAssign ? <AssignModal onClose={() => setShowAssign(false)} onSaved={() => { setShowAssign(false); reload(); }} /> : null}
      {editFor ? <EditModal pkg={editFor} onClose={() => setEditFor(null)} onSaved={() => { setEditFor(null); reload(); if (effectiveSel) hwApi.detail(effectiveSel).then(setDetail).catch(() => {}); }} /> : null}
      {trackFor ? <TrackingModal pkg={trackFor} onClose={() => setTrackFor(null)} onSaved={() => { setTrackFor(null); reload(); if (effectiveSel) hwApi.detail(effectiveSel).then(setDetail).catch(() => {}); }} /> : null}
    </div>
  );
}

function DetailPanel({ detail, busy, onAct, onTrack, onOpenTenant }: { detail: HwDetail | null; busy: string | null; onAct: (k: string, fn: () => Promise<any>) => void; onTrack: () => void; onOpenTenant: (tid: string) => void }) {
  const [pNote, setPNote] = useState('');
  const [dName, setDName] = useState(''); const [dSerial, setDSerial] = useState('');
  if (!detail) return <aside className="panel detail" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>Select a package to see details.</aside>;
  const p = detail.package; const st = detail.normalizedStatus;
  const steps: [string, string | null, boolean][] = [
    ['Ordered', p.orderedAt, !!p.orderedAt || ['ordered', 'processing', 'shipped', 'delivered', 'installed', 'complete', 'ready_to_ship'].includes(st)],
    ['Shipped', p.shippedAt, !!p.shippedAt || ['shipped', 'delivered', 'installed', 'complete'].includes(st)],
    ['Delivered', p.deliveredAt, !!p.deliveredAt || ['delivered', 'installed', 'complete'].includes(st)],
    ['Installed', p.installedAt, !!p.installedAt || ['installed', 'complete'].includes(st)],
  ];
  const firstPending = steps.findIndex(([, , d]) => !d);
  return (
    <aside className="panel detail" style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 14, padding: 18, boxShadow: '0 4px 18px rgba(169, 111, 34, 0.05)', position: 'sticky', top: 8, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--line)', paddingBottom: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{p.salonName || '—'}</h2>
          <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: 'var(--muted)' }}>{p.salonCode || '—'}</div>
        </div>
        <span style={badge(STATUS_PAIR[st] || ['#F0EFF4', '#6B7280'])}>{STATUS_LABEL[st] || st}</span>
      </div>

      <div style={{ display: 'grid', gap: 4, fontSize: 12 }}>
        <Row k="Package" v={p.packageName || TYPE_LABEL[p.packageType || 'standard'] || '—'} />
        <Row k="Payment Status" v={PAY_LABEL[p.paymentStatus] || p.paymentStatus} />
        <Row k="Hardware Cost" v={money(p.hardwareCostCents)} />
      </div>

      <Sect title={`Devices Included (${detail.devices.reduce((n, d) => n + (d.quantity || 1), 0)})`}>
        {detail.devices.map((d, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', borderBottom: '1px solid var(--line)' }}>
            <span>{d.deviceName}</span>
            <span style={{ fontWeight: 700 }}>{d.quantity}</span>
          </div>
        ))}
      </Sect>

      <Sect title="Shipment Progress">
        <div style={{ display: 'flex', justifyContent: 'space-between', background: '#FFFBF2', padding: 8, borderRadius: 8, border: '1px solid var(--line)' }}>
          {steps.map(([lbl, date, done], i) => (
            <div key={lbl} style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ width: 18, height: 18, borderRadius: '50%', margin: '0 auto', background: done ? '#1F9254' : '#E2C686', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 800 }}>{done ? '✓' : ''}</div>
              <div style={{ fontSize: 10, marginTop: 3, fontWeight: 600 }}>{lbl}</div>
              <div style={{ fontSize: 9.5, color: 'var(--muted)' }}>{date ? fmtDate(date) : (i === firstPending ? 'Pending' : '')}</div>
            </div>
          ))}
        </div>
      </Sect>

      <Sect title="Tracking Information">
        <Row k="Tracking Number" v={p.trackingNumber || '—'} mono />
        <Row k="Carrier" v={CARRIER_LABEL[p.shippingCarrier || ''] || p.shippingCarrier || '—'} />
        <Row k="Shipped Date" v={fmtDate(p.shippedAt)} />
        <Row k="Delivered Date" v={fmtDate(p.deliveredAt)} />
        <Row k="Installed Date" v={fmtDate(p.installedAt)} />
      </Sect>

      <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
        <button className="btn" disabled={!!busy} onClick={onTrack} style={{ fontWeight: 800 }}>Update Tracking</button>
        <button className="btn ghost sm" disabled={!!busy || st !== 'shipped'} onClick={() => onAct('d', () => hwApi.setStatus(p.id, 'delivered'))}>Mark Delivered</button>
        <button className="btn ghost sm" disabled={!!busy || st !== 'delivered'} onClick={() => onAct('i', () => hwApi.setStatus(p.id, 'installed'))}>Mark Installed</button>
        <button className="btn ghost sm" disabled={!p.tenantId} onClick={() => p.tenantId && onOpenTenant(p.tenantId)}>Open Tenant</button>
      </div>

      <Sect title="Update Payment Status">
        <select value={p.paymentStatus} disabled={!!busy} onChange={(e) => onAct('pay', () => hwApi.setPaymentStatus(p.id, e.target.value))} style={{ ...INPUT, height: 32, fontSize: 12 }}>
          {Object.keys(PAY_LABEL).map((k) => <option key={k} value={k}>{PAY_LABEL[k]}</option>)}
        </select>
      </Sect>

      <Sect title="Add Device Serial">
        <div style={{ display: 'flex', gap: 6 }}>
          <input value={dName} onChange={(e) => setDName(e.target.value)} placeholder="Device name" style={{ ...INPUT, flex: 1, height: 32, fontSize: 12 }} />
          <input value={dSerial} onChange={(e) => setDSerial(e.target.value)} placeholder="Serial #" style={{ ...INPUT, flex: 1, height: 32, fontSize: 12 }} />
        </div>
        <button className="btn ghost sm" style={{ marginTop: 6, width: '100%' }} disabled={!!busy || !dName.trim()} onClick={() => onAct('dev', async () => { await hwApi.addDevices(p.id, [{ deviceType: 'device', deviceName: dName.trim(), serialNumber: dSerial.trim() || null, quantity: 1 }]); setDName(''); setDSerial(''); })}>Add Device</button>
      </Sect>

      <Sect title="Add Internal Note">
        <textarea value={pNote} onChange={(e) => setPNote(e.target.value)} placeholder="Write a note…" style={{ ...INPUT, height: 50, minHeight: 40, fontSize: 12, padding: '6px 8px' }} />
        <button className="btn ghost sm" style={{ marginTop: 6, width: '100%' }} disabled={!!busy || !pNote.trim()} onClick={() => onAct('note', async () => { await hwApi.addNote(p.id, pNote); setPNote(''); })}>Add Note</button>
        {detail.notes.length ? <div style={{ marginTop: 8 }}>{detail.notes.slice(0, 3).map((n) => <div key={n.id} style={{ fontSize: 11.5, padding: '4px 0', borderTop: '1px solid var(--line)' }}>{n.note}<div style={{ fontSize: 10, color: 'var(--muted)' }}>{fmtDate(n.createdAt)}</div></div>)}</div> : null}
      </Sect>
    </aside>
  );
}

function Donut({ data, total, onPick }: { data: { status: string; count: number; pct: number }[]; total: number; onPick: (s: string) => void }) {
  if (data.every((d) => d.count === 0)) return <div style={{ fontSize: 12, color: 'var(--muted)' }}>No data yet.</div>;
  let acc = 0; const stops = data.map((d) => { const start = acc; acc += d.pct; return `${STATUS_DONUT[d.status] || '#E2C686'} ${start}% ${acc}%`; }).join(', ');
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
      <div style={{ width: 110, height: 110, borderRadius: '50%', background: `conic-gradient(${stops || '#EFEDEA 0% 100%'})`, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
        <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#FFFDF8', display: 'grid', placeItems: 'center', textAlign: 'center' }}>
          <div><div style={{ fontFamily: 'Playfair Display, serif', fontWeight: 800, fontSize: 17 }}>{total.toLocaleString()}</div><div style={{ fontSize: 9.5, color: 'var(--muted)' }}>Total</div></div>
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {data.map((d) => (
          <div key={d.status} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, padding: '2px 0', cursor: 'pointer' }} onClick={() => onPick(d.status)}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: STATUS_DONUT[d.status] || '#E2C686' }} />
            <span style={{ flex: 1 }}>{STATUS_LABEL[d.status] || d.status.replace('_', ' / ')}</span>
            <span style={{ fontWeight: 700 }}>{d.count.toLocaleString()} ({d.pct}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AssignModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [tenants, setTenants] = useState<{ id: string; name: string; code: string | null }[]>([]);
  const [f, setF] = useState<any>({ tenantId: '', packageType: 'pro', packageName: 'Pro Package', paymentStatus: 'pending', hardwareCost: '', depositAmount: '', financingTerms: '', shippingAddress: '', shippingCity: '', shippingState: '', shippingZip: '', shippingCarrier: 'fedex', trackingNumber: '', notes: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [dup, setDup] = useState(false);
  useEffect(() => { hwApi.listTenants().then(setTenants).catch(() => setTenants([])); }, []);
  const set = (k: string, v: string) => setF((p: any) => ({ ...p, [k]: v }));
  const submit = (force = false) => {
    if (!f.tenantId) { setErr('Please select a tenant.'); return; }
    if (!f.packageType || !f.packageName.trim()) { setErr('Package type and name are required.'); return; }
    setBusy(true); setErr(null);
    hwApi.create({ ...f, confirmDuplicate: force, hardwareCostCents: f.hardwareCost ? Math.round(Number(f.hardwareCost) * 100) : null, depositCents: f.depositAmount ? Math.round(Number(f.depositAmount) * 100) : null })
      .then(onSaved).catch((e: any) => { if (isDupErr(e)) { setDup(true); setErr('This tenant already has an active hardware package.'); } else setErr(errMsg(e)); }).finally(() => setBusy(false));
  };
  return (
    <Modal title="Assign Hardware Package" onClose={onClose}>
      {err ? <div style={{ color: '#C0392B', marginBottom: 10, fontSize: 12.5 }}>{err}</div> : null}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label style={lbl}>Tenant / Salon<select value={f.tenantId} onChange={(e) => set('tenantId', e.target.value)} style={INPUT}><option value="">{tenants.length ? 'Select tenant…' : 'No tenants available'}</option>{tenants.map((t) => <option key={t.id} value={t.id}>{t.name}{t.code ? ` (${t.code})` : ''}</option>)}</select></label>
        <label style={lbl}>Package Type<select value={f.packageType} onChange={(e) => { set('packageType', e.target.value); set('packageName', TYPE_LABEL[e.target.value] || f.packageName); }} style={INPUT}>{Object.keys(TYPE_LABEL).map((k) => <option key={k} value={k}>{TYPE_LABEL[k]}</option>)}</select></label>
        {Field('Package Name', f.packageName, (v) => set('packageName', v))}
        <label style={lbl}>Payment Status<select value={f.paymentStatus} onChange={(e) => set('paymentStatus', e.target.value)} style={INPUT}>{Object.keys(PAY_LABEL).map((k) => <option key={k} value={k}>{PAY_LABEL[k]}</option>)}</select></label>
        {Field('Hardware Cost ($)', f.hardwareCost, (v) => set('hardwareCost', v), 'number')}
        {Field('Deposit Amount ($)', f.depositAmount, (v) => set('depositAmount', v), 'number')}
        {Field('Financing Terms', f.financingTerms, (v) => set('financingTerms', v))}
        <label style={lbl}>Carrier<select value={f.shippingCarrier} onChange={(e) => set('shippingCarrier', e.target.value)} style={INPUT}>{Object.keys(CARRIER_LABEL).map((k) => <option key={k} value={k}>{CARRIER_LABEL[k]}</option>)}</select></label>
        {Field('Shipping Address', f.shippingAddress, (v) => set('shippingAddress', v))}
        {Field('Tracking Number', f.trackingNumber, (v) => set('trackingNumber', v))}
        {Field('City', f.shippingCity, (v) => set('shippingCity', v))}
        {Field('State', f.shippingState, (v) => set('shippingState', v))}
      </div>
      <label style={{ ...lbl, display: 'block', marginTop: 10 }}>Notes<textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} style={{ ...INPUT, minHeight: 56 }} /></label>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}><button className="btn ghost" onClick={onClose}>Cancel</button>{dup ? <button className="btn" disabled={busy} onClick={() => submit(true)}>{busy ? 'Saving…' : 'Assign anyway'}</button> : <button className="btn" disabled={busy} onClick={() => submit(false)}>{busy ? 'Saving…' : 'Assign Package'}</button>}</div>
    </Modal>
  );
}

function TrackingModal({ pkg, onClose, onSaved }: { pkg: HwPackage; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({ carrier: pkg.shippingCarrier || 'fedex', trackingNumber: pkg.trackingNumber || '', trackingUrl: pkg.trackingUrl || '', shippedDate: pkg.shippedAt?.slice(0, 10) || '', deliveredDate: pkg.deliveredAt?.slice(0, 10) || '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: string) => setF((p: any) => ({ ...p, [k]: v }));
  const submit = () => { setBusy(true); setErr(null); hwApi.updateTracking(pkg.id, f).then(onSaved).catch((e: any) => setErr(errMsg(e))).finally(() => setBusy(false)); };
  return (
    <Modal title="Update Tracking" onClose={onClose}>
      {err ? <div style={{ color: '#C0392B', marginBottom: 10, fontSize: 12.5 }}>{err}</div> : null}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label style={lbl}>Carrier<select value={f.carrier} onChange={(e) => set('carrier', e.target.value)} style={INPUT}>{Object.keys(CARRIER_LABEL).map((k) => <option key={k} value={k}>{CARRIER_LABEL[k]}</option>)}</select></label>
        {Field('Tracking Number', f.trackingNumber, (v) => set('trackingNumber', v))}
        {Field('Shipped Date', f.shippedDate, (v) => set('shippedDate', v), 'date')}
        {Field('Delivered Date', f.deliveredDate, (v) => set('deliveredDate', v), 'date')}
        {Field('Tracking URL', f.trackingUrl, (v) => set('trackingUrl', v))}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Save Tracking'}</button></div>
    </Modal>
  );
}

function EditModal({ pkg, onClose, onSaved }: { pkg: HwPackage; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>({
    packageName: pkg.packageName || '', packageType: pkg.packageType || 'standard',
    hardwareCost: pkg.hardwareCostCents != null ? String(pkg.hardwareCostCents / 100) : '', depositAmount: pkg.depositCents != null ? String(pkg.depositCents / 100) : '',
    amountPaid: pkg.amountPaidCents != null ? String(pkg.amountPaidCents / 100) : '', financingTerms: pkg.financingTerms || '',
    shippingAddress: pkg.shippingAddress || '', shippingCity: pkg.shippingCity || '', shippingState: pkg.shippingState || '', shippingZip: pkg.shippingZip || '',
  });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: string) => setF((p: any) => ({ ...p, [k]: v }));
  const submit = () => {
    if (!f.packageName.trim()) { setErr('Package name is required.'); return; }
    setBusy(true); setErr(null);
    hwApi.update(pkg.id, {
      packageName: f.packageName, packageType: f.packageType, financingTerms: f.financingTerms,
      shippingAddress: f.shippingAddress, shippingCity: f.shippingCity, shippingState: f.shippingState, shippingZip: f.shippingZip,
      hardwareCostCents: f.hardwareCost !== '' ? Math.round(Number(f.hardwareCost) * 100) : null,
      depositCents: f.depositAmount !== '' ? Math.round(Number(f.depositAmount) * 100) : null,
      amountPaidCents: f.amountPaid !== '' ? Math.round(Number(f.amountPaid) * 100) : null,
    }).then(onSaved).catch((e: any) => setErr(errMsg(e))).finally(() => setBusy(false));
  };
  return (
    <Modal title="Edit Hardware Package" onClose={onClose}>
      {err ? <div style={{ color: '#C0392B', marginBottom: 10, fontSize: 12.5 }}>{err}</div> : null}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {Field('Package Name', f.packageName, (v) => set('packageName', v))}
        <label style={lbl}>Package Type<select value={f.packageType} onChange={(e) => set('packageType', e.target.value)} style={INPUT}>{Object.keys(TYPE_LABEL).map((k) => <option key={k} value={k}>{TYPE_LABEL[k]}</option>)}</select></label>
        {Field('Hardware Cost ($)', f.hardwareCost, (v) => set('hardwareCost', v), 'number')}
        {Field('Deposit Amount ($)', f.depositAmount, (v) => set('depositAmount', v), 'number')}
        {Field('Amount Paid ($)', f.amountPaid, (v) => set('amountPaid', v), 'number')}
        {Field('Financing Terms', f.financingTerms, (v) => set('financingTerms', v))}
        {Field('Shipping Address', f.shippingAddress, (v) => set('shippingAddress', v))}
        {Field('City', f.shippingCity, (v) => set('shippingCity', v))}
        {Field('State', f.shippingState, (v) => set('shippingState', v))}
        {Field('ZIP', f.shippingZip, (v) => set('shippingZip', v))}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn" disabled={busy} onClick={submit}>{busy ? 'Saving…' : 'Save Changes'}</button></div>
    </Modal>
  );
}

const lbl: React.CSSProperties = { fontSize: 11.5, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.03em', display: 'flex', flexDirection: 'column', gap: 4 };

const Modal = ({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) => (
  <div className="modal" style={{ position: 'fixed', inset: 0, background: 'rgba(20, 16, 10, 0.65)', backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={onClose}>
    <div style={{ background: '#FFFDF8', borderRadius: 16, padding: 24, width: 'min(640px, 94vw)', maxHeight: '90vh', overflowY: 'auto', border: '1px solid var(--line)', boxShadow: '0 24px 70px rgba(0,0,0,0.45)' }} onClick={(e) => e.stopPropagation()}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: 10, marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{title}</h2>
        <button className="btn ghost sm" onClick={onClose}>✕</button>
      </div>
      {children}
    </div>
  </div>
);

const LabeledInput = ({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) => (
  <label style={lbl}>{label}<input type={type} value={value} onChange={(e) => onChange(e.target.value)} style={INPUT} /></label>
);
const Field = (label: string, value: string, onChange: (v: string) => void, type = 'text') => <LabeledInput key={label} label={label} value={String(value ?? '')} onChange={onChange} type={type} />;
const Sect = ({ title, children }: { title: string; children: React.ReactNode }) => (<div style={{ marginTop: 10 }}><div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 6 }}>{title}</div>{children}</div>);
const Row = ({ k, v, mono }: { k: string; v: string | null; mono?: boolean }) => (<div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0' }}><span style={{ color: 'var(--muted)' }}>{k}</span><span style={{ fontWeight: 600, textAlign: 'right', fontFamily: mono ? 'ui-monospace, monospace' : 'inherit' }}>{v || '—'}</span></div>);

const INPUT: React.CSSProperties = {
  height: 36,
  border: '1px solid var(--line)',
  borderRadius: 8,
  padding: '0 10px',
  background: '#FFFFFF',
  fontFamily: 'inherit',
  fontSize: 12.5,
  color: 'var(--text)',
  boxSizing: 'border-box',
};
