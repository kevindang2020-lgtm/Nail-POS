// AIPlansScreen.tsx — Super-Admin management of the five AI plans (bundles of the 15 assistant packages). Each plan's
// full price defaults to the SUM of its member assistants; here Super Admin sets a manual price override and/or an
// optional discount (percent or flat), producing the effective (new) price tenants see. Active toggles storefront
// visibility. Bound to GET/PATCH /super-admin/ai-plans. Money is integer cents.
import { useEffect, useState, type CSSProperties } from "react";
import { superAdminAiApi, type AdminAiPlan } from "../api/superAdminAiApi";
import { superAdminApi } from "../api/superAdminApi";

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
type DiscType = "none" | "percent" | "flat";
interface EditState {
  override: string;
  discType: DiscType;
  discValue: string;
  active: boolean;
  annualMonths: string;
}

function initEdit(p: AdminAiPlan): EditState {
  return {
    override:
      p.priceCentsOverride != null
        ? (p.priceCentsOverride / 100).toFixed(2)
        : "",
    discType: p.discountType ?? "none",
    discValue:
      p.discountType === "percent"
        ? String(p.discountValue)
        : p.discountType === "flat"
          ? (p.discountValue / 100).toFixed(2)
          : "",
    active: p.active,
    annualMonths: String(p.annualMonths ?? 12),
  };
}

// preview the effective price from the current edit state — mirrors the backend effectivePlanPriceCents math
function previewCents(p: AdminAiPlan, e: EditState) {
  const full =
    e.override.trim() !== "" && Number.isFinite(Number(e.override))
      ? Math.max(0, Math.round(Number(e.override) * 100))
      : p.defaultFullCents;
  let disc = 0;
  if (e.discType === "percent")
    disc = Math.round(
      (full * Math.min(100, Math.max(0, Number(e.discValue) || 0))) / 100,
    );
  else if (e.discType === "flat")
    disc = Math.min(
      full,
      Math.max(0, Math.round((Number(e.discValue) || 0) * 100)),
    );
  return { full, disc, eff: Math.max(0, full - disc) };
}

