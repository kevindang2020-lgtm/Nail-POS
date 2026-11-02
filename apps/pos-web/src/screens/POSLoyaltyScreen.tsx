// POSLoyaltyScreen.tsx — Customers → Loyalty & Rewards (/tenant/customers/loyalty). Loyalty & Rewards mandate (Oct 29
// 2026): ONE full-screen overview that fits the POS content area at 100 % zoom (no page scroll): header (Enroll Member ·
// Create Reward · Settings) · five KPI cards (each opens its list) · Members by Tier + Rewards Catalog · Loyalty Members +
// Recent Redemptions · a quick-action strip (Points Ledger · Manage Tiers · Reports · Settings).
// Every number is the server's (/pos/loyalty/overview — points from the ledger-synced balances; transaction counts for
// one labelled period, this month). Every list is newest first and paged ON THE SERVER; the page size is however many
// rows fit the panel right now (useFitRows), so a list never grows the page. After a create / enrol / redeem / adjust /
// void, the KPIs and the affected list reload and that list returns to Page 1, where the new record is.
// Writes: Enroll (pos.customers.loyalty.edit), Adjust points (+ reason, idempotent), Redeem (balance + reward checked
// server-side under the per-customer lock, idempotent), Void an issued code (owners / managers, reason, points restored
// through the ledger), Create / Edit / Activate rewards (owners / managers). Nothing here invents a tier: tiers are the
// labels the salon's members actually carry.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { parseDollarsToCents } from '@aipowersalon/money';
import { ProfileAvatarWithPreview } from '@aipowersalon/ui';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posLoyaltyApi, type RewardType } from '../api/posLoyaltyApi';
import { posCustomersApi } from '../api/posCustomersApi';
import { useCan } from '../components/usePermissions';
import { errorTextOf } from '../i18n/error-text';
import { fmtMoney, fmtNumber, fmtInZone } from '../i18n/format';
import { codeLabel } from '../components/peopleLabels';
import { FitDialog, FitPanel, KpiCard, Pager, Empty, ErrorRetry, useFitRows, requestId, useDebounced, type PageInfo } from '../components/FitKit';
import { RewardsNetworkPanel } from './loyalty/RewardsNetworkPanel';

type Overview = { period: { label: string; start: string; timeZone: string }; kpis: { loyaltyMembers: number; newMembersThisMonth: number; pointsOutstanding: number; ledgerBalance: number; balanceReconciled: boolean;
  activeRewards: number; totalRewards: number; redemptionsThisMonth: number; redemptionsPendingThisMonth: number; redemptionsUsedThisMonth: number; redemptionsVoidedThisMonth: number; pointsRedeemedThisMonth: number };
  tiers: { tier: string; members: number; pct: number; points: number }[] };
type Reward = { id: string; title: string; description: string; pointsCost: number; active: boolean; rewardType: RewardType; valueCents: number; percent: number; validDays: number | null; createdAt: string | null; redemptions: number; redemptionsThisMonth: number };
type Member = { customerId: string; customerName: string; avatarUrl: string | null; maskedPhone: string | null; tier: string; pointsBalance: number; totalEarned: number; totalRedeemed: number; enrolledAt: string | null; lastActivityAt: string | null };
type Redemption = { id: string; customerId: string; customerName: string; rewardId: string; rewardTitle: string; pointsSpent: number; status: 'issued' | 'applied' | 'used' | 'void'; createdAt: string | null; appliedAt: string | null; usedAt: string | null; voidedAt: string | null; ticketId: string | null; expiresAt: string | null };
type Ledger = { id: string; customerId: string; customerName: string; entryType: string; delta: number; balanceAfter: number; reason: string | null; sourceTable: string | null; createdAt: string | null };
type Paged<T> = PageInfo & { items: T[] };

const nf = (n: number) => fmtNumber(n || 0);
const when = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', year: 'numeric' }) || '—' : '—');
const whenTime = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) || '—' : '—');
const rewardValue = (r: Pick<Reward, 'rewardType' | 'valueCents' | 'percent'>) => (r.rewardType === 'percent_off' ? tx('people.loyalty.reward.percentOff', { n: String(r.percent) }) : tx('people.loyalty.reward.amountOff', { amount: fmtMoney(r.valueCents) }));
const redemptionStatus = (s: string) => codeLabel(`people.loyalty.redemption.status.${s}`, s);
const entryLabel = (s: string) => codeLabel(`people.loyalty.ledger.type.${s}`, s);
// a tier is the salon's own label (data); the common ones are worded in the cashier's language, any other shows as written
const tierLabel = (s: string) => { const k = `people.loyalty.tierName.${String(s).toLowerCase()}`; const v = tx(k); return v === k ? s : v; };
const errText = (e: any, fb: string) => errorTextOf(e, fb);
const TONE: Record<string, string> = { issued: 'warn', applied: 'info', used: 'ok', void: 'mut' };

/** One list's server state: filters → page 1; a reload key re-fetches without moving pages; stale answers are dropped. */
function useServerList<T, F extends Record<string, unknown>>(fetcher: (q: F & { page: number; pageSize: number }) => Promise<Paged<T>>, pageSize: number, initial: F) {
  const [filters, setFiltersState] = useState<F>(initial);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<T> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const seq = useRef(0);
  const fetchRef = useRef(fetcher); fetchRef.current = fetcher;
  useEffect(() => {
    const my = ++seq.current; setErr(null);
    fetchRef.current({ ...filters, page, pageSize }).then((d) => { if (my === seq.current) { setData(d); if (d.page !== page) setPage(d.page); } })
      .catch((e) => { if (my === seq.current) setErr(errText(e, tx('people.loyalty.loadFailed'))); });
  }, [filters, page, pageSize, reload]);
  return {
    data, err, page, filters,
    setPage, setFilters: (patch: Partial<F>) => { setFiltersState((f) => ({ ...f, ...patch })); setPage(1); },
    refresh: () => setReload((n) => n + 1), toFirst: () => { setPage(1); setReload((n) => n + 1); },
  };
}

