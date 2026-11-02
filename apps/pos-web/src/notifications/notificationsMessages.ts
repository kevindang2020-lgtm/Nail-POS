// notificationsMessages.ts — maps a send result to owner-friendly feedback. Pure + testable.
import type { SendNotificationResult } from '../api/posNotificationsApi';
import { t } from '@aipowersalon/mobile-sdk/i18n';

export type FeedbackTone = 'success' | 'warning' | 'error';
export interface SendFeedback { tone: FeedbackTone; message: string }

export function feedbackForSend(res: SendNotificationResult | null | undefined): SendFeedback {
  if (!res) return { tone: 'error', message: t('pos.no_response_from_the_server') };
  if (res.sent) return { tone: 'success', message: t('pos.message_sent') };
  if (res.status === 'blocked' && res.reason === 'over_limit')
    return { tone: 'warning', message: t('pos.you_re_out_of_messaging_credits_gu6s') };
  if (res.status === 'blocked' && res.reason === 'opted_out')
    return { tone: 'warning', message: t('pos.this_recipient_has_opted_out_of_4p0j') };
  if (res.status === 'blocked')
    return { tone: 'warning', message: t('pos.message_could_not_be_sent') };
  // failed
  return { tone: 'error', message: t('pos.the_message_provider_rejected_this_message_94pn') };
}
