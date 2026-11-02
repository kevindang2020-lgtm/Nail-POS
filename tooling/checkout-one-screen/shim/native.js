// Native / optional-package stand-ins for the one-screen harness ONLY (Capacitor plugins, TanStack Query used by the
// mobile apps' SDK paths that the POS never runs). Never shipped.
const chain = new Proxy(function () {}, { get: (_t, k) => (k === 'then' ? undefined : chain), apply: () => chain, construct: () => chain });
export default chain;
export const Capacitor = { isNativePlatform: () => false, getPlatform: () => 'web', isPluginAvailable: () => false };
export const registerPlugin = () => chain;
export const SecureStoragePlugin = chain, NativeBiometric = chain;
export class QueryClient { constructor() {} getQueryCache() { return { subscribe: () => () => {}, getAll: () => [] }; } }
export const QueryClientProvider = ({ children }) => children;
export const useQuery = () => ({ data: undefined, isLoading: false, error: null });
export const keepPreviousData = (x) => x, dehydrate = () => ({}), hydrate = () => {};
export const App = chain, PushNotifications = chain, SplashScreen = chain;   // owner / customer apps (Oct 30 2026 rewards harness)
