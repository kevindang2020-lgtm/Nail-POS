import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockListKeys, mockIssue, mockListCalls, mockListSug, mockActive, mockAnalytics } = vi.hoisted(() => ({
  mockListKeys: vi.fn(), mockIssue: vi.fn(), mockListCalls: vi.fn(), mockListSug: vi.fn(), mockActive: vi.fn(), mockAnalytics: vi.fn(),
}));
vi.mock('../api/superAdminVoiceApi', () => ({
  superAdminVoiceApi: {
    listKeys: (t: string) => mockListKeys(t),
    issueKey: (b: any) => mockIssue(b),
    revokeKey: vi.fn(),
    listCalls: (t: string, o: any) => mockListCalls(t, o),
    listSuggestions: (t: string, s?: string) => mockListSug(t, s),
    activePrompt: (t: string) => mockActive(t),
    analytics: (t: string) => mockAnalytics(t),
    gatewayMetrics: () => Promise.resolve({ since: '2026-07-04T00:00:00.000Z', totalRequests: 0, totalErrors: 0, successRatePct: null, idempotentReplays: 0, rateLimitEvents: 0, handoffs: 0, byOperation: {}, byErrorCode: {} }),
    fleet: () => Promise.resolve({ connected: false, tenantsWithAgents: 0, agentsByStatus: {}, provisioningFailures: 0, openFollowUps: 0 }),
    provisioningMetrics: () => Promise.resolve({ since: '2026-07-04T00:00:00.000Z', attempts: 0, succeeded: 0, failed: 0, successRatePct: null, byErrorCode: {} }),
    approveSuggestion: vi.fn(), rejectSuggestion: vi.fn(), rollbackPrompt: vi.fn(),
  },
}));

import AiReceptionistScreen from './AiReceptionistScreen';

function loadTenant() {
  fireEvent.change(screen.getByPlaceholderText(/Enter the tenant/i), { target: { value: 'ten_1' } });
  fireEvent.click(screen.getByText('Load'));
}

describe('AiReceptionistScreen', () => {
  beforeEach(() => {
    mockListKeys.mockResolvedValue([]);
    mockListCalls.mockResolvedValue([]);
    mockListSug.mockResolvedValue([]);
    mockActive.mockResolvedValue(null);
    mockAnalytics.mockResolvedValue({ totalCalls: 0, booked: 0, bookingRatePct: null, handoffs: 0, handoffRatePct: null, abandoned: 0, abandonmentRatePct: null, callsWithToolFailure: 0, toolFailureRatePct: null, followUpsNeeded: 0, avgDurationSeconds: null, topIntents: [] });
  });

  it('prompts for a tenant before loading anything', () => {
    render(<MemoryRouter><AiReceptionistScreen /></MemoryRouter>);
    expect(screen.getByText(/Enter a tenant ID to manage/i)).toBeTruthy();
    expect(mockListKeys).not.toHaveBeenCalled();
  });

  it('loads the three real sections for a tenant and shows honest empty states', async () => {
    render(<MemoryRouter><AiReceptionistScreen /></MemoryRouter>);
    loadTenant();
    await waitFor(() => expect(mockListKeys).toHaveBeenCalledWith('ten_1'));
    expect(mockListCalls).toHaveBeenCalledWith('ten_1', { limit: 25 });
    expect(mockListSug).toHaveBeenCalledWith('ten_1', 'open');
    await waitFor(() => expect(screen.getByText(/No keys yet/i)).toBeTruthy());
    expect(screen.getByText(/No calls recorded yet/i)).toBeTruthy();
    expect(screen.getByText(/No open suggestions/i)).toBeTruthy();
  });

  it('shows the active prompt as an em-dash when none is set (never faked)', async () => {
    render(<MemoryRouter><AiReceptionistScreen /></MemoryRouter>);
    loadTenant();
    await waitFor(() => expect(screen.getByText(/Active prompt:/i)).toBeTruthy());
  });

  it('issues a key and displays the raw value once with a copy-now warning', async () => {
    mockIssue.mockResolvedValue({ raw: 'vk_live_SHOWNONCE', key: { id: 'k1', prefix: 'vk_live_SHOW' } });
    render(<MemoryRouter><AiReceptionistScreen /></MemoryRouter>);
    loadTenant();
    await waitFor(() => expect(mockListKeys).toHaveBeenCalled());
    fireEvent.change(screen.getByPlaceholderText(/Branch ID/i), { target: { value: 'br_1' } });
    fireEvent.change(screen.getByPlaceholderText(/Label/i), { target: { value: 'Retell main' } });
    fireEvent.click(screen.getByText('Issue key'));
    await waitFor(() => expect(screen.getByText(/won't be shown again/i)).toBeTruthy());
    expect(screen.getByText('vk_live_SHOWNONCE')).toBeTruthy();
  });

  it('requires branch + label before issuing', async () => {
    render(<MemoryRouter><AiReceptionistScreen /></MemoryRouter>);
    loadTenant();
    await waitFor(() => expect(mockListKeys).toHaveBeenCalled());
    fireEvent.click(screen.getByText('Issue key'));
    await waitFor(() => expect(screen.getByText(/branch, and a label are required/i)).toBeTruthy());
  });

  it('renders call analytics metrics when data exists', async () => {
    mockAnalytics.mockResolvedValue({ totalCalls: 10, booked: 6, bookingRatePct: 60, handoffs: 2, handoffRatePct: 20, abandoned: 1, abandonmentRatePct: 10, callsWithToolFailure: 0, toolFailureRatePct: 0, followUpsNeeded: 1, avgDurationSeconds: 95, topIntents: [{ intent: 'BOOK', count: 6 }] });
    render(<MemoryRouter><AiReceptionistScreen /></MemoryRouter>);
    loadTenant();
    await waitFor(() => expect(screen.getByText('60%')).toBeTruthy()); // booking rate tile
    expect(screen.getByText(/Top intents:/i)).toBeTruthy();
  });

  it('surfaces the approval-drafts safeguard copy', async () => {
    render(<MemoryRouter><AiReceptionistScreen /></MemoryRouter>);
    loadTenant();
    await waitFor(() => expect(screen.getByText(/never goes live until you activate/i)).toBeTruthy());
  });
});
