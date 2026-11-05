// AiInsightsScreen.tsx — Super Admin › AI & Automation › AI Insights.
// AI-generated operational findings across the platform. RECOMMENDATIONS ONLY — nothing here executes a destructive
// action; acting on a finding happens in the relevant operational module by a human. Driven by the ai-insights
// overview + directory endpoints. Honest rendering: confidence carries its method and may be "N/A"; modules with no
// backing data (Bookings Risk & Churn) renders NotConnected; the Model Feedback Log is LIVE since Jul 28, 2026 (424). Cream/gold.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useInlineAsk } from "@aipowersalon/ui";
import {
  superAdminApi,
  type AiInsightsOverview,
  type AiInsightRow,
  type AiKpi,
  type AiInsightFeedbackRow,
} from "../api/superAdminApi";
import { Donut, NotConnected } from "./_chartkit";
import { InsightDetailsDrawer } from "./AiInsightsDetails";
import { buildInsightsCsv, downloadCsv } from "./AiInsightsExport";

const cap = (s: string) =>
  (s || "").replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const sevTone = (s: string) =>
  s === "critical"
    ? "bad"
    : s === "high"
      ? "warn"
      : s === "medium"
        ? "warn"
        : "ok";
const statusTone = (s: string) =>
  ["resolved"].includes(s)
    ? "ok"
    : ["dismissed", "expired"].includes(s)
      ? "mut"
      : ["escalated"].includes(s)
        ? "bad"
        : "warn";
const SEV_COLOR: Record<string, string> = {
  critical: "#C0453B",
  high: "#D98324",
  medium: "#E0A81E",
  low: "#4E8D6E",
  informational: "#3B82C4",
};
const money = (cents?: number) =>
  cents ? `$${Math.round(cents / 100 / 1000)}K` : "";

const CONTROLS = [
  "Review All Recommendations",
  "Filter by Tenant or Branch",
  "Mark Insights as Reviewed",
  "Assign Follow-Up Actions",
  "Dismiss Incorrect Insights",
  "Provide Model Feedback",
  "Export Insight Reports",
];
const QUICK = [
  "Review Insights",
  "Export Report",
  "Assign Follow-Up",
  "Mark Reviewed",
  "Dismiss Insight",
  "Provide Feedback",
  "Open Tenant Profile",
];

