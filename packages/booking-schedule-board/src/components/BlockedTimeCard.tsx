import { memo } from 'react';
import type { ScheduleSegment } from '../domain/scheduleTypes';
import { useBoardText } from '../i18n/boardText';

export const BlockedTimeCard = memo(function BlockedTimeCard({ segment, top, height, durationMinutes }: { segment: ScheduleSegment; top: number; height: number; durationMinutes: number }) {
  const { t } = useBoardText();
  const label = t(`seg.${segment.type}`);
  const text = segment.type === 'blocked' && segment.reason ? `${label} · ${segment.reason}` : `${label} · ${t('card.minShort', { n: durationMinutes })}`;
  const title = `${label} · ${t('card.min', { n: durationMinutes })}${segment.reason ? ` · ${segment.reason}` : ''}${segment.notes ? `\n${segment.notes}` : ''}${segment.createdByUserId ? `\n${t('seg.createdBy', { who: segment.createdByUserId })}` : ''} — ${t('seg.notBookable')}`;
  return (
    <div className="bsb-seg-card" data-type={segment.type} data-testid={`bsb-seg-${segment.id}`} style={{ top, height: Math.max(height - 2, 10) }} title={title} aria-label={title.replace(/\n/g, ' — ')}>
      {text}
    </div>
  );
});
