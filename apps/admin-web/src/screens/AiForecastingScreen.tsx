// AiForecastingScreen.tsx — Super Admin › AI & Automation › AI Forecasting Oversight. Platform-level operational health of
// the AI Analytics & Forecasting module, sourced from the forecast_points log. AGGREGATE ONLY: adoption, run volume,
// realized-accuracy distribution + per-domain accuracy, and per-tenant HEALTH rows (counts + accuracy %, never predicted
// values or raw business data). Realized accuracy shows only once forecasts mature; until then it renders an honest note.
import { useEffect, useState } from 'react';
import { superAdminApi } from '../api/superAdminApi';
import { Donut, MiniBars, NotConnected } from './_chartkit';

import {
  FiActivity,
  FiBarChart2,
  FiCheckCircle,
  FiClock,
  FiDatabase,
  FiInfo,
  FiLayers,
  FiShield,
  FiTrendingUp,
  FiUsers,
  FiAlertCircle,
} from "react-icons/fi";

const pct = (w: number | null | undefined) => (w == null ? '—' : `${(w * 100).toFixed(1)}%`);
const titleCase = (s: string) => (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

type Overview = {
  kpis: { activeTenants: number; forecastRuns: number; storedForecastPoints: number; evaluatedPoints: number; platformRealizedWape: number | null; platformIntervalCoverage: number | null };
  byDomain: { domain: string; runs: number; evaluated: number; realizedWape: number | null }[];
  accuracyDistribution: { bucket: string; tenants: number }[];
  note: string; privacyNote: string;
};
type TenantRow = { tenantId: string; domains: number; runs: number; points: number; evaluated: number; realizedWape: number | null; coverage: number | null; lastGeneratedAt: string | null; lowConfidence: boolean };

export function AiForecastingScreen() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [tenants, setTenants] = useState<TenantRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([superAdminApi.aiForecastingOverview(), superAdminApi.aiForecastingTenants({ limit: 50 })])
      .then(([o, t]: any) => { if (!alive) return; setOv(o); setTenants(t.rows); })
      .catch((e: any) => { if (alive) setError(e?.message || 'Could not load forecasting oversight.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  if (loading) return <div className="sa-screen"><div className="muted">Loading…</div></div>;
  if (error) return <div className="sa-screen"><NotConnected>{error}</NotConnected></div>;
  if (!ov) return null;

  const k = ov.kpis;
  const distData = ov.accuracyDistribution.filter((b) => b.tenants > 0).map((b) => ({ label: titleCase(b.bucket), value: b.tenants }));

  return (
  <div className="p-5">
    <div className="mb-3 flex items-start gap-3">
      <div>
        <h1
          className="m-0 text-[22px] font-bold leading-tight text-[#2C2118] sm:text-[24px] lg:text-[26px]"
          style={{ fontFamily: "Playfair Display, serif" }}
        >
          AI Forecasting Oversight
        </h1>
        <p className="mt-1 max-w-4xl text-xs leading-5 text-[#7A6C57] sm:text-[13px]">
          Platform-level forecasting performance, accuracy, and tenant health
          metrics.
        </p>
      </div>
    </div>
    {ov?.privacyNote && (
      <div className="mb-5 flex items-start gap-2 rounded-xl border border-[#E8D9C5] bg-[#FBF7F1] px-4 py-3 text-xs leading-5 text-[#7A6C57]">
        <FiShield
          className="mt-0.5 shrink-0 text-[var(--gold)]"
          size={15}
        />
        <span>{ov.privacyNote}</span>
      </div>
    )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
        <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-[#F8F1E7] text-[var(--gold)]">
          <FiUsers size={17} />
        </div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9B8B78]">
          Active tenants
        </div>
        <div
          className="mt-1 text-2xl font-extrabold text-[var(--gold)]"
          style={{ fontFamily: "Playfair Display, serif" }}
        >
          {k.activeTenants}
        </div>
      </div>
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
        <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-[#F8F1E7] text-[var(--gold)]">
          <FiActivity size={17} />
        </div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9B8B78]">
          Forecast runs
        </div>
        <div
          className="mt-1 text-2xl font-extrabold text-[var(--gold)]"
          style={{ fontFamily: "Playfair Display, serif" }}
        >
          {k.forecastRuns}
        </div>
      </div>
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
        <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-[#F8F1E7] text-[var(--gold)]">
          <FiDatabase size={17} />
        </div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9B8B78]">
          Stored points
        </div>
        <div
          className="mt-1 text-2xl font-extrabold text-[var(--gold)]"
          style={{ fontFamily: "Playfair Display, serif" }}
        >
          {k.storedForecastPoints}
        </div>
      </div>
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
        <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-[#EDF7F0] text-[#4C8A5A]">
          <FiCheckCircle size={17} />
        </div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9B8B78]">
          Evaluated
        </div>
        <div
          className="mt-1 text-2xl font-extrabold text-[#4C8A5A]"
          style={{ fontFamily: "Playfair Display, serif" }}
        >
          {k.evaluatedPoints}
        </div>
      </div>
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
        <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-[#FBF4E7] text-[#8B6938]">
          <FiBarChart2 size={17} />
        </div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9B8B78]">
          Platform WAPE
        </div>
        <div
          className="mt-1 text-2xl font-extrabold text-[#8B6938]"
          style={{ fontFamily: "Playfair Display, serif" }}
        >
          {pct(k.platformRealizedWape)}
        </div>
      </div>
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
        <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-[#EDF7F0] text-[#4C8A5A]">
          <FiTrendingUp size={17} />
        </div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9B8B78]">
          Interval coverage
        </div>
        <div
          className="mt-1 text-2xl font-extrabold text-[#4C8A5A]"
          style={{ fontFamily: "Playfair Display, serif" }}
        >
          {k.platformIntervalCoverage == null
            ? "—"
            : `${(k.platformIntervalCoverage * 100).toFixed(0)}%`}
        </div>
      </div>
    </div>
    <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)] shadow-sm">
        <div className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-3 sm:px-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#F8F1E7] text-[var(--gold)]">
            <FiBarChart2 size={17} />
          </div>
          <div>
            <h3
              className="m-0 text-base font-bold text-[#2C2118]"
              style={{ fontFamily: "Playfair Display, serif" }}
            >
              Tenant accuracy distribution
            </h3>
            <p className="m-0 mt-0.5 text-[11px] text-[#9B8B78]">
              Distribution across active tenants
            </p>
          </div>
        </div>
        <div className="p-4 sm:p-5">
          {distData.length ? (
            <Donut
              data={distData}
              centerLabel={`${k.activeTenants} tenants`}
            />
          ) : (
            <NotConnected>
              No matured forecasts yet.
            </NotConnected>
          )}
          <div className="mt-3 flex items-start gap-2 rounded-xl bg-[#FBF7F1] px-3 py-2.5 text-xs leading-5 text-[#7A6C57]">
            <FiInfo
              className="mt-0.5 shrink-0 text-[var(--gold)]"
              size={14}
            />
            <span>{ov.note}</span>
          </div>
        </div>
      </div>
      <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)] shadow-sm">
        <div className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-3 sm:px-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#F8F1E7] text-[var(--gold)]">
            <FiLayers size={17} />
          </div>
          <div>
            <h3
              className="m-0 text-base font-bold text-[#2C2118]"
              style={{ fontFamily: "Playfair Display, serif" }}
            >
              Runs by domain
            </h3>
            <p className="m-0 mt-0.5 text-[11px] text-[#9B8B78]">
              Forecast execution across domains
            </p>
          </div>
        </div>
        <div className="p-4 sm:p-5">
          <MiniBars
            data={ov.byDomain.map((d) => ({
              label: titleCase(d.domain),
              value: d.runs,
              tip: `WAPE ${pct(d.realizedWape)}`,
            }))}
            emptyHint="No forecast runs yet."
          />
        </div>
      </div>
    </div>
    <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)] shadow-sm">
      <div className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-3 sm:px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#F8F1E7] text-[var(--gold)]">
          <FiBarChart2 size={17} />
        </div>
        <div>
          <h3
            className="m-0 text-base font-bold text-[#2C2118]"
            style={{ fontFamily: "Playfair Display, serif" }}
          >
            Per-domain realized accuracy
          </h3>
          <p className="m-0 mt-0.5 text-[11px] text-[#9B8B78]">
            Forecast performance by domain
          </p>
        </div>
      </div>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-[var(--line)] bg-[#FBF7F1]">
              <th className="px-5 py-3 text-[11px] font-bold uppercase tracking-wide text-[#7A6C57]">
                Domain
              </th>
              <th className="px-5 py-3 text-[11px] font-bold uppercase tracking-wide text-[#7A6C57]">
                Runs
              </th>
              <th className="px-5 py-3 text-[11px] font-bold uppercase tracking-wide text-[#7A6C57]">
                Evaluated
              </th>
              <th className="px-5 py-3 text-[11px] font-bold uppercase tracking-wide text-[#7A6C57]">
                Realized WAPE
              </th>
            </tr>
          </thead>
          <tbody>
            {ov.byDomain.map((d) => (
              <tr
                key={d.domain}
                className="border-b border-[var(--line)] last:border-0 hover:bg-[#FFFCF8]"
              >
                <td className="px-5 py-3 text-sm font-semibold text-[#2C2118]">
                  {titleCase(d.domain)}
                </td>
                <td className="px-5 py-3 text-sm text-[#5A4B37]">
                  {d.runs}
                </td>
                <td className="px-5 py-3 text-sm text-[#5A4B37]">
                  {d.evaluated}
                </td>
                <td className="px-5 py-3 text-sm font-bold text-[var(--gold)]">
                  {pct(d.realizedWape)}
                </td>
              </tr>
            ))}
            {ov.byDomain.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-5 py-8 text-center text-sm text-[#9B8B78]"
                >
                  No forecast activity yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="space-y-3 p-3 sm:hidden">
        {ov.byDomain.map((d) => (
          <div
            key={d.domain}
            className="rounded-xl border border-[var(--line)] bg-white p-3"
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="font-semibold text-[#2C2118]">
                {titleCase(d.domain)}
              </span>
              <span className="rounded-full bg-[#F8F1E7] px-2.5 py-1 text-xs font-bold text-[var(--gold)]">
                {pct(d.realizedWape)}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-[#9B8B78]">
                  Runs
                </div>
                <div className="mt-1 text-sm font-bold text-[#2C2118]">
                  {d.runs}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-[#9B8B78]">
                  Evaluated
                </div>
                <div className="mt-1 text-sm font-bold text-[#2C2118]">
                  {d.evaluated}
                </div>
              </div>
            </div>
          </div>
        ))}
        {ov.byDomain.length === 0 && (
          <div className="py-6 text-center text-sm text-[#9B8B78]">
            No forecast activity yet.
          </div>
        )}
      </div>
    </div>
    <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)] shadow-sm">
      <div className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-3 sm:px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#F8F1E7] text-[var(--gold)]">
          <FiUsers size={17} />
        </div>
        <div>
          <h3
            className="m-0 text-base font-bold text-[#2C2118]"
            style={{ fontFamily: "Playfair Display, serif" }}
          >
            Tenant health
          </h3>
          <p className="m-0 mt-0.5 text-[11px] text-[#9B8B78]">
            Forecast reliability and confidence by tenant
          </p>
        </div>
      </div>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-[var(--line)] bg-[#FBF7F1]">
              <th className="whitespace-nowrap px-5 py-3 text-[11px] font-bold uppercase tracking-wide text-[#7A6C57]">
                Tenant
              </th>
              <th className="px-5 py-3 text-[11px] font-bold uppercase tracking-wide text-[#7A6C57]">
                Domains
              </th>
              <th className="px-5 py-3 text-[11px] font-bold uppercase tracking-wide text-[#7A6C57]">
                Runs
              </th>
              <th className="px-5 py-3 text-[11px] font-bold uppercase tracking-wide text-[#7A6C57]">
                Evaluated
              </th>
              <th className="whitespace-nowrap px-5 py-3 text-[11px] font-bold uppercase tracking-wide text-[#7A6C57]">
                Realized WAPE
              </th>
              <th className="px-5 py-3 text-[11px] font-bold uppercase tracking-wide text-[#7A6C57]">
                Coverage
              </th>
              <th className="px-5 py-3 text-[11px] font-bold uppercase tracking-wide text-[#7A6C57]">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {(tenants ?? []).map((t) => (
              <tr
                key={t.tenantId}
                className="border-b border-[var(--line)] last:border-0 hover:bg-[#FFFCF8]"
              >
                <td
                  title={t.tenantId}
                  className="px-5 py-3 text-sm font-semibold text-[#2C2118]"
                >
                  {t.tenantId.slice(0, 8)}…
                </td>
                <td className="px-5 py-3 text-sm text-[#5A4B37]">
                  {t.domains}
                </td>
                <td className="px-5 py-3 text-sm text-[#5A4B37]">
                  {t.runs}
                </td>
                <td className="px-5 py-3 text-sm text-[#5A4B37]">
                  {t.evaluated}
                </td>
                <td className="px-5 py-3 text-sm font-bold text-[var(--gold)]">
                  {pct(t.realizedWape)}
                </td>
                <td className="px-5 py-3 text-sm text-[#5A4B37]">
                  {t.coverage == null
                    ? "—"
                    : `${(t.coverage * 100).toFixed(0)}%`}
                </td>
                <td className="px-5 py-3">
                  {t.lowConfidence ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FBEDEA] px-2.5 py-1 text-[11px] font-bold text-[#B85B4D]">
                      <FiAlertCircle size={12} />
                      Insufficient data
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#EDF7F0] px-2.5 py-1 text-[11px] font-bold text-[#3E8F57]">
                      <FiCheckCircle size={12} />
                      OK
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {(!tenants || tenants.length === 0) && (
              <tr>
                <td
                  colSpan={7}
                  className="px-5 py-8 text-center text-sm text-[#9B8B78]"
                >
                  No tenants have generated forecasts yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="space-y-3 p-3 sm:hidden">
        {(tenants ?? []).map((t) => (
          <div
            key={t.tenantId}
            className="rounded-xl border border-[var(--line)] bg-white p-4"
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-[#9B8B78]">
                  Tenant
                </div>
                <div
                  title={t.tenantId}
                  className="mt-1 text-sm font-bold text-[#2C2118]"
                >
                  {t.tenantId.slice(0, 8)}…
                </div>
              </div>
              {t.lowConfidence ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-[#FBEDEA] px-2 py-1 text-[10px] font-bold text-[#B85B4D]">
                  <FiAlertCircle size={11} />
                  Insufficient
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-[#EDF7F0] px-2 py-1 text-[10px] font-bold text-[#3E8F57]">
                  <FiCheckCircle size={11} />
                  OK
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-[#9B8B78]">
                  Domains
                </div>
                <div className="mt-1 text-sm font-bold text-[#2C2118]">
                  {t.domains}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-[#9B8B78]">
                  Runs
                </div>
                <div className="mt-1 text-sm font-bold text-[#2C2118]">
                  {t.runs}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-[#9B8B78]">
                  Evaluated
                </div>
                <div className="mt-1 text-sm font-bold text-[#2C2118]">
                  {t.evaluated}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-[#9B8B78]">
                  Realized WAPE
                </div>
                <div className="mt-1 text-sm font-bold text-[var(--gold)]">
                  {pct(t.realizedWape)}
                </div>
              </div>
              <div className="col-span-2">
                <div className="text-[10px] uppercase tracking-wide text-[#9B8B78]">
                  Coverage
                </div>
                <div className="mt-1 text-sm font-bold text-[#2C2118]">
                  {t.coverage == null
                    ? "—"
                    : `${(t.coverage * 100).toFixed(0)}%`}
                </div>
              </div>
            </div>
          </div>
        ))}
        {(!tenants || tenants.length === 0) && (
          <div className="py-6 text-center text-sm text-[#9B8B78]">
            No tenants have generated forecasts yet.
          </div>
        )}
      </div>
    </div>
    <div className="mt-4 flex items-center gap-2 text-xs text-[#9B8B78]">
      <FiClock size={13} />
      <span>Forecasting oversight · platform operational view</span>
    </div>
  </div>
  );
}
