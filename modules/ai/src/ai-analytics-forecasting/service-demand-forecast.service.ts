// service-demand-forecast.service.ts — extras (AI Analytics Forecasting 21): SERVICE DEMAND FORECASTING for the salon's real
// services. The history is what was actually performed and paid for: the paid tickets' service lines (not removed, not retail)
// per salon-local day of payment, grouped by the line's recorded category (the snapshot taken at checkout, else the service's
// category, else 'Uncategorized') — the same line definition the Sales report's service figures use. Each category with enough
// history is forecast with the SAME validated engine (selectModel → backtest → forecast, 80 % intervals) as the appointment and
// revenue forecasts; one without enough history says so instead of a guess. Units, not money. Read-only; tenant + branch scoped.
import { sql, type Kysely } from 'kysely';
import { branchTimeZone, type DB } from '@aipowersalon/database';
import { addDays } from '@aipowersalon/date-time';
import type { AiServiceDemandForecast, AiServiceDemandCategory } from '@aipowersalon/api-contracts/tenant';
import { forecast, backtest, selectModel, classifyDataQuality, classifyConfidence, type SeriesPoint } from './forecast-core';
import { AiForecastError, AiForecastErrorCode, type AiForecastContext } from './ai-analytics-forecasting.dto';
import { withCode } from '@aipowersalon/api-contracts';
import { salonToday, zeroFill } from './forecast-history.kysely.source';

export const SERVICE_DEMAND_MIN_HISTORY = 14;
export const SERVICE_DEMAND_LOOKBACK = 120;
const MAX_CATEGORIES = 12;
const isUuid = (v: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v ?? ''));

export interface ServiceDemandSource {
  /** units of service per category per salon day in [from, to]; days without a sale are simply absent */
  dailyUnits(ctx: AiForecastContext, from: string, to: string, tz: string): Promise<{ category: string; day: string; units: number }[]>;
  window(ctx: AiForecastContext, lookbackDays: number): Promise<{ from: string; to: string; tz: string }>;
}

export class KyselyServiceDemandSource implements ServiceDemandSource {
  constructor(private readonly db: Kysely<DB>, private readonly now: () => Date = () => new Date()) {}
  async window(ctx: AiForecastContext, lookbackDays: number) {
    const tz = await branchTimeZone(this.db, ctx.tenantId, isUuid(ctx.branchId) ? ctx.branchId : null);
    const today = await salonToday(this.db, ctx, this.now());
    return { from: addDays(today, -Math.max(1, lookbackDays)), to: addDays(today, -1), tz };   // today is not over
  }
  async dailyUnits(ctx: AiForecastContext, from: string, to: string, tz: string) {
    const rows = (await sql<{ category: string; day: string; units: number }>`
      select coalesce(nullif(btrim(l.category_snapshot), ''), nullif(btrim(c.name), ''), 'Uncategorized') as category,
             to_char((t.paid_at at time zone ${tz})::date, 'YYYY-MM-DD') as day,
             sum(greatest(1, coalesce(l.quantity, 1)))::int as units
        from ticket_service_lines l
        join tickets t on t.id = l.ticket_id and t.tenant_id = l.tenant_id
        left join services s on s.id = l.service_id and s.tenant_id = l.tenant_id
        left join service_categories c on c.id = s.category_id and c.tenant_id = l.tenant_id
       where l.tenant_id = ${ctx.tenantId} and ${isUuid(ctx.branchId) ? sql`t.branch_id = ${ctx.branchId}::uuid` : sql`true`}
         and l.removed_at is null and l.product_id is null and (l.line_kind is null or lower(l.line_kind) <> 'retail')
         and t.paid_at is not null and t.status in ('paid', 'completed', 'closed')
         and (t.paid_at at time zone ${tz})::date >= ${from}::date and (t.paid_at at time zone ${tz})::date <= ${to}::date
       group by 1, 2 order by 1, 2`.execute(this.db)).rows;
    return rows.map((r) => ({ category: String(r.category), day: String(r.day), units: Number(r.units) }));
  }
}

