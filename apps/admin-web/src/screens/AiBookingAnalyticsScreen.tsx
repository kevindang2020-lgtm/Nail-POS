// AiBookingAnalyticsScreen.tsx — Super Admin view of the AI Booking conversion funnel (§46), per tenant. Reads the
// tenant-scoped metrics endpoint and shows overall conversion, a per-source breakdown (searches → attempts → bookings +
// rates), and the top failure reasons. Bars are proportional; empty state is honest (no fabricated numbers).
import { useEffect, useState } from "react";
import { superAdminAiApi } from "../api/superAdminAiApi";
import { superAdminApi } from "../api/superAdminApi";
import {
  FiActivity,
  FiAlertCircle,
  FiBarChart2,
  FiCalendar,
  FiCheckCircle,
  FiClock,
  FiSearch,
  FiTarget,
  FiTrendingUp,
  FiXCircle,
} from "react-icons/fi";
const GOLD = "var(--g7,#A96F22)";
const LINE = "var(--line,#E7DBC6)";
const CARD: React.CSSProperties = {
  background: "#fff",
  border: `1px solid ${LINE}`,
  borderRadius: 12,
  padding: 16,
  maxWidth: 760,
  marginBottom: 12,
};
const PCT = (n: number) => `${Math.round(n * 1000) / 10}%`;

const SOURCE_LABEL: Record<string, string> = {
  AI_PHONE_RECEPTIONIST: "AI Phone",
  FRONT_DESK_POS: "Front Desk",
  CUSTOMER_MOBILE_APP: "Customer App",
  ONLINE_BOOKING: "Online",
  PARTNER_BOOKING_LINK: "Partner",
  WALK_IN_CONVERSION: "Walk-In",
  SUPER_ADMIN_SUPPORT_MODE: "Support",
};

