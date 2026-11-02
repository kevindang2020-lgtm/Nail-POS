// POSAIQueueAssignmentScreen.tsx — tenant AI Queue Assignment workspace, wired to /pos/ai-queue-assignment
// (BUILD_PLAN Phase 6 — `ai_queue_assignment` complete; contract scratchpad/p6/CONTRACT.md §B/§C).
//
// Overview tiles; the per-customer panel (pick a guest from the live queue → recommendation → accept / reject with
// reason + feedback / override / keep unassigned / lock); live alerts (resolved hidden by default, auto-resolved shown
// as such — audit bug 9); the ONE settings source (salon + location, inherit vs override, versions, salon kill switch);
// turn rotation incl. the fixed order (rotation-policy is JSON now — audit bug 7); auto-assignment with the plain
// "auto is off because …" line; analytics, recent decisions and CSV export.
//
// Each card loads ON ITS OWN. Bug 7 was one bad answer inside a Promise.all blanking the whole screen; now a card that
// fails says so and the rest keep working. Realtime queue / alert / decision events bump `tick` and every card reloads.
// Staff keep control — nothing auto-assigns unless a manager turns it on.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRealtime } from '../realtime/useRealtime';
import { api as client } from '../api/client';
import { posAIQueueAssignmentApi as api, type AqOverview } from '../api/posAIQueueAssignmentApi';
import { useCan } from '../components/usePermissions';
import { AIQueueCustomerPanel } from './ai-queue/AIQueueCustomerPanel';
import { AIQueueAlertsCard } from './ai-queue/AIQueueAlertsCard';
import { AIQueueSettingsCard } from './ai-queue/AIQueueSettingsCard';
import { AIQueueRotationCard } from './ai-queue/AIQueueRotationCard';
import { AIQueueAutoCard } from './ai-queue/AIQueueAutoCard';
import { AIQueueAnalyticsCard } from './ai-queue/AIQueueAnalyticsCard';
import { Stat, muted, errText, mins, errMsg, autoOffReason, when } from './ai-queue/aiQueueUi';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

import { statusLabel } from '../i18n/status-label';
const page: React.CSSProperties = { height: '100vh', overflow: 'hidden', display: 'grid', gridTemplateRows: 'auto minmax(0,1fr)', background: 'var(--aps-page, #F7EFE3)', fontFamily: 'var(--aps-font-body, Hanken Grotesk)' };
const header: React.CSSProperties = { display: 'flex', gap: 12, padding: '14px 20px', borderBottom: '1px solid var(--line)', background: '#FFFCF6' };
const title: React.CSSProperties = { fontWeight: 800, fontSize: 18, fontFamily: 'var(--aps-font-head, Playfair Display)', color: '#2C2A27' };
const body: React.CSSProperties = { overflow: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 };

