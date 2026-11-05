// Face ID: the SDK's server-backed biometric device credential on native, WebAuthn on the web. No password is ever kept.
export {
  faceIdMode, enrollFaceId, signInWithFaceId, clearFaceId, disableFaceId, canEnrollFaceId, isFaceIdEnrolled, type FaceIdMode,
} from '@aipowersalon/mobile-sdk';
