import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
const { previewMock } = vi.hoisted(() => ({ previewMock: vi.fn() }));
vi.mock('../api/posAIMarketingApi', () => ({ posAIMarketingApi: { previewAudience: previewMock, state: vi.fn(), generateDraft: vi.fn() } }));
import { POSAIAudienceBuilderScreen } from './POSAIAudienceBuilderScreen';
beforeEach(() => previewMock.mockReset());

describe('POSAIAudienceBuilderScreen', () => {
  it('estimates an audience and shows eligible + exclusion breakdown', async () => {
    previewMock.mockResolvedValue({
      channel: 'sms', total: 200, eligible: 175, suppressed: 25,
      breakdown: { missingContact: 10, optedOut: 15 }, definitionEcho: {}, generatedAt: 'now',
    });
    render(<POSAIAudienceBuilderScreen />);
    fireEvent.click(screen.getByText('Estimate audience'));
    expect(await screen.findByText('175')).toBeInTheDocument(); // eligible
    expect(screen.getByText('Opted out / suppressed')).toBeInTheDocument();
    expect(screen.getByText('15')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(previewMock).toHaveBeenCalledOnce();
  });

  it('sends only approved dimensions in the request', async () => {
    previewMock.mockResolvedValue({ channel: 'sms', total: 0, eligible: 0, suppressed: 0, breakdown: { missingContact: 0, optedOut: 0 }, definitionEcho: {}, generatedAt: 'now' });
    render(<POSAIAudienceBuilderScreen />);
    fireEvent.click(screen.getByText('Estimate audience'));
    await screen.findByText('Eligible to send');
    const def = previewMock.mock.calls[0][0];
    expect(Object.keys(def).sort()).toEqual(['channel', 'excludeWithFutureAppointment', 'minDaysSinceLastCompletedVisit', 'requireActiveStatus']);
    expect(def.channel).toBe('sms');
  });
});
