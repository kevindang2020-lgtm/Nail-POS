// BookingCheckinScreen.tsx — Super Admin → Operations Oversight → Booking & Check-In Monitor → Overview.
// The platform-level monitoring center for booking creation + customer check-in infrastructure across all tenants.
// READ-ONLY: the Super Admin monitors/supports the flow and never performs receptionist actions (no create-appointment,
// manual check-in, assign-technician, queue-reorder, start/complete service, or checkout controls appear here). Bound
// 1:1 to the live aggregate at /super-admin/booking-checkin/overview — every value is real or honestly marked
// unavailable ("—" / "Not yet provisioned"); nothing is fabricated. Kept SEPARATE from Appointment Oversight.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  superAdminBookingCheckinApi,
  type SABookingCheckinOverview,
  type SAKpi,
  type SABranchWait,
} from "../api/superAdminBookingCheckinApi";

const GOLD = "var(--g7,#A96F22)";
const LINE = "var(--line,#E7DBC6)";
const SEMANTIC: Record<string, string> = {
  good: "#3E8F57",
  bad: "#B85B4D",
  neutral: "#9B8B78",
};
const SOURCE_COLOR: Record<string, string> = {
  online: "#4A8DB7",
  ai_receptionist: "#E08A3C",
  mobile_app: "#E0B84A",
  staff_created: "#4FA06A",
  walk_in: "#C75D4F",
  kiosk: "#8C7CC0",
  other: "#9B8B78",
};
const WAIT_COLOR: Record<string, string> = {
  good: "#3E8F57",
  acceptable: "#3E8F57",
  at_risk: "#D09A36",
  poor: "#C77A2E",
  critical: "#B85B4D",
};
const WAIT_LABEL: Record<string, string> = {
  good: "Good",
  acceptable: "Acceptable",
  at_risk: "At Risk",
  poor: "Poor",
  critical: "Critical",
};
const RETRY_COLOR: Record<string, string> = {
  failed: "#B85B4D",
  retrying: "#D09A36",
  retry_available: "#3C7FB6",
  resolved: "#3E8F57",
  not_retryable: "#9B8B78",
};
const todayISO = () => new Date().toISOString().slice(0, 10);
const OVERVIEW_REFRESH_MS = 20_000; // background auto-refresh cadence for the live monitor

const ICON: Record<string, string> = {
  online: "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  ai: "M12 2a5 5 0 0 1 5 5v3a5 5 0 0 1-10 0V7a5 5 0 0 1 5-5zM5 22h14",
  mobile:
    "M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM12 18h.01",
  staff:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  walk: "M13 4v6l5 2M9 20l2-6 4 2 1 4",
  kiosk:
    "M5 2h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM9 22h6",
  fail: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  dup: "M8 8h12v12H8zM4 16V4h12",
  clock: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 7v5l3 2",
  device:
    "M5 2h14a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM12 18h.01",
  user: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  pending: "M3 4h18v18H3zM16 2v4M8 2v4M3 10h18",
  api: "M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4",
};
const KPI_ICON: Record<string, { p: string; tint: string }> = {
  online_bookings: { p: ICON.online, tint: SOURCE_COLOR.online },
  ai_bookings: { p: ICON.ai, tint: SOURCE_COLOR.ai_receptionist },
  mobile_bookings: { p: ICON.mobile, tint: SOURCE_COLOR.mobile_app },
  staff_bookings: { p: ICON.staff, tint: SOURCE_COLOR.staff_created },
  walk_ins: { p: ICON.walk, tint: SOURCE_COLOR.walk_in },
  kiosk_check_ins: { p: ICON.kiosk, tint: SOURCE_COLOR.kiosk },
  failed_check_ins: { p: ICON.fail, tint: "#B85B4D" },
  duplicate_check_ins: { p: ICON.dup, tint: "#B85B4D" },
  avg_check_in_time: { p: ICON.clock, tint: "#3E8F57" },
  device_status: { p: ICON.device, tint: "#3E8F57" },
  unmatched_customers: { p: ICON.user, tint: "#B85B4D" },
  pending_confirmations: { p: ICON.pending, tint: "#4A8DB7" },
  booking_api_failures: { p: ICON.api, tint: "#B85B4D" },
};

function Icon({
  path,
  size = 18,
  color = GOLD,
}: {
  path: string;
  size?: number;
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={path} />
    </svg>
  );
}
function Card({
  children,
  style,
  title,
  num,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  title?: string;
  num?: number;
}) {
  return (
    <div
      style={{
        background: "var(--card,#fff)",
        border: `1px solid ${LINE}`,
        borderRadius: 12,
        padding: 14,
        ...style,
      }}
    >
      {title ? (
        <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 10 }}>
          {num != null ? <span style={{ color: GOLD }}>{num}. </span> : null}
          {title}
        </div>
      ) : null}
      {children}
    </div>
  );
}
const fmtTrend = (k: SAKpi) =>
  `${k.deltaPct > 0 ? "+" : ""}${k.deltaPct}% vs prev`;

