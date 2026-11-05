import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { AnimatedSplash } from './AnimatedSplash';

vi.mock('@capacitor/splash-screen', () => ({
  SplashScreen: {
    hide: vi.fn(async () => {}),
  },
}));

describe('AnimatedSplash component', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the logo initially with the splash overlay', () => {
    render(<AnimatedSplash />);
    const img = screen.getByAltText('AI PowerSalon');
    expect(img).toBeInTheDocument();
  });

  it('progresses through outro and unmounts after animation finishes', () => {
    const onFinish = vi.fn();
    render(<AnimatedSplash onFinish={onFinish} />);

    expect(screen.getByAltText('AI PowerSalon')).toBeInTheDocument();

    // Advance to 2000ms (outro stage)
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByAltText('AI PowerSalon')).toBeInTheDocument();

    // Advance to 2600ms (done stage)
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.queryByAltText('AI PowerSalon')).not.toBeInTheDocument();
    expect(onFinish).toHaveBeenCalledTimes(1);
  });
});
