import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
const { previewMock, draftMock, submitMock, approveMock } = vi.hoisted(() => ({ previewMock: vi.fn(), draftMock: vi.fn(), submitMock: vi.fn(), approveMock: vi.fn() }));
vi.mock('../api/posAIMarketingApi', () => ({ posAIMarketingApi: { previewAudience: previewMock, generateDraft: draftMock, submitCampaign: submitMock, approveCampaign: approveMock, state: vi.fn() } }));
import { POSAICampaignBuilderScreen } from './POSAICampaignBuilderScreen';
beforeEach(() => { previewMock.mockReset(); draftMock.mockReset(); submitMock.mockReset(); approveMock.mockReset(); });

function next() { fireEvent.click(screen.getByText('Next')); }

describe('POSAICampaignBuilderScreen', () => {
  it('walks goal→audience→message→offer→schedule→review and submits + approves', async () => {
    previewMock.mockResolvedValue({ total: 100, eligible: 80, suppressed: 20, breakdown: { missingContact: 5, optedOut: 15 } });
    submitMock.mockResolvedValue({ campaign: { id: 'c1', status: 'draft' } });
    approveMock.mockResolvedValue({ status: 'scheduled', scheduledAt: '2026-07-10T14:00:00Z' });

    render(<POSAICampaignBuilderScreen />);
    // Goal
    fireEvent.change(screen.getByPlaceholderText('e.g. July gel rebooking'), { target: { value: 'July rebook' } });
    next();
    // Audience — estimate then next
    fireEvent.click(screen.getByText('Estimate audience'));
    expect(await screen.findByText('80')).toBeInTheDocument();
    next();
    // Message — type a draft
    fireEvent.change(screen.getByPlaceholderText(/Write or generate the message/i), { target: { value: 'Hi {{customer_first_name}} {{booking_link}}' } });
    next();
    // Offer — skip
    next();
    // Schedule — future
    const future = '2030-01-01T10:00';
    fireEvent.change(screen.getByDisplayValue(''), { target: { value: future } });
    next();
    // Review — submit
    fireEvent.click(screen.getByText('Submit & schedule'));
    expect(await screen.findByText(/is/)).toBeInTheDocument();
    expect(submitMock).toHaveBeenCalledOnce();
    expect(approveMock).toHaveBeenCalledOnce();
    // submit body carries the audience definition + eligible size (the missing link for sending)
    const body = submitMock.mock.calls[0][0];
    expect(body.audienceSize).toBe(80);
    expect(body.audienceDefinition).toBeTruthy();
    expect(body.draftText).toContain('{{booking_link}}');
  });

  it('gates Next until the current step is complete', async () => {
    render(<POSAICampaignBuilderScreen />);
    next(); // no name yet
    expect(await screen.findByText('Complete this step first.')).toBeInTheDocument();
  });
});
