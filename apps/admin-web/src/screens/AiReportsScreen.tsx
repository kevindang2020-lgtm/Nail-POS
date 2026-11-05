import { useEffect, useMemo, useState } from "react";
import { superAdminApi } from "../api/superAdminApi";
import { Donut, NotConnected } from "./_chartkit";

// AiReportsScreen.tsx — Super Admin › AI & Automation › AI Reports. Oversight of AI-generated platform reports.
// The real source is the existing `report_exports` log; there is no schedule/generation-job/delivery/template/recipient
// schema, so widgets with a source show real data and the rest render an honest "Not connected". No fabrication.
// On-Demand = user-initiated report exports; generated/sent counts are export counts by window (documented labels).

type Kpi = { value: number | null; available: boolean; note?: string };
type Gap = { available: false; note?: string };
type SourcePanel =
  | Gap
  | { available: true; scheduled: number; onDemand: number; total: number };
type DeliveryPanel = Gap | { available: true; segments: Seg[]; total: number };
type SchedulePanel =
  | Gap
  | {
      available: true;
      rows: {
        name: string;
        reportKey: string;
        frequency: string;
        runAtTime: string;
        scopeType: string;
        nextRunAt: string | null;
        owner: string;
        status: string;
      }[];
    };
type HistoryPanel =
  | Gap
  | {
      available: true;
      rows: {
        reportKey: string;
        status: string;
        durationMs: number | null;
        createdAt: string | null;
      }[];
    };
type DeliverySummaryPanel =
  | Gap
  | {
      available: true;
      delivered: number;
      total: number;
      pending: number;
      failed: number;
      bounced: number;
    };
type Seg = { label: string; value: number; sharePct: number };
type Overview = {
  kpis: Record<
    | "scheduledReports"
    | "reportsGeneratedToday"
    | "onDemandReports"
    | "failedReports"
    | "activeRecipients"
    | "deliverySuccessRate"
    | "avgGenerationTime"
    | "reportTemplates"
    | "weeklyReportsSent"
    | "monthlyReportsSent"
    | "aiReceptionistReports"
    | "riskReportsOpen",
    Kpi
  >;
  reportsByType: { segments: Seg[]; total: number };
  formatMix: { segments: Seg[]; total: number };
  trend: { day: string; count: number }[];
  recentReports: {
    id: string;
    name: string;
    category: string;
    format: string;
    scope: string;
    role: string | null;
    dateRange: string | null;
    generatedAt: string | null;
    generated: boolean;
  }[];
  scheduledVsOnDemand: SourcePanel;
  deliveryStatus: DeliveryPanel;
  scheduleOverview: SchedulePanel;
  failedReports: Gap;
  reportTemplates: Gap;
  recipientGroups: Gap;
  generationHistory: HistoryPanel;
  deliverySummary: DeliverySummaryPanel;
  publishedTemplates: { reportKey: string; name: string; version: number }[];
  meta: { onDemandLabel: string; generatedLabel: string };
};

const fmtDate = (s: string | null) => {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString();
  } catch {
    return "—";
  }
};
const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  const g = /^[=+\-@]/.test(s) ? "'" + s : s;
  return '"' + g.replace(/"/g, '""') + '"';
};

