// TechnicianPicker.test.tsx — 200-technician mandate: the walk-in / new-booking picker pages on the server, searches on the
// server, sends the chosen services (hard eligibility first) and clears a choice the new services rule out.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TechnicianPicker } from './TechnicianPicker';

const tech = (n: number) => ({ technicianId: 't' + n, name: 'Tech ' + n, rosterNumber: n, avatarUrl: null, available: true, workingToday: true, skills: [], rating: null, reviewCount: 0 });
let urls: string[];
const page = (u: string) => {
  const p = new URL(u, 'http://x').searchParams; const pg = Number(p.get('page') || 1); const search = p.get('search');
  const all = Array.from({ length: 200 }, (_, i) => tech(i + 1)).filter((t) => !search || t.name.endsWith(' ' + search.replace('#', '')));
  const located = p.get('locate') ? (p.get('serviceIds') === 'svcHard' ? null : { technicianId: p.get('locate')!, page: 1, index: 0 }) : undefined;
  return { date: '2026-06-10', technicians: all.slice((pg - 1) * 12, pg * 12), total: all.length, totalAll: 200, workingCount: 200, page: pg, pageSize: 12, totalPages: Math.max(1, Math.ceil(all.length / 12)), ...(located !== undefined ? { located } : {}) };
};
beforeEach(() => {
  urls = [];
  globalThis.fetch = vi.fn(async (url: any) => { urls.push(String(url)); return { ok: true, status: 200, headers: { get: () => null }, json: async () => page(String(url)) } as any; }) as any;
});

describe('TechnicianPicker', () => {
  it('shows one page of 12 out of 200 and walks to page 2 on the server', async () => {
    render(<TechnicianPicker value="" onChange={() => {}} debounceMs={0} />);
    await screen.findByText('Tech 1');
    expect(screen.queryByText('Tech 13')).toBeNull();
    expect(screen.getAllByRole('option').length).toBe(12);
    expect(screen.getByText('Page 1 of 17')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    await screen.findByText('Tech 13');
    expect(urls.some((u) => u.includes('page=2') && u.includes('pageSize=12'))).toBe(true);
  });

  it('searches on the server and sends the chosen services + working filter', async () => {
    const onChange = vi.fn();
    render(<TechnicianPicker value="" onChange={onChange} serviceIds={['svcA', 'svcB']} date="2026-06-10" debounceMs={0} />);
    await screen.findByText('Tech 1');
    fireEvent.change(screen.getByLabelText('Find technician'), { target: { value: '#200' } });
    await screen.findByText('Tech 200');
    const last = urls[urls.length - 1];
    expect(last).toContain('search=%23200'); expect(last).toContain('serviceIds=svcA%2CsvcB'); expect(last).toContain('working=true'); expect(last).toContain('date=2026-06-10');
    fireEvent.click(screen.getByText('Tech 200'));
    expect(onChange).toHaveBeenCalledWith('t200', expect.objectContaining({ technicianId: 't200' }));
  });

  it('offers "First available" when asked and clears a choice the new services rule out', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<TechnicianPicker value="t5" onChange={onChange} anyLabel="First available" serviceIds={['svcEasy']} debounceMs={0} />);
    await screen.findByText('First available');
    rerender(<TechnicianPicker value="t5" onChange={onChange} anyLabel="First available" serviceIds={['svcHard']} debounceMs={0} />);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(''));
    expect(await screen.findByText(/cannot do these services/)).toBeInTheDocument();
  });
});