export class ServiceDemandForecastService {
  constructor(private readonly source: ServiceDemandSource | null) {}

  async getServiceDemand(ctx: AiForecastContext, horizonDays = 7): Promise<AiServiceDemandForecast> {
    if (horizonDays < 1 || horizonDays > 30) throw withCode(new AiForecastError(AiForecastErrorCode.INVALID_HORIZON, 'Horizon must be 1–30 days', 400), 'FORECAST_HORIZON_INVALID');
    if (!this.source) throw withCode(new AiForecastError(AiForecastErrorCode.INTERNAL_ERROR, 'Service history is not available here.', 503), 'SERVICE_UNAVAILABLE');
    const w = await this.source.window(ctx, SERVICE_DEMAND_LOOKBACK);
    const rows = await this.source.dailyUnits(ctx, w.from, w.to, w.tz);
    const byCat = new Map<string, SeriesPoint[]>();
    for (const r of rows) { const list = byCat.get(r.category) ?? []; list.push({ date: r.day, value: r.units }); byCat.set(r.category, list); }
    const categories: AiServiceDemandCategory[] = [...byCat.entries()].map(([category, pts]) => {
      pts.sort((a, b) => a.date.localeCompare(b.date));
      const series = zeroFill(pts, pts[0].date, w.to);           // history starts at the category's first sale; quiet days are 0
      const historyUnits = pts.reduce((a, p) => a + p.value, 0);
      const base = { category, historyDays: series.length, historyUnits, lastSaleDay: pts[pts.length - 1].date };
      if (series.length < SERVICE_DEMAND_MIN_HISTORY) {
        return { ...base, status: 'insufficient_history' as const, method: null, confidence: null, dataQuality: null, wape: null, forecastUnits: null, lowerUnits: null, upperUnits: null, horizon: [] };
      }
      const sel = selectModel(series, { minTrain: SERVICE_DEMAND_MIN_HISTORY, step: 1, period: 7 });
      const metrics = backtest(series, sel.selected, { minTrain: SERVICE_DEMAND_MIN_HISTORY, step: 1, period: 7 });
      const out = forecast(series, sel.selected, horizonDays, { intervalLevel: 0.8, period: 7, wape: metrics?.wape ?? null });
      const dq = classifyDataQuality(series);
      const horizon = out.horizon.map((h) => ({ date: addDays(w.to, h.step), point: round1(h.point), lower: round1(h.lower), upper: round1(h.upper) }));
      return { ...base, status: 'forecast' as const, method: sel.selected, confidence: classifyConfidence(series.length, horizonDays, metrics?.wape ?? null, dq), dataQuality: dq,
        wape: metrics?.wape ?? null, forecastUnits: round1(out.horizon.reduce((a, h) => a + h.point, 0)),
        lowerUnits: round1(out.horizon.reduce((a, h) => a + h.lower, 0)), upperUnits: round1(out.horizon.reduce((a, h) => a + h.upper, 0)), horizon };
    }).sort((a, b) => b.historyUnits - a.historyUnits || a.category.localeCompare(b.category)).slice(0, MAX_CATEGORIES);
    return { branchId: ctx.branchId, timeZone: w.tz, horizonDays, lookbackDays: SERVICE_DEMAND_LOOKBACK, minimumHistoryDays: SERVICE_DEMAND_MIN_HISTORY,
      historyFrom: w.from, historyTo: w.to, basis: 'paid_ticket_service_lines_by_paid_day', categories, generatedAt: new Date().toISOString(),
      disclaimer: 'Service demand forecast is decision-support, not booked appointments. Ranges are 80% prediction intervals summed over the horizon.' };
  }
}
const round1 = (n: number) => Math.round(Math.max(0, n) * 10) / 10;
