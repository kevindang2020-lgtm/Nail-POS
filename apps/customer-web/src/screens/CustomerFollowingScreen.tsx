// CustomerFollowingScreen.tsx — list of customers this profile follows (GET /customer/social/profile/:id/following).
// Reuses the shared FollowList from the followers screen.
import { FollowList } from './CustomerFollowersScreen';

export function CustomerFollowingScreen() {
  return <FollowList title="Following" kind="following" />;
}
