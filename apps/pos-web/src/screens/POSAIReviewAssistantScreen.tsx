// POSAIReviewAssistantScreen.tsx — AI Center → AI Review / Reputation Assistant (/tenant/ai/reviews). AI Review / Reputation
// Assistant guide (Nov 1 2026, built Nov 3 2026). The add-on header stays (title, Growth, description, Works in, price, usage,
// status, Cancel add-on) and is honest (AiPackagePanel reads ONE package state — "On trial", "Limited" and "trial ended" are never
// shown together). The empty space below becomes the assistant's dashboard, read from Reviews & Reputation (/pos/reputation/*,
// the module that owns reviews): the six cards with one definition, the review list (search · reply state · rating · complaint ·
// presets + From/To month calendar · sort · numbered pages, newest first) and Check AI Review System. Drafting, approval and
// publishing stay in Reviews & Reputation — nothing is posted or sent from here.
import { AiPackagePanel } from './POSAiPackageScreen';
import { AssistantDashboard, asWhen } from '../components/AssistantDashboard';
import { posReputationApi } from '../api/posReputationApi';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { fmtNumber } from '../i18n/format';

const t = (k: string, v?: Record<string, string | number>) => tx(k, v as Parameters<typeof tx>[1]);
const RESP = ['unanswered', 'draft', 'awaiting_approval', 'approved', 'published', 'publish_failed', 'rejected'];
const COMPLAINT = ['none', 'open', 'acknowledged', 'resolved'];
const SOURCES = ['google', 'facebook', 'yelp', 'internal', 'survey', 'sms', 'email', 'app', 'support', 'manual'];
const pctText = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v * 1000) / 10}%`);
const known = (list: string[], v: string | null | undefined) => (v && list.includes(v) ? v : null);

export function POSAIReviewAssistantScreen() {
  return (
    <AiPackagePanel code="ai_review_reputation_assistant" title={t('pos.ai_reviews_reputation')}>
      <AssistantDashboard testId="rax-dashboard"
        summary={posReputationApi.summary}
        kpis={[
          { key: 'reviews', label: t('rax.kpi.reviews'), value: (s) => fmtNumber(s.metrics.reviews) },
          { key: 'avg', label: t('rax.kpi.avg'), value: (s) => (s.metrics.averageRating == null ? '—' : (Math.round(s.metrics.averageRating * 10) / 10).toFixed(1)) },
          { key: 'negative', label: t('rax.kpi.negative'), value: (s) => `${fmtNumber(s.metrics.negativeReviews)} · ${pctText(s.metrics.negativeShare)}`, tone: (s) => (s.metrics.negativeReviews ? 'warn' : undefined) },
          { key: 'awaiting', label: t('rax.kpi.awaiting'), value: (s) => fmtNumber(s.metrics.awaitingApproval), tone: (s) => (s.metrics.awaitingApproval ? 'gold' : undefined) },
          { key: 'serious', label: t('rax.kpi.serious'), value: (s) => fmtNumber(s.metrics.seriousComplaints), tone: (s) => (s.metrics.seriousComplaints ? 'bad' : undefined) },
          { key: 'response', label: t('rax.kpi.response'), value: (s) => pctText(s.metrics.responseRate) },
        ]}
        list={posReputationApi.reviews}
        rowKey={(r) => r.id}
        columns={[
          { key: 'when', label: t('rax.col.when'), render: (r) => asWhen(r.at) },
          { key: 'rating', label: t('rax.col.rating'), render: (r) => (r.rating == null ? t('rax.noRating') : t('rax.stars', { n: r.rating })) },
          { key: 'review', label: t('rax.col.review'), render: (r) => <>{r.reviewer ? <b>{r.reviewer}</b> : null}{r.excerpt ? <div className="sub">{r.excerpt}{r.truncated ? '…' : ''}</div> : null}</> },
          { key: 'source', label: t('rax.col.source'), render: (r) => (known(SOURCES, r.source) ? t('rpx.src.' + r.source) : '—') },
          { key: 'reply', label: t('rax.col.reply'), render: (r) => <span className="chip">{known(RESP, r.response) ? t('rpx.resp.' + r.response) : '—'}</span> },
          { key: 'complaint', label: t('rax.col.complaint'), render: (r) => (known(COMPLAINT, r.complaint) && r.complaint !== 'none' ? <span className="chip warn">{t('rpx.case.' + r.complaint)}</span> : '—') },
        ]}
        filters={[
          { key: 'response', label: t('rax.f.response'), options: [{ value: '', label: t('rax.anyReply') }, ...RESP.map((v) => ({ value: v, label: t('rpx.resp.' + v) }))] },
          { key: 'rating', label: t('rax.f.rating'), options: [{ value: '', label: t('rax.anyRating') }, ...['1', '2', '3', '4', '5'].map((v) => ({ value: v, label: t('rax.stars', { n: v }) }))] },
          { key: 'complaint', label: t('rax.f.complaint'), options: [{ value: '', label: t('rax.anyComplaint') }, ...COMPLAINT.map((v) => ({ value: v, label: t('rpx.case.' + v) }))] },
        ]}
        sorts={['newest', 'oldest', 'rating_low', 'rating_high'].map((v) => ({ value: v, label: t('rax.sort.' + v) }))}
        presets={['today', 'yesterday', 'week', 'last_7', 'month', 'last_30', 'last_90', 'last_month', 'year']}
        searchPlaceholder={t('rax.searchPh')} listTitle={t('rax.list')}
        emptyText={(filtered) => (filtered ? t('rax.noMatch') : t('rax.empty'))}
        check={posReputationApi.check} checkLabel={t('rax.check')}
        checkText={{ title: (k) => t('rpx.health.k.' + k), detail: (k, s) => t('rpx.health.d.' + k + '.' + s) }}
        openTo="/tenant/ai/reputation" openLabel={t('rax.open')} note={t('rax.note')} />
    </AiPackagePanel>
  );
}
