import { useEffect, useMemo, useState } from 'react';
import { superAdminApi, type CatalogOverview, type CatalogListResult, type CatalogTemplateDetail } from '../api/superAdminApi';
import { Donut, MiniBars, money, dd } from './_chartkit';
import { TemplateFormModal, RetireModal } from './TemplateModals';
import { OrganizeCategoriesModal, ConfigureDurationModal, TemplatePickerModal } from './CatalogConfigModals';
import { DeployModal, CompareModal, PublishedTemplatePickerModal } from './DeployModals';

// ServiceTemplatesScreen.tsx — Super Admin › Catalog Management › Service Templates. Platform-level MASTER service
// templates tenants can copy into their own catalogs without overwriting tenant custom services. Read-only surface
// (Unit 2): KPIs, category chips, filterable/paginated library table, right-side snapshots, and bottom analytics — all
// wired to GET /super-admin/catalog/service-templates[/overview]. Honest rendering: no fabricated trend deltas; gaps
// render "—"/empty. Super Admin Actions are present and light up in later units.

const dur = (m: number) => (m ? `${m} min` : '—');
const range = (min: number, max: number) => (max > 0 ? `${money(min)} – ${money(max)}` : '—');

const SUPER_ADMIN_ACTIONS = [
  'Create Service Templates', 'Edit Template Descriptions', 'Organize Categories', 'Configure Suggested Duration',
  'Configure Optional Add-Ons', 'Publish Templates', 'Retire Old Templates', 'Deploy Templates to Selected Tenants',
  'Allow Tenants to Customize Copied Templates', 'Compare Tenant Service Configurations',
];


function StatusBadge({ s }: { s: string }) {
  const map: Record<string, [string, string, string]> = {
    published: ['#E7F2EA', '#2F6B43', '#BFE0CB'], draft: ['#EEF2F8', '#3A557E', '#CFDBEC'], retired: ['#F3EEE7', '#7A6A55', '#E0D6C7'],
  };
  const [bg, fg, bd] = map[s] ?? ['#EEE', '#555', '#DDD'];
  return <span style={{ display: 'inline-block', padding: '1px 9px', borderRadius: 999, background: bg, color: fg, border: `1px solid ${bd}`, fontSize: 11, fontWeight: 700, textTransform: 'capitalize' }}>{s}</span>;
}

const sel: React.CSSProperties = { height: 34, borderRadius: 9, border: '1px solid var(--line)', background: '#fff', padding: '0 8px', fontSize: 12.5, color: 'var(--text)' };

