import { FollowUpQueuePanel } from '../components/FollowUpQueuePanel';
import { t } from '@aipowersalon/mobile-sdk/i18n';

// Follow-Up Queue (manager/POS). End-of-day follow-up tasks for this salon's branch, grouped by technician, with Send /
// Skip and a manual Generate Now. Fits the AIPowerSalon desktop-POS shell: the .work area scrolls internally; the task list
// scrolls inside its panel so the header/KPIs/sidebar stay put on a 24" Mac at 100% zoom. Server-truth only.
export function POSFollowUpsScreen() {
  return (
    <div className="work">
      <div className="vh">
        <h1>{t('pos.follow_up_queue')}</h1>
        <div className="sub">{t('pos.end_of_day_client_follow_ups_abri')}</div>
      </div>
      <FollowUpQueuePanel />
    </div>
  );
}
