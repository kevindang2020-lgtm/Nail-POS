// AiCustomerProfileOversightScreen.tsx — Super Admin oversight for the AI Customer Profile Assistant (§54/§55).
// Platform-operational counts only (never cross-tenant customer data), plus a controlled support-mode drill-down into
// one tenant's usage + aggregate. A visible support-mode banner is shown while drilled in; access is audited server-side.
import { useEffect, useState } from 'react';
import { superAdminAiCustomerProfileApi as saApi } from '../api/superAdminAiCustomerProfileApi';
import { superAdminApi } from '../api/superAdminApi';
import {
  FiAlertCircle,
  FiBarChart2,
  FiCheckCircle,
  FiChevronDown,
  FiDatabase,
  FiEye,
  FiInfo,
  FiLock,
  FiSearch,
  FiShield,
  FiUsers,
  FiUserCheck,
  FiUserX,
  FiSettings,
  FiTrendingUp,
} from "react-icons/fi";
const GOLD = 'var(--g7,#A96F22)';
const LINE = 'var(--line,#E7DBC6)';
const CARD: React.CSSProperties = { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 16, maxWidth: 820, marginBottom: 12 };
const DASH = '\u2014';

const USAGE_LABEL: Record<string, string> = {
  summaries_generated: 'Summaries generated', preference_calculations: 'Preference calculations',
  churn_evaluations: 'Churn evaluations', duplicate_scans: 'Duplicate scans',
  service_recommendations: 'Service recommendations', rebooking_opportunities: 'Rebooking opportunities',
  inactivity_detections: 'Inactivity detections', timelines_built: 'Timelines built',
  merges_executed: 'Merges executed', merge_previews: 'Merge previews', settings_changes: 'Settings changes',
  permission_denied: 'Permission denials', disabled_blocked: 'Blocked (disabled)',
};

