// MessagingReadinessScreen.tsx — Super Admin view of the messaging environment configuration: a live checklist of which
// Twilio/messaging env vars are set (never their values), whether PROVIDER_VAULT_KEK meets the length requirement, and
// the exact webhook URLs to paste into the Twilio Console for each number.
import { useEffect, useState } from "react";
import { superAdminAiApi } from "../api/superAdminAiApi";
import { useCan } from '../auth/useCan';
import {
  FiCheckCircle,
  FiXCircle,
  FiCircle,
  FiRefreshCw,
  FiCopy,
  FiCheck,
  FiMail,
  FiMessageSquare,
  FiLink,
  FiSettings,
  FiCpu,
  FiAlertTriangle,
} from "react-icons/fi";
const GOLD = "var(--g7,#A96F22)";
const LINE = "var(--line,#E7DBC6)";
const CARD: React.CSSProperties = {
  background: "#fff",
  border: `1px solid ${LINE}`,
  borderRadius: 12,
  padding: 16,
  maxWidth: 640,
  marginBottom: 12,
};

const overallColor: Record<string, string> = {
  ready: "#2E7D5B",
  partial: "#9B6B1E",
  not_configured: "#B85B4D",
};
const overallLabel: Record<string, string> = {
  ready: "Ready to send",
  partial: "Partially configured",
  not_configured: "Not configured",
};

