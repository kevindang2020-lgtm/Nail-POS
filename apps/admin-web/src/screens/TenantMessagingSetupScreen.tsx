// TenantMessagingSetupScreen.tsx — Super Admin → configure a tenant's own Twilio account (Account SID, Auth Token, From
// number). The auth token is write-only: it's shown only as a masked last-4 hint after saving and is never returned by
// the API. Saving also registers the from number so inbound routing + per-tenant sending line up.
import { useEffect, useState } from "react";
import { PlatformTextingCard } from "./PlatformTextingCard";
import { useParams } from "react-router-dom";
import {
  superAdminAiApi,
  type AdminTenantMessagingCreds,
  type AdminNumberQuote,
} from "../api/superAdminAiApi";
import { superAdminApi } from "../api/superAdminApi";
import { MdOutlineLock } from "react-icons/md";
import { LuPhoneCall } from "react-icons/lu";
const GOLD = "var(--g7,#A96F22)";
const LINE = "var(--line,#E7DBC6)";
const INPUT: React.CSSProperties = {
  width: "100%",
  height: 38,
  border: `1px solid ${LINE}`,
  borderRadius: 9,
  padding: "0 10px",
  fontSize: 13,
  boxSizing: "border-box",
};
const LABEL: React.CSSProperties = {
  fontSize: 12,
  color: "#7A6C57",
  margin: "10px 0 4px",
  fontWeight: 600,
};