/** Two views on one route: the salon's own program (unchanged) and the AI PowerSalon Rewards Network (?view=network). */
export function POSLoyaltyScreen() {
  const [sp, setSp] = useSearchParams();
  const view: 'program' | 'network' = sp.get('view') === 'network' ? 'network' : 'program';
  const switcher = (
    <div className="fk-seg ly-view" role="tablist" aria-label={tx('rn.view.label')} data-testid="loyalty-view">
      <button type="button" role="tab" aria-selected={view === 'program'} className={view === 'program' ? 'on' : ''} onClick={() => { const n = new URLSearchParams(sp); n.delete('view'); setSp(n, { replace: true }); }}>{tx('rn.view.program')}</button>
      <button type="button" role="tab" aria-selected={view === 'network'} className={view === 'network' ? 'on' : ''} data-testid="loyalty-view-network" onClick={() => { const n = new URLSearchParams(sp); n.set('view', 'network'); setSp(n, { replace: true }); }}>{tx('rn.view.network')}</button>
    </div>
  );
  if (view === 'network') {
    return (
      <div className="work fit ly rn" data-testid="loyalty-network-screen">
        <header className="fk-head">
          <div className="vh" style={{ marginBottom: 0, minWidth: 0 }}><h1>{tx('pos.loyalty_rewards')}</h1><div className="sub">{tx('rn.custom.sub')}</div></div>
          <div className="fk-head-actions">{switcher}</div>
        </header>
        <RewardsNetworkPanel />
      </div>
    );
  }
  return <LoyaltyProgramView switcher={switcher} />;
}

