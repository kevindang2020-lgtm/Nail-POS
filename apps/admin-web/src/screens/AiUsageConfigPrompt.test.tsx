import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AiPromptModal } from './AiUsageConfigPrompt';

const saveAiPrompt = vi.fn();
vi.mock('../api/superAdminApi', () => ({ superAdminApi: { saveAiPrompt: (...a: any[]) => saveAiPrompt(...a) } }));

describe('AiPromptModal', () => {
  beforeEach(() => { saveAiPrompt.mockReset(); saveAiPrompt.mockResolvedValue({ ok: true, prompt: { id: 'AIPMT-0009', promptKey: 'new_prompt', name: 'New', body: 'Hello', version: 1, status: 'active', updatedAt: '2026-05-06T10:00:00Z' } }); });

  it('validates key format, name, and body', () => {
    render(<AiPromptModal onClose={() => {}} onSaved={() => {}} />);
    fireEvent.change(screen.getByLabelText('Prompt key'), { target: { value: 'Bad Key' } });
    fireEvent.click(screen.getByText('Save prompt'));
    expect(screen.getByText(/lowercase letters, numbers, and underscores/)).toBeInTheDocument();
    expect(saveAiPrompt).not.toHaveBeenCalled();
  });

  it('saves a new prompt', async () => {
    const onSaved = vi.fn();
    render(<AiPromptModal onClose={() => {}} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText('Prompt key'), { target: { value: 'new_prompt' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New' } });
    fireEvent.change(screen.getByLabelText('Prompt body'), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByText('Save prompt'));
    await waitFor(() => expect(saveAiPrompt).toHaveBeenCalledWith(expect.objectContaining({ promptKey: 'new_prompt', name: 'New', body: 'Hello' })));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.stringMatching(/v1/)));
  });

  it('bumps version display and locks key when editing', async () => {
    saveAiPrompt.mockResolvedValue({ ok: true, prompt: { id: 'AIPMT-0001', promptKey: 'reminders', name: 'Reminders', body: 'x', version: 4, status: 'active', updatedAt: '2026-05-06T10:00:00Z' } });
    const onSaved = vi.fn();
    render(<AiPromptModal existing={{ id: 'AIPMT-0001', promptKey: 'reminders', name: 'Reminders', body: 'orig', version: 3, status: 'active', updatedAt: '2026-05-06T10:00:00Z' }} onClose={() => {}} onSaved={onSaved} />);
    expect(screen.getByText(/Edit Prompt · v3/)).toBeInTheDocument();
    expect(screen.getByLabelText('Prompt key')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Prompt body'), { target: { value: 'updated' } });
    fireEvent.click(screen.getByText('Save prompt'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.stringMatching(/v4/)));
  });
});
