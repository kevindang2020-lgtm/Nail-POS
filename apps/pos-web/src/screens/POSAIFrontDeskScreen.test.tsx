import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const agents = [
  { id: 'a1', name: 'Main Front Desk', status: 'draft', callType: 'inbound', language: 'en', useCase: 'Front desk booking', greeting: null, behavior: null, provider: null, knowledgeVersion: 1, createdAtMs: 1, updatedAtMs: 1 },
];
const createReceptionistAgent = vi.fn((_b?: any) => Promise.resolve(agents[0]));
const receptionistAgents = vi.fn(() => Promise.resolve(agents));

vi.mock('../api/posAiApi', () => ({
  posAiApi: {
    receptionistAgents: () => receptionistAgents(),
    createReceptionistAgent: (b: any) => createReceptionistAgent(b),
    updateReceptionistAgent: vi.fn(),
    setReceptionistAgentStatus: vi.fn(() => Promise.resolve(agents[0])),
    provisionReceptionistAgent: vi.fn((_id?: string) => Promise.resolve({ id: 'job1', agentId: 'a1', status: 'failed', currentStepLabel: 'Creating voice agent', progress: 43, errorCode: 'PROVIDER_NOT_CONNECTED', safeErrorMessage: 'retell is not connected. Connect the account, then retry.', providerAgentId: null })),
    receptionistProvisioningJob: vi.fn((_id?: string) => Promise.resolve({ id: 'job1', agentId: 'a1', status: 'failed', currentStepLabel: 'Creating voice agent', progress: 43, errorCode: 'PROVIDER_NOT_CONNECTED', safeErrorMessage: 'retell is not connected. Connect the account, then retry.', providerAgentId: null })),
  },
}));

import { POSAIFrontDeskScreen } from './POSAIFrontDeskScreen';

describe('POSAIFrontDeskScreen', () => {
  it('lists real agents with honest draft status and no fake Live', async () => {
    render(<MemoryRouter><POSAIFrontDeskScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Main Front Desk')).toBeInTheDocument());
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.queryByText('live')).not.toBeInTheDocument(); // nothing fabricated as live
  });

  it('creates a draft agent via the create form', async () => {
    render(<MemoryRouter><POSAIFrontDeskScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Main Front Desk')).toBeInTheDocument());
    fireEvent.click(screen.getByText('+ Create Agent'));
    fireEvent.change(screen.getByPlaceholderText('Main Front Desk'), { target: { value: 'After-Hours Agent' } });
    fireEvent.click(screen.getByText('Save draft'));
    await waitFor(() => expect(createReceptionistAgent).toHaveBeenCalledWith(expect.objectContaining({ name: 'After-Hours Agent', callType: 'inbound' })));
  });

  it('provisioning surfaces the honest not-connected failure (no fake success)', async () => {
    render(<MemoryRouter><POSAIFrontDeskScreen /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Main Front Desk')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Provision'));
    await waitFor(() => expect(screen.getByText('Provisioning agent')).toBeInTheDocument());
    expect(screen.getByText(/is not connected/i)).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });
});
