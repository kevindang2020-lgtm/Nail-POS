// The ONE native session store (@aipowersalon/mobile-sdk). Same Keychain key as before, so a signed-in phone stays signed in.
export {
  InMemorySecureStore, setSecureStore, saveNativeToken, loadNativeToken, clearNativeToken, authHeader, tokenFromResponse,
  type SecureStore,
} from '@aipowersalon/mobile-sdk';