function KpiCard({ k, onClick }: { k: SAKpi; onClick: () => void }) {
  const ic = KPI_ICON[k.key] || { p: ICON.clock, tint: GOLD };
  const semColor = SEMANTIC[k.semantic];
  const arrow =
    k.direction === "up"
      ? "\u25B2"
      : k.direction === "down"
        ? "\u25BC"
        : "\u2013";
  return (
    <button
      onClick={onClick}
      disabled={!k.href}
      aria-label={`${k.label}: ${k.available ? k.display : "unavailable"}`}
      style={{
        textAlign: "left",
        background: "var(--card,#fff)",
        border: `1px solid ${LINE}`,
        borderRadius: 12,
        padding: "12px 13px",
        display: "flex",
        gap: 11,
        alignItems: "flex-start",
        cursor: k.href ? "pointer" : "default",
        minHeight: 84,
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          background: `${ic.tint}1A`,
          display: "grid",
          placeItems: "center",
          flex: "none",
        }}
      >
        <Icon path={ic.p} size={18} color={ic.tint} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize: 11.5,
            color: "#6D5F50",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 4,
          }}
        >
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {k.label}
          </span>
          {k.href ? <span style={{ color: "#C9BBA4" }}>{"\u203A"}</span> : null}
        </div>
        <div
          style={{
            fontSize: 21,
            fontWeight: 800,
            lineHeight: 1.15,
            marginTop: 1,
          }}
        >
          {k.available ? k.display : "\u2014"}
        </div>
        {k.available ? (
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: semColor,
              marginTop: 1,
            }}
          >
            {arrow} {fmtTrend(k)}
          </div>
        ) : (
          <div style={{ fontSize: 10.5, color: "#A99B86", marginTop: 1 }}>
            Not yet provisioned
          </div>
        )}
      </div>
    </button>
  );
}

function Donut({
  rows,
  total,
}: {
  rows: { key: string; label: string; count: number; pct: number }[];
  total: number;
}) {
  const R = 58,
    C = 2 * Math.PI * R;
  let acc = 0;
  const segs = rows.filter((r) => r.count > 0);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <svg
        width="150"
        height="150"
        viewBox="0 0 150 150"
        style={{ flex: "none" }}
      >
        <circle
          cx="75"
          cy="75"
          r={R}
          fill="none"
          stroke="#EFE6D5"
          strokeWidth="16"
        />
        {total > 0
          ? segs.map((r) => {
            const frac = r.count / total;
            const dash = frac * C;
            const el = (
              <circle
                key={r.key}
                cx="75"
                cy="75"
                r={R}
                fill="none"
                stroke={SOURCE_COLOR[r.key] || "#9B8B78"}
                strokeWidth="16"
                strokeDasharray={`${dash} ${C - dash}`}
                strokeDashoffset={-acc}
                transform="rotate(-90 75 75)"
              />
            );
            acc += dash;
            return el;
          })
          : null}
        <text
          x="75"
          y="70"
          textAnchor="middle"
          fontSize="22"
          fontWeight="800"
          fill="#2C2418"
        >
          {total.toLocaleString()}
        </text>
        <text x="75" y="90" textAnchor="middle" fontSize="10" fill="#9B8B78">
          Total Bookings
        </text>
      </svg>
      <div style={{ flex: 1, minWidth: 0 }}>
        {rows.map((r) => (
          <div
            key={r.key}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              fontSize: 12,
              padding: "2px 0",
            }}
          >
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: 3,
                background: SOURCE_COLOR[r.key] || "#9B8B78",
                flex: "none",
              }}
            />
            <span
              style={{
                flex: 1,
                color: "#5C5040",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {r.label}
            </span>
            <span style={{ fontWeight: 700 }}>{r.count.toLocaleString()}</span>
            <span style={{ color: "#9B8B78", width: 52, textAlign: "right" }}>
              ({r.pct.toFixed(1)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TrendChart({
  points,
}: {
  points: { day: string; checkIns: number; failed: number }[];
}) {
  const W = 320,
    H = 150,
    pad = 26;
  const max = Math.max(
    1,
    ...points.map((p) => p.checkIns),
    ...points.map((p) => p.failed),
  );
  const x = (i: number) =>
    pad + (i * (W - pad * 1.3)) / Math.max(1, points.length - 1);
  const y = (v: number) => H - 22 - (v / max) * (H - 46);
  const line = (key: "checkIns" | "failed") =>
    points.map((p, i) => `${x(i)},${y(p[key])}`).join(" ");
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
      {[0, 0.5, 1].map((f) => (
        <line
          key={f}
          x1={pad}
          x2={W - 6}
          y1={y(max * f)}
          y2={y(max * f)}
          stroke="#F0E8D9"
        />
      ))}
      {points.length > 1 ? (
        <>
          <polyline
            fill="none"
            stroke="#4A8DB7"
            strokeWidth="2"
            points={line("checkIns")}
          />
          <polyline
            fill="none"
            stroke="#C75D4F"
            strokeWidth="2"
            points={line("failed")}
          />
        </>
      ) : null}
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(p.checkIns)} r="2.5" fill="#4A8DB7" />
          <circle cx={x(i)} cy={y(p.failed)} r="2.5" fill="#C75D4F" />
          <text
            x={x(i)}
            y={H - 6}
            textAnchor="middle"
            fontSize="9"
            fill="#9B8B78"
          >
            {p.day.slice(5)}
          </text>
        </g>
      ))}
    </svg>
  );
}

