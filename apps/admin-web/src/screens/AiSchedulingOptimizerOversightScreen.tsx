// AiSchedulingOptimizerOversightScreen.tsx — Super Admin oversight for the AI Scheduling Optimizer. Platform-operational
// counts + an audited, reason-required per-tenant OPERATIONAL drill-down. The backend returns counts/health only — never
// a tenant's appointments, technicians, customers, or schedules — so nothing here renders schedule content. Unmeasured
// fields (conflicts / understaffing / forecast health) arrive as null and render '—' rather than a fabricated value.
import { useEffect, useState } from 'react';
import { superAdminAiSchedulingOptimizerApi as saApi } from '../api/superAdminAiSchedulingOptimizerApi';
import {
  FiActivity,
  FiAlertCircle,
  FiBarChart2,
  FiCheckCircle,
  FiClock,
  FiCpu,
  FiEye,
  FiInfo,
  FiRefreshCw,
  FiShield,
  FiTrendingUp,
  FiUserCheck,
  FiUserX,
  FiUsers,
  FiXCircle,
  FiZap,
} from "react-icons/fi";

const GOLD = 'var(--aps-orange,#A96F22)';
const LINE = 'var(--line,#E7DBC6)';
const MUTED = 'var(--muted,#7A6C57)';
const dash = (v: any) => (v == null ? '—' : v);
const when = (iso: any) => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d.getTime()) ? '—' : d.toLocaleString(); };
const yesNoDash = (v: any) => (v == null ? '—' : v ? 'Healthy' : 'Unhealthy');

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div style={{ border: `1px solid ${LINE}`, borderRadius: 12, padding: 16, background: '#fff', minWidth: 150 }}>
      <div style={{ fontSize: 12, color: MUTED }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: GOLD, fontFamily: 'Playfair Display, serif' }}>{dash(value)}</div>
    </div>
  );
}

function StatusTable({ title, map }: { title: string; map: Record<string, number> | undefined }) {
  const entries = Object.entries(map || {});
  if (entries.length === 0) return null;
  return (
    <table style={{ marginTop: 12, borderCollapse: 'collapse', width: '100%', maxWidth: 420 }}>
      <thead><tr style={{ textAlign: 'left', color: MUTED, fontSize: 12 }}><th style={{ padding: 6 }}>{title}</th><th style={{ padding: 6 }}>Count</th></tr></thead>
      <tbody>{entries.map(([k, v]) => <tr key={k} style={{ borderTop: `1px solid ${LINE}` }}><td style={{ padding: 6 }}>{k}</td><td style={{ padding: 6 }}>{v}</td></tr>)}</tbody>
    </table>
  );
}

