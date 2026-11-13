// AiPriceTablePanel.tsx — AI Usage Limits 07 (extras round 11): Super Admin → AI price table (versions + per-salon prices).
// A MECHANISM: the table starts EMPTY and every salon's AI Usage screen says "no price set" until a version is published here.
// Publishing asks "Do existing salons keep their previous price?" with NO answer pre-selected — the operator must choose.
// Versions and salon prices are append-only (a change is a new version / a new salon-price row) and audited on the server.
// Shown beside today's prices on the salon screen; it does not change billing. Money is integer cents.
import { useCallback, useEffect, useState } from "react";
import type { AiPriceTableResponse, AiPriceUnit } from "@aipowersalon/api-contracts/platform";
import { superAdminAiApi } from "../api/superAdminAiApi";

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const UNITS: { v: AiPriceUnit; label: string }[] = [{ v: "month", label: "per month" }, { v: "year", label: "per year" }, { v: "overage_unit", label: "per extra unit" }];
const unitLabel = (u: string) => UNITS.find((x) => x.v === u)?.label ?? u;
/** dollars text → whole cents, or null when it is not a valid amount (never rounds a third decimal silently) */
export function dollarsToCents(s: string): number | null {
  const t = s.trim();
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(t)) return null;
  const [d, f = ""] = t.split(".");
  return Number(d) * 100 + Number((f + "00").slice(0, 2));
}
const errMsg = (e: unknown) => (e as { message?: string } | null)?.message || "Request failed.";
type Row = { feature: string; unit: AiPriceUnit; price: string };

