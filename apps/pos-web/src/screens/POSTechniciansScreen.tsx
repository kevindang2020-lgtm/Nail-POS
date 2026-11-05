import { useCallback, useEffect, useState } from 'react';

import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { MembershipRequestsPanel } from '../components/MembershipRequestsPanel';
import { ProfileChangeRequestsPanel } from '../components/ProfileChangeRequestsPanel';
import { TechnicianImportPanel } from '../components/TechnicianImportPanel';
import { useCan } from '../components/usePermissions';
import { PendingTimeOffPanel } from '../components/PendingTimeOffPanel';
import { useInlineAsk, useInlineConfirm } from '@aipowersalon/ui';
import { posWorkforceApi, type TechnicianWorkforceStateView } from '../api/posWorkforceApi';
import { t as tx, enPlural } from '@aipowersalon/mobile-sdk/i18n';
import { ImeSafeInput } from '../components/ImeSafeInput';
// The ONE authoritative operational state (technician_workforce_state, 579): can she take a walk-in right now?
// queue state → label, translated when read
const QUEUE_LABEL = (): Record<string, string> => ({ AVAILABLE: tx('people.techs.queue.available'), ASSIGNED: tx('people.techs.queue.assigned'), SERVING: tx('people.techs.queue.serving'), BREAK: tx('people.techs.queue.break'), UNAVAILABLE: tx('people.techs.queue.unavailable'), OFF_SHIFT: tx('people.techs.queue.offShift') });
import { posTechniciansApi } from '../api/posTechniciansApi';
import { ProfileAvatarWithPreview } from '@aipowersalon/ui';
import { statusLabel } from '../i18n/status-label';
import { codeLabel } from '../components/peopleLabels';
import { serverText } from '../i18n/server-text';   // labels this screen also compares (All Members, On Shift) are translated only where shown

/** What POST /pos/technicians returns about her invitation. */
type InviteResult = { created: boolean; channel?: string | null; deliveryStatus?: string | null; acceptUrl?: string | null; reason?: string | null };

// What POST /pos/technicians/lookup returns. Note what is NOT here: the names of her other salons. A manager
// asking "does this person already have an account?" is not asking "where else does she work", and returning the
// list would hand every manager on the platform a competitor-roster tool built out of a technician's employment
// history. The server sends a COUNT.
type FoundTech =
  | { found: false }
  | {
    found: true; techCode: string; displayName: string; avatarUrl: string | null;
    yearsExperience: number | null; overallRating: number | null; ratingCount: number;
    portfolioPhotoCount: number; alreadyAtThisSalon: boolean; activeSalonCount: number; platformStatus: string;
  };


// POS Technicians — converted from aipowersalon-pos-technicians.html. Reads the REAL /pos/technicians/state
// (POSTechniciansFullState) via the shared `api` client (the domain posTechniciansApi only exposes update()). Renders
// KPIs + a server-filtered roster table (lifecycle + working status, skills, services count, today's sales/tips,
// est. commission, rating, app-access + payment flags). Search + status filters re-fetch server-side. Read-only:
// Per-row Edit drawer wires posTechniciansApi.update (UpdateTechnicianRequest): fullName, phone, email, commission
// split %, and status round-trip here. App-access and payment permissions use separate endpoints (not on the typed
// client), so those pills stay read-only. Email + commission (0–100) are validated server-side.
type Row = {
  technicianId: string; firstName: string; lastName: string; displayName: string; phone?: string; email?: string;
  status: string; workingStatus: string; shiftStatus?: string; role?: string; skillGroups: string[]; servicesCount: number;
  todaySalesCents: number; todayTipsCents: number; estimatedCommissionCents: number; rating?: number; techAppEnabled: boolean; canProcessPayment: boolean;
};
type TechState = {
  kpisFull: { totalTechnicians: number; activeTechnicians: number; availableNow: number; inService: number; onBreak: number; offToday: number; avgRating: number; todaySalesCents: number; todayTipsCents: number; estimatedCommissionCents: number; totalServicesCompletedToday: number };
  rows: { items: Row[]; pagination: { totalItems: number; page?: number; pageSize?: number; totalPages?: number } };
  teamSummary?: { topPerformers: { technicianId: string; displayName: string; todaySalesCents: number; rating?: number | null }[]; ratingBuckets: { excellent: number; veryGood: number; good: number; needs: number; unrated: number }; roleCounts: Record<string, number>; servicesMapped: number };
  filterFacets: { statuses: string[]; roles: string[]; skillGroups: string[]; serviceCategories: string[]; shiftStatuses: string[]; appAccessStatuses: string[]; branches?: { branchId: string; name: string }[] };
};