// Available AI Reports — driven by registered report definitions (structured, not free-text UI data).
const REPORT_DEFS = [
  {
    key: "daily_platform",
    name: "Daily Platform Report",
    desc: "Summary of platform activity and KPIs.",
    badges: ["Daily"],
  },
  {
    key: "weekly_tenant_growth",
    name: "Weekly Tenant-Growth Report",
    desc: "Tenant acquisition and growth insights.",
    badges: ["Weekly", "Scheduled"],
  },
  {
    key: "monthly_revenue",
    name: "Monthly Revenue Report",
    desc: "Revenue performance and trend analysis.",
    badges: ["Monthly", "Scheduled"],
  },
  {
    key: "merchant_processing",
    name: "Merchant-Processing Report",
    desc: "Merchant fees and transaction metrics.",
    badges: ["Weekly", "Scheduled"],
  },
  {
    key: "ai_receptionist",
    name: "AI Receptionist Report",
    desc: "AI receptionist interactions and outcomes.",
    badges: ["Daily", "Scheduled"],
  },
  {
    key: "customer_retention",
    name: "Customer-Retention Report",
    desc: "Retention trends and cohort analysis.",
    badges: ["Weekly", "Scheduled"],
  },
  {
    key: "branch_performance",
    name: "Branch-Performance Report",
    desc: "Branch KPIs and performance metrics.",
    badges: ["Monthly", "Scheduled"],
  },
  {
    key: "system_risk",
    name: "System-Risk Report",
    desc: "System risks and anomaly detections.",
    badges: ["Daily", "On-Demand"],
  },
];
const CONTROLS = [
  ["Generate Reports", "Create on-demand reports instantly with AI."],
  ["Schedule Reports", "Automate recurring reports on custom intervals."],
  ["Select Recipients", "Choose recipients, groups, and delivery lists."],
  [
    "Choose Report Scope",
    "Filter by tenants, branches, or platform-wide scope.",
  ],
  ["Edit Report Templates", "Customize templates and AI report content."],
  ["Export Reports", "Export reports in PDF, XLSX, or CSV."],
  ["Review History", "Review past generations and deliveries."],
  ["Regenerate Failed", "Re-run failed or incomplete report jobs."],
] as const;
const PRIMARY_ACTIONS = [
  ["Generate Reports", "On-Demand"],
  ["Schedule Reports", "Set Automated Jobs"],
  ["Select Recipients", "Groups & Users"],
  ["Choose Report Scope", "Tenants & Branches"],
  ["Edit Report Templates", "Create & Modify"],
  ["Export Reports", "Download Data"],
  ["Review Report History", "View Past Reports"],
  ["Regenerate Failed Reports", "Retry Failed Jobs"],
] as const;

function TrendLine({ data }: { data: { day: string; count: number }[] }) {
  if (!data.length)
    return <NotConnected>No report activity in range.</NotConnected>;
  const w = 320,
    h = 150,
    pad = 8;
  const max = Math.max(1, ...data.map((d) => d.count));
  const X = (i: number) =>
    pad + (i * (w - 2 * pad)) / Math.max(1, data.length - 1);
  const pts = data
    .map((d, i) => `${X(i)},${h - pad - (d.count / max) * (h - 2 * pad)}`)
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width="100%"
      height="150"
      role="img"
      aria-label="Report generation trend"
    >
      <polyline points={pts} fill="none" stroke="#F0820B" strokeWidth={2} />
      {data.map((d, i) => {
        const [x, y] = [X(i), h - pad - (d.count / max) * (h - 2 * pad)];
        return <circle key={i} cx={x} cy={y} r={2.5} fill="#F0820B" />;
      })}
    </svg>
  );
}

