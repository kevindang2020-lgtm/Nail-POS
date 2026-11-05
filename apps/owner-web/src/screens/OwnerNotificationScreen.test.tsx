import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const back = vi.hoisted(() => vi.fn());
vi.mock('../shell/nav', () => ({
  useOwnerNav: () => ({ back }),
}));

import { OwnerNotificationScreen } from './OwnerNotificationScreen';

describe('OwnerNotificationScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders header, back button, and notification sections', () => {
    render(<OwnerNotificationScreen />);
    expect(screen.getByText('Notifications')).toBeInTheDocument();
    expect(screen.getByText('Push Notifications')).toBeInTheDocument();
    expect(screen.getByText('Email Summaries')).toBeInTheDocument();
    expect(screen.getByText('In-App Sound Alerts')).toBeInTheDocument();
  });

  it('triggers back navigation on back button click', () => {
    render(<OwnerNotificationScreen />);
    const backBtn = screen.getByLabelText('Back');
    fireEvent.click(backBtn);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('filters notifications when category chips are clicked', () => {
    render(<OwnerNotificationScreen />);
    expect(screen.getByText('Payroll Approval Required')).toBeInTheDocument();

    const payrollChip = screen.getByText('payroll');
    fireEvent.click(payrollChip);
    expect(screen.getByText('Payroll Approval Required')).toBeInTheDocument();
  });

  it('marks all notifications as read when Mark all read is clicked', () => {
    render(<OwnerNotificationScreen />);
    const markReadBtn = screen.getByText(/Mark all read/);
    fireEvent.click(markReadBtn);
    expect(screen.queryByText('New')).not.toBeInTheDocument();
  });
});
