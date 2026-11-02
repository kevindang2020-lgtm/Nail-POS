// ns/comms.vi.ts — the POS "comms" namespace, Vietnamese. Typed against the English keys (a missing key is a type error; the
// check-i18n gate refuses an empty value or a lost {placeholder}). New strings go into docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md.
import type { COMMS_EN } from './comms.en';
export const COMMS_VI: Record<keyof typeof COMMS_EN, string> = {
  'comms.messaging.stepUpNeedsPassword': 'Thay đổi hoặc gỡ tài khoản nhắn tin cần mật khẩu của bạn',
};
