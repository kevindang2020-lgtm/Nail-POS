// TenantA2pScreen.tsx — Super Admin drives a salon's A2P 10DLC registration under the ISV account: collect the salon's
// TrustHub bundle SIDs + campaign content, submit Brand → Campaign → attach number, and poll status (TCR campaign
// review is ~10–15 business days). Honest: if the ISV Twilio account isn't configured, the actions report it. Supports
// Mock mode for fee-free dry runs.
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { superAdminAiApi } from "../api/superAdminAiApi";
import { superAdminApi } from "../api/superAdminApi";
import { FiHome } from "react-icons/fi";
import {
  FiUser,
  FiSave,
  FiPlusCircle,
  FiFileText,
  FiSend,
  FiRefreshCw,
  FiPhone,
  FiCheckCircle,
  FiAlertCircle,
} from "react-icons/fi";

const STEPS = [
  "not_started",
  "brand_submitted",
  "brand_approved",
  "campaign_submitted",
  "campaign_approved",
  "number_attached",
  "live",
];
const stepLabel: Record<string, string> = {
  not_started: "Not started",
  brand_submitted: "Brand submitted",
  brand_approved: "Brand approved",
  campaign_submitted: "Campaign submitted",
  campaign_approved: "Campaign approved",
  number_attached: "Number attached",
  live: "Live",
  failed: "Failed",
};

