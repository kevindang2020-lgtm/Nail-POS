// faceid-signout.ts — the sign-out choice for Face ID (Nov 5 2026; Kevin changed Constitution 6 §37).
//
// A normal sign-out KEEPS Face ID on the phone (the person signs back in with their face; the server still checks the
// credential every time, and migration 705 ends it whenever a session is revoked for any other reason). The sign-out
// confirmation offers "Also turn off Face ID on this phone" for a shared or borrowed phone — only when Face ID is on.
// The app passes `endFaceId` to its logout, which calls disableFaceId() (POST /auth/biometric/revoke) BEFORE the session ends.
import { useEffect, useState } from 'react';
import { isFaceIdEnrolled } from './faceid';

export const END_FACE_ID_LABEL = 'Also turn off Face ID on this phone';

/** `open`: the sign-out confirmation is showing. Resets the choice each time it opens. */
export function useFaceIdSignOutOption(open: boolean): { faceIdOn: boolean; endFaceId: boolean; setEndFaceId: (v: boolean) => void } {
  const [faceIdOn, setFaceIdOn] = useState(false);
  const [endFaceId, setEndFaceId] = useState(false);
  useEffect(() => {
    if (!open) return;
    setEndFaceId(false);
    let alive = true;
    void isFaceIdEnrolled().then((v) => { if (alive) setFaceIdOn(v); }).catch(() => { if (alive) setFaceIdOn(false); });
    return () => { alive = false; };
  }, [open]);
  return { faceIdOn, endFaceId, setEndFaceId };
}
