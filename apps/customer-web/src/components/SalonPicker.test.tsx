// SalonPicker.test.tsx — sign-up and Profile → My salon (Kevin, Oct 3 2026): choose a salon by search or "Use my
// location"; only AIPowerSalon salons are offered; sign-up sends the picked salon (or a code); My salon changes it —
// same salon at once, a different salon asks the customer to sign in again.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const salonsNearby = vi.fn(); const homeSalon = vi.fn(); const setHomeSalon = vi.fn(); const register = vi.fn();
vi.mock('../api/customerApi', () => ({ customerApi: { salonsNearby: (...a: any[]) => salonsNearby(...a), homeSalon: () => homeSalon(), setHomeSalon: (...a: any[]) => setHomeSalon(...a) } }));
vi.mock('../api/authApi', () => ({ authApi: { register: (...a: any[]) => register(...a) } }));
import { SalonPicker } from './SalonPicker';
import { MySalonCard } from './MySalonCard';
import { RegisterScreen } from '../screens/RegisterScreen';

const partner = (id: string, name: string, city: string, d: number | null = null) => ({ salon_id: id, source: 'aipowersalon', name, city, distance_miles: d, is_aipowersalon_partner: true, is_bookable_in_app: true });
const google = { salon_id: 'g1', source: 'google', name: 'Some Other Spa', city: 'Camden', distance_miles: 1, is_aipowersalon_partner: false, is_bookable_in_app: false };
beforeEach(() => { salonsNearby.mockReset(); homeSalon.mockReset(); setHomeSalon.mockReset(); register.mockReset(); });

describe('SalonPicker', () => {
  it('search shows only AIPowerSalon salons; a ZIP searches by ZIP; picking reports the salon', async () => {
    salonsNearby.mockResolvedValue({ results: [partner('b1', 'Polished', 'Cherry Hill'), google] });
    const onPick = vi.fn();
    render(<SalonPicker onPick={onPick} />);
    fireEvent.change(screen.getByLabelText('Search salons'), { target: { value: '08002' } });
    fireEvent.click(screen.getByText('Search'));
    expect(await screen.findByText('Polished')).toBeInTheDocument();
    expect(screen.queryByText('Some Other Spa')).toBeNull();
    expect(salonsNearby).toHaveBeenCalledWith({ zip: '08002' });
    fireEvent.click(screen.getByText('Polished'));
    expect(onPick).toHaveBeenCalledWith({ salonId: 'b1', name: 'Polished', city: 'Cherry Hill', distanceMiles: null });
  });
  it('"Use my location" searches around the device position and shows distances; a refusal says what to do', async () => {
    salonsNearby.mockResolvedValue({ results: [partner('b2', 'Luxe Nails', 'Haddonfield', 2.4)] });
    const geo: any = { getCurrentPosition: (ok: any) => ok({ coords: { latitude: 39.93, longitude: -75.03 } }) };
    render(<SalonPicker onPick={() => {}} geolocation={geo} />);
    fireEvent.click(screen.getByText('Use my location'));
    expect(await screen.findByText('Luxe Nails')).toBeInTheDocument();
    expect(screen.getByText('2.4 mi')).toBeInTheDocument();
    expect(salonsNearby).toHaveBeenCalledWith({ lat: 39.93, lng: -75.03, radiusMiles: 25 });
  });
  it('location not shared → a clear message, no search', async () => {
    const geo: any = { getCurrentPosition: (_ok: any, err: any) => err({ code: 1 }) };
    render(<SalonPicker onPick={() => {}} geolocation={geo} />);
    fireEvent.click(screen.getByText('Use my location'));
    expect(await screen.findByText(/Location was not shared/)).toBeInTheDocument();
    expect(salonsNearby).not.toHaveBeenCalled();
  });
});