export default function MessagingReadinessScreen() {
  const [r, setR] = useState<any>(null);
  const [ai, setAi] = useState<any>(null);
  const [copied, setCopied] = useState("");
  const mayAi = useCan()('super_admin.ai.view');   // the AI-readiness card is an AI read
  const load = () => {
    superAdminAiApi
      .messagingReadiness()
      .then(setR)
      .catch(() => setR(null));
    if (mayAi) superAdminAiApi
      .aiReadiness()
      .then(setAi)
      .catch(() => setAi(null));
  };
  useEffect(() => {
    load();
  }, [mayAi]);   // eslint-disable-line react-hooks/exhaustive-deps

  const copy = (text: string, key: string) => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(key);
        setTimeout(() => setCopied(""), 1500);
      })
      .catch(() => {});
  };

  return (
    <div className="w-full p-5">
      <div className="mb-6">
        <h1 className="font-serif text-[26px] font-medium text-[#2F2418] ">
          Messaging Environment
        </h1>

        <p className="mt-2 max-w-3xl text-sm leading-6 text-[#7A6C57]">
          Configure these in your API environment, then point each Twilio
          number's webhooks at the URLs below. Values themselves are never shown
          here — only whether they're set.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          {r && (
            <div className="rounded-2xl border border-[#E8DED0] bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{
                      background: overallColor[r.overall] || "#999",
                    }}
                  />

                  <div>
                    <div className="text-xs font-medium uppercase tracking-wider text-[#9B8B78]">
                      System Status
                    </div>

                    <div
                      className="mt-1 text-base font-bold"
                      style={{
                        color: overallColor[r.overall] || "#333",
                      }}
                    >
                      {overallLabel[r.overall] || r.overall}
                    </div>
                  </div>
                </div>

                <button
                  onClick={load}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-[#C5A46E] px-4 text-sm font-bold text-[#A87520] transition hover:bg-[#FFF8EA] active:scale-[0.98]"
                >
                  <FiRefreshCw size={16} />
                  Refresh
                </button>
              </div>
            </div>
          )}

          {r?.invitations && (
            <div
              className="rounded-2xl border bg-white p-5 shadow-sm"
              style={{
                borderColor:
                  r.invitations.status === "ready"
                    ? "#2E6B47"
                    : r.invitations.status === "partial"
                      ? GOLD
                      : "#B3403C",
              }}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex items-center gap-3">
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{
                      background:
                        r.invitations.status === "ready"
                          ? "#2E6B47"
                          : r.invitations.status === "partial"
                            ? GOLD
                            : "#B3403C",
                    }}
                  />

                  <div>
                    <h2 className="text-base font-bold text-[#5A4B37]">
                      Invitation Delivery
                    </h2>

                    <span className="text-xs font-semibold uppercase tracking-wider text-[#9B8B78]">
                      {r.invitations.status.replace("_", " ")}
                    </span>
                  </div>
                </div>
              </div>

              <div
                className="mt-4 rounded-xl bg-[#FAF8F4] p-4 text-sm leading-6"
                style={{
                  color:
                    r.invitations.status === "not_connected"
                      ? "#B3403C"
                      : "#5A4B37",
                  fontWeight: r.invitations.status === "ready" ? 400 : 600,
                }}
              >
                {r.invitations.consequence}
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="flex items-center gap-2 rounded-xl border border-[#EEE6DA] p-3">
                  {r.invitations.canSendSms ? (
                    <FiCheckCircle size={18} className="text-[#2E7D5B]" />
                  ) : (
                    <FiXCircle size={18} className="text-[#B85B4D]" />
                  )}

                  <FiMessageSquare size={16} className="text-[#9B8B78]" />

                  <span className="text-sm font-semibold text-[#5A4B37]">
                    SMS
                  </span>
                </div>

                <div className="flex items-center gap-2 rounded-xl border border-[#EEE6DA] p-3">
                  {r.invitations.canSendEmail ? (
                    <FiCheckCircle size={18} className="text-[#2E7D5B]" />
                  ) : (
                    <FiXCircle size={18} className="text-[#B85B4D]" />
                  )}

                  <FiMail size={16} className="text-[#9B8B78]" />

                  <span className="text-sm font-semibold text-[#5A4B37]">
                    Email
                  </span>
                </div>

                <div className="flex items-center gap-2 rounded-xl border border-[#EEE6DA] p-3">
                  {r.invitations.hasAcceptUrl ? (
                    <FiCheckCircle size={18} className="text-[#2E7D5B]" />
                  ) : (
                    <FiXCircle size={18} className="text-[#B85B4D]" />
                  )}

                  <FiLink size={16} className="text-[#9B8B78]" />

                  <span className="text-sm font-semibold text-[#5A4B37]">
                    Invite Link
                  </span>
                </div>
              </div>

              {r.invitations.blockers.length > 0 && (
                <div className="mt-4 rounded-xl border border-[#F1D2CE] bg-[#FFF7F6] p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-bold text-[#B3403C]">
                    <FiAlertTriangle size={17} />
                    Issues requiring attention
                  </div>

                  <ul className="space-y-2 pl-5 text-sm leading-6 text-[#7A6C57]">
                    {r.invitations.blockers.map((b: string, i: number) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {r && (
            <div className="rounded-2xl border border-[#E8DED0] bg-white p-5 shadow-sm">
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#FFF5E3] text-[#A87520]">
                  <FiSettings size={19} />
                </div>

                <div>
                  <h2 className="text-base font-bold text-[#5A4B37]">
                    Configuration
                  </h2>

                  <p className="text-xs text-[#9B8B78]">
                    Messaging environment configuration status
                  </p>
                </div>
              </div>

              <div className="divide-y divide-[#EEE6DA]">
                {r.checks.map((c: any) => (
                  <div key={c.key} className="flex gap-3 py-4">
                    <div className="mt-0.5">
                      {c.ok ? (
                        <FiCheckCircle size={19} className="text-[#2E7D5B]" />
                      ) : c.required ? (
                        <FiXCircle size={19} className="text-[#B85B4D]" />
                      ) : (
                        <FiCircle size={17} className="text-[#9B8B78]" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-[#4A3F30]">
                          {c.label}
                        </span>

                        {c.required && (
                          <span className="rounded-full bg-[#FFF0EE] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#B85B4D]">
                            Required
                          </span>
                        )}
                      </div>

                      <p className="mt-1 text-xs leading-5 text-[#7A6C57]">
                        {c.detail}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {r && (
            <div className="rounded-2xl border border-[#E8DED0] bg-white p-5 shadow-sm">
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#FFF5E3] text-[#A87520]">
                  <FiLink size={19} />
                </div>

                <div>
                  <h2 className="text-base font-bold text-[#5A4B37]">
                    Twilio Webhook URLs
                  </h2>

                  <p className="text-xs text-[#9B8B78]">
                    Paste these URLs into each Twilio number configuration
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                {[
                  ["Inbound SMS", r.webhooks.inbound, "in"],
                  ["Status callback", r.webhooks.status, "st"],
                ].map(([label, url, key]) => (
                  <div
                    key={key}
                    className="rounded-xl border border-[#EEE6DA] p-4"
                  >
                    <div className="mb-2 text-sm font-bold text-[#5A4B37]">
                      {label}
                    </div>

                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                      <code className="block min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg bg-[#F7EFE3] px-3 py-3 text-xs text-[#5A4B37]">
                        {url}
                      </code>

                      <button
                        onClick={() => copy(String(url), String(key))}
                        className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-[#C5A46E] px-4 text-sm font-bold text-[#A87520] transition hover:bg-[#FFF8EA]"
                      >
                        {copied === key ? (
                          <>
                            <FiCheck size={16} />
                            Copied
                          </>
                        ) : (
                          <>
                            <FiCopy size={16} />
                            Copy
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-xl bg-[#FAF8F4] p-4 text-xs leading-5 text-[#9B8B78]">
                Salons on their own Twilio account: set these URLs on their
                number too. Inbound and status signatures are verified
                automatically with that account's token.
              </div>
            </div>
          )}
        </div>

        <div className="space-y-5">
          {ai && (
            <div className="rounded-2xl border border-[#E8DED0] bg-white p-5 shadow-sm xl:sticky xl:top-5">
              <div className="mb-5 flex items-start gap-3">
                <div
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                    ai.draftsPolished
                      ? "bg-[#EAF6EF] text-[#2E7D5B]"
                      : "bg-[#FFF5E3] text-[#9B6B1E]"
                  }`}
                >
                  <FiCpu size={21} />
                </div>

                <div className="min-w-0">
                  <h2 className="text-base font-bold text-[#5A4B37]">
                    AI Reception Copilot
                  </h2>

                  <p className="mt-1 text-xs leading-5 text-[#7A6C57]">
                    {ai.draftsPolished
                      ? `Drafts LLM-polished via ${ai.provider}`
                      : "Drafts use built-in templates. Set a provider key to enable AI polishing."}
                  </p>
                </div>
              </div>

              <div
                className={`mb-4 flex items-center gap-2 rounded-xl p-3 ${
                  ai.draftsPolished ? "bg-[#F0FAF4]" : "bg-[#FFF8EA]"
                }`}
              >
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    ai.draftsPolished ? "bg-[#2E7D5B]" : "bg-[#9B6B1E]"
                  }`}
                />

                <span className="text-xs font-bold text-[#5A4B37]">
                  {ai.draftsPolished
                    ? "AI Draft Polishing Active"
                    : "Template Mode Active"}
                </span>
              </div>

              <div className="divide-y divide-[#EEE6DA]">
                {ai.checks.map((c: any) => (
                  <div key={c.key} className="flex gap-3 py-4">
                    <div className="mt-0.5">
                      {c.ok ? (
                        <FiCheckCircle size={18} className="text-[#2E7D5B]" />
                      ) : (
                        <FiCircle size={16} className="text-[#9B8B78]" />
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="text-sm font-bold text-[#4A3F30]">
                        {c.label}
                      </div>

                      <div className="mt-1 text-xs leading-5 text-[#7A6C57]">
                        {c.detail}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