export function AiPriceTablePanel({ packages }: { packages: { code: string; name: string }[] }) {
  const [data, setData] = useState<AiPriceTableResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([{ feature: "", unit: "month", price: "" }]);
  const [effective, setEffective] = useState("");
  const [keep, setKeep] = useState<"yes" | "no" | null>(null);   // no default — the operator must choose
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [ov, setOv] = useState<{ tenantId: string; feature: string; unit: AiPriceUnit; price: string; remove: boolean; reason: string }>({ tenantId: "", feature: "", unit: "month", price: "", remove: false, reason: "" });

  const load = useCallback(() => { superAdminAiApi.priceTable().then((d) => { setData(d); setErr(null); }).catch((e) => setErr(errMsg(e))); }, []);
  useEffect(() => { load(); }, [load]);

  const parsed = rows.map((r) => ({ feature: r.feature, unit: r.unit, priceCents: dollarsToCents(r.price) }));
  const rowsOk = parsed.length > 0 && parsed.every((r) => r.feature && r.priceCents != null);
  const canPublish = !busy && rowsOk && keep !== null && !!effective;
  const publish = () => {
    if (!canPublish) return;
    setBusy(true); setMsg(null);
    superAdminAiApi.publishPriceVersion({ effectiveFrom: new Date(effective).toISOString(), existingSalonsKeepPrevious: keep === "yes", note: note.trim() || null,
      rows: parsed.map((r) => ({ feature: r.feature, unit: r.unit, priceCents: r.priceCents as number })) })
      .then((v) => { setMsg(`Version ${v.versionNo} published.`); setRows([{ feature: "", unit: "month", price: "" }]); setKeep(null); setNote(""); setEffective(""); load(); })
      .catch((e) => setMsg(errMsg(e))).finally(() => setBusy(false));
  };
  const ovCents = ov.remove ? null : dollarsToCents(ov.price);
  const canOverride = !busy && /^[0-9a-f-]{36}$/i.test(ov.tenantId.trim()) && !!ov.feature && ov.reason.trim().length >= 3 && (ov.remove || ovCents != null);
  const saveOverride = () => {
    if (!canOverride) return;
    setBusy(true); setMsg(null);
    superAdminAiApi.setPriceOverride({ tenantId: ov.tenantId.trim(), feature: ov.feature, unit: ov.unit, priceCents: ov.remove ? null : ovCents, reason: ov.reason.trim() })
      .then(() => { setMsg(ov.remove ? "Salon price removed." : "Salon price saved."); setOv({ tenantId: "", feature: "", unit: "month", price: "", remove: false, reason: "" }); load(); })
      .catch((e) => setMsg(errMsg(e))).finally(() => setBusy(false));
  };

  return (
    <section className="card mt-2.5" data-testid="apt-panel">
      <h3>AI price table</h3>
      <p className="s muted">Versioned AI prices, shown to salons beside today's price on their AI Usage screen. It does not change billing. Published versions and salon prices can never be edited — publish a new one instead.</p>
      {err ? <div className="s" role="alert">{err}</div> : !data ? <div className="s muted">Loading…</div> : data.empty
        ? <div className="s" data-testid="apt-empty">No price version has been published. Every salon sees "no price set".</div>
        : <table data-testid="apt-versions"><thead><tr><th>Version</th><th>Takes effect</th><th>Existing salons keep previous price</th><th>Prices</th></tr></thead>
          <tbody>{data.versions.map((v) => <tr key={v.versionNo}><td>{v.versionNo}{v.inEffect ? "" : " (scheduled)"}</td><td>{new Date(v.effectiveFrom).toLocaleString()}</td><td>{v.existingSalonsKeepPrevious ? "Yes" : "No"}</td>
            <td>{v.rows.map((r) => `${packages.find((p) => p.code === r.feature)?.name ?? r.feature} ${money(r.priceCents)} ${unitLabel(r.unit)}`).join(" · ")}</td></tr>)}</tbody></table>}

      <h4 className="mt-2.5">Publish a new version</h4>
      {rows.map((r, i) => (
        <div key={i} className="row" data-testid="apt-row">
          <select aria-label="AI package" value={r.feature} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, feature: e.target.value } : x)))}>
            <option value="">Choose a package</option>{packages.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select>
          <select aria-label="Unit" value={r.unit} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, unit: e.target.value as AiPriceUnit } : x)))}>
            {UNITS.map((u) => <option key={u.v} value={u.v}>{u.label}</option>)}</select>
          <input aria-label="Price in dollars" placeholder="0.00" value={r.price} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} />
          {rows.length > 1 ? <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button> : null}
        </div>))}
      <button type="button" onClick={() => setRows([...rows, { feature: "", unit: "month", price: "" }])} disabled={rows.length >= 200}>Add a price</button>
      <label className="s">Takes effect <input type="datetime-local" aria-label="Takes effect" value={effective} onChange={(e) => setEffective(e.target.value)} /></label>
      <fieldset data-testid="apt-keep"><legend className="s">Do existing salons keep their previous price? (required)</legend>
        <label><input type="radio" name="apt-keep" checked={keep === "yes"} onChange={() => setKeep("yes")} /> Yes — salons subscribed before this version keep their earlier price</label>
        <label><input type="radio" name="apt-keep" checked={keep === "no"} onChange={() => setKeep("no")} /> No — this version applies to every salon</label></fieldset>
      <label className="s">Note <input aria-label="Note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></label>
      <button type="button" data-testid="apt-publish" disabled={!canPublish} onClick={publish}>Publish version</button>

      <h4 className="mt-2.5">One salon's price</h4>
      <div className="row">
        <input aria-label="Salon ID" placeholder="Salon ID" value={ov.tenantId} onChange={(e) => setOv({ ...ov, tenantId: e.target.value })} />
        <select aria-label="Salon price package" value={ov.feature} onChange={(e) => setOv({ ...ov, feature: e.target.value })}>
          <option value="">Choose a package</option>{packages.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select>
        <select aria-label="Salon price unit" value={ov.unit} onChange={(e) => setOv({ ...ov, unit: e.target.value as AiPriceUnit })}>{UNITS.map((u) => <option key={u.v} value={u.v}>{u.label}</option>)}</select>
        <input aria-label="Salon price in dollars" placeholder="0.00" value={ov.price} disabled={ov.remove} onChange={(e) => setOv({ ...ov, price: e.target.value })} />
        <label className="s"><input type="checkbox" checked={ov.remove} onChange={(e) => setOv({ ...ov, remove: e.target.checked })} /> Remove the salon price</label>
        <input aria-label="Reason" placeholder="Reason" value={ov.reason} maxLength={500} onChange={(e) => setOv({ ...ov, reason: e.target.value })} />
        <button type="button" data-testid="apt-override" disabled={!canOverride} onClick={saveOverride}>Save salon price</button>
      </div>
      {data && data.overrides.length ? <ul className="s" data-testid="apt-overrides">{data.overrides.slice(0, 20).map((o, i) => <li key={i}>{o.salon ?? o.tenantId}: {packages.find((p) => p.code === o.feature)?.name ?? o.feature} — {o.priceCents == null ? "salon price removed" : `${money(o.priceCents)} ${unitLabel(o.unit)}`} from {new Date(o.effectiveFrom).toLocaleDateString()} ({o.reason})</li>)}</ul> : null}
      {msg ? <div className="s" role="status" data-testid="apt-msg">{msg}</div> : null}
    </section>
  );
}
