// SuperAdminAiBusinessScreen.tsx — Super Admin → AI & Automation → AI Business Assistant (adoption).
// Read-only platform adoption for the AI Business Assistant: how many saved questions and alert rules exist across
// all tenants, and how many tenants use each. These are approved AGGREGATE counts (no tenant drilldown). Model
// usage/tokens/cost live on the AI Usage & Configuration screen (ai_usage_logs); this is the adoption complement.
// Cream/gold; honest — an empty platform renders zeros, never fabricated numbers.
import { useCallback, useEffect, useState } from 'react';
import { superAdminAiApi, type AdminAiBusinessOverview } from '../api/superAdminAiApi';
import { FiBell, FiBookmark, FiCheckCircle, FiSettings, FiTarget, FiUsers } from "react-icons/fi";

const GOLD = 'var(--g7,#A96F22)';
const LINE = 'var(--line,#E7DBC6)';
const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());


function Breakdown({ title, rows }: { title: string; rows: { label: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <section style={{ border: `1px solid ${LINE}`, borderRadius: 12, padding: 16, background: 'var(--card,#fff)' }}>
      <div style={{ fontWeight: 700, marginBottom: 10 }}>{title}</div>
      {rows.length === 0 ? <div style={{ color: '#9B8B78', fontSize: 12.5 }}>None yet.</div> : (
        <div style={{ display: 'grid', gap: 8 }}>
          {rows.map((r) => (
            <div key={r.label} style={{ display: 'grid', gridTemplateColumns: '160px 1fr 40px', alignItems: 'center', gap: 10, fontSize: 12.5 }}>
              <span>{r.label}</span>
              <span style={{ background: '#F1E7D5', borderRadius: 999, height: 8 }}><span style={{ display: 'block', height: 8, width: `${(r.count / max) * 100}%`, background: GOLD, borderRadius: 999 }} /></span>
              <span style={{ textAlign: 'right', fontWeight: 600 }}>{r.count}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function SuperAdminAiBusinessScreen() {
  const [ov, setOv] = useState<AdminAiBusinessOverview | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    setErr(null);
    superAdminAiApi.aiBusinessOverview()
      .then((d) => setOv(d))
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : 'Failed to load AI Business adoption.'));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (err) return <div className="screen"><div className="state">{err} <button className="linkbtn" onClick={load}>Retry</button></div></div>;
  if (!ov) return <div className="screen"><div className="state">Loading AI Business adoption…</div></div>;

  return (
  
 <div className="p-5">
  {/* Header */}
  <div className="mb-3 flex items-start gap-3">

    <div className="min-w-0">
      <h1
        className="m-0 text-[22px] font-bold leading-tight text-[#2C2118] sm:text-[24px] lg:text-[26px]"
        style={{ fontFamily: "Playfair Display, serif" }}
      >
        AI Business Assistant
      </h1>

      <p className="mt-1 max-w-4xl text-xs leading-5 text-[#7A6C57] sm:text-[13px]">
        Platform adoption — saved questions and alert rules across all
        tenants. Model usage &amp; cost are on AI Usage &amp; Configuration.
      </p>
    </div>
  </div>

  {/* KPI Cards */}
  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
    {/* Saved Questions */}
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9B8B78]">
            Saved questions
          </div>

          <div
            className="text-3xl font-extrabold leading-none text-[var(--gold)]"
            style={{ fontFamily: "Playfair Display, serif" }}
          >
            {ov.savedQuestions.total}
          </div>

          <div className="mt-2 text-xs text-[#7A6C57]">
            {ov.savedQuestions.tenants} tenant(s)
          </div>
        </div>

        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#F8F1E7] text-[var(--gold)]">
          <FiBookmark size={20} />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-[var(--line)] pt-3 text-[11px] text-[#9B8B78]">
        <FiUsers size={13} />
        <span>Tenant adoption</span>
      </div>
    </div>

    {/* Alert Rules */}
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9B8B78]">
            Alert rules
          </div>

          <div
            className="text-3xl font-extrabold leading-none text-[var(--gold)]"
            style={{ fontFamily: "Playfair Display, serif" }}
          >
            {ov.alerts.total}
          </div>

          <div className="mt-2 text-xs text-[#7A6C57]">
            {ov.alerts.active} active · {ov.alerts.tenants} tenant(s)
          </div>
        </div>

        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#FFF5E5] text-[#B47724]">
          <FiBell size={20} />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-[var(--line)] pt-3 text-[11px] text-[#9B8B78]">
        <FiCheckCircle size={13} />
        <span>Active monitoring rules</span>
      </div>
    </div>
  </div>

  {/* Breakdown Cards */}
  <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
    {/* Saved Questions By Intent */}
    <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)] shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-4 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#F8F1E7] text-[var(--gold)]">
            <FiTarget size={17} />
          </div>

          <div className="min-w-0">
            <h2
              className="m-0 text-base font-bold text-[#2C2118]"
              style={{ fontFamily: "Playfair Display, serif" }}
            >
              Saved questions by intent
            </h2>

            <p className="m-0 mt-0.5 text-[11px] text-[#9B8B78]">
              Question distribution across platform intents
            </p>
          </div>
        </div>

        <div className="hidden shrink-0 rounded-full bg-[#F8F1E7] px-3 py-1.5 text-[10px] font-bold text-[var(--gold)] sm:block">
          {ov.savedQuestions.total} Total
        </div>
      </div>

      <div className="p-4 sm:p-5">
        <Breakdown
          title=""
          rows={ov.savedQuestions.byIntent.map((r) => ({
            label: titleCase(r.intent),
            count: r.count,
          }))}
        />
      </div>
    </div>

    {/* Alerts By Metric */}
    <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)] shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-4 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#FFF5E5] text-[#B47724]">
            <FiBell size={17} />
          </div>

          <div className="min-w-0">
            <h2
              className="m-0 text-base font-bold text-[#2C2118]"
              style={{ fontFamily: "Playfair Display, serif" }}
            >
              Alerts by metric
            </h2>

            <p className="m-0 mt-0.5 text-[11px] text-[#9B8B78]">
              Monitoring rules grouped by metric
            </p>
          </div>
        </div>

        <div className="hidden shrink-0 rounded-full bg-[#FFF5E5] px-3 py-1.5 text-[10px] font-bold text-[#B47724] sm:block">
          {ov.alerts.active} Active
        </div>
      </div>

      <div className="p-4 sm:p-5">
        <Breakdown
          title=""
          rows={ov.alerts.byMetric.map((r) => ({
            label: titleCase(r.metricId),
            count: r.count,
          }))}
        />
      </div>
    </div>
  </div>

  {/* Existing Footer Note */}
  <div className="mt-5 flex items-start gap-2 rounded-xl border border-[#E8D9C5] bg-[#FBF7F1] px-4 py-3 text-xs leading-5 text-[#7A6C57]">
    <FiSettings
      className="mt-0.5 shrink-0 text-[var(--gold)]"
      size={14}
    />

    <span>
      Business Assistant adoption metrics are shown at the platform level.
      Model usage and cost information is available under AI Usage &amp;
      Configuration.
    </span>
  </div>
</div>
  );
}