export default function AiBookingAnalyticsScreen() {
  const [tenantList, setTenantList] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [tenantId, setTenantId] = useState("");
  const [sinceDays, setSinceDays] = useState(30);
  const [m, setM] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    superAdminApi
      .state()
      .then((r: any) => {
        const l = (r?.tenants || []).map((t: any) => ({
          id: t.id,
          name: t.n || t.displayName || t.name || t.legalName || t.code || t.id,
          code: t.code,
        }));
        setTenantList(l);
        if (!tenantId && l[0]) setTenantId(l[0].id);
      })
      .catch(() => setTenantList([]));
  }, []);
  useEffect(() => {
    if (!tenantId) return;
    setLoading(true);
    superAdminAiApi
      .aiBookingMetrics(tenantId, sinceDays)
      .then(setM)
      .catch(() => setM(null))
      .finally(() => setLoading(false));
  }, [tenantId, sinceDays]);

  const o = m?.overall;
  const maxSuccess = Math.max(
    1,
    ...(m?.bySource || []).map((s: any) => s.successes),
  );

  return (
    <div className="p-5">
      <div className="mb-5 lg:mb-6">
        <div className="flex items-start gap-3">
       

          <div>
            <h1
              className="m-0 text-[22px] font-bold leading-tight  sm:text-[24px] lg:text-[26px]"
              style={{ fontFamily: "Playfair Display, serif" }}
            >
              AI Booking Analytics
            </h1>

            <p className="mt-1 max-w-4xl text-xs leading-5 text-[#7A6C57] sm:text-[13px]">
              Conversion across every AI-assisted booking source for this salon.
              Booking conversion = confirmed bookings ÷ attempts; search →
              booking = confirmed bookings ÷ availability searches.
            </p>
          </div>
        </div>
      </div>

      <div className="mb-5 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-3 shadow-sm sm:p-4 lg:mb-6">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_220px] lg:items-end">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-[#7A6C57]">
              Tenant
            </label>

            <div className="relative">
              <FiTarget
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9B8B78]"
              />

              <select
                className="h-10 w-full appearance-none rounded-xl border border-[var(--line)] bg-white pl-9 pr-3 text-[13px] text-[#4A3F30] outline-none transition focus:border-[var(--gold)] focus:ring-2 focus:ring-[var(--gold)]/10"
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
              >
                {tenantList.length === 0 && <option value="">Loading…</option>}

                {tenantList.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-[#7A6C57]">
              Analytics Window
            </label>

            <div className="relative">
              <FiCalendar
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9B8B78]"
              />

              <select
                className="h-10 w-full appearance-none rounded-xl border border-[var(--line)] bg-white pl-9 pr-3 text-[13px] text-[#4A3F30] outline-none transition focus:border-[var(--gold)] focus:ring-2 focus:ring-[var(--gold)]/10"
                value={sinceDays}
                onChange={(e) => setSinceDays(Number(e.target.value))}
              >
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {loading && (
        <div className="flex min-h-[180px] items-center justify-center rounded-2xl border border-[var(--line)] bg-[var(--card)]">
          <div className="flex items-center gap-2 text-sm text-[#9B8B78]">
            <FiClock className="animate-spin" size={17} />
            Loading analytics…
          </div>
        </div>
      )}

      {!loading && o && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {[
              {
                label: "Booking conversion",
                value: PCT(o.bookingConversionRate),
                icon: FiTrendingUp,
              },
              {
                label: "Search → booking",
                value: PCT(o.searchToBookingRate),
                icon: FiSearch,
              },
              {
                label: "Bookings",
                value: String(o.successes),
                icon: FiCheckCircle,
              },
              {
                label: "Attempts",
                value: String(o.attempts),
                icon: FiActivity,
              },
              {
                label: "Searches",
                value: String(o.searches),
                icon: FiTarget,
              },
              {
                label: "Failures",
                value: String(o.failures),
                icon: FiXCircle,
              },
            ].map(({ label, value, icon: Icon }) => (
              <div
                key={label}
                className="group rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#F8F1E7] text-[var(--gold)]">
                    <Icon size={16} />
                  </div>
                </div>

                <div
                  className="text-xl font-extrabold text-[var(--gold)] sm:text-[22px]"
                  style={{ fontFamily: "Playfair Display, serif" }}
                >
                  {value}
                </div>

                <div className="mt-1 text-[11px] font-medium leading-4 text-[#7A6C57] sm:text-xs">
                  {label}
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(280px,0.8fr)]">
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 shadow-sm sm:p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="m-0 text-sm font-bold text-[#5A4B37] sm:text-[15px]">
                    Booking Performance by Source
                  </h2>

                  <p className="mt-1 text-[11px] text-[#9B8B78]">
                    Compare successful bookings across AI sources
                  </p>
                </div>

                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#F8F1E7] text-[var(--gold)]">
                  <FiBarChart2 size={16} />
                </div>
              </div>

              {(!m.bySource || m.bySource.length === 0) && (
                <div className="flex min-h-[120px] items-center justify-center text-xs text-[#9B8B78]">
                  No booking activity recorded in this window yet.
                </div>
              )}

              {m.bySource?.length > 0 && (
                <div className="space-y-3">
                  {m.bySource.map((s: any) => {
                    const percentage =
                      maxSuccess > 0 ? (s.successes / maxSuccess) * 100 : 0;

                    return (
                      <div
                        key={s.source}
                        className="rounded-xl border border-[#EFE6D9] bg-[#FFFCF8] p-3"
                      >
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-xs font-bold text-[#4A3F30]">
                              {SOURCE_LABEL[s.source] || s.source}
                            </div>

                            <div className="mt-0.5 text-[10px] text-[#9B8B78]">
                              {s.successes} of {s.attempts} attempts converted
                            </div>
                          </div>

                          <div className="shrink-0 text-xs font-bold text-[var(--gold)]">
                            {PCT(s.bookingConversionRate)}
                          </div>
                        </div>

                        <div className="h-2 overflow-hidden rounded-full bg-[#F2E9DA]">
                          <div
                            className="h-full rounded-full bg-[var(--gold)] transition-all duration-500"
                            style={{
                              width: `${percentage}%`,
                              minWidth: s.successes ? "4px" : "0",
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {m.failureReasons?.length > 0 && (
              <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 shadow-sm sm:p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="m-0 text-sm font-bold text-[#5A4B37] sm:text-[15px]">
                      Top Failure Reasons
                    </h2>

                    <p className="mt-1 text-[11px] text-[#9B8B78]">
                      Most common booking failures
                    </p>
                  </div>

                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#FBEDEA] text-[#B85B4D]">
                    <FiAlertCircle size={16} />
                  </div>
                </div>

                <div className="space-y-2">
                  {m.failureReasons.map((f: any, index: number) => (
                    <div
                      key={f.reason}
                      className="flex items-center justify-between gap-3 rounded-xl border border-[#F0E4D8] bg-[#FFFCF9] px-3 py-2.5"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#FBEDEA] text-[10px] font-bold text-[#B85B4D]">
                          {index + 1}
                        </span>

                        <span className="truncate text-xs font-semibold text-[#B85B4D]">
                          {f.reason}
                        </span>
                      </div>

                      <span className="shrink-0 rounded-lg bg-[#F8F1E7] px-2 py-1 text-xs font-bold text-[#7A6C57]">
                        {f.count}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