export function AiReportsScreen() {
  const [o, setO] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    (superAdminApi.aiReportsOverview() as Promise<Overview>)
      .then(setO)
      .catch((e: any) => setError(e?.message || "Failed to load AI reports."));
  }, []);

  const exportReport = () => {
    if (!o) return;
    const head = [
      "Report",
      "Category",
      "Scope",
      "Format",
      "Date Range",
      "Generated At",
      "Generated",
    ];
    const body = o.recentReports.map((r) =>
      [
        r.name,
        r.category,
        r.scope,
        r.format,
        r.dateRange,
        fmtDate(r.generatedAt),
        r.generated ? "yes" : "no",
      ]
        .map(csvCell)
        .join(","),
    );
    const csv = [head.map(csvCell).join(","), ...body].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `ai-reports-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setNotice("Exported the current report directory (oversight scope).");
  };
  const generate = () =>
    setNotice(
      "Generate Report opens the on-demand generation workflow. The generation pipeline (background job, template versioning, delivery) is not modelled yet, so generation is not connected.",
    );
  const gapNotice = (label: string, why: string) =>
    setNotice(`${label}: ${why}`);

  const kpiCards = useMemo(
    () =>
      o
        ? ([
            [
              "Scheduled Reports",
              o.kpis.scheduledReports,
              (v: number) => v.toLocaleString(),
              "#EAF1FF",
            ],
            [
              "Reports Generated Today",
              o.kpis.reportsGeneratedToday,
              (v: number) => v.toLocaleString(),
              "#E7F5EC",
            ],
            [
              "On-Demand Reports",
              o.kpis.onDemandReports,
              (v: number) => v.toLocaleString(),
              "#EAF1FF",
            ],
            [
              "Failed Reports",
              o.kpis.failedReports,
              (v: number) => v.toLocaleString(),
              "#FBE7E4",
            ],
            [
              "Active Recipients",
              o.kpis.activeRecipients,
              (v: number) => v.toLocaleString(),
              "#F3ECFB",
            ],
            [
              "Delivery Success Rate",
              o.kpis.deliverySuccessRate,
              (v: number) => `${v}%`,
              "#E7F5EC",
            ],
            [
              "Avg Generation Time",
              o.kpis.avgGenerationTime,
              (v: number) => `${v}s`,
              "#FBF0DC",
            ],
            [
              "Report Templates",
              o.kpis.reportTemplates,
              (v: number) => v.toLocaleString(),
              "#E7F5EC",
            ],
            [
              "Weekly Reports Sent",
              o.kpis.weeklyReportsSent,
              (v: number) => v.toLocaleString(),
              "#EAF1FF",
            ],
            [
              "Monthly Reports Sent",
              o.kpis.monthlyReportsSent,
              (v: number) => v.toLocaleString(),
              "#EAF1FF",
            ],
            [
              "AI Receptionist Reports",
              o.kpis.aiReceptionistReports,
              (v: number) => v.toLocaleString(),
              "#F3ECFB",
            ],
            [
              "Risk Reports Open",
              o.kpis.riskReportsOpen,
              (v: number) => v.toLocaleString(),
              "#FBE7E4",
            ],
          ] as [string, Kpi, (v: number) => string, string][])
        : [],
    [o],
  );

  if (error)
    return (
      <div className="screen">
        <div className="state">{error}</div>
      </div>
    );
  if (!o)
    return (
      <div className="screen">
        <div className="state">Loading AI reports…</div>
      </div>
    );

  const quickActions = [
    "Generate Report",
    "Schedule Report",
    "Select Recipients",
    "Edit Template",
    "Export Reports",
    "View History",
    "Regenerate Failed",
    "Open Tenant Report",
  ];
  const summaryCards: [string, Kpi, (v: number) => string][] = [
    [
      "Reports Generated Today",
      o.kpis.reportsGeneratedToday,
      (v) => v.toLocaleString(),
    ],
    ["Failed Generations", o.kpis.failedReports, (v) => v.toLocaleString()],
    ["Successful Deliveries", o.kpis.deliverySuccessRate, (v) => `${v}%`],
    ["Avg Processing Time", o.kpis.avgGenerationTime, (v) => `${v}s`],
    [
      "Scheduled Jobs Upcoming",
      o.kpis.scheduledReports,
      (v) => v.toLocaleString(),
    ],
    [
      "Report Templates Active",
      o.kpis.reportTemplates,
      (v) => v.toLocaleString(),
    ],
  ];

  return (
    <div
      className="screen p-5"
      style={{ display: "flex", flexDirection: "column", gap: 12 }}
    >
      <div className="flex flex-col sm:flex-row gap-3 justify-between">
        <div className="vh">
          <h1>
            AI Reports <span style={{ color: "#F0820B" }}>★</span>
          </h1>
          <div className="sub">
            Provides scheduled and on-demand AI-generated platform reports.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn ghost" onClick={exportReport}>
            Export Report
          </button>
          <button className="btn" onClick={generate}>
            Generate Report
          </button>
        </div>
      </div>

      {notice && (
        <div
          className="state"
          role="status"
          style={{
            fontSize: 12,
            background: "#FBF0DC",
            border: "1px solid #F0D9A8",
            borderRadius: 8,
            padding: "8px 12px",
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <span>{notice}</span>
          <button className="linkbtn" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}

      {/* 12 KPI cards */}
      <div className="kpis grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
        {kpiCards.map(([l, k, fmt, bg]) => (
          <div
            className="kpi"
            key={l}
            aria-label={`${l}: ${k.available ? fmt(k.value as number) : "not connected"}`}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 999,
                  background: bg,
                  flex: "none",
                }}
              />
              <div className="l" style={{ fontSize: 11 }}>
                {l}
              </div>
            </div>
            <div className=" text-base" style={{ marginTop: 4 }} title={k.note || ""}>
              {k.available ? (
                fmt(k.value as number)
              ) : (
                <NotConnected>Not connected</NotConnected>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Primary report action strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-1.5">
        {PRIMARY_ACTIONS.map(([l, sub]) => (
          <button
            key={l}
            className="qbtn"
            onClick={l === "Export Reports" ? exportReport : generate}
            style={{
              textAlign: "left",
              padding: 8,
              display: "flex",
              flexDirection: "column",
              gap: 2,
              alignItems: "flex-start",
              height: "auto",
              fontSize: 10.5,
            }}
          >
            <b style={{ fontSize: 11 }}>{l}</b>
            <span className="muted" style={{ fontSize: 9.5, fontWeight: 400 }}>
              {sub}
            </span>
          </button>
        ))}
      </div>

      {/* AI Report Controls */}
      <section className="panel">
        <h2>AI Report Controls</h2>
        <div
          className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-1.5"
        >
          {CONTROLS.map(([l, d]) => (
            <button
              key={l}
              className="qbtn"
              onClick={() =>
                l === "Export Reports"
                  ? exportReport()
                  : gapNotice(
                      l,
                      "the generation/scheduling/delivery pipeline isn’t modelled yet — not connected.",
                    )
              }
              style={{
                textAlign: "left",
                padding: 8,
                display: "flex",
                flexDirection: "column",
                gap: 2,
                alignItems: "flex-start",
                height: "auto",
              }}
            >
              <b style={{ fontSize: 11 }}>{l}</b>
              <span
                className="muted"
                style={{ fontSize: 9.5, fontWeight: 400 }}
              >
                {d}
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Available AI Reports */}
      <section className="panel">
        <h2>Available AI Reports</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
          {REPORT_DEFS.map((r) => {
            const tpl = o.publishedTemplates.find((t) => t.reportKey === r.key);
            return (
              <button
                key={r.key}
                className="qbtn"
                onClick={generate}
                style={{
                  textAlign: "left",
                  padding: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  alignItems: "flex-start",
                  height: "auto",
                }}
              >
                <b style={{ fontSize: 12 }}>{r.name}</b>
                <span
                  className="muted"
                  style={{ fontSize: 10.5, fontWeight: 400 }}
                >
                  {r.desc}
                </span>
                <span
                  style={{
                    display: "flex",
                    gap: 4,
                    marginTop: 2,
                    flexWrap: "wrap",
                  }}
                >
                  {r.badges.map((b) => (
                    <span
                      key={b}
                      style={{
                        fontSize: 9.5,
                        padding: "1px 6px",
                        borderRadius: 999,
                        background:
                          b === "Scheduled"
                            ? "#F3ECFB"
                            : b === "On-Demand"
                              ? "#EAF1FF"
                              : "#FBF0DC",
                        color: "#555",
                      }}
                    >
                      {b}
                    </span>
                  ))}
                  <span
                    style={{
                      fontSize: 9.5,
                      padding: "1px 6px",
                      borderRadius: 999,
                      background: tpl ? "#E7F5EC" : "#EEF0F3",
                      color: tpl ? "#1F9254" : "#6B7280",
                    }}
                  >
                    {tpl ? `Template v${tpl.version}` : "No template"}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* 4 analytics */}
      <div className="grid grid-cols-2 sm:grid-cols-4  gap-2.5">
        <section className="panel">
          <h2 style={{ fontSize: 13 }}>Report Generation Trend</h2>
          <TrendLine data={o.trend} />
          <div className="muted" style={{ fontSize: 10.5, marginTop: 4 }}>
            Completed report exports · last 7 days
          </div>
        </section>
        <section className="panel">
          <h2 style={{ fontSize: 13 }}>Scheduled vs On-Demand</h2>
          {o.scheduledVsOnDemand.available ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                fontSize: 12,
                marginTop: 6,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#F0820B" }}>Scheduled</span>
                <b>{o.scheduledVsOnDemand.scheduled.toLocaleString()}</b>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#2F6FED" }}>On-Demand</span>
                <b>{o.scheduledVsOnDemand.onDemand.toLocaleString()}</b>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  borderTop: "1px solid var(--line)",
                  paddingTop: 4,
                }}
              >
                <span className="muted">Total runs</span>
                <b>{o.scheduledVsOnDemand.total.toLocaleString()}</b>
              </div>
            </div>
          ) : (
            <NotConnected>
              {o.scheduledVsOnDemand.note || "Not connected"}
            </NotConnected>
          )}
        </section>
        <section className="panel">
          <h2 style={{ fontSize: 13 }}>Reports by Type</h2>
          {o.reportsByType.total === 0 ? (
            <NotConnected>No reports yet.</NotConnected>
          ) : (
            <Donut
              data={o.reportsByType.segments.map((s) => ({
                label: s.label,
                value: s.value,
              }))}
              centerLabel={`${o.reportsByType.total} Total`}
            />
          )}
        </section>
        <section className="panel">
          <h2 style={{ fontSize: 13 }}>Delivery Status</h2>
          {o.deliveryStatus.available ? (
            <Donut
              data={o.deliveryStatus.segments.map((s) => ({
                label: s.label,
                value: s.value,
              }))}
              centerLabel={`${o.deliveryStatus.total} Total`}
            />
          ) : (
            <NotConnected>
              {o.deliveryStatus.note || "Not connected"}
            </NotConnected>
          )}
        </section>
      </div>

      {/* Recent AI Reports */}
      <section className="panel">
        <h2>Recent AI Reports</h2>
        {o.recentReports.length === 0 ? (
          <div className="state" style={{ fontSize: 12 }}>
            No reports yet.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              className="tgrid"
              style={{ width: "100%", fontSize: 12, minWidth: 760 }}
            >
              <thead>
                <tr
                  style={{
                    textAlign: "left",
                    color: "var(--muted)",
                    fontSize: 11,
                  }}
                >
                  <th>Report Name</th>
                  <th>Category</th>
                  <th>Scope</th>
                  <th>Format</th>
                  <th>Date Range</th>
                  <th>Generated At</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {o.recentReports.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 600 }}>{r.name}</td>
                    <td className="muted">{r.category}</td>
                    <td className="muted">{r.scope}</td>
                    <td>{r.format}</td>
                    <td className="muted">{r.dateRange || "—"}</td>
                    <td className="muted">{fmtDate(r.generatedAt)}</td>
                    <td>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: r.generated ? "#1F9254" : "#B7791F",
                        }}
                      >
                        {r.generated ? "Generated" : "Pending"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Lower panels — schedule overview / failed / templates + recipients (all honest gaps, no schema) */}
      <div className="grid grid-cols-1 sm:grid-cols-2  gap-2">
        <section className="panel">
          <h2 style={{ fontSize: 13 }}>Report Schedule Overview</h2>
          {o.scheduleOverview.available ? (
            <table className="tgrid" style={{ width: "100%", fontSize: 11.5 }}>
              <thead>
                <tr
                  style={{
                    textAlign: "left",
                    color: "var(--muted)",
                    fontSize: 10.5,
                  }}
                >
                  <th>Report</th>
                  <th>Frequency</th>
                  <th>Next Run</th>
                  <th>Owner</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {o.scheduleOverview.rows.map((s, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 600 }}>{s.name}</td>
                    <td className="muted">
                      {s.frequency} · {s.runAtTime}
                    </td>
                    <td className="muted">{fmtDate(s.nextRunAt)}</td>
                    <td className="muted">{s.owner}</td>
                    <td>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: s.status === "active" ? "#1F9254" : "#B7791F",
                        }}
                      >
                        {s.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <NotConnected>
              {o.scheduleOverview.note || "Not connected"}
            </NotConnected>
          )}
        </section>
        <section className="panel">
          <h2 style={{ fontSize: 13 }}>Failed / Regenerated Reports</h2>
          <NotConnected>{o.failedReports.note || "Not connected"}</NotConnected>
        </section>
        <section className="panel">
          <h2 style={{ fontSize: 13 }}>Report Templates</h2>
          <NotConnected>
            {o.reportTemplates.note || "Not connected"}
          </NotConnected>
        </section>
        <section className="panel">
          <h2 style={{ fontSize: 13 }}>Recipient Groups</h2>
          <NotConnected>
            {o.recipientGroups.note || "Not connected"}
          </NotConnected>
        </section>
        <section className="panel">
          <h2 style={{ fontSize: 13 }}>Generation History</h2>
          {o.generationHistory.available ? (
            <table className="tgrid" style={{ width: "100%", fontSize: 11.5 }}>
              <thead>
                <tr
                  style={{
                    textAlign: "left",
                    color: "var(--muted)",
                    fontSize: 10.5,
                  }}
                >
                  <th>Report</th>
                  <th>Generated At</th>
                  <th>Duration</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {o.generationHistory.rows.map((r, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 600 }}>{r.reportKey}</td>
                    <td className="muted">{fmtDate(r.createdAt)}</td>
                    <td className="muted">
                      {r.durationMs == null
                        ? "—"
                        : `${(r.durationMs / 1000).toFixed(1)}s`}
                    </td>
                    <td>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color:
                            r.status === "completed"
                              ? "#1F9254"
                              : r.status === "failed"
                                ? "#C0392B"
                                : "#B7791F",
                        }}
                      >
                        {r.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <NotConnected>
              {o.generationHistory.note || "Not connected"}
            </NotConnected>
          )}
        </section>
        <section className="panel">
          <h2 style={{ fontSize: 13 }}>AI Report Delivery Summary</h2>
          {o.deliverySummary.available ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 5,
                fontSize: 12,
                marginTop: 6,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span className="muted">Delivered</span>
                <b style={{ color: "#1F9254" }}>
                  {o.deliverySummary.delivered.toLocaleString()}
                </b>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span className="muted">Pending</span>
                <b style={{ color: "#B7791F" }}>
                  {o.deliverySummary.pending.toLocaleString()}
                </b>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span className="muted">Failed</span>
                <b style={{ color: "#C0392B" }}>
                  {o.deliverySummary.failed.toLocaleString()}
                </b>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span className="muted">Bounced</span>
                <b style={{ color: "#C0392B" }}>
                  {o.deliverySummary.bounced.toLocaleString()}
                </b>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  borderTop: "1px solid var(--line)",
                  paddingTop: 4,
                }}
              >
                <span className="muted">Total</span>
                <b>{o.deliverySummary.total.toLocaleString()}</b>
              </div>
            </div>
          ) : (
            <NotConnected>
              {o.deliverySummary.note || "Not connected"}
            </NotConnected>
          )}
        </section>
      </div>

      {/* Quick Actions */}
      <section className="panel">
        <h2>Quick Actions</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-1.5">
          {quickActions.map((l) => (
            <button
              key={l}
              className="qbtn"
              onClick={l === "Export Reports" ? exportReport : generate}
              style={{ fontSize: 11 }}
            >
              {l}
            </button>
          ))}
        </div>
      </section>

      {/* At-a-Glance Summary */}
      <div className="kpis pb-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-1.5">
        {summaryCards.map(([l, k, fmt]) => (
          <div
            className="kpi"
            key={l}
            aria-label={`${l}: ${k.available ? fmt(k.value as number) : "not connected"}`}
          >
            <div className="l" style={{ fontSize: 11 }}>
              {l}
            </div>
            <div className="text-base" title={k.note || ""}>
              {k.available ? (
                fmt(k.value as number)
              ) : (
                <NotConnected>Not connected</NotConnected>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
