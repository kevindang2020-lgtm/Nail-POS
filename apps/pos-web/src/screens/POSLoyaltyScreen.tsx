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
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
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
import { LoyaltyBonusRequest } from '../components/LoyaltyBonusRequest';

type Overview = { period: { label: string; start: string; timeZone: string }; kpis: { loyaltyMembers: number; newMembersThisMonth: number; pointsOutstanding: number; ledgerBalance: number; balanceReconciled: boolean;
  activeRewards: number; totalRewards: number; redemptionsThisMonth: number; redemptionsPendingThisMonth: number; redemptionsUsedThisMonth: number; redemptionsVoidedThisMonth: number; pointsRedeemedThisMonth: number };
  tiers: { tier: string; members: number; pct: number; points: number; minPoints?: number | null; benefits?: string; configured?: boolean }[] };
type Reward = { id: string; title: string; description: string; pointsCost: number; active: boolean; rewardType: RewardType; valueCents: number; percent: number; validDays: number | null; createdAt: string | null; redemptions: number; redemptionsThisMonth: number;
  startsOn?: string | null; endsOn?: string | null; stockTotal?: number | null; stockLeft?: number | null; perMemberLimit?: number | null; eligibleTiers?: string[] | null;
  availability?: 'available' | 'inactive' | 'upcoming' | 'expired' | 'out_of_stock' };
