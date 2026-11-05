import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { superAdminApi } from '../api/superAdminApi';
import { Donut, Gauge, MiniBars, money, moneyK, dt } from './_chartkit';

// ServicesScreen.tsx — S06 Super Admin › Services Management. Full mockup layout, every module wired to real Postgres
// (GET /super-admin/platform/services): KPIs, monthly performance, category donut, catalog-health gauge, the catalog
// table, top/low performers, recent activity, and a stat strip — all from real data. Modules with no real source in
// the schema (AI insights = no ML; service packages = no packages table; margin/bundle/rating with no data) show
// honest "—/no data yet/not connected" states rather than fabricated numbers. Zero hardcoded metrics.

type Row = { id: string; name: string; durationMinutes: number | null; priceCents: number | null; commissionType: string | null; commissionValue: number | null; onlineBooking: boolean; status: string; tenantId: string; tenantName: string | null; category: string };
type Perf = { name: string; bookings: number; revenueCents: number };
type State = {
  rows: Row[]; total: number;
  kpis: { totalServices: number; activeServices: number; categories: number; avgPriceCents: number; avgDurationMinutes: number; onlineBookable: number; bookingsThisMonth: number; revenueCentsThisMonth: number; bookingsTotal: number; revenueCentsTotal: number; avgRating: number; reviewCount: number };
  byCategory: { category: string; count: number }[]; byStatus: { status: string; count: number }[];
  catalogHealth: { active: number; inactive: number; needsUpdate: number; missingInfo: number };
  monthly: { month: string; bookings: number; revenueCents: number }[];
  topServices: Perf[]; lowServices: Perf[];
  recentActivity: { name: string; action: string; at: string | null; tenantName: string | null }[];
  packages: any[];
  pricing: { avgCents: number; highestCents: number | null; highestName: string | null; lowestCents: number | null; lowestName: string | null };
  healthPct: number | null;
  topByRevenue: Perf[];
  staffAvailability: { name: string; tenantName: string | null; servicesOffered: number; utilizationPct: number | null }[];
};


