// POSAICustomerTimelineScreen.tsx — AI Center → AI Customer Profile → Timeline (§23). Look up a customer, then page
// through a unified, newest-first history (completed visits + appointment lifecycle). Cursor-paginated — never loads an
// unbounded history. Read-only.
import { useCallback, useState } from 'react';
import { posAiCustomerProfileApi as apiP } from '../api/posAiCustomerProfileApi';
import { CustomerLookup, Freshness, ErrorBox, Empty, profileError, DASH } from './aiCustomerProfileCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';

const EVENT_LABEL: Record<string, string> = {
  get visit_completed() { return t('growth.aiProfile.event.visit_completed'); }, get appointment_upcoming() { return t('growth.aiProfile.event.appointment_upcoming'); },
  get appointment_booked() { return t('growth.aiProfile.event.appointment_booked'); }, get appointment_cancelled() { return t('growth.aiProfile.event.appointment_cancelled'); }, get appointment_no_show() { return t('growth.aiProfile.event.appointment_no_show'); },
};
const EVENT_TONE: Record<string, string> = {
  visit_completed: 'var(--aps-orange)', appointment_upcoming: '#8a6d3b',
  appointment_cancelled: '#a12d2d', appointment_no_show: '#a12d2d', appointment_booked: 'var(--muted)',
};

export function POSAICustomerTimelineScreen() {
  const [selected, setSelected] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [fresh, setFresh] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchPage = useCallback(async (id: string, before: string | null) => {
    setLoading(true); setError(null);
    try {
      const r = await apiP.timeline(id, { limit: 25, before });
      setEvents((prev) => (before ? [...prev, ...r.events] : r.events));
      setCursor(r.nextCursor); setHasMore(r.hasMore); setFresh(r.freshness);
    } catch (e: any) { setError(profileError(e, t('growth.noun.thisTimeline'))); }
    finally { setLoading(false); }
  }, []);

  const pick = useCallback((c: any) => {
    setSelected(c); setEvents([]); setCursor(null); setHasMore(false);
    fetchPage(c.customerId || c.id, null);
  }, [fetchPage]);

  const name = (c: any) => c?.displayName || c?.fullName || [c?.firstName, c?.lastName].filter(Boolean).join(' ');

  return (
    <div className="work">
      <div className="vh flex flex-col sm:flex-row gap-3 justify-between">
        <div>
          <h1>{t('pos.customer_timeline')}</h1>
        <div className="sub mb-3">{t('pos.unified_visit_and_appointment_history_newest_9dy5')}</div>
        </div></div>

      {!selected ? <CustomerLookup onPick={pick} /> : (
        <section className="panel" style={{ marginTop: 12, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <strong>{name(selected)}</strong>
            <button className="btn w-fit whitespace-nowrap"  onClick={() => { setSelected(null); setEvents([]); }}>{t('pos.new_search')}</button>
          </div>

          {error ? <ErrorBox message={error} onRetry={() => fetchPage(selected.customerId || selected.id, null)} />
            : events.length === 0 && !loading ? <Empty label={t('pos.no_history_on_record_for_this_p83j')} />
            : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {events.map((e, i) => (
                <li key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, padding: '10px 0', borderTop: i ? '1px solid var(--line)' : 'none' }}>
                  <div style={{ minWidth: 92, color: 'var(--muted)', fontSize: 13 }}>{e.at ? e.at.slice(0, 10) : DASH}</div>
                  <div>
                    <div style={{ color: EVENT_TONE[e.type] || 'var(--muted)', fontWeight: 600 }}>{EVENT_LABEL[e.type] || e.title}</div>
                    <div className="sub" style={{ fontSize: 13 }}>{e.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
            {hasMore && <button className="seg-btn" onClick={() => fetchPage(selected.customerId || selected.id, cursor)} disabled={loading}>{loading ? t('pos.loading') : t('pos.load_older')}</button>}
            <Freshness f={fresh} />
          </div>
        </section>
      )}
    </div>
  );
}