// Loyalty guide (Nov 4 2026): why a reward cannot be redeemed right now, in the cashier's words (null = it can)
const availNote = (r: Reward): string | null => r.availability === 'upcoming' ? tx('people.loyalty.avail.upcoming', { date: r.startsOn ?? '' }) : r.availability === 'expired' ? tx('people.loyalty.avail.expired') : r.availability === 'out_of_stock' ? tx('people.loyalty.avail.outOfStock') : null;
const rulesLine = (r: Reward): string => [r.stockTotal != null ? tx('people.loyalty.stockLeft', { n: nf(r.stockLeft ?? 0), total: nf(r.stockTotal) }) : '', r.perMemberLimit != null ? tx('people.loyalty.perMember', { n: nf(r.perMemberLimit) }) : '', r.eligibleTiers?.length ? r.eligibleTiers.map(tierLabel).join(', ') : '', r.endsOn ? tx('people.loyalty.endsOn', { date: r.endsOn }) : ''].filter(Boolean).join(' · ');
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
  const members = useServerList<Member, { tier: string; q: string; status: string; sort: string }>((q) => posLoyaltyApi.members({ page: q.page, pageSize: q.pageSize, tier: q.tier || undefined, q: q.q || undefined, status: q.status || undefined, sort: q.sort || undefined }), membersFit.rows, { tier: '', q: '', status: '', sort: '' });
  const reds = useServerList<Redemption, { status: string }>((q) => posLoyaltyApi.redemptions({ page: q.page, pageSize: q.pageSize, status: q.status || undefined }), redFit.rows, { status: '' });
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 300);
  useEffect(() => { if (debounced !== members.filters.q) members.setFilters({ q: debounced }); }, [debounced]);   // eslint-disable-line react-hooks/exhaustive-deps

  // overlays
  const [dlg, setDlg] = useState<null | { kind: 'enroll' } | { kind: 'reward'; reward?: Reward } | { kind: 'adjust'; member: Member } | { kind: 'redeem'; member: Member }
    | { kind: 'redemption'; id: string } | { kind: 'ledger'; customerId?: string; name?: string } | { kind: 'tiers' } | { kind: 'memberTier'; member: Member } | { kind: 'rewardRedemptions'; reward: Reward } | { kind: 'health' }>(null);
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
                  <div className="fk-li-main"><span className="fk-li-t">{r.title}</span><span className="fk-li-s">{rewardValue(r)} · {r.validDays ? tx('people.loyalty.validDays', { n: String(r.validDays) }) : tx('people.loyalty.noExpiry')} · {tx('people.loyalty.redeemedN', { n: nf(r.redemptions) })}{rulesLine(r) ? ` · ${rulesLine(r)}` : ''}</span></div>
                  <span className="fk-li-num">{tx('people.loyalty.pts', { n: nf(r.pointsCost) })}</span>
                  <span className={'fk-chip ' + (!r.active ? 'mut' : availNote(r) ? 'warn' : 'ok')} data-testid={`reward-avail-${r.id}`}>{!r.active ? tx('people.loyalty.inactive') : availNote(r) ?? tx('pos.active_3')}</span>
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
            <select className="fk-select" aria-label={tx('people.loyalty.memberStatus')} value={members.filters.status} onChange={(e) => members.setFilters({ status: e.target.value })} data-testid="members-status">
              <option value="">{tx('people.loyalty.allStatuses')}</option><option value="active">{tx('pos.active_3')}</option><option value="inactive">{tx('people.loyalty.inactive')}</option></select>
            <select className="fk-select" aria-label={tx('people.loyalty.sortBy')} value={members.filters.sort} onChange={(e) => members.setFilters({ sort: e.target.value })} data-testid="members-sort">
              <option value="">{tx('people.loyalty.sort.newest')}</option><option value="balance">{tx('people.loyalty.sort.balance')}</option><option value="activity">{tx('people.loyalty.sort.activity')}</option></select>
            {members.filters.tier ? <span className="fk-chip info">{tierLabel(members.filters.tier)} <button type="button" className="fk-chip-x" aria-label={tx('people.loyalty.showAllTiers')} onClick={() => members.setFilters({ tier: '' })}>✕</button></span> : null}
          </>}
          footer={<Pager compact info={members.data} onPage={members.setPage} />}>
          {members.err ? <ErrorRetry message={members.err} onRetry={members.refresh} /> : !members.data ? <div className="fk-loading">{tx('pos.loading')}</div> : members.data.items.length === 0 ? (
            members.filters.tier || members.filters.q || members.filters.status ? <Empty title={tx('people.fit.noMatch')}><button type="button" className="fk-btn ghost" onClick={() => { members.setFilters({ tier: '', q: '', status: '' }); setSearch(''); }}>{tx('pos.clear_all')}</button></Empty>
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
                    {canManage ? <button type="button" className="fk-ibtn" onClick={() => setDlg({ kind: 'memberTier', member: m })} aria-label={tx('people.loyalty.changeTier')} title={tx('people.loyalty.changeTier')} data-testid={`member-tier-${m.customerId}`}>⇅</button> : null}
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
        <button type="button" className="fk-btn ghost" onClick={() => setDlg({ kind: 'health' })} data-testid="loyalty-health-open">{tx('people.loyalty.health.button')}</button>
        <button type="button" className="fk-btn ghost" onClick={() => nav('/tenant/reports/customers')}>{tx('people.loyalty.reports')}</button>
        <button type="button" className="fk-btn ghost" onClick={() => nav('/settings?section=loyalty-memberships')}>{tx('pos.settings')}</button>
        <span className="fk-quick-period">{ov ? tx('people.loyalty.periodNote', { tz: ov.period.timeZone }) : ''}</span>
      </nav>

      {dlg?.kind === 'enroll' ? <EnrollDialog onClose={() => setDlg(null)} onDone={(name) => { members.setFilters({ tier: '', q: '' }); setSearch(''); done(tx('people.loyalty.enrolledNote', { name }), ['members']); }} /> : null}
      {dlg?.kind === 'reward' ? <RewardDialog reward={dlg.reward} tiers={tiers.map((t) => t.tier)} onClose={() => setDlg(null)} onDone={(msg) => { rewards.setFilters({ status: '' }); done(msg, ['rewards']); }} /> : null}
      {dlg?.kind === 'adjust' ? <AdjustDialog member={dlg.member} onClose={() => setDlg(null)} onDone={(msg) => done(msg, ['members'])} /> : null}
      {dlg?.kind === 'redeem' ? <RedeemDialog member={dlg.member} onClose={() => setDlg(null)} onDone={(msg) => { reds.setFilters({ status: '' }); done(msg, ['reds', 'members', 'rewards']); }} /> : null}
      {dlg?.kind === 'redemption' ? <RedemptionDialog id={dlg.id} canVoid={canVoid} onClose={() => setDlg(null)} onVoided={(msg) => done(msg, ['reds', 'members'])} openProfile={(id, name) => nav(`/customers?customerId=${encodeURIComponent(id)}&q=${encodeURIComponent(name)}`)} /> : null}
      {dlg?.kind === 'ledger' ? <LedgerDialog customerId={dlg.customerId} name={dlg.name} onClose={() => setDlg(null)} /> : null}
      {dlg?.kind === 'tiers' ? <TiersDialog canManage={canManage} onChanged={loadOverview} onClose={() => setDlg(null)} onPick={(tier) => { members.setFilters({ tier }); setDlg(null); }} /> : null}
      {dlg?.kind === 'memberTier' ? <MemberTierDialog member={dlg.member} onClose={() => setDlg(null)} onDone={(msg) => done(msg, ['members'])} /> : null}
      {dlg?.kind === 'health' ? <LoyaltyHealthDialog onClose={() => setDlg(null)} /> : null}
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

function RewardDialog({ reward, tiers, onClose, onDone }: { reward?: Reward; tiers: string[]; onClose: () => void; onDone: (msg: string) => void }) {
  const [startsOn, setStartsOn] = useState(reward?.startsOn ?? ''); const [endsOn, setEndsOn] = useState(reward?.endsOn ?? '');
  const [stockTotal, setStockTotal] = useState(reward?.stockTotal != null ? String(reward.stockTotal) : ''); const [perMemberLimit, setPerMemberLimit] = useState(reward?.perMemberLimit != null ? String(reward.perMemberLimit) : '');
  const [eligible, setEligible] = useState<string[]>(reward?.eligibleTiers ?? []);
  const tierOptions = [...new Set([...tiers, ...eligible])];
  const [title, setTitle] = useState(reward?.title ?? ''); const [description, setDescription] = useState(reward?.description ?? '');
  const [pointsCost, setPointsCost] = useState(reward ? String(reward.pointsCost) : ''); const [rewardType, setRewardType] = useState<RewardType>(reward?.rewardType ?? 'amount_off');
  const [amount, setAmount] = useState(reward?.valueCents ? (reward.valueCents / 100).toFixed(2) : ''); const [percent, setPercent] = useState(reward?.percent ? String(reward.percent) : '');
  const [validDays, setValidDays] = useState(reward?.validDays ? String(reward.validDays) : ''); const [active, setActive] = useState(reward?.active ?? true);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setErr(null);
    const valueCents = rewardType === 'amount_off' ? parseDollarsToCents(amount) : 0;
    if (rewardType === 'amount_off' && valueCents === null) { setErr(tx('pos.enter_the_amount_in_dollars_and_o3e2')); return; }
    const body = { title, description, pointsCost: Number(pointsCost), rewardType, valueCents: valueCents ?? 0, percent: rewardType === 'percent_off' ? Number(percent) : 0, validDays: validDays.trim() ? Number(validDays) : null, active,
      startsOn: startsOn || null, endsOn: endsOn || null, stockTotal: stockTotal.trim() ? Number(stockTotal) : null, perMemberLimit: perMemberLimit.trim() ? Number(perMemberLimit) : null, eligibleTiers: eligible.length ? eligible : null };
    if (startsOn && endsOn && endsOn < startsOn) { setErr(tx('people.loyalty.endsBeforeStarts')); return; }
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
        <label className="fk-field"><span>{tx('people.loyalty.startsOn')}</span><input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} data-testid="reward-starts" /></label>
        <label className="fk-field"><span>{tx('people.loyalty.endsOnLabel')}</span><input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} data-testid="reward-ends" /></label>
        <label className="fk-field"><span>{tx('people.loyalty.stockTotal')}</span><input inputMode="numeric" value={stockTotal} onChange={(e) => setStockTotal(e.target.value.replace(/[^\d]/g, ''))} data-testid="reward-stock" /></label>
        <label className="fk-field"><span>{tx('people.loyalty.perMemberLimit')}</span><input inputMode="numeric" value={perMemberLimit} onChange={(e) => setPerMemberLimit(e.target.value.replace(/[^\d]/g, ''))} data-testid="reward-limit" /></label>
        <div className="fk-field span2"><span>{tx('people.loyalty.eligibleTiers')}</span>
          {tierOptions.length === 0 ? <span className="fk-hint">{tx('people.loyalty.allTiersEligible')}</span> : <div className="fk-seg">{tierOptions.map((t) => { const on = eligible.includes(t); return <button key={t} type="button" className={on ? 'on' : ''} aria-pressed={on} onClick={() => setEligible(on ? eligible.filter((x) => x !== t) : [...eligible, t])}>{tierLabel(t)}</button>; })}</div>}
          {tierOptions.length && !eligible.length ? <span className="fk-hint">{tx('people.loyalty.allTiersEligible')}</span> : null}</div>
        <label className="fk-check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> {tx('people.loyalty.rewardActive')}</label>
      </div>
      <div className="fk-hint">{tx('people.loyalty.rewardRulesNote')}</div>
      {err ? <div className="fk-err" role="alert">{err}</div> : null}
    </FitDialog>
  );
}

