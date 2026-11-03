// POSAIFraudProtectionAssistantScreen.tsx — AI Center → AI Fraud & Money Protection add-on (/tenant/ai/fraud-protection). AI Fraud &
// Money Protection guide (Nov 2 2026, built Nov 3 2026). The add-on header stays and is honest (AiPackagePanel — one package state).
// Below it, the add-on's dashboard reads the Money Protection center that owns the alerts (/pos/money-protection-center/*): the
// overview cards (value under review is never a confirmed loss), the alert list (search · status · severity · kind · presets + From/To
// month calendar · numbered pages) and Check AI Money Protection System. Reviewing alerts, investigations and rules happens in
// Money Protection; nothing here moves money.
import { AiPackagePanel } from './POSAiPackageScreen';
import { AssistantDashboard, asWhen } from '../components/AssistantDashboard';
import { posAIMoneyProtectionApi } from '../api/posAIMoneyProtectionApi';
import { mpErr } from './MoneyProtectionWorkspace';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { fmtNumber } from '../i18n/format';
import { money } from './reportsCommon';

const t = (k: string, v?: Record<string, string | number>) => tx(k, v as Parameters<typeof tx>[1]);
const mc = posAIMoneyProtectionApi.center;
const GROUPS = ['open', 'new', 'resolved', 'dismissed', 'all'];
const SEVS = ['all', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
const CATS = ['all', 'duplicate_charge', 'refund', 'void', 'discount', 'tip', 'failed_payment', 'reconciliation', 'employee', 'integrity'];
const RULES = new Set(['MP_DUP_CHARGE_EXACT', 'MP_DUP_CHARGE_LIKELY', 'MP_REFUND_EXCEEDS_CAPTURE', 'MP_REFUND_METHOD_MISMATCH', 'MP_DISCOUNT_EXCEEDS_SUBTOTAL', 'MP_NEGATIVE_CAPTURE', 'MP_MULTIPLE_REVERSALS',
  'MP_FAILED_PAYMENT_RETRY_LOOP', 'MP_PAID_NO_CAPTURE', 'MP_CAPTURE_ON_CANCELLED', 'MP_REVERSAL_RATE_OUTLIER', 'MP_MEMBERSHIP_DUP_CHARGE', 'MP_GIFTCARD_NEGATIVE_BALANCE', 'MP_GIFTCARD_REDEEM_EXCEEDS', 'MP_CASH_DRAWER_VARIANCE']);
const SEV_TONE: Record<string, string> = { CRITICAL: 'bad', HIGH: 'bad', MEDIUM: 'warn' };

export function POSAIFraudProtectionAssistantScreen() {
  return (
    <AiPackagePanel code="ai_fraud_money_protection" title={t('pos.ai_fraud_protection')}>
      <AssistantDashboard testId="fpx-dashboard"
        summary={mc.summary}
        kpis={[
          { key: 'monitoring', label: t('mpx.check'), value: (s) => (s.monitoring === 'current' ? t('mpx.health.PASSED') : s.monitoring === 'module_off' ? t('mpx.health.FAILED') : t('mpx.health.WARNING')), tone: (s) => (s.monitoring === 'current' ? undefined : 'warn') },
          { key: 'new', label: t('mpx.kpi.new'), value: (s) => fmtNumber(s.cards.newAlerts), tone: (s) => (s.cards.newAlerts ? 'gold' : undefined) },
          { key: 'critical', label: t('mpx.kpi.critical'), value: (s) => fmtNumber(s.cards.critical), tone: (s) => (s.cards.critical ? 'bad' : undefined) },
          { key: 'value', label: t('mpx.kpi.value'), value: (s) => money(s.cards.valueUnderReviewCents) },
          { key: 'cases', label: t('mpx.kpi.cases'), value: (s) => fmtNumber(s.cards.openInvestigations) },
          { key: 'dismissed', label: t('mpx.kpi.dismissed'), value: (s) => fmtNumber(s.cards.dismissed30d) },
        ]}
        list={mc.alerts}
        rowKey={(r) => r.id}
        columns={[
          { key: 'when', label: t('mpx.col.when'), render: (r) => asWhen(r.firstSeenAt) },
          { key: 'alert', label: t('mpx.col.alert'), render: (r) => <><b>{RULES.has(r.ruleId) ? t('mpx.rule.' + r.ruleId) : r.rule}</b><div className="sub">{t('mpx.cat.' + (CATS.includes(r.category) ? r.category : 'other'))}</div></> },
          { key: 'severity', label: t('mpx.col.severity'), render: (r) => <span className={'chip ' + (SEV_TONE[r.severity] ?? '')}>{t('mpx.sev.' + r.severity)}</span> },
          { key: 'amount', label: t('mpx.col.amount'), render: (r) => money(r.amountCents) },
          { key: 'status', label: t('mpx.col.status'), render: (r) => <span className="chip">{t('mpx.st.' + r.status)}</span> },
        ]}
        filters={[
          { key: 'status', label: t('mpx.statusLabel'), options: GROUPS.map((v) => ({ value: v, label: t('mpx.grp.' + v) })) },
          { key: 'severity', label: t('mpx.severityLabel'), options: SEVS.map((v) => ({ value: v, label: t('mpx.sev.' + v) })) },
          { key: 'category', label: t('mpx.categoryLabel'), options: CATS.map((v) => ({ value: v, label: t('mpx.cat.' + v) })) },
        ]}
        sorts={['newest', 'oldest', 'severity', 'value'].map((v) => ({ value: v, label: t('mpx.sort.' + v) }))}
        presets={['today', 'yesterday', 'week', 'last_7', 'month', 'last_30', 'last_90', 'last_month', 'year']}
        searchPlaceholder={t('mpx.searchPh')} listTitle={t('fpx.list')}
        emptyText={(filtered, s) => (filtered ? t('mpx.noMatch') : s && s.monitoring !== 'current' ? t('mpx.mon.' + s.monitoring, { at: asWhen(s.lastSuccessAt ?? s.lastRun?.startedAt) }) : t('mpx.noOpen'))}
        check={mc.check} checkLabel={t('mpx.check')}
        checkText={{ title: (k) => t('mpx.health.k.' + k), detail: (k, s) => t('mpx.health.d.' + k + '.' + s), part: (x) => (x.component ? t('mpx.health.part', { c: t('mpx.comp.' + x.component) }) : null) }}
        openTo="/tenant/ai/money-protection" openLabel={t('fpx.open')} note={t('mpx.safety')} errText={(e) => mpErr(e)} />
    </AiPackagePanel>
  );
}
