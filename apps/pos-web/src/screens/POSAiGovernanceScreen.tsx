// POSAiGovernanceScreen.tsx — AI Center → "AI Platform & Limits". Constitution 10 §166/§168/§169.
//
// This is the GOVERNANCE view, deliberately not a second KPI dashboard: what the AI platform is permitted to
// do in this salon (automation level per task, against the platform ceiling it cannot exceed), what it has
// cost against the budget, and what is waiting on a human. The business-outcome numbers live in the AI Command
// Center (/tenant/ai/command-center) and are linked from here rather than repeated.
//
// §166 is the rule that shapes this file: the server omits a section the caller may not see and NAMES it in
// `hidden`. So a missing section is rendered as "you do not have permission to see this", never as an empty
// panel — an empty usage card and a forbidden one look identical to a user, and one of them is a lie.
import { useCallback, useEffect, useState } from 'react';
import { posAiGovernanceApi as govApi, type TenantAiDashboard, type AutomationLevel } from '../api/posAiGovernanceApi';
import { t as tx, enPlural } from '@aipowersalon/mobile-sdk/i18n';

interface FeedbackSummary { total: number; acceptanceRate: number; correctionRate: number; rejectionRate: number; topReason: string | null }

const LINE = 'var(--line,#E7DBC6)';
const MUTED = 'var(--muted,#7A6C57)';
const GOLD = 'var(--aps-orange,#A96F22)';

/** A rate arrives as 0..1; a salon owner reads a percentage. Guards a zero total, where every rate is 0/0. */
export function formatRate(rate: number | null | undefined, total: number): string {
  if (!total || rate === null || rate === undefined || !Number.isFinite(rate)) return '—';
  return `${Math.round(rate * 100)}%`;
}

/** Micro-USD is the platform's unit; a salon owner reads dollars. */
export function formatMicroUsd(micro: number): string {
  if (!Number.isFinite(micro)) return '—';
  return `$${(micro / 1_000_000).toFixed(2)}`;
}

/**
 * Plain words for every level the engine can return — SUGGEST_ONLY / APPROVAL_REQUIRED mean nothing to a salon
 * owner. One entry per member of AUTOMATION_LEVELS, pinned by a test: a level with no label falls through to
 * its raw name, which is invisible until a tenant actually has a task at that level.
 */
export const AUTOMATION_LABELS: Record<AutomationLevel, string> = {
  get OFF() { return tx('growth.aiGovernance.level.OFF'); },
  get SUGGEST_ONLY() { return tx('growth.aiGovernance.level.SUGGEST_ONLY'); },
  get DRAFT() { return tx('growth.aiGovernance.level.DRAFT'); },
  get APPROVAL_REQUIRED() { return tx('growth.aiGovernance.level.APPROVAL_REQUIRED'); },
  get LIMITED_AUTOMATION() { return tx('growth.aiGovernance.level.LIMITED_AUTOMATION'); },
  get AUTOMATIC() { return tx('growth.aiGovernance.level.AUTOMATIC'); },
};

/** §110: a task at its platform ceiling cannot be raised here, and the UI should say so rather than offer it. */
export function isAtCeiling(effective: AutomationLevel, platformMax: AutomationLevel): boolean {
  return effective === platformMax;
}

const SECTION_EXPLANATIONS: Record<string, string> = {
  get usage() { return tx('growth.aiGovernance.locked.usage'); },
  get budget() { return tx('growth.aiGovernance.locked.budget'); },
  get settings() { return tx('growth.aiGovernance.locked.settings'); },
};

