// POSAICheckoutUpsellAssistantScreen.tsx — AI Center → AI Checkout + Upsell Assistant (/tenant/ai/checkout-upsell). AI Checkout + Upsell
// Assistant guide (Nov 2 2026, built Nov 3 2026). The add-on header stays and is honest (AiPackagePanel — one package state). Below
// it, the assistant's dashboard reads the upsell center that owns the suggestions (/pos/ai-checkout-upsell/center/*): whether the
// assistant is really on (and why not), the last 30 days of suggestions (generated · accepted · added to a hóa đơn · dismissed ·
// failed), the suggestion activity (search: customer name / phone with customers.view, hóa đơn number, suggestion, id · type ·
// status · presets + From/To month calendar · numbered pages, newest first) and Check Checkout Upsell System. A suggestion never
// charges, discounts, edits a hóa đơn / tip / commission or books — staff add it at Checkout.
import { AiPackagePanel } from './POSAiPackageScreen';
import { AssistantDashboard, asWhen } from '../components/AssistantDashboard';
import { posAiCheckoutUpsellApi } from '../api/posAiCheckoutUpsellApi';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { fmtNumber } from '../i18n/format';
import { money } from './reportsCommon';

const t = (k: string, v?: Record<string, string | number>) => tx(k, v as Parameters<typeof tx>[1]);
const TYPES = ['all', 'service_addon', 'product', 'membership', 'loyalty_enrollment', 'loyalty_redemption', 'gift_card', 'next_appointment', 'promotion'];
const STATUSES = ['all', 'GENERATED', 'DISPLAYED', 'ACCEPTED', 'APPLIED', 'DISMISSED', 'EXPIRED', 'INELIGIBLE', 'OUT_OF_STOCK', 'FAILED'];
const EFF = ['enabled', 'disabled', 'subscription_restricted', 'subscription_unknown', 'unknown'];
const TONE: Record<string, string> = { APPLIED: 'ok', ACCEPTED: 'ok', FAILED: 'bad', DISMISSED: '', EXPIRED: '' };
const c = posAiCheckoutUpsellApi.center;

export function POSAICheckoutUpsellAssistantScreen() {
  return (
    <AiPackagePanel code="ai_checkout_upsell_assistant" title={t('pos.ai_checkout_upsell')}>
      <AssistantDashboard testId="cux-dashboard"
        summary={c.summary}
        kpis={[
          { key: 'state', label: t('cux.kpi.state'), value: (s) => t('ucx.eff.' + (EFF.includes(s.effective) ? s.effective : 'unknown')), tone: (s) => (s.effective === 'enabled' ? undefined : 'warn') },
          { key: 'generated', label: t('cux.kpi.generated'), value: (s) => fmtNumber(s.last30d.generated) },
          { key: 'accepted', label: t('cux.kpi.accepted'), value: (s) => fmtNumber(s.last30d.accepted) },
          { key: 'applied', label: t('cux.kpi.applied'), value: (s) => fmtNumber(s.last30d.applied) },
          { key: 'dismissed', label: t('cux.kpi.dismissed'), value: (s) => fmtNumber(s.last30d.dismissed) },
          { key: 'failed', label: t('cux.kpi.failed'), value: (s) => fmtNumber(s.last30d.failed), tone: (s) => (s.last30d.failed ? 'bad' : undefined) },
        ]}
        list={c.activity}
        rowKey={(r) => r.id}
        columns={[
          { key: 'when', label: t('cux.col.when'), render: (r) => asWhen(r.createdAt) },
          { key: 'suggestion', label: t('cux.col.suggestion'), render: (r) => <><b>{r.title}</b><div className="sub">{t('ucx.type.' + (TYPES.includes(r.type) ? r.type : 'all'))}</div></> },
          { key: 'ticket', label: t('cux.col.ticket'), render: (r) => r.ticketNumber ?? '—' },
          { key: 'customer', label: t('cux.col.customer'), render: (r) => <>{r.customer ?? '—'}{r.customerPhoneLast4 ? <div className="sub">•••{r.customerPhoneLast4}</div> : null}</> },
          { key: 'price', label: t('cux.col.price'), render: (r) => (r.priceCents == null ? '—' : money(r.priceCents)) },
          { key: 'status', label: t('cux.col.status'), render: (r) => <span className={'chip ' + (TONE[r.status] ?? '')}>{t('ucx.st.' + (STATUSES.includes(r.status) ? r.status : 'all'))}</span> },
        ]}
        filters={[
          { key: 'type', label: t('cux.f.type'), options: TYPES.map((v) => ({ value: v, label: t('ucx.type.' + v) })) },
          { key: 'status', label: t('cux.f.status'), options: STATUSES.map((v) => ({ value: v, label: t('ucx.st.' + v) })) },
        ]}
        searchPlaceholder={t('cux.searchPh')} listTitle={t('cux.list')}
        emptyText={(filtered) => (filtered ? t('cux.noMatch') : t('cux.empty'))}
        check={c.check} checkLabel={t('cux.check')}
        checkText={{ title: (k) => t('ucx.health.k.' + k), detail: (k, s) => t('ucx.health.d.' + k + '.' + s) }}
        openTo="/tenant/ai/checkout-upsell/settings" openLabel={t('cux.open')} note={t('cux.note')} />
    </AiPackagePanel>
  );
}