export function ServicesScreen() {
  const nav = useNavigate();
  const [st, setSt] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [catOpen, setCatOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);

  const load = () => {
    (superAdminApi.platformServices({ pageSize: 100, ...(category ? { category } : {}), ...(status ? { status } : {}), ...(q ? { search: q } : {}) }) as Promise<State>)
      .then(setSt).catch((e: any) => setError(e?.message || 'Failed to load services.'));
  };
  useEffect(load, [category, status]);

  const allCats = useMemo(() => (st?.byCategory || []).map((c) => c.category).filter((c) => c && c !== 'Uncategorized'), [st]);

  if (error) return <div className="screen"><div className="state">{error}</div></div>;
  if (!st) return <div className="screen"><div className="state">Loading services…</div></div>;

  const k = st.kpis;
  const healthTotal = st.catalogHealth.active + st.catalogHealth.inactive;
  const healthPct = st.healthPct != null ? Math.round(st.healthPct) : (healthTotal ? Math.round((st.catalogHealth.active / healthTotal) * 100) : 0);
  const kpis = [
    { l: 'Total Services', v: k.totalServices.toLocaleString() },
    { l: 'Active Services', v: k.activeServices.toLocaleString() },
    { l: 'Categories', v: k.categories.toLocaleString() },
    { l: 'Avg Service Price', v: money(k.avgPriceCents) },
    { l: 'Bookings (This Month)', v: k.bookingsThisMonth.toLocaleString() },
    { l: 'Revenue (This Month)', v: money(k.revenueCentsThisMonth) },
  ];

  return (
    <div
      className="screen p-5"
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
    >
      <div className=" flex flex-col lg:flex-row justify-between gap-3">
        <div className="vh">
          <h1>Services Management</h1>
          <div className="sub">
            Manage global service templates, categories, defaults, tenant
            adoption, and platform performance.
          </div>
        </div>
        <div className="self-baseline" style={{ display: "flex", gap: 8 }}>
          <button className="btn ghost" onClick={() => nav("/analytics")}>
            Export Report
          </button>
          <button
            className="btn"
            onClick={() =>
              setNotice(
                "Add New Service creates a global service template — the global-template authoring workflow isn’t built yet.",
              )
            }
          >
            Add New Service
          </button>
        </div>
      </div>
      {notice && (
        <div
          className="state"
          style={{
            background: "var(--warn-bg,#FCEFD9)",
            color: "var(--warn,#9A6A12)",
            border: "1px solid var(--line)",
            borderRadius: 8,
            padding: "8px 12px",
            fontSize: 12.5,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span>{notice}</span>
          <button
            className="btn ghost"
            style={{ height: 26 }}
            onClick={() => setNotice(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="kpis">
        {kpis.map((kp) => (
          <div className="kpi" key={kp.l}>
            <div className="l">{kp.l}</div>
            <div className="v">{kp.v}</div>
          </div>
        ))}
      </div>

      {/* Performance · Category · Health */}
      <div className=" grid grid-cols-1 sm:grid-cols-2  xl:grid-cols-3 gap-2.5">
        <section className="panel">
          <h2>Service Performance Overview</h2>
          <MiniBars
            data={st.monthly.map((m) => ({
              label: m.month,
              value: m.bookings,
              tip: `${m.bookings} bookings · ${money(m.revenueCents)}`,
            }))}
            emptyHint="No booking history yet — performance populates as services are booked."
          />
        </section>
        <section className="panel">
          <h2>Services by Category</h2>
          <Donut
            data={st.byCategory.map((c) => ({
              label: c.category,
              value: c.count,
            }))}
          />
        </section>
        <section className="panel">
          <h2>Service Catalog Health</h2>
          <Gauge
            pct={healthPct}
            label={healthPct >= 80 ? "Healthy" : "Needs attention"}
          />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 6,
              marginTop: 8,
              fontSize: 12,
            }}
          >
            <div
              className="arow"
              style={{ display: "flex", justifyContent: "space-between" }}
            >
              <span className="muted">Active</span>
              <b>{st.catalogHealth.active}</b>
            </div>
            <div
              className="arow"
              style={{ display: "flex", justifyContent: "space-between" }}
            >
              <span className="muted">Inactive</span>
              <b>{st.catalogHealth.inactive}</b>
            </div>
            <div
              className="arow"
              style={{ display: "flex", justifyContent: "space-between" }}
            >
              <span className="muted">Needs update</span>
              <b>{st.catalogHealth.needsUpdate}</b>
            </div>
            <div
              className="arow"
              style={{ display: "flex", justifyContent: "space-between" }}
            >
              <span className="muted">Missing info</span>
              <b>{st.catalogHealth.missingInfo}</b>
            </div>
          </div>
        </section>
      </div>

      {/* Pricing Overview · Staff Service Availability */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        <section className="panel">
          <h2>Pricing Overview</h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
              marginTop: 4,
            }}
          >
            <div
              style={{
                border: "1px solid var(--line)",
                borderRadius: 10,
                padding: 12,
              }}
            >
              <div className="muted" style={{ fontSize: 11 }}>
                Average Price
              </div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>
                {money(st.pricing.avgCents)}
              </div>
              <div className="muted" style={{ fontSize: 11 }}>
                Booking-weighted avg pending
              </div>
            </div>
            <div
              style={{
                border: "1px solid var(--line)",
                borderRadius: 10,
                padding: 12,
              }}
            >
              <div className="muted" style={{ fontSize: 11 }}>
                Highest Price
              </div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>
                {st.pricing.highestCents != null
                  ? money(st.pricing.highestCents)
                  : "—"}
              </div>
              <div className="muted" style={{ fontSize: 11 }}>
                {st.pricing.highestName || "—"}
              </div>
            </div>
            <div
              style={{
                border: "1px solid var(--line)",
                borderRadius: 10,
                padding: 12,
              }}
            >
              <div className="muted" style={{ fontSize: 11 }}>
                Lowest Price
              </div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>
                {st.pricing.lowestCents != null
                  ? money(st.pricing.lowestCents)
                  : "—"}
              </div>
              <div className="muted" style={{ fontSize: 11 }}>
                {st.pricing.lowestName || "—"}
              </div>
            </div>
            <div
              style={{
                border: "1px solid var(--line)",
                borderRadius: 10,
                padding: 12,
              }}
            >
              <div className="muted" style={{ fontSize: 11 }}>
                Price Range
              </div>
              <div style={{ fontWeight: 800, fontSize: 15 }}>
                {st.pricing.lowestCents != null &&
                st.pricing.highestCents != null
                  ? `${money(st.pricing.lowestCents)} - ${money(st.pricing.highestCents)}`
                  : "—"}
              </div>
              <div className="muted" style={{ fontSize: 11 }}>
                Across all services
              </div>
            </div>
          </div>
        </section>
        <section className="panel">
          <h2>Staff Service Availability</h2>
          {st.staffAvailability.length === 0 ? (
            <div className="state" style={{ fontSize: 12 }}>
              No technician–service assignments configured yet.
            </div>
          ) : (
            <table className="tgrid" style={{ width: "100%", fontSize: 12.5 }}>
              <thead>
                <tr
                  style={{
                    textAlign: "left",
                    color: "var(--muted)",
                    fontSize: 11,
                  }}
                >
                  <th>Staff</th>
                  <th>Tenant</th>
                  <th style={{ textAlign: "right" }}>Services Offered</th>
                  <th style={{ textAlign: "right" }}>Utilization</th>
                </tr>
              </thead>
              <tbody>
                {st.staffAvailability.map((s, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 600 }}>{s.name}</td>
                    <td className="muted">{s.tenantName || "—"}</td>
                    <td style={{ textAlign: "right" }}>{s.servicesOffered}</td>
                    <td
                      style={{ textAlign: "right" }}
                      className="muted"
                      title="No capacity / booking-slot model in schema"
                    >
                      {s.utilizationPct != null ? `${s.utilizationPct}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
            Oversight only · services-offered is live; utilization needs a
            capacity model —{" "}
            <span style={{ color: "var(--danger,#B85B4D)" }}>
              not connected
            </span>
            .
          </div>
        </section>
      </div>

      {/* Catalog table + AI insights */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3.5">
        <section className="panel">
          <div className="phead">
            <h2>
              Service Catalog <span className="muted">({st.total})</span>
            </h2>
          </div>
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              marginBottom: 10,
            }}
          >
            <input
              className="inp"
              style={{
                flex: 1,
                minWidth: 180,
                height: 34,
                padding: "0 12px",
                border: "1px solid var(--line)",
                borderRadius: 8,
              }}
              placeholder="Search services…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") load();
              }}
            />
            <select
              className="inp"
              style={{
                height: 34,
                padding: "0 8px",
                border: "1px solid var(--line)",
                borderRadius: 8,
              }}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">All Categories</option>
              {allCats.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              className="inp"
              style={{
                height: 34,
                padding: "0 8px",
                border: "1px solid var(--line)",
                borderRadius: 8,
              }}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">All Status</option>
              {(st.byStatus || []).map((s) => (
                <option key={s.status} value={s.status}>
                  {s.status}
                </option>
              ))}
            </select>
          </div>
          {st.rows.length === 0 ? (
            <div className="state">No services match.</div>
          ) : (
            <div className="w-full max-w-full h-[600px] overflow-x-auto overflow-y-auto">
              <table className="w-full min-w-[780px] text-[12.5px]">
                <thead>
                  <tr className="text-left text-[var(--muted)] text-[12px] font-bold h-12 ">
                    <th>Service</th>
                    <th>Category</th>
                    <th>Duration</th>
                    <th>Price</th>
                    <th>Commission</th>
                    <th>Booking</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {st.rows.slice(0, 60).map((r) => (
                    <tr
                      className="text-left border-b border-[var(--line)] hover:bg-[var(--hover,#f9f9f9)] p-1 h-10"
                      key={r.id}
                      style={{ cursor: "pointer" }}
                      onClick={() => nav(`/tenants/${r.tenantId}`)}
                    >
                      <td style={{ fontWeight: 600 }}>{r.name}</td>
                      <td className="muted">{r.category}</td>
                      <td>
                        {r.durationMinutes != null
                          ? `${r.durationMinutes}m`
                          : "—"}
                      </td>
                      <td>{money(r.priceCents)}</td>
                      <td className="muted">
                        {r.commissionType === "flat"
                          ? money((r.commissionValue ?? 0) * 100)
                          : r.commissionValue != null
                            ? `${r.commissionValue}%`
                            : "—"}
                      </td>
                      <td>
                        {r.onlineBooking ? (
                          <span className="pill ok">On</span>
                        ) : (
                          <span className="muted">Off</span>
                        )}
                      </td>
                      <td>
                        <span
                          className={
                            "pill " + (r.status === "active" ? "ok" : "warn")
                          }
                        >
                          {r.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="panel">
          <h2>AI Service Insights</h2>
          <div className="state" style={{ fontSize: 12, lineHeight: 1.5 }}>
            Pricing optimization, top-performer detection, margin &amp;
            rebooking insights need the ML layer, which isn’t built.{" "}
            <span style={{ color: "var(--danger,#B85B4D)" }}>
              Not connected.
            </span>
          </div>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
            Live signals available today: <b>{k.bookingsTotal}</b> total
            bookings, top service <b>{st.topServices[0]?.name || "—"}</b>,{" "}
            <b>{st.catalogHealth.needsUpdate}</b> services missing details.
          </div>
        </section>
      </div>

      {/* Top · Low · Recent · Packages */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3.5">
        <section className="panel">
          <h2>Top Selling Services</h2>
          {st.topServices.filter((p) => p.bookings > 0).length === 0 ? (
            <div className="state" style={{ fontSize: 12 }}>
              No bookings yet.
            </div>
          ) : (
            st.topServices
              .filter((p) => p.bookings > 0)
              .map((p, i) => (
                <div
                  key={p.name}
                  className="arow"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 0",
                    fontSize: 12.5,
                    borderBottom: "1px solid var(--line,#f0f0f0)",
                  }}
                >
                  <span className="muted" style={{ width: 14 }}>
                    {i + 1}
                  </span>
                  <span style={{ flex: 1, fontWeight: 600 }}>{p.name}</span>
                  <span className="muted">{p.bookings} bk</span>
                  <span
                    style={{ fontWeight: 700, width: 56, textAlign: "right" }}
                  >
                    {moneyK(p.revenueCents)}
                  </span>
                </div>
              ))
          )}
        </section>
        <section className="panel">
          <h2>Low Performing Services</h2>
          {st.lowServices.length === 0 ? (
            <div className="state" style={{ fontSize: 12 }}>
              No services.
            </div>
          ) : (
            st.lowServices.map((p, i) => (
              <div
                key={p.name}
                className="arow"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 0",
                  fontSize: 12.5,
                  borderBottom: "1px solid var(--line,#f0f0f0)",
                }}
              >
                <span className="muted" style={{ width: 14 }}>
                  {i + 1}
                </span>
                <span style={{ flex: 1, fontWeight: 600 }}>{p.name}</span>
                <span className={"pill " + (p.bookings === 0 ? "warn" : "")}>
                  {p.bookings} bk
                </span>
              </div>
            ))
          )}
        </section>
        <section className="panel">
          <h2>Recent Service Activity</h2>
          {st.recentActivity.length === 0 ? (
            <div className="state" style={{ fontSize: 12 }}>
              No recent activity.
            </div>
          ) : (
            st.recentActivity.map((a, i) => (
              <div
                key={i}
                style={{
                  padding: "6px 0",
                  fontSize: 12.5,
                  borderBottom: "1px solid var(--line,#f0f0f0)",
                }}
              >
                <div>
                  <b>{a.name}</b> <span className="muted">{a.action}</span>
                </div>
                <div className="muted" style={{ fontSize: 11 }}>
                  {dt(a.at)}
                  {a.tenantName ? ` · ${a.tenantName}` : ""}
                </div>
              </div>
            ))
          )}
        </section>
        <section className="panel">
          <h2>Service Packages & Add-ons</h2>
          {st.packages.length === 0 ? (
            <div className="state" style={{ fontSize: 12, lineHeight: 1.5 }}>
              No service packages configured.{" "}
              <span className="muted">
                (Bundles aren’t modelled in the schema yet —{" "}
              </span>
              <span style={{ color: "var(--danger,#B85B4D)" }}>
                not connected
              </span>
              <span className="muted">.)</span>
            </div>
          ) : (
            st.packages.map((p: any, i: number) => (
              <div key={i} className="arow">
                {p.name}
              </div>
            ))
          )}
        </section>
        <section className="panel">
          <h2>Top Services by Revenue</h2>
          {st.topByRevenue.filter((p) => p.revenueCents > 0).length === 0 ? (
            <div className="state" style={{ fontSize: 12 }}>
              No revenue yet.
            </div>
          ) : (
            st.topByRevenue
              .filter((p) => p.revenueCents > 0)
              .map((p, i) => (
                <div
                  key={p.name}
                  className="arow"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 0",
                    fontSize: 12.5,
                    borderBottom: "1px solid var(--line,#f0f0f0)",
                  }}
                >
                  <span className="muted" style={{ width: 14 }}>
                    {i + 1}
                  </span>
                  <span style={{ flex: 1, fontWeight: 600 }}>{p.name}</span>
                  <span className="muted">{p.bookings} bk</span>
                  <span
                    style={{ fontWeight: 700, width: 64, textAlign: "right" }}
                  >
                    {money(p.revenueCents)}
                  </span>
                </div>
              ))
          )}
        </section>
      </div>

      <section className="panel">
        <h2>Quick Actions</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5 ">
          {[
            { l: "Add New Service", kind: "template" as const },
            { l: "Manage Categories", open: "categories" as const },
            { l: "Create Package", kind: "template" as const },
            { l: "Add Add-On", kind: "template" as const },
            { l: "Pricing Rules", kind: "template" as const },
            { l: "Service Calendar", kind: "template" as const },
            { l: "Bulk Import Services", kind: "template" as const },
            { l: "View Reports", to: "/analytics" },
            { l: "Export Services", to: "/analytics" },
          ].map((a) => (
            <button
              key={a.l}
              className="qbtn"
              onClick={() =>
                "open" in a && a.open === "categories"
                  ? setCatOpen(true)
                  : "to" in a && a.to
                    ? nav(a.to)
                    : setNotice(
                        `${a.l} is a Global Services Management workflow that isn’t built yet — it will live in the global-template layer (templates, categories, packages, add-ons, pricing rules).`,
                      )
              }
            >
              {a.l}
            </button>
          ))}
        </div>
      </section>

      {/* bottom stat strip */}
      <div className="kpis grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5  pb-7">
        <div className="kpi">
          <div className="l">Active Categories</div>
          <div className="v">{k.categories}</div>
        </div>
        <div className="kpi">
          <div className="l">Avg Duration</div>
          <div className="v">
            {k.avgDurationMinutes ? `${k.avgDurationMinutes}m` : "—"}
          </div>
        </div>
        <div className="kpi">
          <div className="l">High-Margin Services</div>
          <div className="v" title="No cost data in schema">
            —
          </div>
        </div>
        <div className="kpi">
          <div className="l">Bundle Conversion</div>
          <div className="v" title="No packages configured">
            —
          </div>
        </div>
        <div className="kpi">
          <div className="l">Online Bookable</div>
          <div className="v">{k.onlineBookable}</div>
        </div>
        <div className="kpi">
          <div className="l">Customer Rating</div>
          <div className="v">
            {k.reviewCount > 0 ? `${k.avgRating} ★` : "—"}
          </div>
        </div>
      </div>
      {catOpen && (
        <ServiceCategoriesModal
          onClose={() => setCatOpen(false)}
          onOpenMerge={() => {
            setCatOpen(false);
            setMergeOpen(true);
          }}
        />
      )}
      {mergeOpen && (
        <ServiceCategoryMergeModal
          onClose={() => setMergeOpen(false)}
          onMerged={() => {
            setMergeOpen(false);
            setNotice(
              "Service categories merged. Services were reattributed to the surviving category and the action was audited.",
            );
            load();
          }}
        />
      )}
    </div>
  );
}

// ── Service Categories oversight modal (§25): read-only, platform-wide view of service categories grouped by
// normalized name across tenants, surfacing cross-tenant duplicates as candidates for a shared global category
// standard. No mutations — global category edits/merges must never overwrite a tenant's local taxonomy (§3).
function ServiceCategoriesModal({ onClose, onOpenMerge }: { onClose: () => void; onOpenMerge: () => void }) {
  const [data, setData] = useState<{ rows: any[]; kpis: any; duplicates: any[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let alive = true;
    (superAdminApi.platformServiceCategories(search ? { search } : undefined) as Promise<any>)
      .then((d) => { if (alive) setData({ rows: Array.isArray(d?.rows) ? d.rows : [], kpis: d?.kpis || {}, duplicates: Array.isArray(d?.duplicates) ? d.duplicates : [] }); })
      .catch((e: any) => { if (alive) setError(e?.message || 'Couldn’t load categories.'); });
    return () => { alive = false; };
  }, [search]);

  const kpi = (l: string, v: any) => <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', minWidth: 96 }}><div className="muted" style={{ fontSize: 10 }}>{l}</div><div style={{ fontWeight: 800, fontSize: 16 }}>{v ?? '—'}</div></div>;
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,0.36)', zIndex: 60, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 12px' }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Service categories" style={{ width: 'min(820px, 96vw)', maxHeight: '92vh', overflow: 'auto', background: 'var(--card, #fff)', borderRadius: 10, boxShadow: '0 18px 48px rgba(0,0,0,0.24)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--line)', position: 'sticky', top: 0, background: 'var(--card, #fff)' }}>
          <div><div style={{ fontWeight: 800, fontSize: 14 }}>Service Categories</div><div className="muted" style={{ fontSize: 11 }}>Platform-wide taxonomy oversight · read-only</div></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn ghost" style={{ height: 30 }} onClick={onOpenMerge}>Merge duplicates…</button>
            <button className="btn ghost" onClick={onClose} aria-label="Close">✕</button>
          </div>
        </div>
        <div style={{ padding: '12px 18px' }}>
          {error && <div className="state" style={{ color: 'var(--danger)', marginBottom: 8 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {kpi('Categories', data?.kpis?.totalCategories)}
            {kpi('Distinct names', data?.kpis?.distinctNames)}
            {kpi('Active', data?.kpis?.activeCategories)}
            {kpi('Tenants covered', data?.kpis?.tenantsCovered)}
            {kpi('Uncategorized services', data?.kpis?.uncategorizedServices)}
          </div>
          <input value={search} onChange={(e) => { setData(null); setSearch(e.target.value); }} placeholder="Search categories…" style={{ width: '100%', padding: '7px 9px', fontSize: 12, marginBottom: 10 }} />
          {data === null ? (
            <div className="state" style={{ fontSize: 12 }}>Loading categories…</div>
          ) : (
            <>
              {data.duplicates.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 6 }}>Cross-tenant duplicates <span className="muted" style={{ fontWeight: 400 }}>· candidates for a shared global category standard</span></div>
                  {data.duplicates.map((d: any) => (
                    <div key={d.id} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 8, marginBottom: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span className="pill warn">{d.displayName}</span>
                        <span className="muted" style={{ fontSize: 11 }}>{d.tenantCount} tenants · {d.totalProducts} services</span>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {d.members.map((m: any, i: number) => <span key={i} className="muted" style={{ fontSize: 11, border: '1px solid var(--line)', borderRadius: 6, padding: '2px 7px' }}>{m.tenantName} · {m.products}</span>)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {data.rows.length === 0 ? (
                <div className="state" style={{ fontSize: 12 }}>No categories{search ? ' match this search' : ' configured yet'}.</div>
              ) : (
                <table className="tgrid" style={{ width: '100%', fontSize: 12.5 }}>
                  <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11 }}><th>Category</th><th style={{ textAlign: 'right' }}>Tenants</th><th style={{ textAlign: 'right' }}>Instances</th><th style={{ textAlign: 'right' }}>Active</th><th style={{ textAlign: 'right' }}>Services</th></tr></thead>
                  <tbody>
                    {data.rows.map((r: any) => (
                      <tr key={r.normalizedName}>
                        <td style={{ fontWeight: 600 }}>{r.name}</td>
                        <td style={{ textAlign: 'right' }}>{r.tenantCount}</td>
                        <td style={{ textAlign: 'right' }} className="muted">{r.categoryCount}</td>
                        <td style={{ textAlign: 'right' }} className="muted">{r.activeCount}</td>
                        <td style={{ textAlign: 'right' }}>{r.serviceCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="muted" style={{ fontSize: 11, marginTop: 10 }}>Read-only oversight. A global category merge/standard is a separate gated, audited action — it must never overwrite a tenant’s local taxonomy.</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Same-tenant service-category MERGE (§25, mutation tier). Reattributes a tenant's services from a duplicate
// (source) category onto a surviving (target) category, then flags the source merged — within ONE tenant only.
// The action is gated on an active support session: eligible tenants are derived from active sessions, which also
// supplies the sessionId the backend requires. A reason (≥5 chars) is mandatory; everything is audited server-side.
function ServiceCategoryMergeModal({ onClose, onMerged }: { onClose: () => void; onMerged: () => void }) {
  const [sessions, setSessions] = useState<any[] | null>(null);
  const [sessionId, setSessionId] = useState('');
  const [tenantName, setTenantName] = useState<string | null>(null);
  const [cats, setCats] = useState<{ id: string; name: string; status: string; serviceCount: number }[] | null>(null);
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (superAdminApi.supportSessions(true) as Promise<any>)
      .then((d) => { if (alive) setSessions(Array.isArray(d) ? d : []); })
      .catch((e: any) => { if (alive) setError(e?.message || 'Couldn’t load support sessions.'); });
    return () => { alive = false; };
  }, []);

  const session = (sessions || []).find((s: any) => String(s.id) === sessionId);
  const tenantId = session ? String(session.tenant_id) : '';

  useEffect(() => {
    if (!tenantId) { setCats(null); setTenantName(null); setSourceId(''); setTargetId(''); return; }
    let alive = true; setCats(null);
    (superAdminApi.tenantServiceCategories(tenantId) as Promise<any>)
      .then((d) => { if (alive) { setTenantName(d?.tenantName || null); setCats(Array.isArray(d?.categories) ? d.categories : []); } })
      .catch((e: any) => { if (alive) setError(e?.message || 'Couldn’t load tenant categories.'); });
    return () => { alive = false; };
  }, [tenantId]);

  const mergeable = (cats || []).filter((c) => c.status !== 'merged');
  const canMerge = !!sessionId && !!sourceId && !!targetId && sourceId !== targetId && reason.trim().length >= 5 && !busy;
  const srcCat = mergeable.find((c) => c.id === sourceId);

  const doMerge = () => {
    if (!canMerge) return;
    setBusy(true); setError(null);
    (superAdminApi.mergeServiceCategories({ sessionId, tenantId, sourceCategoryId: sourceId, targetCategoryId: targetId, reason: reason.trim() }) as Promise<any>)
      .then(() => onMerged())
      .catch((e: any) => { setError(e?.message || 'Merge failed.'); setBusy(false); });
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,0.4)', zIndex: 70, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 12px' }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Merge service categories" style={{ width: 'min(560px, 96vw)', maxHeight: '88vh', overflow: 'auto', background: 'var(--card, #fff)', borderRadius: 10, boxShadow: '0 18px 48px rgba(0,0,0,0.26)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
          <div><div style={{ fontWeight: 800, fontSize: 14 }}>Merge Service Categories</div><div className="muted" style={{ fontSize: 11 }}>Same tenant · within an active support session</div></div>
          <button className="btn ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {error && <div className="state" style={{ color: 'var(--danger)' }}>{error}</div>}

          <label style={{ fontSize: 12 }}>
            <div className="muted" style={{ marginBottom: 4 }}>Tenant (from active support sessions)</div>
            {sessions === null ? <div className="state" style={{ fontSize: 12 }}>Loading sessions…</div> : sessions.length === 0 ? (
              <div className="state" style={{ fontSize: 12 }}>No active support session. Open tenant support access first — a merge is only permitted inside one.</div>
            ) : (
              <select value={sessionId} onChange={(e) => { setSessionId(e.target.value); setSourceId(''); setTargetId(''); }} style={{ width: '100%', padding: '7px 9px', fontSize: 12 }}>
                <option value="">Select a support session…</option>
                {sessions.map((s: any) => <option key={s.id} value={s.id}>{`tenant ${String(s.tenant_id).slice(0, 8)}… · ${s.reason || 'support'}`}</option>)}
              </select>
            )}
          </label>

          {sessionId && (
            <>
              {tenantName && <div className="muted" style={{ fontSize: 12 }}>Tenant: <b style={{ color: 'var(--text,#1d2330)' }}>{tenantName}</b></div>}
              {cats === null ? <div className="state" style={{ fontSize: 12 }}>Loading categories…</div> : mergeable.length < 2 ? (
                <div className="state" style={{ fontSize: 12 }}>This tenant needs at least two mergeable categories.</div>
              ) : (
                <>
                  <label style={{ fontSize: 12 }}>
                    <div className="muted" style={{ marginBottom: 4 }}>Source (merged away)</div>
                    <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} style={{ width: '100%', padding: '7px 9px', fontSize: 12 }}>
                      <option value="">Select source category…</option>
                      {mergeable.map((c) => <option key={c.id} value={c.id}>{`${c.name} · ${c.serviceCount} services`}</option>)}
                    </select>
                  </label>
                  <label style={{ fontSize: 12 }}>
                    <div className="muted" style={{ marginBottom: 4 }}>Target (surviving)</div>
                    <select value={targetId} onChange={(e) => setTargetId(e.target.value)} style={{ width: '100%', padding: '7px 9px', fontSize: 12 }}>
                      <option value="">Select target category…</option>
                      {mergeable.filter((c) => c.id !== sourceId).map((c) => <option key={c.id} value={c.id}>{`${c.name} · ${c.serviceCount} services`}</option>)}
                    </select>
                  </label>
                  {srcCat && <div className="muted" style={{ fontSize: 11.5 }}><b>{srcCat.serviceCount}</b> service{srcCat.serviceCount === 1 ? '' : 's'} will be reattributed; “{srcCat.name}” will be flagged merged. This affects this tenant only.</div>}
                  <label style={{ fontSize: 12 }}>
                    <div className="muted" style={{ marginBottom: 4 }}>Reason (required, ≥5 chars · audited)</div>
                    <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. consolidating duplicate Manicures category" style={{ width: '100%', padding: '7px 9px', fontSize: 12 }} />
                  </label>
                </>
              )}
            </>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 2 }}>
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn" disabled={!canMerge} style={!canMerge ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} onClick={doMerge}>{busy ? 'Merging…' : 'Merge categories'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