/** Customer Profile & Global Loyalty Protection (Nov 4 2026): "Adjust points" (add / deduct) is replaced by Request Bonus
 *  Points — positive only, approved by the owner in the Owner App; points are never lowered by hand. */
function AdjustDialog({ member, onClose }: { member: Member; onClose: () => void; onDone: (msg: string) => void }) {
  const can = useCan();
  return (
    <FitDialog title={tx('lb.title')} subtitle={`${member.customerName} · ${tx('people.loyalty.balanceNow', { n: nf(member.pointsBalance) })}`} onClose={onClose} busy={false} testId="dlg-adjust"
      footer={<button type="button" className="fk-btn ghost" onClick={onClose}>{tx('pos.done')}</button>}>
      <LoyaltyBonusRequest customerId={member.customerId} currentPoints={member.pointsBalance} canRequest={can('pos.customers.loyalty.edit')} />
    </FitDialog>
  );
}

function RedeemDialog({ member, onClose, onDone }: { member: Member; onClose: () => void; onDone: (msg: string) => void }) {
  const [list, setList] = useState<Reward[] | null>(null); const [pick, setPick] = useState<Reward | null>(null);
  const [page, setPage] = useState(1); const [info, setInfo] = useState<any>(null);   // Loyalty guide (Nov 4 2026): every active reward is reachable — the old first-50 cap hid the rest
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [code, setCode] = useState<string | null>(null); const [doneMsg, setDoneMsg] = useState<string | null>(null);
  const close = () => (doneMsg ? onDone(doneMsg) : onClose());
  const key = useRef(requestId());
  useEffect(() => { setList(null); posLoyaltyApi.rewards({ page, pageSize: 20, status: 'active' }).then((r: any) => { setList(r.items); setInfo(r); }).catch((e) => setErr(errText(e, tx('people.loyalty.loadFailed')))); }, [page]);
  const blockOf = (r: Reward): string | null => availNote(r) ?? (r.eligibleTiers?.length && !r.eligibleTiers.includes(member.tier) ? tx('people.loyalty.avail.tier') : null) ?? (r.pointsCost > member.pointsBalance ? tx('people.loyalty.notEnough') : null);
  const save = async () => {
    if (!pick || busy) return; setBusy(true); setErr(null);
    try { const r = await posLoyaltyApi.redeem({ customerId: member.customerId, rewardId: pick.id, idempotencyKey: key.current }); setCode(r.code); setDoneMsg(tx('people.loyalty.redeemedNote', { name: member.customerName, reward: pick.title, balance: nf(r.balanceAfter) })); }   // Loyalty guide (Nov 4 2026): the dialog stays open so the code can be read to the guest — it used to close at once and the code was never seen
    catch (e) { setErr(errText(e, tx('pos.could_not_save'))); key.current = requestId(); } finally { setBusy(false); }
  };
  return (
    <FitDialog title={tx('people.loyalty.redeem')} subtitle={`${member.customerName} · ${tx('people.loyalty.balanceNow', { n: nf(member.pointsBalance) })}`} onClose={close} busy={busy} testId="dlg-redeem"
      footer={doneMsg ? <button type="button" className="fk-btn primary" onClick={close} data-testid="redeem-done">{tx('pos.done')}</button> : <><button type="button" className="fk-btn ghost" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button><button type="button" className="fk-btn primary" disabled={!pick || busy || (pick && !!blockOf(pick)) || !!code} onClick={save} data-testid="redeem-confirm">{busy ? tx('pos.saving_2') : pick ? tx('people.loyalty.redeemConfirm', { n: nf(pick.pointsCost) }) : tx('people.loyalty.redeem')}</button></>}>
      {!list ? <div className="fk-loading">{tx('pos.loading')}</div> : list.length === 0 ? <Empty title={tx('people.loyalty.noActiveRewards')} /> : (
        <><ul className="fk-pick">{list.map((r) => { const why = blockOf(r); return (
          <li key={r.id}><button type="button" className={pick?.id === r.id ? 'on' : ''} aria-pressed={pick?.id === r.id} disabled={!!why || !!code} onClick={() => setPick(r)} data-testid={`redeem-pick-${r.id}`}>
            <b>{r.title}</b><span>{rewardValue(r)} · {tx('people.loyalty.pts', { n: nf(r.pointsCost) })}{why ? ` · ${why}` : ''}</span></button></li>
        ); })}</ul>{info && info.totalPages > 1 && !code ? <Pager compact info={info} onPage={setPage} /> : null}</>
      )}
      {code ? <div className="fk-preview ok" role="status" data-testid="redeem-code">{tx('people.loyalty.codeIssued', { code })}</div> : null}
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
  const [retry, setRetry] = useState(0);   // Loyalty guide (Nov 4 2026): Retry re-reads (it set the same page — a no-op)
  useEffect(() => { let alive = true; setErr(null); posLoyaltyApi.ledger({ page, pageSize: 10, entryType: type || undefined, customerId }).then((r) => alive && setD(r)).catch((e) => alive && setErr(errText(e, tx('people.loyalty.loadFailed')))); return () => { alive = false; }; }, [page, type, customerId, retry]);
  return (
    <FitDialog wide title={name ? tx('people.loyalty.pointHistoryOf', { name }) : tx('people.loyalty.pointsLedger')} subtitle={tx('people.loyalty.ledgerSub')} onClose={onClose} testId="dlg-ledger"
      footer={<><Pager info={d} onPage={setPage} /><button type="button" className="fk-btn ghost" onClick={onClose}>{tx('pos.close')}</button></>}>
      <div className="fk-toolbar"><select aria-label={tx('people.loyalty.entryType')} className="fk-select" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
        <option value="">{tx('people.loyalty.allEntries')}</option>{['earn', 'redeem', 'adjust', 'reverse', 'merge'].map((x) => <option key={x} value={x}>{entryLabel(x)}</option>)}</select></div>
      {err ? <ErrorRetry message={err} onRetry={() => setRetry((n) => n + 1)} /> : !d ? <div className="fk-loading">{tx('pos.loading')}</div> : d.items.length === 0 ? <Empty title={type ? tx('people.fit.noMatch') : tx('people.loyalty.noLedger')} /> : (
        <table className="fk-table"><thead><tr><th>{tx('people.loyalty.when')}</th><th>{tx('pos.customer')}</th><th>{tx('people.loyalty.entryType')}</th><th className="num">{tx('people.loyalty.points')}</th><th className="num">{tx('people.loyalty.balance')}</th><th>{tx('pos.reason_2')}</th></tr></thead>
          <tbody>{d.items.map((l) => <tr key={l.id}><td>{whenTime(l.createdAt)}</td><td>{l.customerName || '—'}</td><td>{entryLabel(l.entryType)}</td><td className={'num ' + (l.delta < 0 ? 'neg' : 'pos')}>{l.delta > 0 ? '+' : ''}{nf(l.delta)}</td><td className="num">{nf(l.balanceAfter)}</td><td>{l.reason || '—'}</td></tr>)}</tbody></table>
      )}
    </FitDialog>
  );
}

type HealthRun = Awaited<ReturnType<typeof posLoyaltyApi.bonusHealth>>;
// G1 guide §11 "Check Customer & Loyalty System": GET /pos/loyalty/bonus-requests/health — read-only checks of the bonus
// approvals (posted once, never without the owner, no manual reduction, approved-but-unfinished). Each check is shown by its
// key in EN / VI (the server's English detail is not shown to the salon); affected records are counted, never listed by name.
function LoyaltyHealthDialog({ onClose }: { onClose: () => void }) {
  const [d, setD] = useState<HealthRun | null>(null); const [err, setErr] = useState<string | null>(null); const [run, setRun] = useState(0);
  useEffect(() => { let alive = true; setErr(null); setD(null); posLoyaltyApi.bonusHealth().then((r) => alive && setD(r)).catch((e) => alive && setErr(errText(e, tx('people.loyalty.loadFailed')))); return () => { alive = false; }; }, [run]);
  const tone = (r: string) => (r === 'passed' ? 'ok' : r === 'warning' ? 'warn' : 'bad');
  return (
    <FitDialog title={tx('people.loyalty.health.title')} subtitle={d ? tx('people.loyalty.health.sub', { when: whenTime(d.checkedAt) }) : undefined} onClose={onClose} testId="dlg-loyalty-health"
      footer={<><button type="button" className="fk-btn ghost" onClick={() => setRun((n) => n + 1)} disabled={!d && !err} data-testid="loyalty-health-run">{tx('people.loyalty.health.run')}</button><button type="button" className="fk-btn ghost" onClick={onClose}>{tx('pos.close')}</button></>}>
      {err ? <ErrorRetry message={err} onRetry={() => setRun((n) => n + 1)} /> : !d ? <div className="fk-loading">{tx('pos.loading')}</div> : (
        <ul className="fk-list" data-testid="loyalty-health-checks">{d.checks.map((c) => (
          <li key={c.key} data-testid={`loyalty-health-${c.key}`}>
            <span className={'fk-chip ' + tone(c.result)}>{tx(`people.loyalty.health.${c.result}`)}</span>{' '}
            <span>{tx(`people.loyalty.health.${c.key}`)}</span>
            {c.affected.length ? <span className="fk-muted"> · {tx('people.loyalty.health.affected', { n: c.affected.length })}</span> : null}
          </li>))}
        </ul>
      )}
    </FitDialog>
  );
}

type TierRow = { id: string; name: string; rank: number; minPoints: number | null; benefits: string; active: boolean; members: number };
type TierList = { items: TierRow[]; unconfigured: { name: string; members: number }[] };
// Manage Tiers (Loyalty guide Nov 4 2026): the salon's own tiers — threshold and benefits are what the salon types; no
// automatic promotion formula is invented. Renaming relabels members; a tier members still hold cannot be retired.
function TiersDialog({ canManage, onClose, onPick, onChanged }: { canManage: boolean; onClose: () => void; onPick: (tier: string) => void; onChanged: () => void }) {
  const [d, setD] = useState<TierList | null>(null); const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<null | { id?: string; name: string; rank: string; minPoints: string; benefits: string; active: boolean }>(null);
  const [busy, setBusy] = useState(false); const [formErr, setFormErr] = useState<string | null>(null); const [saved, setSaved] = useState<string | null>(null);
  const load = useCallback(() => { setErr(null); posLoyaltyApi.tiers().then(setD).catch((e) => setErr(errText(e, tx('people.loyalty.loadFailed')))); }, []);
  useEffect(() => { load(); }, [load]);
  const open = (t?: TierRow, name = '') => { setFormErr(null); setSaved(null); setEdit(t ? { id: t.id, name: t.name, rank: String(t.rank), minPoints: t.minPoints == null ? '' : String(t.minPoints), benefits: t.benefits, active: t.active } : { name, rank: String(d?.items.length ?? 0), minPoints: '', benefits: '', active: true }); };
  const save = async () => {
    if (!edit || busy) return;
    if (!edit.name.trim()) { setFormErr(tx('people.loyalty.tierNameRequired')); return; }
    setBusy(true); setFormErr(null);
    const body = { name: edit.name.trim(), rank: edit.rank.trim() ? Number(edit.rank) : null, minPoints: edit.minPoints.trim() ? Number(edit.minPoints) : null, benefits: edit.benefits.trim() || null, active: edit.active };
    try { if (edit.id) await posLoyaltyApi.updateTier(edit.id, body); else await posLoyaltyApi.createTier(body); setSaved(tx('people.loyalty.tierSaved', { name: body.name })); setEdit(null); load(); onChanged(); }
    catch (e) { setFormErr(errText(e, tx('pos.could_not_save'))); } finally { setBusy(false); }
  };
  return (
    <FitDialog wide title={tx('people.loyalty.manageTiers')} subtitle={tx('people.loyalty.tiersSub')} onClose={onClose} busy={busy} testId="dlg-tiers"
      footer={<>{canManage && !edit ? <button type="button" className="fk-btn primary" onClick={() => open()} data-testid="tier-add">{tx('people.loyalty.addTier')}</button> : null}<button type="button" className="fk-btn ghost" onClick={onClose} disabled={busy}>{tx('pos.close')}</button></>}>
      {err ? <ErrorRetry message={err} onRetry={load} /> : !d ? <div className="fk-loading">{tx('pos.loading')}</div> : (
        <>
          {d.items.length === 0 && d.unconfigured.length === 0 ? <Empty title={tx('people.loyalty.noTiers')} /> : (
            <table className="fk-table"><thead><tr><th>{tx('people.loyalty.tier')}</th><th className="num">{tx('people.loyalty.members')}</th><th className="num">{tx('people.loyalty.threshold')}</th><th>{tx('people.loyalty.benefits')}</th><th>{tx('pos.status')}</th><th /></tr></thead>
              <tbody>
                {d.items.map((t) => <tr key={t.id} data-testid={`tier-row-${t.name}`}><td><b>{tierLabel(t.name)}</b></td><td className="num">{nf(t.members)}</td><td className="num">{t.minPoints == null ? '—' : tx('people.loyalty.pts', { n: nf(t.minPoints) })}</td><td className="fk-muted">{t.benefits || '—'}</td>
                  <td><span className={'fk-chip ' + (t.active ? 'ok' : 'mut')}>{t.active ? tx('pos.active_3') : tx('people.loyalty.retired')}</span></td>
                  <td>{t.members ? <button type="button" className="fk-link" onClick={() => onPick(t.name)}>{tx('people.loyalty.showMembers')}</button> : null}{canManage ? <> <button type="button" className="fk-link" onClick={() => open(t)} data-testid={`tier-edit-${t.name}`}>{tx('pos.edit')}</button></> : null}</td></tr>)}
                {d.unconfigured.map((u) => <tr key={'u' + u.name} data-testid={`tier-row-${u.name}`}><td><b>{tierLabel(u.name)}</b></td><td className="num">{nf(u.members)}</td><td className="num">—</td><td className="fk-muted">{tx('people.loyalty.noQualification')}</td><td><span className="fk-chip mut">{tx('people.loyalty.labelOnly')}</span></td>
                  <td><button type="button" className="fk-link" onClick={() => onPick(u.name)}>{tx('people.loyalty.showMembers')}</button>{canManage ? <> <button type="button" className="fk-link" onClick={() => open(undefined, u.name)} data-testid={`tier-setup-${u.name}`}>{tx('people.loyalty.setUpTier')}</button></> : null}</td></tr>)}
              </tbody></table>
          )}
          {edit ? (
            <div className="fk-grid2" data-testid="tier-form">
              <label className="fk-field"><span>{tx('people.loyalty.tierName')}</span><input data-autofocus value={edit.name} maxLength={40} onChange={(e) => setEdit({ ...edit, name: e.target.value })} data-testid="tier-name" /></label>
              <label className="fk-field"><span>{tx('people.loyalty.tierOrder')}</span><input inputMode="numeric" value={edit.rank} onChange={(e) => setEdit({ ...edit, rank: e.target.value.replace(/[^\d]/g, '') })} /></label>
              <label className="fk-field"><span>{tx('people.loyalty.thresholdLabel')}</span><input inputMode="numeric" value={edit.minPoints} onChange={(e) => setEdit({ ...edit, minPoints: e.target.value.replace(/[^\d]/g, '') })} data-testid="tier-threshold" /></label>
              <label className="fk-check"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} data-testid="tier-active" /> {tx('people.loyalty.tierActive')}</label>
              <label className="fk-field span2"><span>{tx('people.loyalty.benefits')}</span><input value={edit.benefits} maxLength={500} onChange={(e) => setEdit({ ...edit, benefits: e.target.value })} data-testid="tier-benefits" /></label>
              <div className="span2"><button type="button" className="fk-btn ghost" onClick={() => setEdit(null)} disabled={busy}>{tx('pos.cancel')}</button> <button type="button" className="fk-btn primary" onClick={save} disabled={busy} data-testid="tier-save">{busy ? tx('pos.saving_2') : tx('people.loyalty.saveTier')}</button></div>
              {edit.id ? <div className="fk-hint span2">{tx('people.loyalty.renameNote')}</div> : null}
            </div>
          ) : null}
          {formErr ? <div className="fk-err" role="alert">{formErr}</div> : null}
          {saved ? <div className="fk-preview ok" role="status">{saved}</div> : null}
        </>
      )}
      <div className="fk-hint">{tx('people.loyalty.tiersNote')}</div>
    </FitDialog>
  );
}