export function ServiceTemplatesScreen() {
  const [ov, setOv] = useState<CatalogOverview | null>(null);
  const [list, setList] = useState<CatalogListResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [usage, setUsage] = useState('');
  const [serviceType, setServiceType] = useState('');
  const [commission, setCommission] = useState('');
  const [tax, setTax] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [bump, setBump] = useState(0);
  const [modal, setModal] = useState<null | { kind: 'create' } | { kind: 'edit'; detail: CatalogTemplateDetail } | { kind: 'retire'; template: { id: string; name: string; deploymentCount: number } } | { kind: 'categories' } | { kind: 'duration' } | { kind: 'addonPicker' } | { kind: 'deploy'; template: { id: string; name: string } } | { kind: 'compare'; template: { id: string; name: string } } | { kind: 'deployPicker' } | { kind: 'comparePicker' } | { kind: 'customizePicker' }>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [widgetOpen, setWidgetOpen] = useState(false);
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable');
  const [hiddenCols, setHiddenCols] = useState<Record<string, boolean>>({});
  const [widgets, setWidgets] = useState<Record<string, boolean>>({});

  const currentFilters = () => ({
    ...(category ? { category } : {}), ...(status ? { status } : {}), ...(usage ? { usage } : {}),
    ...(serviceType ? { serviceType } : {}), ...(commission ? { commission } : {}), ...(tax ? { tax } : {}),
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
  });

  const exportReport = async () => {
    setExporting(true); setNotice(null);
    try {
      const r = await superAdminApi.catalogExport(currentFilters());
      const blob = new Blob([r.csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = r.filename; a.click();
      URL.revokeObjectURL(url);
      setNotice(`Exported ${r.rowCount} template(s) to ${r.filename}.`);
    } catch (e: any) { setNotice(e?.message || 'Export failed'); }
    finally { setExporting(false); }
  };

  const reloadOverview = () => superAdminApi.catalogOverview().then((d) => setOv(d as CatalogOverview)).catch(() => {});
  const reloadAll = () => { reloadOverview(); setBump((b) => b + 1); };

  const openEdit = async (id: string) => {
    setOpenMenuId(null);
    try { const d = await superAdminApi.catalogTemplate(id); setModal({ kind: 'edit', detail: d as CatalogTemplateDetail }); }
    catch (e: any) { setNotice(e?.message || 'Failed to load template'); }
  };
  const doPublish = async (id: string, name: string) => {
    setOpenMenuId(null);
    try { await superAdminApi.catalogPublish(id); setNotice(`"${name}" published.`); reloadAll(); }
    catch (e: any) { setNotice(e?.message || 'Publish failed'); }
  };

  useEffect(() => { superAdminApi.catalogOverview().then((d) => setOv(d as CatalogOverview)).catch((e: any) => setError(e?.message || 'Failed to load catalog.')); }, []);
  useEffect(() => { const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 350); return () => clearTimeout(t); }, [search]);

  useEffect(() => {
    setListErr(null);
    superAdminApi.catalogTemplates({
      page, pageSize,
      ...(category ? { category } : {}), ...(status ? { status } : {}), ...(usage ? { usage } : {}),
      ...(serviceType ? { serviceType } : {}), ...(commission ? { commission } : {}), ...(tax ? { tax } : {}),
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
    }).then((d) => setList(d as CatalogListResult)).catch((e: any) => setListErr(e?.message || 'Failed to load templates.'));
  }, [category, status, usage, serviceType, commission, tax, debouncedSearch, page, pageSize, bump]);

  const resetFilters = () => { setCategory(''); setStatus(''); setUsage(''); setServiceType(''); setCommission(''); setTax(''); setSearch(''); setPage(1); };

  const kpis = useMemo(() => {
    if (!ov) return [];
    const k = ov.kpis;
    return [
      { l: 'Total Templates', v: k.totalTemplates.toLocaleString() },
      { l: 'Active Categories', v: k.activeCategories.toLocaleString() },
      { l: 'Published Templates', v: k.publishedTemplates.toLocaleString() },
      { l: 'Draft Templates', v: k.draftTemplates.toLocaleString() },
      { l: 'Retired Templates', v: k.retiredTemplates.toLocaleString() },
      { l: 'Tenants Using Templates', v: k.tenantsUsingTemplates.toLocaleString() },
      { l: 'Avg Suggested Duration', v: k.avgSuggestedDurationMinutes ? `${k.avgSuggestedDurationMinutes} min` : '—' },
      { l: 'Template Deployments', v: k.templateDeployments.toLocaleString() },
      { l: 'Add-On Enabled Templates', v: k.addOnEnabledTemplates.toLocaleString() },
      { l: 'Commission Eligible Templates', v: k.commissionEligibleTemplates.toLocaleString() },
      { l: 'Price-Range Configured', v: k.priceRangeConfigured.toLocaleString() },
      { l: 'Version Updates This Month', v: k.versionUpdatesThisMonth.toLocaleString() },
    ];
  }, [ov]);

  if (error) return <div className="screen"><div className="state">{error}</div></div>;
  if (!ov) return <div className="screen"><div className="state">Loading catalog…</div></div>;

  const totalPages = list ? Math.max(1, Math.ceil(list.total / list.pageSize)) : 1;
  const adopt = ov.tenantAdoption;
  const tc = ov.taxCommission;

  const summaryStrip = [
    { l: 'Total Templates', v: ov.kpis.totalTemplates.toLocaleString() },
    { l: 'Avg Tenant Adoption', v: `${ov.avgTenantAdoptionPct}%` },
    { l: 'Active Categories', v: ov.kpis.activeCategories.toLocaleString() },
    { l: 'Template Deployments', v: ov.kpis.templateDeployments.toLocaleString() },
    { l: 'Add-On Enabled Templates', v: ov.kpis.addOnEnabledTemplates.toLocaleString() },
    { l: 'Commission Eligible', v: `${tc.commissionEligibleCount} (${tc.commissionEligiblePct}%)` },
    { l: 'Deployment Success Rate', v: '—' },
  ];

  return (
    <div className="screen p-5" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header */}
      <div className=" flex flex-col lg:flex-row justify-between gap-3" >
        <div className="vh"><h1 >Catalog Management<span title="Platform module " style={{ color: 'var(--g7,#A96F22)' }}>★</span></h1><div className="sub">Manage optional platform-level service templates that tenants can copy into their own service catalogs without overwriting tenant custom services.</div></div>
        <div className='self-baseline' style={{ display: 'flex', gap: 8, position: 'relative' }}>
          <button className="btn ghost" onClick={exportReport} disabled={exporting}>{exporting ? 'Exporting…' : '⭳ Export Report'}</button>
          <button className="btn" onClick={() => setWidgetOpen((v) => !v)}>+ Add Widget</button>
          {widgetOpen && (
            <div style={{ position: 'absolute', right: 0, top: 40, zIndex: 30, background: '#fff', border: '1px solid var(--line)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.14)', minWidth: 220, padding: 8 }}>
              <div className="muted" style={{ fontSize: 10.5, padding: '2px 6px 6px' }}>Add a dashboard widget (this session)</div>
              {[['statusBreakdown', 'Status Breakdown'], ['taxSplit', 'Tax Split']].map(([k, label]) => (
                <label key={k} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px', fontSize: 12.5, cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!widgets[k]} onChange={(e) => setWidgets((w) => ({ ...w, [k]: e.target.checked }))} />{label}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
      {notice && <div className="state" style={{ background: 'var(--warn-bg,#FCEFD9)', color: 'var(--warn,#9A6A12)', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 12px', fontSize: 12.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}><span>{notice}</span><button className="btn ghost" style={{ height: 26 }} onClick={() => setNotice(null)}>Dismiss</button></div>}

      {/* Filter row */}
      <section className="panel" style={{ padding: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <label style={{ display: 'grid', gap: 2, fontSize: 10.5, color: 'var(--muted)' }}>Category
            <select style={sel} value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }}>
              <option value="">All Categories</option>
              {ov.categoryChips.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 2, fontSize: 10.5, color: 'var(--muted)' }}>Template Status
            <select style={sel} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
              <option value="">All Statuses</option><option value="published">Published</option><option value="draft">Draft</option><option value="retired">Retired</option>
            </select>
          </label>
          <label style={{ display: 'grid', gap: 2, fontSize: 10.5, color: 'var(--muted)' }}>Tenant Usage
            <select style={sel} value={usage} onChange={(e) => { setUsage(e.target.value); setPage(1); }}>
              <option value="">All Tenants</option><option value="using">In Use</option><option value="unused">Not Deployed</option>
            </select>
          </label>
          <label style={{ display: 'grid', gap: 2, fontSize: 10.5, color: 'var(--muted)' }}>Service Type
            <select style={sel} value={serviceType} onChange={(e) => { setServiceType(e.target.value); setPage(1); }}>
              <option value="">All Types</option><option value="individual">Individual Service</option><option value="package">Combination Package</option>
            </select>
          </label>
          <label style={{ display: 'grid', gap: 2, fontSize: 10.5, color: 'var(--muted)' }}>Commission Eligibility
            <select style={sel} value={commission} onChange={(e) => { setCommission(e.target.value); setPage(1); }}>
              <option value="">All</option><option value="yes">Eligible</option><option value="no">Not Eligible</option>
            </select>
          </label>
          <label style={{ display: 'grid', gap: 2, fontSize: 10.5, color: 'var(--muted)' }}>Tax Setting
            <select style={sel} value={tax} onChange={(e) => { setTax(e.target.value); setPage(1); }}>
              <option value="">All</option><option value="taxable">Taxable</option><option value="non_taxable">Non-Taxable</option>
            </select>
          </label>
          <button className="btn ghost" style={{ marginLeft: 'auto', height: 34 }} onClick={resetFilters}>↺ Reset Filters</button>
        </div>
      </section>

      {/* KPI cards */}
      <div className="kpis grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5">
        {kpis.map((kp) => (<div className="kpi" key={kp.l}><div className="l">{kp.l}</div><div className="v">{kp.v}</div></div>))}
      </div>

      {/* Category chips */}
      <section className="panel" style={{ padding: 12 }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 13 }}>Template Categories</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {ov.categoryChips.map((c) => {
            const active = category === c.code;
            return <button key={c.code} onClick={() => { setCategory(active ? '' : c.code); setPage(1); }} style={{ padding: '5px 12px', borderRadius: 999, border: `1px solid ${active ? 'var(--gold,#A96F22)' : 'var(--line)'}`, background: active ? 'var(--gold,#A96F22)' : '#fff', color: active ? '#fff' : 'var(--text)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{c.name}{c.templateCount > 0 && <span style={{ opacity: 0.7, marginLeft: 5 }}>{c.templateCount}</span>}</button>;
          })}
        </div>
      </section>

      {/* Optional added widgets (session) */}
      {(widgets.statusBreakdown || widgets.taxSplit) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 14 }}>
          {widgets.statusBreakdown && <section className="panel"><h2 style={{ marginTop: 0, fontSize: 13 }}>Status Breakdown <span className="muted" style={{ fontSize: 10 }}>(session widget)</span></h2><MiniBars data={[{ label: 'Published', value: ov.kpis.publishedTemplates }, { label: 'Draft', value: ov.kpis.draftTemplates }, { label: 'Retired', value: ov.kpis.retiredTemplates }]} emptyHint="No templates." /></section>}
          {widgets.taxSplit && <section className="panel"><h2 style={{ marginTop: 0, fontSize: 13 }}>Tax Split <span className="muted" style={{ fontSize: 10 }}>(session widget)</span></h2><Donut data={[{ label: 'Taxable', value: tc.taxableCount }, { label: 'Non-Taxable', value: tc.nonTaxableCount }]} centerLabel={`${tc.taxablePct}%`} /></section>}
        </div>
      )}

      {/* Main: table (2fr) + right panels (1fr) */}
     <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)] gap-3.5 items-start">
        {/* Library table */}
        <section className="panel">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5 mb-2.5">
            <h2 style={{ margin: 0, fontSize: 14 }}>Service Template Library <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>{list ? `${list.total} Templates` : ''}</span></h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <input placeholder="Search templates…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...sel, width: 200 }} />
              <div style={{ position: 'relative' }}>
                <button
  className=" whitespace-nowrap border border-[#C28A34] bg-[var(--grad)] text-[#2C2118] rounded-[10px] px-[14px] py-2 text-xs font-extrabold cursor-pointer font-inherit"
  onClick={() => setViewOpen((v) => !v)}
>
  View Options ▾
</button>
                {viewOpen && (
                  <div style={{ position: 'absolute', right: 0, top: 38, zIndex: 30, background: '#fff', border: '1px solid var(--line)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.14)', minWidth: 210, padding: 10 }}>
                    <div className="muted" style={{ fontSize: 10.5, marginBottom: 5 }}>Density</div>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                      {(['comfortable', 'compact'] as const).map((d) => <button key={d} className="btn ghost" style={{ height: 26, flex: 1, borderColor: density === d ? 'var(--gold,#A96F22)' : 'var(--line)' }} onClick={() => setDensity(d)}>{d}</button>)}
                    </div>
                    <div className="muted" style={{ fontSize: 10.5, marginBottom: 5 }}>Columns</div>
                    {[['resources', 'Required Resources'], ['addons', 'Add-Ons'], ['version', 'Version']].map(([k, label]) => (
                      <label key={k} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', fontSize: 12.5, cursor: 'pointer' }}>
                        <input type="checkbox" checked={!hiddenCols[k]} onChange={(e) => setHiddenCols((h) => ({ ...h, [k]: !e.target.checked }))} />{label}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          {listErr ? <div className="state">{listErr}</div> : !list ? <div className="state">Loading templates…</div> : list.rows.length === 0 ? <div className="state">No templates match the current filters.</div> : (
            <div className="w-full max-w-full overflow-x-auto">
              <table className="w-full min-w-[1100px] text-xs">
                <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10.5 }}>
                  <th style={{ padding: '6px 8px' }}>Template Name</th><th>Category</th><th>Suggested Duration</th><th>Suggested Price Range</th>{!hiddenCols.resources && <th>Required Resources</th>}<th>Tax Settings</th><th style={{ textAlign: 'center' }}>Commission</th>{!hiddenCols.addons && <th style={{ textAlign: 'center' }}>Add-Ons</th>}<th style={{ textAlign: 'center' }}>Tenant Usage</th>{!hiddenCols.version && <th>Version</th>}<th>Status</th><th style={{ textAlign: 'center' }}>Actions</th>
                </tr></thead>
                <tbody>
                  {list.rows.map((r) => (
                    <tr key={r.id} style={{ borderTop: '1px solid var(--line)' }}>
                      <td style={{ padding: density === 'compact' ? '3px 8px' : '7px 8px', fontWeight: 600 }}>{r.name}</td>
                      <td className="muted">{r.categoryName ?? '—'}</td>
                      <td>{dur(r.durationMinutes)}</td>
                      <td>{range(r.priceMinCents, r.priceMaxCents)}</td>
                      {!hiddenCols.resources && <td className="muted" style={{ maxWidth: 170 }}>{r.resources.length ? r.resources.map((x) => `${x.label} (${x.quantity})`).join(', ') : '—'}</td>}
                      <td>{r.taxSetting === 'non_taxable' ? 'Non-Taxable' : 'Taxable'}</td>
                      <td style={{ textAlign: 'center' }}>{r.commissionEligible ? <span style={{ color: '#2F6B43' }}>✓</span> : <span style={{ color: '#B85B4D' }}>✕</span>}</td>
                      {!hiddenCols.addons && <td style={{ textAlign: 'center' }}>{r.addonCount}</td>}
                      <td style={{ textAlign: 'center' }}>{r.activeTenantUsage}</td>
                      {!hiddenCols.version && <td className="muted">{r.versionLabel}</td>}
                      <td><StatusBadge s={r.status} /></td>
                      <td style={{ textAlign: 'center', position: 'relative' }}>
                        <button className=""  onClick={() => setOpenMenuId(openMenuId === r.id ? null : r.id)}>⋮</button>
                        {openMenuId === r.id && (
                          <div style={{ position: 'absolute', right: 8, top: 28, zIndex: 20, background: '#fff', border: '1px solid var(--line)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.14)', minWidth: 150, textAlign: 'left', overflow: 'hidden' }}>
                            <MenuItem label="Edit template" onClick={() => openEdit(r.id)} />
                            {r.status === 'draft' && <MenuItem label="Publish" onClick={() => doPublish(r.id, r.name)} />}
                            {r.status !== 'retired' && <MenuItem label="Retire" onClick={() => { setOpenMenuId(null); setModal({ kind: 'retire', template: { id: r.id, name: r.name, deploymentCount: r.activeTenantUsage } }); }} />}
                            <MenuItem label="Deploy to tenants" onClick={() => { setOpenMenuId(null); if (r.status === 'published') setModal({ kind: 'deploy', template: { id: r.id, name: r.name } }); else setNotice('Only published templates can be deployed. Publish it first.'); }} />
                            <MenuItem label="Compare tenant configs" onClick={() => { setOpenMenuId(null); setModal({ kind: 'compare', template: { id: r.id, name: r.name } }); }} />
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {list && list.total > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, fontSize: 12 }}>
              <span className="muted">Showing {(list.page - 1) * list.pageSize + 1}–{Math.min(list.page * list.pageSize, list.total)} of {list.total} templates</span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button className="btn ghost" style={{ height: 28 }} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹</button>
                <span>Page {list.page} / {totalPages}</span>
                <button className="btn ghost" style={{ height: 28 }} disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>›</button>
                <select style={{ ...sel, height: 28 }} value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
                  {[10, 25, 50].map((n) => <option key={n} value={n}>{n} / page</option>)}
                </select>
              </div>
            </div>
          )}
        </section>

        {/* Right-side panels */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <section className="panel">
            <h2 style={{ margin: '0 0 8px', fontSize: 14 }}>Super Admin Actions</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-1 gap-[7px]">
              {SUPER_ADMIN_ACTIONS.map((a) => {
                const handler =
                  a === 'Create Service Templates' ? () => setModal({ kind: 'create' })
                  : a === 'Organize Categories' ? () => setModal({ kind: 'categories' })
                  : a === 'Configure Suggested Duration' ? () => setModal({ kind: 'duration' })
                  : a === 'Configure Optional Add-Ons' ? () => setModal({ kind: 'addonPicker' })
                  : a === 'Deploy Templates to Selected Tenants' ? () => setModal({ kind: 'deployPicker' })
                  : a === 'Allow Tenants to Customize Copied Templates' ? () => setModal({ kind: 'customizePicker' })
                  : a === 'Compare Tenant Service Configurations' ? () => setModal({ kind: 'comparePicker' })
                  : a === 'Publish Templates' ? () => { setStatus('draft'); setPage(1); setNotice('Filtered to Draft templates — use a row\u2019s ⋮ menu to publish.'); }
                  : a === 'Retire Old Templates' ? () => { setStatus('published'); setPage(1); setNotice('Filtered to Published templates — use a row\u2019s ⋮ menu to retire.'); }
                  : a === 'Edit Template Descriptions' ? () => setNotice('Use a row\u2019s ⋮ menu → Edit template to change its description.')
                  : () => setNotice(`"${a}" is wired in an upcoming unit.`);
                return <button key={a} className="btn ghost" style={{ height: 32, justifyContent: 'flex-start', fontSize: 12.5, textAlign: 'left' }} onClick={handler}>{a}</button>;
              })}
            </div>
          </section>
          <section className="panel" style={{ borderColor: 'var(--gold,#A96F22)' }}>
            <h2 style={{ margin: '0 0 6px', fontSize: 13, color: 'var(--gold,#A96F22)' }}>⚠ Important Distinction</h2>
            <div style={{ fontSize: 12.5, color: 'var(--text)' }}>A Super Admin template should not overwrite a tenant's custom service without permission.</div>
          </section>
          <section className="panel">
            <h2 style={{ margin: '0 0 8px', fontSize: 14 }}>Resources &amp; Add-Ons Snapshot</h2>
            <Row2 l="Unique Resources" v={ov.resourcesSnapshot.uniqueResources.toLocaleString()} />
            <Row2 l="Most Used Resource" v={ov.resourcesSnapshot.mostUsedResource ?? '—'} />
            <Row2 l="Total Add-On Options" v={ov.resourcesSnapshot.totalAddOnOptions.toLocaleString()} />
            <Row2 l="Avg Add-Ons per Template" v={String(ov.resourcesSnapshot.avgAddOnsPerTemplate)} />
          </section>
          <section className="panel">
            <h2 style={{ margin: '0 0 8px', fontSize: 14 }}>Tax &amp; Commission Configuration</h2>
            <Row2 l="Taxable Templates" v={`${tc.taxableCount} (${tc.taxablePct}%)`} />
            <Row2 l="Non-Taxable Templates" v={`${tc.nonTaxableCount} (${tc.nonTaxablePct}%)`} />
            <Row2 l="Commission Eligible" v={`${tc.commissionEligibleCount} (${tc.commissionEligiblePct}%)`} />
            <Row2 l="Commission Not Eligible" v={`${tc.commissionNotEligibleCount} (${tc.commissionNotEligiblePct}%)`} />
          </section>
        </div>
      </div>

      {/* Bottom analytics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3.5 items-start">
        <section className="panel"><h2 style={{ marginTop: 0, marginBottom:20, fontSize: 13 }}>Template Usage by Category</h2><Donut data={ov.usageByCategory} centerLabel={String(ov.kpis.totalTemplates)} /></section>
        <section className="panel"><h2 style={{ marginTop: 0, marginBottom:20, fontSize: 13 }}>Tenant Adoption Overview</h2>
          <MiniBars data={[{ label: 'Adopted', value: adopt.adopted }, { label: 'Partial', value: adopt.partial }, { label: 'Not Adopted', value: adopt.notAdopted }]} emptyHint="No deployments yet." />
          <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Total Tenants: {adopt.totalTenants}</div>
        </section>
        <section className="panel"><h2 style={{ marginTop: 0, marginBottom:20, fontSize: 13 }}>Suggested Price Range Distribution</h2><MiniBars data={ov.priceRangeDistribution.map((b) => ({ label: b.label, value: b.value }))} emptyHint="No price ranges configured." /></section>
        <section className="panel"><h2 style={{ marginTop: 0, marginBottom:20, fontSize: 13 }}>Version History &amp; Change Log</h2>
          {ov.recentVersions.length === 0 ? <div className="state" style={{ fontSize: 12 }}>No version history yet.</div> : (
            <div style={{ display: 'grid', gap: 7 }}>
              {ov.recentVersions.map((v, i) => (
                <div key={i} style={{ fontSize: 12 }}>
                  <div style={{ fontWeight: 600 }}>{v.templateName} <span className="muted" style={{ fontWeight: 400 }}>{v.versionLabel ?? ''}</span></div>
                  <div className="muted" style={{ fontSize: 11 }}>{v.changeReason ?? '—'} · {dd(v.createdAt)}</div>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="panel"><h2 style={{ marginTop: 0, fontSize: 13 }}>Compare Tenant Service Configurations</h2>
          {ov.tenantCompare.length === 0 ? <div className="state" style={{ fontSize: 12 }}>No tenant deployments yet.</div> : (
            <table className="tgrid" style={{ width: '100%', fontSize: 11.5 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10 }}><th>Tenant</th><th style={{ textAlign: 'right' }}>Copied</th><th style={{ textAlign: 'right' }}>Cust.</th><th style={{ textAlign: 'right' }}>%</th></tr></thead>
              <tbody>{ov.tenantCompare.map((c, i) => (<tr key={i}><td style={{ fontWeight: 600 }}>{c.tenantName}</td><td style={{ textAlign: 'right' }}>{c.copied}</td><td style={{ textAlign: 'right' }}>{c.customized}</td><td style={{ textAlign: 'right' }}>{c.customizationPct}%</td></tr>))}</tbody>
            </table>
          )}
        </section>
      </div>

      {/* Bottom summary strip */}
      <div className="kpis p-7 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-2.5">
        {summaryStrip.map((kp) => (<div className="kpi" key={kp.l}><div className="l">{kp.l}</div><div className="v">{kp.v}</div></div>))}
      </div>

      {modal?.kind === 'create' && <TemplateFormModal categories={ov.categoryChips} onClose={() => setModal(null)} onSaved={() => { setModal(null); setNotice('Template created (draft).'); reloadAll(); }} />}
      {modal?.kind === 'edit' && <TemplateFormModal categories={ov.categoryChips} existing={modal.detail} onClose={() => setModal(null)} onSaved={() => { setModal(null); setNotice('Template updated.'); reloadAll(); }} />}
      {modal?.kind === 'retire' && <RetireModal template={modal.template} onClose={() => setModal(null)} onDone={() => { setModal(null); setNotice('Template retired.'); reloadAll(); }} />}
      {modal?.kind === 'categories' && <OrganizeCategoriesModal onClose={() => setModal(null)} onChanged={reloadAll} />}
      {modal?.kind === 'duration' && <ConfigureDurationModal onClose={() => setModal(null)} onChanged={reloadAll} />}
      {modal?.kind === 'addonPicker' && <TemplatePickerModal title="Configure Optional Add-Ons" hint="Pick a template to manage its optional add-ons." onClose={() => setModal(null)} onPick={(id) => openEdit(id)} />}
      {modal?.kind === 'deploy' && <DeployModal template={modal.template} onClose={() => setModal(null)} onDone={reloadAll} />}
      {modal?.kind === 'compare' && <CompareModal template={modal.template} onClose={() => setModal(null)} onChanged={reloadAll} />}
      {modal?.kind === 'deployPicker' && <PublishedTemplatePickerModal title="Deploy Templates to Selected Tenants" hint="Pick a published template to deploy." onClose={() => setModal(null)} onPick={(t) => setModal({ kind: 'deploy', template: t })} />}
      {modal?.kind === 'comparePicker' && <PublishedTemplatePickerModal title="Compare Tenant Service Configurations" hint="Pick a template to compare tenant copies." onClose={() => setModal(null)} onPick={(t) => setModal({ kind: 'compare', template: t })} />}
      {modal?.kind === 'customizePicker' && <PublishedTemplatePickerModal title="Allow Tenants to Customize Copied Templates" hint="Pick a template, then toggle per-tenant customization." onClose={() => setModal(null)} onPick={(t) => setModal({ kind: 'compare', template: t })} />}
    </div>
  );
}

function MenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return <button onClick={onClick} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: 12.5, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)' }} onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--cream2,#FAF6EF)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}>{label}</button>;
}

function Row2({ l, v }: { l: string; v: string }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12.5, padding: '3px 0' }}><span className="muted">{l}</span><span style={{ fontWeight: 600 }}>{v}</span></div>;
}
