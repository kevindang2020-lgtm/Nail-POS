// PlatformTextingCard.tsx — B-16 (Oct 20 2026): Super Admin provisions a PLATFORM-MANAGED salon's texting from the salon's
// messaging setup — its own Twilio subaccount, Messaging Service and number, step by step and resumable. Spends money at
// Twilio (a number), so it needs a reason and a step-up (the API client re-prompts on STEP_UP_REQUIRED). A salon that
// brought its own Twilio account is not offered this.
import { useState } from "react";
import { superAdminAiApi, type AdminTenantMessagingCreds } from "../api/superAdminAiApi";

const STEP_LABEL: Record<string, string> = {
  subaccount: "Subaccount created",
  messaging_service: "Messaging Service created",
  number: "Number bought",
  done: "Live",
  offboarded: "Shut down (salon cancelled)",
};
const OFFBOARD_REFUSED: Record<string, string> = {
  salon_not_cancelled: "Only a cancelled salon's texting can be shut down.",
  not_platform_managed: "This salon uses its own Twilio account — nothing to shut down here.",
  nothing_to_offboard: "This salon has no platform-managed texting.",
  not_configured: "The platform's Twilio master account is not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN).",
};

export function PlatformTextingCard({ tenantId, creds, onChanged }: { tenantId: string; creds: AdminTenantMessagingCreds | null; onChanged: () => void }) {
  const [reason, setReason] = useState("");
  const [areaCode, setAreaCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const ownAccount = creds?.status === "configured" && creds?.accountMode !== "platform_managed";
  const prov = creds?.provisioning ?? null;
  const live = prov?.step === "done" && creds?.status === "configured";
  const offboarded = prov?.step === "offboarded";

  // §149: a cancelled salon's number is released (irreversible) and its subaccount closed; the daily sweep does it after 30 days
  const offboard = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await superAdminAiApi.offboardPlatformMessaging(tenantId, { reason: reason.trim() });
      if (r.ok) setMsg({ ok: true, text: r.alreadyOffboarded ? "Already shut down." : `Shut down — released ${r.releasedNumbers?.length ? r.releasedNumbers.join(", ") : "no numbers"}${r.subaccountClosed ? ", subaccount closed" : ""}.` });
      else setMsg({ ok: false, text: (r.reason && OFFBOARD_REFUSED[r.reason]) || `Stopped: ${r.error}. Running it again continues from there.` });
      onChanged();
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || "Shutdown failed." });
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await superAdminAiApi.provisionPlatformMessaging(tenantId, { reason: reason.trim(), ...(areaCode.trim() ? { areaCode: areaCode.trim() } : {}) });
      if (r.ok) setMsg({ ok: true, text: r.alreadyProvisioned ? `Already live on ${r.number}.` : `Live — texting from ${r.number}.` });
      else if (r.reason === "not_configured") setMsg({ ok: false, text: "The platform's Twilio master account is not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)." });
      else setMsg({ ok: false, text: `Stopped${r.step ? ` after “${STEP_LABEL[r.step] ?? r.step}”` : ""}: ${r.error}. Running it again continues from there.` });
      onChanged();
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || "Provisioning failed." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-4 rounded-xl border bg-white p-4" data-testid="platform-texting">
      <div className="text-[14px] font-bold">Platform-managed texting</div>
      {ownAccount ? (
        <div className="mt-1 text-[12.5px]">This salon uses its own Twilio account. Disconnect it to switch to a platform-managed account.</div>
      ) : (
        <>
          <div className="mt-1 text-[12.5px]" data-testid="platform-texting-state">
            {live
              ? `Live since ${new Date(prov!.provisionedAt!).toLocaleDateString()} — subaccount ${creds?.accountSid}, service ${prov?.messagingServiceSid}, number ${creds?.fromNumber}.`
              : prov
                ? `In progress — last step: ${prov.step ? STEP_LABEL[prov.step] : "not started"}.${prov.error ? ` Stopped: ${prov.error}` : ""}`
                : "Not set up. Provisioning creates the salon's own Twilio subaccount, a Messaging Service and a number."}
          </div>
          {prov && !offboarded && (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end" data-testid="platform-texting-offboard">
              <span className="text-[12px]">Salon cancelled? Release its number (cannot be undone) and close its subaccount. Uses the reason above.</span>
              <button type="button" className="rounded-lg px-4 py-2 text-[12px] font-semibold" disabled={busy || reason.trim().length < 3} onClick={offboard}>
                {busy ? "Working…" : "Shut down texting"}
              </button>
            </div>
          )}
          {live && (
            <label className="mt-3 block text-[12px]">Reason
              <input aria-label="Reason for shutting down" className="mt-1 block w-full rounded border px-2 py-1" value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
          )}
          {!live && !offboarded && (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="text-[12px]">Reason
                <input aria-label="Reason for provisioning" className="mt-1 block w-full rounded border px-2 py-1" value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
              <label className="text-[12px]">Area code (optional)
                <input aria-label="Area code" className="mt-1 block w-24 rounded border px-2 py-1" value={areaCode} maxLength={3} onChange={(e) => setAreaCode(e.target.value.replace(/\D/g, ""))} />
              </label>
              <button type="button" className="rounded-lg px-4 py-2 text-[12px] font-semibold" disabled={busy || reason.trim().length < 3} onClick={run}>
                {busy ? "Provisioning…" : prov ? "Continue provisioning" : "Provision platform texting"}
              </button>
            </div>
          )}
        </>
      )}
      {msg && <div role="status" className="mt-2 text-[12.5px]" style={{ color: msg.ok ? "#2F6B3A" : "#9B2C2C" }}>{msg.text}</div>}
    </div>
  );
}