export function POSAiGovernanceScreen() {
  const [data, setData] = useState<TenantAiDashboard | null>(null);
  const [feedback, setFeedback] = useState<FeedbackSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try { setData(await govApi.dashboard()); }
    catch (e: any) { setData(null); setError(e?.message || tx('pos.could_not_load_ai_platform_settings')); return; }
    // §129, and §168's split: submitting feedback needs only ai.read, but READING the salon-wide summary needs
    // the usage permission. A 403 here is normal for some roles, so it hides the panel rather than the screen.
    try { setFeedback(await govApi.feedbackSummary()); } catch { setFeedback(null); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (error) return <div style={{ padding: 20 }}><h1>{tx('pos.ai_platform_limits')}</h1><p style={{ color: MUTED }}>{error}</p></div>;
  if (!data) return <div style={{ padding: 20 }}><h1>{tx('pos.ai_platform_limits')}</h1><p style={{ color: MUTED }}>{tx('pos.loading')}</p></div>;

  const hidden = new Set(data.hidden || []);

  return (
    <div style={{ padding: 20, display: 'grid', gap: 18 }}>
      <header>
        <h1 style={{ margin: 0 }}>{tx('pos.ai_platform_limits')}</h1>
        <p style={{ color: MUTED, margin: '4px 0 0' }}>
          {tx('pos.what_ai_is_allowed_to_do_8z2r')}{' '}
          <a href="/tenant/ai/command-center" style={{ color: GOLD }}>{tx('pos.ai_command_center')}</a>.
        </p>
      </header>

      {/* §168: cost is salon-wide analytics. Absent ≠ zero, so say which it is. */}
      <section style={{ border: `1px solid ${LINE}`, borderRadius: 10, padding: 14 }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>{tx('pos.this_month')}</h2>
        {hidden.has('usage') || !data.usage ? (
          <p style={{ color: MUTED, margin: 0 }}>{SECTION_EXPLANATIONS.usage}</p>
        ) : (
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div><div style={{ color: MUTED, fontSize: 12 }}>{tx('pos.requests')}</div><div style={{ fontSize: 20 }}>{data.usage.requests}</div></div>
            <div><div style={{ color: MUTED, fontSize: 12 }}>{tx('pos.failed_2')}</div><div style={{ fontSize: 20 }}>{data.usage.failures}</div></div>
            <div><div style={{ color: MUTED, fontSize: 12 }}>{tx('pos.cost')}</div><div style={{ fontSize: 20 }}>{formatMicroUsd(data.usage.costMicroUsd)}</div></div>
          </div>
        )}
      </section>

      <section style={{ border: `1px solid ${LINE}`, borderRadius: 10, padding: 14 }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>{tx('pos.budget')}</h2>
        {hidden.has('budget') || !data.budget ? (
          <p style={{ color: MUTED, margin: 0 }}>
            {hidden.has('budget') ? SECTION_EXPLANATIONS.budget : tx('pos.no_ai_budget_has_been_set_1nuz')}
          </p>
        ) : (
          <>
            <div>{formatMicroUsd(data.budget.spentMicroUsd)} {tx('pos.of')}{' '}{formatMicroUsd(data.budget.limitMicroUsd)}</div>
            <div aria-hidden style={{ height: 8, background: LINE, borderRadius: 4, marginTop: 6 }}>
              <div style={{ height: 8, width: `${Math.min(100, Math.round(data.budget.usedPercent))}%`, background: GOLD, borderRadius: 4 }} />
            </div>
            <div style={{ color: MUTED, fontSize: 12, marginTop: 4 }}>{Math.round(data.budget.usedPercent)}{tx('pos.used_2')}</div>
          </>
        )}
      </section>

      {/* §110: the ceiling is shown next to the level, so a tenant can see what is theirs to change. */}
      <section style={{ border: `1px solid ${LINE}`, borderRadius: 10, padding: 14 }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>{tx('pos.what_ai_may_do')}</h2>
        {data.automationByTask.length === 0 ? (
          <p style={{ color: MUTED, margin: 0 }}>{tx('pos.no_ai_tasks_are_enabled_for_150f')}</p>
        ) : (
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: MUTED, fontSize: 12 }}>
                <th style={{ padding: '4px 8px 4px 0' }}>{tx('pos.task')}</th>
                <th style={{ padding: '4px 8px' }}>{tx('pos.currently_2')}</th>
                <th style={{ padding: '4px 8px' }}>{tx('pos.platform_limit')}</th>
              </tr>
            </thead>
            <tbody>
              {data.automationByTask.map((t) => (
                <tr key={t.taskKey} style={{ borderTop: `1px solid ${LINE}` }}>
                  <td style={{ padding: '6px 8px 6px 0' }}>{t.taskKey}</td>
                  <td style={{ padding: '6px 8px' }}>{AUTOMATION_LABELS[t.effective] ?? t.effective}</td>
                  <td style={{ padding: '6px 8px', color: MUTED }}>
                    {AUTOMATION_LABELS[t.platformMax] ?? t.platformMax}
                    {isAtCeiling(t.effective, t.platformMax) ? tx('pos.at_the_limit') : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={{ border: `1px solid ${LINE}`, borderRadius: 10, padding: 14 }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>{tx('pos.waiting_for_approval')}</h2>
        {data.pendingApprovals.length === 0
          ? <p style={{ color: MUTED, margin: 0 }}>{tx('pos.nothing_is_waiting_on_a_person_14ck')}</p>
          : <p style={{ margin: 0 }}>{data.pendingApprovals.length} {tx('pos.item')}{enPlural(data.pendingApprovals.length === 1 ? '' : 's')} {tx('pos.need_a_decision')}</p>}
      </section>

      {/* §129: what the salon's own corrections say. Shown only when there is something to say. */}
      {feedback && feedback.total > 0 && (
        <section style={{ border: `1px solid ${LINE}`, borderRadius: 10, padding: 14 }}>
          <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>{tx('pos.how_your_team_rates_ai_suggestions')}</h2>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div><div style={{ color: MUTED, fontSize: 12 }}>{tx('pos.used_as_is')}</div><div style={{ fontSize: 20 }}>{formatRate(feedback.acceptanceRate, feedback.total)}</div></div>
            <div><div style={{ color: MUTED, fontSize: 12 }}>{tx('pos.edited_first')}</div><div style={{ fontSize: 20 }}>{formatRate(feedback.correctionRate, feedback.total)}</div></div>
            <div><div style={{ color: MUTED, fontSize: 12 }}>{tx('pos.rejected_2')}</div><div style={{ fontSize: 20 }}>{formatRate(feedback.rejectionRate, feedback.total)}</div></div>
          </div>
          <div style={{ color: MUTED, fontSize: 12, marginTop: 6 }}>
            {tx('pos.based_on')}{' '}{feedback.total} {tx('pos.rated_suggestion')}{enPlural(feedback.total === 1 ? '' : 's')}
            {feedback.topReason ? tx('growth.aiGovernance.topReason', { reason: String(feedback.topReason) }) : ''}
          </div>
        </section>
      )}

      {data.canManageSettings
        ? <p style={{ margin: 0 }}><a href="/tenant/ai/platform/settings" style={{ color: GOLD }}>{tx('pos.change_these_limits')}</a></p>
        : <p style={{ color: MUTED, margin: 0 }}>{SECTION_EXPLANATIONS.settings}</p>}
    </div>
  );
}
