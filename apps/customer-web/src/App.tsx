import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { useState, useEffect } from 'react';
import { LoginScreen } from './screens/LoginScreen';
import { enterGuestMode, exitGuestMode, isGuest } from './auth/guest';
import { CustomerLayout } from './shell/CustomerLayout';
import { HomeScreen } from './screens/HomeScreen';
import { VisitScreen } from './screens/VisitScreen';
import { BookScreen } from './screens/BookScreen';
import { AppointmentsScreen } from './screens/AppointmentsScreen';
import { FindSalonsScreen } from './screens/FindSalonsScreen';
import { FindTechsScreen } from './screens/FindTechsScreen';
import SalonTechsScreen from './screens/SalonTechsScreen';
import { CustomerTechProfileScreen } from './screens/CustomerTechProfileScreen';
import { RateTechScreen } from './screens/RateTechScreen';
import { AppointmentDetailsScreen } from './screens/AppointmentDetailsScreen';
import { ReceiptsScreen } from './screens/ReceiptsScreen';
import { CustomerInvoicesScreen } from './screens/CustomerInvoicesScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { MyPhotoConsentScreen } from './screens/MyPhotoConsentScreen';
import { EditProfileScreen } from './screens/EditProfileScreen';
import { ProfileSecurityScreen } from './screens/ProfileSecurityScreen';
import { LiveQueueScreen } from './screens/LiveQueueScreen';
import { NotificationsScreen } from './screens/NotificationsScreen';
import { AddressesScreen } from './screens/AddressesScreen';
import { DealsScreen } from './screens/DealsScreen';
import { MembershipScreen } from './screens/MembershipScreen';
import { AIReceptionistScreen } from './screens/AIReceptionistScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { HelpScreen } from './screens/HelpScreen';
import { PrivacyPolicyScreen } from './screens/PrivacyPolicyScreen';
import { TermsScreen } from './screens/TermsScreen';
import { DeleteAccountScreen } from './screens/DeleteAccountScreen';
import { PaymentMethodsScreen } from './screens/PaymentMethodsScreen';
import { CheckInScreen } from './screens/CheckInScreen';
import { RescheduleScreen } from './screens/RescheduleScreen';
import { TransactionHistoryScreen } from './screens/TransactionHistoryScreen';
import { RewardsScreen } from './screens/RewardsScreen';
import { WalletScreen } from './screens/WalletScreen';
import { GiftCardsScreen } from './screens/GiftCardsScreen';
import { ClaimGiftCardScreen } from './screens/ClaimGiftCardScreen';
import { PayScreen } from './screens/PayScreen';
import { NailShowcaseFeedScreen } from './screens/NailShowcaseFeedScreen';
import { NailShowcaseCreatePostScreen } from './screens/NailShowcaseCreatePostScreen';
import { NailShowcasePostDetailScreen } from './screens/NailShowcasePostDetailScreen';
import { CustomerTechChatScreen } from './screens/CustomerTechChatScreen';
import { NailShowcaseShareFromTicketScreen } from './screens/NailShowcaseShareFromTicketScreen';
import { CustomerFollowUpsScreen } from './screens/CustomerFollowUpsScreen';
import { CustomerFollowUpDetailScreen } from './screens/CustomerFollowUpDetailScreen';
import { NailShowcaseLeaderboardScreen } from './screens/NailShowcaseLeaderboardScreen';
import { CustomerSocialProfileScreen } from './screens/CustomerSocialProfileScreen';
import { CustomerEditSocialProfileScreen } from './screens/CustomerEditSocialProfileScreen';
import { CustomerFollowersScreen } from './screens/CustomerFollowersScreen';
import { CustomerFollowingScreen } from './screens/CustomerFollowingScreen';
import { NailShowcaseFollowingFeedScreen } from './screens/NailShowcaseFollowingFeedScreen';

