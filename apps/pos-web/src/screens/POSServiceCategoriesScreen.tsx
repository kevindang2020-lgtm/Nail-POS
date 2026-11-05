// POSServiceCategoriesScreen.tsx — Services → Categories. Wired to GET /pos/services/state
// (permission-gated pos.services.view). Service categories with counts and share of catalog.
import { useEffect, useState } from 'react';
import { posServicesApi } from '../api/posServicesApi';
import { reportError } from './reportsCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';

type Cat = { categoryId: string; categoryName: string; serviceCount: number; percent: number; colorKey: string };
type ServicesState = { categoriesSummary?: { categories: Cat[] } };

export function POSServiceCategoriesScreen() {
  const [cats, setCats] = useState<Cat[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true; setLoading(true); setError(null);
    (async () => {
      try {
        const d = await posServicesApi.state() as ServicesState;
        if (alive) setCats(d?.categoriesSummary?.categories ?? []);
      } catch (e: any) { if (alive) setError(reportError(e, t('admin.noun.serviceCategories'))); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  if (loading) return <div className="work"><div className="state">{t('pos.loading_categories')}</div></div>;
  if (error) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  const list = cats || [];
  const totalServices = list.reduce((a, c) => a + (c.serviceCount || 0), 0);
  const maxCount = Math.max(1, ...list.map((c) => c.serviceCount));

  return (
    <div className="work">
      <div className="mb-6 flex flex-col xl:flex-row gap-3 justify-between">
        <div className="vh"><h1>{t('pos.service_categories')}</h1><div className="sub">{t('pos.how_your_service_catalog_is_organized')}</div></div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5 mb-3.5">
        <div className="kpi w-full" style={{ margin: 0 }}><div className="l">{t('pos.categories')}</div><div className="v">{list.length}</div></div>
        <div className="kpi w-full" style={{ margin: 0 }}><div className="l">{t('pos.total_services')}</div><div className="v">{totalServices}</div></div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <section className="panel">
          <div className="p-h">{t('pos.services_per_category')}</div>
          {list.length === 0 ? <div className="state">{t('pos.no_categories_yet')}</div> : (
            <div className="bars" role="img" aria-label={t('pos.services_per_category_2')}>
              {list.slice(0, 12).map((c) => (
                <div className="bar-col" key={c.categoryId} title={`${c.categoryName}: ${c.serviceCount}`}>
                  <div className="bar" style={{ height: `${Math.max(2, Math.round((c.serviceCount / maxCount) * 140))}px` }} />
                  <div className="bar-l">{c.categoryName.length > 10 ? c.categoryName.slice(0, 9) + '…' : c.categoryName}</div>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="panel">
          <div className="p-h">{t('pos.breakdown')}</div>
          {list.length === 0 ? <div className="state">{t('pos.no_data')}</div> : (
            <div className="overflow-x-auto">
              <div className="min-w-[400px]">
                <table className="tbl">
                  <thead><tr><th>{t('pos.category')}</th><th style={{ textAlign: 'right' }}>{t('pos.services')}</th><th style={{ textAlign: 'right' }}>{t('pos.share')}</th></tr></thead>
                  <tbody>{list.map((c) => (
                    <tr key={c.categoryId}><td>{c.categoryName}</td><td style={{ textAlign: 'right' }}>{c.serviceCount}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{(c.percent ?? 0).toFixed(1)}%</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
