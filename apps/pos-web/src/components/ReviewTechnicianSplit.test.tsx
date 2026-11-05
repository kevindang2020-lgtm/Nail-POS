import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
const technicianSplit = vi.fn();
vi.mock('../api/posCheckoutApi', () => ({ posCheckoutApi: { technicianSplit: (...a: any[]) => technicianSplit(...a) } }));
import { ReviewTechnicianSplit } from './ReviewTechnicianSplit';

const threeTechs = {
  participantCount: 3,
  technicians: [
    { technicianId: 'A', serviceEarningsCents: 7000, cardTipCents: 300, cashTipCents: 0 },
    { technicianId: 'B', serviceEarningsCents: 3000, cardTipCents: 300, cashTipCents: 0 },
    { technicianId: 'C', serviceEarningsCents: 5000, cardTipCents: 300, cashTipCents: 0 },
  ],
};

describe('ReviewTechnicianSplit', () => {
  beforeEach(() => technicianSplit.mockReset());

  it('shows the split when more than two technicians participate', async () => {
    technicianSplit.mockResolvedValue(threeTechs);
    render(<ReviewTechnicianSplit ticketId="TK1" nameFor={(id) => ({ A: 'Ann', B: 'Bea', C: 'Cy' } as any)[id]} />);
    expect(await screen.findByText(/3 technicians/)).toBeTruthy();
    expect(screen.getByText('Ann')).toBeTruthy();
    expect(screen.getByText(/\$70.00 earned/)).toBeTruthy();
  });

  it('renders nothing for two or fewer technicians', async () => {
    technicianSplit.mockResolvedValue({ participantCount: 2, technicians: [] });
    const { container } = render(<ReviewTechnicianSplit ticketId="TK1" />);
    await waitFor(() => expect(technicianSplit).toHaveBeenCalled());
    expect(container.querySelector('[aria-label="Review technician split"]')).toBeNull();
  });
});
