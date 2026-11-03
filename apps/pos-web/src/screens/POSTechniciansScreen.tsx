// POSTechniciansScreen.tsx — Team → Technicians (/technicians). Technicians Management Center rebuild (Oct 30 2026), one
// vertical scroll that keeps every module of both photographed views:
//   header (Refresh · Find Qualified & Available · Service Mapping · Import · New Technician) · ONE search (name · phone in
//   any format · email · ID · role · mapped service) · Today / Week / Month / Year / Custom with the date field it filters
//   the eight KPIs (two rows of four), each saying what it counts — Active Accounts is NOT "working today"; Scheduled Today,
//   On Shift Now and Available Now are separate figures · AI Team Insights (rules over the numbers, never an automatic change)
//   · Team Attendance Today · Performance Overview (bands + Unrated, with sample sizes) · Top Performers (rated only)
//   the Technician Directory: All Members / role tabs, status, shift, Missing Service Mapping, rating band, newest first,
//   numbered pages, Profile and Edit per row (the existing edit / commission authorization / lifecycle actions)
//   Team Productivity Today · Today's Shift Overview · Upcoming Birthdays (not recorded — nothing invented) · Training &
//   Certifications (stored records with expiry) · Approvals (membership, profile and time-off requests)
//   the three priority flows: Full Technician Profile Overlay · Find Qualified & Available Technician · Service Mapping
//   Assistant · and the paged Activity History.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { teamCreatedPath } from './teamUrlState';
import { useInlineAsk, useInlineConfirm } from '@aipowersalon/ui';
import { ProfileAvatarWithPreview } from '@aipowersalon/ui';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { MembershipRequestsPanel } from '../components/MembershipRequestsPanel';
import { ProfileChangeRequestsPanel } from '../components/ProfileChangeRequestsPanel';
import { TechnicianImportPanel } from '../components/TechnicianImportPanel';
import { PendingTimeOffPanel } from '../components/PendingTimeOffPanel';
import { useCan } from '../components/usePermissions';
import { posTechniciansApi } from '../api/posTechniciansApi';
import { posTechniciansScreenApi } from '../api/posTeamScreensApi';
import { posWorkforceApi } from '../api/posWorkforceApi';
import { codeLabel } from '../components/peopleLabels';
import { fmtMoney } from '../i18n/format';
import { FitPanel, KpiCard, Pager, Empty, useDebounced, requestId } from '../components/FitKit';
import { PeriodBar, periodQuery, useLoad, StateBlock, isForbidden, type PeriodState } from '../components/FinanceKit';
import { TechnicianProfileOverlay, QualifiedFinder, MappingAssistant, HistoryTable, nf, pageOf, ratingText, roleText, WORK_TONE } from './technicianScreenParts';
import { deviceToday } from '../lib/deviceToday';

type InviteResult = { created: boolean; channel?: string | null; deliveryStatus?: string | null; acceptUrl?: string | null; reason?: string | null };
type FoundTech = { found: false } | { found: true; techCode: string; displayName: string; avatarUrl: string | null; yearsExperience: number | null; overallRating: number | null; ratingCount: number; portfolioPhotoCount: number; alreadyAtThisSalon: boolean; activeSalonCount: number; platformStatus: string };
/** kept for callers that size the roster (200-technician mandate §34) */
export const TEAM_PAGE_SIZE = 8;
/** the directory's first page size: 8 rows (6 on a short window, 1366×633) so the whole panel — tools, rows, pager — fits one screen */
const firstPageSize = () => (typeof window !== 'undefined' && window.innerHeight < 700 ? 6 : TEAM_PAGE_SIZE);
const inputStyle: React.CSSProperties = { height: 40, border: '1px solid var(--line)', borderRadius: 9, padding: '0 10px', background: '#FFFDF8', fontFamily: 'inherit', fontSize: 13, color: 'var(--text)' };
const STATUSES = ['current', 'active', 'inactive', 'suspended', 'archived', 'all'];
const SHIFTS = ['all', 'available', 'in_service', 'on_break', 'on_shift', 'scheduled', 'off'];
const SORTS = ['newest', 'name', 'rating', 'services', 'oldest'];
const BANDS = ['excellent', 'very_good', 'good', 'needs', 'unrated'];