export function AIPlansScreen() {
  const [plans, setPlans] = useState<AdminAiPlan[]>([]);
  const [edit, setEdit] = useState<Record<string, EditState>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tenants, setTenants] = useState<
    { id: string; n: string; code: string }[]
  >([]);
  const [tenantId, setTenantId] = useState("");
  const [tPlans, setTPlans] = useState<
    Record<
      string,
      {
        status: string | null;
        billingPeriod: string | null;
        trialEndsAt: string | null;
      }
    >
  >({});
  const [assignPeriod, setAssignPeriod] = useState<"monthly" | "yearly">(
    "monthly",
  );
  const [aBusy, setABusy] = useState<string | null>(null);
  const [expiredBusy, setExpiredBusy] = useState(false);

  const loadTenantPlans = (tid: string) => {
    if (!tid) {
      setTPlans({});
      return;
    }
    superAdminAiApi
      .tenantPlans(tid)
      .then((r) => {
        const m: Record<string, any> = {};
        (r?.plans || []).forEach((p) => {
          m[p.code] = {
            status: p.status,
            billingPeriod: p.billingPeriod,
            trialEndsAt: p.trialEndsAt,
          };
        });
        setTPlans(m);
      })
      .catch(() => setTPlans({}));
  };
  const assign = (code: string, trial: boolean) => {
    if (!tenantId) return;
    setABusy(code);
    setErr(null);
    setOk(null);
    superAdminAiApi
      .assignPlan(code, tenantId, trial, assignPeriod)
      .then(() => {
        setOk(
          trial
            ? "Plan trial assigned."
            : `Plan assigned (paid, ${assignPeriod}).`,
        );
        loadTenantPlans(tenantId);
        load();
      })
      .catch((e: any) => setErr(e?.message || "Assign failed."))
      .finally(() => setABusy(null));
  };
  const convert = (code: string) => {
    if (!tenantId) return;
    setABusy(code);
    setErr(null);
    setOk(null);
    superAdminAiApi
      .convertPlan(code, tenantId, assignPeriod)
      .then(() => {
        setOk(`Converted to paid (${assignPeriod}).`);
        loadTenantPlans(tenantId);
        load();
      })
      .catch((e: any) => setErr(e?.message || "Convert failed."))
      .finally(() => setABusy(null));
  };
  const remove = (code: string) => {
    if (!tenantId) return;
    setABusy(code);
    setErr(null);
    setOk(null);
    superAdminAiApi
      .unassignPlan(code, tenantId)
      .then(() => {
        setOk("Plan removed.");
        loadTenantPlans(tenantId);
        load();
      })
      .catch((e: any) => setErr(e?.message || "Remove failed."))
      .finally(() => setABusy(null));
  };
  const convertExpired = () => {
    setExpiredBusy(true);
    setErr(null);
    setOk(null);
    superAdminAiApi
      .convertExpiredTrials()
      .then((r) => {
        setOk(`Converted ${r?.converted ?? 0} expired trial(s).`);
        if (tenantId) loadTenantPlans(tenantId);
        load();
      })
      .catch((e: any) => setErr(e?.message || "Convert failed."))
      .finally(() => setExpiredBusy(false));
  };

  const load = () => {
    setLoading(true);
    superAdminAiApi
      .plans()
      .then((r) => {
        const list = (r?.plans ?? [])
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder);
        setPlans(list);
        const e: Record<string, EditState> = {};
        list.forEach((p) => {
          e[p.code] = initEdit(p);
        });
        setEdit(e);
        setErr(null);
      })
      .catch((e: any) => setErr(e?.message || "Failed to load AI plans."))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);
  useEffect(() => {
    (superAdminApi.state({ page: 1 }) as Promise<any>)
      .then((r) => setTenants(r?.tenants || []))
      .catch(() => {});
  }, []);

  const set = (code: string, patch: Partial<EditState>) =>
    setEdit((m) => ({ ...m, [code]: { ...m[code], ...patch } }));

  const save = (p: AdminAiPlan) => {
    const e = edit[p.code];
    if (!e) return;
    setBusy(p.code);
    setErr(null);
    setOk(null);
    const body = {
      priceCentsOverride:
        e.override.trim() === ""
          ? null
          : Math.max(0, Math.round(Number(e.override) * 100)),
      discountType: e.discType === "none" ? null : e.discType,
      discountValue:
        e.discType === "percent"
          ? Math.max(0, Math.round(Number(e.discValue) || 0))
          : e.discType === "flat"
            ? Math.max(0, Math.round((Number(e.discValue) || 0) * 100))
            : 0,
      active: e.active,
      annualMonths: Math.max(
        1,
        Math.min(12, Math.round(Number(e.annualMonths) || 12)),
      ),
    };
    superAdminAiApi
      .updatePlan(p.code, body)
      .then(() => {
        setOk(`${p.name} saved.`);
        load();
      })
      .catch((er: any) => setErr(er?.message || "Save failed."))
      .finally(() => setBusy(null));
  };

  return (
    <div className="work">
      <div className="vh">
        <h1>AI Plans</h1>
        <div className="sub">
          Five bundles of the 15 assistants. Each plan's price defaults to the
          sum of its assistants; set a manual price and an optional discount
          (percent or flat). The new price shows to tenants.
        </div>
      </div>

      {/* Assign Plan */}
      <section className="panel mt-2.5 flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2.5">
        <span className="s muted">Assign a plan to a tenant:</span>

        <select
          value={tenantId}
          onChange={(e) => {
            setTenantId(e.target.value);
            loadTenantPlans(e.target.value);
          }}
          className="w-full sm:w-auto"
          style={inp}
        >
          <option value="">— select tenant —</option>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.n} · {t.code}
            </option>
          ))}
        </select>

        {tenantId ? (
          <>
            <span className="s muted">Billing:</span>

            <select
              value={assignPeriod}
              onChange={(e) =>
                setAssignPeriod(e.target.value as "monthly" | "yearly")
              }
              className="w-full sm:w-auto"
              style={inp}
            >
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </>
        ) : null}

        <button
          className="btn ghost w-full sm:w-auto sm:ml-auto"
          disabled={expiredBusy}
          onClick={convertExpired}
          title="Convert any plan whose trial has lapsed to paid"
        >
          {expiredBusy ? "Converting…" : "Convert expired trials"}
        </button>
      </section>

      {err ? <div className="err my-2.5">{err}</div> : null}

      {ok ? <div className="state my-2.5 text-[#1B7E4B]">{ok}</div> : null}

      {loading ? (
        <div className="state">Loading…</div>
      ) : plans.length === 0 ? (
        <div className="state">No plans.</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 mt-3">
          {plans.map((p) => {
            const e = edit[p.code];
            if (!e) return null;

            const pv = previewCents(p, e);
            const months = Math.max(
              1,
              Math.min(12, Math.round(Number(e.annualMonths) || 12)),
            );

            const yearlyEff = pv.eff * months;
            const yearlySave = Math.max(0, pv.eff * 12 - yearlyEff);
            const dirty = JSON.stringify(e) !== JSON.stringify(initEdit(p));

            return (
              <section key={p.code} className="panel">
                {/* Plan Header */}
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                  {/* Plan Information */}
                  <div className="flex-1 min-w-0">
                    <div className="t flex  flex-wrap items-center gap-1.5">
                      <span className="font-bold text-base">{p.name}</span>  

                      {p.essential ? (
                        <span className="pill ok">Essential</span>
                      ) : null}

                      {!e.active ? <span className="pill">Hidden</span> : null}
                    </div>

                    <div className="s muted break-words">{p.description}</div>

                    <div className="s muted mt-1 break-words">
                      {p.packages.map((pk) => pk.name).join(" · ")}
                    </div>

                    <div className="s mt-1 text-[#1B7E4B]">
                      {p.activeSubscribers} active · {p.trialingSubscribers} on
                      trial · {money(p.mrrCents)}/mo MRR
                    </div>
                  </div>

                  {/* Pricing */}
                  <div className="text-left lg:text-right min-w-0 lg:min-w-[150px]">
                    <div className="s muted">
                      Default (sum) {money(p.defaultFullCents)}
                    </div>

                    <div className="text-[13px]">
                      {pv.disc > 0 ? (
                        <span className="line-through text-[#9b8b73] mr-1.5">
                          {money(pv.full)}
                        </span>
                      ) : null}

                      <b className="text-lg">{money(pv.eff)}</b>

                      <span className="muted">/mo</span>
                    </div>

                    {pv.disc > 0 ? (
                      <div className="s text-[#1B7E4B]">
                        save {money(pv.disc)}
                      </div>
                    ) : null}

                    <div className="s muted mt-0.5">
                      Yearly {money(yearlyEff)} · {months} mo
                      {yearlySave > 0 ? (
                        <span className="text-[#1B7E4B]">
                          {" "}
                          · save {money(yearlySave)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>

                {/* Plan Settings */}
                <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-end gap-2.5 mt-2">
                  <label className="s muted w-full sm:w-auto sm:flex-1 min-w-[180px]">
                    Price override ($)
                    <input
                      value={e.override}
                      onChange={(ev) =>
                        set(p.code, { override: ev.target.value })
                      }
                      placeholder={(p.defaultFullCents / 100).toFixed(2)}
                      className="w-full"
                      style={inp}
                    />
                  </label>

                  <label className="s muted w-full sm:w-auto sm:flex-1 min-w-[150px]">
                    Discount
                    <select
                      value={e.discType}
                      onChange={(ev) =>
                        set(p.code, {
                          discType: ev.target.value as DiscType,
                          discValue: "",
                        })
                      }
                      className="w-full"
                      style={inp}
                    >
                      <option value="none">None</option>
                      <option value="percent">Percent %</option>
                      <option value="flat">Flat $</option>
                    </select>
                  </label>

                  {e.discType !== "none" ? (
                    <label className="s muted w-full sm:w-auto sm:flex-1 min-w-[150px]">
                      {e.discType === "percent"
                        ? "Percent (0–100)"
                        : "Amount ($)"}

                      <input
                        value={e.discValue}
                        onChange={(ev) =>
                          set(p.code, { discValue: ev.target.value })
                        }
                        className="w-full"
                        style={inp}
                      />
                    </label>
                  ) : null}

                  <label className="s muted flex items-center gap-1.5 min-h-[34px] pb-1">
                    <input
                      type="checkbox"
                      checked={e.active}
                      onChange={(ev) =>
                        set(p.code, { active: ev.target.checked })
                      }
                    />
                    Active
                  </label>

                  <label className="s muted w-full sm:w-auto sm:flex-1 min-w-[150px]">
                    Annual months
                    <input
                      value={e.annualMonths}
                      onChange={(ev) =>
                        set(p.code, { annualMonths: ev.target.value })
                      }
                      className="w-full"
                      style={inp}
                      title="Months charged on a yearly plan (1–12; e.g. 10 = 2 months free)"
                    />
                  </label>

                  <button
                    className="btn w-full sm:w-auto sm:ml-auto"
                    disabled={busy === p.code || !dirty}
                    onClick={() => save(p)}
                  >
                    {busy === p.code ? "Saving…" : "Save"}
                  </button>
                </div>

                {/* Tenant Assignment */}
                {tenantId
                  ? (() => {
                      const tp = tPlans[p.code];
                      const st = tp?.status ?? null;

                      return (
                        <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2 mt-2 border-t border-dashed border-[#E4D8C4] pt-2">
                          <span className="s muted">For selected tenant:</span>

                          {st ? (
                            <span className="pill ok">
                              {st === "trialing" ? "On trial" : "Active"}
                              {tp?.billingPeriod
                                ? ` · ${tp.billingPeriod}`
                                : ""}
                            </span>
                          ) : (
                            <span className="pill">Not assigned</span>
                          )}

                          {st === "trialing" ? (
                            <>
                              <button
                                className="btn w-full sm:w-auto sm:ml-auto"
                                disabled={aBusy === p.code}
                                onClick={() => convert(p.code)}
                              >
                                {aBusy === p.code
                                  ? "…"
                                  : `Convert to paid (${assignPeriod})`}
                              </button>

                              <button
                                className="btn ghost w-full sm:w-auto"
                                disabled={aBusy === p.code}
                                onClick={() => remove(p.code)}
                              >
                                Remove
                              </button>
                            </>
                          ) : st === "active" ? (
                            <button
                              className="btn ghost w-full sm:w-auto sm:ml-auto"
                              disabled={aBusy === p.code}
                              onClick={() => remove(p.code)}
                            >
                              {aBusy === p.code ? "…" : "Remove"}
                            </button>
                          ) : (
                            <>
                              <button
                                className="btn ghost w-full sm:w-auto sm:ml-auto"
                                disabled={aBusy === p.code}
                                onClick={() => assign(p.code, true)}
                              >
                                Assign trial
                              </button>

                              <button
                                className="btn w-full sm:w-auto"
                                disabled={aBusy === p.code}
                                onClick={() => assign(p.code, false)}
                              >
                                {aBusy === p.code
                                  ? "…"
                                  : `Assign paid (${assignPeriod})`}
                              </button>
                            </>
                          )}
                        </div>
                      );
                    })()
                  : null}
              </section>
            );
          })}
        </div>
      )}

      <div className="s muted mt-2.5">
        Subscribing a tenant to a plan activates its member assistants through
        the same per-assistant access gate; each keeps its own usage allowance.
        Exact billing of the discounted plan price is handled in the billing
        engine.
      </div>
    </div>
  );
}

const inp: CSSProperties = {
  padding: "7px 9px",
  border: "1px solid #E4D8C4",
  borderRadius: 8,
  background: "#fff",
  fontSize: 13,
  minWidth: 110,
};
const lbl: CSSProperties = { display: "flex", flexDirection: "column", gap: 3 };
