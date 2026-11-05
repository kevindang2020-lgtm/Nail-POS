import { useCallback, useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { posSettingsApi } from '../api/posSettingsApi';
import { useStepUp, isStepUpCancelled } from './access/accessUi';
import { posTechniciansApi } from '../api/posTechniciansApi';
import { PaymentGatewayStatusCard } from '../components/PaymentGatewayStatusCard';
import { SalonLogoSetting } from './SalonLogoSetting';
import { t as i18nText } from '@aipowersalon/mobile-sdk/i18n';
import { statusLabel } from '../i18n/status-label';
import { serverText } from '../i18n/server-text';
import { LANGUAGE_LABEL } from '../shell/LanguageSwitch';   // a language's own name is never translated

// POS Settings — reads /pos/settings/state (POSSettingsState). Go-live readiness + per-category status grid, plus
// Nearly all categories are EDITABLE inline, incl. the roles/permissions matrix (read-only only for security,
// subscription, audit) via
// posSettingsApi.updateCategory(<segment>, <partial>): **Tax** (segment 'tax') and **Payments & Tips** (segments
// 'payments-checkout' and 'tips', saved together), and **Queue & Workflow** (segment 'queue-workflow', values loaded
// on demand via getCategory). Patch bodies are partials of the category settings interfaces;
// per-category edit permission is enforced server-side (a 403 surfaces). Other categories stay read-only (each needs
// its own form; the patch endpoints exist for all 16).
type Section = { sectionKey: string; label: string; completionPercent: number; status: string; missingReasons: string[] };
type SettingsState = {
  context: { role: string; permissions: string[] };
  businessBranch: { salonName: string; legalName: string; businessType: string; website?: string; branchName: string; address?: string; city?: string; state?: string; zip?: string; currency: string; timezone: string; multiBranchEnabled: boolean; defaultLanguage?: 'en' | 'vi' };
  paymentsCheckout: { methods: { card: boolean; cash: boolean; giftCard: boolean; split: boolean }; creditCardSurchargeEnabled: boolean; creditCardSurchargePercent: number; cashDiscountEnabled: boolean; customerDisplayMode: string; managerApprovalOverCents: number };
  tips: { defaultTipPercents: number[]; allowCustomTip: boolean; allowNoTip: boolean; maxTipPercent: number; tipBase: string; perTechnicianTips?: boolean };
  tax: { enabled: boolean; taxRatePercent: number; taxLabel: string; mode: string; appliesToServices: boolean; appliesToProducts: boolean };
  notifications: { smsConfirmation: boolean; emailConfirmation: boolean; pushConfirmation: boolean; reminderHours: number[]; receiptDelivery: string[]; senderBrand: string; a2pStatus: string };
  onlineGoogleAiBooking: { onlineBookingEnabled: boolean; tenantSlug: string; googleBookingLink?: string; aiPhoneEnabled: boolean; aiActions: { findAvailability: boolean; create: boolean; reschedule: boolean; cancel: boolean; sendReminder: boolean } };
  sectionStatuses: Section[];
  moduleStatus?: { completionPercent: number; status: string; missingReasons: string[]; goLivePending?: string[] };
};

const money = (c: number) => '$' + ((c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const stTone = (s: string) => (/complete/i.test(s) ? 'ok' : /blocked|not started|needs review/i.test(s) ? 'warn' : '');
const onoff = (b: boolean, label: string) => <span className={'pill ' + (b ? 'ok' : '')} style={!b ? { opacity: .45 } : undefined}>{label}</span>;
const inputStyle: React.CSSProperties = { height: 32, border: '1px solid var(--line)', borderRadius: 8, padding: '0 8px', background: '#FFFDF8', fontFamily: 'inherit', fontSize: 12.5, color: 'var(--text)' };
const ckbx = (checked: boolean, on: (v: boolean) => void, label: string) => (<label className="s" style={{ display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" checked={checked} onChange={(e) => on(e.target.checked)} /> {label}</label>);
const Field = ({ label, value, onChange, w = 120, num = false, max, placeholder }: { label: string; value: any; onChange: (v: string) => void; w?: number; num?: boolean; max?: number; placeholder?: string }) => (
  <label className="s" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{label} <input value={value ?? ''} onChange={(e) => onChange(e.target.value)} inputMode={num ? 'decimal' : undefined} maxLength={max} placeholder={placeholder} style={{ ...inputStyle, width: w }} /></label>
);
const ROLE_COLS = ['OWNER', 'MANAGER', 'FRONT_DESK', 'RECEPTION', 'TECHNICIAN'];

function Bar({ pct }: { pct: number }) {
  return <div style={{ height: 6, background: 'var(--line)', borderRadius: 4, marginTop: 6 }}><div style={{ height: 6, width: `${Math.max(0, Math.min(100, pct))}%`, background: 'var(--gold)', borderRadius: 4 }} /></div>;
}

export function POSSettingsScreen() {
  const [s, setS] = useState<SettingsState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Security Deep Scan C7: payments-checkout, roles-permissions-security and security are step-up routes — a 403
  // STEP_UP_REQUIRED opens the password prompt and the save is retried once; Cancel leaves the setting unchanged, no error.
  const stepUp = useStepUp(i18nText('pos.stepup_settings_needs_password'));
  const [sp] = useSearchParams();
  const nav = useNavigate();
  useEffect(() => {
    const sec = sp.get('section');
    if (!sec || !s) return;
    const el = document.getElementById('sec-' + sec);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); el.style.transition = 'color .2s'; }
  }, [sp, s]);
  const [edit, setEdit] = useState<'tax' | 'pay' | 'queue' | 'logout' | 'biz' | 'booking' | 'notif' | 'loyalty' | 'svc' | 'staff' | 'online' | 'display' | 'receipts' | 'roles' | null>(null);

  // Salon Baseline Technician Commission State
  const [salonCommPct, setSalonCommPct] = useState<number>(50);
  const [salonCommAuthModal, setSalonCommAuthModal] = useState<boolean>(false);
  const [salonCommDraft, setSalonCommDraft] = useState<string>('50');
  const [salonCommAuthCode, setSalonCommAuthCode] = useState<string>('');
  const [salonCommErr, setSalonCommErr] = useState<string | null>(null);

  useEffect(() => {
    posTechniciansApi.getSalonBaselineCommission().then((r) => {
      if (r?.defaultCommissionPercent != null) {
        setSalonCommPct(r.defaultCommissionPercent);
        setSalonCommDraft(String(r.defaultCommissionPercent));
      }
    }).catch(() => {});
  }, []);

  const handleSaveSalonComm = async () => {
    setSalonCommErr(null);
    setBusy('salonComm');
    try {
      const res = await posTechniciansApi.updateSalonBaselineCommission({
        defaultCommissionPercent: Number(salonCommDraft),
        adminAuthCode: salonCommAuthCode,
      });
      if (res?.defaultCommissionPercent != null) {
        setSalonCommPct(res.defaultCommissionPercent);
        setSalonCommAuthModal(false);
        setSalonCommAuthCode('');
        setNote(i18nText('pos.salon_baseline_commission_updated_successfully'));
      }
    } catch (e: any) {
      setSalonCommErr(e?.message || i18nText('pos.authorization_failed'));
    } finally {
      setBusy(null);
    }
  };

  // tax fields
  const [txEnabled, setTxEnabled] = useState(false); const [txRate, setTxRate] = useState(''); const [txLabel, setTxLabel] = useState(''); const [txMode, setTxMode] = useState('exclusive'); const [txSvc, setTxSvc] = useState(true); const [txProd, setTxProd] = useState(true);
  // payments + tips fields
  const [pCard, setPCard] = useState(true); const [pCash, setPCash] = useState(true); const [pGift, setPGift] = useState(false); const [pSplit, setPSplit] = useState(false);
  const [pSurOn, setPSurOn] = useState(false); const [pSurPct, setPSurPct] = useState(''); const [tipPcts, setTipPcts] = useState(''); const [tipMax, setTipMax] = useState(''); const [tipCustom, setTipCustom] = useState(true); const [tipNo, setTipNo] = useState(true); const [tipPerTech, setTipPerTech] = useState(false);   // G4 Split Tips
  // queue & workflow fields
  // BUILD_PLAN Phase 6: the "auto-assign" and "assign by" toggles are RETIRED — they were two of three auto-assign
  // switches nothing read (audit "parallel implementations" 3). Auto-assignment and turn rotation live in AI Queue
  // Assignment (the ONE settings source); this section links there instead.
  const [qAvgMin, setQAvgMin] = useState('30');
  const [qShowWait, setQShowWait] = useState(true); const [qAutoFlow, setQAutoFlow] = useState(true); const [qManualApproval, setQManualApproval] = useState(false);
  const [qAllowReopen, setQAllowReopen] = useState(true); const [qVip, setQVip] = useState(true); const [qApptOver, setQApptOver] = useState(true);
  // store-hours / auto-logout fields (auto-logout subset; store hours map left untouched via partial patch)
  const [lgEnabled, setLgEnabled] = useState(false); const [lgGrace, setLgGrace] = useState('5'); const [lgExt, setLgExt] = useState('0'); const [lgWarn, setLgWarn] = useState('');
  // object-form state for the batch-editable categories (loaded on demand via getCategory; saved as partial PATCH)
  const [bizF, setBizF] = useState<Record<string, any>>({});
  const [bookF, setBookF] = useState<Record<string, any>>({});
  const [notifF, setNotifF] = useState<Record<string, any>>({});
  const [loyF, setLoyF] = useState<Record<string, any>>({});
  const [svcF, setSvcF] = useState<Record<string, any>>({});
  const [staffF, setStaffF] = useState<Record<string, any>>({});
  const [onlineF, setOnlineF] = useState<Record<string, any>>({});
  const [dispF, setDispF] = useState<Record<string, any>>({});
  const [rcptF, setRcptF] = useState<Record<string, any>>({});
  const [matF, setMatF] = useState<{ permission: string; roles: string[] }[]>([]);
  const num = (v: any, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const csvNums = (v: any) => String(v ?? '').split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => Number.isFinite(n));
  const csvStrs = (v: any) => String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean);

  const load = useCallback(() => (posSettingsApi.getState() as Promise<SettingsState>)
    .then((d) => setS(d))
    .catch((e: any) => setError(e?.message || i18nText('pos.failed_to_load_settings'))), []);

  useEffect(() => { load(); }, [load]);

  const openTax = () => {
    if (edit === 'tax') { setEdit(null); return; }
    const t = s!.tax; setEdit('tax'); setNote(null);
    setTxEnabled(t.enabled); setTxRate(String(t.taxRatePercent)); setTxLabel(t.taxLabel || ''); setTxMode(t.mode || 'exclusive'); setTxSvc(!!t.appliesToServices); setTxProd(!!t.appliesToProducts);
  };
  const openPay = () => {
    if (edit === 'pay') { setEdit(null); return; }
    const p = s!.paymentsCheckout; const tp = s!.tips; setEdit('pay'); setNote(null);
    setPCard(p.methods.card); setPCash(p.methods.cash); setPGift(p.methods.giftCard); setPSplit(p.methods.split);
    setPSurOn(p.creditCardSurchargeEnabled); setPSurPct(String(p.creditCardSurchargePercent));
    setTipPcts(tp.defaultTipPercents.join(',')); setTipMax(String(tp.maxTipPercent)); setTipCustom(tp.allowCustomTip); setTipNo(tp.allowNoTip); setTipPerTech(!!tp.perTechnicianTips);
  };

  const saveTax = async () => {
    const rate = Number(txRate); if (!Number.isFinite(rate) || rate < 0) { setNote(i18nText('pos.tax_rate_must_be_a_non_vjqr')); return; }
    setNote(null); setBusy('tax');
    try { await posSettingsApi.updateCategory('tax', { enabled: txEnabled, taxRatePercent: rate, taxLabel: txLabel.trim(), mode: txMode, appliesToServices: txSvc, appliesToProducts: txProd }); setEdit(null); await load(); }
    catch (e: any) { setNote(e?.message || i18nText('pos.save_failed')); }
    finally { setBusy(null); }
  };
  const savePay = async () => {
    const pcts = tipPcts.split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => Number.isFinite(n) && n >= 0);
    const sur = Number(pSurPct); if (pSurOn && (!Number.isFinite(sur) || sur < 0 || sur > 3)) { setNote(i18nText('pos.surcharge_must_be_between_0_and_1hqn')); return; }
    const max = Number(tipMax); if (!Number.isFinite(max) || max < 0) { setNote(i18nText('pos.max_tip_must_be_a_non_17gh')); return; }
    setNote(null); setBusy('pay');
    try {
      await stepUp.run(() => posSettingsApi.updateCategory('payments-checkout', { methods: { card: pCard, cash: pCash, giftCard: pGift, split: pSplit }, creditCardSurchargeEnabled: pSurOn, creditCardSurchargePercent: sur }));
      await posSettingsApi.updateCategory('tips', { defaultTipPercents: pcts, maxTipPercent: max, allowCustomTip: tipCustom, allowNoTip: tipNo, perTechnicianTips: tipPerTech });
      setEdit(null); await load();
    } catch (e: any) { if (!isStepUpCancelled(e)) setNote(e?.message || i18nText('pos.save_failed')); }
    finally { setBusy(null); }
  };

  const openQueue = async () => {
    if (edit === 'queue') { setEdit(null); return; }
    setNote(null);
    try {
      const q = await posSettingsApi.getCategory('queue-workflow') as any;
      setQAvgMin(String(q.avgServiceMinutes ?? 30));
      setQShowWait(!!q.showWaitToGuest); setQAutoFlow(!!q.autoFlowToCheckout); setQManualApproval(!!q.manualApprovalBeforeCheckout);
      setQAllowReopen(!!q.allowReopenService); setQVip(!!q.vipPriority); setQApptOver(!!q.appointmentOverWalkIn);
      setEdit('queue');
    } catch (e: any) { setNote(e?.message || i18nText('pos.could_not_load_queue_settings')); }
  };
  const saveQueue = async () => {
    const avg = Number(qAvgMin); if (!Number.isFinite(avg) || avg <= 0) { setNote(i18nText('pos.average_service_minutes_must_be_a_1reu')); return; }
    setNote(null); setBusy('queue');
    try {
      await posSettingsApi.updateCategory('queue-workflow', { avgServiceMinutes: avg, showWaitToGuest: qShowWait, autoFlowToCheckout: qAutoFlow, manualApprovalBeforeCheckout: qManualApproval, allowReopenService: qAllowReopen, vipPriority: qVip, appointmentOverWalkIn: qApptOver });
      setEdit(null); await load(); setNote(i18nText('pos.queue_workflow_saved'));
    } catch (e: any) { setNote(e?.message || i18nText('pos.save_failed')); }
    finally { setBusy(null); }
  };

  const openLogout = async () => {
    if (edit === 'logout') { setEdit(null); return; }
    setNote(null);
    try {
      const q = await posSettingsApi.getCategory('store-hours-auto-logout') as any;
      setLgEnabled(!!q.autoLogoutEnabled); setLgGrace(String(q.gracePeriodMinutes ?? 5)); setLgExt(String(q.afterCloseExtensionMinutes ?? 0)); setLgWarn((q.warningMinutes || []).join(','));
      setEdit('logout');
    } catch (e: any) { setNote(e?.message || i18nText('pos.could_not_load_auto_logout_settings')); }
  };
  const saveLogout = async () => {
    const grace = Number(lgGrace); const ext = Number(lgExt);
    if (!Number.isFinite(grace) || grace < 0) { setNote(i18nText('pos.grace_minutes_must_be_a_non_1woa')); return; }
    if (!Number.isFinite(ext) || ext < 0) { setNote(i18nText('pos.after_close_extension_must_be_a_8mqb')); return; }
    const warn = lgWarn.split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => Number.isFinite(n) && n > 0);
    setNote(null); setBusy('logout');
    try {
      await posSettingsApi.updateCategory('store-hours-auto-logout', { autoLogoutEnabled: lgEnabled, gracePeriodMinutes: grace, afterCloseExtensionMinutes: ext, warningMinutes: warn });
      setEdit(null); await load(); setNote(i18nText('pos.auto_logout_saved'));
    } catch (e: any) { setNote(e?.message || i18nText('pos.save_failed')); }
    finally { setBusy(null); }
  };

  const openCat = async (key: string, segment: string, set: (o: any) => void) => {
    if (edit === key) { setEdit(null); return; }
    setNote(null);
    try { set((await posSettingsApi.getCategory(segment)) as any); setEdit(key as any); }
    catch (e: any) { setNote(e?.message || i18nText('pos.could_not_load_settings')); }
  };
  const saveCat = async (key: string, segment: string, patch: Record<string, unknown>) => {
    setNote(null); setBusy(key);
    try { await stepUp.run(() => posSettingsApi.updateCategory(segment, patch)); setEdit(null); await load(); setNote(i18nText('pos.saved_2')); }
    catch (e: any) { if (!isStepUpCancelled(e)) setNote(e?.message || i18nText('pos.save_failed')); }
    finally { setBusy(null); }
  };
  const setBF = (k: string, v: any) => setBizF((p) => ({ ...p, [k]: v }));
  const setKF = (k: string, v: any) => setBookF((p) => ({ ...p, [k]: v }));
  const setNF2 = (k: string, v: any) => setNotifF((p) => ({ ...p, [k]: v }));
  const setLF = (k: string, v: any) => setLoyF((p) => ({ ...p, [k]: v }));
  const saveBiz = () => saveCat('biz', 'business-branch', { salonName: bizF.salonName, legalName: bizF.legalName, businessType: bizF.businessType, website: bizF.website, email: bizF.email, phone: bizF.phone, branchName: bizF.branchName, address: bizF.address, city: bizF.city, state: bizF.state, zip: bizF.zip, currency: bizF.currency, timezone: bizF.timezone, dateFormat: bizF.dateFormat, multiBranchEnabled: !!bizF.multiBranchEnabled, perBranchOverrides: !!bizF.perBranchOverrides, defaultLanguage: bizF.defaultLanguage === 'vi' ? 'vi' : 'en' });
  const saveBooking = () => saveCat('booking', 'booking-appointments', { slotIntervalMinutes: num(bookF.slotIntervalMinutes), bufferMinutes: num(bookF.bufferMinutes), cleanupMinutes: num(bookF.cleanupMinutes), defaultDurationMinutes: num(bookF.defaultDurationMinutes), minLeadTimeMinutes: num(bookF.minLeadTimeMinutes), maxAdvanceDays: num(bookF.maxAdvanceDays), cancellationWindowHours: num(bookF.cancellationWindowHours), noShowPolicy: bookF.noShowPolicy, noShowFeeCents: num(bookF.noShowFeeCents), depositRequired: !!bookF.depositRequired, depositPercent: num(bookF.depositPercent), noDoubleBooking: !!bookF.noDoubleBooking, overbookingAllowance: num(bookF.overbookingAllowance), overbookingPolicy: bookF.overbookingPolicy || 'BLOCK' });
  const saveNotif = () => saveCat('notif', 'notifications-reminders', { smsConfirmation: !!notifF.smsConfirmation, emailConfirmation: !!notifF.emailConfirmation, pushConfirmation: !!notifF.pushConfirmation, reminderHours: csvNums(notifF.reminderHours), noShowFollowUp: !!notifF.noShowFollowUp, receiptDelivery: csvStrs(notifF.receiptDelivery), senderBrand: notifF.senderBrand, marketingOptInRequired: !!notifF.marketingOptInRequired });
  const saveLoyalty = () => saveCat('loyalty', 'loyalty-memberships', { earnRatePerDollar: num(loyF.earnRatePerDollar), redemption: loyF.redemption, pointsExpiration: loyF.pointsExpiration, vipSilverCents: num(loyF.vipSilverCents), vipGoldCents: num(loyF.vipGoldCents), vipPlatinumCents: num(loyF.vipPlatinumCents), membershipEnabled: !!loyF.membershipEnabled, memberDiscountPercent: num(loyF.memberDiscountPercent), birthdayReward: !!loyF.birthdayReward, referralReward: !!loyF.referralReward, giftCardsEnabled: !!loyF.giftCardsEnabled });
  const upSv = (k: string, v: any) => setSvcF((p) => ({ ...p, [k]: v }));
  const upSt = (k: string, v: any) => setStaffF((p) => ({ ...p, [k]: v }));
  const upOn = (k: string, v: any) => setOnlineF((p) => ({ ...p, [k]: v }));
  const upOnAi = (k: string, v: any) => setOnlineF((p) => ({ ...p, aiActions: { ...(p.aiActions || {}), [k]: v } }));
  const upDi = (k: string, v: any) => setDispF((p) => ({ ...p, [k]: v }));
  const upRc = (k: string, v: any) => setRcptF((p) => ({ ...p, [k]: v }));
  const saveSvc = () => saveCat('svc', 'services-pricing', { defaultDurationMinutes: num(svcF.defaultDurationMinutes), newServicesTaxable: !!svcF.newServicesTaxable, showOnOnlineBooking: !!svcF.showOnOnlineBooking, allowAiBooking: !!svcF.allowAiBooking, enforceSkillMapping: !!svcF.enforceSkillMapping });
  const saveStaff = () => saveCat('staff', 'technicians-staff', { commissionBasis: staffF.commissionBasis, defaultCommissionPercent: num(staffF.defaultCommissionPercent), payrollPeriod: staffF.payrollPeriod, techCanProcessPayment: !!staffF.techCanProcessPayment, techCanEditServiceLines: !!staffF.techCanEditServiceLines, techCanMarkDone: !!staffF.techCanMarkDone });
  const saveOnline = () => saveCat('online', 'online-google-ai-booking', { onlineBookingEnabled: !!onlineF.onlineBookingEnabled, tenantSlug: onlineF.tenantSlug, googleBookingLink: onlineF.googleBookingLink, aiPhoneEnabled: !!onlineF.aiPhoneEnabled, aiActions: { findAvailability: !!onlineF.aiActions?.findAvailability, create: !!onlineF.aiActions?.create, reschedule: !!onlineF.aiActions?.reschedule, cancel: !!onlineF.aiActions?.cancel, sendReminder: !!onlineF.aiActions?.sendReminder } });
  // displayBranding / tagline / showBranchName / idleMessage: the header and idle footer of the salon's 23-inch customer
  // display (spec §13). Plain text only — the server refuses markup and over-long lines.
  const saveDisp = () => saveCat('display', 'customer-display-devices', { enabled: !!dispF.enabled, displayMode: dispF.displayMode, stationNumber: dispF.stationNumber, idleMessage: String(dispF.idleMessage ?? '').trim(), sessionTimeoutMinutes: num(dispF.sessionTimeoutMinutes), tipPromptEnabled: !!dispF.tipPromptEnabled, receiptPromptEnabled: !!dispF.receiptPromptEnabled, displayBranding: !!dispF.displayBranding, tagline: String(dispF.tagline ?? '').trim(), showBranchName: !!dispF.showBranchName });
  const saveRcpt = () => saveCat('receipts', 'receipts-branding', { showLogo: !!rcptF.showLogo, header: rcptF.header, footer: rcptF.footer, businessAddress: rcptF.businessAddress, thankYouMessage: rcptF.thankYouMessage, showSurchargeLine: !!rcptF.showSurchargeLine, showTechnicianLines: !!rcptF.showTechnicianLines, showServiceNotes: !!rcptF.showServiceNotes, showDiscountLine: !!rcptF.showDiscountLine, showLoyaltyPoints: !!rcptF.showLoyaltyPoints, showTips: !!rcptF.showTips, defaultDelivery: csvStrs(rcptF.defaultDelivery), brandStyle: rcptF.brandStyle });
  const openRoles = async () => {
    if (edit === 'roles') { setEdit(null); return; }
    setNote(null);
    try { const r = (await posSettingsApi.getCategory('roles-permissions-security')) as any; setMatF(Array.isArray(r?.matrix) ? r.matrix.map((e: any) => ({ permission: e.permission, roles: [...(e.roles || [])] })) : []); setEdit('roles'); }
    catch (e: any) { setNote(e?.message || i18nText('pos.could_not_load_roles_permissions')); }
  };
  const toggleRole = (permission: string, role: string) => setMatF((prev) => prev.map((e) => e.permission === permission ? { ...e, roles: e.roles.includes(role) ? e.roles.filter((x) => x !== role) : [...e.roles, role] } : e));
  const saveRoles = () => saveCat('roles', 'roles-permissions-security', { matrix: matF });



  if (error) {
    return (
      <div className="work">
        <div className="err" style={{ marginBottom: 14 }}>{error}</div>
        <div className="panel" style={{ textAlign: 'center', padding: '36px 20px', maxWidth: 540, margin: '30px auto' }}>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 18, marginBottom: 8 }}>{i18nText('pos.salon_store_settings')}</h2>
          <p style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.5, marginBottom: 20 }}>
            {i18nText('pos.salon_wide_configuration_taxes_business_hours_rmx6')}
          </p>
          <button className="btn" style={{ padding: '8px 18px', fontWeight: 700, cursor: 'pointer' }} onClick={() => nav('/tenant/account/overview')}>
            {i18nText('pos.go_to_my_account_overview')}
          </button>
        </div>
      </div>
    );
  }
  if (!s) return <div className="work"><div className="state">{i18nText('pos.loading_settings')}</div></div>;

  const sections = s.sectionStatuses || [];
  const overall = s.moduleStatus?.completionPercent ?? (sections.length ? Math.round(sections.reduce((a, x) => a + x.completionPercent, 0) / sections.length) : 0);
  const overallStatus = s.moduleStatus?.status ?? '';
  const goLivePending = s.moduleStatus?.goLivePending ?? [];
  const bb = s.businessBranch; const pc = s.paymentsCheckout; const tx = s.tax; const nf = s.notifications; const ob = s.onlineGoogleAiBooking;

  return (
    <div className="work">
      <div className="vh">
        <h1>{i18nText('pos.settings')}</h1>
        <div className="sub mb-3">{bb.salonName}{bb.branchName ? ` · ${bb.branchName}` : ''} {i18nText('pos.role')}{' '}{statusLabel('role', s.context.role)}</div>
      </div>

      {stepUp.prompt}
      {note ? <div className="err" style={{ marginBottom: 12 }}>{note}</div> : null}

      <section className="panel mb-3">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <h2 style={{ margin: 0 }}>{i18nText('pos.go_live_readiness')}</h2>
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, marginLeft: 'auto' }}>{overall}%</div>
          {overallStatus ? <span className={'pill ' + stTone(overallStatus)}>{overallStatus}</span> : null}
        </div>
        <Bar pct={overall} />
        {goLivePending.length ? <div className="s" style={{ marginTop: 8 }}>{i18nText('pos.pending_3')}{' '}{goLivePending.join(' · ')}</div> : null}
      </section>

      <section className="panel mb-3">
        <h2>{i18nText('pos.configuration_sections')}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
          {sections.length === 0 ? <div className="muted">{i18nText('pos.no_section_status_reported')}</div> : null}
          {sections.map((sec) => (
            <div key={sec.sectionKey} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12, background: '#FFFDF8' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="t" style={{ fontSize: 13.5 }}>{serverText(sec.label)}</div>
                <span className={'pill ' + stTone(sec.status)} style={{ marginLeft: 'auto' }}>{serverText(sec.status)}</span>
              </div>
              <Bar pct={sec.completionPercent} />
              <div className="s" style={{ marginTop: 4 }}>{sec.completionPercent}{i18nText('pos.complete')}</div>
              {sec.missingReasons?.length ? <ul style={{ margin: '6px 0 0', paddingLeft: 16, fontSize: 11.5, color: 'var(--muted)' }}>{sec.missingReasons.slice(0, 4).map((m, i) => <li key={i}>{m}</li>)}</ul> : null}
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mb-3">
        <section className="panel">
          <div style={{ display: 'flex', alignItems: 'center' }}><h2 id="sec-business-branch" style={{ margin: 0 }}>{i18nText('pos.business_branch')}</h2><button className="btn ghost" style={{ marginLeft: 'auto' }} disabled={busy === 'biz'} onClick={() => openCat('biz', 'business-branch', setBizF)}>{edit === 'biz' ? i18nText('pos.close') : i18nText('pos.edit')}</button></div>
          {edit === 'biz' ? (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Field label={i18nText('pos.salon_2')} value={bizF.salonName} onChange={(v) => setBF('salonName', v)} w={150} /><Field label={i18nText('pos.legal_2')} value={bizF.legalName} onChange={(v) => setBF('legalName', v)} w={150} /><Field label={i18nText('pos.type')} value={bizF.businessType} onChange={(v) => setBF('businessType', v)} w={120} /></div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Field label={i18nText('pos.email')} value={bizF.email} onChange={(v) => setBF('email', v)} w={170} /><Field label={i18nText('pos.phone')} value={bizF.phone} onChange={(v) => setBF('phone', v)} w={130} /><Field label={i18nText('pos.web_2')} value={bizF.website} onChange={(v) => setBF('website', v)} w={170} /></div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Field label={i18nText('pos.branch')} value={bizF.branchName} onChange={(v) => setBF('branchName', v)} w={140} /><Field label={i18nText('pos.addr')} value={bizF.address} onChange={(v) => setBF('address', v)} w={180} /></div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Field label={i18nText('pos.city')} value={bizF.city} onChange={(v) => setBF('city', v)} w={120} /><Field label={i18nText('pos.state')} value={bizF.state} onChange={(v) => setBF('state', v)} w={70} /><Field label={i18nText('pos.zip')} value={bizF.zip} onChange={(v) => setBF('zip', v)} w={90} /></div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Field label={i18nText('pos.currency')} value={bizF.currency} onChange={(v) => setBF('currency', v)} w={80} /><Field label="TZ" value={bizF.timezone} onChange={(v) => setBF('timezone', v)} w={160} /><Field label={i18nText('pos.date_fmt')} value={bizF.dateFormat} onChange={(v) => setBF('dateFormat', v)} w={110} />
                {/* Oct 21 2026: the salon's POS language for staff who never chose one (each person can still switch in the topbar) */}
                <label className="s" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{i18nText('pos.pos_language')}{' '}<select aria-label={i18nText('pos.pos_language')} value={bizF.defaultLanguage === 'vi' ? 'vi' : 'en'} onChange={(e) => setBF('defaultLanguage', e.target.value)}><option value="en">{LANGUAGE_LABEL.en}</option><option value="vi">{LANGUAGE_LABEL.vi}</option></select></label></div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{ckbx(!!bizF.multiBranchEnabled, (v) => setBF('multiBranchEnabled', v), 'multi-branch')}{ckbx(!!bizF.perBranchOverrides, (v) => setBF('perBranchOverrides', v), i18nText('pos.per_branch_overrides'))}</div>
              <button className="btn" disabled={busy === 'biz'} onClick={saveBiz}>{busy === 'biz' ? i18nText('pos.saving_2') : i18nText('pos.save_business_branch')}</button>
            </div>
          ) : (
            <div style={{ fontSize: 13, lineHeight: 1.7 }}>
              <div><span className="muted">{i18nText('pos.legal')}</span> {bb.legalName || '—'} · {bb.businessType || '—'}</div>
              <div><span className="muted">{i18nText('pos.address')}</span> {[bb.address, bb.city, bb.state, bb.zip].filter(Boolean).join(', ') || '—'}</div>
              <div><span className="muted">{i18nText('pos.currency_tz')}</span> {bb.currency} · {bb.timezone}</div>
              <div style={{ marginTop: 4 }}>{onoff(bb.multiBranchEnabled, 'multi-branch')}{bb.website ? <span className="pill" style={{ marginLeft: 4 }}>{i18nText('pos.web')}</span> : null}</div>
            </div>
          )}
        </section>

        <section className="panel">
          <div style={{ display: 'flex', alignItems: 'center' }}><h2 id="sec-booking-appointments" style={{ margin: 0 }}>{i18nText('pos.booking_appointments')}</h2><button className="btn ghost" style={{ marginLeft: 'auto' }} disabled={busy === 'booking'} onClick={() => openCat('booking', 'booking-appointments', setBookF)}>{edit === 'booking' ? i18nText('pos.close') : i18nText('pos.edit')}</button></div>
          {edit === 'booking' ? (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Field label={i18nText('pos.slot_min')} num value={bookF.slotIntervalMinutes} onChange={(v) => setKF('slotIntervalMinutes', v)} w={64} /><Field label={i18nText('pos.buffer')} num value={bookF.bufferMinutes} onChange={(v) => setKF('bufferMinutes', v)} w={64} /><Field label={i18nText('pos.cleanup')} num value={bookF.cleanupMinutes} onChange={(v) => setKF('cleanupMinutes', v)} w={64} /><Field label={i18nText('pos.default_dur')} num value={bookF.defaultDurationMinutes} onChange={(v) => setKF('defaultDurationMinutes', v)} w={64} /></div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Field label={i18nText('pos.lead_min')} num value={bookF.minLeadTimeMinutes} onChange={(v) => setKF('minLeadTimeMinutes', v)} w={64} /><Field label={i18nText('pos.max_adv_days')} num value={bookF.maxAdvanceDays} onChange={(v) => setKF('maxAdvanceDays', v)} w={64} /><Field label={i18nText('pos.cancel_win_h')} num value={bookF.cancellationWindowHours} onChange={(v) => setKF('cancellationWindowHours', v)} w={64} /><Field label={i18nText('pos.overbook')} num value={bookF.overbookingAllowance} onChange={(v) => setKF('overbookingAllowance', v)} w={64} /></div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Field label={i18nText('pos.no_show_policy')} value={bookF.noShowPolicy} onChange={(v) => setKF('noShowPolicy', v)} w={150} /><Field label={i18nText('pos.no_show_fee_cents')} num value={bookF.noShowFeeCents} onChange={(v) => setKF('noShowFeeCents', v)} w={90} /><Field label={i18nText('pos.deposit_2')} num value={bookF.depositPercent} onChange={(v) => setKF('depositPercent', v)} w={70} /></div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{ckbx(!!bookF.depositRequired, (v) => setKF('depositRequired', v), i18nText('pos.deposit_required_2'))}{ckbx(!!bookF.noDoubleBooking, (v) => setKF('noDoubleBooking', v), i18nText('pos.no_double_booking'))}</div>
              {/* Smooth Refresh spec §11: what happens when a booking would double-book a technician. Every override is
                  confirmed with a reason and audited; BLOCK is the default. */}
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5 }}>
                <span>{i18nText('pos.when_a_booking_would_double_book_1nj0')}</span>
                <select aria-label={i18nText('pos.double_booking_policy')} value={bookF.overbookingPolicy || 'BLOCK'} onChange={(e) => setKF('overbookingPolicy', e.target.value)} style={{ maxWidth: 420 }}>
                  <option value="BLOCK">{i18nText('pos.block_it_never_allow_a_double_q7ea')}</option>
                  <option value="WARN_REQUIRE_CONFIRMATION">{i18nText('pos.warn_staff_may_confirm_with_a_14gt')}</option>
                  <option value="ALLOW_AUTHORIZED_ROLE">{i18nText('pos.managers_only_owner_or_manager_confirms_jgci')}</option>
                </select>
              </label>
              <button className="btn" disabled={busy === 'booking'} onClick={saveBooking}>{busy === 'booking' ? i18nText('pos.saving_2') : i18nText('pos.save_booking_appointments')}</button>
            </div>
          ) : (
            <div style={{ fontSize: 13, lineHeight: 1.7, marginTop: 6 }}><div className="muted">{i18nText('pos.slot_buffer_cleanup_timing_lead_advance_1li0')}</div><div style={{ marginTop: 4 }}>{i18nText('pos.click_edit_to_load_and_change_owm9')}</div></div>
          )}
        </section>

        <section className="panel">
          <div style={{ display: 'flex', alignItems: 'center' }}><h2 id="sec-loyalty-memberships" style={{ margin: 0 }}>{i18nText('pos.loyalty_memberships')}</h2><button className="btn ghost" style={{ marginLeft: 'auto' }} disabled={busy === 'loyalty'} onClick={() => openCat('loyalty', 'loyalty-memberships', setLoyF)}>{edit === 'loyalty' ? i18nText('pos.close') : i18nText('pos.edit')}</button></div>
          {edit === 'loyalty' ? (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Field label={i18nText('pos.earn')} num value={loyF.earnRatePerDollar} onChange={(v) => setLF('earnRatePerDollar', v)} w={70} /><Field label={i18nText('pos.member_disc')} num value={loyF.memberDiscountPercent} onChange={(v) => setLF('memberDiscountPercent', v)} w={70} /></div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Field label={i18nText('pos.redemption')} value={loyF.redemption} onChange={(v) => setLF('redemption', v)} w={150} /><Field label={i18nText('pos.expiration')} value={loyF.pointsExpiration} onChange={(v) => setLF('pointsExpiration', v)} w={120} /></div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Field label={i18nText('pos.silver_cents')} num value={loyF.vipSilverCents} onChange={(v) => setLF('vipSilverCents', v)} w={90} /><Field label={i18nText('pos.gold_cents')} num value={loyF.vipGoldCents} onChange={(v) => setLF('vipGoldCents', v)} w={90} /><Field label={i18nText('pos.platinum_cents')} num value={loyF.vipPlatinumCents} onChange={(v) => setLF('vipPlatinumCents', v)} w={90} /></div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{ckbx(!!loyF.membershipEnabled, (v) => setLF('membershipEnabled', v), 'memberships')}{ckbx(!!loyF.birthdayReward, (v) => setLF('birthdayReward', v), i18nText('pos.birthday_reward'))}{ckbx(!!loyF.referralReward, (v) => setLF('referralReward', v), i18nText('pos.referral_reward'))}{ckbx(!!loyF.giftCardsEnabled, (v) => setLF('giftCardsEnabled', v), i18nText('pos.gift_cards_4'))}</div>
              <button className="btn" disabled={busy === 'loyalty'} onClick={saveLoyalty}>{busy === 'loyalty' ? i18nText('pos.saving_2') : i18nText('pos.save_loyalty_memberships')}</button>
            </div>
          ) : (
            <div style={{ fontSize: 13, lineHeight: 1.7, marginTop: 6 }}><div className="muted">{i18nText('pos.earn_rate_redemption_vip_thresholds_member_j4h7')}</div><div style={{ marginTop: 4 }}>{i18nText('pos.click_edit_to_load_and_change_owm9')}</div></div>
          )}
        </section>

        <section className="panel">
          <div className="flex flex-col 2xl:flex-row 2xl:items-center justify-between gap-3 mb-4">
            <h2 id="sec-payments-checkout" style={{ margin: 0 }}>{i18nText('pos.payments_tips')}</h2>
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn ghost whitespace-nowrap" onClick={() => nav('/tenant/payments/sell-gift-card')}>{i18nText('pos.sell_gift_card_2')}</button>
              <button className="btn ghost whitespace-nowrap" onClick={() => nav('/tenant/payments/reload-gift-card')}>{i18nText('pos.reload_gift_card_2')}</button>
              <button className="btn ghost whitespace-nowrap" onClick={() => nav('/tenant/payments/gift-card-lookup')}>{i18nText('pos.gift_card_lookup_2')}</button>
              <button className="btn ghost whitespace-nowrap" onClick={() => nav('/tenant/payments/gift-card-stock')}>{i18nText('pos.physical_card_stock_2')}</button>
              <button className="btn ghost whitespace-nowrap" onClick={() => nav('/tenant/payments/gift-cards/settings')}>{i18nText('pos.gift_card_settings_2')}</button>
              <button className="btn ghost whitespace-nowrap" onClick={openPay}>{edit === 'pay' ? i18nText('pos.close') : i18nText('pos.edit')}</button>
            </div>
          </div>
          {edit === 'pay' ? (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{ckbx(pCard, setPCard, 'card')}{ckbx(pCash, setPCash, 'cash')}{ckbx(pGift, setPGift, 'gift')}{ckbx(pSplit, setPSplit, 'split')}</div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>{ckbx(pSurOn, setPSurOn, i18nText('admin.settings.cardSurcharge'))}<input placeholder={i18nText('pos.surcharge_max_3')} value={pSurPct} onChange={(e) => setPSurPct(e.target.value)} inputMode="decimal" style={{ ...inputStyle, width: 110 }} /></div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><span className="s">{i18nText('pos.tip_presets')}</span><input placeholder={i18nText('admin.form.example', { value: '15,18,20' })} value={tipPcts} onChange={(e) => setTipPcts(e.target.value)} style={{ ...inputStyle, width: 130 }} /><span className="s">{i18nText('pos.max')}</span><input value={tipMax} onChange={(e) => setTipMax(e.target.value)} inputMode="decimal" style={{ ...inputStyle, width: 70 }} /></div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{ckbx(tipCustom, setTipCustom, i18nText('pos.allow_custom_tip'))}{ckbx(tipNo, setTipNo, i18nText('pos.allow_no_tip'))}{ckbx(tipPerTech, setTipPerTech, i18nText('pos.per_technician_tips'))}</div>
              <button className="btn" disabled={busy === 'pay'} onClick={savePay}>{busy === 'pay' ? i18nText('pos.saving_2') : i18nText('pos.save_payments_tips')}</button>
            </div>
          ) : (
            <div style={{ fontSize: 13, lineHeight: 1.7, marginTop: 6 }}>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{onoff(pc.methods.card, 'card')}{onoff(pc.methods.cash, 'cash')}{onoff(pc.methods.giftCard, 'gift')}{onoff(pc.methods.split, 'split')}</div>
              <div style={{ marginTop: 4 }}><span className="muted">{i18nText('pos.surcharge')}</span> {pc.creditCardSurchargeEnabled ? `${pc.creditCardSurchargePercent}%` : 'off'} · <span className="muted">{i18nText('pos.cash_discount_2')}</span> {pc.cashDiscountEnabled ? 'on' : 'off'}</div>
              <div><span className="muted">{i18nText('pos.mgr_approval_over')}</span> {money(pc.managerApprovalOverCents)} · <span className="muted">{i18nText('pos.display_2')}</span> {pc.customerDisplayMode}</div>
              <div><span className="muted">{i18nText('pos.tips_3')}</span> {s.tips.defaultTipPercents.join('/')}{i18nText('pos.max_2')}{' '}{s.tips.maxTipPercent}% · {s.tips.allowNoTip ? i18nText('pos.no_tip_ok') : i18nText('pos.tip_required')} {i18nText('pos.base_2')}{' '}{s.tips.tipBase}</div>
            </div>
          )}
          <PaymentGatewayStatusCard />
        </section>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mb-3">
        <section className="panel">
          <div style={{ display: 'flex', alignItems: 'center' }}><h2 id="sec-tax" style={{ margin: 0 }}>{i18nText('pos.tax_4')}</h2><button className="btn ghost" style={{ marginLeft: 'auto' }} onClick={openTax}>{edit === 'tax' ? i18nText('pos.close') : i18nText('pos.edit')}</button></div>
          {edit === 'tax' ? (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>{ckbx(txEnabled, setTxEnabled, 'enabled')}<input placeholder={i18nText('pos.rate_2')} value={txRate} onChange={(e) => setTxRate(e.target.value)} inputMode="decimal" style={{ ...inputStyle, width: 80 }} /><input placeholder={i18nText('pos.label_2')} value={txLabel} onChange={(e) => setTxLabel(e.target.value)} style={{ ...inputStyle, width: 110 }} /><select value={txMode} onChange={(e) => setTxMode(e.target.value)} style={inputStyle}><option value="exclusive">{i18nText('pos.exclusive')}</option><option value="inclusive">{i18nText('pos.inclusive')}</option></select></div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{ckbx(txSvc, setTxSvc, i18nText('pos.applies_to_services'))}{ckbx(txProd, setTxProd, i18nText('pos.applies_to_products'))}</div>
              <button className="btn" disabled={busy === 'tax'} onClick={saveTax}>{busy === 'tax' ? i18nText('pos.saving_2') : i18nText('pos.save_tax')}</button>
            </div>
          ) : (
            <div style={{ fontSize: 13, lineHeight: 1.7, marginTop: 6 }}>
              <div><span className="muted">{i18nText('pos.status_2')}</span> {tx.enabled ? 'enabled' : 'disabled'} · {tx.taxLabel} · {tx.mode}</div>
              <div><span className="muted">{i18nText('pos.rate_3')}</span> {tx.taxRatePercent}%</div>
              <div style={{ marginTop: 4 }}>{onoff(tx.appliesToServices, 'services')}{onoff(tx.appliesToProducts, 'products')}</div>
            </div>
          )}
        </section>

        <section className="panel">
          <div style={{ display: 'flex', alignItems: 'center' }}><h2 id="sec-queue-workflow" style={{ margin: 0 }}>{i18nText('pos.queue_workflow')}</h2><button className="btn ghost" style={{ marginLeft: 'auto' }} disabled={busy === 'queue'} onClick={openQueue}>{edit === 'queue' ? i18nText('pos.close') : i18nText('pos.edit')}</button></div>
          {edit === 'queue' ? (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <label className="s" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{i18nText('pos.avg_min')}{' '}<input value={qAvgMin} onChange={(e) => setQAvgMin(e.target.value)} inputMode="numeric" style={{ ...inputStyle, width: 64 }} /></label>
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {ckbx(qShowWait, setQShowWait, i18nText('pos.show_wait_to_guest'))}
                {ckbx(qAutoFlow, setQAutoFlow, i18nText('pos.auto_flow_to_checkout'))}
                {ckbx(qManualApproval, setQManualApproval, i18nText('pos.manual_approval_before_checkout'))}
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {ckbx(qAllowReopen, setQAllowReopen, i18nText('pos.allow_reopen_service'))}
                {ckbx(qVip, setQVip, i18nText('pos.vip_priority'))}
                {ckbx(qApptOver, setQApptOver, i18nText('pos.appointment_over_walk_in'))}
              </div>
              <AiQueuePointer onOpen={() => nav('/tenant/ai/queue')} />
              <button className="btn" disabled={busy === 'queue'} onClick={saveQueue}>{busy === 'queue' ? i18nText('pos.saving_2') : i18nText('pos.save_queue_workflow')}</button>
            </div>
          ) : (
            <div style={{ fontSize: 13, lineHeight: 1.7, marginTop: 6 }}>
              <div className="muted">{i18nText('pos.queue_flow_to_checkout_manual_approval_15rq')}</div>
              <AiQueuePointer onOpen={() => nav('/tenant/ai/queue')} />
              <div style={{ marginTop: 4 }}>{i18nText('pos.click_edit_to_load_and_change_owm9')}</div>
            </div>
          )}
        </section>

        <section className="panel">
          <div style={{ display: 'flex', alignItems: 'center' }}><h2 id="sec-auto-logout" style={{ margin: 0 }}>{i18nText('pos.auto_logout')}</h2><button className="btn ghost" style={{ marginLeft: 'auto' }} disabled={busy === 'logout'} onClick={openLogout}>{edit === 'logout' ? i18nText('pos.close') : i18nText('pos.edit')}</button></div>
          {edit === 'logout' ? (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {ckbx(lgEnabled, setLgEnabled, i18nText('pos.auto_logout_enabled'))}
                <label className="s" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{i18nText('pos.grace_min')}{' '}<input value={lgGrace} onChange={(e) => setLgGrace(e.target.value)} inputMode="numeric" style={{ ...inputStyle, width: 64 }} /></label>
                <label className="s" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{i18nText('pos.after_close_ext_min')}{' '}<input value={lgExt} onChange={(e) => setLgExt(e.target.value)} inputMode="numeric" style={{ ...inputStyle, width: 64 }} /></label>
              </div>
              <label className="s" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{i18nText('pos.warning_minutes_comma')}{' '}<input value={lgWarn} onChange={(e) => setLgWarn(e.target.value)} placeholder={i18nText('admin.form.example', { value: '5,1' })} style={{ ...inputStyle, width: 120 }} /></label>
              <div className="s" style={{ opacity: .7 }}>{i18nText('pos.store_hours_schedule_is_managed_separately_dm0p')}</div>
              <button className="btn" disabled={busy === 'logout'} onClick={saveLogout}>{busy === 'logout' ? i18nText('pos.saving_2') : i18nText('pos.save_auto_logout')}</button>
            </div>
          ) : (
            <div style={{ fontSize: 13, lineHeight: 1.7, marginTop: 6 }}>
              <div className="muted">{i18nText('pos.idle_auto_logout_grace_period_after_1ks2')}</div>
              <div style={{ marginTop: 4 }}>{i18nText('pos.click_edit_to_load_and_change_owm9')}</div>
            </div>
          )}
        </section>

        <section className="panel">
          <div style={{ display: 'flex', alignItems: 'center' }}><h2 id="sec-notifications" style={{ margin: 0 }}>{i18nText('pos.notifications')}</h2><button className="btn ghost" style={{ marginLeft: 'auto' }} disabled={busy === 'notif'} onClick={() => openCat('notif', 'notifications-reminders', setNotifF)}>{edit === 'notif' ? i18nText('pos.close') : i18nText('pos.edit')}</button></div>
          {edit === 'notif' ? (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{ckbx(!!notifF.smsConfirmation, (v) => setNF2('smsConfirmation', v), i18nText('pos.sms_confirm'))}{ckbx(!!notifF.emailConfirmation, (v) => setNF2('emailConfirmation', v), i18nText('pos.email_confirm'))}{ckbx(!!notifF.pushConfirmation, (v) => setNF2('pushConfirmation', v), i18nText('pos.push_confirm'))}</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{ckbx(!!notifF.noShowFollowUp, (v) => setNF2('noShowFollowUp', v), i18nText('pos.no_show_follow_up'))}{ckbx(!!notifF.marketingOptInRequired, (v) => setNF2('marketingOptInRequired', v), i18nText('pos.marketing_opt_in_required'))}</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Field label={i18nText('pos.reminder_hours_csv')} value={Array.isArray(notifF.reminderHours) ? notifF.reminderHours.join(',') : notifF.reminderHours} onChange={(v) => setNF2('reminderHours', v)} w={120} /><Field label={i18nText('pos.receipt_delivery_csv')} value={Array.isArray(notifF.receiptDelivery) ? notifF.receiptDelivery.join(',') : notifF.receiptDelivery} onChange={(v) => setNF2('receiptDelivery', v)} w={140} /><Field label={i18nText('pos.sender_2')} value={notifF.senderBrand} onChange={(v) => setNF2('senderBrand', v)} w={130} /></div>
              <div className="s" style={{ opacity: .7 }}>{i18nText('pos.a2p_status_is_managed_in_the_107s')}</div>
              <button className="btn" disabled={busy === 'notif'} onClick={saveNotif}>{busy === 'notif' ? i18nText('pos.saving_2') : i18nText('pos.save_notifications')}</button>
            </div>
          ) : (
            <div style={{ fontSize: 13, lineHeight: 1.7 }}>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{onoff(nf.smsConfirmation, 'SMS')}{onoff(nf.emailConfirmation, i18nText('admin.integrations.email'))}{onoff(nf.pushConfirmation, i18nText('admin.settings.push'))}</div>
              <div style={{ marginTop: 4 }}><span className="muted">{i18nText('pos.reminders_2')}</span> {nf.reminderHours?.length ? nf.reminderHours.join(', ') + 'h' : '—'}</div>
              <div><span className="muted">{i18nText('pos.sender')}</span> {nf.senderBrand || '—'} · <span className="muted">A2P:</span> <span className={'pill ' + (/(approved|registered|active)/i.test(nf.a2pStatus) ? 'ok' : 'warn')}>{nf.a2pStatus || 'unknown'}</span></div>
              <div><span className="muted">{i18nText('pos.receipts')}</span> {nf.receiptDelivery?.join(', ') || '—'}</div>
            </div>
          )}
        </section>
      </div>

      <section className="panel mb-3">
        <div style={{ display: 'flex', alignItems: 'center' }}><h2 style={{ margin: 0 }}>{i18nText('pos.online_google_ai_booking')}</h2><button className="btn ghost" style={{ marginLeft: 'auto' }} disabled={busy === 'online'} onClick={() => openCat('online', 'online-google-ai-booking', setOnlineF)}>{edit === 'online' ? i18nText('pos.close') : i18nText('pos.edit')}</button></div>
        {edit === 'online' ? (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>{ckbx(!!onlineF.onlineBookingEnabled, (v) => upOn('onlineBookingEnabled', v), i18nText('pos.online_booking'))}{ckbx(!!onlineF.aiPhoneEnabled, (v) => upOn('aiPhoneEnabled', v), i18nText('pos.ai_phone'))}<Field label={i18nText('pos.slug_2')} value={onlineF.tenantSlug} onChange={(v) => upOn('tenantSlug', v)} w={130} /><Field label={i18nText('pos.google_link')} value={onlineF.googleBookingLink} onChange={(v) => upOn('googleBookingLink', v)} w={180} /></div>
            <div className="s">{i18nText('pos.ai_actions')}</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{ckbx(!!onlineF.aiActions?.findAvailability, (v) => upOnAi('findAvailability', v), 'availability')}{ckbx(!!onlineF.aiActions?.create, (v) => upOnAi('create', v), 'create')}{ckbx(!!onlineF.aiActions?.reschedule, (v) => upOnAi('reschedule', v), 'reschedule')}{ckbx(!!onlineF.aiActions?.cancel, (v) => upOnAi('cancel', v), 'cancel')}{ckbx(!!onlineF.aiActions?.sendReminder, (v) => upOnAi('sendReminder', v), 'remind')}</div>
            <button className="btn" disabled={busy === 'online'} onClick={saveOnline}>{busy === 'online' ? i18nText('pos.saving_2') : i18nText('pos.save_online_ai_booking')}</button>
          </div>
        ) : (
          <div style={{ fontSize: 13, lineHeight: 1.7 }}>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>{onoff(ob.onlineBookingEnabled, i18nText('admin.settings.onlineBooking'))}{onoff(ob.aiPhoneEnabled, i18nText('admin.settings.aiPhone'))}{ob.tenantSlug ? <span className="s" style={{ marginLeft: 6 }}>{i18nText('pos.slug')}{' '}{ob.tenantSlug}</span> : null}{ob.googleBookingLink ? <span className="pill" style={{ marginLeft: 4 }}>{i18nText('pos.google_linked')}</span> : null}</div>
            <div style={{ marginTop: 6 }}><span className="muted">{i18nText('pos.ai_actions_2')}</span>{' '}{onoff(ob.aiActions.findAvailability, 'availability')}{onoff(ob.aiActions.create, 'create')}{onoff(ob.aiActions.reschedule, 'reschedule')}{onoff(ob.aiActions.cancel, 'cancel')}{onoff(ob.aiActions.sendReminder, 'remind')}</div>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mb-3">
        <section className="panel">
          <div style={{ display: 'flex', alignItems: 'center' }}><h2 style={{ margin: 0 }}>{i18nText('pos.services_pricing')}</h2><button className="btn ghost" style={{ marginLeft: 'auto' }} disabled={busy === 'svc'} onClick={() => openCat('svc', 'services-pricing', setSvcF)}>{edit === 'svc' ? i18nText('pos.close') : i18nText('pos.edit')}</button></div>
          {edit === 'svc' ? (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Field label={i18nText('pos.default_duration_min')} num value={svcF.defaultDurationMinutes} onChange={(v) => upSv('defaultDurationMinutes', v)} w={70} />
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{ckbx(!!svcF.newServicesTaxable, (v) => upSv('newServicesTaxable', v), i18nText('pos.new_services_taxable'))}{ckbx(!!svcF.showOnOnlineBooking, (v) => upSv('showOnOnlineBooking', v), i18nText('pos.show_on_online_booking'))}</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{ckbx(!!svcF.allowAiBooking, (v) => upSv('allowAiBooking', v), i18nText('pos.allow_ai_booking'))}{ckbx(!!svcF.enforceSkillMapping, (v) => upSv('enforceSkillMapping', v), i18nText('pos.enforce_skill_mapping'))}</div>
              <button className="btn" disabled={busy === 'svc'} onClick={saveSvc}>{busy === 'svc' ? i18nText('pos.saving_2') : i18nText('pos.save_services_pricing')}</button>
            </div>
          ) : (<div style={{ fontSize: 13, lineHeight: 1.7, marginTop: 6 }}><div className="muted">{i18nText('pos.default_service_duration_taxability_online_ai_1hso')}</div><div style={{ marginTop: 4 }}>{i18nText('pos.click_edit_to_load_and_change_owm9')}</div></div>)}
        </section>

        <section className="panel">
          <div style={{ display: 'flex', alignItems: 'center' }}><h2 style={{ margin: 0 }}>{i18nText('pos.technicians_staff')}</h2><button className="btn ghost" style={{ marginLeft: 'auto' }} disabled={busy === 'staff'} onClick={() => openCat('staff', 'technicians-staff', setStaffF)}>{edit === 'staff' ? i18nText('pos.close') : i18nText('pos.edit')}</button></div>
          {edit === 'staff' ? (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <label className="s" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{i18nText('pos.commission_basis_2')}{' '}<select value={staffF.commissionBasis ?? 'per_technician'} onChange={(e) => upSt('commissionBasis', e.target.value)} style={inputStyle}><option value="per_technician">{i18nText('pos.per_technician')}</option><option value="per_service">{i18nText('pos.per_service')}</option><option value="hybrid">{i18nText('pos.hybrid')}</option></select></label>
                <Field label={i18nText('pos.default_5')} num value={staffF.defaultCommissionPercent} onChange={(v) => upSt('defaultCommissionPercent', v)} w={64} />
                <label className="s" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{i18nText('pos.payroll_2')}{' '}<select value={staffF.payrollPeriod ?? 'biweekly'} onChange={(e) => upSt('payrollPeriod', e.target.value)} style={inputStyle}><option value="weekly">{i18nText('pos.weekly')}</option><option value="biweekly">{i18nText('pos.biweekly')}</option><option value="monthly">{i18nText('pos.monthly')}</option></select></label>
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{ckbx(!!staffF.techCanProcessPayment, (v) => upSt('techCanProcessPayment', v), i18nText('pos.tech_can_take_payment'))}{ckbx(!!staffF.techCanEditServiceLines, (v) => upSt('techCanEditServiceLines', v), i18nText('pos.tech_can_edit_lines'))}{ckbx(!!staffF.techCanMarkDone, (v) => upSt('techCanMarkDone', v), i18nText('pos.tech_can_mark_done'))}</div>
              <button className="btn" disabled={busy === 'staff'} onClick={saveStaff}>{busy === 'staff' ? i18nText('pos.saving_2') : i18nText('pos.save_technicians_staff')}</button>
            </div>
          ) : (<div style={{ fontSize: 13, lineHeight: 1.7, marginTop: 6 }}><div className="muted">{i18nText('pos.commission_basis_default_payroll_period_and_pw57')}</div><div style={{ marginTop: 4 }}>{i18nText('pos.click_edit_to_load_and_change_owm9')}</div></div>)}
        </section>

        <section className="panel" style={{ border: '1px solid #EFE7DA', background: '#FFFDF9', borderRadius: 12, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#111827' }}>{i18nText('pos.salon_baseline_technician_commission')}</h2>
            <button
              className="btn whitespace-nowrap"
              style={{ padding: '5px 12px', fontSize: 12, fontWeight: 600, background: '#B45309', color: '#FFF', border: 0, borderRadius: 8, cursor: 'pointer' }}
              onClick={() => { setSalonCommAuthCode(''); setSalonCommErr(null); setSalonCommAuthModal(true); }}
            >
              {i18nText('pos.edit_baseline')}
            </button>
          </div>
          <div style={{ fontSize: 12.5, lineHeight: 1.5, marginTop: 6, color: '#4B5563' }}>
            {i18nText('pos.baseline_rate_assigned_by_super_admin_1ivd')}{' '}<b>{i18nText('pos.admin_authorization_code')}</b>.
          </div>
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12.5, color: '#374151', fontWeight: 600 }}>{i18nText('pos.current_baseline_rate')}</span>
            <span style={{ fontSize: 16, fontWeight: 800, color: '#B45309', background: '#FEF3C7', padding: '2px 8px', borderRadius: 6, border: '1px solid #FDE68A' }}>
              {salonCommPct}%
            </span>
          </div>

          {/* Admin Auth Modal for Salon Baseline Commission */}
          {salonCommAuthModal && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
              <div style={{ background: '#FFF', borderRadius: 12, padding: 20, width: 380, maxWidth: '90%', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
                <h3 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 700, color: '#111827' }}>{i18nText('pos.admin_authorization_required')}</h3>
                <p style={{ margin: '0 0 14px', fontSize: 12.5, color: '#4B5563', lineHeight: 1.4 }}>
                  {i18nText('pos.modifying_the_salon_s_baseline_technician_1i4o')}
                </p>

                {salonCommErr && (
                  <div style={{ fontSize: 12, color: '#DC2626', background: '#FEE2E2', border: '1px solid #FCA5A5', padding: '6px 10px', borderRadius: 8, marginBottom: 12, fontWeight: 600 }}>
                    {salonCommErr}
                  </div>
                )}

                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
                  {i18nText('pos.new_baseline_commission_0_100')}
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={salonCommDraft}
                  onChange={(e) => setSalonCommDraft(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 13, marginBottom: 12, boxSizing: 'border-box' }}
                />

                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
                  {i18nText('pos.admin_authorization_code')}
                </label>
                <input
                  type="text"
                  placeholder={i18nText('pos.e_g_auth_comm_1234')}
                  value={salonCommAuthCode}
                  onChange={(e) => setSalonCommAuthCode(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 13, marginBottom: 16, boxSizing: 'border-box' }}
                />

                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button className="btn ghost" style={{ padding: '6px 14px', fontSize: 12 }} onClick={() => setSalonCommAuthModal(false)}>{i18nText('pos.cancel')}</button>
                  <button className="btn" style={{ padding: '6px 14px', fontSize: 12 }} disabled={busy === 'salonComm'} onClick={handleSaveSalonComm}>
                    {busy === 'salonComm' ? i18nText('pos.authorizing') : i18nText('pos.authorize_save')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="panel">
          <div style={{ display: 'flex', alignItems: 'center' }}><h2 style={{ margin: 0 }}>{i18nText('pos.customer_display')}</h2><button className="btn ghost" style={{ marginLeft: 'auto' }} disabled={busy === 'display'} onClick={() => openCat('display', 'customer-display-devices', setDispF)}>{edit === 'display' ? i18nText('pos.close') : i18nText('pos.edit')}</button></div>
          {edit === 'display' ? (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>{ckbx(!!dispF.enabled, (v) => upDi('enabled', v), 'enabled')}<label className="s" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{i18nText('pos.mode_2')}{' '}<select value={dispF.displayMode ?? 'tip_only'} onChange={(e) => upDi('displayMode', e.target.value)} style={inputStyle}><option value="review_only">{i18nText('pos.review_only')}</option><option value="tip_only">{i18nText('pos.tip_only')}</option><option value="customer_pays">{i18nText('pos.customer_pays')}</option></select></label><Field label={i18nText('pos.station_2')} value={dispF.stationNumber} onChange={(v) => upDi('stationNumber', v)} w={70} /></div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}><Field label={i18nText('pos.idle_message')} value={dispF.idleMessage} onChange={(v) => upDi('idleMessage', v)} w={200} max={80} placeholder={i18nText('pos.welcome_please_check_in')} /><Field label={i18nText('pos.timeout_min')} num value={dispF.sessionTimeoutMinutes} onChange={(v) => upDi('sessionTimeoutMinutes', v)} w={64} /></div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{ckbx(!!dispF.tipPromptEnabled, (v) => upDi('tipPromptEnabled', v), i18nText('pos.tip_prompt'))}{ckbx(!!dispF.receiptPromptEnabled, (v) => upDi('receiptPromptEnabled', v), i18nText('pos.receipt_prompt'))}</div>
              <div style={{ fontWeight: 700, fontSize: 12.5, marginTop: 4 }}>{i18nText('pos.display_branding')}</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>{ckbx(!!dispF.displayBranding, (v) => upDi('displayBranding', v), i18nText('pos.show_salon_logo_tagline'))}<Field label={i18nText('pos.tagline')} value={dispF.tagline} onChange={(v) => upDi('tagline', v)} w={220} max={60} placeholder={i18nText('pos.nails_spa_lashes')} />{ckbx(!!dispF.showBranchName, (v) => upDi('showBranchName', v), i18nText('pos.show_branch_name'))}</div>
              <div className="s muted">{i18nText('pos.the_salon_name_is_always_shown_r4rf')}</div>
              <button className="btn" disabled={busy === 'display'} onClick={saveDisp}>{busy === 'display' ? i18nText('pos.saving_2') : i18nText('pos.save_customer_display')}</button>
            </div>
          ) : (<div style={{ fontSize: 13, lineHeight: 1.7, marginTop: 6 }}><div className="muted">{i18nText('pos.display_mode_station_idle_message_timeout_13xk')}</div><div style={{ marginTop: 4 }}>{i18nText('pos.click_edit_to_load_and_change_owm9')}</div></div>)}
        </section>

        <section className="panel">
          <div style={{ display: 'flex', alignItems: 'center' }}><h2 style={{ margin: 0 }}>{i18nText('pos.receipts_branding')}</h2><button className="btn ghost" style={{ marginLeft: 'auto' }} disabled={busy === 'receipts'} onClick={() => openCat('receipts', 'receipts-branding', setRcptF)}>{edit === 'receipts' ? i18nText('pos.close') : i18nText('pos.edit')}</button></div>
          {edit === 'receipts' ? (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <SalonLogoSetting onChanged={(has) => upRc('showLogo', has)} />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Field label={i18nText('pos.header')} value={rcptF.header} onChange={(v) => upRc('header', v)} w={150} /><Field label={i18nText('pos.footer')} value={rcptF.footer} onChange={(v) => upRc('footer', v)} w={150} /></div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Field label={i18nText('pos.thank_you')} value={rcptF.thankYouMessage} onChange={(v) => upRc('thankYouMessage', v)} w={170} /><Field label={i18nText('pos.address_2')} value={rcptF.businessAddress} onChange={(v) => upRc('businessAddress', v)} w={170} /></div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Field label={i18nText('pos.delivery_csv')} value={Array.isArray(rcptF.defaultDelivery) ? rcptF.defaultDelivery.join(',') : rcptF.defaultDelivery} onChange={(v) => upRc('defaultDelivery', v)} w={130} /><Field label={i18nText('pos.brand_style')} value={rcptF.brandStyle} onChange={(v) => upRc('brandStyle', v)} w={110} /></div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{ckbx(!!rcptF.showLogo, (v) => upRc('showLogo', v), 'logo')}{ckbx(!!rcptF.showSurchargeLine, (v) => upRc('showSurchargeLine', v), i18nText('pos.surcharge_line'))}{ckbx(!!rcptF.showTechnicianLines, (v) => upRc('showTechnicianLines', v), i18nText('pos.tech_lines'))}{ckbx(!!rcptF.showServiceNotes, (v) => upRc('showServiceNotes', v), i18nText('pos.service_notes_2'))}</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{ckbx(!!rcptF.showDiscountLine, (v) => upRc('showDiscountLine', v), i18nText('pos.discount_line'))}{ckbx(!!rcptF.showLoyaltyPoints, (v) => upRc('showLoyaltyPoints', v), i18nText('pos.loyalty_points_2'))}{ckbx(!!rcptF.showTips, (v) => upRc('showTips', v), 'tips')}</div>
              <button className="btn" disabled={busy === 'receipts'} onClick={saveRcpt}>{busy === 'receipts' ? i18nText('pos.saving_2') : i18nText('pos.save_receipts_branding')}</button>
            </div>
          ) : (<div style={{ fontSize: 13, lineHeight: 1.7, marginTop: 6 }}><div className="muted">{i18nText('pos.salon_logo_receipts_and_customer_displays_1qul')}</div><div style={{ marginTop: 4 }}>{i18nText('pos.click_edit_to_load_and_change_owm9')}</div></div>)}
        </section>
      </div>

      <section className="panel mb-3">
        <div style={{ display: 'flex', alignItems: 'center' }}><h2 style={{ margin: 0 }}>{i18nText('pos.roles_permissions')}</h2><button className="btn ghost" style={{ marginLeft: 'auto' }} disabled={busy === 'roles'} onClick={openRoles}>{edit === 'roles' ? i18nText('pos.close') : i18nText('pos.edit')}</button></div>
        {edit === 'roles' ? (
          <div style={{ marginTop: 10 }}>
            <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 320px)', border: '1px solid var(--line)', borderRadius: 10 }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5 }}>
                <thead>
                  <tr>
                    <th style={{ position: 'sticky', top: 0, background: '#FFFDF8', textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid var(--line)', minWidth: 240 }}>{i18nText('pos.permission_2')}</th>
                    {ROLE_COLS.map((rc) => (<th key={rc} style={{ position: 'sticky', top: 0, background: '#FFFDF8', padding: '8px 10px', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' }}>{statusLabel('role', rc)}</th>))}
                  </tr>
                </thead>
                <tbody>
                  {matF.length === 0 ? <tr><td colSpan={ROLE_COLS.length + 1} className="muted" style={{ padding: 12 }}>{i18nText('pos.no_permissions_reported')}</td></tr> : null}
                  {matF.map((e) => (
                    <tr key={e.permission}>
                      <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--line)', fontFamily: 'ui-monospace, monospace', fontSize: 11.5 }}>{e.permission}</td>
                      {ROLE_COLS.map((rc) => (
                        <td key={rc} style={{ padding: '6px 10px', borderBottom: '1px solid var(--line)', textAlign: 'center' }}>
                          <input type="checkbox" checked={e.roles.includes(rc)} onChange={() => toggleRole(e.permission, rc)} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="s" style={{ marginTop: 6, opacity: .7 }}>{i18nText('pos.super_admin_platform_and_customer_app_1k4z')}{' '}{matF.length} {i18nText('pos.permissions')}</div>
            <button className="btn" style={{ marginTop: 8 }} disabled={busy === 'roles'} onClick={saveRoles}>{busy === 'roles' ? i18nText('pos.saving_2') : i18nText('pos.save_roles_permissions')}</button>
          </div>
        ) : (
          <div style={{ fontSize: 13, lineHeight: 1.7, marginTop: 6 }}>
            <div className="muted">{i18nText('pos.per_permission_role_assignment_across_owner_9ynp')}</div>
            <div style={{ marginTop: 4 }}>{i18nText('pos.click_edit_to_load_the_permission_1k38')}</div>
          </div>
        )}
      </section>
    </div>
  );
}

/** Where technician auto-assignment and turn rotation are set now (BUILD_PLAN Phase 6 — the retired toggles' home). */
function AiQueuePointer({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="s" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
      <span>{i18nText('pos.technician_auto_assignment_and_turn_rotation_cicy')}</span>
      <button className="btn ghost" onClick={onOpen}>{i18nText('pos.open_ai_queue_settings')}</button>
    </div>
  );
}
