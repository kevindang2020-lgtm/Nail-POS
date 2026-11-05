// TechnicianImportPanel — §112: preview before commit; commit only when the preview found something to add; the
// per-row outcome table is the server's (never matched by name — the server says so per row).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const h = vi.hoisted(() => ({ importTechnicians: vi.fn() }));
vi.mock('../api/posTechniciansApi', () => ({ posTechniciansApi: h }));
import { TechnicianImportPanel } from './TechnicianImportPanel';

const preview = { dryRun: true, runId: null, total: 3, counts: { will_create: 1, will_invite_existing: 1, invalid: 1 }, results: [
  { line: 2, name: 'Mia Pham', outcome: 'will_create' }, { line: 3, name: 'Ann Le', outcome: 'will_invite_existing', techCode: 'T-0042', message: 'Ann Le already has an AIPowerSalon account — an invitation will be sent; she joins when she accepts.' },
  { line: 4, name: '', outcome: 'invalid', message: 'A phone or an email is required (technicians are never matched by name).' } ] };
const committed = { ...preview, dryRun: false, runId: 'run1', counts: { created: 1, invited_existing: 1, invalid: 1 }, results: preview.results.map((r) => ({ ...r, outcome: r.outcome === 'will_create' ? 'created' : r.outcome === 'will_invite_existing' ? 'invited_existing' : r.outcome })) };

beforeEach(() => { h.importTechnicians.mockReset(); });

describe('TechnicianImportPanel', () => {
  it('previews first (dryRun true), then imports (dryRun false) and reports the server outcome per row', async () => {
    h.importTechnicians.mockResolvedValueOnce(preview).mockResolvedValueOnce(committed);
    const onImported = vi.fn();
    render(<TechnicianImportPanel onImported={onImported} />);
    const importBtn = screen.getByRole('button', { name: /^Import/ });
    expect(importBtn).toBeDisabled();                                  // nothing previewed yet
    fireEvent.change(screen.getByLabelText('CSV text'), { target: { value: 'First Name,Last Name,Phone\nMia,Pham,8565550101\n' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await waitFor(() => expect(h.importTechnicians).toHaveBeenCalledWith(expect.stringContaining('Mia,Pham'), true));
    expect(await screen.findByLabelText('Import preview')).toHaveTextContent('Will create');
    expect(screen.getByText(/never matched by name/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Import 2 technicians' }));
    await waitFor(() => expect(h.importTechnicians).toHaveBeenLastCalledWith(expect.stringContaining('Mia,Pham'), false));
    expect(await screen.findByLabelText('Import result')).toHaveTextContent('Created');
    expect(screen.getByText(/T-0042/)).toBeInTheDocument();
    expect(onImported).toHaveBeenCalled();
  });

  it('a preview with nothing to add keeps Import disabled; a server refusal shows inline', async () => {
    h.importTechnicians.mockResolvedValueOnce({ dryRun: true, runId: null, total: 1, counts: { already_here: 1 }, results: [{ line: 2, name: 'Mia Pham', outcome: 'already_here' }] });
    render(<TechnicianImportPanel />);
    fireEvent.change(screen.getByLabelText('CSV text'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText('Already at this salon')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Import/ })).toBeDisabled();
    h.importTechnicians.mockRejectedValueOnce(new Error('The header row must include First Name and Last Name columns.'));
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText(/header row must include/)).toBeInTheDocument();
  });
});
