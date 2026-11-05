import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CardScanner } from './CardScanner';

const g = globalThis as any;

beforeEach(() => {
  g.requestAnimationFrame = (cb: any) => { setTimeout(() => cb(), 0); return 1; };
  g.cancelAnimationFrame = () => {};
  Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', { configurable: true, set() {}, get() { return null; } });
  (HTMLMediaElement.prototype as any).play = () => Promise.resolve();
});
afterEach(() => { vi.unstubAllGlobals(); delete g.BarcodeDetector; });

describe('CardScanner', () => {
  it('shows an error when the camera cannot start', async () => {
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => Promise.reject(new Error('denied')) } });
    render(<CardScanner onScan={() => {}} onClose={() => {}} />);
    expect(await screen.findByText(/Could not start the camera/)).toBeInTheDocument();
  });

  it('calls onScan with a decoded card number', async () => {
    const track = { stop: vi.fn() };
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => Promise.resolve({ getTracks: () => [track] }) } });
    g.BarcodeDetector = class { async detect() { return [{ rawValue: '4827 1936 5502 8411' }]; } };
    const onScan = vi.fn();
    render(<CardScanner onScan={onScan} onClose={() => {}} />);
    await waitFor(() => expect(onScan).toHaveBeenCalledWith('4827193655028411'));
  });

  it('closes when the close button is clicked', () => {
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => new Promise(() => {}) } });
    const onClose = vi.fn();
    render(<CardScanner onScan={() => {}} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close scanner'));
    expect(onClose).toHaveBeenCalled();
  });
});