function LoyaltyProgramView({ switcher }: { switcher: ReactNode }) {
  const nav = useNavigate();
  const can = useCan();
  const canManage = can('settings.edit');             // rewards catalogue: pos.settings.edit (the loyalty module's existing rule)
  const canVoid = can('checkout.manage_overrides');   // voiding an issued code: pos.checkout.void → the override capability (owners / managers)
  const canEditPoints = can('customers.edit');        // pos.customers.loyalty.edit → customers.edit (unchanged policy)
  const [ov, setOv] = useState<Overview | null>(null);
  const [ovErr, setOvErr] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const loadOverview = useCallback(() => { setOvErr(null); posLoyaltyApi.overview().then(setOv).catch((e) => setOvErr(errText(e, tx('people.loyalty.loadFailed')))); }, []);
  useEffect(() => { loadOverview(); }, [loadOverview]);

  const catalogFit = useFitRows<HTMLDivElement>(46, { min: 2, max: 10 });
  const membersFit = useFitRows<HTMLDivElement>(46, { min: 2, max: 10 });
  const redFit = useFitRows<HTMLDivElement>(46, { min: 2, max: 10 });
  const rewards = useServerList<Reward, { status: string }>((q) => posLoyaltyApi.rewards({ page: q.page, pageSize: q.pageSize, status: q.status || undefined }), catalogFit.rows, { status: '' });
  const members = useServerList<Member, { tier: string; q: string }>((q) => posLoyaltyApi.members({ page: q.page, pageSize: q.pageSize, tier: q.tier || undefined, q: q.q || undefined }), membersFit.rows, { tier: '', q: '' });
  const reds = useServerList<Redemption, { status: string }>((q) => posLoyaltyApi.redemptions({ page: q.page, pageSize: q.pageSize, status: q.status || undefined }), redFit.rows, { status: '' });
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 300);
  useEffect(() => { if (debounced !== members.filters.q) members.setFilters({ q: debounced }); }, [debounced]);   // eslint-disable-line react-hooks/exhaustive-deps

  // overlays
  const [dlg, setDlg] = useState<null | { kind: 'enroll' } | { kind: 'reward'; reward?: Reward } | { kind: 'adjust'; member: Member } | { kind: 'redeem'; member: Member }
    | { kind: 'redemption'; id: string } | { kind: 'ledger'; customerId?: string; name?: string } | { kind: 'tiers' } | { kind: 'rewardRedemptions'; reward: Reward }>(null);
  const done = (text: string, lists: ('rewards' | 'members' | 'reds')[]) => {
    setNote({ tone: 'ok', text }); setDlg(null); loadOverview();
    if (lists.includes('rewards')) rewards.toFirst(); if (lists.includes('members')) members.toFirst(); if (lists.includes('reds')) reds.toFirst();
  };

  const k = ov?.kpis; const tiers = ov?.tiers ?? [];
  const tierMax = Math.max(1, ...tiers.map((t) => t.members));

  return (
    <div className="work fit ly" data-testid="loyalty-screen">
      <header className="fk-head">
        <div className="vh" style={{ marginBottom: 0, minWidth: 0 }}><h1>{tx('pos.loyalty_rewards')}</h1><div className="sub">{tx('people.loyalty.subtitle')}</div></div>
        <div className="fk-head-actions">
          {switcher}
          <button type="button" className="fk-btn ghost" onClick={() => setDlg({ kind: 'enroll' })} disabled={!canEditPoints} title={!canEditPoints ? tx('people.fit.noPermission') : undefined}>{tx('people.loyalty.enroll')}</button>
          <button type="button" className="fk-btn primary" onClick={() => setDlg({ kind: 'reward' })} disabled={!canManage} title={!canManage ? tx('people.fit.noPermission') : undefined}>{tx('people.loyalty.createReward')}</button>
          <button type="button" className="fk-btn ghost" onClick={() => nav('/settings?section=loyalty-memberships')}>{tx('pos.settings')}</button>
        </div>
      </header>
      {note ? <div className={'fk-note ' + note.tone} role="status"><span>{note.text}</span><button type="button" className="fk-x" aria-label={tx('pos.dismiss')} onClick={() => setNote(null)}>✕</button></div> : null}

      <div className="fk-kpis five" data-testid="loyalty-kpis">
        {ovErr ? <ErrorRetry message={ovErr} onRetry={loadOverview} /> : <>
          <KpiCard testId="kpi-members" label={tx('people.loyalty.kpi.members')} loading={!k} value={k ? nf(k.loyaltyMembers) : ''} sub={k ? tx('people.loyalty.kpi.newThisMonth', { n: nf(k.newMembersThisMonth) }) : ''} onClick={() => { members.setFilters({ tier: '', q: '' }); setSearch(''); }} />
          <KpiCard testId="kpi-points" label={tx('pos.points_outstanding')} loading={!k} value={k ? nf(k.pointsOutstanding) : ''} tone={k && !k.balanceReconciled ? 'warn' : 'gold'} sub={k ? (k.balanceReconciled ? tx('people.loyalty.kpi.ledgerMatches') : tx('people.loyalty.kpi.ledgerDiffers', { n: nf(k.ledgerBalance) })) : ''} onClick={() => setDlg({ kind: 'ledger' })} />
          <KpiCard testId="kpi-rewards" label={tx('pos.active_rewards')} loading={!k} value={k ? nf(k.activeRewards) : ''} sub={k ? tx('people.loyalty.kpi.ofRewards', { n: nf(k.totalRewards) }) : ''} onClick={() => rewards.setFilters({ status: 'active' })} />
          <KpiCard testId="kpi-redemptions" label={tx('people.loyalty.kpi.redemptions')} loading={!k} value={k ? nf(k.redemptionsThisMonth) : ''} sub={k ? tx('people.loyalty.kpi.redemptionsSub', { pending: nf(k.redemptionsPendingThisMonth), voided: nf(k.redemptionsVoidedThisMonth) }) : ''} onClick={() => reds.setFilters({ status: '' })} />
          <KpiCard testId="kpi-points-redeemed" label={tx('people.loyalty.kpi.pointsRedeemed')} loading={!k} value={k ? nf(k.pointsRedeemedThisMonth) : ''} sub={tx('people.loyalty.kpi.thisMonthNet')} onClick={() => setDlg({ kind: 'ledger' })} />
        </>}
      </div>

      <div className="fk-row two">
        <FitPanel testId="panel-tiers" title={tx('pos.members_by_tier')} actions={members.filters.tier ? <button type="button" className="fk-link" onClick={() => members.setFilters({ tier: '' })}>{tx('people.loyalty.showAllTiers')}</button> : <button type="button" className="fk-link" onClick={() => setDlg({ kind: 'tiers' })}>{tx('people.loyalty.viewTiers')}</button>}>
          {!ov ? <div className="fk-loading">{tx('pos.loading')}</div> : tiers.length === 0 ? <Empty title={tx('people.loyalty.noMembers')}>{canEditPoints ? <button type="button" className="fk-btn ghost" onClick={() => setDlg({ kind: 'enroll' })}>{tx('people.loyalty.enroll')}</button> : null}</Empty> : (
            <div className="ly-tiers" role="list">
              {tiers.map((t) => (
                <button type="button" role="listitem" key={t.tier} className={'ly-tier' + (members.filters.tier === t.tier ? ' on' : '')} onClick={() => members.setFilters({ tier: members.filters.tier === t.tier ? '' : t.tier })} aria-pressed={members.filters.tier === t.tier}>
                  <span className="ly-tier-top"><span className="ly-tier-name">{tierLabel(t.tier)}</span><span className="ly-tier-n">{tx('people.loyalty.tierShare', { n: nf(t.members), pct: String(t.pct) })}</span></span>
                  <span className="ly-bar" aria-hidden><span style={{ width: `${Math.max(2, Math.round((t.members / tierMax) * 100))}%` }} /></span>
                  <span className="ly-tier-sub">{tx('people.loyalty.tierPoints', { n: nf(t.points) })}</span>
                </button>
              ))}
              <div className="fk-hint">{tx('people.loyalty.tierHint')}</div>
            </div>
          )}
        </FitPanel>

        <FitPanel testId="panel-catalog" title={tx('pos.rewards_catalog')} bodyRef={catalogFit.ref}
          actions={<>
            <select aria-label={tx('pos.status')} className="fk-select" value={rewards.filters.status} onChange={(e) => rewards.setFilters({ status: e.target.value })}>
              <option value="">{tx('people.loyalty.allRewards')}</option><option value="active">{tx('pos.active_3')}</option><option value="inactive">{tx('people.loyalty.inactive')}</option>
            </select>
            {canManage ? <button type="button" className="fk-link" onClick={() => setDlg({ kind: 'reward' })}>{tx('people.loyalty.createReward')}</button> : null}
          </>}
          footer={<Pager compact info={rewards.data} onPage={rewards.setPage} />}>
          {rewards.err ? <ErrorRetry message={rewards.err} onRetry={rewards.refresh} /> : !rewards.data ? <div className="fk-loading">{tx('pos.loading')}</div> : rewards.data.items.length === 0 ? (
            rewards.filters.status ? <Empty title={tx('people.fit.noMatch')}><button type="button" className="fk-btn ghost" onClick={() => rewards.setFilters({ status: '' })}>{tx('pos.clear_all')}</button></Empty>
              : <Empty title={tx('people.loyalty.noRewards')}>{canManage ? <button type="button" className="fk-btn primary" onClick={() => setDlg({ kind: 'reward' })}>{tx('people.loyalty.createFirstReward')}</button> : <span className="fk-hint">{tx('people.fit.noPermission')}</span>}</Empty>
          ) : (
            <ul className="fk-list">
              {rewards.data.items.map((r) => (
                <li key={r.id} className="fk-li">
                  <div className="fk-li-main"><span className="fk-li-t">{r.title}</span><span className="fk-li-s">{rewardValue(r)} · {r.validDays ? tx('people.loyalty.validDays', { n: String(r.validDays) }) : tx('people.loyalty.noExpiry')} · {tx('people.loyalty.redeemedN', { n: nf(r.redemptions) })}</span></div>
                  <span className="fk-li-num">{tx('people.loyalty.pts', { n: nf(r.pointsCost) })}</span>
                  <span className={'fk-chip ' + (r.active ? 'ok' : 'mut')}>{r.active ? tx('pos.active_3') : tx('people.loyalty.inactive')}</span>
                  <span className="fk-li-acts">
                    <button type="button" className="fk-ibtn" onClick={() => setDlg({ kind: 'rewardRedemptions', reward: r })} aria-label={tx('people.loyalty.viewRedemptions')} title={tx('people.loyalty.viewRedemptions')}>≡</button>
                    {canManage ? <button type="button" className="fk-ibtn" onClick={() => setDlg({ kind: 'reward', reward: r })} aria-label={tx('pos.edit')} title={tx('pos.edit')}>✎</button> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </FitPanel>
      </div>

      <div className="fk-row two">
        <FitPanel testId="panel-members" title={tx('people.loyalty.members')} bodyRef={membersFit.ref}
          actions={<>
            <input type="search" className="fk-search" aria-label={tx('people.loyalty.searchMembers')} placeholder={tx('people.loyalty.searchMembers')} value={search} onChange={(e) => setSearch(e.target.value)} />
            {members.filters.tier ? <span className="fk-chip info">{tierLabel(members.filters.tier)} <button type="button" className="fk-chip-x" aria-label={tx('people.loyalty.showAllTiers')} onClick={() => members.setFilters({ tier: '' })}>✕</button></span> : null}
          </>}
          footer={<Pager compact info={members.data} onPage={members.setPage} />}>
          {members.err ? <ErrorRetry message={members.err} onRetry={members.refresh} /> : !members.data ? <div className="fk-loading">{tx('pos.loading')}</div> : members.data.items.length === 0 ? (
            members.filters.tier || members.filters.q ? <Empty title={tx('people.fit.noMatch')}><button type="button" className="fk-btn ghost" onClick={() => { members.setFilters({ tier: '', q: '' }); setSearch(''); }}>{tx('pos.clear_all')}</button></Empty>
              : <Empty title={tx('people.loyalty.noMembers')}>{canEditPoints ? <button type="button" className="fk-btn primary" onClick={() => setDlg({ kind: 'enroll' })}>{tx('people.loyalty.enroll')}</button> : null}</Empty>
          ) : (
            <ul className="fk-list">
              {members.data.items.map((m) => (
                <li key={m.customerId} className="fk-li">
                  <ProfileAvatarWithPreview name={m.customerName || '—'} url={m.avatarUrl ?? undefined} size={30} type="customer" />
                  <div className="fk-li-main">
                    <button type="button" className="fk-li-t link" onClick={() => nav(`/customers?customerId=${encodeURIComponent(m.customerId)}&q=${encodeURIComponent(m.customerName)}`)} title={tx('pos.open_profile')}>{m.customerName || '—'}</button>
                    <span className="fk-li-s">{tierLabel(m.tier)} · {tx('people.loyalty.enrolledOn', { date: when(m.enrolledAt) })}{m.lastActivityAt ? ` · ${tx('people.loyalty.lastActivity', { date: when(m.lastActivityAt) })}` : ''}</span>
                  </div>
                  <span className="fk-li-num">{tx('people.loyalty.pts', { n: nf(m.pointsBalance) })}</span>
                  <span className="fk-li-acts">
                    <button type="button" className="fk-ibtn" onClick={() => setDlg({ kind: 'redeem', member: m })} disabled={!canEditPoints} aria-label={tx('people.loyalty.redeem')} title={tx('people.loyalty.redeem')}>🎁</button>
                    <button type="button" className="fk-ibtn" onClick={() => setDlg({ kind: 'adjust', member: m })} disabled={!canEditPoints} aria-label={tx('people.loyalty.adjust')} title={tx('people.loyalty.adjust')}>±</button>
                    <button type="button" className="fk-ibtn" onClick={() => setDlg({ kind: 'ledger', customerId: m.customerId, name: m.customerName })} aria-label={tx('people.loyalty.pointHistory')} title={tx('people.loyalty.pointHistory')}>≡</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </FitPanel>

        <FitPanel testId="panel-redemptions" title={tx('pos.recent_redemptions')} bodyRef={redFit.ref}
          actions={<select aria-label={tx('pos.status')} className="fk-select" value={reds.filters.status} onChange={(e) => reds.setFilters({ status: e.target.value })}>
            <option value="">{tx('people.loyalty.allStatuses')}</option>
            {['pending', 'issued', 'applied', 'used', 'void'].map((s) => <option key={s} value={s}>{s === 'pending' ? tx('people.loyalty.redemption.pending') : redemptionStatus(s)}</option>)}
          </select>}
          footer={<Pager compact info={reds.data} onPage={reds.setPage} />}>
          {reds.err ? <ErrorRetry message={reds.err} onRetry={reds.refresh} /> : !reds.data ? <div className="fk-loading">{tx('pos.loading')}</div> : reds.data.items.length === 0 ? (
            reds.filters.status ? <Empty title={tx('people.fit.noMatch')}><button type="button" className="fk-btn ghost" onClick={() => reds.setFilters({ status: '' })}>{tx('pos.clear_all')}</button></Empty>
              : <Empty title={tx('pos.no_redemptions_yet')}><button type="button" className="fk-btn ghost" onClick={() => rewards.setFilters({ status: 'active' })}>{tx('people.loyalty.viewRewards')}</button></Empty>
          ) : (
            <ul className="fk-list">
              {reds.data.items.map((r) => (
                <li key={r.id} className="fk-li clickable" onClick={() => setDlg({ kind: 'redemption', id: r.id })}>
                  <div className="fk-li-main"><span className="fk-li-t">{r.rewardTitle || '—'}</span><span className="fk-li-s">{r.customerName || '—'} · {whenTime(r.createdAt)}</span></div>
                  <span className="fk-li-num">−{nf(r.pointsSpent)}</span>
                  <span className={'fk-chip ' + (TONE[r.status] ?? 'mut')}>{redemptionStatus(r.status)}</span>
                  <span className="fk-li-acts"><button type="button" className="fk-ibtn" aria-label={tx('people.loyalty.details')} title={tx('people.loyalty.details')} onClick={(e) => { e.stopPropagation(); setDlg({ kind: 'redemption', id: r.id }); }}>›</button></span>
                </li>
              ))}
            </ul>
          )}
        </FitPanel>
      </div>

      <nav className="fk-quick" aria-label={tx('pos.quick_actions_2')} data-testid="loyalty-quick">
        <span className="fk-quick-l">{tx('pos.quick_actions_2')}</span>
        <button type="button" className="fk-btn ghost" onClick={() => setDlg({ kind: 'ledger' })}>{tx('people.loyalty.pointsLedger')}</button>
        <button type="button" className="fk-btn ghost" onClick={() => setDlg({ kind: 'tiers' })}>{tx('people.loyalty.manageTiers')}</button>
        <button type="button" className="fk-btn ghost" onClick={() => nav('/tenant/reports/customers')}>{tx('people.loyalty.reports')}</button>
        <button type="button" className="fk-btn ghost" onClick={() => nav('/settings?section=loyalty-memberships')}>{tx('pos.settings')}</button>
        <span className="fk-quick-period">{ov ? tx('people.loyalty.periodNote', { tz: ov.period.timeZone }) : ''}</span>
      </nav>

      {dlg?.kind === 'enroll' ? <EnrollDialog onClose={() => setDlg(null)} onDone={(name) => { members.setFilters({ tier: '', q: '' }); setSearch(''); done(tx('people.loyalty.enrolledNote', { name }), ['members']); }} /> : null}
      {dlg?.kind === 'reward' ? <RewardDialog reward={dlg.reward} onClose={() => setDlg(null)} onDone={(msg) => { rewards.setFilters({ status: '' }); done(msg, ['rewards']); }} /> : null}
      {dlg?.kind === 'adjust' ? <AdjustDialog member={dlg.member} onClose={() => setDlg(null)} onDone={(msg) => done(msg, ['members'])} /> : null}
      {dlg?.kind === 'redeem' ? <RedeemDialog member={dlg.member} onClose={() => setDlg(null)} onDone={(msg) => { reds.setFilters({ status: '' }); done(msg, ['reds', 'members', 'rewards']); }} /> : null}
      {dlg?.kind === 'redemption' ? <RedemptionDialog id={dlg.id} canVoid={canVoid} onClose={() => setDlg(null)} onVoided={(msg) => done(msg, ['reds', 'members'])} openProfile={(id, name) => nav(`/customers?customerId=${encodeURIComponent(id)}&q=${encodeURIComponent(name)}`)} /> : null}
      {dlg?.kind === 'ledger' ? <LedgerDialog customerId={dlg.customerId} name={dlg.name} onClose={() => setDlg(null)} /> : null}
      {dlg?.kind === 'tiers' ? <TiersDialog tiers={tiers} onClose={() => setDlg(null)} onPick={(tier) => { members.setFilters({ tier }); setDlg(null); }} /> : null}
      {dlg?.kind === 'rewardRedemptions' ? <RewardRedemptionsDialog reward={dlg.reward} onClose={() => setDlg(null)} onOpen={(id) => setDlg({ kind: 'redemption', id })} /> : null}
    </div>
  );
}

// ── overlays ───────────────────────────────────────────────────────────────────────────────────────────────────────────
function EnrollDialog({ onClose, onDone }: { onClose: () => void; onDone: (name: string) => void }) {
  const [q, setQ] = useState(''); const dq = useDebounced(q, 300);
  const [hits, setHits] = useState<{ customerId: string; fullName: string; phone?: string }[] | null>(null);
  const [pick, setPick] = useState<{ customerId: string; fullName: string } | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (dq.trim().length < 2) { setHits(null); return; }
    let alive = true;
    (posCustomersApi.quickSearch(dq.trim()) as Promise<any>).then((r) => { if (!alive) return; const items = Array.isArray(r) ? r : r?.items ?? r?.customers?.items ?? []; setHits(items.slice(0, 8).map((c: any) => ({ customerId: c.customerId ?? c.id, fullName: c.fullName ?? c.displayName ?? '', phone: c.phone }))); }).catch(() => alive && setHits([]));
    return () => { alive = false; };
  }, [dq]);
  const save = async () => {
    if (!pick || busy) return; setBusy(true); setErr(null);
    try { await posLoyaltyApi.enroll(pick.customerId); onDone(pick.fullName); }
    catch (e) { setErr(errText(e, tx('people.loyalty.enrollFailed'))); } finally { setBusy(false); }
  };
  return (
    <FitDialog title={tx('people.loyalty.enroll')} subtitle={tx('people.loyalty.enrollSub')} onClose={onClose} busy={busy} testId="dlg-enroll"
      footer={<><button type="button" className="fk-btn ghost" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button><button type="button" className="fk-btn primary" disabled={!pick || busy} onClick={save}>{busy ? tx('pos.saving_2') : tx('people.loyalty.enrollConfirm')}</button></>}>
      <label className="fk-field"><span>{tx('people.loyalty.findCustomer')}</span><input data-autofocus type="search" value={q} onChange={(e) => { setQ(e.target.value); setPick(null); }} placeholder={tx('pos.search_by_name_phone_email_loyalty_smpn')} /></label>
      {hits && hits.length === 0 ? <div className="fk-hint">{tx('people.loyalty.noCustomerFound')}</div> : null}
      {hits && hits.length > 0 ? <ul className="fk-pick">{hits.map((h) => (
        <li key={h.customerId}><button type="button" className={pick?.customerId === h.customerId ? 'on' : ''} onClick={() => setPick(h)} aria-pressed={pick?.customerId === h.customerId}><b>{h.fullName || '—'}</b><span>{h.phone || ''} · #{String(h.customerId).slice(0, 8)}</span></button></li>
      ))}</ul> : null}
      <div className="fk-hint">{tx('people.loyalty.enrollTerms')}</div>
      {err ? <div className="fk-err" role="alert">{err}</div> : null}
    </FitDialog>
  );
}

function RewardDialog({ reward, onClose, onDone }: { reward?: Reward; onClose: () => void; onDone: (msg: string) => void }) {
  const [title, setTitle] = useState(reward?.title ?? ''); const [description, setDescription] = useState(reward?.description ?? '');
  const [pointsCost, setPointsCost] = useState(reward ? String(reward.pointsCost) : ''); const [rewardType, setRewardType] = useState<RewardType>(reward?.rewardType ?? 'amount_off');
  const [amount, setAmount] = useState(reward?.valueCents ? (reward.valueCents / 100).toFixed(2) : ''); const [percent, setPercent] = useState(reward?.percent ? String(reward.percent) : '');
  const [validDays, setValidDays] = useState(reward?.validDays ? String(reward.validDays) : ''); const [active, setActive] = useState(reward?.active ?? true);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setErr(null);
    const valueCents = rewardType === 'amount_off' ? parseDollarsToCents(amount) : 0;
    if (rewardType === 'amount_off' && valueCents === null) { setErr(tx('pos.enter_the_amount_in_dollars_and_o3e2')); return; }
    const body = { title, description, pointsCost: Number(pointsCost), rewardType, valueCents: valueCents ?? 0, percent: rewardType === 'percent_off' ? Number(percent) : 0, validDays: validDays.trim() ? Number(validDays) : null, active };
    setBusy(true);
    try { if (reward) await posLoyaltyApi.updateReward(reward.id, body); else await posLoyaltyApi.createReward(body); onDone(reward ? tx('people.loyalty.rewardSaved', { name: title }) : tx('people.loyalty.rewardCreated', { name: title })); }
    catch (e) { setErr(errText(e, tx('pos.could_not_save'))); } finally { setBusy(false); }
  };
  return (
    <FitDialog title={reward ? tx('pos.edit_reward') : tx('people.loyalty.createReward')} subtitle={tx('pos.codes_customers_already_hold_keep_the_moqy')} onClose={onClose} busy={busy} testId="dlg-reward"
      footer={<><button type="button" className="fk-btn ghost" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button><button type="button" className="fk-btn primary" disabled={busy} onClick={save}>{busy ? tx('pos.saving_2') : tx('pos.save_reward')}</button></>}>
      <div className="fk-grid2">
        <label className="fk-field"><span>{tx('pos.reward_name')}</span><input data-autofocus value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder={tx('pos.e_g_10_off_any_service')} /></label>
        <label className="fk-field"><span>{tx('pos.points_cost')}</span><input inputMode="numeric" value={pointsCost} onChange={(e) => setPointsCost(e.target.value.replace(/[^\d]/g, ''))} /></label>
        <label className="fk-field span2"><span>{tx('people.loyalty.description')}</span><input value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} /></label>
        <div className="fk-field" role="radiogroup" aria-label={tx('pos.reward_type')}><span>{tx('pos.reward_type')}</span>
          <div className="fk-seg"><button type="button" className={rewardType === 'amount_off' ? 'on' : ''} aria-pressed={rewardType === 'amount_off'} onClick={() => setRewardType('amount_off')}>{tx('pos.amount_off')}</button><button type="button" className={rewardType === 'percent_off' ? 'on' : ''} aria-pressed={rewardType === 'percent_off'} onClick={() => setRewardType('percent_off')}>{tx('pos.percent_off')}</button></div></div>
        {rewardType === 'amount_off'
          ? <label className="fk-field"><span>{tx('pos.dollars_off')}</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          : <label className="fk-field"><span>{tx('pos.percent_value')}</span><input inputMode="numeric" value={percent} onChange={(e) => setPercent(e.target.value.replace(/[^\d]/g, ''))} /></label>}
        <label className="fk-field"><span>{tx('pos.code_valid_for_days_blank_no_1neq')}</span><input inputMode="numeric" value={validDays} onChange={(e) => setValidDays(e.target.value.replace(/[^\d]/g, ''))} /></label>
        <label className="fk-check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> {tx('people.loyalty.rewardActive')}</label>
      </div>
      <div className="fk-hint">{tx('people.loyalty.rewardRulesNote')}</div>
      {err ? <div className="fk-err" role="alert">{err}</div> : null}
    </FitDialog>
  );
}

function AdjustDialog({ member, onClose, onDone }: { member: Member; onClose: () => void; onDone: (msg: string) => void }) {
  const [dir, setDir] = useState<'add' | 'deduct'>('add'); const [pts, setPts] = useState(''); const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const key = useRef(requestId());   // one key per adjustment: a double tap / retry posts the same entry once
  const n = Math.trunc(Number(pts) || 0); const delta = dir === 'add' ? n : -n;
  const after = member.pointsBalance + delta;
  const valid = n > 0 && reason.trim().length >= 3 && after >= 0;
  const save = async () => {
    if (!valid || busy) return; setBusy(true); setErr(null);
    try { const r = await posLoyaltyApi.adjust({ customerId: member.customerId, delta, reason: reason.trim(), idempotencyKey: key.current }); onDone(tx('people.loyalty.adjustedNote', { name: member.customerName, balance: nf(r.balanceAfter) })); }
    catch (e) { setErr(errText(e, tx('pos.could_not_save'))); key.current = requestId(); setConfirm(false); } finally { setBusy(false); }
  };
  return (
    <FitDialog title={tx('people.loyalty.adjust')} subtitle={`${member.customerName} · ${tx('people.loyalty.balanceNow', { n: nf(member.pointsBalance) })}`} onClose={onClose} busy={busy} testId="dlg-adjust"
      footer={<><button type="button" className="fk-btn ghost" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button>
        {!confirm ? <button type="button" className="fk-btn primary" disabled={!valid} onClick={() => setConfirm(true)}>{tx('people.loyalty.review')}</button>
          : <button type="button" className="fk-btn primary" disabled={busy} onClick={save} data-testid="adjust-confirm">{busy ? tx('pos.saving_2') : tx('people.loyalty.confirmAdjust', { delta: (delta > 0 ? '+' : '') + nf(delta) })}</button>}</>}>
      <div className="fk-seg" role="radiogroup" aria-label={tx('people.loyalty.direction')}><button type="button" className={dir === 'add' ? 'on' : ''} aria-pressed={dir === 'add'} onClick={() => { setDir('add'); setConfirm(false); }}>{tx('people.loyalty.addPoints')}</button><button type="button" className={dir === 'deduct' ? 'on' : ''} aria-pressed={dir === 'deduct'} onClick={() => { setDir('deduct'); setConfirm(false); }}>{tx('people.loyalty.deductPoints')}</button></div>
      <div className="fk-grid2">
        <label className="fk-field"><span>{tx('people.loyalty.points')}</span><input data-autofocus inputMode="numeric" value={pts} onChange={(e) => { setPts(e.target.value.replace(/[^\d]/g, '')); setConfirm(false); }} /></label>
        <label className="fk-field"><span>{tx('pos.reason_2')}</span><input value={reason} maxLength={300} onChange={(e) => { setReason(e.target.value); setConfirm(false); }} placeholder={tx('pos.e_g_service_recovery')} /></label>
      </div>
      <div className={'fk-preview' + (after < 0 ? ' bad' : '')}>{tx('people.loyalty.afterAdjust', { before: nf(member.pointsBalance), after: nf(Math.max(0, after)) })}{after < 0 ? ` — ${tx('people.loyalty.belowZero')}` : ''}</div>
      {confirm ? <div className="fk-hint">{tx('people.loyalty.adjustAudit')}</div> : null}
      {err ? <div className="fk-err" role="alert">{err}</div> : null}
    </FitDialog>
  );
}

function RedeemDialog({ member, onClose, onDone }: { member: Member; onClose: () => void; onDone: (msg: string) => void }) {
  const [list, setList] = useState<Reward[] | null>(null); const [pick, setPick] = useState<Reward | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [code, setCode] = useState<string | null>(null);
  const key = useRef(requestId());
  useEffect(() => { posLoyaltyApi.rewards({ page: 1, pageSize: 50, status: 'active' }).then((r: any) => setList(r.items)).catch((e) => setErr(errText(e, tx('people.loyalty.loadFailed')))); }, []);
  const save = async () => {
    if (!pick || busy) return; setBusy(true); setErr(null);
    try { const r = await posLoyaltyApi.redeem({ customerId: member.customerId, rewardId: pick.id, idempotencyKey: key.current }); setCode(r.code); onDone(tx('people.loyalty.redeemedNote', { name: member.customerName, reward: pick.title, balance: nf(r.balanceAfter) })); }
    catch (e) { setErr(errText(e, tx('pos.could_not_save'))); key.current = requestId(); } finally { setBusy(false); }
  };
  return (
    <FitDialog title={tx('people.loyalty.redeem')} subtitle={`${member.customerName} · ${tx('people.loyalty.balanceNow', { n: nf(member.pointsBalance) })}`} onClose={onClose} busy={busy} testId="dlg-redeem"
      footer={<><button type="button" className="fk-btn ghost" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button><button type="button" className="fk-btn primary" disabled={!pick || busy || (pick && pick.pointsCost > member.pointsBalance) || !!code} onClick={save} data-testid="redeem-confirm">{busy ? tx('pos.saving_2') : pick ? tx('people.loyalty.redeemConfirm', { n: nf(pick.pointsCost) }) : tx('people.loyalty.redeem')}</button></>}>
      {!list ? <div className="fk-loading">{tx('pos.loading')}</div> : list.length === 0 ? <Empty title={tx('people.loyalty.noActiveRewards')} /> : (
        <ul className="fk-pick">{list.map((r) => { const short = r.pointsCost > member.pointsBalance; return (
          <li key={r.id}><button type="button" className={pick?.id === r.id ? 'on' : ''} aria-pressed={pick?.id === r.id} disabled={short} onClick={() => setPick(r)}>
            <b>{r.title}</b><span>{rewardValue(r)} · {tx('people.loyalty.pts', { n: nf(r.pointsCost) })}{short ? ` · ${tx('people.loyalty.notEnough')}` : ''}</span></button></li>
        ); })}</ul>
      )}
      {code ? <div className="fk-preview ok">{tx('people.loyalty.codeIssued', { code })}</div> : null}
      {err ? <div className="fk-err" role="alert">{err}</div> : null}
    </FitDialog>
  );
}

function RedemptionDialog({ id, canVoid, onClose, onVoided, openProfile }: { id: string; canVoid: boolean; onClose: () => void; onVoided: (msg: string) => void; openProfile: (id: string, name: string) => void }) {
  const [d, setD] = useState<{ redemption: Redemption; ledger: Ledger[] } | null>(null); const [err, setErr] = useState<string | null>(null);
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false);
  const load = useCallback(() => { setErr(null); posLoyaltyApi.redemption(id).then(setD).catch((e) => setErr(errText(e, tx('people.loyalty.loadFailed')))); }, [id]);
  useEffect(() => { load(); }, [load]);
  const doVoid = async () => {
    if (busy || reason.trim().length < 3) return; setBusy(true); setErr(null);
    try { const r = await posLoyaltyApi.voidRedemption(id, reason.trim()); onVoided(tx('people.loyalty.voidedNote', { balance: nf(r.balanceAfter) })); }
    catch (e) { setErr(errText(e, tx('pos.could_not_save'))); load(); } finally { setBusy(false); }
  };
  const r = d?.redemption;
  return (
    <FitDialog title={tx('people.loyalty.redemptionDetail')} subtitle={r ? `#${r.id.slice(0, 8)}` : undefined} onClose={onClose} busy={busy} testId="dlg-redemption"
      footer={<button type="button" className="fk-btn ghost" onClick={onClose} disabled={busy}>{tx('pos.close')}</button>}>
      {err ? <div className="fk-err" role="alert">{err}</div> : null}
      {!r ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        <dl className="fk-dl">
          <dt>{tx('pos.status')}</dt><dd><span className={'fk-chip ' + (TONE[r.status] ?? 'mut')}>{redemptionStatus(r.status)}</span></dd>
          <dt>{tx('pos.customer')}</dt><dd><button type="button" className="fk-link" onClick={() => openProfile(r.customerId, r.customerName)}>{r.customerName || '—'}</button></dd>
          <dt>{tx('pos.reward')}</dt><dd>{r.rewardTitle}</dd>
          <dt>{tx('people.loyalty.points')}</dt><dd>−{nf(r.pointsSpent)}</dd>
          <dt>{tx('people.loyalty.issued')}</dt><dd>{whenTime(r.createdAt)}</dd>
          {r.expiresAt ? <><dt>{tx('people.loyalty.expires')}</dt><dd>{when(r.expiresAt)}</dd></> : null}
          {r.ticketId ? <><dt>{tx('people.loyalty.ticket')}</dt><dd>#{r.ticketId.slice(0, 8)}{r.usedAt ? ` · ${tx('people.loyalty.usedOn', { date: whenTime(r.usedAt) })}` : r.appliedAt ? ` · ${tx('people.loyalty.appliedOn', { date: whenTime(r.appliedAt) })}` : ''}</dd></> : null}
          {r.voidedAt ? <><dt>{tx('people.loyalty.voided')}</dt><dd>{whenTime(r.voidedAt)}</dd></> : null}
        </dl>
        <h3 className="fk-h3">{tx('people.loyalty.auditTrail')}</h3>
        {d!.ledger.length === 0 ? <div className="fk-hint">{tx('people.loyalty.noLedger')}</div> : <ul className="fk-list dense">{d!.ledger.map((l) => (
          <li key={l.id} className="fk-li"><div className="fk-li-main"><span className="fk-li-t">{entryLabel(l.entryType)} {l.delta > 0 ? '+' : ''}{nf(l.delta)}</span><span className="fk-li-s">{l.reason || '—'} · {whenTime(l.createdAt)}</span></div><span className="fk-li-num">{tx('people.loyalty.balanceAfter', { n: nf(l.balanceAfter) })}</span></li>
        ))}</ul>}
        {r.status === 'issued' && canVoid ? (
          <div className="fk-void">
            <label className="fk-field"><span>{tx('people.loyalty.voidReason')}</span><input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></label>
            <button type="button" className="fk-btn danger" disabled={busy || reason.trim().length < 3} onClick={doVoid} data-testid="void-confirm">{busy ? tx('pos.saving_2') : tx('people.loyalty.voidConfirm', { n: nf(r.pointsSpent) })}</button>
          </div>
        ) : r.status === 'issued' ? <div className="fk-hint">{tx('people.fit.noPermission')}</div> : r.status !== 'void' ? <div className="fk-hint">{tx('people.loyalty.onTicketNote')}</div> : null}
      </>}
    </FitDialog>
  );
}

function LedgerDialog({ customerId, name, onClose }: { customerId?: string; name?: string; onClose: () => void }) {
  const [type, setType] = useState(''); const [page, setPage] = useState(1); const [d, setD] = useState<Paged<Ledger> | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { let alive = true; setErr(null); posLoyaltyApi.ledger({ page, pageSize: 10, entryType: type || undefined, customerId }).then((r) => alive && setD(r)).catch((e) => alive && setErr(errText(e, tx('people.loyalty.loadFailed')))); return () => { alive = false; }; }, [page, type, customerId]);
  return (
    <FitDialog wide title={name ? tx('people.loyalty.pointHistoryOf', { name }) : tx('people.loyalty.pointsLedger')} subtitle={tx('people.loyalty.ledgerSub')} onClose={onClose} testId="dlg-ledger"
      footer={<><Pager info={d} onPage={setPage} /><button type="button" className="fk-btn ghost" onClick={onClose}>{tx('pos.close')}</button></>}>
      <div className="fk-toolbar"><select aria-label={tx('people.loyalty.entryType')} className="fk-select" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
        <option value="">{tx('people.loyalty.allEntries')}</option>{['earn', 'redeem', 'adjust', 'reverse', 'merge'].map((x) => <option key={x} value={x}>{entryLabel(x)}</option>)}</select></div>
      {err ? <ErrorRetry message={err} onRetry={() => setPage((p) => p)} /> : !d ? <div className="fk-loading">{tx('pos.loading')}</div> : d.items.length === 0 ? <Empty title={type ? tx('people.fit.noMatch') : tx('people.loyalty.noLedger')} /> : (
        <table className="fk-table"><thead><tr><th>{tx('people.loyalty.when')}</th><th>{tx('pos.customer')}</th><th>{tx('people.loyalty.entryType')}</th><th className="num">{tx('people.loyalty.points')}</th><th className="num">{tx('people.loyalty.balance')}</th><th>{tx('pos.reason_2')}</th></tr></thead>
          <tbody>{d.items.map((l) => <tr key={l.id}><td>{whenTime(l.createdAt)}</td><td>{l.customerName || '—'}</td><td>{entryLabel(l.entryType)}</td><td className={'num ' + (l.delta < 0 ? 'neg' : 'pos')}>{l.delta > 0 ? '+' : ''}{nf(l.delta)}</td><td className="num">{nf(l.balanceAfter)}</td><td>{l.reason || '—'}</td></tr>)}</tbody></table>
      )}
    </FitDialog>
  );
}

function TiersDialog({ tiers, onClose, onPick }: { tiers: Overview['tiers']; onClose: () => void; onPick: (tier: string) => void }) {
  const total = useMemo(() => tiers.reduce((a, t) => a + t.members, 0), [tiers]);
  return (
    <FitDialog title={tx('people.loyalty.manageTiers')} subtitle={tx('people.loyalty.tiersSub')} onClose={onClose} testId="dlg-tiers" footer={<button type="button" className="fk-btn ghost" onClick={onClose}>{tx('pos.close')}</button>}>
      {tiers.length === 0 ? <Empty title={tx('people.loyalty.noMembers')} /> : (
        <table className="fk-table"><thead><tr><th>{tx('people.loyalty.tier')}</th><th className="num">{tx('people.loyalty.members')}</th><th className="num">%</th><th className="num">{tx('people.loyalty.points')}</th><th>{tx('people.loyalty.qualification')}</th><th /></tr></thead>
          <tbody>{tiers.map((t) => <tr key={t.tier}><td><b>{tierLabel(t.tier)}</b></td><td className="num">{nf(t.members)}</td><td className="num">{total ? Math.round((t.members / total) * 1000) / 10 : 0}%</td><td className="num">{nf(t.points)}</td><td className="fk-muted">{tx('people.loyalty.noQualification')}</td><td><button type="button" className="fk-link" onClick={() => onPick(t.tier)}>{tx('people.loyalty.showMembers')}</button></td></tr>)}</tbody></table>
      )}
      <div className="fk-hint">{tx('people.loyalty.tiersNote')}</div>
    </FitDialog>
  );
}

function RewardRedemptionsDialog({ reward, onClose, onOpen }: { reward: Reward; onClose: () => void; onOpen: (id: string) => void }) {
  const [page, setPage] = useState(1); const [d, setD] = useState<Paged<Redemption> | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { let alive = true; posLoyaltyApi.redemptions({ page, pageSize: 10, rewardId: reward.id }).then((r) => alive && setD(r)).catch((e) => alive && setErr(errText(e, tx('people.loyalty.loadFailed')))); return () => { alive = false; }; }, [page, reward.id]);
  return (
    <FitDialog wide title={tx('people.loyalty.redemptionsOf', { name: reward.title })} subtitle={`${rewardValue(reward)} · ${tx('people.loyalty.pts', { n: nf(reward.pointsCost) })}`} onClose={onClose} testId="dlg-reward-redemptions"
      footer={<><Pager info={d} onPage={setPage} /><button type="button" className="fk-btn ghost" onClick={onClose}>{tx('pos.close')}</button></>}>
      {err ? <div className="fk-err">{err}</div> : !d ? <div className="fk-loading">{tx('pos.loading')}</div> : d.items.length === 0 ? <Empty title={tx('pos.no_redemptions_yet')} /> : (
        <table className="fk-table"><thead><tr><th>{tx('people.loyalty.when')}</th><th>{tx('pos.customer')}</th><th className="num">{tx('people.loyalty.points')}</th><th>{tx('pos.status')}</th><th /></tr></thead>
          <tbody>{d.items.map((r) => <tr key={r.id}><td>{whenTime(r.createdAt)}</td><td>{r.customerName || '—'}</td><td className="num">−{nf(r.pointsSpent)}</td><td><span className={'fk-chip ' + (TONE[r.status] ?? 'mut')}>{redemptionStatus(r.status)}</span></td><td><button type="button" className="fk-link" onClick={() => onOpen(r.id)}>{tx('people.loyalty.details')}</button></td></tr>)}</tbody></table>
      )}
    </FitDialog>
  );
}