export function AiInsightsScreen() {
  const [ov, setOv] = useState<AiInsightsOverview | null>(null);
  const [rows, setRows] = useState<AiInsightRow[]>([]);
  const [dirTotal, setDirTotal] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [fbOpen, setFbOpen] = useState(false);
  const [fbVerdict, setFbVerdict] = useState<
    "helpful" | "not_helpful" | "incorrect"
  >("helpful");
  const [fbComment, setFbComment] = useState("");
  const [fbLog, setFbLog] = useState<AiInsightFeedbackRow[] | null | undefined>(
    undefined,
  );
  const loadFeedback = () =>
    superAdminApi
      .aiInsightFeedbackRecent(8)
      .then((r) => setFbLog(r.feedback))
      .catch(() => setFbLog(null));
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [severity, setSeverity] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(() => {
    setErr(null);
    Promise.all([
      superAdminApi.aiInsightsOverview(),
      superAdminApi.aiInsights({
        severity: severity || undefined,
        category: category || undefined,
        status: status || undefined,
        pageSize: 25,
      }),
    ])
      .then(([o, d]) => {
        setOv(o);
        setRows(d.rows);
        setDirTotal(d.total);
      })
      .catch((e: any) => setErr(e?.message || "Failed to load AI Insights."));
  }, [severity, category, status]);
  useEffect(() => {
    load();
    loadFeedback();
  }, [load]);
  const { ask, askUi } = useInlineAsk();

  const selectedIds = useMemo(
    () => Object.keys(sel).filter((k) => sel[k]),
    [sel],
  );
  const reset = () => {
    setSeverity("");
    setCategory("");
    setStatus("");
  };

  const doReview = async () => {
    if (!selectedIds.length)
      return setNote("Select one or more insights to mark reviewed.");
    const r = await superAdminApi.reviewInsights(selectedIds);
    setNote(
      `Marked ${r.reviewed} insight(s) reviewed. This records a review — it does not accept or execute the recommendation.`,
    );
    setSel({});
    load();
  };
  const doAssign = async () => {
    if (!selectedIds.length)
      return setNote("Select one or more insights to assign follow-up.");
    const r = await superAdminApi.assignInsights(selectedIds);
    setNote(
      `Assigned follow-up on ${r.assigned} insight(s). Follow-ups track human work; they never auto-execute the recommendation.`,
    );
    setSel({});
    load();
  };
  const doDismiss = async () => {
    if (selectedIds.length !== 1)
      return setNote("Select exactly one insight to dismiss.");
    ask(
      "Dismiss this insight? A reason is required (the insight and its evidence are preserved, not deleted):",
      async (reason) => {
        const r = await superAdminApi.dismissInsight(selectedIds[0], reason);
        setNote(
          r.ok
            ? "Insight dismissed and preserved in history."
            : (r.errors || ["Could not dismiss."]).join(" "),
        );
        setSel({});
        load();
      },
    );
  };
  const doExport = async () => {
    const filters = { severity, category, status };
    const d = await superAdminApi.aiInsights({
      severity: severity || undefined,
      category: category || undefined,
      status: status || undefined,
      pageSize: 100,
    });
    const csv = buildInsightsCsv(d.rows, {
      filters,
      generatedAt: new Date().toISOString(),
    });
    downloadCsv(
      `ai-insights-${new Date().toISOString().slice(0, 10)}.csv`,
      csv,
    );
    setNote(
      `Exported ${d.rows.length} insight(s) (current filters; no model secrets, chain-of-thought, or unauthorized customer/payment detail; formula-injection safe).`,
    );
  };

  if (err)
    return (
      <div className="screen">
        <div className="state">
          {err}{" "}
          <button className="linkbtn" onClick={load}>
            Retry
          </button>
        </div>
      </div>
    );
  if (!ov)
    return (
      <div className="screen">
        <div className="state">Loading AI Insights…</div>
      </div>
    );

  const selS: React.CSSProperties = {
    height: 34,
    padding: "0 8px",
    border: "1px solid var(--line)",
    borderRadius: 8,
    fontSize: 12.5,
  };
  const actionQueue = rows
    .filter((r) => r.status === "follow_up_assigned")
    .slice(0, 6);

  return (
    <div className="screen" style={{ padding: 20 }}>
      {/* HEADER */}
      <div className="vh flex flex-col items-start justify-between gap-4 md:flex-row">
        <div className="flex-1">
          <h1>
            AI Insights{" "}
            <span className="text-[var(--g7,#A96F22)]">★</span>
          </h1>
          <div className="sub">
            AI-generated findings across platform operations. Recommendations
            only — no automatic destructive actions.
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn ghost" onClick={doExport}>
            ⬇ Export Report
          </button>
          <button
            className="btn"
            onClick={() =>
              setNote(
                "The insight list below IS the review queue — select insights there, then Mark Reviewed / Assign Follow-Up / Dismiss.",
              )
            }
          >
            + Review Insights
          </button>
        </div>
      </div>

      {/* BLUE SAFETY BANNER */}
      <div
        role="note"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginTop: 12,
          padding: "10px 12px",
          border: "1px solid #B6D4EC",
          background: "#EFF6FC",
          borderRadius: 10,
          fontSize: 12.5,
        }}
      >
        <span aria-hidden="true">ℹ️</span>
        <span>
          AI findings are recommendations only. No automatic destructive actions
          are taken. Review and act at your discretion.
        </span>
      </div>

      {/* 12 KPI CARDS */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6" style={{ marginTop: 8 }}>
        {ov.kpis.slice(0, 6).map((k) => (
          <Kpi key={k.key} k={k} />
        ))}
      </div>

      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6" style={{ marginTop: 8 }}>
        {ov.kpis.slice(6).map((k) => (
          <Kpi key={k.key} k={k} />
        ))}
      </div>

      {/* FILTERS */}
      <div className="flex flex-wrap items-center gap-2" style={{marginTop:12}}>
        <select
          className="inp"
          style={selS}
          disabled
          aria-label="Tenant"
        >
          <option>All Tenants (—)</option>
        </select>

        <select
          className="inp"
          style={selS}
          disabled
          aria-label="Branch"
        >
          <option>All Branches (—)</option>
        </select>

        <select
          className="inp"
          style={selS}
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
          aria-label="Severity"
        >
          <option value="">All Severities</option>
          {["critical", "high", "medium", "low", "informational"].map((s) => (
            <option key={s} value={s}>
              {cap(s)}
            </option>
          ))}
        </select>

        <select
          className="inp"
          style={selS}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Category"
        >
          <option value="">All Categories</option>
          {ov.categoryPanel.map((c) => (
            <option key={c.category} value={c.category}>
              {cap(c.category)}
            </option>
          ))}
        </select>

        <select
          className="inp"
          style={selS}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Status"
        >
          <option value="">All Statuses</option>
          {[
            "new",
            "open",
            "in_review",
            "follow_up_assigned",
            "monitoring",
            "resolved",
            "dismissed",
            "escalated",
          ].map((s) => (
            <option key={s} value={s}>
              {cap(s)}
            </option>
          ))}
        </select>

        <select
          className="inp"
          style={{ ...selS, opacity: 0.55 }}
          disabled
          aria-label="Date Range"
        >
          <option>Date range (—)</option>
        </select>

        <button
          className="btn ghost ml-auto"
          onClick={reset}
        >
          ⟲ Reset Filters
        </button>
      </div>

      {/* 5 PRIMARY ACTIONS */}
      <div
        className="!mt-2 flex flex-wrap gap-2"
      >
        <button
          className="qbtn"
          onClick={() =>
            setNote(
              "Every recommendation is already listed below — select the ones you want to act on.",
            )
          }
        >
          🔍 Review All Recommendations
        </button>
        <button className="qbtn" onClick={doReview}>
          ✓ Mark Reviewed
        </button>
        <button className="qbtn" onClick={doAssign}>
          👤 Assign Follow-Up
        </button>
        <button className="qbtn" onClick={doDismiss}>
          ✕ Dismiss Insight
        </button>
        <button
          className="qbtn"
          onClick={() => {
            if (selectedIds.length !== 1) {
              setNote("Select exactly one insight to submit feedback on.");
              return;
            }
            setFbOpen((v) => !v);
          }}
        >
          💬 Submit Feedback
        </button>
      </div>

      {fbOpen && selectedIds.length === 1 ? (
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            margin: "8px 0",
            flexWrap: "wrap",
          }}
        >
          <select
            className="inp"
            aria-label="Feedback verdict"
            value={fbVerdict}
            onChange={(e) => setFbVerdict(e.target.value as any)}
          >
            <option value="helpful">Helpful</option>
            <option value="not_helpful">Not helpful</option>
            <option value="incorrect">Incorrect</option>
          </select>
          <input
            className="inp"
            style={{ flex: 1, minWidth: 220 }}
            aria-label="Feedback comment"
            placeholder="Optional comment for the model-quality reviewers"
            value={fbComment}
            onChange={(e) => setFbComment(e.target.value)}
          />
          <button
            className="qbtn"
            onClick={async () => {
              try {
                const r = await superAdminApi.aiInsightFeedback(
                  selectedIds[0],
                  {
                    verdict: fbVerdict,
                    comment: fbComment.trim() || undefined,
                  },
                );
                if (!r.ok) {
                  setNote(
                    r.errors?.join("; ") || "Feedback could not be recorded.",
                  );
                  return;
                }
                setNote(
                  "Feedback recorded for the model-quality process. It is reviewed by people and never auto-retrains the model.",
                );
                setFbOpen(false);
                setFbComment("");
                loadFeedback();
              } catch (e: any) {
                setNote(e?.message || "Feedback could not be recorded.");
              }
            }}
          >
            Record Feedback
          </button>
        </div>
      ) : null}
      {note ? (
        <div className="state" style={{ marginTop: 10 }}>
          {note}{" "}
          <button className="linkbtn" onClick={() => setNote(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      {/* AI RECOMMENDATION CONTROLS + HIGH-PRIORITY FINDINGS */}
      <div className="ai-insights-ai-controls">
        <section className="panel">
          <div className="phead">
            <h2>AI Recommendation Controls</h2>
          </div>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}
          >
            {CONTROLS.map((c) => (
              <button
                key={c}
                className="qbtn"
                style={{ fontSize: 11 }}
                onClick={() =>
                  c === "Export Insight Reports"
                    ? void doExport()
                    : setNote(
                        `${c}: recommendations-only control. Any operational action opens the relevant module and requires a human with the right permission.`,
                      )
                }
              >
                {c}
              </button>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="phead">
            <h2>High-Priority Findings</h2>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: 10,
              width: "100%",
            }}
          >
            {ov.highPriority.map((h) => (
              <button
                key={h.key}
                className="qbtn"
                style={{
                  alignItems: "flex-start",
                  textAlign: "left",
                  padding: "14px 12px",
                  minHeight: "70px",
                  display: "flex",
                  flexDirection: "column",
                }}
                onClick={() => setCategory(h.key)}
              >
                {/* Title */}
                <p
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--muted)",
                    margin: 0,
                    lineHeight: 1.4,
                  }}
                >
                  {h.label}
                </p>
                <p
                  style={{
                    margin: "10px 0 0",
                    display: "flex",
                    alignItems: "baseline",
                    gap: 5,
                  }}
                >
                  <span
                    style={{
                      fontWeight: 500,
                      fontSize: 14,
                    }}
                  >
                    {h.branches}
                  </span>

                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 400,
                      color: "var(--muted)",
                    }}
                  >
                    {h.branches === 1 ? "Branch" : "Branches"}
                  </span>
                </p>

                {/* Flagged Amount */}
                {h.flaggedCents ? (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 500,
                      color: "var(--g7,#A96F22)",
                      marginTop: 8,
                    }}
                  >
                    {money(h.flaggedCents)} flagged
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </section>
      </div>

      {/* ANALYTICS: Volume Trend, Bookings Risk & Churn, Insights by Category, Insight Severity */}
      <div className="!mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <section className="panel">
          <div className="phead">
            <h2>Insight Volume Trend</h2>
            <span className="muted">7d</span>
          </div>
          {ov.volumeTrend.available ? (
            <VolumeChart points={ov.volumeTrend.points} />
          ) : (
            <div className="state">
              Volume trend <NotConnected />.
            </div>
          )}
        </section>
        <section className="panel">
          <div className="phead">
            <h2>Bookings Risk & Churn Signals</h2>
          </div>
          <div className="state">
            At-risk bookings + churn score <NotConnected />. Booking-level risk
            data isn't modelled here.
          </div>
        </section>
        <section className="panel">
          <div className="phead">
            <h2>Insights by Category</h2>
          </div>
          {ov.byCategory.length ? (
            <Donut
              data={ov.byCategory.map((c) => ({
                label: c.label,
                value: c.count,
              }))}
              centerLabel={`${ov.total}\nTotal`}
            />
          ) : (
            <div className="state">No insights.</div>
          )}
        </section>
        <section className="panel">
          <div className="phead">
            <h2>Insight Severity</h2>
          </div>
          {ov.bySeverity.length ? (
            <Donut
              data={ov.bySeverity.map((s) => ({
                label: cap(s.severity),
                value: s.count,
                color: SEV_COLOR[s.severity],
              }))}
              centerLabel={`${ov.total}\nTotal`}
            />
          ) : (
            <div className="state">No insights.</div>
          )}
        </section>
      </div>

      {/* TOP FINDINGS TABLE + ALL CATEGORIES PANEL */}
      <div className="!mt-3 grid grid-cols-1 items-start gap-3 md:grid-cols-[minmax(0,1fr)_300px]">
        <section className="panel">
          <div className="phead">
            <h2>Top AI Findings Today</h2>
            <span className="nbadge">{dirTotal}</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table
              className="tgrid"
              style={{ width: "100%", fontSize: 12, minWidth: 860 }}
            >
              <thead>
                <tr
                  style={{
                    textAlign: "left",
                    color: "var(--muted)",
                    fontSize: 11,
                  }}
                >
                  <th></th>
                  <th>Insight</th>
                  <th>Tenant / Branch</th>
                  <th>Category</th>
                  <th>Severity</th>
                  <th>Confidence</th>
                  <th>Recommendation</th>
                  <th>Status</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={9}>
                      <div className="state">
                        No findings match these filters.
                      </div>
                    </td>
                  </tr>
                ) : (
                  rows.slice(0, 25).map((r) => (
                    <tr
                      key={r.id}
                      style={{ background: sel[r.id] ? "#FDF0DF" : undefined }}
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={!!sel[r.id]}
                          onChange={() =>
                            setSel((s) => ({ ...s, [r.id]: !s[r.id] }))
                          }
                          aria-label={`Select ${r.title}`}
                        />
                      </td>
                      <td
                        style={{ fontWeight: 600, maxWidth: 220 }}
                        title={r.title}
                      >
                        <button
                          className="linkbtn"
                          style={{ textAlign: "left", fontWeight: 600 }}
                          onClick={() => setDetailId(r.id)}
                        >
                          {r.title}
                        </button>
                      </td>
                      <td className="muted">
                        {r.tenant} / {r.branch}
                      </td>
                      <td>{cap(r.category)}</td>
                      <td>
                        <span className={"pill " + sevTone(r.severity)}>
                          {cap(r.severity)}
                        </span>
                      </td>
                      <td title={r.confidenceMethod || "no confidence method"}>
                        {r.confidence == null ? (
                          <span className="muted">N/A</span>
                        ) : (
                          `${r.confidence}%`
                        )}
                      </td>
                      <td
                        style={{ maxWidth: 240 }}
                        title={r.recommendation || ""}
                      >
                        {r.recommendation || "—"}
                      </td>
                      <td>
                        <span className={"pill " + statusTone(r.status)}>
                          {cap(r.status)}
                        </span>
                      </td>
                      <td className="muted">
                        {new Date(r.updatedAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel">
          <div className="phead">
            <h2>All Insight Categories</h2>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {ov.categoryPanel.map((c) => (
              <button
                key={c.category}
                className="linkbtn !mt-2"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 4px",
                  borderBottom: "1px solid #F3ECE1",
                  textAlign: "left",
                }}
                onClick={() => setCategory(c.category)}
              >
                <span style={{ flex: 1, fontSize: 12 }}>{c.label}</span>
                <span style={{ fontWeight: 700 }}>{c.count}</span>
                <span className="muted">›</span>
              </button>
            ))}
          </div>
        </section>
      </div>

      {/* LOWER TABLES: Tenant Risk, Actions Queue, Model Feedback */}
      <div className="grid3" style={{ marginTop: 12 }}>
        <section className="panel">
          <div className="phead">
            <h2>Tenant Risk Overview</h2>
          </div>
          <table className="tgrid" style={{ width: "100%", fontSize: 11.5 }}>
            <thead>
              <tr
                style={{
                  textAlign: "left",
                  color: "var(--muted)",
                  fontSize: 10.5,
                }}
              >
                <th>Tenant</th>
                <th>Flagged</th>
                <th>Open</th>
                <th>Churn</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {ov.tenantRisk.slice(0, 6).map((t) => (
                <tr key={t.tenant}>
                  <td style={{ fontWeight: 600 }}>{t.tenant}</td>
                  <td>{t.flaggedBranches}</td>
                  <td>{t.openInsights}</td>
                  <td>{t.churnRisk == null ? "—" : `${t.churnRisk}%`}</td>
                  <td>
                    <span
                      className={
                        "pill " +
                        (t.status === "At Risk"
                          ? "bad"
                          : t.status === "Monitoring"
                            ? "warn"
                            : "ok")
                      }
                    >
                      {t.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="muted" style={{ fontSize: 10.5, marginTop: 4 }}>
            Operational indicator — not a legal, financial, or compliance
            conclusion.
          </div>
        </section>
        <section className="panel">
          <div className="phead">
            <h2>Recommendation Actions Queue</h2>
          </div>
          {actionQueue.length === 0 ? (
            <div className="state">No assigned follow-up actions.</div>
          ) : (
            <table className="tgrid" style={{ width: "100%", fontSize: 11.5 }}>
              <thead>
                <tr
                  style={{
                    textAlign: "left",
                    color: "var(--muted)",
                    fontSize: 10.5,
                  }}
                >
                  <th>Action</th>
                  <th>Tenant / Branch</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {actionQueue.map((a) => (
                  <tr key={a.id}>
                    <td
                      style={{ maxWidth: 160 }}
                      title={a.recommendation || ""}
                    >
                      {a.recommendation || a.title}
                    </td>
                    <td className="muted">
                      {a.tenant} / {a.branch}
                    </td>
                    <td>
                      <span className="pill warn">Pending</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="muted" style={{ fontSize: 10.5, marginTop: 4 }}>
            Tracks assigned human work — does not auto-execute recommendations.
          </div>
        </section>
        <section className="panel">
          <div className="phead">
            <h2>Model Feedback Log</h2>
            <span className="muted">Dismissed / Feedback</span>
          </div>
          {fbLog === undefined ? (
            <div className="state">Loading feedback…</div>
          ) : fbLog === null ? (
            <div className="state">The feedback log could not be loaded.</div>
          ) : fbLog.length === 0 ? (
            <div className="state">
              No feedback recorded yet — select an insight and use Submit
              Feedback.
            </div>
          ) : (
            <div>
              {fbLog.map((f) => (
                <div
                  key={f.id}
                  style={{
                    display: "flex",
                    gap: 8,
                    padding: "6px 0",
                    borderBottom: "1px solid var(--line, #EDE4D3)",
                    fontSize: 12.5,
                  }}
                >
                  <span
                    style={{
                      fontWeight: 700,
                      textTransform: "capitalize",
                      color:
                        f.verdict === "incorrect"
                          ? "#8A4B2E"
                          : f.verdict === "helpful"
                            ? "#2F6B4F"
                            : "#8A7A66",
                    }}
                  >
                    {f.verdict.replace("_", " ")}
                  </span>
                  <span style={{ flex: 1 }}>
                    {f.insightTitle || f.insightReference || f.insightId}
                    {f.comment ? ` — ${f.comment}` : ""}
                  </span>
                  <span className="muted">
                    {String(f.createdAt).slice(0, 10)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* QUICK ACTIONS + AT-A-GLANCE */}
      <div className="!mt-3 pb-6 grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1fr)_420px]">
        <section className="panel">
          <div className="phead">
            <h2>Quick Actions</h2>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {QUICK.map((q, i) => (
              <button
                key={q}
                className={"qbtn" + (i === 0 ? " primary" : "")}
                style={{ fontSize: 11 }}
                onClick={() => {
                  if (q === "Mark Reviewed") return void doReview();
                  if (q === "Assign Follow-Up") return void doAssign();
                  if (q === "Dismiss Insight") return void doDismiss();
                  if (q === "Export Report") return void doExport();
                  setNote(
                    `${q}: recommendations-only. Operational actions open the relevant module with the required permission.`,
                  );
                }}
              >
                {q}
              </button>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="phead">
            <h2>At-a-Glance Summary</h2>
            <span className="muted">Today</span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
            {glanceCards(ov.kpis).map((c) => (
              <div
                key={c.label}
                className="kpi"
                style={{ border: "1px solid var(--line)" }}
              >
                <div className="l" style={{ fontSize: 10 }}>
                  {c.label}
                </div>
                <div className="v" style={{ fontSize: 15 }}>
                  {c.value ?? <NotConnected />}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {askUi}
      {detailId ? (
        <InsightDetailsDrawer
          id={detailId}
          onClose={() => setDetailId(null)}
          onChanged={(msg) => {
            setDetailId(null);
            setNote(msg);
            load();
          }}
        />
      ) : null}
    </div>
  );
}

function glanceCards(kpis: AiKpi[]): { label: string; value: string | null }[] {
  const v = (k: string) => kpis.find((x) => x.key === k)?.value ?? null;
  return [
    { label: "New Insights", value: v("open") },
    { label: "Critical Alerts", value: v("critical") },
    { label: "Reviewed Insights", value: v("reviewed_today") },
    { label: "Assigned Actions", value: v("follow_up") },
    { label: "Avg Confidence", value: v("model_confidence") },
    { label: "Escalations Open", value: v("receptionist_issues") },
  ];
}

function VolumeChart({
  points,
}: {
  points: { date: string; count: number }[];
}) {
  const W = 280,
    H = 120,
    pad = 22;
  const max = Math.max(1, ...points.map((p) => p.count));
  const stepX = points.length > 1 ? (W - pad * 2) / (points.length - 1) : 0;
  const path = points
    .map(
      (p, i) =>
        `${i ? "L" : "M"}${(pad + i * stepX).toFixed(1)} ${(H - pad - (p.count / max) * (H - pad * 2)).toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: "100%", height: "auto" }}
      role="img"
      aria-label="Insight volume trend over the last 7 days"
    >
      <path d={path} fill="none" stroke="var(--g7,#A96F22)" strokeWidth={1.8} />
      {points.map((p, i) => (
        <text
          key={i}
          x={pad + i * stepX}
          y={H - 4}
          fontSize={7}
          textAnchor="middle"
          fill="var(--muted)"
        >
          {new Date(p.date).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}
        </text>
      ))}
    </svg>
  );
}

function Kpi({ k }: { k: AiKpi }) {
  return (
    <div
      className="kpi"
      style={{ border: "1px solid var(--line)", background: "#fff" }}
      aria-label={`${k.label}: ${k.available ? k.value : "not available"}`}
    >
      <div className="l" style={{ fontSize: 10 }}>
        {k.label}
      </div>
      <div className="v" style={{ fontSize: 16 }}>
        {k.available ? k.value : <NotConnected />}
      </div>
      <div className="d flat" style={{ fontSize: 9.5 }}>
        {k.available ? "\u00A0" : "N/A"}
      </div>
    </div>
  );
}
