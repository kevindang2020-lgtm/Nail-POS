// POSAISchedulingOptimizerScreen.tsx — the tenant AI Scheduling Optimizer workspace, wired to /pos/ai-scheduling-optimizer
// (BUILD_PLAN Phase 7 — `ai_scheduling_optimizer` complete; contract scratchpad/p7/CONTRACT.md §4).
//
// A deterministic engine finds gaps, conflicts and better times and checks every hard rule before scoring; the AI only
// writes explanations. Staff review every recommendation; a change to a confirmed appointment also needs the customer's
// approval, and every change is applied by the server through the booking service (never from the browser).
//
// Scheduling Optimizer guide (Nov 2026): the four counters sit above the tabs (server-computed, each opens its queue);
// Recommendations is the searchable, paged queue; History leads with the append-only event trail; Check Scheduling System.
// Tabs: Overview · Recommendations (+ detail) · Find a time · Gaps & conflicts · Customer approvals · Insights ·
// Time off & locks · Settings · Usage & export · History. Each card loads ON ITS OWN (one failing card never blanks the
// screen). Buttons are hidden by permission (the server re-checks every action). Realtime `schedule_*` events (screen key
// "ai-scheduling-optimizer") bump `tick` and every card reloads. `?rec=<id>` (from the booking calendar badge) opens a
// recommendation; `?tab=` opens a tab.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { SchedSettingsView } from '@aipowersalon/api-contracts/tenant';
import { useRealtime } from '../realtime/useRealtime';
import { useCan } from '../components/usePermissions';
import { posBookingApi } from '../api/posBookingApi';
import { posAiSchedulingOptimizerApi as api } from '../api/posAiSchedulingOptimizerApi';
import { P, muted, today } from './ai-scheduling/schedUi';
import { SchedOverviewCard } from './ai-scheduling/SchedOverviewCard';
import { SchedCapacityCard } from './ai-scheduling/SchedCapacityCard';
import { SchedRecommendationsCard, type SchedDayAppointment } from './ai-scheduling/SchedRecommendationsCard';
import { SchedRecommendationDetail } from './ai-scheduling/SchedRecommendationDetail';
import { SchedFindTimeCard } from './ai-scheduling/SchedFindTimeCard';
import { SchedRunDetailCard, SchedHistoryCard } from './ai-scheduling/SchedRunsCard';
import { SchedProposalsCard } from './ai-scheduling/SchedProposalsCard';
import { SchedInsightsCard } from './ai-scheduling/SchedInsightsCard';
import { SchedInputsCard } from './ai-scheduling/SchedInputsCard';
import { SchedSettingsCard } from './ai-scheduling/SchedSettingsCard';
import { SchedUsageCard } from './ai-scheduling/SchedUsageCard';
import { SchedCounters, SchedQueueCard, SchedEventTrailCard, SC_GROUPS } from './ai-scheduling/SchedCenter';
import { useTechnicianNames } from '../components/useTechnicianNames';
import { FitDialog } from '../components/FitKit';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

type Tab = 'overview' | 'recs' | 'find' | 'gaps' | 'approvals' | 'insights' | 'inputs' | 'settings' | 'usage' | 'history';
/** [tab, label KEY] — translated at render (WP-C1) */
const TABS: [Tab, string][] = [
  ['overview', 'pos.overview'], ['recs', 'pos.recommendations'], ['find', 'pos.find_a_time'], ['gaps', 'pos.gaps_conflicts'], ['approvals', 'pos.customer_approvals'],
  ['insights', 'pos.insights'], ['inputs', 'ops.sched.tab.inputs'], ['settings', 'pos.settings'], ['usage', 'pos.usage_export'], ['history', 'pos.history'],
];
const isTab = (t: string | null): t is Tab => !!t && TABS.some(([k]) => k === t);