export default function AiSchedulingOptimizerOversightScreen() {
  const [ov, setOv] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState('');
  const [reason, setReason] = useState('');
  const [tenant, setTenant] = useState<any>(null);
  const [tErr, setTErr] = useState<string | null>(null);

  useEffect(() => { saApi.overview().then(setOv).catch(() => setErr('Could not load overview.')); }, []);

  const drill = async () => {
    setTErr(null); setTenant(null);
    if (!tenantId.trim() || reason.trim().length < 5) { setTErr('Tenant id and a reason (5+ chars) are required.'); return; }
    try { setTenant(await saApi.tenantView(tenantId.trim(), reason.trim())); }
    catch { setTErr('Could not load tenant view (check the reason is 5+ chars).'); }
  };

  return (
  <div className="p-5">
    <div className="mb-3 flex items-start gap-3">
      <div>
        <h1
          className="m-0 text-[22px] font-bold leading-tight text-[#2C2118] sm:text-[24px] lg:text-[26px]"
          style={{ fontFamily: "Playfair Display, serif" }}
        >
          AI Scheduling Optimizer — Oversight
        </h1>
        <p className="mt-1 max-w-4xl text-xs leading-5 text-[#7A6C57] sm:text-[13px]">
          Platform-operational metrics only. Per-tenant drill-down runs in
          support mode and is audited. No schedule content is shown.
        </p>
      </div>
    </div>
    {err && (
      <div className="mb-5 flex items-start gap-2 rounded-xl border border-[#F1C8C1] bg-[#FFF6F4] px-4 py-3 text-sm text-[#A12D2D]">
        <FiAlertCircle className="mt-0.5 shrink-0" size={17} />
        <span>{err}</span>
      </div>
    )}
    {ov && (
      <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-9 ">
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-[#F8F1E7] text-[var(--gold)]">
              <FiCpu size={17} />
            </div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9B8B78]">
              Optimizer-enabled tenants
            </div>
            <div
              className="mt-1 text-2xl font-extrabold text-[var(--gold)]"
              style={{ fontFamily: "Playfair Display, serif" }}
            >
              {ov.enabledTenants}
            </div>
          </div>
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-[#F8F1E7] text-[var(--gold)]">
              <FiActivity size={17} />
            </div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9B8B78]">
              Runs (total)
            </div>
            <div
              className="mt-1 text-2xl font-extrabold text-[var(--gold)]"
              style={{ fontFamily: "Playfair Display, serif" }}
            >
              {ov.runs?.total}
            </div>
          </div>
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-[#EDF7F0] text-[#4C8A5A]">
              <FiCheckCircle size={17} />
            </div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9B8B78]">
              Runs completed
            </div>
            <div
              className="mt-1 text-2xl font-extrabold text-[#4C8A5A]"
              style={{ fontFamily: "Playfair Display, serif" }}
            >
              {ov.runs?.completed}
            </div>
          </div>
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-[#FBEDEA] text-[#B85B4D]">
              <FiXCircle size={17} />
            </div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9B8B78]">
              Runs failed
            </div>
            <div
              className="mt-1 text-2xl font-extrabold text-[#B85B4D]"
              style={{ fontFamily: "Playfair Display, serif" }}
            >
              {ov.runs?.failed}
            </div>
          </div>
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-[#F8F1E7] text-[var(--gold)]">
              <FiZap size={17} />
            </div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9B8B78]">
              Auto actions applied
            </div>
            <div
              className="mt-1 text-2xl font-extrabold text-[var(--gold)]"
              style={{ fontFamily: "Playfair Display, serif" }}
            >
              {ov.automaticActions}
            </div>
          </div>
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-[#FBEDEA] text-[#B85B4D]">
              <FiAlertCircle size={17} />
            </div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9B8B78]">
              Auto action failures
            </div>
            <div
              className="mt-1 text-2xl font-extrabold text-[#B85B4D]"
              style={{ fontFamily: "Playfair Display, serif" }}
            >
              {ov.automaticActionFailures}
            </div>
          </div>
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-[#FFF5E5] text-[#B47724]">
              <FiAlertCircle size={17} />
            </div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9B8B78]">
              Conflicts open
            </div>
            <div
              className="mt-1 text-2xl font-extrabold text-[#B47724]"
              style={{ fontFamily: "Playfair Display, serif" }}
            >
              {dash(ov.conflictsOpen)}
            </div>
          </div>
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-[#FFF5E5] text-[#B47724]">
              <FiUsers size={17} />
            </div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9B8B78]">
              Understaffing alerts
            </div>
            <div
              className="mt-1 text-2xl font-extrabold text-[#B47724]"
              style={{ fontFamily: "Playfair Display, serif" }}
            >
              {dash(ov.understaffingAlerts)}
            </div>
          </div>
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-[#EDF7F0] text-[#4C8A5A]">
              <FiTrendingUp size={17} />
            </div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9B8B78]">
              Forecast integration
            </div>
            <div
              className={`mt-1 text-2xl font-extrabold ${ov.forecastIntegrationHealthy
                  ? "text-[#4C8A5A]"
                  : "text-[#B85B4D]"
                }`}
              style={{ fontFamily: "Playfair Display, serif" }}
            >
              {yesNoDash(ov.forecastIntegrationHealthy)}
            </div>
          </div>
        </div>
        <div className="mb-3 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)] shadow-sm">
          <div className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-3 sm:px-5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#F8F1E7] text-[var(--gold)]">
              <FiBarChart2 size={17} />
            </div>
            <div>
              <h2
                className="m-0 text-base font-bold text-[#2C2118]"
                style={{ fontFamily: "Playfair Display, serif" }}
              >
                Recommendations by status
              </h2>
              <p className="m-0 mt-0.5 text-[11px] text-[#9B8B78]">
                Platform-wide recommendation status
              </p>
            </div>
          </div>
          <div className="p-4 sm:p-5">
            <StatusTable
              title=""
              map={ov.recommendations}
            />
          </div>
        </div>
        <div className="mb-6 flex items-center gap-2 text-xs text-[#9B8B78]">
          <FiClock size={13} />
          <span>As of {when(ov.generatedAt)}</span>
        </div>
      </>
    )}
    <section className="max-w-5xl overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)] shadow-sm">
      <div className="flex flex-col gap-3 border-b border-[var(--line)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F8F1E7] text-[var(--gold)]">
            <FiShield size={19} />
          </div>
          <div>
            <h2
              className="m-0 text-base font-bold text-[#2C2118]"
              style={{ fontFamily: "Playfair Display, serif" }}
            >
              Support-mode tenant drill-down
            </h2>
            <p className="m-0 mt-0.5 text-xs text-[#7A6C57]">
              View tenant-level operational metrics
            </p>
          </div>
        </div>
        <div className="flex w-fit items-center gap-2 rounded-full border border-[#E8D9C5] bg-[#FBF4E7] px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-[#8B6938]">
          <FiShield size={12} />
          Audited support mode
        </div>
      </div>
      <div className="p-4 sm:p-5">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1fr_auto]">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-[#5A4B37]">
              Tenant ID
            </label>
            <div className="relative">
              <FiUsers
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9B8B78]"
                size={15}
              />
              <input
                placeholder="Enter tenant ID"
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                className="h-11 w-full rounded-xl border border-[var(--line)] bg-white pl-9 pr-3 text-sm text-[#2C2118] outline-none transition placeholder:text-[#B4A99B] focus:border-[var(--gold)] focus:ring-2 focus:ring-[var(--gold)]/10"
              />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-[#5A4B37]">
              Reason
            </label>
            <div className="relative">
              <FiInfo
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9B8B78]"
                size={15}
              />
              <input
                placeholder="Reason (audited, 5+ chars)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="h-11 w-full rounded-xl border border-[var(--line)] bg-white pl-9 pr-3 text-sm text-[#2C2118] outline-none transition placeholder:text-[#B4A99B] focus:border-[var(--gold)] focus:ring-2 focus:ring-[var(--gold)]/10"
              />
            </div>
          </div>
          <div className="flex items-end">
            <button
              onClick={drill}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--gold)] px-6 text-sm font-bold text-white shadow-sm transition hover:opacity-90 lg:w-auto"
            >
              <FiEye size={16} />
              View Tenant
            </button>
          </div>
        </div>
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-[#E8D9C5] bg-[#FBF7F1] px-3 py-2.5 text-xs leading-5 text-[#7A6C57]">
          <FiShield className="mt-0.5 shrink-0 text-[var(--gold)]" size={14} />
          <span>
            Tenant drill-down is performed in audited support mode. Only
            operational metrics are displayed.
          </span>
        </div>
        {tErr && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-[#F1C8C1] bg-[#FFF6F4] px-4 py-3 text-sm text-[#A12D2D]">
            <FiAlertCircle className="mt-0.5 shrink-0" size={17} />
            <span>{tErr}</span>
          </div>
        )}
        {tenant && (
          <div className="mt-5 border-t border-[var(--line)] pt-5">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3
                  className="m-0 text-lg font-bold text-[#2C2118]"
                  style={{ fontFamily: "Playfair Display, serif" }}
                >
                  Tenant Overview
                </h3>
                <p className="m-0 mt-1 text-xs text-[#9B8B78]">
                  Support-mode operational metrics
                </p>
              </div>
              <div
                className={`flex w-fit items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ${tenant.automationEnabled
                    ? "bg-[#EDF7F0] text-[#4C8A5A]"
                    : "bg-[#FBEDEA] text-[#B85B4D]"
                  }`}
              >
                {tenant.automationEnabled ? (
                  <FiUserCheck size={14} />
                ) : (
                  <FiUserX size={14} />
                )}
                Automation:{" "}
                {tenant.automationEnabled ? "Enabled" : "Disabled"}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <div className="rounded-xl border border-[var(--line)] bg-white p-3">
                <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-[#F8F1E7] text-[var(--gold)]">
                  <FiActivity size={15} />
                </div>
                <div className="text-[11px] text-[#9B8B78]">Runs</div>
                <div className="mt-1 text-lg font-extrabold text-[#2C2118]">
                  {dash(tenant.runCount)}
                </div>
              </div>
              <div className="rounded-xl border border-[var(--line)] bg-white p-3">
                <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-[#EDF7F0] text-[#4C8A5A]">
                  <FiCheckCircle size={15} />
                </div>
                <div className="text-[11px] text-[#9B8B78]">
                  Runs completed
                </div>
                <div className="mt-1 text-lg font-extrabold text-[#4C8A5A]">
                  {dash(tenant.runsCompleted)}
                </div>
              </div>
              <div className="rounded-xl border border-[var(--line)] bg-white p-3">
                <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-[#FBEDEA] text-[#B85B4D]">
                  <FiXCircle size={15} />
                </div>
                <div className="text-[11px] text-[#9B8B78]">
                  Runs failed
                </div>
                <div className="mt-1 text-lg font-extrabold text-[#B85B4D]">
                  {dash(tenant.runsFailed)}
                </div>
              </div>
              <div className="rounded-xl border border-[var(--line)] bg-white p-3">
                <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-[#F8F1E7] text-[var(--gold)]">
                  <FiBarChart2 size={15} />
                </div>
                <div className="text-[11px] text-[#9B8B78]">
                  Recommendations
                </div>
                <div className="mt-1 text-lg font-extrabold text-[var(--gold)]">
                  {dash(tenant.recommendationCount)}
                </div>
              </div>
              <div className="rounded-xl border border-[var(--line)] bg-white p-3">
                <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-[#FBF4E7] text-[#8B6938]">
                  <FiRefreshCw size={15} />
                </div>
                <div className="text-[11px] text-[#9B8B78]">
                  Automation
                </div>
                <div
                  className={`mt-1 text-lg font-extrabold ${tenant.automationEnabled
                      ? "text-[#4C8A5A]"
                      : "text-[#B85B4D]"
                    }`}
                >
                  {tenant.automationEnabled ? "Enabled" : "Disabled"}
                </div>
              </div>
            </div>
            <div className="mt-5 overflow-hidden rounded-xl border border-[var(--line)] bg-white">
              <div className="flex items-center gap-2 border-b border-[var(--line)] px-4 py-3">
                <FiBarChart2 className="text-[var(--gold)]" size={16} />
                <span className="text-sm font-bold text-[#2C2118]">
                  Recommendations by status
                </span>
              </div>
              <div className="p-3 sm:p-4">
                <StatusTable
                  title=""
                  map={tenant.recommendationsByStatus}
                />
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2 text-xs text-[#9B8B78]">
              <FiClock size={13} />
              <span>
                Support-mode view · as of {when(tenant.generatedAt)}
              </span>
            </div>
          </div>
        )}
      </div>
    </section>
  </div>
  );
}