export default function AiCustomerProfileOversightScreen() {
  const [ov, setOv] = useState<any>(null);
  const [ovLoading, setOvLoading] = useState(true);
  const [tenantList, setTenantList] = useState<{ id: string; name: string }[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [reason, setReason] = useState('');
  const [drill, setDrill] = useState<any>(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { saApi.overview().then(setOv).catch(() => setOv(null)).finally(() => setOvLoading(false)); }, []);
  useEffect(() => {
    superAdminApi.state().then((r: any) => {
      const l = (r?.tenants || []).map((t: any) => ({
        id: t.id,
        name: t.n || t.displayName || t.name || t.legalName || t.code || t.id,
        code: t.code,
      }));
      setTenantList(l); if (!tenantId && l[0]) setTenantId(l[0].id);
    }).catch(() => setTenantList([]));
  }, []);

  const runDrill = () => {
    if (!tenantId) return;
    if (!reason.trim()) { setErr('Enter a support reason before viewing a tenant.'); return; }
    setErr(null); setDrillLoading(true); setDrill(null);
    saApi.tenantView(tenantId, reason.trim()).then(setDrill).catch((e: any) => setErr(e?.message || 'Could not load tenant view.')).finally(() => setDrillLoading(false));
  };

  const kpi = (label: string, value: any) => (
    <div style={{ ...CARD, maxWidth: 200, display: 'inline-block', marginRight: 12, padding: 14, verticalAlign: 'top' }}>
      <div style={{ fontSize: 12, color: '#7A6C57', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 26, color: GOLD, fontWeight: 700 }}>{value ?? DASH}</div>
    </div>
  );

  const usageEntries = drill?.usage ? Object.entries(drill.usage) : [];
  const agg = drill?.overview;

  return (
  <div className="p-5">
    <div className="mb-3">
      <div className="flex items-start gap-3">
        <div>
          <h1
            className="m-0 text-[22px] font-bold leading-tight text-[#4A3F30] sm:text-[24px] lg:text-[26px]"
            style={{ fontFamily: "Playfair Display, serif" }}
          >
            AI Customer Profile Oversight
          </h1>

          <p className="mt-1 max-w-4xl text-xs leading-5 text-[#7A6C57] sm:text-[13px]">
            Platform-operational counts only — no cross-tenant customer data.
            Use support-mode drill-down with a recorded reason to inspect a
            single tenant's usage.
          </p>
        </div>
      </div>
    </div>

    {ovLoading ? (
      <div className="mb-5 flex min-h-[120px] items-center justify-center rounded-2xl border border-[var(--line)] bg-[var(--card)]">
        <div className="flex items-center gap-2 text-sm text-[#9B8B78]">
          <FiBarChart2 className="animate-pulse" size={17} />
          Loading platform overview…
        </div>
      </div>
    ) : (
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 lg:gap-4">
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#F8F1E7] text-[var(--gold)]">
              <FiUsers size={17} />
            </div>
          </div>

          <div
            className="text-2xl font-extrabold text-[var(--gold)]"
            style={{ fontFamily: "Playfair Display, serif" }}
          >
            {ov?.totalTenants ?? 0}
          </div>

          <div className="mt-1 text-[11px] font-medium text-[#7A6C57] sm:text-xs">
            Active tenants
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#EDF7F0] text-[#4C8A5A]">
              <FiCheckCircle size={17} />
            </div>
          </div>

          <div
            className="text-2xl font-extrabold text-[#4C8A5A]"
            style={{ fontFamily: "Playfair Display, serif" }}
          >
            {ov?.tenantsEnabled ?? 0}
          </div>

          <div className="mt-1 text-[11px] font-medium text-[#7A6C57] sm:text-xs">
            Assistant enabled
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#FBEDEA] text-[#B85B4D]">
              <FiUserX size={17} />
            </div>
          </div>

          <div
            className="text-2xl font-extrabold text-[#B85B4D]"
            style={{ fontFamily: "Playfair Display, serif" }}
          >
            {ov?.tenantsDisabled ?? 0}
          </div>

          <div className="mt-1 text-[11px] font-medium text-[#7A6C57] sm:text-xs">
            Disabled / kill switch
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#F8F1E7] text-[var(--gold)]">
              <FiSettings size={17} />
            </div>
          </div>

          <div
            className="text-2xl font-extrabold text-[var(--gold)]"
            style={{ fontFamily: "Playfair Display, serif" }}
          >
            {ov?.tenantsWithSettings ?? 0}
          </div>

          <div className="mt-1 text-[11px] font-medium text-[#7A6C57] sm:text-xs">
            With custom settings
          </div>
        </div>
      </div>
    )}

    <div className="mb-5 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)] shadow-sm">
      <div className="border-b border-[var(--line)] bg-[#FFFCF8] px-4 py-3 sm:px-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#F8F1E7] text-[var(--gold)]">
            <FiShield size={17} />
          </div>

          <div>
            <h2 className="m-0 text-sm font-bold text-[#5A4B37] sm:text-[15px]">
              Support Mode
            </h2>

            <p className="mt-0.5 text-[11px] text-[#9B8B78]">
              Tenant-specific diagnostic access
            </p>
          </div>

          <div className="ml-auto hidden items-center gap-1.5 rounded-full bg-[#FFF5E5] px-2.5 py-1 text-[10px] font-semibold text-[var(--gold)] sm:flex">
            <FiLock size={11} />
            Audited access
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-5">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.5fr_auto] lg:items-end">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-[#7A6C57]">
              Tenant
            </label>

            <div className="relative">
              <FiUsers
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9B8B78]"
              />

              <select
                className="h-10 w-full appearance-none rounded-xl border border-[var(--line)] bg-white pl-9 pr-9 text-[13px] text-[#4A3F30] outline-none transition focus:border-[var(--gold)] focus:ring-2 focus:ring-[var(--gold)]/10"
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
              >
                {tenantList.length === 0 && (
                  <option value="">Loading…</option>
                )}

                {tenantList.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>

              <FiChevronDown
                size={15}
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#9B8B78]"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[#7A6C57]">
              Support reason
              <span className="rounded-full bg-[#F8F1E7] px-1.5 py-0.5 text-[9px] font-medium text-[var(--gold)]">
                Required
              </span>
            </label>

            <div className="relative">
              <FiInfo
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9B8B78]"
              />

              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. investigating a data-quality report"
                className="h-10 w-full rounded-xl border border-[var(--line)] bg-white pl-9 pr-3 text-[13px] text-[#4A3F30] outline-none placeholder:text-[#B5A898] transition focus:border-[var(--gold)] focus:ring-2 focus:ring-[var(--gold)]/10"
              />
            </div>
          </div>

          <button
            onClick={runDrill}
            disabled={drillLoading}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[var(--gold)] px-5 text-[13px] font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 lg:w-auto"
          >
            {drillLoading ? (
              <>
                <FiSearch className="animate-pulse" size={15} />
                Loading…
              </>
            ) : (
              <>
                <FiEye size={15} />
                View tenant
              </>
            )}
          </button>
        </div>

        <div className="mt-3 flex items-start gap-2 rounded-xl bg-[#FBF4E7] px-3 py-2.5 text-[11px] leading-4 text-[#8A7351]">
          <FiShield className="mt-0.5 shrink-0" size={13} />
          <span>
            Support-mode access requires a reason and is recorded for audit
            purposes.
          </span>
        </div>
      </div>
    </div>

    {err && (
      <div className="mb-5 flex items-start gap-2 rounded-2xl border border-[#E6B8B2] bg-[#FFF6F4] p-4 text-sm text-[#A12D2D]">
        <FiAlertCircle className="mt-0.5 shrink-0" size={17} />
        <span>{err}</span>
      </div>
    )}

    {drill && (
      <>
        <div className="mb-5 flex items-start gap-3 rounded-2xl border border-[var(--gold)] bg-[#FBF4E7] p-4 shadow-sm">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--gold)] text-white">
            <FiShield size={17} />
          </div>

          <div>
            <div className="text-sm font-bold text-[var(--gold)]">
              Support mode active
            </div>

            <div className="mt-0.5 text-xs leading-5 text-[#806B4C]">
              Viewing tenant{" "}
              <strong className="font-bold">{drill.tenantId}</strong>.
              This access has been recorded.
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 shadow-sm sm:p-5">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#F8F1E7] text-[var(--gold)]">
                <FiDatabase size={17} />
              </div>

              <div>
                <h2 className="m-0 text-sm font-bold text-[#5A4B37] sm:text-[15px]">
                  Usage
                </h2>

                <p className="mt-0.5 text-[11px] text-[#9B8B78]">
                  Usage recorded on this node
                </p>
              </div>
            </div>

            {usageEntries.length === 0 ? (
              <div className="flex min-h-[120px] items-center justify-center rounded-xl bg-[#FFFCF8] text-xs text-[#7A6C57]">
                No usage recorded yet on this instance.
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-[#EFE6D9]">
                <div className="divide-y divide-[#EFE6D9]">
                  {usageEntries.map(([k, v]) => (
                    <div
                      key={k}
                      className="flex items-center justify-between gap-4 bg-[#FFFCF8] px-3 py-3"
                    >
                      <span className="min-w-0 truncate text-xs text-[#5B5040]">
                        {USAGE_LABEL[k] || k}
                      </span>

                      <span className="shrink-0 rounded-lg bg-[#F8F1E7] px-2.5 py-1 text-xs font-bold text-[#5B5040]">
                        {String(v)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 shadow-sm sm:p-5">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#F8F1E7] text-[var(--gold)]">
                <FiBarChart2 size={17} />
              </div>

              <div>
                <h2 className="m-0 text-sm font-bold text-[#5A4B37] sm:text-[15px]">
                  Customer Aggregate
                </h2>

                <p className="mt-0.5 text-[11px] text-[#9B8B78]">
                  High-level customer metrics
                </p>
              </div>
            </div>

            {!agg || agg.totalScanned == null ? (
              <div className="flex min-h-[120px] items-center justify-center rounded-xl bg-[#FFFCF8] px-4 text-center text-xs leading-5 text-[#7A6C57]">
                No aggregate computed yet — the tenant's Overview refresh or
                scheduled scan populates this.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-[#EFE6D9] bg-[#FFFCF8] p-3">
                  <div className="mb-2 flex h-7 w-7 items-center justify-center rounded-lg bg-[#F8F1E7] text-[var(--gold)]">
                    <FiSearch size={14} />
                  </div>

                  <div className="text-lg font-bold text-[#4A3F30]">
                    {agg.totalScanned}
                  </div>

                  <div className="text-[10px] text-[#9B8B78]">
                    Scanned
                  </div>
                </div>

                <div className="rounded-xl border border-[#EFE6D9] bg-[#FFFCF8] p-3">
                  <div className="mb-2 flex h-7 w-7 items-center justify-center rounded-lg bg-[#EDF7F0] text-[#4C8A5A]">
                    <FiUserCheck size={14} />
                  </div>

                  <div className="text-lg font-bold text-[#4A3F30]">
                    {agg.active}
                  </div>

                  <div className="text-[10px] text-[#9B8B78]">
                    Active
                  </div>
                </div>

                <div className="rounded-xl border border-[#EFE6D9] bg-[#FFFCF8] p-3">
                  <div className="mb-2 flex h-7 w-7 items-center justify-center rounded-lg bg-[#FBEDEA] text-[#B85B4D]">
                    <FiUserX size={14} />
                  </div>

                  <div className="text-lg font-bold text-[#4A3F30]">
                    {(agg.inactive ?? 0) + (agg.longTermInactive ?? 0)}
                  </div>

                  <div className="text-[10px] text-[#9B8B78]">
                    Inactive
                  </div>
                </div>

                <div className="rounded-xl border border-[#EFE6D9] bg-[#FFFCF8] p-3">
                  <div className="mb-2 flex h-7 w-7 items-center justify-center rounded-lg bg-[#FFF5E5] text-[var(--gold)]">
                    <FiAlertCircle size={14} />
                  </div>

                  <div className="text-lg font-bold text-[#4A3F30]">
                    {agg.coarseChurnWatch}
                  </div>

                  <div className="text-[10px] text-[#9B8B78]">
                    Churn watch
                  </div>
                </div>

                <div className="rounded-xl border border-[#EFE6D9] bg-[#FFFCF8] p-3">
                  <div className="mb-2 flex h-7 w-7 items-center justify-center rounded-lg bg-[#F8F1E7] text-[var(--gold)]">
                    <FiTrendingUp size={14} />
                  </div>

                  <div className="text-lg font-bold text-[#4A3F30]">
                    {agg.rebookingOpportunities}
                  </div>

                  <div className="text-[10px] text-[#9B8B78]">
                    Rebooking
                  </div>
                </div>

                <div className="rounded-xl border border-[#EFE6D9] bg-[#FFFCF8] p-3">
                  <div className="mb-2 flex h-7 w-7 items-center justify-center rounded-lg bg-[#F8F1E7] text-[var(--gold)]">
                    <FiUsers size={14} />
                  </div>

                  <div className="text-lg font-bold text-[#4A3F30]">
                    {agg.duplicateCandidateGroups}
                  </div>

                  <div className="text-[10px] text-[#9B8B78]">
                    Duplicate groups
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </>
    )}
  </div>
  );
}
