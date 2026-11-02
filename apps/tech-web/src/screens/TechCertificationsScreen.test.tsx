// TechCertificationsScreen (merge Oct 12 2026): she adds / edits / removes only UNVERIFIED rows; the salon verifies.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TechNavProvider } from '../shell/nav';

const h = vi.hoisted(() => ({ certifications: vi.fn(), addCertification: vi.fn(), updateCertification: vi.fn(), deleteCertification: vi.fn(), uploadSkillDocument: vi.fn() }));
vi.mock('../api/techApi', () => ({ techApi: h }));
import { TechCertificationsScreen } from './TechCertificationsScreen';

const cert = (o: any) => ({ id: 'c1', technicianId: 't1', globalTechProfileId: null, name: 'State Nail License', issuer: 'NJ Board', issuedAt: null, expiresAt: '2099-01-01', hasDocument: false, verificationStatus: 'UNVERIFIED', verifiedAt: null, verifiedByUserId: null, revokedReason: null, daysToExpiry: 12, createdAt: '', updatedAt: '', ...o });
beforeEach(() => {
  Object.values(h).forEach((f) => f.mockReset());
  h.certifications.mockResolvedValue([cert({}), cert({ id: 'c2', name: 'Acrylic Pro', verificationStatus: 'VERIFIED', daysToExpiry: null, expiresAt: null })]);
  for (const k of ['addCertification', 'updateCertification', 'deleteCertification'] as const) h[k].mockResolvedValue({});
  h.uploadSkillDocument.mockResolvedValue({ url: 'u', key: 'skill-docs/k1.pdf' });
});
const mount = () => render(<TechNavProvider><TechCertificationsScreen /></TechNavProvider>);

describe('TechCertificationsScreen', () => {
  it('only an unverified certification can be edited or removed; expiry within 30 days is called out', async () => {
    mount();
    expect(await screen.findByText('Acrylic Pro')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1);
    expect(screen.getByText(/in 12 days/)).toBeInTheDocument();
  });
  it('adds one with an uploaded document key; a nameless save is refused', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Add a certification' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/name/);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Gel-X Certified' } });
    fireEvent.change(screen.getByLabelText('Document'), { target: { files: [new File(['%PDF'], 'c.pdf', { type: 'application/pdf' })] } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.addCertification).toHaveBeenCalledWith({ name: 'Gel-X Certified', issuer: null, issuedAt: null, expiresAt: null, documentKey: 'skill-docs/k1.pdf' }));
  });
  it('removes after the in-app confirm', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove' }));
    await waitFor(() => expect(h.deleteCertification).toHaveBeenCalledWith('c1'));
  });
});
