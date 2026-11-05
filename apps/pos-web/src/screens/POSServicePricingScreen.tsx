// POSServicePricingScreen.tsx — Services → Pricing. Wired to GET /pos/services/state
// (permission-gated pos.services.view). Service menu with duration and price.
import { useEffect, useState } from 'react';
import { posServicesApi } from '../api/posServicesApi';
import { money, reportError } from './reportsCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';

type ServiceItem = { serviceId: string; serviceName: string; categoryName: string; durationMinutes: number; priceCents: number };
type ServicesState = { services?: { items: ServiceItem[] } };

export function POSServicePricingScreen() {
  const [items, setItems] = useState<ServiceItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true; setLoading(true); setError(null);
    (async () => {
      try { const d = await posServicesApi.state() as ServicesState; if (alive) setItems(d?.services?.items ?? []); }
      catch (e: any) { if (alive) setError(reportError(e, t('admin.noun.servicePricing'))); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  if (loading) return <div className="work"><div className="state">{t('pos.loading_pricing')}</div></div>;
  if (error) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  const list = items || [];
  const avg = list.length ? Math.round(list.reduce((a, s) => a + (s.priceCents || 0), 0) / list.length) : 0;
  const min = list.length ? Math.min(...list.map((s) => s.priceCents)) : 0;
  const max = list.length ? Math.max(...list.map((s) => s.priceCents)) : 0;

  return (
    <div className="work">
      <div className="mb-6 flex flex-col xl:flex-row gap-3 justify-between">
        <div className="vh"><h1>{t('pos.service_pricing')}</h1><div className="sub">{t('pos.your_service_menu_durations_and_prices')}</div></div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5 mb-3.5">
        <div className="kpi w-full" style={{ margin: 0 }}><div className="l">{t('pos.services')}</div><div className="v">{list.length}</div></div>
        <div className="kpi w-full" style={{ margin: 0 }}><div className="l">{t('pos.average_price')}</div><div className="v">{money(avg)}</div></div>
        <div className="kpi w-full" style={{ margin: 0 }}><div className="l">{t('pos.lowest')}</div><div className="v">{money(min)}</div></div>
        <div className="kpi w-full" style={{ margin: 0 }}><div className="l">{t('pos.highest')}</div><div className="v">{money(max)}</div></div>
      </div>
      <section className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        {list.length === 0 ? <div className="state" style={{ padding: 16 }}>{t('pos.no_services_in_the_menu_yet')}</div> : (
          <div className="overflow-x-auto">
            <div className="min-w-[500px]">
              <table className="tbl">
                <thead><tr><th>{t('pos.service_3')}</th><th>{t('pos.category')}</th><th style={{ textAlign: 'right' }}>{t('pos.duration')}</th><th style={{ textAlign: 'right' }}>{t('pos.price')}</th></tr></thead>
                <tbody>{list.slice(0, 200).map((s) => (
                  <tr key={s.serviceId}>
                    <td>{s.serviceName}</td><td>{s.categoryName || '—'}</td>
                    <td style={{ textAlign: 'right' }}>{s.durationMinutes ? t('pos.durationminutes_min', { durationMinutes: String(s.durationMinutes) }) : '—'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(s.priceCents)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