export default function TenantMessagingSetupScreen() {
  const { tenantId: paramTenantId } = useParams();
  const [tenantList, setTenantList] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [tenantId, setTenantId] = useState(paramTenantId || "");
  const [creds, setCreds] = useState<AdminTenantMessagingCreds | null>(null);
  const [accountSid, setAccountSid] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [fromNumber, setFromNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [num, setNum] = useState<{
    configured: boolean;
    usingOwnAccount: boolean;
    registeredNumber: string | null;
  } | null>(null);
  const [areaCode, setAreaCode] = useState("");
  const [avail, setAvail] = useState<
    {
      phoneNumber: string;
      friendlyName: string;
      locality: string | null;
      region: string | null;
    }[]
  >([]);
  const [numBusy, setNumBusy] = useState("");
  const [numMsg, setNumMsg] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [existingNum, setExistingNum] = useState("");
  // Phone & Messaging guide §6.4: a number is bought only after the operator reviews the provider's quote and confirms
  const [quote, setQuote] = useState<AdminNumberQuote | null>(null);
  // Twilio could not be reached to check the credentials: the operator may save them as UNVERIFIED, after being asked
  const [askUnverified, setAskUnverified] = useState(false);
  const [revealing, setRevealing] = useState(false);

  useEffect(() => {
    if (tenantId)
      superAdminAiApi
        .numberGet(tenantId)
        .then(setNum)
        .catch(() => setNum(null));
  }, [tenantId, creds?.status]);
  const searchNumbers = async () => {
    setNumBusy("search");
    setNumMsg(null);
    setAvail([]);
    try {
      const r = await superAdminAiApi.numberSearch(tenantId, areaCode.trim());
      if (!r.configured)
        setNumMsg({
          ok: false,
          text: "Configure Twilio credentials (or the shared account) first.",
        });
      setAvail(r.available);
    } catch (e: any) {
      setNumMsg({ ok: false, text: e?.message || "Search failed." });
    } finally {
      setNumBusy("");
    }
  };
  const reviewNumber = async (pn: string) => {
    setNumBusy(pn);
    setNumMsg(null);
    setQuote(null);
    try {
      const q = await superAdminAiApi.numberQuote(tenantId, pn);
      if (q.ok) setQuote(q);
      else setNumMsg({ ok: false, text: "Configure Twilio credentials first." });
    } catch (e: any) {
      setNumMsg({ ok: false, text: e?.message || "Could not check that number." });
    } finally {
      setNumBusy("");
    }
  };
  const confirmPurchase = async () => {
    if (!quote) return;
    setNumBusy(quote.phoneNumber);
    setNumMsg(null);
    try {
      const r = await superAdminAiApi.numberBuy(tenantId, quote.phoneNumber, quote.confirmationToken);
      if (r.ok) {
        setNumMsg({
          ok: true,
          text: `Bought ${r.number} — sending, inbound, and receipts now use it.`,
        });
        setAvail([]);
        setQuote(null);
        superAdminAiApi.numberGet(tenantId).then(setNum).catch(() => { /* the purchase / registration stands; the number card refreshes on the next load */ });
      } else
        setNumMsg({
          ok: false,
          text:
            r.reason === "not_configured"
              ? "Configure Twilio credentials first."
              : r.error || "Purchase failed.",
        });
    } catch (e: any) {
      setNumMsg({ ok: false, text: e?.message || "Purchase failed." });
      if (e?.code === "NUMBER_QUOTE_EXPIRED" || e?.code === "NUMBER_QUOTE_INVALID") setQuote(null);
    } finally {
      setNumBusy("");
    }
  };
  const registerExisting = async () => {
    setNumBusy("reg");
    setNumMsg(null);
    try {
      const r = await superAdminAiApi.numberRegister(
        tenantId,
        existingNum.trim(),
      );
      if (r.ok) {
        setNumMsg({ ok: true, text: `Registered ${r.number}.` });
        setExistingNum("");
        superAdminAiApi.numberGet(tenantId).then(setNum).catch(() => { /* the purchase / registration stands; the number card refreshes on the next load */ });
      } else setNumMsg({ ok: false, text: r.error || "Failed." });
    } catch (e: any) {
      setNumMsg({ ok: false, text: e?.message || "Failed." });
    } finally {
      setNumBusy("");
    }
  };

  // When reached from the sidebar (no tenant in the URL), let the operator pick a tenant.
  useEffect(() => {
    if (paramTenantId) return;
    superAdminApi
      .state()
      .then((r: any) => {
        const list = (r?.tenants || []).map((t: any) => ({
          id: t.id,
          name: t.n || t.displayName || t.name || t.legalName || t.code || t.id,
          code: t.code,
        }));
        setTenantList(list);
        if (list[0]) setTenantId((cur) => cur || list[0].id);
      })
      .catch(() => setTenantList([]));
  }, [paramTenantId]);

  const [credsRev, setCredsRev] = useState(0);   // B-16: the provisioning card asks for a reload
  useEffect(() => {
    if (!tenantId) return;
    superAdminAiApi
      .tenantMessagingCreds(tenantId)
      .then((c) => {
        setCreds(c);
        setAccountSid(c.accountSid || "");
        setFromNumber(c.fromNumber || "");
        setAuthToken("");
        setMsg(null);
      })
      .catch(() => setCreds(null));
  }, [tenantId, credsRev]);

  const save = async (confirmUnverified = false) => {
    setSaving(true);
    setMsg(null);
    setAskUnverified(false);
    try {
      const updated = await superAdminAiApi.setTenantMessagingCreds(tenantId, {
        accountSid: accountSid.trim(),
        authToken: authToken.trim() || undefined,
        fromNumber: fromNumber.trim(),
        ...(confirmUnverified ? { confirmUnverified: true } : {}),
      });
      setCreds(updated);
      setAuthToken("");
      setMsg({
        ok: true,
        text: confirmUnverified
          ? "Saved as UNVERIFIED — Twilio could not be reached to check it. Run Send Test once Twilio is reachable."
          : "Saved. This salon now sends from its own Twilio account.",
      });
    } catch (e: any) {
      if (e?.code === "MESSAGING_PROVIDER_UNREACHABLE") setAskUnverified(true);
      setMsg({ ok: false, text: e?.message || "Could not save credentials." });
    } finally {
      setSaving(false);
    }
  };

  // PM-02: the full SID only on an explicit, audited reveal (step-up on the server); it then fills the field unchanged
  const revealSid = async () => {
    setRevealing(true);
    setMsg(null);
    try {
      const r = await superAdminAiApi.revealTenantMessagingSid(tenantId);
      if (r.accountSid) setAccountSid(r.accountSid);
      else setMsg({ ok: false, text: "No Account SID is saved for this salon." });
    } catch (e: any) {
      setMsg({ ok: false, text: e?.code === "STEP_UP_CANCELLED" ? "Not shown — the confirmation was cancelled." : e?.message || "Could not show the Account SID." });
    } finally {
      setRevealing(false);
    }
  };

  const configured = creds?.status === "configured";

  const runTest = async () => {
    setTesting(true);
    setTestMsg(null);
    try {
      const r = await superAdminAiApi.testTenantMessaging(
        tenantId,
        testTo.trim(),
      );
      if (r.ok)
        setTestMsg({
          ok: true,
          text: `Sent — message ${r.sid}. Check that phone.`,
        });
      else if (r.reason === "not_configured")
        setTestMsg({ ok: false, text: "Save credentials first, then test." });
      else setTestMsg({ ok: false, text: r.error || "Send failed." });
    } catch (e: any) {
      setTestMsg({ ok: false, text: e?.message || "Could not run test." });
    } finally {
      setTesting(false);
    }
  };
  return (
    <div className="w-full p-5">
      <div className="mb-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2">
              

              <div>
                <h1
                  style={{
                    fontFamily: "Playfair Display, serif",
                    fontSize: 26,
                    margin: 0,
                    color: "#3F3427",
                  }}
                >
                  Twilio Setup
                </h1>

                <p
                  style={{
                    fontSize: 13,
                    color: "#7A6C57",
                    margin: "3px 0 0",
                  }}
                >
                  Configure communication services for this salon
                </p>
              </div>
            </div>
          </div>

          <div
            className="w-fit rounded-full px-4 py-2 text-[12px] font-bold"
            style={{
              background: configured ? "#E8F5EE" : "#FFF4E5",
              color: configured ? "#2E7D5B" : "#9B6A22",
              border: `1px solid ${configured ? "#B8DEC8" : "#E8C98C"}`,
            }}
          >
            {configured
              ? `✓ Configured · Token ••••${creds?.authTokenLast4 ?? ""}`
              : "⚠ Not Configured"}
          </div>
        </div>

        <p
          className="mt-2 max-w-3xl text-[13px] leading-6"
          style={{ color: "#7A6C57" }}
        >
          Each salon can run on its own Twilio account. The Auth Token is stored
          encrypted and is never shown again. Enter a new token only when
          setting up or rotating credentials.
        </p>
      </div>

      {!paramTenantId && (
        <div
          className="mb-3 rounded-xl border bg-white p-4 sm:p-5"
          style={{
            borderColor: LINE,
            boxShadow: "0 4px 20px rgba(90,75,55,0.05)",
          }}
        >
          <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div>
              <div style={LABEL}>Select Salon / Tenant</div>

              <select
                style={{
                  ...INPUT,
                  appearance: "auto",
                  width: "100%",
                }}
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
              >
                {tenantList.length === 0 && (
                  <option value="">Loading tenants…</option>
                )}

                {tenantList.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            <div
              className="rounded-lg px-4 py-3 text-[12px] font-semibold"
              style={{
                background: "#FAF7F1",
                color: "#7A6C57",
              }}
            >
              Select the salon to configure
            </div>
          </div>
        </div>
      )}

      {tenantId && <PlatformTextingCard tenantId={tenantId} creds={creds} onChanged={() => setCredsRev((n) => n + 1)} />}

      <div className="grid grid-cols-1 pb-5 gap-6 xl:grid-cols-2">
        <div
          className="rounded-xl border bg-white p-4 sm:p-6"
          style={{
            borderColor: LINE,
            boxShadow: "0 4px 20px rgba(90,75,55,0.05)",
          }}
        >
          <div className="mb-6 border-b pb-4" style={{ borderColor: LINE }}>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#F4E6C8]">
                <MdOutlineLock size={22} />
              </div>

              <div>
                <h2
                  className="m-0 text-[16px] font-bold"
                  style={{ color: "#5A4B37" }}
                >
                  Twilio Credentials
                </h2>

                <p className="mt-1 text-[12.5px]" style={{ color: "#9B8B78" }}>
                  Connect this salon to its Twilio account.
                </p>
              </div>
            </div>
          </div>

          <div
            className="mb-5 rounded-lg border px-4 py-3 text-[12.5px] font-semibold"
            style={{
              background: configured ? "#F0F9F4" : "#FFF8ED",
              borderColor: configured ? "#C8E6D3" : "#F1D6A7",
              color: configured ? "#2E7D5B" : "#9B6A22",
            }}
          >
            {configured
              ? `✓ Configured · Auth Token ending in ••••${creds?.authTokenLast4 ?? ""}`
              : "⚠ Not configured — this salon currently uses the shared account."}
          </div>

          <div className="space-y-4">
            <div>
              <div style={LABEL}>Account SID</div>

              <input
                style={{ ...INPUT, width: "100%" }}
                value={accountSid}
                onChange={(e) => setAccountSid(e.target.value)}
                placeholder="ACxxxxxxxxxxxxxxxx"
                disabled={saving}
              />
              {creds?.accountSid && accountSid === creds.accountSid && accountSid.includes("…") && (
                <button
                  type="button"
                  onClick={revealSid}
                  disabled={revealing || saving}
                  data-testid="sa-creds-reveal-sid"
                  className="mt-1 text-[12px] font-semibold underline"
                  style={{ background: "none", border: "none", color: "#8A5A1F", cursor: "pointer", padding: 0 }}
                >
                  {revealing ? "Showing…" : "Show full SID (recorded in the audit log)"}
                </button>
              )}
            </div>

            <div>
              <div style={LABEL}>
                Auth Token{" "}
                {configured ? "(leave blank to keep current token)" : ""}
              </div>

              <input
                style={{ ...INPUT, width: "100%" }}
                type="password"
                value={authToken}
                onChange={(e) => setAuthToken(e.target.value)}
                placeholder={
                  configured ? "••••••••••••••••" : "Twilio Auth Token"
                }
                disabled={saving}
              />
            </div>

            <div>
              <div style={LABEL}>From Number (E.164)</div>

              <input
                style={{ ...INPUT, width: "100%" }}
                value={fromNumber}
                onChange={(e) => setFromNumber(e.target.value)}
                placeholder="+18565551234"
                disabled={saving}
              />
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              onClick={() => save()}
              disabled={saving || !accountSid.trim() || !fromNumber.trim()}
              className="h-[42px] w-full rounded-[9px] px-6 font-bold sm:w-auto"
              style={{
                border: "none",
                background: GOLD,
                color: "#fff",
                cursor: "pointer",
                opacity:
                  saving || !accountSid.trim() || !fromNumber.trim() ? 0.6 : 1,
              }}
            >
              {saving ? "Saving…" : "Save Credentials"}
            </button>

            {msg && (
              <div
                className="text-[12.5px]"
                style={{
                  color: msg.ok ? "#2E7D5B" : "#B85B4D",
                }}
              >
                {msg.text}
              </div>
            )}
            {askUnverified && (
              <button
                onClick={() => save(true)}
                disabled={saving}
                data-testid="sa-creds-save-unverified"
                className="h-[38px] w-full rounded-[9px] px-4 text-[12.5px] font-bold sm:w-auto"
                style={{ border: `1px solid ${LINE}`, background: "#fff", color: "#8A5A1F", cursor: "pointer" }}
              >
                Save anyway as unverified
              </button>
            )}
          </div>
        </div>

        <div
          className="rounded-xl border bg-white p-4 sm:p-6"
          style={{
            borderColor: LINE,
            boxShadow: "0 4px 20px rgba(90,75,55,0.05)",
          }}
        >
          <div className="mb-6 border-b pb-4" style={{ borderColor: LINE }}>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#F4E6C8]">
                <LuPhoneCall size={22} />
              </div>

              <div>
                <h2
                  className="m-0 text-[16px] font-bold"
                  style={{ color: "#5A4B37" }}
                >
                  Phone Number Management
                </h2>

                <p className="mt-1 text-[12.5px]" style={{ color: "#9B8B78" }}>
                  Search, purchase, or register a salon phone number.
                </p>
              </div>
            </div>
          </div>

          <div
            className="mb-6 rounded-lg border p-4"
            style={{
              background: "#FAF7F1",
              borderColor: LINE,
            }}
          >
            <div
              className="mb-2 text-[11px] font-bold uppercase tracking-wide"
              style={{ color: "#9B8B78" }}
            >
              Current Number
            </div>

            {num?.registeredNumber ? (
              <div>
                <div
                  className="text-[18px] font-bold"
                  style={{ color: "#5A4B37" }}
                >
                  {num.registeredNumber}
                </div>

                <div className="mt-1 text-[12px]" style={{ color: "#7A6C57" }}>
                  {num.usingOwnAccount
                    ? "Using this salon's Twilio account"
                    : "Using the shared Twilio account"}
                </div>
              </div>
            ) : (
              <div
                className="text-[12.5px] leading-5"
                style={{ color: "#7A6C57" }}
              >
                No number registered yet. Search for an available number or
                register an existing one.
              </div>
            )}
          </div>

          <div className="mb-6">
            <div
              className="mb-3 text-[13px] font-bold"
              style={{ color: "#5A4B37" }}
            >
              Find a New Number
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <div style={LABEL}>Area Code (Optional)</div>

                <input
                  style={{ ...INPUT, width: "100%" }}
                  value={areaCode}
                  onChange={(e) => setAreaCode(e.target.value)}
                  placeholder="856"
                />
              </div>

              <button
                disabled={!!numBusy}
                onClick={searchNumbers}
                className="h-[38px] w-full rounded-[9px] px-5 font-bold sm:w-auto"
                style={{
                  border: `1px solid ${GOLD}`,
                  background: "#fff",
                  color: GOLD,
                  cursor: "pointer",
                }}
              >
                {numBusy === "search" ? "Searching…" : "Search Numbers"}
              </button>
            </div>
          </div>

          {avail.length > 0 && (
            <div className="mb-6">
              <div
                className="mb-3 text-[13px] font-bold"
                style={{ color: "#5A4B37" }}
              >
                Available Numbers
              </div>

              {quote && (
                <div
                  className="mb-3 rounded-lg border p-3 text-[12.5px]"
                  style={{ borderColor: GOLD, background: "#FFFBF3", color: "#5A4B37" }}
                  data-testid="sa-num-quote"
                  role="group"
                  aria-label="Confirm number purchase"
                >
                  <div className="text-[13px] font-bold">Confirm purchase of {quote.phoneNumber}</div>
                  <div className="mt-1">
                    {quote.price
                      ? `Price quoted by Twilio: ${quote.price.amount} ${quote.price.unit} per month.`
                      : "Twilio did not return a price for this number — check the price in the Twilio console before confirming."}
                  </div>
                  <div className="mt-1">
                    Billed to: {quote.billedTo === "salon_account" ? "the salon's own Twilio account" : "the platform's shared Twilio account"}.
                  </div>
                  {quote.capabilities && (
                    <div className="mt-1">
                      Supports: {[quote.capabilities.sms && "SMS", quote.capabilities.mms && "MMS", quote.capabilities.voice && "Voice"].filter(Boolean).join(", ") || "none reported"}.
                    </div>
                  )}
                  {quote.replacesNumber && (
                    <div className="mt-1 font-semibold" style={{ color: "#B85B4D" }}>
                      This salon currently texts from {quote.replacesNumber}; the new number becomes its sender.
                    </div>
                  )}
                  <div className="mt-1" style={{ color: "#9B8B78" }}>
                    This confirmation expires at {new Date(quote.expiresAt).toLocaleTimeString()}.
                  </div>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <button
                      onClick={confirmPurchase}
                      disabled={!!numBusy}
                      data-testid="sa-num-confirm"
                      className="h-[34px] rounded-lg px-4 text-[12px] font-bold"
                      style={{ border: "none", background: GOLD, color: "#fff", cursor: "pointer" }}
                    >
                      {numBusy === quote.phoneNumber ? "Buying…" : "Confirm purchase"}
                    </button>
                    <button
                      onClick={() => setQuote(null)}
                      disabled={!!numBusy}
                      data-testid="sa-num-cancel"
                      className="h-[34px] rounded-lg px-4 text-[12px] font-bold"
                      style={{ border: `1px solid ${LINE}`, background: "#fff", color: "#5A4B37", cursor: "pointer" }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              <div
                className="max-h-[260px] overflow-y-auto rounded-lg border"
                style={{ borderColor: LINE }}
              >
                {avail.map((a) => (
                  <div
                    key={a.phoneNumber}
                    className="flex flex-col gap-3 border-b p-3 last:border-b-0 sm:flex-row sm:items-center"
                    style={{ borderColor: LINE }}
                  >
                    <div className="min-w-0 flex-1">
                      <div
                        className="truncate text-[13px] font-bold"
                        style={{ color: "#5A4B37" }}
                      >
                        {a.phoneNumber}
                      </div>

                      <div
                        className="mt-1 text-[12px]"
                        style={{ color: "#9B8B78" }}
                      >
                        {a.locality || ""}
                        {a.region ? `, ${a.region}` : ""}
                      </div>
                    </div>

                    <button
                      disabled={!!numBusy}
                      onClick={() => reviewNumber(a.phoneNumber)}
                      data-testid={`sa-num-review-${a.phoneNumber}`}
                      className="h-[34px] w-full rounded-lg px-4 text-[12px] font-bold sm:w-auto"
                      style={{
                        border: "none",
                        background: GOLD,
                        color: "#fff",
                        cursor: "pointer",
                      }}
                    >
                      {numBusy === a.phoneNumber ? "Checking…" : "Review & Buy"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="border-t pt-5" style={{ borderColor: LINE }}>
            <div
              className="mb-3 text-[13px] font-bold"
              style={{ color: "#5A4B37" }}
            >
              Register Existing Number
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <div style={LABEL}>Number You Already Own (E.164)</div>

                <input
                  style={{ ...INPUT, width: "100%" }}
                  value={existingNum}
                  onChange={(e) => setExistingNum(e.target.value)}
                  placeholder="+18565551234"
                />
              </div>

              <button
                disabled={!!numBusy || !existingNum.trim()}
                onClick={registerExisting}
                className="h-[38px] w-full rounded-[9px] px-5 font-bold sm:w-auto"
                style={{
                  border: `1px solid ${GOLD}`,
                  background: "#fff",
                  color: GOLD,
                  cursor: "pointer",
                  opacity: !!numBusy || !existingNum.trim() ? 0.6 : 1,
                }}
              >
                {numBusy === "reg" ? "Registering…" : "Register"}
              </button>
            </div>

            {numMsg && (
              <div
                className="mt-3 text-[12.5px]"
                style={{
                  color: numMsg.ok ? "#2E7D5B" : "#B85B4D",
                }}
              >
                {numMsg.text}
              </div>
            )}
          </div>
        </div>
      </div>

      {configured && (
        <div
          className="mt-6 rounded-xl border bg-white p-4 sm:p-6"
          style={{
            borderColor: LINE,
            boxShadow: "0 4px 20px rgba(90,75,55,0.05)",
          }}
        >
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex-1">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#E8F5EE]">
                  ✉️
                </div>

                <div>
                  <h2
                    className="m-0 text-[16px] font-bold"
                    style={{ color: "#5A4B37" }}
                  >
                    Send a Test Message
                  </h2>

                  <p
                    className="mt-1 text-[12.5px]"
                    style={{ color: "#9B8B78" }}
                  >
                    Verify that this Twilio configuration is working correctly.
                  </p>
                </div>
              </div>

              <div className="max-w-xl">
                <div style={LABEL}>Send To (E.164)</div>

                <input
                  style={{ ...INPUT, width: "100%" }}
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                  placeholder="+18565550000"
                  disabled={testing}
                />
              </div>
            </div>

            <div className="flex flex-col gap-3 lg:items-end">
              <button
                onClick={runTest}
                disabled={testing || !testTo.trim()}
                className="h-[40px] w-full rounded-[9px] px-6 font-bold sm:w-auto"
                style={{
                  border: `1px solid ${GOLD}`,
                  background: "transparent",
                  color: GOLD,
                  cursor: "pointer",
                  opacity: testing || !testTo.trim() ? 0.6 : 1,
                }}
              >
                {testing ? "Sending…" : "Send Test SMS"}
              </button>

              {testMsg && (
                <div
                  className="text-[12.5px]"
                  style={{
                    color: testMsg.ok ? "#2E7D5B" : "#B85B4D",
                  }}
                >
                  {testMsg.text}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
