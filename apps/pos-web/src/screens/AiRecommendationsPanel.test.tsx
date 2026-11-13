// AiRecommendationsPanel — AI Receptionist Settings 07: the salon-side approval screen. A prompt recommendation needs the new
// wording and saves a DRAFT (the notice says calls keep the current wording); a FAQ one approves directly; reject works; a
// user without ai.manage sees the list read-only; a coded refusal shows its text.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const { api, m } = vi.hoisted(() => ({ api: { aiRecommendations: vi.fn(), approveAiRecommendation: vi.fn(), rejectAiRecommendation: vi.fn() }, m: { perms: ['ai.use', 'ai.manage'] as string[] } }));
vi.mock('../api/posAiApi', () => ({ posAiApi: api }));
vi.mock('../components/usePermissions', () => ({ useCan: () => (p: string) => m.perms.includes(p) }));
import { AiRecommendationsPanel } from './AiRecommendationsPanel';

const base = { sourceCallId: 'call_1', reviewedBy: null, resultingVersionId: null, createdMs: Date.parse('2026-11-12T15:00:00Z'), status: 'open' as const };
const LIST = { items: [{ ...base, id: 'r1', category: 'bad_wording', targetType: 'prompt', detail: 'Greet callers by salon name' }, { ...base, id: 'r2', category: 'repeated_questions', targetType: 'faq', detail: 'Add a parking FAQ' }], openCount: 2 };
beforeEach(() => { vi.clearAllMocks(); m.perms = ['ai.use', 'ai.manage']; api.aiRecommendations.mockResolvedValue(LIST); });

describe('AiRecommendationsPanel', () => {
  it('lists open recommendations with labelled area / reason and the open count', async () => {
    render(<AiRecommendationsPanel />);
    expect(await screen.findByTestId('aist-rec-r1')).toHaveTextContent('Receptionist wording');
    expect(screen.getByTestId('aist-rec-r2')).toHaveTextContent('Callers repeated questions');
    expect(screen.getByTestId('aist-recs-open')).toHaveTextContent('2 waiting');
    expect(api.aiRecommendations).toHaveBeenCalledWith('open');
  });
  it('a prompt recommendation asks for the new wording and saves a draft only', async () => {
    api.approveAiRecommendation.mockResolvedValue({ recommendation: { ...LIST.items[0], status: 'approved' }, draftVersionId: 'v9', draftVersionLabel: 'v3' });
    render(<AiRecommendationsPanel />);
    fireEvent.click((await screen.findAllByTestId('aist-rec-approve'))[0]);
    expect(screen.getByTestId('aist-rec-save-draft')).toBeDisabled();
    fireEvent.change(screen.getByTestId('aist-rec-body'), { target: { value: 'Thanks for calling Lotus Nails.' } });
    fireEvent.click(screen.getByTestId('aist-rec-save-draft'));
    await waitFor(() => expect(api.approveAiRecommendation).toHaveBeenCalledWith('r1', 'Thanks for calling Lotus Nails.'));
    expect(await screen.findByTestId('aist-recs-notice')).toHaveTextContent('Draft v3 saved; calls still use the current wording');
  });
  it('a FAQ recommendation approves directly; reject sends a reject; a coded refusal shows its text', async () => {
    api.approveAiRecommendation.mockResolvedValue({ recommendation: { ...LIST.items[1], status: 'approved' }, draftVersionId: null, draftVersionLabel: null });
    api.rejectAiRecommendation.mockRejectedValue({ status: 409, code: 'AI_RECOMMENDATION_NOT_OPEN', message: 'This recommendation was already reviewed.' });
    render(<AiRecommendationsPanel />);
    await screen.findByTestId('aist-rec-r2');
    fireEvent.click(screen.getAllByTestId('aist-rec-approve')[1]);
    await waitFor(() => expect(api.approveAiRecommendation).toHaveBeenCalledWith('r2', undefined));
    fireEvent.click(screen.getAllByTestId('aist-rec-reject')[0]);
    await waitFor(() => expect(api.rejectAiRecommendation).toHaveBeenCalledWith('r1'));
    expect(await screen.findByTestId('aist-recs-error')).toHaveTextContent('already reviewed');
  });
  it('without ai.manage the list is read-only', async () => {
    m.perms = ['ai.use'];
    render(<AiRecommendationsPanel />);
    await screen.findByTestId('aist-rec-r1');
    expect(screen.queryByTestId('aist-rec-approve')).toBeNull();
    expect(screen.getByTestId('aist-recs-readonly')).toBeInTheDocument();
  });
});