describe('Sign-up — choosing a salon', () => {
  const fill = () => {
    fireEvent.change(screen.getByPlaceholderText('First name'), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByPlaceholderText('Last name'), { target: { value: 'Lee' } });
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'ana@example.test' } });
    fireEvent.change(screen.getByPlaceholderText('Password (8+ characters)'), { target: { value: 'longenough1' } });
  };
  const submit = () => fireEvent.click(screen.getAllByRole('button').find((b) => /create/i.test(b.textContent || ''))!);
  it('sends the picked salon as the default; without one it asks to choose', async () => {
    salonsNearby.mockResolvedValue({ results: [partner('b1', 'Polished', 'Cherry Hill')] });
    register.mockResolvedValue({ ok: true });
    const done = vi.fn();
    render(<RegisterScreen onBack={() => {}} onRegistered={done} />);
    fill(); submit();
    expect(await screen.findByText('Choose your salon.')).toBeInTheDocument();
    expect(register).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Search salons'), { target: { value: 'Polished' } });
    fireEvent.click(screen.getByText('Search'));
    fireEvent.click(await screen.findByText('Polished'));
    expect(screen.getByText(/Your default salon — you can change it later/)).toBeInTheDocument();
    submit();
    await waitFor(() => expect(register).toHaveBeenCalled());
    expect(register.mock.calls[0][0]).toMatchObject({ salonId: 'b1' });
    expect(register.mock.calls[0][0].salonCode).toBeUndefined();
    await waitFor(() => expect(done).toHaveBeenCalledWith('ana@example.test'));
  });
  it('"I have a salon code" sends the code instead', async () => {
    register.mockResolvedValue({ ok: true });
    render(<RegisterScreen onBack={() => {}} onRegistered={() => {}} />);
    fireEvent.click(screen.getByText('I have a salon code'));
    fireEvent.change(screen.getByLabelText('Salon code'), { target: { value: 'POLCS' } });
    fill(); submit();
    await waitFor(() => expect(register).toHaveBeenCalled());
    expect(register.mock.calls[0][0]).toMatchObject({ salonCode: 'POLCS' });
    expect(register.mock.calls[0][0].salonId).toBeUndefined();
  });
});

describe('Profile → My salon', () => {
  it('shows the current salon; another location of the same salon switches at once', async () => {
    homeSalon.mockResolvedValue({ salonId: 'b1', salonName: 'Polished Cherry Hill', city: 'Cherry Hill' });
    salonsNearby.mockResolvedValue({ results: [partner('b2', 'Polished Moorestown', 'Moorestown')] });
    setHomeSalon.mockResolvedValue({ ok: true, salonName: 'Polished Moorestown' });
    render(<MySalonCard onSignInAgain={() => {}} />);
    expect(await screen.findByText('Polished Cherry Hill · Cherry Hill')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Change'));
    fireEvent.change(screen.getByLabelText('Search salons'), { target: { value: 'Polished' } });
    fireEvent.click(screen.getByText('Search'));
    fireEvent.click(await screen.findByText('Polished Moorestown'));
    expect(await screen.findByText('Polished Moorestown is now your salon.')).toBeInTheDocument();
    expect(setHomeSalon).toHaveBeenCalledWith('b2');
  });
  it('a different salon asks the customer to sign in again', async () => {
    homeSalon.mockResolvedValue({ salonId: 'b1', salonName: 'Polished', city: null });
    salonsNearby.mockResolvedValue({ results: [partner('b9', 'Luxe Nails', 'Haddonfield')] });
    setHomeSalon.mockResolvedValue({ ok: true, salonName: 'Luxe Nails', requiresSignIn: true });
    const again = vi.fn();
    render(<MySalonCard onSignInAgain={again} />);
    await screen.findByText('Polished');
    fireEvent.click(screen.getByText('Change'));
    fireEvent.change(screen.getByLabelText('Search salons'), { target: { value: 'Luxe' } });
    fireEvent.click(screen.getByText('Search'));
    fireEvent.click(await screen.findByText('Luxe Nails'));
    await waitFor(() => expect(again).toHaveBeenCalledWith('Luxe Nails'));
  });
});