/** 200-technician mandate §34: one page of the Team roster (the server pages, searches and filters). */
export const TEAM_PAGE_SIZE = 25;
const money = (c: number) => '$' + ((c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const wsTone = (s: string) => (/available|in_service|serving/i.test(s) ? 'ok' : /break|off|away/i.test(s) ? 'warn' : '');
const stTone = (s: string) => (/active/i.test(s) ? 'ok' : /inactive|archiv|suspend/i.test(s) ? 'warn' : '');
const inputStyle: React.CSSProperties = { height: 34, border: '1px solid var(--line)', borderRadius: 9, padding: '0 10px', background: '#FFFDF8', fontFamily: 'inherit', fontSize: 12.5, color: 'var(--text)' };

export function POSTechniciansScreen() {
  const nav = useNavigate();
  const [s, setS] = useState<TechState | null>(null);
  const [roleTab, setRoleTab] = useState('All Members');
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [shiftStatus, setShiftStatus] = useState('');
  const [missingMapping, setMissingMapping] = useState(false);
  const [branchId, setBranchId] = useState('');   // §34: Role (tabs) and Branch are SERVER filters
  // 200-technician mandate §34 (Oct 23 2026): the roster is paged ON THE SERVER — it showed the first 20 of 200 with no pager
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(TEAM_PAGE_SIZE);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [eName, setEName] = useState(''); const [ePhone, setEPhone] = useState(''); const [eEmail, setEEmail] = useState(''); const [eComm, setEComm] = useState('');
  // create form
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);   // §112 technician import (pos.technicians.import)
  const can = useCan();
  const [cFirst, setCFirst] = useState(''); const [cLast, setCLast] = useState(''); const [cPhone, setCPhone] = useState(''); const [cEmail, setCEmail] = useState(''); const [cStatus, setCStatus] = useState('active');
  // Existing-technician detection. `null` = not looked up yet; `{found:false}` = looked, nobody there.
  const [found, setFound] = useState<FoundTech | null>(null);
  const [looking, setLooking] = useState(false);
  // What happened to her invitation. When the platform could not send it, the manager gets the link to hand over —
  // an honest fallback nobody can see is just a dead end with better manners.
  const [invite, setInvite] = useState<InviteResult | null>(null);

  // Loaded beside the roster; a failure leaves the chip off rather than guessing.
  const [wf, setWf] = useState<Record<string, TechnicianWorkforceStateView>>({});
  const load = useCallback((q: Record<string, unknown>) => {
    posWorkforceApi.branchStates().then((rows) => setWf(Object.fromEntries((Array.isArray(rows) ? rows : []).map((r) => [r.technicianId, r])))).catch(() => setWf({}));
    return (api.get('/pos/technicians/state', q) as Promise<TechState>)
      .then((d) => setS(d))
      .catch((e: any) => setError(e?.message || tx('pos.failed_to_load_technicians')));
  }, []);

  const queryArgs = useCallback(() => ({
    search: search || undefined,
    status: status || undefined,
    shiftStatus: shiftStatus || undefined,
    missingMapping: missingMapping ? '1' : undefined,
    role: roleTab !== 'All Members' ? roleTab : undefined,
    branchId: branchId || undefined,
    page, pageSize,
  }), [search, status, shiftStatus, missingMapping, roleTab, branchId, page, pageSize]);
  // a new filter starts again at page 1
  useEffect(() => { setPage(1); }, [search, status, shiftStatus, missingMapping, roleTab, branchId, pageSize]);

  useEffect(() => {
    const t = setTimeout(() => { load(queryArgs()); }, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, queryArgs, search]);

  // Commission Security Control inline state
  const [origComm, setOrigComm] = useState<number>(0);
  const [authModal, setAuthModal] = useState<{ id: string; targetComm: number; origComm: number; name: string } | null>(null);
  const [authCode, setAuthCode] = useState('');
  const [authErr, setAuthErr] = useState<string | null>(null);

  const refetch = () => load(queryArgs());

  const openEdit = async (t: Row) => {
    if (editId === t.technicianId) { setEditId(null); return; }
    setEditId(t.technicianId); setNote(null);
    setEName(t.displayName || ''); setEPhone(t.phone || ''); setEEmail(t.email || ''); 

    // Load existing commission percentage for this technician
    setEComm('...');
    try {
      const commData: any = await posTechniciansApi.commission(t.technicianId);
      const pct = Number(commData?.defaultPercent ?? 0);
      setOrigComm(pct);
      setEComm(String(pct));
    } catch {
      setOrigComm(0);
      setEComm('0');
    }
  };

  const saveEdit = async (id: string) => {
    if (!eName.trim()) { setNote(tx('pos.name_is_required')); return; }
    let commission: number | undefined;
    if (eComm.trim() && eComm !== '...') {
      const n = Number(eComm);
      if (!Number.isFinite(n) || n < 0 || n > 100) { setNote(tx('pos.commission_must_be_0_100')); return; }
      commission = n;
    }

    // Require Admin Authorization Code if commission percentage changed
    if (commission !== undefined && commission !== origComm) {
      setAuthErr(null); setAuthCode('');
      const t = visibleRows.find((r) => r.technicianId === id);
      setAuthModal({ id, targetComm: commission, origComm, name: t?.displayName || tx('glossary.people.technician') });
      return;
    }

    await performSaveEdit(id, commission);
  };

  const { ask: askLc, askUi: askLcUi } = useInlineAsk();
  const { confirm: confirmLc, confirmUi: confirmLcUi } = useInlineConfirm();
  const lifecycle = async (id: string, fn: () => Promise<unknown>) => {
    setNote(null); setBusy('lc' + id);
    try { await fn(); setEditId(null); await refetch(); } catch (e: any) { setNote(e?.message || tx('pos.status_change_failed')); } finally { setBusy(null); }
  };
  const performSaveEdit = async (id: string, commission?: number, codeToUse?: string) => {
    setNote(null); setBusy(id); setAuthErr(null);
    try {
      if (commission !== undefined && codeToUse) {
        await posTechniciansApi.setCommission(id, { defaultPercent: commission, adminAuthCode: codeToUse });
      }
      await posTechniciansApi.update(id, {
        fullName: eName.trim(),
        // no `status` here (merge Oct 12): a lifecycle change revokes / restores access server-side, so it is its own
        // explicit, audited action below — never a side effect of saving a name or phone.
        ...(ePhone.trim() ? { phone: ePhone.trim() } : {}),
        ...(eEmail.trim() ? { email: eEmail.trim() } : {}),
        ...(commission !== undefined ? { commissionSplitPercent: commission } : {})
      });
      setEditId(null);
      setAuthModal(null);
      await refetch();
    } catch (e: any) {
      const msg = e?.message || tx('pos.save_failed');
      setNote(msg);
      if (authModal) setAuthErr(msg);
    } finally {
      setBusy(null);
    }
  };

  // Look her up as the manager finishes typing the phone or email. A technician is ONE person on this platform;
  // typing a number that already belongs to somebody should show the manager that person, not quietly mint a
  // second account for them.
  useEffect(() => {
    if (!createOpen) { setFound(null); return; }
    const phone = cPhone.trim(); const email = cEmail.trim();
    if (phone.replace(/\D/g, '').length < 7 && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setFound(null); return; }
    let live = true;
    const t = setTimeout(async () => {
      setLooking(true);
      try {
        const r = await posTechniciansApi.lookup({ ...(phone ? { phone } : {}), ...(email ? { email } : {}) }) as FoundTech;
        if (live) setFound(r);
      } catch { if (live) setFound(null); }
      finally { if (live) setLooking(false); }
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [createOpen, cPhone, cEmail]);

  const createTechnician = async () => {
    if (!cFirst.trim() || !cLast.trim()) { setNote(tx('pos.first_and_last_name_are_required')); return; }
    setNote(null); setBusy('create');
    try {
      const r = await posTechniciansApi.create({ firstName: cFirst.trim(), lastName: cLast.trim(), status: cStatus, ...(cPhone.trim() ? { phone: cPhone.trim() } : {}), ...(cEmail.trim() ? { email: cEmail.trim() } : {}) }) as { linkedExistingProfile?: boolean; globalTechCode?: string; membershipStatus?: string; invite?: InviteResult };
      setCreateOpen(false); setCFirst(''); setCLast(''); setCPhone(''); setCEmail(''); setCStatus('active'); setFound(null);
      setInvite(r?.invite?.created ? r.invite : null);
      // An EXISTING technician is invited, not hired outright — her profile only attaches to this salon once she
      // accepts. Saying "Created" here would be a lie the manager would only discover when she never showed up.
      if (r?.linkedExistingProfile) {
        setNote(r.membershipStatus === 'active'
          ? tx('pos.linked_to_existing_technician_globaltechcode', { globalTechCode: String(r.globalTechCode) })
          : tx('pos.invitation_sent_to_globaltechcode_she_keeps_vc4a', { globalTechCode: String(r.globalTechCode) }));
      }
      await refetch();
    } catch (e: any) { setNote(e?.message || tx('pos.create_failed')); }
    finally { setBusy(null); }
  };


  if (error) return <div className="work"><div className="err">{error}</div></div>;
  if (!s) return <div className="work"><div className="state">{tx('pos.loading_technicians')}</div></div>;

  const k = s.kpisFull;
  const onShiftNow = k.availableNow + k.inService + k.onBreak;
  const kpis: { l: string; v: string; note?: string }[] = [
    { l: tx('pos.total_team_members'), v: String(k.totalTechnicians) },
    { l: tx('pos.active_today'), v: String(k.activeTechnicians) },
    { l: tx('pos.on_shift_now'), v: String(onShiftNow) },
    { l: tx('pos.avg_performance_score_2'), v: `${(k.avgRating || 0).toFixed(1)}★` },
    { l: tx('pos.total_services_completed'), v: k.totalServicesCompletedToday > 0 ? String(k.totalServicesCompletedToday) : '—', note: k.totalServicesCompletedToday > 0 ? undefined : tx('pos.pending_data') },
    { l: tx('pos.total_commission_est'), v: money(k.estimatedCommissionCents) },
    { l: tx('pos.pending_approvals'), v: '—', note: tx('pos.pending_data') },
    { l: tx('pos.open_positions'), v: '—', note: tx('pos.pending_data') },
  ];

  const trows = s.rows.items;
  const ts = s.teamSummary;
  // Role tabs: counts for the whole team (server); picking one asks the SERVER for that role (§34) — the rows on screen
  // are already that role's page
  const roleCounts: Record<string, number> = ts?.roleCounts ? { ...ts.roleCounts } : {};
  if (!ts) for (const r of trows) { const rl = r.role || 'Unassigned'; roleCounts[rl] = (roleCounts[rl] || 0) + 1; }
  const roleTabs = ['All Members', ...Object.keys(roleCounts).sort()];
  const visibleRows = trows;
  const allMembersCount = ts?.roleCounts ? Object.values(ts.roleCounts).reduce((a, n) => a + n, 0) : null;
  // Today's shift overview (status breakdown — real working/shift status, no time windows in the schema)
  // whole-team numbers from the server's KPIs (the list on screen is one page)
  const shiftBreakdown = [
    { label: 'On Shift', count: k.availableNow + k.inService },
    { label: 'On Break', count: k.onBreak },
    { label: tx('pos.off_not_clocked_in'), count: k.offToday },
  ];
  // Team productivity (from KPIs — real)
  const teamRevenueCents = k.todaySalesCents;
  const rb = ts?.ratingBuckets ?? { excellent: 0, veryGood: 0, good: 0, needs: 0, unrated: 0 };
  if (!ts) for (const r of trows) { const v = r.rating; if (v == null) rb.unrated++; else if (v >= 4.5) rb.excellent++; else if (v >= 3.5) rb.veryGood++; else if (v >= 2.5) rb.good++; else rb.needs++; }
  const ratingRows = [
    { l: tx('pos.excellent_4_5_5_0'), n: rb.excellent }, { l: tx('pos.very_good_3_5_4_4'), n: rb.veryGood },
    { l: tx('pos.good_2_5_3_4'), n: rb.good }, { l: tx('pos.needs_improvement_2_5'), n: rb.needs },
  ];
  const attendanceRows = [
    { l: tx('pos.available_now_2'), n: k.availableNow }, { l: tx('pos.in_service'), n: k.inService },
    { l: tx('pos.on_break'), n: k.onBreak }, { l: tx('pos.off_today'), n: k.offToday },
  ];
  const topPerformers = ts ? ts.topPerformers : [...trows].filter((r) => r.todaySalesCents > 0).sort((a, b) => b.todaySalesCents - a.todaySalesCents).slice(0, 5);
  const loadedServices = ts ? ts.servicesMapped : trows.reduce((acc, r) => acc + (r.servicesCount || 0), 0);
  const pg = s.rows.pagination; const totalPages = Math.max(1, pg.totalPages ?? 1); const curPage = Math.min(Math.max(1, pg.page ?? page), totalPages);
  const teamInsights: { id: string; text: string; severity: 'info' | 'warn' }[] = [];
  if (k.offToday > 0) teamInsights.push({ id: 'off', text: tx('pos.offtoday_team_member_v1_off_today_13zu', { offToday: String(k.offToday), plural: String(k.offToday === 1 ? ' is' : tx('pos.s_are')) }), severity: 'warn' });
  if (rb.needs > 0) teamInsights.push({ id: 'low', text: tx('pos.needs_team_member_plural_rated_below_np4a', { needs: String(rb.needs), plural: String(rb.needs === 1 ? '' : 's') }), severity: 'warn' });
  if (k.onBreak > 0) teamInsights.push({ id: 'break', text: tx('pos.onbreak_team_member_v1_on_break_2xfn', { onBreak: String(k.onBreak), plural: String(k.onBreak === 1 ? ' is' : tx('pos.s_are')) }), severity: 'info' });
  if (topPerformers[0]) teamInsights.push({ id: 'top', text: tx('pos.top_seller_so_far_today_displayname_ih4f', { displayName: String(topPerformers[0].displayName), todaySalesCents: String(money(topPerformers[0].todaySalesCents)) }), severity: 'info' });

  return (
    <div className="work">
      <div className="mb-6 flex flex-col sm:flex-row gap-3 justify-between ">
        <div className='vh'><h1>{tx('pos.technicians')}</h1><div className="sub">{tx('pos.team_roster_status')}{' '}{s.rows.pagination.totalItems} {tx('pos.technicians_2')}</div></div>
       <div className="" style={{ display: 'flex', gap: 8 }}>
        {can('pos.technicians.import') ? <button className="btn ghost" onClick={() => { setImportOpen((v) => !v); setNote(null); }}>{importOpen ? tx('pos.close_import') : tx('pos.import')}</button> : null}
        <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => { setCreateOpen((v) => !v); setNote(null); }}>{createOpen ? tx('pos.close') : tx('pos.new_technician')}</button>
      </div>
      </div> 

      {askLcUi}{confirmLcUi}
      {note ? <div className="err" style={{ marginBottom: 12 }}>{note}</div> : null}

      {createOpen ? (
        <section className="panel">
          <h2>{tx('pos.new_technician')}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
            <input placeholder={tx('pos.first_name_2')} value={cFirst} onChange={(e) => setCFirst(e.target.value)} style={inputStyle} />
            <input placeholder={tx('pos.last_name')} value={cLast} onChange={(e) => setCLast(e.target.value)} style={inputStyle} />
            <input placeholder={tx('pos.phone')} value={cPhone} onChange={(e) => setCPhone(e.target.value)} style={inputStyle} />
            <input placeholder={tx('pos.email')} value={cEmail} onChange={(e) => setCEmail(e.target.value)} style={inputStyle} />
            <select value={cStatus} onChange={(e) => setCStatus(e.target.value)} style={inputStyle}>
              <option value="active">{tx('pos.active')}</option><option value="inactive">{tx('pos.inactive')}</option>
            </select>
            <button className="btn" disabled={busy === 'create' || !!(found?.found && found.alreadyAtThisSalon)} onClick={createTechnician}>
              {busy === 'create' ? tx('pos.saving_2') : found?.found ? tx('pos.invite_this_technician') : tx('pos.create_2')}
            </button>
          </div>

          {looking ? <div className="state" style={{ fontSize: 12, marginTop: 8 }}>{tx('pos.checking_whether_this_technician_already_has_iaqf')}</div> : null}

          {found?.found ? (
            <div style={{ marginTop: 10, border: '1px solid var(--gold, #A96F22)', borderRadius: 10, padding: 10, background: '#FBF6EE' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                {found.avatarUrl ? <img src={found.avatarUrl} alt="" width={40} height={40} style={{ borderRadius: 999, objectFit: 'cover' }} /> : null}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{found.displayName} <span style={{ opacity: 0.6, fontWeight: 400 }}>{found.techCode}</span></div>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>
                    {found.overallRating != null ? `${found.overallRating.toFixed(1)}★ (${found.ratingCount})` : tx('pos.no_rating_yet')}
                    {found.portfolioPhotoCount ? tx('pos.portfoliophotocount_portfolio_photos', { portfolioPhotoCount: String(found.portfolioPhotoCount) }) : ''}
                    {found.yearsExperience ? tx('pos.yearsexperience_yrs', { yearsExperience: String(found.yearsExperience) }) : ''}
                    {/* A COUNT, never the salon names — where else she works is not this salon's business. */}
                    {found.activeSalonCount ? tx('pos.works_at_activesaloncount_salon_plural', { activeSalonCount: String(found.activeSalonCount), plural: String(found.activeSalonCount === 1 ? '' : 's') }) : ''}
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 12, marginTop: 8, lineHeight: 1.45 }}>
                {found.alreadyAtThisSalon
                  ? <b>{tx('pos.she_already_works_at_this_salon')}</b>
                  : <>{tx('pos.this_technician_already_has_an_aipowersalon_1ddg')}{' '}<b>{tx('pos.she_must_accept_before_she_appears_g8l5')}</b>{tx('pos.your_schedule_pay_and_customer_notes_19w2')}</>}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {invite ? (
        <section className="panel" style={{ borderColor: invite.deliveryStatus === 'delivered' ? '#2E6B47' : '#A96F22' }}>
          {invite.deliveryStatus === 'delivered' ? (
            <div style={{ fontSize: 13 }}>
              {tx('pos.invitation_sent_by')}{' '}{invite.channel === 'sms' ? 'text message' : 'email'}{tx('pos.she_sets_her_own_password_her_gunl')}
            </div>
          ) : (
            <>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{tx('pos.the_invitation_could_not_be_sent_ceep')}</div>
              <div className="state" style={{ fontSize: 12, margin: '4px 0 8px' }}>
                {tx('pos.no_email_or_sms_sender_is_tt0w')}
              </div>
              {invite.acceptUrl ? (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input readOnly value={invite.acceptUrl} onFocus={(e) => e.currentTarget.select()}
                    style={{ flex: 1, padding: '6px 8px', border: '1px solid #E3D8C6', borderRadius: 8, fontSize: 12, fontFamily: 'monospace' }} />
                  <button className="btn ghost" onClick={() => { void navigator.clipboard?.writeText(invite.acceptUrl!); setNote(tx('pos.invite_link_copied')); }}>{tx('pos.copy')}</button>
                </div>
              ) : null}
            </>
          )}
          <button className="btn ghost" style={{ marginTop: 8, fontSize: 11 }} onClick={() => setInvite(null)}>{tx('pos.dismiss')}</button>
        </section>
      ) : null}

      {importOpen ? <TechnicianImportPanel onImported={() => load({})} onClose={() => setImportOpen(false)} /> : null}
      <MembershipRequestsPanel onChanged={() => load({})} />
      <ProfileChangeRequestsPanel />
      <PendingTimeOffPanel names={Object.fromEntries((s.rows.items || []).map((t) => [t.technicianId, t.displayName]))} onChanged={refetch} />

      <div className="kpis">
        {kpis.map((c) => (<div className="kpi" key={c.l}><div className="l">{c.l}</div><div className="v">{c.v}</div>{c.note ? <div className="s" style={{ marginTop: 2 }}>{c.note}</div> : null}</div>))}
      </div>

      <div className="s" style={{ margin: '-4px 0 12px', color: 'var(--muted)' }}>
        {tx('pos.today_s_totals_sales')}{' '}{money(k.todaySalesCents)} {tx('pos.tips_4')}{' '}{money(k.todayTipsCents)} {tx('pos.services_loaded')}{' '}{loadedServices}
      </div>

     <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3 m-3.5">
        {teamInsights.length > 0 ? (
          <section className="panel" style={{ flex: '1 1 320px', minWidth: 280, marginBottom: 0 }}>
            <h2>{tx('pos.ai_team_insights')}</h2>
            <div className="list">
              {teamInsights.map((ins) => (
                <div className="row" key={ins.id}>
                  <span className={'pill ' + (ins.severity === 'warn' ? 'warn' : '')} style={{ flex: 'none' }}>{ins.severity === 'warn' ? '!' : 'i'}</span>
                  <div className="t" style={{ marginLeft: 8 }}>{ins.text}</div>
                </div>
              ))}
            </div>
          </section>
        ) : null}
        <section className="panel" style={{ flex: '1 1 200px', minWidth: 190, marginBottom: 0 }}>
          <h2>{tx('pos.team_attendance_today')}</h2>
          {attendanceRows.map((r) => (
            <div key={r.l} className="row mb-2" style={{ justifyContent: 'space-between' }}><span className="t">{r.l}</span><span className="pill">{r.n}</span></div>
          ))}
        </section>
        <section className="panel" style={{ flex: '1 1 220px', minWidth: 200, marginBottom: 0 }}>
          <h2>{tx('pos.performance_overview')}</h2>
          <div className="s" style={{ color: 'var(--muted)', marginBottom: 6 }}>{tx('pos.ratings_across')}{' '}{trows.length} {tx('pos.loaded_member')}{enPlural(trows.length === 1 ? '' : 's')}</div>
          {ratingRows.map((r) => (
            <div key={r.l} className="row mb-2" style={{ justifyContent: 'space-between' }}><span className="t">{r.l}</span><span className="pill">{r.n}</span></div>
          ))}
          {rb.unrated > 0 ? <div className="s" style={{ color: 'var(--muted)', marginTop: 4 }}>{rb.unrated} {tx('pos.not_yet_rated')}</div> : null}
        </section>
        <section className="panel" style={{ flex: '1 1 220px', minWidth: 200, marginBottom: 0 }}>
          <h2>{tx('pos.top_performers_today')}</h2>
          {topPerformers.length === 0 ? <div className="muted">{tx('pos.no_sales_recorded_yet_today')}</div> : topPerformers.map((r, i) => (
            <div key={r.technicianId} className="row" style={{ justifyContent: 'space-between' }}>
              <span className="t">{i + 1}. {r.displayName}{r.rating != null ? ` · ${r.rating.toFixed(1)}★` : ''}</span>
              <span className="r">{money(r.todaySalesCents)}</span>
            </div>
          ))}
        </section>
      </div>

      <section className="panel">
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <ImeSafeInput placeholder={tx('pos.search_name_phone_email')} value={search} onValue={setSearch}
            style={{ flex: 1, minWidth: 200, height: 36, border: '1px solid var(--line)', borderRadius: 10, padding: '0 12px', background: '#FFFDF8', fontFamily: 'inherit', fontSize: 13 }} />
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={selStyle}>
            <option value="">{tx('pos.all_statuses')}</option>
            {s.filterFacets.statuses.map((x) => <option key={x} value={x}>{codeLabel(`people.techs.status.${x}`, x)}</option>)}
          </select>
          <select value={shiftStatus} onChange={(e) => setShiftStatus(e.target.value)} style={selStyle} title={tx('pos.filter_by_shift_status')}>
            <option value="">{tx('pos.all_shifts_2')}</option>
            {s.filterFacets.shiftStatuses.map((x) => <option key={x} value={x}>{statusLabel('teamMember', x)}</option>)}
          </select>
          {(s.filterFacets.branches?.length ?? 0) > 1 ? (
            <select aria-label={tx('pos.branch_filter')} value={branchId} onChange={(e) => setBranchId(e.target.value)} style={selStyle}>
              <option value="">{tx('pos.all_branches')}</option>
              {(s.filterFacets.branches ?? []).map((b) => <option key={b.branchId} value={b.branchId}>{b.name}</option>)}
            </select>
          ) : null}
          <button
            type="button"
            className={'btn ' + (missingMapping ? '' : 'ghost')}
            onClick={() => setMissingMapping((v) => !v)}
            style={{ padding: '0 12px', fontSize: 12.5, whiteSpace: 'nowrap' }}
            title={tx('pos.show_only_technicians_with_no_services_1y8f')}
          >
            {tx('pos.missing_service_mapping')}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '4px 0 10px' }}>
          {roleTabs.map((rt) => (
            <button key={rt} onClick={() => setRoleTab(rt)} className={'btn ' + (roleTab === rt ? '' : 'ghost')} style={{ padding: '5px 12px', fontSize: 12.5 }}>
              {serverText(rt)}{rt !== 'All Members' ? ` (${roleCounts[rt]})` : ` (${allMembersCount ?? pg.totalItems})`}
            </button>
          ))}
        </div>

        <div role="navigation" aria-label={tx('pos.team_pages')} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '6px 0 10px' }}>
          <button type="button" className="btn ghost" disabled={curPage <= 1} onClick={() => setPage(1)} style={{ padding: '4px 10px', fontSize: 12 }}>{tx('pos.first_page')}</button>
          <button type="button" className="btn ghost" disabled={curPage <= 1} onClick={() => setPage(curPage - 1)} style={{ padding: '4px 10px', fontSize: 12 }}>{tx('pos.previous')}</button>
          <span style={{ fontSize: 12.5, fontWeight: 700 }}>{tx('pos.page_x_of_y', { page: String(curPage), pages: String(totalPages) })} · {pg.totalItems} {tx('pos.technicians_2')}</span>
          <button type="button" className="btn ghost" disabled={curPage >= totalPages} onClick={() => setPage(curPage + 1)} style={{ padding: '4px 10px', fontSize: 12 }}>{tx('pos.next')} ›</button>
          <button type="button" className="btn ghost" disabled={curPage >= totalPages} onClick={() => setPage(totalPages)} style={{ padding: '4px 10px', fontSize: 12 }}>{tx('pos.last_page')}</button>
          <select aria-label={tx('pos.rows_per_page')} value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} style={{ ...inputStyle, marginLeft: 'auto' }}>
            {[25, 50, 100].map((n) => <option key={n} value={n}>{n} / {tx('pos.page').trim()}</option>)}
          </select>
        </div>

  <div className="w-full overflow-x-auto lg:overflow-x-visible">
  <div className="list min-w-[900px] lg:min-w-0 max-h-[calc(100vh-320px)]">
          {visibleRows.length === 0 ? <div className="muted">{tx('pos.no_technicians_match')}</div> : null}
          {visibleRows.map((t) => (
            <div key={t.technicianId} style={{ borderBottom: '1px solid var(--line)' }}>

              <div className="row" style={{ borderBottom: 'none' }}>
                <div style={{ minWidth: 150, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ProfileAvatarWithPreview name={t.displayName} url={(t as any).avatarUrl} size={32} type="technician" subtitle={t.skillGroups.join(', ') || undefined} />
                  <div>
                    <div className="t">{t.displayName} {t.rating ? <span className="s">· {t.rating.toFixed(1)}★</span> : null}</div>
                    <div className="s">{t.skillGroups.join(', ') || '—'} · {t.servicesCount} {tx('pos.services_5')}</div>
                  </div>
                </div>
                <span className={'pill ' + stTone(t.status)}>{codeLabel(`people.techs.status.${t.status}`, t.status)}</span>
                <span className={'pill ' + wsTone(t.workingStatus)}>{codeLabel(`people.techs.working.${t.workingStatus}`, t.workingStatus)}</span>
                {wf[t.technicianId] ? <span className={'pill ' + (wf[t.technicianId].queue === 'AVAILABLE' ? 'ok' : wf[t.technicianId].queue === 'UNAVAILABLE' || wf[t.technicianId].queue === 'OFF_SHIFT' ? '' : 'warn')} title={tx('pos.queue_status_can_take_a_walk_vpvn')}>{QUEUE_LABEL()[wf[t.technicianId].queue] ?? statusLabel('queueItem', wf[t.technicianId].queue)}</span> : null}
                {t.techAppEnabled ? <span className="pill ok">{tx('pos.app')}</span> : <span className="pill" style={{ opacity: .5 }}>{tx('pos.no_app_2')}</span>}
                {t.canProcessPayment ? <span className="pill">{tx('pos.pay')}</span> : null}
                <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                  <div className="r">{money(t.todaySalesCents)}</div>
                  <div className="s">{money(t.todayTipsCents)} {tx('pos.tips_5')}{' '}{money(t.estimatedCommissionCents)} {tx('pos.comm_2')}</div>
                </div>
                {/* Technician Profile page (§8/§141): overview cards + every section; the drawer stays reachable from it */}
                <button className="btn ghost" style={{ marginLeft: 8 }} onClick={() => nav(`/technicians/${encodeURIComponent(t.technicianId)}`)}>{tx('pos.profile_2')}</button>
                <button className="btn ghost" style={{ marginLeft: 4 }} onClick={() => openEdit(t)}>{editId === t.technicianId ? tx('pos.close') : tx('pos.edit')}</button>
              </div>

              {editId === t.technicianId ? (
                <div style={{ padding: '4px 4px 12px' }}>
                  <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 10, background: '#FFFDF8', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, alignItems: 'center' }}>
                    <input placeholder={tx('pos.full_name')} value={eName} onChange={(e) => setEName(e.target.value)} style={inputStyle} />
                    <input placeholder={tx('pos.phone')} value={ePhone} onChange={(e) => setEPhone(e.target.value)} style={inputStyle} />
                    <input placeholder={tx('pos.email')} value={eEmail} onChange={(e) => setEEmail(e.target.value)} style={inputStyle} />
                    <input placeholder={tx('pos.commission_0_100')} value={eComm} onChange={(e) => setEComm(e.target.value)} inputMode="decimal" style={inputStyle} />
                    <button className="btn" disabled={busy === t.technicianId} onClick={() => saveEdit(t.technicianId)}>{busy === t.technicianId ? tx('pos.saving_2') : tx('pos.save_2')}</button>
                  </div>
                  {/* Lifecycle (workforce audit #24): each change is an ACCESS change — login, membership, live sessions and the
                      kiosk PIN follow it server-side (the revocation chain) — so it is its own explicit, audited action. */}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }} aria-label={tx('pos.technician_lifecycle')}>
                    <span className="s">{tx('pos.status_2')}{' '}<b>{codeLabel(`people.techs.status.${t.status}`, t.status)}</b></span>
                    {t.status === 'active' ? <>
                      <button className="btn ghost" disabled={busy === 'lc' + t.technicianId} onClick={() => askLc(tx('people.techs.suspendWhy'), (reason) => { void lifecycle(t.technicianId, () => posTechniciansApi.suspend(t.technicianId, { reason })); }, { confirmLabel: tx('pos.suspend'), inputLabel: tx('pos.reason_2') })}>{tx('pos.suspend')}</button>
                      <button className="btn ghost" disabled={busy === 'lc' + t.technicianId} onClick={() => confirmLc(tx('people.techs.deactivateConfirm', { name: t.displayName }), () => { void lifecycle(t.technicianId, () => posTechniciansApi.update(t.technicianId, { status: 'inactive' })); }, { confirmLabel: tx('pos.deactivate') })}>{tx('pos.deactivate')}</button>
                      <button className="btn ghost" disabled={busy === 'lc' + t.technicianId} onClick={() => confirmLc(tx('people.techs.archiveConfirmLong', { name: t.displayName }), () => { void lifecycle(t.technicianId, () => posTechniciansApi.archive(t.technicianId)); }, { confirmLabel: tx('pos.archive') })}>{tx('pos.archive')}</button>
                    </> : t.status === 'inactive' ? <>
                      <button className="btn" disabled={busy === 'lc' + t.technicianId} onClick={() => lifecycle(t.technicianId, () => posTechniciansApi.activate(t.technicianId))}>{tx('pos.activate')}</button>
                      <button className="btn ghost" disabled={busy === 'lc' + t.technicianId} onClick={() => confirmLc(tx('people.techs.archiveConfirm', { name: t.displayName }), () => { void lifecycle(t.technicianId, () => posTechniciansApi.archive(t.technicianId)); }, { confirmLabel: tx('pos.archive') })}>{tx('pos.archive')}</button>
                    </> : <button className="btn" disabled={busy === 'lc' + t.technicianId} onClick={() => lifecycle(t.technicianId, () => posTechniciansApi.reactivate(t.technicianId))}>{tx('pos.reactivate')}</button>}
                  </div>
                  <div className="s" style={{ marginTop: 4 }}>{tx('pos.app_access_payment_permission_use_separate_1aq7')}</div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
        </div>
      </section>

     <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3 mt-3.5">
        <section className="panel">
          <h2>{tx('pos.team_productivity')}{' '}<span className="s">{tx('pos.today_5')}</span></h2>
          <div className="list">
            <div className="row"><div className="t" style={{ flex: 1 }}>{tx('pos.services_completed')}</div><div style={{ marginLeft: 'auto', fontWeight: 700 }}>{k.totalServicesCompletedToday}</div></div>
            <div className="row"><div className="t" style={{ flex: 1 }}>{tx('pos.revenue_generated')}</div><div style={{ marginLeft: 'auto', fontWeight: 700 }}>{money(teamRevenueCents || k.todaySalesCents)}</div></div>
            <div className="row"><div className="t" style={{ flex: 1 }}>{tx('pos.commission_est')}</div><div style={{ marginLeft: 'auto', fontWeight: 700 }}>{money(k.estimatedCommissionCents)}</div></div>
            <div className="row"><div className="t" style={{ flex: 1 }}>{tx('pos.tips_today')}</div><div style={{ marginLeft: 'auto', fontWeight: 700 }}>{money(k.todayTipsCents)}</div></div>
          </div>
        </section>
        <section className="panel">
          <h2>{tx('pos.today_s_shift_overview')}</h2>
          <div className="list">
            {shiftBreakdown.map((x) => (
              <div className="row" key={x.label}>
                <div className="t" style={{ flex: 1 }}>{serverText(x.label)}</div>
                <span className={'pill ' + (x.label === 'On Shift' ? 'ok' : x.label === 'On Break' ? 'warn' : '')} style={{ marginLeft: 'auto' }}>{x.count}</span>
              </div>
            ))}
          </div>
          <div className="s" style={{ marginTop: 8, color: '#8A7A66' }}>{tx('pos.shift_windows_morning_afternoon_evening_need_md3a')}</div>
        </section>
        <section className="panel">
          <h2>{tx('pos.upcoming_birthdays')}</h2>
          <div className="muted">{tx('pos.team_birthdays_aren_t_recorded_on_gl90')}</div>
        </section>
        <section className="panel">
          <h2>{tx('pos.training_certifications')}</h2>
          <div className="muted">{tx('pos.certification_training_tracking_isn_t_set_muui')}</div>
          <div style={{ marginTop: 8 }}><button className="btn ghost" onClick={() => nav('/tenant/team/profiles')}>{tx('pos.open_technician_profiles')}</button></div>
        </section>
      </div>

      {/* Admin Authorization Code Modal */}
      {authModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: '#FFF', borderRadius: 12, padding: 20, width: 400, maxWidth: '90%', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 700, color: '#111827' }}>{tx('pos.admin_authorization_required')}</h3>
            <p style={{ margin: '0 0 14px', fontSize: 12.5, color: '#4B5563', lineHeight: 1.4 }}>
              {tx('pos.to_change')}{' '}<b>{authModal.name}’s</b> {tx('pos.commission_from')}{' '}<b>{authModal.origComm}%</b> {tx('pos.to')}{' '}<b>{authModal.targetComm}%</b>{tx('pos.enter_your_super_admin_authorization_code')}
            </p>
            {authErr && (
              <div style={{ fontSize: 12, color: '#DC2626', background: '#FEE2E2', border: '1px solid #FCA5A5', padding: '6px 10px', borderRadius: 8, marginBottom: 12, fontWeight: 600 }}>
                {authErr}
              </div>
            )}
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
              {tx('pos.admin_authorization_code')}
            </label>
            <input
              type="text"
              placeholder={tx('pos.e_g_auth_comm_1234')}
              value={authCode}
              onChange={(e) => setAuthCode(e.target.value)}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #D1D5DB', borderRadius: 8, fontSize: 13, marginBottom: 16, boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn ghost" style={{ padding: '6px 14px', fontSize: 12 }} onClick={() => setAuthModal(null)}>{tx('pos.cancel')}</button>
              <button className="btn" disabled={busy === authModal.id} style={{ padding: '6px 14px', fontSize: 12 }} onClick={() => performSaveEdit(authModal.id, authModal.targetComm, authCode)}>
                {busy === authModal.id ? tx('pos.validating') : tx('pos.authorize_save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const selStyle: React.CSSProperties = { height: 36, border: '1px solid var(--line)', borderRadius: 10, padding: '0 10px', background: '#FFFDF8', fontFamily: 'inherit', fontSize: 12.5, color: 'var(--text)' };
