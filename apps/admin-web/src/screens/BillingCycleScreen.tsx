import { useState } from "react";
import { PageHeader, StatusBadge, ErrorState } from "@aipowersalon/ui";
import {
  billingCycleApi,
  type BillingCycleResult,
} from "../api/superAdminBillingApi";
import {
  FiRefreshCw,
  FiEye,
  FiPlay,
  FiClock,
  FiShield,
  FiCheckCircle,
  FiAlertCircle,
  FiInfo,
  FiArrowRight,
} from "react-icons/fi";
// BillingCycleScreen — Super Admin → Billing → Billing Cycle. Operable surface for the period-end subscription invoice
// generator: run one pass on demand and see the counts. The generator applies the fixed policy (active→invoice+advance;
// trialing→invoice+convert; pending_cancellation/cancel_at→cancel; past_due/paused/terminal→skip), is idempotent, and
// advances one cycle per pass. Automatic hourly runs require BILLING_CYCLE_WORKER_ENABLED=1 in the API environment.

const POLICY: {
  state: string;
  action: string;
  tone: "success" | "warning" | "danger" | "neutral";
}[] = [
  {
    state: "active",
    action: "Invoice next cycle + advance period",
    tone: "success",
  },
  {
    state: "trialing",
    action: "Invoice (first charge) + convert to active",
    tone: "success",
  },
  {
    state: "pending_cancellation / cancel_at reached",
    action: "Cancel — no invoice",
    tone: "warning",
  },
  { state: "past_due", action: "Skip — dunning owns it", tone: "danger" },
  { state: "paused / expired / cancelled", action: "Skip", tone: "neutral" },
];