const page: React.CSSProperties = { height: '100%', overflow: 'auto', background: 'var(--aps-page, #F7EFE3)', fontFamily: 'var(--aps-font-body, Hanken Grotesk)' };
const header: React.CSSProperties = { display: 'flex', gap: 12, padding: '14px 20px', borderBottom: '1px solid var(--line)', background: '#FFFCF6', flexWrap: 'wrap', alignItems: 'center' };
const title: React.CSSProperties = { fontWeight: 800, fontSize: 18, fontFamily: 'var(--aps-font-head, Playfair Display)', color: '#2C2A27', margin: 0 };
const tabBtn = (on: boolean): React.CSSProperties => ({ height: 32, padding: '0 12px', borderRadius: 8, border: `1px solid ${on ? '#A96F22' : 'var(--line)'}`, background: on ? '#A96F22' : '#fff', color: on ? '#fff' : '#4A4744', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0, whiteSpace: 'nowrap' });

// 200-technician §2 (Oct 26 2026): the day WITHOUT the roster — technicians are picked through the server-paged picker and
// their names resolved on demand (the day's appointments name theirs; any other id is one server lookup)
type BookingDay = { services: { serviceId: string; name: string; durationMinutes?: number }[]; appointments: (SchedDayAppointment & { technicianName?: string | null })[] };