export function POSAIQueueAssignmentScreen() {
  const can = useCan();
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);
  const [ov, setOv] = useState<AqOverview | null>(null);
  const [ovErr, setOvErr] = useState<string | null>(null);
  const [staff, setStaff] = useState<{ technicianId: string; name: string }[]>([]);

  useEffect(() => {
    api.overview().then((o) => { setOv(o); setOvErr(null); }).catch((e) => setOvErr(errMsg(e, tx('growth.aiQueue.err.overview'))));
  }, [tick]);
  // the technician roster (ids + names) for override / lock / fixed order / exclusions — the same source the Queue uses
  useEffect(() => {
    (client.get('/pos/technicians/state') as Promise<{ rows?: { items?: { technicianId: string; displayName?: string; name?: string }[] } }>)
      .then((d) => setStaff((d?.rows?.items || []).map((t) => ({ technicianId: t.technicianId, name: t.displayName || t.name || tx('glossary.people.technician') }))))
      .catch(() => setStaff([]));
  }, []);
  // Constitution 9: queue alerts, recommendations, decisions, auto-assignments, locks, reorders and settings changes
  // arrive on the branch stream and route here.
  useRealtime(['ai-queue-assignment', 'queue'], bump);

  const roster = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of ov?.technicians || []) if (t.name) m.set(t.technicianId, t.name);
    for (const t of staff) if (!m.has(t.technicianId)) m.set(t.technicianId, t.name);
    return [...m.entries()].map(([technicianId, name]) => ({ technicianId, name }));
  }, [ov, staff]);
  const techName = useCallback((id: string | null | undefined) => (id ? roster.find((r) => r.technicianId === id)?.name || tx('pos.a_technician') : 'nobody'), [roster]);
  const dt = ov?.decisionsToday;
  const off = ov && !ov.autoAllowed ? autoOffReason(ov.autoBlockedBy) : null;

  return (
    <div style={page}>
      <div style={header} className='flex flex-col justify-between gap-3 sm:flex-row'>
        <div className="flex flex-col gap-1 justify-start">
          <h2 style={title}>{tx('pos.ai_queue_assignment')}</h2>
          <p style={{ ...muted, marginLeft: 4 }}>{tx('pos.recommends_technicians_staff_keep_control')}</p>
        </div>
        <div className='gap-2 flex items-center flex-wrap sm:flex-nowrap'>
          <button className='btn whitespace-nowrap !h-8' onClick={bump}>{tx('pos.refresh')}</button>
        </div>
      </div>

      <div style={body}>
        {/* Overview */}
        <section aria-label={tx('pos.overview')} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8 }}>
          {ovErr && !ov ? <div style={errText}>{ovErr}</div> : null}
          {ov ? <>
            <Stat label={tx('pos.waiting_2')} value={String(ov.waiting)} />
            <Stat label={tx('pos.unassigned')} value={String(ov.unassigned)} tone={ov.unassigned > 0 ? '#9B6B1E' : undefined} />
            <Stat label={tx('pos.in_service')} value={String(ov.inService)} />
            <Stat label={tx('pos.average_wait')} value={mins(ov.avgWaitMinutes)} />
            <Stat label={tx('pos.longest_wait_2')} value={mins(ov.longestWaitMinutes)} />
            <Stat label={tx('pos.open_alerts_2')} value={String(ov.openAlerts)} tone={ov.openAlerts > 0 ? '#B4451E' : undefined} />
            <Stat label={tx('pos.auto_assign')} value={ov.autoEnabled ? (ov.autoAllowed ? tx('pos.on') : tx('growth.aiQueue.blocked')) : tx('pos.off')} />
            <Stat label={tx('pos.decided_today')} value={dt ? String(dt.accepted + dt.rejected + dt.overridden + dt.autoAssigned) : '0'} />
          </> : (!ovErr ? <div style={muted}>{tx('pos.loading')}</div> : null)}
        </section>
        {dt ? <div style={muted}>{tx('pos.today_4')}{' '}{dt.accepted} {tx('pos.accepted')}{' '}{dt.rejected} {tx('pos.rejected')}{' '}{dt.overridden} {tx('pos.overridden')}{' '}{dt.autoAssigned} {tx('pos.auto_assigned')}{off && ov?.autoEnabled ? ` · ${off}` : ''}</div> : null}
        {ov && (ov.congestion || ov.lastScanAt) ? <div style={muted}>{ov.congestion ? tx('pos.congestion_v0', { v0: statusLabel('level', ov.congestion) }) : ''}{ov.congestion && ov.lastScanAt ? ' · ' : ''}{ov.lastScanAt ? tx('pos.last_checked_lastscanat', { lastScanAt: String(when(ov.lastScanAt)) }) : ''}{ov.lastAutoRunAt ? tx('pos.last_auto_run_lastautorunat', { lastAutoRunAt: String(when(ov.lastAutoRunAt)) }) : ''}</div> : null}
        {ov?.technicians?.length ? (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} aria-label={tx('pos.technicians_now')}>
            {ov.technicians.map((t) => <span key={t.technicianId} style={{ fontSize: 12, border: '1px solid var(--line)', borderRadius: 999, padding: '3px 10px', background: '#fff' }}>{t.name || techName(t.technicianId)} · {statusLabel(['techTicket', 'teamMember', 'turnBoard'], t.status)}{t.activeAssignments ? tx('pos.activeassignments_guest_plural', { activeAssignments: String(t.activeAssignments), plural: String(t.activeAssignments === 1 ? '' : 's') }) : ''}{t.availableInMinutes ? tx('pos.free_in_availableinminutes_min', { availableInMinutes: String(t.availableInMinutes) }) : ''}</span>)}
          </div>
        ) : null}

        <AIQueueCustomerPanel tick={tick} roster={roster} techName={techName} can={can} onChanged={bump} />
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))', alignItems: 'start' }}>
          <AIQueueAlertsCard tick={tick} can={can} techName={techName} roster={roster} onChanged={bump} />
          <AIQueueAutoCard tick={tick} can={can} roster={roster} onChanged={bump} />
          <AIQueueSettingsCard tick={tick} can={can} onChanged={bump} />
          <AIQueueRotationCard tick={tick} can={can} roster={roster} techName={techName} />
        </div>
        <AIQueueAnalyticsCard tick={tick} can={can} techName={techName} />
      </div>
    </div>
  );
}
