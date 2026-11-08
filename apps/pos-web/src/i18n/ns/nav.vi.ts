// ns/nav.vi.ts — the POS "nav" namespace, Vietnamese. Typed against the English keys (a missing key is a type error; the
// check-i18n gate refuses an empty value or a lost {placeholder}). New strings are listed in docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md.
import type { NAV_EN } from './nav.en';
export const NAV_VI: Record<keyof typeof NAV_EN, string> = {
  'nav.language.menu': 'Ngôn ngữ: {current}',
  'nav.section.team': 'NHÂN VIÊN',
  'nav.language.saveFailed': 'Không lưu được ngôn ngữ của bạn. Đã chuyển lại {previous}.',
  // Nov 6 2026: the "Turn on notifications" banner (shell/POSLayout.tsx PosPushPrompt)
  'pos.pushPrompt.title': 'Bật thông báo',   // DRAFT — Kevin reviews
  'pos.pushPrompt.reason': 'Nhận thông báo tại quầy lễ tân khi khách check-in, khi phiếu sẵn sàng thanh toán và khi có thanh toán.',   // DRAFT — Kevin reviews
  'pos.pushPrompt.turnOn': 'Bật',   // DRAFT — Kevin reviews
  'pos.pushPrompt.notNow': 'Để sau',   // DRAFT — Kevin reviews
  'pos.pushPrompt.blocked': 'Thông báo đang bị chặn. Bạn có thể cho phép trong phần cài đặt của trình duyệt.',   // DRAFT — Kevin reviews
  'pos.pushPrompt.ok': 'Đã hiểu',   // DRAFT — Kevin reviews
  // Reception Copilot view tabs and pickers (moved out of the frozen catalog, Nov 7 2026 — keys unchanged)
  'pos.copilot_view': 'Chế độ xem Copilot',
  'pos.copilot_view_all': 'Tất cả',
  'pos.copilot_view_desk': 'Quầy lễ tân',
  'pos.copilot_view_actions': 'Thao tác',
  'pos.copilot_view_history': 'Lịch sử & tìm kiếm',
  'pos.copilot_view_settings': 'Cài đặt',
  'pos.copilot_pick_technician': 'Tên Thợ',
  'pos.copilot_pick_appointment': 'Tên khách, số điện thoại hoặc ngày',
};
