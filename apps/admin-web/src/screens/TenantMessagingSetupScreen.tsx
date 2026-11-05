// TenantMessagingSetupScreen.tsx — Super Admin → configure a tenant's own Twilio account (Account SID, Auth Token, From
// number). The auth token is write-only: it's shown only as a masked last-4 hint after saving and is never returned by
// the API. Saving also registers the from number so inbound routing + per-tenant sending line up.
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  superAdminAiApi,
  type AdminTenantMessagingCreds,
} from "../api/superAdminAiApi";
import { superAdminApi } from "../api/superAdminApi";
import { MdOutlineLock } from "react-icons/md";
import { LuPhoneCall } from "react-icons/lu";
const GOLD = "var(--g7,#A96F22)";
const LINE = "var(--line,#E7DBC6)";
const CARD: React.CSSProperties = {
  background: "var(--card,#fff)",
  border: `1px solid ${LINE}`,
  borderRadius: 12,
  padding: 16,
  maxWidth: 520,
};
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
  const buyNumber = async (pn: string) => {
    setNumBusy(pn);
    setNumMsg(null);
    try {
      const r = await superAdminAiApi.numberBuy(tenantId, pn);
      if (r.ok) {
        setNumMsg({
          ok: true,
          text: `Bought ${r.number} — sending, inbound, and receipts now use it.`,
        });
        setAvail([]);
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
        if (!tenantId && list[0]) setTenantId(list[0].id);
      })
      .catch(() => setTenantList([]));
  }, [paramTenantId]);

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
  }, [tenantId]);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const updated = await superAdminAiApi.setTenantMessagingCreds(tenantId, {
        accountSid: accountSid.trim(),
        authToken: authToken.trim() || undefined,
        fromNumber: fromNumber.trim(),
      });
      setCreds(updated);
      setAuthToken("");
      setMsg({
        ok: true,
        text: "Saved. This salon now sends from its own Twilio account.",
      });
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || "Could not save credentials." });
    } finally {
      setSaving(false);
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
              onClick={save}
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
                      onClick={() => buyNumber(a.phoneNumber)}
                      className="h-[34px] w-full rounded-lg px-4 text-[12px] font-bold sm:w-auto"
                      style={{
                        border: "none",
                        background: GOLD,
                        color: "#fff",
                        cursor: "pointer",
                      }}
                    >
                      {numBusy === a.phoneNumber ? "Buying…" : "Buy Number"}
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