function MemberTierDialog({ member, onClose, onDone }: { member: Member; onClose: () => void; onDone: (msg: string) => void }) {
  const [d, setD] = useState<TierList | null>(null); const [tier, setTier] = useState(''); const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { posLoyaltyApi.tiers().then(setD).catch((e) => setErr(errText(e, tx('people.loyalty.loadFailed')))); }, []);
  const options = d ? [...new Set([...d.items.filter((t) => t.active).map((t) => t.name), 'Regular'])].filter((n) => n.toLowerCase() !== member.tier.toLowerCase()) : [];
  const save = async () => {
    if (!tier || reason.trim().length < 3 || busy) return; setBusy(true); setErr(null);
    try { const r = await posLoyaltyApi.setMemberTier(member.customerId, { tier, reason: reason.trim() }); onDone(tx('people.loyalty.tierChangedNote', { name: member.customerName, tier: tierLabel(r?.tier ?? tier) })); }
    catch (e) { setErr(errText(e, tx('pos.could_not_save'))); } finally { setBusy(false); }
  };
  return (
    <FitDialog title={tx('people.loyalty.changeTier')} subtitle={`${member.customerName} · ${tierLabel(member.tier)}`} onClose={onClose} busy={busy} testId="dlg-member-tier"
      footer={<><button type="button" className="fk-btn ghost" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button><button type="button" className="fk-btn primary" disabled={!tier || reason.trim().length < 3 || busy} onClick={save} data-testid="member-tier-save">{busy ? tx('pos.saving_2') : tx('people.loyalty.changeTier')}</button></>}>
      {!d && !err ? <div className="fk-loading">{tx('pos.loading')}</div> : d ? (
        <div className="fk-grid2">
          <label className="fk-field"><span>{tx('people.loyalty.newTier')}</span><select data-autofocus value={tier} onChange={(e) => setTier(e.target.value)} data-testid="member-tier-pick"><option value="">—</option>{options.map((o) => <option key={o} value={o}>{tierLabel(o)}</option>)}</select></label>
          <label className="fk-field"><span>{tx('pos.reason_2')}</span><input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} data-testid="member-tier-reason" /></label>
        </div>
      ) : null}
      <div className="fk-hint">{tx('people.loyalty.tierChangeAudit')}</div>
      {err ? <div className="fk-err" role="alert">{err}</div> : null}
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