function Gate() {
  const { principal, loading } = useAuth();
  const [, setGuestRev] = useState(0);

  useEffect(() => {
    const onGuestChange = () => setGuestRev((r) => r + 1);
    window.addEventListener('aps:guest_change', onGuestChange);
    return () => window.removeEventListener('aps:guest_change', onGuestChange);
  }, []);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fdfefb' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 36, height: 36, border: '3px solid rgba(169, 111, 34, 0.2)', borderTopColor: '#A96F22', borderRadius: '50%', animation: 'custSpin 0.8s linear infinite', margin: '0 auto 16px' }} />
        </div>
        <style>{`@keyframes custSpin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }
  // "Continue as Guest" — browsing only. No session, no token, no principal: there is nothing to escalate.
  if (!principal && !isGuest()) {
    const claimNotice = typeof window !== 'undefined' && window.location.pathname.startsWith('/gift-cards/claim')
      ? 'You\u2019ve been sent a gift card! Sign in or create your free account to claim it.'
      : undefined;
    return <LoginScreen onGuest={() => enterGuestMode()} notice={claimNotice} />;
  }
  // A guest who signs in leaves guest mode behind.
  if (principal && isGuest()) exitGuestMode();
  return (
    <CustomerLayout>
      <Routes>
        <Route path="/" element={<HomeScreen />} />
        <Route path="/visit" element={<VisitScreen />} />
        <Route path="/appointments" element={<AppointmentsScreen />} />
        <Route path="/find-salons" element={<FindSalonsScreen />} />
        <Route path="/find-techs" element={<FindTechsScreen />} />
        <Route path="/salons/:salonId/techs" element={<SalonTechsScreen />} />
        <Route path="/techs/:slug" element={<CustomerTechProfileScreen />} />
        <Route path="/rate-tech/:ticketId/:technicianId" element={<RateTechScreen />} />
        <Route path="/appointments/:appointmentId" element={<AppointmentDetailsScreen />} />
        <Route path="/queue" element={<LiveQueueScreen />} />
        <Route path="/notifications" element={<NotificationsScreen />} />
        <Route path="/deals" element={<DealsScreen />} />
        <Route path="/membership" element={<MembershipScreen />} />
        <Route path="/profile/addresses" element={<AddressesScreen />} />
        <Route path="/profile/settings" element={<SettingsScreen />} />
        {/* Password + active-session management. All six /customer/me/security/* endpoints are live; the screen was
            built but never routed, so a customer who activated with an SMS one-time code had NO way to set a password
            or sign out another device. */}
        <Route path="/profile/security" element={<ProfileSecurityScreen />} />
        <Route path="/profile/help" element={<HelpScreen />} />
        <Route path="/legal/privacy" element={<PrivacyPolicyScreen />} />
        <Route path="/legal/terms" element={<TermsScreen />} />
        <Route path="/profile/delete-account" element={<DeleteAccountScreen />} />
        <Route path="/profile/payment-methods" element={<PaymentMethodsScreen />} />
        <Route path="/check-in" element={<CheckInScreen />} />
        <Route path="/appointments/:id/reschedule" element={<RescheduleScreen />} />
        <Route path="/transactions" element={<TransactionHistoryScreen />} />
        <Route path="/book" element={<BookScreen />} />
        <Route path="/assistant" element={<AIReceptionistScreen />} />
        <Route path="/nail-showcase" element={<NailShowcaseFeedScreen />} />
        <Route path="/nail-showcase/create" element={<NailShowcaseCreatePostScreen />} />
        <Route path="/nail-showcase/share/:ticketId" element={<NailShowcaseShareFromTicketScreen />} />
        <Route path="/nail-showcase/leaderboard" element={<NailShowcaseLeaderboardScreen />} />
        <Route path="/nail-showcase/:postId" element={<NailShowcasePostDetailScreen />} />
        <Route path="/social/me" element={<CustomerSocialProfileScreen />} />
        <Route path="/social/edit" element={<CustomerEditSocialProfileScreen />} />
        <Route path="/social/following-feed" element={<NailShowcaseFollowingFeedScreen />} />
        <Route path="/social/profile/:customerId" element={<CustomerSocialProfileScreen />} />
        <Route path="/social/profile/:customerId/followers" element={<CustomerFollowersScreen />} />
        <Route path="/social/profile/:customerId/following" element={<CustomerFollowingScreen />} />
        <Route path="/receipts" element={<ReceiptsScreen />} />
        <Route path="/invoices" element={<CustomerInvoicesScreen />} />
        <Route path="/follow-ups" element={<CustomerFollowUpsScreen />} />
        <Route path="/follow-ups/:id" element={<CustomerFollowUpDetailScreen />} />
        <Route path="/rewards" element={<RewardsScreen />} />
        <Route path="/wallet" element={<WalletScreen />} />
        <Route path="/gift-cards" element={<GiftCardsScreen />} />
        <Route path="/gift-cards/claim" element={<ClaimGiftCardScreen />} />
        <Route path="/pay" element={<PayScreen />} />
        <Route path="/profile" element={<ProfileScreen />} />
        <Route path="/profile/my-photos" element={<MyPhotoConsentScreen />} />
        <Route path="/profile/edit" element={<EditProfileScreen />} />
        <Route path="/messages/:threadId" element={<CustomerTechChatScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </CustomerLayout>
  );
}

import { AnimatedSplash } from './components/AnimatedSplash';

export function App() {
  return (
    <AuthProvider>
      <AnimatedSplash />
      <Gate />
    </AuthProvider>
  );
}