export function POSAISchedulingOptimizerScreen() {
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const recParam = params.get('rec');
  const [tab, setTabState] = useState<Tab>(recParam ? 'recs' : isTab(params.get('tab')) ? (params.get('tab') as Tab) : 'overview');
  const [selected, setSelected] = useState<string | null>(recParam);
  const [runId, setRunId] = useState<string | null>(null);
  const [howOpen, setHowOpen] = useState(false);
  const [queueGroup, setQueueGroup] = useState<(typeof SC_GROUPS)[number]>('all');
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);
  const [settings, setSettings] = useState<SchedSettingsView | null>(null);
  const [settingsTick, setSettingsTick] = useState(0);
  const [day, setDay] = useState<BookingDay>({ services: [], appointments: [] });
  const [lockedIds, setLockedIds] = useState<Set<string>>(() => new Set());
  const date = useMemo(() => today(), []);
  const canView = can(P.view);

  useEffect(() => { if (recParam) { setSelected(recParam); setTabState('recs'); } }, [recParam]);
  const setTab = (t: Tab) => { setTabState(t); const n = new URLSearchParams(params); n.set('tab', t); n.delete('rec'); setParams(n, { replace: true }); };
  const select = (id: string | null) => { setSelected(id); if (id) setTabState('recs'); };
  const openRun = (id: string) => { setRunId(id); setTabState('gaps'); };

  useEffect(() => { if (canView) api.settings().then(setSettings).catch(() => setSettings(null)); }, [tick, settingsTick, canView]);
  useEffect(() => {
    if (!canView) return;
    // the day's services and appointments — the same source the booking calendar uses (no roster: §2)
    (posBookingApi.state({ date, roster: 'none' }) as Promise<any>).then((s) => setDay({
      services: Array.isArray(s?.filters?.services) ? s.filters.services : [],
      appointments: Array.isArray(s?.bookings?.items) ? s.bookings.items : [],
    })).catch(() => setDay({ services: [], appointments: [] }));
    api.calendar(date).then((c) => setLockedIds(new Set(Object.entries(c?.appointments ?? {}).filter(([, v]) => v?.locked).map(([k]) => k)))).catch(() => setLockedIds(new Set()));
  }, [date, tick, canView]);
  // Constitution 9: schedule_recommendation_updated / schedule_run_completed / schedule_settings_changed /
  // schedule_proposal_updated arrive on the branch stream with screen key "ai-scheduling-optimizer".
  useRealtime(['ai-scheduling-optimizer'], bump);

  const seed = useMemo(() => day.appointments.filter((a) => a.technicianId && a.technicianName).map((a) => ({ technicianId: String(a.technicianId), name: String(a.technicianName) })), [day.appointments]);
  const names = useTechnicianNames(seed);
  const techName = useCallback((id: string | null | undefined) => (id ? names.name(id) || tx('pos.a_technician') : tx('pos.any_technician_2')), [names]);
  const props = { tick, can, techName, onChanged: bump };

  if (!canView) {
    return <div style={page}><div style={header}><h2 style={title}>{tx('pos.ai_scheduling_optimizer')}</h2></div><div style={{ padding: 20, ...muted }}>{tx('pos.you_do_not_have_access_to_8ftz')}</div></div>;
  }
  return (
    <div style={page}>
      <div style={header}>
        <div style={{ display: 'grid', gap: 2 }}>
          <h2 style={title}>{tx('pos.ai_scheduling_optimizer')}</h2>
          <span style={muted}>{tx('pos.suggestions_only_nothing_changes_a_confirmed_194k')}</span>
        </div>
        <button className="btn ghost whitespace-nowrap !h-8" style={{ marginLeft: 'auto' }} onClick={() => setHowOpen(true)} data-testid="sched-how">{tx('sox.how.btn')}</button>
        <button className="btn whitespace-nowrap !h-8" onClick={bump} data-testid="sched-refresh">{tx('pos.refresh')}</button>
      </div>
      {/* Scheduling Optimizer guide: the four counters, server-computed, on every tab; a counter opens its queue */}
      <div style={{ padding: '12px 20px 0' }}><SchedCounters tick={tick} onDrill={(g) => { setQueueGroup(g); setSelected(null); setTab('recs'); }} /></div>
      <div style={{ padding: '12px 20px 0', display: 'flex', gap: 6, flexWrap: 'wrap' }} role="tablist" aria-label={tx('pos.optimizer_sections')} data-testid="sched-tabs">
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} style={tabBtn(tab === k)} onClick={() => setTab(k)}>{tx(l)}</button>)}
      </div>
      {/* Scheduling Optimizer SUNMI guide (Nov 9 2026): "How this works" — plain words, no data, nothing changes */}
      {howOpen ? <FitDialog testId="sched-how-dialog" title={tx('sox.how.title')} onClose={() => setHowOpen(false)} footer={<button className="btn ghost" onClick={() => setHowOpen(false)}>{tx('pos.close')}</button>}>
        <ol className="sox-how">{[1, 2, 3, 4, 5].map((n) => <li key={n}>{tx('sox.how.' + n)}</li>)}</ol>
      </FitDialog> : null}
      <div style={{ padding: 20, display: 'grid', gap: 16 }} data-testid="sched-body">
        {tab === 'overview' && <SchedOverviewCard {...props} date={date} settings={settings} onOpenRun={openRun} onSelectRec={select} />}
        {tab === 'overview' && <SchedCapacityCard date={date} tick={tick} />}
        {tab === 'recs' && <>
          {selected ? <SchedRecommendationDetail id={selected} tick={tick} can={can} techName={techName} onChanged={bump} onClose={() => select(null)} /> : null}
          <SchedQueueCard tick={tick} group={queueGroup} selectedId={selected} onSelect={select} />
          <SchedRecommendationsCard {...props} selectedId={selected} onSelect={select} date={date} appointments={day.appointments} />
        </>}
        {tab === 'find' && <SchedFindTimeCard can={can} date={date} services={day.services} />}
        {tab === 'gaps' && <SchedRunDetailCard tick={tick} techName={techName} runId={runId} date={date} onSelectRec={select} />}
        {tab === 'approvals' && <SchedProposalsCard {...props} onSelect={select} />}
        {tab === 'insights' && <SchedInsightsCard {...props} services={day.services} />}
        {tab === 'inputs' && <SchedInputsCard {...props} services={day.services} appointments={day.appointments} lockedIds={lockedIds} />}
        {tab === 'settings' && <SchedSettingsCard tick={tick} can={can} onChanged={bump} view={settings} reload={() => setSettingsTick((x) => x + 1)} />}
        {tab === 'usage' && <SchedUsageCard tick={tick} can={can} />}
        {tab === 'history' && <>
          <SchedEventTrailCard tick={tick} onSelect={select} />
          <SchedHistoryCard tick={tick} techName={techName} onOpenRun={openRun} />
        </>}
      </div>
    </div>
  );
}
