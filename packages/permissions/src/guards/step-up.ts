// step-up.ts — Constitution 7 §8: mark a route as a critical action that needs RECENT strong authentication.
// Enforced by the API's global StepUpGuard (apps/api common/step-up.ts), which reads the session row's step-up stamp.
import { SetMetadata } from '@nestjs/common';
export const STEP_UP_META = 'stepUpMaxAgeSeconds';
export const STEP_UP_DEFAULT_SECONDS = 300;
export const RequireStepUp = (maxAgeSeconds: number = STEP_UP_DEFAULT_SECONDS) => SetMetadata(STEP_UP_META, maxAgeSeconds);