export function BillingCycleScreen() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BillingCycleResult | null>(null);
  const [ranAt, setRanAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (dryRun: boolean) => {
    setRunning(true);
    setError(null);
    try {
      const r = await billingCycleApi.run(dryRun);
      setResult(r);
      setRanAt(new Date().toLocaleString());
    } catch (e: any) {
      setError(e?.message || "The billing cycle run failed.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="work w-full">
      <PageHeader
        title="Billing Cycle"
        subtitle="Period-end subscription invoice generator — run a billing pass and review the results."
      />

      <div className="mt-6 space-y-6">
        <div className="overflow-hidden rounded-2xl border border-[#e8dcc8] bg-white shadow-sm">
          <div className="flex flex-col gap-5 border-b border-[#eee5d8] bg-gradient-to-r from-[#fffaf2] to-white px-5 py-5 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#f7ead2] text-[#b98224]">
                <FiRefreshCw size={22} />
              </div>

              <div>
                <h2 className="text-base font-bold text-[#2f2a24]">
                  Billing Cycle Control
                </h2>

                <p className="mt-1 text-sm text-[#857566]">
                  Preview the billing process safely or run the billing cycle
                  immediately.
                </p>

                {ranAt && !running && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-[#9a8876]">
                    <FiClock size={13} />
                    <span>
                      Last run:{" "}
                      <strong className="font-semibold text-[#6d5c4b]">
                        {ranAt}
                      </strong>
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <button
                className="
              flex h-11 items-center justify-center gap-2
              rounded-xl border border-[#d9bd87]
              bg-white px-5
              text-sm font-bold text-[#9a6817]
              transition-all duration-200
              hover:bg-[#fff8eb]
              disabled:cursor-not-allowed disabled:opacity-60
            "
                disabled={running}
                onClick={() => run(true)}
              >
                <FiEye size={17} />

                {running ? "Working…" : "Preview (dry run)"}
              </button>

              <button
                className="
              flex h-11 items-center justify-center gap-2
              rounded-xl
              bg-[#c9963f]
              px-6
              text-sm font-bold text-white
              shadow-sm
              transition-all duration-200
              hover:bg-[#b9852e]
              hover:shadow-md
              disabled:cursor-not-allowed disabled:opacity-60
            "
                disabled={running}
                onClick={() => run(false)}
              >
                {running ? (
                  <>
                    <FiRefreshCw className="animate-spin" size={17} />
                    Running…
                  </>
                ) : (
                  <>
                    <FiPlay size={17} />
                    Run billing cycle now
                  </>
                )}
              </button>
            </div>
          </div>

          {result && !error && (
            <div className="p-5">
              {result.dryRun && (
                <div className="mb-5 flex items-start gap-3 rounded-xl border border-[#f0d9a6] bg-[#fff8e9] px-4 py-3">
                  <FiEye size={18} className="mt-0.5 shrink-0 text-[#b98224]" />

                  <div>
                    <div className="text-sm font-bold text-[#79551d]">
                      Preview Mode
                    </div>

                    <p className="mt-1 text-xs leading-relaxed text-[#987744]">
                      Preview only — nothing was written. These are the counts a
                      real billing run would produce right now.
                    </p>
                  </div>
                </div>
              )}

              <div className="mb-4 flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f5efe5] text-[#9a6817]">
                  <FiShield size={16} />
                </div>

                <div>
                  <h3 className="text-sm font-bold text-[#3b3228]">
                    Billing Run Summary
                  </h3>

                  <p className="text-xs text-[#9a8876]">
                    Results from the latest billing cycle operation.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
                <div className="rounded-xl border border-[#eee5d8] bg-[#fffdf9] p-4 transition-shadow hover:shadow-sm">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#f8edd8] text-[#b98224]">
                      <FiClock size={17} />
                    </div>
                  </div>

                  <div className="text-2xl font-bold text-[#30291f]">
                    {result.due}
                  </div>

                  <div className="mt-1 text-xs font-medium text-[#8d7d6d]">
                    {result.dryRun ? "Would be due" : "Due this pass"}
                  </div>
                </div>

                <div className="rounded-xl border border-[#dceadf] bg-[#fbfefb] p-4 transition-shadow hover:shadow-sm">
                  <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-[#e5f3e8] text-[#398052]">
                    <FiCheckCircle size={17} />
                  </div>

                  <div className="text-2xl font-bold text-[#30291f]">
                    {result.invoiced}
                  </div>

                  <div className="mt-1 text-xs font-medium text-[#718277]">
                    {result.dryRun ? "Would invoice" : "Invoiced"}
                  </div>
                </div>

                <div className="rounded-xl border border-[#f0e1d6] bg-[#fffdfb] p-4 transition-shadow hover:shadow-sm">
                  <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-[#f8ebe2] text-[#a86442]">
                    <FiAlertCircle size={17} />
                  </div>

                  <div className="text-2xl font-bold text-[#30291f]">
                    {result.cancelled}
                  </div>

                  <div className="mt-1 text-xs font-medium text-[#927b6b]">
                    {result.dryRun ? "Would cancel" : "Cancelled"}
                  </div>
                </div>

                <div className="rounded-xl border border-[#e6e7ea] bg-[#fcfcfd] p-4 transition-shadow hover:shadow-sm">
                  <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-[#eef0f3] text-[#6d7480]">
                    <FiArrowRight size={17} />
                  </div>

                  <div className="text-2xl font-bold text-[#30291f]">
                    {result.skipped}
                  </div>

                  <div className="mt-1 text-xs font-medium text-[#858994]">
                    Skipped
                  </div>
                </div>

                <div
                  className={`rounded-xl border p-4 transition-shadow hover:shadow-sm ${
                    result.errors > 0
                      ? "border-[#f1d4d2] bg-[#fffafa]"
                      : "border-[#eee5d8] bg-[#fffdf9]"
                  }`}
                >
                  <div
                    className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg ${
                      result.errors > 0
                        ? "bg-[#f9e5e3] text-[#b54b45]"
                        : "bg-[#f5efe5] text-[#8c7d6d]"
                    }`}
                  >
                    <FiAlertCircle size={17} />
                  </div>

                  <div className="text-2xl font-bold text-[#30291f]">
                    {result.errors}
                  </div>

                  <div className="mt-1 text-xs font-medium text-[#8d7d6d]">
                    Errors
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {error && <ErrorState message={error} />}

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_360px]">
          <div className="overflow-hidden rounded-2xl border border-[#e8dcc8] bg-white shadow-sm">
            <div className="flex items-center gap-4 border-b border-[#eee5d8] px-5 py-5">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#f7ead2] text-[#b98224]">
                <FiShield size={20} />
              </div>

              <div>
                <h2 className="text-base font-bold text-[#30291f]">
                  Billing Policy Applied
                </h2>

                <p className="mt-1 text-sm text-[#8d7d6d]">
                  Subscription status rules applied during each billing cycle.
                </p>
              </div>
            </div>

            <div className="divide-y divide-[#eee8df]">
              {POLICY.map((p) => (
                <div
                  key={p.state}
                  className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center"
                >
                  <div className="sm:min-w-[250px]">
                    <StatusBadge tone={p.tone}>{p.state}</StatusBadge>
                  </div>

                  <div className="flex items-center gap-3 text-sm text-[#66594d]">
                    <FiCheckCircle
                      size={17}
                      className="shrink-0 text-[#b98224]"
                    />

                    <span>{p.action}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-[#e8dcc8] bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f2eee8] text-[#796b5d]">
                <FiInfo size={19} />
              </div>

              <div>
                <h3 className="text-sm font-bold text-[#30291f]">
                  How billing cycles work
                </h3>

                <p className="mt-1 text-xs text-[#9a8876]">
                  Important billing behavior
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              <div className="rounded-xl bg-[#faf7f1] p-4">
                <div className="text-sm font-semibold text-[#4c4034]">
                  Safe and idempotent
                </div>

                <p className="mt-1 text-xs leading-5 text-[#827466]">
                  Runs are idempotent — a period is never invoiced twice — and
                  each pass advances one billing cycle.
                </p>
              </div>

              <div>
                <div className="mb-2 text-xs font-bold uppercase tracking-wide text-[#8d7d6d]">
                  Automatic hourly runs
                </div>

                <p className="text-xs leading-5 text-[#827466]">
                  Enable the billing worker in your API environment using:
                </p>

                <code className="mt-3 block overflow-x-auto rounded-lg border border-[#eadfce] bg-[#fffaf2] px-3 py-2 text-xs font-semibold text-[#8b6427]">
                  BILLING_CYCLE_WORKER_ENABLED=1
                </code>
              </div>

              <div className="border-t border-[#eee8df] pt-4">
                <p className="text-xs leading-5 text-[#9a8876]">
                  If automatic billing is not enabled, billing passes can be
                  triggered manually from this page.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