function EmptyNote({ note }: { note?: string }) {
  return (
    <div
      style={{
        padding: "18px 6px",
        textAlign: "center",
        color: "#A99B86",
        fontSize: 12,
      }}
    >
      {note || "No data yet."}
    </div>
  );
}

const SELECT: React.CSSProperties = {
  height: 38,
  border: `1px solid ${LINE}`,
  borderRadius: 9,
  padding: "0 9px",
  background: "var(--card,#fff)",
  fontSize: 12.5,
  color: "#3C3322",
  minWidth: 0,
};

function Row({
  label,
  value,
  muted,
  note,
}: {
  label: string;
  value: string;
  muted?: boolean;
  note?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        padding: "6px 0",
        borderBottom: `1px solid ${LINE}`,
        fontSize: 12,
      }}
    >
      <span style={{ color: "#5C5040" }}>
        {label}
        {note ? (
          <span style={{ color: "#B9AB94", fontSize: 10.5 }}>
            {" "}
            {"\u00B7"} {note}
          </span>
        ) : null}
      </span>
      <span style={{ fontWeight: 700, color: muted ? "#A99B86" : "#2C2418" }}>
        {value}
      </span>
    </div>
  );
}

function WaitTable({ rows }: { rows: SABranchWait[] }) {
  return (
    <table
      style={{ width: "100%", fontSize: 11.5, borderCollapse: "collapse" }}
    >
      <thead>
        <tr style={{ color: "#9B8B78", textAlign: "left" }}>
          <th style={{ fontWeight: 600, padding: "2px 0" }}>#</th>
          <th style={{ fontWeight: 600 }}>Branch</th>
          <th style={{ fontWeight: 600, textAlign: "right" }}>Avg Wait</th>
          <th style={{ fontWeight: 600, textAlign: "right" }}>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.branchId} style={{ borderTop: `1px solid ${LINE}` }}>
            <td style={{ padding: "5px 0", color: "#9B8B78" }}>{r.rank}</td>
            <td
              style={{
                maxWidth: 120,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {r.branch}
            </td>
            <td style={{ textAlign: "right" }}>{r.avgWaitDisplay}</td>
            <td style={{ textAlign: "right" }}>
              <span
                style={{
                  color: WAIT_COLOR[r.status],
                  fontWeight: 700,
                  fontSize: 11,
                }}
              >
                {WAIT_LABEL[r.status]}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  placeholder,
  options,
  note,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: [string, string][];
  note?: string;
}) {
  const disabled = options.length === 0;
  return (
    <label
      style={{ display: "grid", gap: 3, minWidth: 0 }}
      title={disabled ? note : undefined}
    >
      <span style={{ fontSize: 10.5, color: "#9B8B78" }}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        style={{
          ...SELECT,
          opacity: disabled ? 0.6 : 1,
          cursor: disabled ? "default" : "pointer",
        }}
      >
        <option value="">{placeholder}</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function deepLink(href: string, nav: ReturnType<typeof useNavigate>) {
  // KPI chevrons → the built submodule pages where they exist; otherwise deep-link the Overview with the relevant
  // filter (never a dead-end) until that submodule lands.
  const [path, query] = href.split("?");
  const built: Record<string, string> = {
    "failed-events": "/booking-checkin/failed-events",
    "device-status": "/booking-checkin/device-status",
    "booking-sources": "/booking-checkin/booking-sources",
    "check-in-performance": "/booking-checkin/check-in-performance",
  };
  if (built[path]) {
    if (path === "failed-events") {
      const t = new URLSearchParams(query).get("type");
      nav(t ? `${built[path]}?type=${t}` : built[path]);
      return;
    }
    nav(built[path]);
    return;
  }
  nav(query ? `/booking-checkin?${query}` : "/booking-checkin");
}

export default function BookingCheckinScreen() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [data, setData] = useState<SABookingCheckinOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [stale, setStale] = useState(false);
  const inFlight = useRef(false);
  const waitRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<HTMLDivElement>(null);
  const failedRef = useRef<HTMLDivElement>(null);
  const handoffRef = useRef<HTMLDivElement>(null);

  const filters = useMemo(
    () => ({
      startDate: sp.get("date") || todayISO(),
      tenantId: sp.get("tenant") || "",
      branchId: sp.get("branch") || "",
      source: sp.get("source") || "",
      checkInMethod: sp.get("method") || "",
      technicianId: sp.get("tech") || "",
      status: sp.get("status") || "",
    }),
    [sp],
  );

  const setFilter = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v);
    else n.delete(k);
    setSp(n, { replace: true });
  };
  const reset = () => setSp(new URLSearchParams(), { replace: true });

  const load = useCallback(
    (signal: AbortSignal, background = false) => {
      if (background && inFlight.current) return; // never overlap a background refresh with an in-flight request
      inFlight.current = true;
      if (!background) {
        setLoading(true);
        setError(null);
      }
      superAdminBookingCheckinApi
        .overview({
          startDate: filters.startDate,
          endDate: filters.startDate,
          tenantId: filters.tenantId || undefined,
          branchId: filters.branchId || undefined,
          source: filters.source || undefined,
          checkInMethod: filters.checkInMethod || undefined,
          technicianId: filters.technicianId || undefined,
          status: filters.status || undefined,
        })
        .then((d) => {
          if (!signal.aborted) {
            setData(d);
            setError(null);
            setLastUpdated(new Date());
            setStale(false);
            if (!background) setLoading(false);
          }
        })
        .catch((e: unknown) => {
          if (signal.aborted) return;
          if (background)
            setStale(true); // transient background failure → keep the last valid result, flag stale
          else {
            setError(e instanceof Error ? e.message : "Failed to load");
            setLoading(false);
          }
        })
        .finally(() => {
          inFlight.current = false;
        });
    },
    [filters],
  );

  // Foreground load on mount + whenever filters change (cancels the prior request).
  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [load]);

  // Background auto-refresh (reuses the app's setInterval polling pattern — no extra realtime framework). Paused while
  // the tab is hidden; resumes immediately on focus. Stale requests are aborted; failures preserve the last good data.
  useEffect(() => {
    let ac: AbortController | null = null;
    const tick = () => {
      if (document.hidden) return;
      ac?.abort();
      ac = new AbortController();
      load(ac.signal, true);
    };
    const id = setInterval(tick, OVERVIEW_REFRESH_MS);
    const onVis = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      ac?.abort();
    };
  }, [load]);

  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const exportReport = () => {
    if (!data || exporting) return;
    setExporting(true);
    setExportMsg(null);
    superAdminBookingCheckinApi
      .exportReport({
        type: "overview",
        tenantId: filters.tenantId || undefined,
        branchId: filters.branchId || undefined,
        startDate: filters.startDate,
      })
      .then((res) => {
        if (!res.available || !res.csv) {
          setExportMsg(res.reason || "Export is not available.");
          return;
        }
        const blob = new Blob(["\uFEFF" + res.csv], {
          type: "text/csv;charset=utf-8;",
        });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download =
          res.filename || `booking-checkin-overview_${filters.startDate}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch((e: unknown) =>
        setExportMsg(e instanceof Error ? e.message : "Export failed."),
      )
      .finally(() => setExporting(false));
  };

  const actions: {
    label: string;
    onClick?: () => void;
    disabled?: boolean;
    reason?: string;
  }[] = [
      {
        label: "Review Failed Booking Events",
        onClick: () => nav("/booking-checkin/failed-events?type=booking"),
      },
      {
        label: "Review Failed Kiosk Check-Ins",
        onClick: () => nav("/booking-checkin/failed-events?type=check_in"),
      },
      {
        label: "Retry Supported Events",
        onClick: () =>
          nav("/booking-checkin/failed-events?retry=retry_available"),
      },
      {
        label: "Diagnose Integration Failures",
        disabled: true,
        reason: "Integration diagnostics not yet built",
      },
      {
        label: "Identify Branches with Long Wait Times",
        onClick: () => nav("/booking-checkin/wait-time-analysis"),
      },
      {
        label: "Review Booking-Source Performance",
        onClick: () => nav("/booking-checkin/booking-sources"),
      },
      {
        label: "Review AI Receptionist Handoffs",
        onClick: () => nav("/booking-checkin/ai-handoffs"),
      },
      {
        label: "Contact Tenant Administrators",
        onClick: () => nav("/communications"),
      },
      {
        label: "Open Controlled Support Mode",
        onClick: () => nav("/support-access"),
      },
    ];

  return (
    <main className="content" style={{ padding: 20, overflow: "auto" }}>
      <div className=" flex flex-col lg:flex-row justify-between gap-3">
        <div>
          <h1
            style={{
              fontSize: 23,
              fontWeight: 800,
              margin: 0,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            Booking &amp; Check-In Monitor{" "}
            <span style={{ color: GOLD }}>{"\u2605"}</span>
          </h1>
          <div
            style={{
              color: "#7A6C57",
              fontSize: 13,
              marginTop: 3,
              maxWidth: 720,
            }}
          >
            Monitor booking flow and customer check-in systems across all salons
            without acting as the salon receptionist.
          </div>
          <div
            role="status"
            aria-live="polite"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              marginTop: 6,
              fontSize: 11.5,
              color: stale ? "#B8860B" : "#7A9E86",
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: stale ? "#D09A36" : "#3E8F57",
                display: "inline-block",
              }}
            />
            {stale ? (
              <span>
                Reconnecting — showing last known data
                {lastUpdated ? ` from ${lastUpdated.toLocaleTimeString()}` : ""}
                .
              </span>
            ) : (
              <span>
                {lastUpdated
                  ? `Live · updated ${lastUpdated.toLocaleTimeString()}`
                  : "Live"}{" "}
                · auto-refresh {OVERVIEW_REFRESH_MS / 1000}s
              </span>
            )}
          </div>
        </div>
        <div className="self-baseline" style={{ display: "flex", gap: 8 }}>
          <button
            onClick={exportReport}
            disabled={!data || exporting}
            title={exportMsg || undefined}
            className="btn ghost"
            style={{
              cursor: data && !exporting ? "pointer" : "default",
            }}
          >
            {"\u2B73"} {exporting ? "Exporting…" : "Export Report"}
          </button>
          <button
            title="Dashboard widgets are not customizable yet"
            disabled
            className="btn"
          >
            {"\uFF0B"} Add Widget
          </button>
        </div>
      </div>

      <div className="flex w-full flex-wrap items-end gap-2.5 mt-3.5">
        <label style={{ display: "grid", gap: 3 }}>
          <span style={{ fontSize: 10.5, color: "#9B8B78" }}>Date Range</span>
          <input
            type="date"
            value={filters.startDate}
            onChange={(e) => setFilter("date", e.target.value)}
            style={SELECT}
          />
        </label>
        <FilterSelect
          label="Branch"
          value={filters.branchId}
          onChange={(v) => setFilter("branch", v)}
          placeholder="All Branches"
          options={[]}
          note="branch list loads with the Branches feed"
        />
        <FilterSelect
          label="Tenant"
          value={filters.tenantId}
          onChange={(v) => setFilter("tenant", v)}
          placeholder="All Tenants"
          options={[]}
          note="use the top-bar scope selector for tenant scope"
        />
        <FilterSelect
          label="Booking Source"
          value={filters.source}
          onChange={(v) => setFilter("source", v)}
          placeholder="All Sources"
          options={[
            ["online", "Online"],
            ["ai_receptionist", "AI Receptionist"],
            ["mobile_app", "Mobile App"],
            ["staff_created", "Staff Created"],
            ["walk_in", "Walk-In"],
            ["kiosk", "Kiosk"],
          ]}
        />
        <FilterSelect
          label="Check-In Method"
          value={filters.checkInMethod}
          onChange={(v) => setFilter("method", v)}
          placeholder="All Methods"
          options={[]}
          note="server-side method filter arrives with Check-In Performance"
        />
        <FilterSelect
          label="Technician"
          value={filters.technicianId}
          onChange={(v) => setFilter("tech", v)}
          placeholder="All Technicians"
          options={[]}
          note="technician filter arrives with Wait-Time Analysis"
        />
        <FilterSelect
          label="Status"
          value={filters.status}
          onChange={(v) => setFilter("status", v)}
          placeholder="All Statuses"
          options={[
            ["booked", "Booked"],
            ["confirmed", "Confirmed"],
            ["checked_in", "Checked In"],
            ["in_service", "In Service"],
            ["completed", "Completed"],
            ["cancelled", "Cancelled"],
            ["no_show", "No-Show"],
          ]}
        />
        <button
          onClick={reset}
          style={{
            ...SELECT,
            alignSelf: "end",
            cursor: "pointer",
            fontWeight: 700,
            color: GOLD,
            whiteSpace: "nowrap",
            display: "flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          {"\u21BB"} Reset Filters
        </button>
      </div>

      {error ? (
        <Card
          style={{
            marginTop: 14,
            borderColor: "#E3B9B1",
            background: "#FCF3F1",
          }}
        >
          <div style={{ color: "#B85B4D", fontWeight: 700, fontSize: 13 }}>
            Couldn{"\u2019"}t load the monitor.
          </div>
          <div style={{ color: "#8a6a62", fontSize: 12, marginTop: 3 }}>
            {error}
          </div>
          <button
            onClick={() => {
              const ac = new AbortController();
              load(ac.signal);
            }}
            style={{
              marginTop: 10,
              ...SELECT,
              cursor: "pointer",
              fontWeight: 700,
              color: GOLD,
              padding: "0 14px",
            }}
          >
            Retry
          </button>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-3.5 mt-3.5 items-start">
        <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2.5">
            {loading && !data
              ? Array.from({ length: 13 }).map((_, i) => (
                  <div
                    key={i}
                    style={{
                      height: 84,
                      borderRadius: 12,
                      background: "#F4ECDD",
                    }}
                  />
                ))
              : null}
            {data?.kpis.map((k) => (
              <KpiCard
                key={k.key}
                k={k}
                onClick={() => k.href && deepLink(k.href, nav)}
              />
            ))}
            {data ? (
              <div
                style={{
                 
                  border: `1.5px solid ${GOLD}`,
                  borderRadius: 12,
                  padding: "12px 14px",
                  background: "#FBF4E7",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <div
                  style={{ fontSize: 12.5, color: "#7A5A1E", fontWeight: 600 }}
                >
                  <b>Boundary:</b> {data.boundary}
                </div>
              </div>
            ) : null}
          </div>

          {data ? (
            <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3.5">
              <Card num={1} title="Booking & Check-In Lifecycle Today">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 2,
                  }}
                >
                  {data.lifecycle.stages.map((s, i) => (
                    <div
                      key={s.key}
                      style={{ textAlign: "center", flex: 1, minWidth: 0 }}
                    >
                      <div
                        style={{
                          width: 34,
                          height: 34,
                          margin: "0 auto",
                          borderRadius: "50%",
                          background: "#F3E7D2",
                          display: "grid",
                          placeItems: "center",
                          color: GOLD,
                          fontWeight: 800,
                          fontSize: 12,
                        }}
                      >
                        {i + 1}
                      </div>
                      <div
                        style={{
                          fontSize: 10.5,
                          color: "#6D5F50",
                          marginTop: 5,
                          lineHeight: 1.1,
                        }}
                      >
                        {s.label}
                      </div>
                      <div
                        style={{ fontWeight: 800, fontSize: 15, marginTop: 2 }}
                      >
                        {s.count.toLocaleString()}
                      </div>
                      <div style={{ fontSize: 10.5, color: "#9B8B78" }}>
                        {s.pct.toFixed(1)}%
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
              <Card num={2} title="Booking Source Breakdown">
                <div ref={sourceRef}>
                  <Donut
                    rows={data.sourceBreakdown.rows}
                    total={data.sourceBreakdown.total}
                  />
                </div>
              </Card>
              <Card num={3} title="Check-In Performance Trend">
                <div
                  style={{
                    display: "flex",
                    gap: 14,
                    fontSize: 11,
                    color: "#6D5F50",
                    marginBottom: 2,
                  }}
                >
                  <span>
                    {"\u25CF"}{" "}
                    <span style={{ color: "#4A8DB7" }}>Check-Ins</span>
                  </span>
                  <span>
                    {"\u25CF"}{" "}
                    <span style={{ color: "#C75D4F" }}>Failed Check-Ins</span>
                  </span>
                </div>
                <TrendChart points={data.checkInTrend} />
              </Card>
            </div>
          ) : null}

          {data ? (
            <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3.5">
              <Card num={4} title="Bookings by Source">
                {data.bookingsBySource.map((r) => (
                  <div key={r.key} style={{ marginBottom: 8 }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 11.5,
                        marginBottom: 3,
                      }}
                    >
                      <span style={{ color: "#5C5040" }}>{r.label}</span>
                      <span style={{ fontWeight: 700 }}>
                        {r.count.toLocaleString()}{" "}
                        <span style={{ color: "#9B8B78", fontWeight: 400 }}>
                          ({r.pct.toFixed(1)}%)
                        </span>
                      </span>
                    </div>
                    <div
                      style={{
                        height: 7,
                        borderRadius: 5,
                        background: "#F0E8D9",
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.min(100, r.pct)}%`,
                          height: "100%",
                          borderRadius: 5,
                          background: SOURCE_COLOR[r.key] || "#9B8B78",
                        }}
                      />
                    </div>
                  </div>
                ))}
                {data.bookingsBySource.length === 0 ? <EmptyNote /> : null}
              </Card>
              <Card num={5} title="Branch Wait-Time Overview">
                <div ref={waitRef}>
                  {data.branchWaitTimes.length ? (
                    <WaitTable rows={data.branchWaitTimes} />
                  ) : (
                    <EmptyNote note="No branch wait-time data in range." />
                  )}
                </div>
              </Card>
              <Card num={6} title="Failed Booking & Check-In Events">
                <div ref={failedRef}>
                  {data.failedEvents.rows.length ? (
                    <table
                      style={{
                        width: "100%",
                        fontSize: 11,
                        borderCollapse: "collapse",
                      }}
                    >
                      <thead>
                        <tr style={{ color: "#9B8B78", textAlign: "left" }}>
                          <th style={{ fontWeight: 600, padding: "2px 0" }}>
                            Event
                          </th>
                          <th style={{ fontWeight: 600 }}>Branch</th>
                          <th style={{ fontWeight: 600 }}>Failure</th>
                          <th style={{ fontWeight: 600, textAlign: "right" }}>
                            Retry
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.failedEvents.rows.map((r) => (
                          <tr
                            key={r.eventCode}
                            style={{ borderTop: `1px solid ${LINE}` }}
                          >
                            <td style={{ padding: "4px 0", fontWeight: 600 }}>
                              {r.eventCode}
                            </td>
                            <td
                              style={{
                                color: "#6D5F50",
                                maxWidth: 78,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {r.branch}
                            </td>
                            <td style={{ textTransform: "capitalize" }}>
                              {r.failureType.replace(/_/g, " ")}
                            </td>
                            <td style={{ textAlign: "right" }}>
                              <span
                                style={{
                                  color:
                                    RETRY_COLOR[r.retryStatus] || "#9B8B78",
                                  fontWeight: 700,
                                }}
                              >
                                {r.retryStatus.replace(/_/g, " ")}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <EmptyNote note="No failed events in range." />
                  )}
                </div>
              </Card>
            </div>
          ) : null}

          {data ? (
            <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3.5">
              <Card num={7} title="Bookings Waiting for Confirmation">
                {data.pendingConfirmations.rows.length ? (
                  <table
                    style={{
                      width: "100%",
                      fontSize: 11.5,
                      borderCollapse: "collapse",
                    }}
                  >
                    <thead>
                      <tr style={{ color: "#9B8B78", textAlign: "left" }}>
                        <th style={{ fontWeight: 600, padding: "3px 0" }}>
                          Branch
                        </th>
                        <th style={{ fontWeight: 600 }}>Booked At</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.pendingConfirmations.rows.map((r) => (
                        <tr
                          key={r.id}
                          style={{ borderTop: `1px solid ${LINE}` }}
                        >
                          <td style={{ padding: "5px 0" }}>{r.branch}</td>
                          <td style={{ color: "#6D5F50" }}>
                            {new Date(r.bookedAt).toLocaleString(undefined, {
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <EmptyNote note="No bookings awaiting confirmation." />
                )}
              </Card>
              <Card num={8} title="AI Receptionist Handoff Monitor">
                <div ref={handoffRef}>
                  {data.aiHandoffs.rows.length ? (
                    <table
                      style={{
                        width: "100%",
                        fontSize: 11,
                        borderCollapse: "collapse",
                      }}
                    >
                      <thead>
                        <tr style={{ color: "#9B8B78", textAlign: "left" }}>
                          <th style={{ fontWeight: 600, padding: "2px 0" }}>
                            Call
                          </th>
                          <th style={{ fontWeight: 600 }}>To</th>
                          <th style={{ fontWeight: 600 }}>Reason</th>
                          <th style={{ fontWeight: 600, textAlign: "right" }}>
                            Status
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.aiHandoffs.rows.map((r) => (
                          <tr
                            key={r.callCode}
                            style={{ borderTop: `1px solid ${LINE}` }}
                          >
                            <td style={{ padding: "4px 0", fontWeight: 600 }}>
                              {r.callCode}
                            </td>
                            <td style={{ textTransform: "capitalize" }}>
                              {r.transferredTo.replace(/_/g, " ")}
                            </td>
                            <td
                              style={{
                                color: "#6D5F50",
                                textTransform: "capitalize",
                                maxWidth: 80,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {r.reason.replace(/_/g, " ")}
                            </td>
                            <td
                              style={{
                                textAlign: "right",
                                textTransform: "capitalize",
                                color:
                                  r.status === "completed"
                                    ? "#3E8F57"
                                    : "#D09A36",
                                fontWeight: 700,
                              }}
                            >
                              {r.status.replace(/_/g, " ")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <EmptyNote note="No AI handoffs in range." />
                  )}
                </div>
              </Card>
              <Card num={9} title="Unmatched Customer Records">
                {data.unmatchedCustomers.rows.length ? (
                  <table
                    style={{
                      width: "100%",
                      fontSize: 11,
                      borderCollapse: "collapse",
                    }}
                  >
                    <thead>
                      <tr style={{ color: "#9B8B78", textAlign: "left" }}>
                        <th style={{ fontWeight: 600, padding: "2px 0" }}>
                          Name
                        </th>
                        <th style={{ fontWeight: 600 }}>Source</th>
                        <th style={{ fontWeight: 600, textAlign: "right" }}>
                          Matches
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.unmatchedCustomers.rows.map((r) => (
                        <tr
                          key={r.id}
                          style={{ borderTop: `1px solid ${LINE}` }}
                        >
                          <td style={{ padding: "4px 0" }}>{r.name}</td>
                          <td
                            style={{
                              color: "#6D5F50",
                              textTransform: "capitalize",
                            }}
                          >
                            {r.source.replace(/_/g, " ")}
                          </td>
                          <td style={{ textAlign: "right", fontWeight: 700 }}>
                            {r.possibleMatches}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <EmptyNote note="No unmatched records." />
                )}
              </Card>
            </div>
          ) : null}
        </div>

        <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
          <Card title="Super Admin Actions">
            <div style={{ display: "grid", gap: 2 }}>
              {actions.map((a) => (
                <button
                  key={a.label}
                  onClick={a.onClick}
                  disabled={a.disabled}
                  title={a.reason}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    textAlign: "left",
                    padding: "8px 6px",
                    border: "none",
                    background: "transparent",
                    borderRadius: 7,
                    cursor: a.disabled ? "default" : "pointer",
                    opacity: a.disabled ? 0.42 : 1,
                    fontSize: 12.5,
                    color: "#3C3322",
                    borderBottom: `1px solid ${LINE}`,
                  }}
                >
                  <span
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: 2,
                        background: GOLD,
                      }}
                    />
                    {a.label}
                  </span>
                  <span style={{ color: "#C9BBA4" }}>{"\u203A"}</span>
                </button>
              ))}
            </div>
          </Card>

          <Card title="Check-In Device Status">
            {data?.deviceStatus.available ? (
              <>
                <table
                  style={{
                    width: "100%",
                    fontSize: 11.5,
                    borderCollapse: "collapse",
                  }}
                >
                  <thead>
                    <tr style={{ color: "#9B8B78", textAlign: "left" }}>
                      <th style={{ fontWeight: 600, padding: "2px 0" }}>
                        Device Type
                      </th>
                      <th style={{ fontWeight: 600, textAlign: "right" }}>
                        Online
                      </th>
                      <th style={{ fontWeight: 600, textAlign: "right" }}>
                        Offline
                      </th>
                      <th style={{ fontWeight: 600, textAlign: "right" }}>
                        Uptime
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.deviceStatus.rows.map((r) => (
                      <tr
                        key={r.type}
                        style={{ borderTop: `1px solid ${LINE}` }}
                      >
                        <td
                          style={{
                            padding: "5px 0",
                            textTransform: "capitalize",
                          }}
                        >
                          {r.type.replace(/_/g, " ")}
                        </td>
                        <td
                          style={{
                            textAlign: "right",
                            color: "#3E8F57",
                            fontWeight: 700,
                          }}
                        >
                          {r.online}
                        </td>
                        <td
                          style={{
                            textAlign: "right",
                            color: "#B85B4D",
                            fontWeight: 700,
                          }}
                        >
                          {r.offline}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          {r.uptime.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div
                  style={{
                    borderTop: `1px solid ${LINE}`,
                    marginTop: 6,
                    paddingTop: 6,
                    fontSize: 11.5,
                    display: "flex",
                    justifyContent: "space-between",
                    color: "#6D5F50",
                  }}
                >
                  <span>
                    Total {data.deviceStatus.totalDevices} {"\u00B7"} Offline{" "}
                    {data.deviceStatus.totalOffline}
                  </span>
                  <b>{data.deviceStatus.overallUptime.toFixed(1)}%</b>
                </div>
              </>
            ) : (
              <EmptyNote note="No check-in devices registered in scope." />
            )}
          </Card>

          <Card title="Booking API / Integration Health">
            <Row
              label="Online Booking Enabled"
              value={
                data
                  ? `${data.integrationHealth.onlineBookingEnabled}/${data.integrationHealth.tenantsConfigured} tenants`
                  : "\u2014"
              }
            />
            <Row
              label="Google Reserve Connected"
              value={
                data
                  ? String(data.integrationHealth.googleReserveConnected)
                  : "\u2014"
              }
            />
            <Row
              label="AI Phone Enabled"
              value={
                data ? String(data.integrationHealth.aiPhoneEnabled) : "\u2014"
              }
            />
            <Row
              label="Success Rate (24h)"
              value={"\u2014"}
              muted
              note="request-log feed pending"
            />
            <Row label="Retry Queue" value={"\u2014"} muted note="pending" />
          </Card>

          <Card title="At-a-Glance Summary (Today)">
            {data ? (
              <>
                <Row
                  label="Avg Wait Time"
                  value={
                    data.todaySummary.avgWait.available
                      ? data.todaySummary.avgWait.display
                      : "\u2014"
                  }
                />
                <Row
                  label="Duplicate Check-In Rate"
                  value={
                    data.todaySummary.duplicateCheckInRate.available
                      ? `${data.todaySummary.duplicateCheckInRate.value}%`
                      : "\u2014"
                  }
                  muted={!data.todaySummary.duplicateCheckInRate.available}
                  note={
                    !data.todaySummary.duplicateCheckInRate.available
                      ? "detection pending"
                      : undefined
                  }
                />
                <Row
                  label="Confirmation Rate"
                  value={
                    data.todaySummary.confirmationRate.available
                      ? `${data.todaySummary.confirmationRate.value}%`
                      : "\u2014"
                  }
                />
                <Row
                  label="Device Uptime"
                  value={
                    data.todaySummary.deviceUptime.available
                      ? `${data.todaySummary.deviceUptime.value}%`
                      : "\u2014"
                  }
                />
                <Row
                  label="Queue Conversion"
                  value={
                    data.todaySummary.queueConversion.available
                      ? `${data.todaySummary.queueConversion.value}%`
                      : "\u2014"
                  }
                />
              </>
            ) : (
              <EmptyNote />
            )}
          </Card>
        </div>
      </div>
    </main>
  );
}
