// Face ID: the SDK's server-backed biometric device credential on native, WebAuthn on the web. No password is ever kept.
export {
  faceIdMode, enrollFaceId, signInWithFaceId, clearFaceId, disableFaceId, canEnrollFaceId, isFaceIdEnrolled, type FaceIdMode,
} from '@aipowersalon/mobile-sdk';
export { useFaceIdSignOutOption, END_FACE_ID_LABEL } from '@aipowersalon/mobile-sdk/faceid-signout';
