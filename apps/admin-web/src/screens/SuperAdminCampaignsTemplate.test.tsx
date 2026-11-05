import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CreateTemplateModal } from './SuperAdminCampaignsTemplate';

const createTemplate = vi.fn();
vi.mock('../api/superAdminApi', () => ({ superAdminApi: { createTemplate: (...a: any[]) => createTemplate(...a) } }));

describe('CreateTemplateModal', () => {
  beforeEach(() => { createTemplate.mockReset(); createTemplate.mockResolvedValue({ ok: true, template: { id: 'TMPL-0001', name: "Mother's Day", status: 'draft', currentVersion: 1 } }); });

  it('requires a name and some content', () => {
    render(<CreateTemplateModal onClose={() => {}} onCreated={() => {}} />);
    fireEvent.click(screen.getByText('Create template'));
    expect(screen.getByText(/A template name is required/)).toBeInTheDocument();
    expect(screen.getByText(/Provide some content/)).toBeInTheDocument();
    expect(createTemplate).not.toHaveBeenCalled();
  });

  it('creates a template with subject/body content', async () => {
    const onCreated = vi.fn();
    render(<CreateTemplateModal onClose={() => {}} onCreated={onCreated} />);
    fireEvent.change(screen.getByLabelText('Template name *'), { target: { value: "Mother's Day" } });
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Treat Mom' } });
    fireEvent.click(screen.getByText('Create template'));
    await waitFor(() => expect(createTemplate).toHaveBeenCalledWith(expect.objectContaining({ name: "Mother's Day", subject: 'Treat Mom' })));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.stringMatching(/v1/)));
  });
});
