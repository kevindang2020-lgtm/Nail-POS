// POSAiSettingsEditor.test — Constitution 10 §52/§110 in the UI.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { POSAiSettingsEditor, selectableLevels } from './POSAiSettingsEditor';

vi.mock('../api/posAiGovernanceApi', async (orig) => ({
  ...(await orig<typeof import('../api/posAiGovernanceApi')>()),
  posAiGovernanceApi: { getSettings: vi.fn(), saveSettings: vi.fn() },
}));
import { posAiGovernanceApi, AUTOMATION_LEVELS } from '../api/posAiGovernanceApi';

const payload = (over: Record<string, unknown> = {}) => ({
  settings: { automation: { 'followups.draft': 'SUGGEST_ONLY' }, killSwitch: false },
  levels: AUTOMATION_LEVELS,
  tasks: [{ taskKey: 'followups.draft', module: 'followups', risk: 'low', platformMax: 'APPROVAL_REQUIRED' }],
  ...over,
});

describe('§110: the editor offers only what the platform permits', () => {
  it('levels stop at the ceiling', () => {
    expect(selectableLevels('APPROVAL_REQUIRED')).toEqual(['OFF', 'SUGGEST_ONLY', 'DRAFT', 'APPROVAL_REQUIRED']);
  });

  it('a ceiling of OFF leaves exactly one choice', () => {
    expect(selectableLevels('OFF')).toEqual(['OFF']);
  });

  it('the highest ceiling still offers every level', () => {
    expect(selectableLevels('AUTOMATIC')).toEqual([...AUTOMATION_LEVELS]);
  });

  it('an UNKNOWN ceiling offers only the safest level — it must not fail open to everything', () => {
    expect(selectableLevels('NONSENSE' as never)).toEqual(['OFF']);
  });

  it('the dropdown renders only the permitted options', async () => {
    (posAiGovernanceApi.getSettings as any).mockResolvedValue(payload());
    render(<POSAiSettingsEditor />);
    const select = await screen.findByLabelText('Automation level for followups.draft') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['OFF', 'SUGGEST_ONLY', 'DRAFT', 'APPROVAL_REQUIRED']);
    expect([...select.options].map((o) => o.value)).not.toContain('AUTOMATIC');
  });
});

describe('saving', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends the edited level', async () => {
    (posAiGovernanceApi.getSettings as any).mockResolvedValue(payload());
    (posAiGovernanceApi.saveSettings as any).mockResolvedValue({ ok: true, settings: {} });
    render(<POSAiSettingsEditor />);
    const select = await screen.findByLabelText('Automation level for followups.draft');
    fireEvent.change(select, { target: { value: 'DRAFT' } });
    fireEvent.click(screen.getByText('Save AI settings'));
    await waitFor(() => expect(posAiGovernanceApi.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ automation: expect.objectContaining({ 'followups.draft': 'DRAFT' }) })));
  });

  it("A SERVER REFUSAL IS SHOWN VERBATIM — the client list can go stale and the server is right", async () => {
    (posAiGovernanceApi.getSettings as any).mockResolvedValue(payload());
    (posAiGovernanceApi.saveSettings as any).mockRejectedValue(new Error('followups.draft cannot be set to DRAFT: the platform allows at most SUGGEST_ONLY'));
    render(<POSAiSettingsEditor />);
    await screen.findByLabelText('Automation level for followups.draft');
    fireEvent.click(screen.getByText('Save AI settings'));
    expect(await screen.findByRole('alert')).toHaveTextContent('the platform allows at most SUGGEST_ONLY');
  });

  it('a failed save does NOT claim success', async () => {
    (posAiGovernanceApi.getSettings as any).mockResolvedValue(payload());
    (posAiGovernanceApi.saveSettings as any).mockRejectedValue(new Error('nope'));
    render(<POSAiSettingsEditor />);
    await screen.findByLabelText('Automation level for followups.draft');
    fireEvent.click(screen.getByText('Save AI settings'));
    await screen.findByRole('alert');
    expect(screen.queryByText('Saved.')).not.toBeInTheDocument();
  });

  it('a successful save confirms', async () => {
    (posAiGovernanceApi.getSettings as any).mockResolvedValue(payload());
    (posAiGovernanceApi.saveSettings as any).mockResolvedValue({ ok: true, settings: {} });
    render(<POSAiSettingsEditor />);
    await screen.findByLabelText('Automation level for followups.draft');
    fireEvent.click(screen.getByText('Save AI settings'));
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });

  it('the kill switch is sent, and disables the per-task controls while on', async () => {
    (posAiGovernanceApi.getSettings as any).mockResolvedValue(payload());
    (posAiGovernanceApi.saveSettings as any).mockResolvedValue({ ok: true, settings: {} });
    render(<POSAiSettingsEditor />);
    const select = await screen.findByLabelText('Automation level for followups.draft') as HTMLSelectElement;
    fireEvent.click(screen.getByLabelText('Turn off all AI in this salon'));
    expect(select.disabled).toBe(true);
    fireEvent.click(screen.getByText('Save AI settings'));
    await waitFor(() => expect(posAiGovernanceApi.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ killSwitch: true })));
  });

  it('a 403 on load explains instead of rendering an empty editor', async () => {
    (posAiGovernanceApi.getSettings as any).mockRejectedValue(new Error('forbidden'));
    render(<POSAiSettingsEditor />);
    expect(await screen.findByText('forbidden')).toBeInTheDocument();
    expect(screen.queryByText('Save AI settings')).not.toBeInTheDocument();
  });
});
