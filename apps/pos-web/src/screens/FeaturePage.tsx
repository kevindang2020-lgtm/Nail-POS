// FeaturePage.tsx — the single page rendered for tenant nav routes that don't yet have a dedicated screen.
// It NEVER shows a blank page: it resolves the nav item for the current path and renders the correct state
// (available scaffold, or a clean 403 / feature-unavailable / AI-required / suspended message per spec §25).
// Backend remains the source of truth; this gives correct UX. Real per-feature screens replace these over time.
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { allNavItems, Icon } from '../shell/tenant-nav';
import { useTenantNavAccess, gateFor } from '../shell/tenant-access';
import { PageHeader, EmptyState, StatusBadge } from '@aipowersalon/ui';
import { t } from '@aipowersalon/mobile-sdk/i18n';

export function FeaturePage() {
  const loc = useLocation();
  const nav = useNavigate();
  const { principal } = useAuth();
  const access = useTenantNavAccess(principal?.role, principal?.permissions);
  const item = allNavItems().find((i) => i.route === loc.pathname);
  const label = item?.label || 'Module';
  const gate = item ? gateFor(item, access) : 'ok';

  const Wrap = ({ icon, title, body, cta }: { icon: 'lock' | 'ai' | 'management'; title: string; body: string; cta?: { label: string; to: string } }) => (
    <div className="work">
      <div className="feature-state">
        <div className={`fs-ic ${icon === 'lock' || icon === 'ai' ? 'locked' : ''}`}><Icon name={icon === 'ai' ? 'ai' : icon === 'lock' ? 'lock' : 'management'} /></div>
        <h2 className="fs-title">{title}</h2>
        <p className="fs-body">{body}</p>
        {cta ? <button className="btn primary" onClick={() => nav(cta.to)}>{cta.label}</button> : null}
      </div>
    </div>
  );

  if (gate === 'no-permission')
    return <Wrap icon="lock" title={t('pos.you_do_not_have_permission_to_1wo6')} body={t('pos.ask_your_salon_owner_or_manager_ntrv')} />;
  if (gate === 'feature-locked')
    return <Wrap icon="lock" title={t('pos.this_feature_is_not_included_in_c7k5')} body={t('pos.label_requires_a_plan_that_includes_ofc5', { label: String(label) })} cta={{ label: t('pos.view_plans_billing'), to: '/tenant/account/billing' }} />;
  if (gate === 'ai-locked')
    return <Wrap icon="ai" title={t('pos.subscribe_to_this_ai_package_to_g9o9')} body={t('pos.label_is_part_of_the_ai_1oaz', { label: String(label) })} cta={{ label: t('pos.browse_ai_packages'), to: '/tenant/ai/plans' }} />;
  if (gate === 'suspended')
    return <Wrap icon="lock" title={t('pos.your_salon_account_is_currently_suspended')} body={t('pos.open_billing_to_resolve_the_issue_zryb')} cta={{ label: t('pos.open_billing'), to: '/tenant/account/billing' }} />;

  // OK → scaffold (real screen pending). Honest, not blank: states what the page is for + a back action.
  // Rendered from the canonical shared kit (@aipowersalon/ui) — proves the kit is wired into the tenant POS app.
  return (
    <div className="work">
      <div style={{ maxWidth: 760, margin: '28px auto', padding: '0 16px' }}>
        <PageHeader title={label} subtitle={t('pos.connected_permission_checked_detailed_screen_rolling_1g68')}
          actions={<StatusBadge tone="info" dot>{t('pos.planned')}</StatusBadge>} />
        <div style={{ border: '1px solid var(--aps-line)', borderRadius: 'var(--aps-radius)', background: 'var(--aps-card)' }}>
          <EmptyState title={t('pos.this_module_is_wired_through_the_1dji')}
            message={t('pos.your_access_plan_and_data_are_lo31')}
            action={<button className="btn ghost" onClick={() => nav('/overview')}>{t('pos.back_to_overview')}</button>} />
        </div>
      </div>
    </div>
  );
}
export default FeaturePage;
