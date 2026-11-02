// AiCheckoutUpsellOversightScreen.tsx — Super Admin oversight. Platform-operational counts + acceptance rate, and an
// audited support-mode per-tenant drill-down (a reason is required). No cross-tenant customer data is shown.
import { useEffect, useState } from "react";
import { superAdminAiCheckoutUpsellApi as saApi } from "../api/superAdminAiCheckoutUpsellApi";
import {
  FiActivity,
  FiAlertCircle,
  FiBarChart2,
  FiCheckCircle,
  FiEye,
  FiInfo,
  FiPercent,
  FiTrendingUp,
  FiUserCheck,
  FiUserX,
  FiUsers,
} from "react-icons/fi";

const dash = (v: any) => (v == null ? "—" : v);


export default function AiCheckoutUpsellOversightScreen() {
  const [ov, setOv] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState("");
  const [reason, setReason] = useState("");
  const [tenant, setTenant] = useState<any>(null);
  const [tErr, setTErr] = useState<string | null>(null);

  useEffect(() => {
    saApi
      .overview()
      .then(setOv)
      .catch(() => setErr("Could not load overview."));
  }, []);

  const drill = async () => {
    setTErr(null);
    setTenant(null);
    if (!tenantId.trim() || reason.trim().length < 3) {
      setTErr("Tenant id and a reason (3+ chars) are required.");
      return;
    }
    try {
      setTenant(await saApi.tenantView(tenantId.trim(), reason.trim()));
    } catch {
      setTErr("Could not load tenant view.");
    }
  };

  return (
    <div className="p-5">
      <div className="mb-3">
        <div className="flex items-start gap-3">
          <div>
            <h1
              className="m-0 text-[22px] font-bold leading-tight  sm:text-[24px] lg:text-[26px]"
              style={{ fontFamily: "Playfair Display, serif" }}
            >
              AI Checkout Upsell — Oversight
            </h1>

            <p className="mt-1 max-w-4xl text-xs leading-5 text-[#7A6C57] sm:text-[13px]">
              Platform-operational metrics only. Per-tenant drill-down runs in
              support mode and is audited.
            </p>
          </div>
        </div>
      </div>

      {err && (
        <div className="mb-5 flex items-start gap-2 rounded-2xl border border-[#E6B8B2] bg-[#FFF6F4] p-4 text-sm text-[#A12D2D]">
          <FiAlertCircle className="mt-0.5 shrink-0" size={17} />
          <span>{err}</span>
        </div>
      )}

      {ov && (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 lg:gap-4">
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-[#F8F1E7] text-[var(--gold)]">
              <FiUsers size={17} />
            </div>

            <div
              className="text-2xl font-extrabold text-[var(--gold)]"
              style={{ fontFamily: "Playfair Display, serif" }}
            >
              {ov.totalTenants}
            </div>

            <div className="mt-1 text-[11px] font-medium text-[#7A6C57] sm:text-xs">
              Tenants
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-[#EDF7F0] text-[#4C8A5A]">
              <FiCheckCircle size={17} />
            </div>

            <div
              className="text-2xl font-extrabold text-[#4C8A5A]"
              style={{ fontFamily: "Playfair Display, serif" }}
            >
              {ov.tenantsEnabled}
            </div>

            <div className="mt-1 text-[11px] font-medium text-[#7A6C57] sm:text-xs">
              Assistant enabled
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-[#FBEDEA] text-[#B85B4D]">
              <FiUserX size={17} />
            </div>

            <div
              className="text-2xl font-extrabold text-[#B85B4D]"
              style={{ fontFamily: "Playfair Display, serif" }}
            >
              {ov.tenantsDisabled}
            </div>

            <div className="mt-1 text-[11px] font-medium text-[#7A6C57] sm:text-xs">
              Assistant disabled
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-[#F8F1E7] text-[var(--gold)]">
              <FiBarChart2 size={17} />
            </div>

            <div
              className="text-2xl font-extrabold text-[var(--gold)]"
              style={{ fontFamily: "Playfair Display, serif" }}
            >
              {ov.recommendationsGenerated}
            </div>

            <div className="mt-1 text-[11px] font-medium text-[#7A6C57] sm:text-xs">
              Recommendations generated
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-[#EDF7F0] text-[#4C8A5A]">
              <FiTrendingUp size={17} />
            </div>

            <div
              className="text-2xl font-extrabold text-[#4C8A5A]"
              style={{ fontFamily: "Playfair Display, serif" }}
            >
              {ov.recommendationsApplied}
            </div>

            <div className="mt-1 text-[11px] font-medium text-[#7A6C57] sm:text-xs">
              Applied
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-[#F8F1E7] text-[var(--gold)]">
              <FiPercent size={17} />
            </div>

            <div
              className="text-2xl font-extrabold text-[var(--gold)]"
              style={{ fontFamily: "Playfair Display, serif" }}
            >
              {ov.acceptanceRatePct == null ? "—" : `${ov.acceptanceRatePct}%`}
            </div>

            <div className="mt-1 text-[11px] font-medium text-[#7A6C57] sm:text-xs">
              Acceptance rate
            </div>
          </div>
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)] shadow-sm">
        <div className="border-b border-[var(--line)] bg-[#FFFCF8] px-4 py-3 sm:px-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#F8F1E7] text-[var(--gold)]">
              <FiEye size={17} />
            </div>

            <div>
              <h2 className="m-0 text-sm font-bold text-[#5A4B37] sm:text-[15px]">
                Support-mode tenant drill-down
              </h2>

              <p className="mt-0.5 text-[11px] text-[#9B8B78]">
                Inspect individual tenant upsell activity
              </p>
            </div>

            <div className="ml-auto hidden items-center gap-1.5 rounded-full bg-[#FFF5E5] px-2.5 py-1 text-[10px] font-semibold text-[var(--gold)] sm:flex">
              <FiActivity size={11} />
              Audited
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.4fr_auto] lg:items-end">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-[#7A6C57]">
                Tenant ID
              </label>

              <div className="relative">
                <FiUsers
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9B8B78]"
                />

                <input
                  placeholder="Enter tenant ID"
                  value={tenantId}
                  onChange={(e) => setTenantId(e.target.value)}
                  className="h-10 w-full rounded-xl border border-[var(--line)] bg-white pl-9 pr-3 text-[13px] text-[#4A3F30] outline-none placeholder:text-[#B5A898] transition focus:border-[var(--gold)] focus:ring-2 focus:ring-[var(--gold)]/10"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[#7A6C57]">
                Reason
                <span className="rounded-full bg-[#F8F1E7] px-1.5 py-0.5 text-[9px] font-medium text-[var(--gold)]">
                  Audited
                </span>
              </label>

              <div className="relative">
                <FiInfo
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9B8B78]"
                />

                <input
                  placeholder="Why are you inspecting this tenant?"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="h-10 w-full rounded-xl border border-[var(--line)] bg-white pl-9 pr-3 text-[13px] text-[#4A3F30] outline-none placeholder:text-[#B5A898] transition focus:border-[var(--gold)] focus:ring-2 focus:ring-[var(--gold)]/10"
                />
              </div>
            </div>

            <button
              onClick={drill}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[var(--gold)] px-6 text-[13px] font-semibold text-white shadow-sm transition hover:opacity-90 active:scale-[0.98] lg:w-auto"
            >
              <FiEye size={15} />
              View Tenant
            </button>
          </div>

          <div className="mt-3 flex items-start gap-2 rounded-xl bg-[#FBF4E7] px-3 py-2.5 text-[11px] leading-4 text-[#806B4C]">
            <FiInfo className="mt-0.5 shrink-0" size={13} />
            <span>
              Tenant drill-down is performed in support mode and every access is
              recorded for audit purposes.
            </span>
          </div>

          {tErr && (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-[#E6B8B2] bg-[#FFF6F4] px-3 py-2.5 text-xs text-[#A12D2D]">
              <FiAlertCircle className="mt-0.5 shrink-0" size={14} />
              <span>{tErr}</span>
            </div>
          )}

          {tenant && (
            <div className="mt-5 border-t border-[var(--line)] pt-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-bold text-[#5A4B37]">
                    Tenant Overview
                  </div>

                  <div className="mt-0.5 text-[11px] text-[#9B8B78]">
                    Current upsell activity and recommendation performance
                  </div>
                </div>

                <div
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold ${
                    tenant.disabled
                      ? "bg-[#FBEDEA] text-[#A12D2D]"
                      : "bg-[#EDF7F0] text-[#4C8A5A]"
                  }`}
                >
                  {tenant.disabled ? (
                    <FiUserX size={12} />
                  ) : (
                    <FiUserCheck size={12} />
                  )}

                  {tenant.disabled ? "Disabled" : "Enabled"}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <div className="rounded-xl border border-[#EFE6D9] bg-[#FFFCF8] p-3">
                  <div className="mb-2 flex h-7 w-7 items-center justify-center rounded-lg bg-[#F8F1E7] text-[var(--gold)]">
                    <FiBarChart2 size={14} />
                  </div>

                  <div className="text-lg font-bold text-[#4A3F30]">
                    {dash(tenant.generated)}
                  </div>

                  <div className="text-[10px] text-[#9B8B78]">Generated</div>
                </div>

                <div className="rounded-xl border border-[#EFE6D9] bg-[#FFFCF8] p-3">
                  <div className="mb-2 flex h-7 w-7 items-center justify-center rounded-lg bg-[#EDF7F0] text-[#4C8A5A]">
                    <FiCheckCircle size={14} />
                  </div>

                  <div className="text-lg font-bold text-[#4A3F30]">
                    {dash(tenant.applied)}
                  </div>

                  <div className="text-[10px] text-[#9B8B78]">Applied</div>
                </div>

                <div className="rounded-xl border border-[#EFE6D9] bg-[#FFFCF8] p-3">
                  <div className="mb-2 flex h-7 w-7 items-center justify-center rounded-lg bg-[#FBEDEA] text-[#B85B4D]">
                    <FiUserX size={14} />
                  </div>

                  <div className="text-lg font-bold text-[#4A3F30]">
                    {dash(tenant.dismissed)}
                  </div>

                  <div className="text-[10px] text-[#9B8B78]">Dismissed</div>
                </div>

                <div className="rounded-xl border border-[#EFE6D9] bg-[#FFFCF8] p-3">
                  <div className="mb-2 flex h-7 w-7 items-center justify-center rounded-lg bg-[#F8F1E7] text-[var(--gold)]">
                    <FiPercent size={14} />
                  </div>

                  <div className="text-lg font-bold text-[#4A3F30]">
                    {tenant.acceptanceRatePct == null
                      ? "—"
                      : `${tenant.acceptanceRatePct}%`}
                  </div>

                  <div className="text-[10px] text-[#9B8B78]">Acceptance</div>
                </div>

                <div className="rounded-xl border border-[#EFE6D9] bg-[#FFFCF8] p-3">
                  <div className="mb-2 flex h-7 w-7 items-center justify-center rounded-lg bg-[#F8F1E7] text-[var(--gold)]">
                    <FiActivity size={14} />
                  </div>

                  <div className="text-lg font-bold text-[#4A3F30]">
                    {tenant.disabled ? "Off" : "On"}
                  </div>

                  <div className="text-[10px] text-[#9B8B78]">
                    Assistant status
                  </div>
                </div>
              </div>

              {tenant.byType?.length > 0 && (
                <div className="mt-5 overflow-hidden rounded-xl border border-[#EFE6D9]">
                  <div className="flex items-center gap-2 border-b border-[#EFE6D9] bg-[#FFFCF8] px-4 py-3">
                    <FiBarChart2 size={15} className="text-[var(--gold)]" />

                    <div>
                      <div className="text-xs font-bold text-[#5A4B37]">
                        Recommendations by Type
                      </div>

                      <div className="text-[10px] text-[#9B8B78]">
                        Generated recommendation breakdown
                      </div>
                    </div>
                  </div>

                  <div className="hidden sm:block">
                    <table className="w-full border-collapse text-xs">
                      <thead>
                        <tr className="bg-[#FBF7F1] text-left text-[10px] uppercase tracking-wide text-[#9B8B78]">
                          <th className="px-4 py-2.5 font-semibold">Type</th>

                          <th className="px-4 py-2.5 text-right font-semibold">
                            Generated
                          </th>
                        </tr>
                      </thead>

                      <tbody>
                        {tenant.byType.map((r: any) => (
                          <tr
                            key={r.type}
                            className="border-t border-[#EFE6D9]"
                          >
                            <td className="px-4 py-3 font-medium text-[#5B5040]">
                              {r.type}
                            </td>

                            <td className="px-4 py-3 text-right font-bold text-[#4A3F30]">
                              {r.generated}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="divide-y divide-[#EFE6D9] sm:hidden">
                    {tenant.byType.map((r: any) => (
                      <div
                        key={r.type}
                        className="flex items-center justify-between gap-3 bg-[#FFFCF8] px-3 py-3"
                      >
                        <span className="truncate text-xs font-medium text-[#5B5040]">
                          {r.type}
                        </span>

                        <span className="shrink-0 rounded-lg bg-[#F8F1E7] px-2.5 py-1 text-xs font-bold text-[#5B5040]">
                          {r.generated}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