export default function TenantA2pScreen() {
  const { tenantId: paramTid } = useParams();
  const [tenantList, setTenantList] = useState<
    { id: string; name: string; code?: string }[]
  >([]);
  const [tenantId, setTenantId] = useState(paramTid || "");
  const [reg, setReg] = useState<any>(null);
  const [f, setF] = useState<any>({
    brandType: "STANDARD",
    isMock: true,
    campaignUsecase: "MIXED",
  });
  const [pnSid, setPnSid] = useState("");
  const [bi, setBi] = useState<any>({});
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (paramTid) return;
    superAdminApi
      .state({ page: 1, pageSize: 200 } as any)
      .then((r: any) => {
        const l = (r?.tenants || []).map((t: any) => ({
          id: t.id,
          name: t.n || t.displayName || t.name || t.legalName || t.code || t.id,
          code: t.code,
        }));
        setTenantList(l);
        if (l[0]) setTenantId((cur) => cur || l[0].id);
      })
      .catch(() => setTenantList([]));
  }, [paramTid]);

  const load = (tid: string) =>
    superAdminAiApi
      .a2pGet(tid)
      .then((r) => {
        setReg(r);
        if (r.businessInfo) setBi(r.businessInfo);
        setF((prev: any) => ({
          ...prev,
          customerProfileBundleSid: r.inputs?.customerProfileBundleSid || "",
          a2pProfileBundleSid: r.inputs?.a2pProfileBundleSid || "",
          brandType: r.inputs?.brandType || "STANDARD",
          campaignUsecase: r.inputs?.campaignUsecase || "MIXED",
          isMock: r.isMock,
        }));
      })
      .catch(() => setReg(null));
  useEffect(() => {
    if (tenantId) load(tenantId);
  }, [tenantId]);

  const run = async (label: string, fn: () => Promise<any>) => {
    setBusy(label);
    setMsg(null);
    try {
      const r = await fn();
      setReg(r);
      if (r?.lastError) setMsg({ ok: false, text: r.lastError });
      else setMsg({ ok: true, text: `${label} done.` });
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || "Request failed." });
    } finally {
      setBusy("");
    }
  };
  const save = () =>
    run("Saved inputs", () =>
      superAdminAiApi.a2pSaveInputs(tenantId, {
        customerProfileBundleSid: f.customerProfileBundleSid,
        a2pProfileBundleSid: f.a2pProfileBundleSid,
        brandType: f.brandType,
        isMock: !!f.isMock,
        campaignUsecase: f.campaignUsecase,
        campaignDescription: f.campaignDescription,
        messageSamples: (f.messageSamples || "")
          .split("\n")
          .map((s: string) => s.trim())
          .filter(Boolean),
        messageFlow: f.messageFlow,
        optInMessage: f.optInMessage,
        optOutMessage: f.optOutMessage,
        helpMessage: f.helpMessage,
        privacyPolicyUrl: f.privacyPolicyUrl,
        termsAndConditionsUrl: f.termsAndConditionsUrl,
        hasEmbeddedLinks: !!f.hasEmbeddedLinks,
        hasEmbeddedPhone: !!f.hasEmbeddedPhone,
      }),
    );

  const idx = reg ? STEPS.indexOf(reg.status) : 0;
  return (
    <div className="w-full p-5">
      <div className="mb-3">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              

              <div>
                <h1 className="font-serif text-[26px] font-medium text-[#2F2418] ">
                  A2P 10DLC Registration
                </h1>

                <p className="mt-1 text-sm text-[#7A6C57]">
                  Configure and manage A2P registration for this salon.
                </p>
              </div>
            </div>

            <p className="mt-4 max-w-4xl text-sm leading-6 text-[#7A6C57]">
              Register this salon under your ISV Twilio account. Complete the
              business profile, create the required TrustHub profiles, configure
              campaign details, and submit the Brand and Campaign for approval.
            </p>
          </div>
        </div>
      </div>

      {!paramTid && (
        <div className="mb-6 rounded-2xl border border-[#E8DDCB] bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <FiHome className="text-[#B8862D]" size={18} />

            <h2 className="font-semibold text-[#3D3022]">Select Salon</h2>
          </div>

          <div className="max-w-xl">
            <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-[#7A6C57]">
              Tenant
            </label>

            <select
              className="h-11 w-full rounded-xl border border-[#DED3C3] bg-white px-4 text-sm text-[#3D3022] outline-none transition focus:border-[#B8862D] focus:ring-2 focus:ring-[#B8862D]/20"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
            >
              {tenantList.length === 0 && <option value="">Loading salons…</option>}

              {tenantList.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}{t.code && t.code !== t.name ? ` (${t.code})` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {reg && (
        <div className="mb-6 rounded-2xl border border-[#E8DDCB] bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#B8862D]/10 text-[#B8862D]">
                <FiCheckCircle size={20} />
              </div>

              <div>
                <h3 className="font-semibold text-[#3D3022]">
                  Registration Progress
                </h3>

                <p className="text-xs text-[#7A6C57]">
                  Track your A2P registration process.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {STEPS.map((s, i) => (
                <span
                  key={s}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    i <= idx
                      ? "bg-[#B8862D] text-white"
                      : "bg-[#F3EBDD] text-[#9B8B78]"
                  }`}
                >
                  {stepLabel[s]}
                </span>
              ))}

              {reg.status === "failed" && (
                <span className="flex items-center gap-1 rounded-full bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600">
                  <FiAlertCircle />
                  Failed
                </span>
              )}

              {!reg.configured && (
                <span className="rounded-full bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600">
                  ISV Twilio account not configured
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-[#E8DDCB] bg-white shadow-sm">
          <div className="flex items-center gap-3 border-b border-[#F0E8DC] px-5 py-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#B8862D]/10 text-[#B8862D]">
              <FiHome size={19} />
            </div>

            <div>
              <h2 className="font-semibold text-[#3D3022]">Business Profile</h2>

              <p className="text-xs text-[#9B8B78]">
                TrustHub business information
              </p>
            </div>
          </div>

          <div className="p-5">
            <p className="mb-6 text-sm leading-6 text-[#7A6C57]">
              Automate the salon's Secondary Customer Profile and A2P profile
              bundle. Required TrustHub information will be created using your
              configured ISV account.
            </p>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="md:col-span-2">
                <label className="mb-2 block text-xs font-bold text-[#6F604E]">
                  Legal Business Name
                </label>

                <input
                  className="h-11 w-full rounded-xl border border-[#DED3C3] px-4 text-sm outline-none transition focus:border-[#B8862D] focus:ring-2 focus:ring-[#B8862D]/20"
                  value={bi.businessName || ""}
                  onChange={(e) =>
                    setBi({ ...bi, businessName: e.target.value })
                  }
                  placeholder="Nails Co LLC"
                />
              </div>

              <div>
                <label className="mb-2 block text-xs font-bold text-[#6F604E]">
                  EIN / Tax ID
                </label>

                <input
                  className="h-11 w-full rounded-xl border border-[#DED3C3] px-4 text-sm outline-none transition focus:border-[#B8862D] focus:ring-2 focus:ring-[#B8862D]/20"
                  value={bi.einTaxId || ""}
                  onChange={(e) => setBi({ ...bi, einTaxId: e.target.value })}
                  placeholder="12-3456789"
                />
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-xs font-bold text-[#6F604E]">
                  Website
                </label>

                <input
                  className="h-11 w-full rounded-xl border border-[#DED3C3] px-4 text-sm outline-none transition focus:border-[#B8862D] focus:ring-2 focus:ring-[#B8862D]/20"
                  value={bi.websiteUrl || ""}
                  onChange={(e) => setBi({ ...bi, websiteUrl: e.target.value })}
                  placeholder="https://salon.com"
                />
              </div>

              <div>
                <label className="mb-2 block text-xs font-bold text-[#6F604E]">
                  Industry
                </label>

                <input
                  className="h-11 w-full rounded-xl border border-[#DED3C3] px-4 text-sm outline-none transition focus:border-[#B8862D] focus:ring-2 focus:ring-[#B8862D]/20"
                  value={bi.businessIndustry || ""}
                  onChange={(e) =>
                    setBi({ ...bi, businessIndustry: e.target.value })
                  }
                  placeholder="PROFESSIONAL_SERVICES"
                />
              </div>
            </div>

            <div className="mt-4">
              <label className="mb-2 block text-xs font-bold text-[#6F604E]">
                Street Address
              </label>

              <input
                className="h-11 w-full rounded-xl border border-[#DED3C3] px-4 text-sm outline-none transition focus:border-[#B8862D] focus:ring-2 focus:ring-[#B8862D]/20"
                value={bi.street || ""}
                onChange={(e) => setBi({ ...bi, street: e.target.value })}
                placeholder="1 Main St"
              />
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div>
                <label className="mb-2 block text-xs font-bold text-[#6F604E]">
                  City
                </label>

                <input
                  className="h-11 w-full rounded-xl border border-[#DED3C3] px-4 text-sm"
                  value={bi.city || ""}
                  onChange={(e) => setBi({ ...bi, city: e.target.value })}
                />
              </div>

              <div>
                <label className="mb-2 block text-xs font-bold text-[#6F604E]">
                  State
                </label>

                <input
                  className="h-11 w-full rounded-xl border border-[#DED3C3] px-4 text-sm"
                  value={bi.region || ""}
                  onChange={(e) => setBi({ ...bi, region: e.target.value })}
                  placeholder="NJ"
                />
              </div>

              <div>
                <label className="mb-2 block text-xs font-bold text-[#6F604E]">
                  ZIP
                </label>

                <input
                  className="h-11 w-full rounded-xl border border-[#DED3C3] px-4 text-sm"
                  value={bi.postalCode || ""}
                  onChange={(e) => setBi({ ...bi, postalCode: e.target.value })}
                />
              </div>

              <div>
                <label className="mb-2 block text-xs font-bold text-[#6F604E]">
                  Country
                </label>

                <input
                  className="h-11 w-full rounded-xl border border-[#DED3C3] px-4 text-sm"
                  value={bi.isoCountry || ""}
                  onChange={(e) => setBi({ ...bi, isoCountry: e.target.value })}
                  placeholder="US"
                />
              </div>
            </div>

            <div className="mt-6 border-t border-[#F0E8DC] pt-5">
              <div className="mb-4 flex items-center gap-2">
                <FiUser className="text-[#B8862D]" />

                <h3 className="font-semibold text-[#4A3A29]">
                  Authorized Representative
                </h3>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <input
                  className="h-11 rounded-xl border border-[#DED3C3] px-4 text-sm"
                  value={bi.repFirstName || ""}
                  onChange={(e) =>
                    setBi({ ...bi, repFirstName: e.target.value })
                  }
                  placeholder="First name"
                />

                <input
                  className="h-11 rounded-xl border border-[#DED3C3] px-4 text-sm"
                  value={bi.repLastName || ""}
                  onChange={(e) =>
                    setBi({ ...bi, repLastName: e.target.value })
                  }
                  placeholder="Last name"
                />

                <input
                  className="h-11 rounded-xl border border-[#DED3C3] px-4 text-sm"
                  value={bi.repEmail || ""}
                  onChange={(e) => setBi({ ...bi, repEmail: e.target.value })}
                  placeholder="Email"
                />

                <input
                  className="h-11 rounded-xl border border-[#DED3C3] px-4 text-sm"
                  value={bi.repPhone || ""}
                  onChange={(e) => setBi({ ...bi, repPhone: e.target.value })}
                  placeholder="+18565551234"
                />
              </div>
            </div>

            <div className="mt-5 rounded-xl bg-[#FAF7F1] p-4 text-sm text-[#7A6C57]">
              <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
                <span>
                  Secondary Profile:
                  <b className="ml-1 text-[#3D3022]">
                    {reg?.secondaryProfileStatus || "—"}
                  </b>
                </span>

                <span>
                  A2P Profile:
                  <b className="ml-1 text-[#3D3022]">
                    {reg?.a2pProfileStatus || "—"}
                  </b>
                </span>
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <button
                disabled={!!busy || !tenantId}
                onClick={() =>
                  run("Business info saved", () =>
                    superAdminAiApi.a2pSaveBusinessInfo(tenantId, bi),
                  )
                }
                className="flex h-11 items-center justify-center gap-2 rounded-xl border border-[#B8862D] px-5 text-sm font-semibold text-[#B8862D] transition hover:bg-[#B8862D]/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FiSave />
                Save Business Info
              </button>

              <button
                disabled={!!busy || !tenantId}
                onClick={() =>
                  run("Secondary profile created", () =>
                    superAdminAiApi.a2pProvisionProfile(tenantId),
                  )
                }
                className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[#B8862D] px-5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FiPlusCircle />
                Create Secondary Profile
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-[#E8DDCB] bg-white shadow-sm">
          <div className="flex items-center gap-3 border-b border-[#F0E8DC] px-5 py-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#B8862D]/10 text-[#B8862D]">
              <FiFileText size={19} />
            </div>

            <div>
              <h2 className="font-semibold text-[#3D3022]">Campaign Inputs</h2>

              <p className="text-xs text-[#9B8B78]">
                Brand and campaign configuration
              </p>
            </div>
          </div>

          <div className="space-y-5 p-5">
            <div>
              <label className="mb-2 block text-xs font-bold text-[#6F604E]">
                Secondary Customer Profile Bundle SID
              </label>

              <input
                className="h-11 w-full rounded-xl border border-[#DED3C3] px-4 text-sm"
                value={f.customerProfileBundleSid || ""}
                onChange={(e) =>
                  setF({
                    ...f,
                    customerProfileBundleSid: e.target.value,
                  })
                }
                placeholder="BU…"
              />
            </div>

            <div>
              <label className="mb-2 block text-xs font-bold text-[#6F604E]">
                A2P Profile Bundle SID
              </label>

              <input
                className="h-11 w-full rounded-xl border border-[#DED3C3] px-4 text-sm"
                value={f.a2pProfileBundleSid || ""}
                onChange={(e) =>
                  setF({
                    ...f,
                    a2pProfileBundleSid: e.target.value,
                  })
                }
                placeholder="BU…"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-xs font-bold text-[#6F604E]">
                  Brand Type
                </label>

                <select
                  className="h-11 w-full rounded-xl border border-[#DED3C3] px-4 text-sm"
                  value={f.brandType}
                  onChange={(e) =>
                    setF({
                      ...f,
                      brandType: e.target.value,
                    })
                  }
                >
                  <option>STANDARD</option>
                  <option>SOLE_PROPRIETOR</option>
                </select>
              </div>

              <div>
                <label className="mb-2 block text-xs font-bold text-[#6F604E]">
                  Use Case
                </label>

                <input
                  className="h-11 w-full rounded-xl border border-[#DED3C3] px-4 text-sm"
                  value={f.campaignUsecase || ""}
                  onChange={(e) =>
                    setF({
                      ...f,
                      campaignUsecase: e.target.value,
                    })
                  }
                  placeholder="MIXED"
                />
              </div>
            </div>

            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-[#E8DDCB] bg-[#FAF7F1] p-4">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[#B8862D]"
                checked={!!f.isMock}
                onChange={(e) =>
                  setF({
                    ...f,
                    isMock: e.target.checked,
                  })
                }
              />

              <div>
                <div className="text-sm font-semibold text-[#3D3022]">
                  Mock Mode
                </div>

                <div className="text-xs text-[#9B8B78]">
                  Dry run without fees.
                </div>
              </div>
            </label>

            <div>
              <label className="mb-2 block text-xs font-bold text-[#6F604E]">
                Campaign Description
              </label>

              <textarea
                className="min-h-[100px] w-full resize-y rounded-xl border border-[#DED3C3] p-4 text-sm"
                value={f.campaignDescription || ""}
                onChange={(e) =>
                  setF({
                    ...f,
                    campaignDescription: e.target.value,
                  })
                }
                placeholder="Appointment reminders and promotions for salon customers"
              />
            </div>

            <div>
              <label className="mb-2 block text-xs font-bold text-[#6F604E]">
                Sample Messages
              </label>

              <textarea
                className="min-h-[120px] w-full resize-y rounded-xl border border-[#DED3C3] p-4 text-sm"
                value={f.messageSamples || ""}
                onChange={(e) =>
                  setF({
                    ...f,
                    messageSamples: e.target.value,
                  })
                }
                placeholder={
                  "Reminder: your appt is tomorrow at 2pm. Reply STOP to opt out.\nThanks for visiting! 15% off next visit. Reply STOP to opt out."
                }
              />
            </div>

            <div>
              <label className="mb-2 block text-xs font-bold text-[#6F604E]">
                Message Flow
              </label>

              <textarea
                className="min-h-[120px] w-full resize-y rounded-xl border border-[#DED3C3] p-4 text-sm"
                value={f.messageFlow || ""}
                onChange={(e) =>
                  setF({
                    ...f,
                    messageFlow: e.target.value,
                  })
                }
                placeholder="Customers opt in by checking the SMS box at checkout."
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-xs font-bold text-[#6F604E]">
                  Privacy Policy URL
                </label>

                <input
                  className="h-11 w-full rounded-xl border border-[#DED3C3] px-4 text-sm"
                  value={f.privacyPolicyUrl || ""}
                  onChange={(e) =>
                    setF({
                      ...f,
                      privacyPolicyUrl: e.target.value,
                    })
                  }
                  placeholder="https://…/privacy"
                />
              </div>

              <div>
                <label className="mb-2 block text-xs font-bold text-[#6F604E]">
                  Terms URL
                </label>

                <input
                  className="h-11 w-full rounded-xl border border-[#DED3C3] px-4 text-sm"
                  value={f.termsAndConditionsUrl || ""}
                  onChange={(e) =>
                    setF({
                      ...f,
                      termsAndConditionsUrl: e.target.value,
                    })
                  }
                  placeholder="https://…/terms"
                />
              </div>
            </div>

            <button
              disabled={!!busy || !tenantId}
              onClick={save}
              className="flex h-11 items-center justify-center gap-2 rounded-xl border border-[#B8862D] px-6 text-sm font-semibold text-[#B8862D] transition hover:bg-[#B8862D]/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FiSave />

              {busy === "Saved inputs" ? "Saving…" : "Save Inputs"}
            </button>
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-[#E8DDCB] pb-7 bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-[#F0E8DC] px-5 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#B8862D]/10 text-[#B8862D]">
            <FiSend size={19} />
          </div>

          <div>
            <h2 className="font-semibold text-[#3D3022]">
              Submit & Track Registration
            </h2>

            <p className="text-xs text-[#9B8B78]">
              Submit your Brand and Campaign for approval
            </p>
          </div>
        </div>

        <div className="p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <button
              disabled={!!busy}
              onClick={() =>
                run("Brand submitted", () =>
                  superAdminAiApi.a2pSubmitBrand(tenantId),
                )
              }
              className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[#B8862D] px-5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FiSend />
              Submit Brand
            </button>

            <button
              disabled={!!busy}
              onClick={() =>
                run("Campaign submitted", () =>
                  superAdminAiApi.a2pSubmitCampaign(tenantId),
                )
              }
              className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[#B8862D] px-5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FiSend />
              Submit Campaign
            </button>

            <button
              disabled={!!busy}
              onClick={() =>
                run("Status refreshed", () =>
                  superAdminAiApi.a2pRefresh(tenantId),
                )
              }
              className="flex h-11 items-center justify-center gap-2 rounded-xl border border-[#B8862D] px-5 text-sm font-semibold text-[#B8862D] transition hover:bg-[#B8862D]/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FiRefreshCw />
              Refresh Status
            </button>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 rounded-xl bg-[#FAF7F1] p-5 md:grid-cols-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-[#9B8B78]">
                Brand
              </div>

              <div className="mt-1 font-semibold text-[#3D3022]">
                {reg?.brandStatus || "—"}
              </div>

              {reg?.brandSid && (
                <div className="mt-1 break-all text-xs text-[#9B8B78]">
                  {reg.brandSid}
                </div>
              )}
            </div>

            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-[#9B8B78]">
                Campaign
              </div>

              <div className="mt-1 font-semibold text-[#3D3022]">
                {reg?.campaignStatus || "—"}
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-[#9B8B78]">
                Messaging Service
              </div>

              <div className="mt-1 break-all font-semibold text-[#3D3022]">
                {reg?.messagingServiceSid || "—"}
              </div>
            </div>
          </div>

          <div className="mt-6 border-t border-[#F0E8DC] pt-5">
            <div className="mb-4 flex items-center gap-2">
              <FiPhone className="text-[#B8862D]" />

              <h3 className="font-semibold text-[#3D3022]">
                Attach Phone Number
              </h3>
            </div>

            <div className="flex flex-col gap-3 md:flex-row">
              <input
                className="min-h-11 flex-1 rounded-xl border border-[#DED3C3] px-4 text-sm"
                value={pnSid}
                onChange={(e) => setPnSid(e.target.value)}
                placeholder="Phone Number SID (PN…)"
              />

              <button
                disabled={!!busy || !pnSid.trim()}
                onClick={() =>
                  run("Number attached", () =>
                    superAdminAiApi.a2pAttachNumber(tenantId, pnSid.trim()),
                  )
                }
                className="flex h-11 items-center justify-center gap-2 rounded-xl border border-[#B8862D] px-6 text-sm font-semibold text-[#B8862D] transition hover:bg-[#B8862D]/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FiPhone />
                Attach Number
              </button>
            </div>
          </div>

          {msg && (
            <div
              className={`mt-5 flex items-center gap-2 rounded-xl p-4 text-sm font-medium ${
                msg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
              }`}
            >
              {msg.ok ? <FiCheckCircle /> : <FiAlertCircle />}

              {msg.text}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
