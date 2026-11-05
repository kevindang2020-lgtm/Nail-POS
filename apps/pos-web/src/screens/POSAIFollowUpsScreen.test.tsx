import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const followUps = [
  { id: 'fu1', reason: 'CALLBACK', priority: 'high', status: 'open', customerId: null, callerPhone: '8565550000', providerCallId: 'call_1', appointmentId: null, assignedUserId: null, notes: null, resolution: null, source: 'ai_receptionist', createdAtMs: 1710000000000, updatedAtMs: 1710000000000 },
];
const receptionistFollowUps = vi.fn((_s?: string) => Promise.resolve(followUps));
const createReceptionistFollowUp = vi.fn((_b?: any) => Promise.resolve(followUps[0]));

vi.mock('../api/posAiApi', () => ({
  posAiApi: {
    receptionistFollowUps: (s?: string) => receptionistFollowUps(s as any),
    createReceptionistFollowUp: (b: any) => createReceptionistFollowUp(b),
    assignReceptionistFollowUp: vi.fn(),
    noteReceptionistFollowUp: vi.fn(),
    setReceptionistFollowUpStatus: vi.fn(() => Promise.resolve(followUps[0])),
  },
}));

import { POSAIFollowUpsScreen } from './POSAIFollowUpsScreen';

describe('POSAIFollowUpsScreen', () => {
  it('lists real follow-ups with AI source marker and honest fields', async () => {
    render(<MemoryRouter><POSAIFollowUpsScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('callback')).toBeInTheDocument());
    expect(screen.getByText((t) => t.includes('8565550000'))).toBeInTheDocument();
    expect(screen.getByText(/from AI/)).toBeInTheDocument();
  });

  it('creates a manual follow-up', async () => {
    render(<MemoryRouter><POSAIFollowUpsScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('callback')).toBeInTheDocument());
    fireEvent.click(screen.getByText('+ New follow-up'));
    fireEvent.click(screen.getByText('Create follow-up'));
    await waitFor(() => expect(createReceptionistFollowUp).toHaveBeenCalledWith(expect.objectContaining({ reason: 'CALLBACK' })));
  });
});