export function POSTechniciansScreen() {
  const nav = useNavigate(); const can = useCan();
  const canEdit = can('technicians.edit'); const canPay = can('technicians.view_pay');
  const [search, setSearch] = useState(''); const q = useDebounced(search.trim(), 300);
  const [period, setPeriod] = useState<PeriodState>({ preset: 'today' }); const [dirPeriod, setDirPeriod] = useState<PeriodState>({ preset: 'all' }); const [dateField, setDateField] = useState('created');
  const [role, setRole] = useState(''); const [status, setStatus] = useState('current'); const [shift, setShift] = useState('all'); const [missingMapping, setMissingMapping] = useState(false);
  const [band, setBand] = useState(''); const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(firstPageSize); const [hp, setHp] = useState(1); const [cp, setCp] = useState(1); const [certState, setCertState] = useState('all');
  const [tick, setTick] = useState(0); const reload = () => setTick((n) => n + 1);
  const [note, setNote] = useState<string | null>(null); const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [profile, setProfile] = useState<string | null>(null); const [finder, setFinder] = useState(false); const [mapping, setMapping] = useState<{ id: string | null } | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [eName, setEName] = useState(''); const [ePhone, setEPhone] = useState(''); const [eEmail, setEEmail] = useState(''); const [eComm, setEComm] = useState('');
  // TM-03 (Oct 30 2026): Team Management's + Add Team Member opens the form here (?new=1&returnTo=team) and comes back to the
  // team list with ?created=<id>; one Idempotency-Key per create intent so a retried save never makes a second technician
  const [sp] = useSearchParams(); const returnToTeam = sp.get('returnTo') === 'team';
  const [createOpen, setCreateOpen] = useState(() => sp.get('new') === '1'); const [importOpen, setImportOpen] = useState(false);
  const [createKey, setCreateKey] = useState(() => requestId());
  const [cFirst, setCFirst] = useState(''); const [cLast, setCLast] = useState(''); const [cPhone, setCPhone] = useState(''); const [cEmail, setCEmail] = useState(''); const [cStatus, setCStatus] = useState('active');
  const [found, setFound] = useState<FoundTech | null>(null); const [looking, setLooking] = useState(false); const [invite, setInvite] = useState<InviteResult | null>(null);
  const [origComm, setOrigComm] = useState<number>(0);
  const [authModal, setAuthModal] = useState<{ id: string; targetComm: number; origComm: number; name: string } | null>(null);
  const [authCode, setAuthCode] = useState(''); const [authErr, setAuthErr] = useState<string | null>(null);

  const scope = { q: q || undefined, role: role || undefined, status, shift, missingMapping: missingMapping ? '1' : undefined, band: band || undefined, sort, dateField, ...periodQuery(dirPeriod) };
  const key = JSON.stringify(scope);
  useEffect(() => setPage(1), [key, pageSize]);
  const dash = useLoad(() => posTechniciansScreenApi.dashboard(periodQuery(period)), [JSON.stringify(period), tick]);
  const dir = useLoad(() => posTechniciansScreenApi.directory({ ...scope, page, pageSize }), [key, page, pageSize, tick]);
  const hist = useLoad(() => posTechniciansScreenApi.history({ q: q || undefined, ...periodQuery(dirPeriod), page: hp, pageSize: 8 }), [q, JSON.stringify(dirPeriod), hp, tick]);
  const certs = useLoad(() => posTechniciansScreenApi.certifications({ state: certState, page: cp, pageSize: 5 }), [certState, cp, tick]);
  useEffect(() => { const p = dir.data?.page; if (p && p !== page) setPage(p); }, [dir.data]);   // eslint-disable-line react-hooks/exhaustive-deps
  const refetch = () => reload();
  // live fallback (no socket here): every 45 s compare the ONE workforce state with what is on screen; a change reloads
  const [stamp, setStamp] = useState<string | null>(null);
  useEffect(() => {
    const id = setInterval(() => {
      Promise.resolve(posWorkforceApi.branchStates()).then((xs) => {
        const sig = (Array.isArray(xs) ? xs : []).map((x) => `${x.technicianId}:${x.queue}:${x.shift}:${x.clock}`).sort().join('|');
        setStamp((old) => { if (old !== null && old !== sig) reload(); return sig; });
      }).catch(() => undefined);
    }, 45_000);
    return () => clearInterval(id);
  }, []);    
  void stamp;
  const k = dash.data?.kpis; const rows: any[] = dir.data?.items ?? [];
  const filtered = !!(q || role || status !== 'current' || shift !== 'all' || missingMapping || band || sort !== 'newest' || dirPeriod.preset !== 'all');
  const clearAll = () => { setSearch(''); setRole(''); setStatus('current'); setShift('all'); setMissingMapping(false); setBand(''); setSort('newest'); setDirPeriod({ preset: 'all' }); };
  const toDirectory = (f: { shift?: string; band?: string; missing?: boolean }) => { clearAll(); if (f.shift) setShift(f.shift); if (f.band) setBand(f.band); if (f.missing) setMissingMapping(true); document.querySelector('[data-testid="directory"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

  const openEdit = async (t: any) => {
    if (editId === t.technicianId) { setEditId(null); return; }
    setEditId(t.technicianId); setNote(null);
    setEName(t.name || ''); setEPhone(t.contactMasked ? '' : t.phone || ''); setEEmail(t.email || '');
    setEComm('...');
    try { const commData: any = await posTechniciansApi.commission(t.technicianId); const pct = Number(commData?.defaultPercent ?? 0); setOrigComm(pct); setEComm(String(pct)); }
    catch { setOrigComm(0); setEComm(''); }
  };
  const saveEdit = async (id: string) => {
    if (!eName.trim()) { setNote(tx('pos.name_is_required')); return; }
    let commission: number | undefined;
    if (eComm.trim() && eComm !== '...') { const n = Number(eComm); if (!Number.isFinite(n) || n < 0 || n > 100) { setNote(tx('pos.commission_must_be_0_100')); return; } commission = n; }
    // a commission change needs the admin authorization code (Commission Security Control)
    if (commission !== undefined && commission !== origComm) { setAuthErr(null); setAuthCode(''); const t = rows.find((r) => r.technicianId === id); setAuthModal({ id, targetComm: commission, origComm, name: t?.name || tx('glossary.people.technician') }); return; }
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
      if (commission !== undefined && codeToUse) await posTechniciansApi.setCommission(id, { defaultPercent: commission, adminAuthCode: codeToUse });
      // no `status` here: a lifecycle change revokes / restores access server-side, so it is its own audited action
      await posTechniciansApi.update(id, { fullName: eName.trim(), ...(ePhone.trim() ? { phone: ePhone.trim() } : {}), ...(eEmail.trim() ? { email: eEmail.trim() } : {}), ...(commission !== undefined ? { commissionSplitPercent: commission } : {}) });
      setEditId(null); setAuthModal(null); setOk(tx('tc.saved', { name: eName.trim() })); await refetch();
    } catch (e: any) { const msg = e?.message || tx('pos.save_failed'); setNote(msg); if (authModal) setAuthErr(msg); }
    finally { setBusy(null); }
  };
  // one person, one account: typing a phone or email that already belongs to a technician shows her, never mints a second
  useEffect(() => {
    if (!createOpen) { setFound(null); return; }
    const phone = cPhone.trim(); const email = cEmail.trim();
    if (phone.replace(/\D/g, '').length < 7 && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setFound(null); return; }
    let live = true;
    const t = setTimeout(async () => { setLooking(true); try { const r = await posTechniciansApi.lookup({ ...(phone ? { phone } : {}), ...(email ? { email } : {}) }) as FoundTech; if (live) setFound(r); } catch { if (live) setFound(null); } finally { if (live) setLooking(false); } }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [createOpen, cPhone, cEmail]);
  const createTechnician = async () => {
    if (!cFirst.trim() || !cLast.trim()) { setNote(tx('pos.first_and_last_name_are_required')); return; }
    setNote(null); setBusy('create');
    try {
      const r = await posTechniciansApi.create({ firstName: cFirst.trim(), lastName: cLast.trim(), status: cStatus, ...(cPhone.trim() ? { phone: cPhone.trim() } : {}), ...(cEmail.trim() ? { email: cEmail.trim() } : {}) }, createKey) as { technicianId?: string; linkedExistingProfile?: boolean; globalTechCode?: string; membershipStatus?: string; invite?: InviteResult };
      setCreateKey(requestId());   // the next create is a new intent
      if (returnToTeam && r?.technicianId && !r.linkedExistingProfile) { nav(teamCreatedPath(r.technicianId, sp.get('back'))); return; }
      setCreateOpen(false); setCFirst(''); setCLast(''); setCPhone(''); setCEmail(''); setCStatus('active'); setFound(null);
      setInvite(r?.invite?.created ? r.invite : null);
      if (r?.linkedExistingProfile) setNote(r.membershipStatus === 'active' ? tx('pos.linked_to_existing_technician_globaltechcode', { globalTechCode: String(r.globalTechCode) }) : tx('pos.invitation_sent_to_globaltechcode_she_keeps_vc4a', { globalTechCode: String(r.globalTechCode) }));
      else setOk(tx('tc.created'));
      // the new technician is newest — show page 1 of the unfiltered directory, where she is first
      clearAll(); setPage(1); await refetch();
    } catch (e: any) { setNote(e?.message || tx('pos.create_failed')); }
    finally { setBusy(null); }
  };
  const load = useCallback((_: unknown) => reload(), []);

  if (isForbidden(dash.error)) return <div className="work mos tcs" data-testid="technicians-screen"><h1>{tx('pos.technicians')}</h1><StateBlock error={dash.error} onRetry={dash.reload} /></div>;
  const a = dash.data?.attendance; const b = dash.data?.bands; const pr = dash.data?.productivityToday; const so = dash.data?.shiftOverview; const ce = dash.data?.certifications;
  const money = (c: number | null | undefined) => (c == null ? '—' : fmtMoney(c));
  return (
    <div className="work mos tcs" data-testid="technicians-screen">
      <header className="fk-head">
        <div className="vh" style={{ marginBottom: 0, minWidth: 0 }}><h1>{tx('tc.title')}</h1><div className="sub">{tx('tc.sub')}</div></div>
        <div className="fk-head-actions">
          <button type="button" className="fk-btn" onClick={reload} data-testid="refresh">{tx('finance.refresh')}</button>
          <button type="button" className="fk-btn ghost" onClick={() => setFinder(true)} data-testid="open-finder">{tx('tc.finder')}</button>
          {canEdit ? <button type="button" className="fk-btn ghost" onClick={() => setMapping({ id: null })} data-testid="open-mapping">{tx('tc.mapping')}</button> : null}
          {can('technicians.edit') ? <button type="button" className="fk-btn ghost" onClick={() => { setImportOpen((v) => !v); setNote(null); }} data-testid="import">{importOpen ? tx('pos.close_import') : tx('pos.import')}</button> : null}
          {canEdit ? <button type="button" className="fk-btn primary" onClick={() => { setCreateOpen((v) => !v); setNote(null); }} data-testid="new-technician">{createOpen ? tx('pos.close') : tx('pos.new_technician')}</button> : null}
        </div>
      </header>
      {askLcUi}{confirmLcUi}
      {note ? <div className="fk-note bad" role="alert" data-testid="note"><span>{note}</span><button type="button" className="fk-x" aria-label={tx('pos.dismiss')} onClick={() => setNote(null)}>✕</button></div> : null}
      {ok ? <div className="fk-note ok" role="status" data-testid="ok"><span>{ok}</span><button type="button" className="fk-x" aria-label={tx('pos.dismiss')} onClick={() => setOk(null)}>✕</button></div> : null}
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
            <button className="fk-btn primary" disabled={busy === 'create' || !!(found?.found && found.alreadyAtThisSalon)} onClick={createTechnician}>
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
                  <button className="fk-btn ghost" onClick={() => { void navigator.clipboard?.writeText(invite.acceptUrl!); setNote(tx('pos.invite_link_copied')); }}>{tx('pos.copy')}</button>
                </div>
              ) : null}
            </>
          )}
          <button className="fk-btn ghost" style={{ marginTop: 8, fontSize: 11 }} onClick={() => setInvite(null)}>{tx('pos.dismiss')}</button>
        </section>
      ) : null}

      {importOpen ? <TechnicianImportPanel onImported={() => load({})} onClose={() => setImportOpen(false)} /> : null}

      <div className="mos-tools" data-testid="toolbar">
        <div className="fn-search mos-search"><input className="fk-search wide" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tx('tc.searchPh')} aria-label={tx('tc.searchPh')} data-testid="search" onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }} />
          {search ? <button type="button" className="fk-x" aria-label={tx('finance.clearSearch')} onClick={() => setSearch('')} data-testid="search-clear">✕</button> : null}</div>
      </div>
      <div className="fn-tabsrow dsc-periodrow">
        <PeriodBar value={period} onChange={setPeriod} server={dash.data?.period} compact />
      </div>
      <div className="fk-hint mos-scope">{tx('tc.periodRule')}</div>

      <div className="fk-kpis cg-kpis" data-testid="kpis">
        {dash.error ? <StateBlock error={dash.error} onRetry={dash.reload} /> : <>
          <KpiCard testId="kpi-team" label={tx('pos.total_team_members')} loading={!k} value={k ? nf(k.totalTeam) : ''} sub={tx('tc.kpi.teamSub')} onClick={clearAll} />
          <KpiCard testId="kpi-active" label={tx('tc.kpi.activeAccounts')} loading={!k} value={k ? nf(k.activeAccounts) : ''} sub={k ? tx('tc.kpi.activeSub', { s: nf(k.scheduledToday) }) : ''} onClick={() => toDirectory({ shift: 'scheduled' })} />
          <KpiCard testId="kpi-on-shift" tone="ok" label={tx('pos.on_shift_now')} loading={!k} value={k ? nf(k.onShiftNow) : ''} sub={k ? tx('tc.kpi.onShiftSub', { a: nf(k.availableNow), c: nf(k.clockedIn) }) : ''} onClick={() => toDirectory({ shift: 'on_shift' })} />
          <KpiCard testId="kpi-rating" tone="gold" label={tx('pos.avg_performance_score_2')} loading={!k} value={k ? (k.avgRating == null ? '—' : `${k.avgRating.toFixed(1)} / 5`) : ''} sub={k ? (k.ratingCount ? tx('tc.kpi.ratingSub', { n: nf(k.ratingCount), t: nf(k.ratedTechnicians) }) : tx('tc.kpi.noRatings')) : ''} />
        </>}
      </div>
      <div className="fk-kpis cg-kpis" data-testid="kpis-2">
        {dash.error ? null : <>
          <KpiCard testId="kpi-services" label={tx('pos.total_services_completed')} loading={!k} value={k ? nf(k.servicesCompleted) : ''} sub={tx('tc.kpi.servicesSub')} />
          <KpiCard testId="kpi-commission" label={tx('pos.total_commission_est')} loading={!k} value={k ? money(k.commissionEstCents) : ''} sub={k ? (k.commissionEstCents == null ? tx('tc.kpi.noPay') : k.commissionLinesWithoutSnapshot ? tx('tc.kpi.commNoSnap', { n: nf(k.commissionLinesWithoutSnapshot) }) : tx('tc.kpi.commSub')) : ''} onClick={canPay ? () => nav('/tenant/reports/commission') : undefined} />
          <KpiCard testId="kpi-approvals" tone={k && k.pendingApprovals ? 'warn' : undefined} label={tx('pos.pending_approvals')} loading={!k} value={k ? nf(k.pendingApprovals) : ''} sub={k ? tx('tc.kpi.approvalsSub', { s: nf(k.approvals.skills), t: nf(k.approvals.timeOff), p: nf(k.approvals.profile + k.approvals.membership) }) : ''} onClick={() => document.querySelector('[data-testid="approvals"]')?.scrollIntoView({ behavior: 'smooth' })} />
          <KpiCard testId="kpi-positions" label={tx('pos.open_positions')} loading={!k} value="—" sub={tx('tc.kpi.notConfigured')} />
        </>}
      </div>

      <div className="mos-row two cg-row">
        <FitPanel testId="insights" title={tx('pos.ai_team_insights')}>
          {!dash.data ? <div className="fk-loading">{tx('pos.loading')}</div> : dash.data.insights.length === 0 ? <Empty title={tx('tc.noInsights')} />
            : <ul className="fk-list dense" data-testid="insight-list">{dash.data.insights.map((i: any) => <li key={i.kind} className="fk-li"><span className={'fk-chip ' + (i.severity === 'warn' ? 'warn' : 'info')}>{i.severity === 'warn' ? '!' : 'i'}</span>
              <span className="fk-li-t">{tx('tc.ins.' + i.kind, { n: nf(i.n) })}<span className="fk-li-s">{tx('tc.ins.' + i.kind + '.why')}</span></span>
              <button type="button" className="fk-btn ghost sm" data-testid={'insight-' + i.kind} onClick={() => i.action === 'mapping' ? setMapping({ id: null }) : i.action === 'shift' ? toDirectory({ shift: 'scheduled' }) : i.action === 'unrated' ? toDirectory({ band: 'unrated' }) : i.action === 'certs' ? setCertState('expiring') : i.action === 'schedule' ? nav('/technicians/schedule') : document.querySelector('[data-testid="approvals"]')?.scrollIntoView({ behavior: 'smooth' })}>{tx('tc.view')}</button></li>)}</ul>}
          <div className="fk-hint">{tx('tc.insightsRule')}</div>
        </FitPanel>
        <FitPanel testId="attendance" title={tx('pos.team_attendance_today')}>
          {!a ? <div className="fk-loading">{tx('pos.loading')}</div> : <ul className="fk-list dense" data-testid="attendance-list">{([['available', a.availableNow, 'ok'], ['in_service', a.inService, 'info'], ['on_break', a.onBreak, 'warn'], ['off', a.offToday, 'mut']] as const).map(([s0, n, tone]) =>
            <li key={s0} className="fk-li"><span className="fk-li-t">{tx('tc.work.' + s0)}</span><button type="button" className={'fk-chip ' + tone} onClick={() => toDirectory({ shift: s0 })} data-testid={'att-' + s0}>{nf(n)}</button></li>)}</ul>}
          {a ? <div className="fk-hint">{tx('tc.attRule', { s: nf(a.scheduledToday), c: nf(a.clockedIn) })}</div> : null}
        </FitPanel>
      </div>
      <div className="mos-row two cg-row">
        <FitPanel testId="performance" title={tx('pos.performance_overview')}>
          {!b ? <div className="fk-loading">{tx('pos.loading')}</div> : <ul className="fk-list dense">{BANDS.map((x) => <li key={x} className="fk-li"><span className="fk-li-t">{tx('tc.band.' + x)}</span>
            <button type="button" className={'fk-chip ' + (x === 'needs' ? 'warn' : x === 'unrated' ? 'mut' : 'ok')} onClick={() => toDirectory({ band: x })} data-testid={'band-' + x}>{nf(b[x === 'very_good' ? 'veryGood' : x])}</button></li>)}</ul>}
          <div className="fk-hint">{tx('tc.bandRule')}</div>
        </FitPanel>
        <FitPanel testId="top-performers" title={tx('tc.topPerformers')}>
          {!dash.data ? <div className="fk-loading">{tx('pos.loading')}</div> : dash.data.topPerformers.length === 0 ? <Empty title={tx('tc.noTop')} />
            : <ul className="fk-list dense" data-testid="top-list">{dash.data.topPerformers.map((t: any, i: number) => <li key={t.technicianId} className="fk-li"><span className="fk-li-t">{i + 1}. {t.name}<span className="fk-li-s">{ratingText(t.rating, t.ratingCount)} · {tx('tc.servicesN', { n: nf(t.servicesCompleted) })}</span></span>
              <button type="button" className="fk-btn ghost sm" onClick={() => setProfile(t.technicianId)}>{tx('pos.profile_2')}</button></li>)}</ul>}
          <div className="fk-hint">{tx('tc.topRule')}</div>
        </FitPanel>
      </div>

      <FitPanel testId="directory" className="tc-dir" title={<>{tx('tc.directory')}{dir.data ? <span className="fk-muted"> · {tx('cg.matching', { n: nf(dir.data.totalItems) })}</span> : null}</>}
        footer={<Pager info={pageOf(dir.data)} onPage={setPage} label={tx('tc.directory')} />}>
        <div className="fk-seg tc-roles" role="tablist" aria-label={tx('tc.roles')}>
          <button type="button" role="tab" aria-selected={!role} className={!role ? 'on' : ''} onClick={() => setRole('')} data-testid="role-all">{tx('tc.allMembers')} ({nf(dir.data?.roles?.all)})</button>
          {(dir.data?.roles?.byRole ?? []).map((r: any) => <button key={r.role} type="button" role="tab" aria-selected={role === r.role} className={role === r.role ? 'on' : ''} onClick={() => setRole(r.role)} data-testid={'role-' + r.role}>{roleText(r.role)} ({nf(r.count)})</button>)}
        </div>
        <div className="mos-tools">
          <select className="fk-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={tx('pos.status')} data-testid="status">{STATUSES.map((x) => <option key={x} value={x}>{tx('tc.statusF.' + x)}</option>)}</select>
          <select className="fk-select" value={shift} onChange={(e) => setShift(e.target.value)} aria-label={tx('tc.shift')} data-testid="shift">{SHIFTS.map((x) => <option key={x} value={x}>{tx('tc.shiftF.' + x)}</option>)}</select>
          <select className="fk-select" value={band} onChange={(e) => setBand(e.target.value)} aria-label={tx('tc.bandF')} data-testid="band"><option value="">{tx('tc.bandF.all')}</option>{BANDS.map((x) => <option key={x} value={x}>{tx('tc.band.' + x)}</option>)}</select>
          <select className="fk-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label={tx('cg.sort')} data-testid="sort">{SORTS.map((x) => <option key={x} value={x}>{tx('tc.sort.' + x)}</option>)}</select>
          <button type="button" className={'fk-btn ' + (missingMapping ? 'primary' : 'ghost')} aria-pressed={missingMapping} onClick={() => setMissingMapping((v) => !v)} data-testid="missing-mapping">{tx('pos.missing_service_mapping')}{k ? ` (${nf(k.missingServiceMapping)})` : ''}</button>
          <select className="fk-select" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} aria-label={tx('pos.rows_per_page')} data-testid="page-size">{[...new Set([firstPageSize(), 8, 25, 50])].map((n) => <option key={n} value={n}>{tx('tc.perPage', { n: String(n) })}</option>)}</select>
          {filtered ? <button type="button" className="fk-link" onClick={clearAll} data-testid="clear-all">{tx('finance.clearFilters')}</button> : null}
        </div>
        <div className="fn-tabsrow dsc-periodrow"><PeriodBar value={dirPeriod} onChange={setDirPeriod} server={dir.data?.period} allowAll compact basis={dateField} basisOptions={['created', 'updated'].map((f) => ({ value: f, label: tx('tc.df.' + f) }))} onBasis={setDateField} /></div>
        {dir.error ? <StateBlock error={dir.error} onRetry={dir.reload} /> : !dir.data ? <div className="fk-loading">{tx('pos.loading_technicians')}</div>
          : rows.length === 0 ? (filtered ? <Empty title={q ? tx('cg.noMatchSearch', { q }) : tx('cg.noMatch')}><button type="button" className="fk-btn" onClick={clearAll} data-testid="empty-clear">{tx('finance.clearFilters')}</button></Empty> : <Empty title={tx('tc.noTeam')} />)
          : <table className="fk-table fn-table cg-table" data-testid="directory-table">
            <thead><tr><th>{tx('tc.col.technician')}</th><th>{tx('tc.col.now')}</th><th className="t-opt">{tx('tc.col.shift')}</th><th>{tx('tc.col.services')}</th><th>{tx('tc.col.rating')}</th><th className="t-opt">{tx('tc.col.app')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
            <tbody>{rows.map((t: any) => [
              <tr key={t.technicianId} data-testid="tech-row" className="inv2-click" onClick={() => setProfile(t.technicianId)}>
                <td><div className="tc-who"><ProfileAvatarWithPreview name={t.name} url={t.avatarUrl} size={34} type="technician" /><span><span className="fk-li-t">{t.name}</span>
                  <span className="fk-li-s">{roleText(t.role)} · {t.code}{t.branchName ? ` · ${t.branchName}` : ''}{t.matchedVia ? ` · ${tx('tc.via.' + t.matchedVia)}${t.matchedServices?.length ? ': ' + t.matchedServices.join(', ') : ''}` : ''}</span></span></div></td>
                <td><span className={'fk-chip ' + (WORK_TONE[t.working] ?? 'mut')} data-testid="work-chip">{tx('tc.work.' + t.working)}</span><span className="fk-li-s">{tx('tc.account.' + t.status)}</span></td>
                <td className="t-opt">{t.shiftToday ?? <span className="fk-muted">{tx('tc.noShiftToday')}</span>}{t.shiftSource ? <span className="fk-li-s">{tx('tc.shiftSrc.' + t.shiftSource)}</span> : null}</td>
                <td>{t.missingMapping ? <span className="fk-chip warn">{tx('tc.noMapping')}</span> : tx('tc.qualifiedN', { n: nf(t.qualifiedServices) })}<span className="fk-li-s">{tx('tc.todayN', { n: nf(t.servicesToday) })}</span></td>
                <td>{ratingText(t.rating, t.ratingCount)}</td>
                <td className="t-opt"><span className={'fk-chip ' + (t.app === 'connected' ? 'ok' : t.app === 'invited' ? 'info' : 'mut')}>{tx('tc.app.' + t.app)}</span></td>
                <td className="fn-acts" onClick={(e) => e.stopPropagation()}>
                  <button type="button" className="fk-btn ghost sm" onClick={() => setProfile(t.technicianId)} data-testid="row-profile">{tx('pos.profile_2')}</button>
                  {canEdit ? <button type="button" className="fk-btn ghost sm" onClick={() => openEdit(t)} data-testid="row-edit">{editId === t.technicianId ? tx('pos.close') : tx('pos.edit')}</button> : null}
                </td>
              </tr>,
              editId === t.technicianId ? <tr key={t.technicianId + '-edit'} className="tc-edit"><td colSpan={7}>{editDrawer({ ...t, displayName: t.name })}</td></tr> : null,
            ])}</tbody>
          </table>}
      </FitPanel>

      <div className="mos-row two cg-row">
        <FitPanel testId="productivity" title={tx('tc.productivityToday')}>
          {!pr ? <div className="fk-loading">{tx('pos.loading')}</div> : <ul className="fk-list dense" data-testid="productivity-list">
            <li className="fk-li"><span className="fk-li-t">{tx('pos.services_completed')}</span><b>{nf(pr.servicesCompleted)}</b></li>
            <li className="fk-li"><span className="fk-li-t">{tx('pos.revenue_generated')}</span><b>{money(pr.revenueCents)}</b></li>
            <li className="fk-li"><span className="fk-li-t">{tx('pos.commission_est')}</span><b>{money(pr.commissionEstCents)}</b></li>
            <li className="fk-li"><span className="fk-li-t">{tx('pos.tips_today')}</span><b>{money(pr.tipsCents)}</b></li></ul>}
          <div className="fk-hint">{pr && pr.revenueCents == null ? tx('tc.kpi.noPay') : tx('tc.prodRule')}</div>
        </FitPanel>
        <FitPanel testId="shift-overview" title={tx('pos.today_s_shift_overview')}>
          {!so ? <div className="fk-loading">{tx('pos.loading')}</div> : <ul className="fk-list dense" data-testid="shift-list">
            <li className="fk-li"><span className="fk-li-t">{tx('tc.so.onShift')}</span><button type="button" className="fk-chip ok" onClick={() => toDirectory({ shift: 'on_shift' })}>{nf(so.onShift)}</button></li>
            <li className="fk-li"><span className="fk-li-t">{tx('tc.so.onBreak')}</span><button type="button" className="fk-chip warn" onClick={() => toDirectory({ shift: 'on_break' })}>{nf(so.onBreak)}</button></li>
            <li className="fk-li"><span className="fk-li-t">{tx('pos.off_not_clocked_in')}</span><button type="button" className="fk-chip mut" onClick={() => toDirectory({ shift: 'off' })}>{nf(so.offOrNotClockedIn)}</button></li></ul>}
          {so ? <div className="fk-hint">{tx('tc.soRule', { s: nf(so.scheduledToday), c: nf(so.clockedIn) })}</div> : null}
        </FitPanel>
      </div>
      <div className="mos-row two cg-row">
        <FitPanel testId="birthdays" title={tx('pos.upcoming_birthdays')}><Empty title={tx('tc.birthdaysNone')} /><div className="fk-hint">{tx('tc.birthdaysRule')}</div></FitPanel>
        <FitPanel testId="certifications" title={<>{tx('pos.training_certifications')}{ce ? <span className="fk-muted"> · {tx('tc.certSum', { v: nf(ce.valid), e: nf(ce.expiringSoon), x: nf(ce.expired) })}</span> : null}</>}
          actions={<select className="fk-select" value={certState} onChange={(e) => { setCertState(e.target.value); setCp(1); }} aria-label={tx('tc.certState')} data-testid="cert-state">{['all', 'valid', 'expiring', 'expired'].map((x) => <option key={x} value={x}>{tx('tc.certF.' + x)}</option>)}</select>}
          footer={<Pager info={pageOf(certs.data)} onPage={setCp} compact />}>
          {certs.error ? <StateBlock error={certs.error} onRetry={certs.reload} /> : !certs.data ? <div className="fk-loading">{tx('pos.loading')}</div> : certs.data.items.length === 0 ? <Empty title={tx('tc.noCerts')} />
            : <ul className="fk-list dense" data-testid="cert-list">{certs.data.items.map((c: any) => <li key={c.id} className="fk-li"><span className="fk-li-t">{c.name} · {c.technician}<span className="fk-li-s">{c.issuer ?? '—'} · {c.expiresAt ? tx('tc.expires', { d: c.expiresAt }) : tx('tc.noExpiry')}</span></span>
              <span className={'fk-chip ' + (c.revoked ? 'bad' : c.expiresAt && c.expiresAt < certs.data.today ? 'bad' : c.verified ? 'ok' : 'mut')}>{c.revoked ? tx('tc.cert.revoked') : c.expiresAt && c.expiresAt < certs.data.today ? tx('tc.cert.expired') : c.verified ? tx('tc.cert.verified') : tx('tc.cert.unverified')}</span></li>)}</ul>}
          <div className="cg-acts"><button type="button" className="fk-btn ghost" onClick={() => nav('/tenant/team/profiles')}>{tx('pos.open_technician_profiles')}</button></div>
        </FitPanel>
      </div>

      <section data-testid="approvals" className="tc-approvals">
        <MembershipRequestsPanel onChanged={() => load({})} />
        <ProfileChangeRequestsPanel />
        <PendingTimeOffPanel names={Object.fromEntries(rows.map((t: any) => [t.technicianId, t.name]))} onChanged={refetch} />
      </section>

      <div className="mos-row three">
        <button type="button" className="fk-panel tc-cta" onClick={() => rows[0] && setProfile(rows[0].technicianId)} disabled={!rows.length} data-testid="cta-profile"><b>{tx('tc.cta.profile')}</b><span>{tx('tc.cta.profileSub')}</span></button>
        <button type="button" className="fk-panel tc-cta" onClick={() => setFinder(true)} data-testid="cta-finder"><b>{tx('tc.finder')}</b><span>{tx('tc.finderSub')}</span></button>
        <button type="button" className="fk-panel tc-cta" onClick={() => setMapping({ id: null })} disabled={!canEdit} data-testid="cta-mapping"><b>{tx('tc.mapping')}</b><span>{tx('tc.mappingSub')}</span></button>
      </div>

      <FitPanel testId="activity" title={<>{tx('tc.activity')}{hist.data ? <span className="fk-muted"> · {tx('cg.matching', { n: nf(hist.data.totalItems) })}</span> : null}</>} footer={<Pager info={pageOf(hist.data)} onPage={setHp} label={tx('tc.activity')} />}>
        {hist.error ? <StateBlock error={hist.error} onRetry={hist.reload} /> : !hist.data ? <div className="fk-loading">{tx('pos.loading')}</div> : hist.data.items.length === 0 ? <Empty title={tx('tc.noHistory')} /> : <HistoryTable rows={hist.data.items} />}
        <div className="fk-hint">{tx('tc.activityRule')}</div>
      </FitPanel>

      {profile ? <TechnicianProfileOverlay technicianId={profile} canPay={canPay} canEdit={canEdit} onClose={() => setProfile(null)}
        onEdit={() => { const t = rows.find((r) => r.technicianId === profile); setProfile(null); if (t) void openEdit(t); }} onMapping={() => { const id = profile; setProfile(null); setMapping({ id }); }} /> : null}
      {finder ? <QualifiedFinder today={dash.data?.period?.today ?? deviceToday()} onClose={() => setFinder(false)} /> : null}
      {mapping ? <MappingAssistant initialTechnicianId={mapping.id} onClose={() => setMapping(null)} onSaved={(m) => { setMapping(null); setOk(m); reload(); }} /> : null}

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
              <button className="fk-btn ghost" style={{ padding: '6px 14px', fontSize: 12 }} onClick={() => setAuthModal(null)}>{tx('pos.cancel')}</button>
              <button className="fk-btn primary" disabled={busy === authModal.id} style={{ padding: '6px 14px', fontSize: 12 }} onClick={() => performSaveEdit(authModal.id, authModal.targetComm, authCode)}>
                {busy === authModal.id ? tx('pos.validating') : tx('pos.authorize_save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // a render helper, not a component: the inputs keep their focus while typing
  function editDrawer(t: any) {
    return (
      <div className="tc-edit-body">
        <div className="tc-edit-grid">
          <input placeholder={tx('pos.full_name')} value={eName} onChange={(e) => setEName(e.target.value)} style={inputStyle} data-testid="edit-name" />
          <input placeholder={tx('pos.phone')} value={ePhone} onChange={(e) => setEPhone(e.target.value)} style={inputStyle} />
          <input placeholder={tx('pos.email')} value={eEmail} onChange={(e) => setEEmail(e.target.value)} style={inputStyle} />
          <input placeholder={tx('pos.commission_0_100')} value={eComm} onChange={(e) => setEComm(e.target.value)} inputMode="decimal" style={inputStyle} disabled={!canPay} />
          <button className="fk-btn primary" disabled={busy === t.technicianId} onClick={() => saveEdit(t.technicianId)} data-testid="edit-save">{busy === t.technicianId ? tx('pos.saving_2') : tx('pos.save_2')}</button>
        </div>
                  {/* Lifecycle (workforce audit #24): each change is an ACCESS change — login, membership, live sessions and the
                      kiosk PIN follow it server-side (the revocation chain) — so it is its own explicit, audited action. */}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }} aria-label={tx('pos.technician_lifecycle')}>
                    <span className="s">{tx('pos.status_2')}{' '}<b>{codeLabel(`people.techs.status.${t.status}`, t.status)}</b></span>
                    {t.status === 'active' ? <>
                      <button className="fk-btn ghost sm" disabled={busy === 'lc' + t.technicianId} onClick={() => askLc(tx('people.techs.suspendWhy'), (reason) => { void lifecycle(t.technicianId, () => posTechniciansApi.suspend(t.technicianId, { reason })); }, { confirmLabel: tx('pos.suspend'), inputLabel: tx('pos.reason_2') })}>{tx('pos.suspend')}</button>
                      <button className="fk-btn ghost sm" disabled={busy === 'lc' + t.technicianId} onClick={() => confirmLc(tx('people.techs.deactivateConfirm', { name: t.displayName }), () => { void lifecycle(t.technicianId, () => posTechniciansApi.update(t.technicianId, { status: 'inactive' })); }, { confirmLabel: tx('pos.deactivate') })}>{tx('pos.deactivate')}</button>
                      <button className="fk-btn ghost sm" disabled={busy === 'lc' + t.technicianId} onClick={() => confirmLc(tx('people.techs.archiveConfirmLong', { name: t.displayName }), () => { void lifecycle(t.technicianId, () => posTechniciansApi.archive(t.technicianId)); }, { confirmLabel: tx('pos.archive') })}>{tx('pos.archive')}</button>
                    </> : t.status === 'inactive' ? <>
                      <button className="fk-btn sm" disabled={busy === 'lc' + t.technicianId} onClick={() => lifecycle(t.technicianId, () => posTechniciansApi.activate(t.technicianId))}>{tx('pos.activate')}</button>
                      <button className="fk-btn ghost sm" disabled={busy === 'lc' + t.technicianId} onClick={() => confirmLc(tx('people.techs.archiveConfirm', { name: t.displayName }), () => { void lifecycle(t.technicianId, () => posTechniciansApi.archive(t.technicianId)); }, { confirmLabel: tx('pos.archive') })}>{tx('pos.archive')}</button>
                    </> : <button className="fk-btn sm" disabled={busy === 'lc' + t.technicianId} onClick={() => lifecycle(t.technicianId, () => posTechniciansApi.reactivate(t.technicianId))}>{tx('pos.reactivate')}</button>}
                  </div>
                  <div className="s" style={{ marginTop: 4 }}>{tx('pos.app_access_payment_permission_use_separate_1aq7')}</div>
      </div>
    );
  }
}
