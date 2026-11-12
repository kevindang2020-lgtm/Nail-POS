// ns/nav.vi.ts — the POS "nav" namespace, Vietnamese. Typed against the English keys (a missing key is a type error; the
// check-i18n gate refuses an empty value or a lost {placeholder}). New strings are listed in docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md.
import type { NAV_EN } from './nav.en';
export const NAV_VI: Record<keyof typeof NAV_EN, string> = {
  'nav.language.menu': 'Ngôn ngữ: {current}',
  'nav.section.team': 'NHÂN VIÊN',
  'nav.language.saveFailed': 'Không lưu được ngôn ngữ của bạn. Đã chuyển lại {previous}.',
  // Nov 6 2026: the "Turn on notifications" banner (shell/POSLayout.tsx PosPushPrompt)
  'pos.pushPrompt.title': 'Bật thông báo',
  'pos.pushPrompt.reason': 'Nhận thông báo tại quầy lễ tân khi khách check-in, khi phiếu sẵn sàng thanh toán và khi có thanh toán.',
  'pos.pushPrompt.turnOn': 'Bật',
  'pos.pushPrompt.notNow': 'Để sau',
  'pos.pushPrompt.blocked': 'Thông báo đang bị chặn. Bạn có thể cho phép trong phần cài đặt của trình duyệt.',
  'pos.pushPrompt.ok': 'Đã hiểu',
  // Reception Copilot view tabs and pickers (moved out of the frozen catalog, Nov 7 2026 — keys unchanged)
  'pos.copilot_view': 'Chế độ xem Copilot',
  'pos.copilot_view_all': 'Tất cả',
  'pos.copilot_view_desk': 'Quầy lễ tân',
  'pos.copilot_view_actions': 'Thao tác',
  'pos.copilot_view_history': 'Lịch sử & tìm kiếm',
  'pos.copilot_view_settings': 'Cài đặt',
  'pos.copilot_pick_technician': 'Tên Thợ',
  'pos.copilot_pick_appointment': 'Tên khách, số điện thoại hoặc ngày',
  'nav.badgechk.open': 'Kiểm tra số trên huy hiệu', // DRAFT — Kevin reviews
  'nav.badgechk.title': 'Kiểm tra số trên huy hiệu', // DRAFT — Kevin reviews
  'nav.badgechk.sub': 'So sánh từng con số hiển thị trên menu và chuông với số đọc mới từ máy chủ. Không đánh dấu đã đọc hay thay đổi gì.', // DRAFT — Kevin reviews
  'nav.badgechk.failed': 'Không đọc được số liệu từ máy chủ.', // DRAFT — Kevin reviews
  'nav.badgechk.rerun': 'Kiểm tra lại', // DRAFT — Kevin reviews
  'nav.badgechk.recalc': 'Làm mới huy hiệu', // DRAFT — Kevin reviews
  'nav.badgechk.close': 'Đóng', // DRAFT — Kevin reviews
  'nav.badgechk.off': '{n} huy hiệu khác với máy chủ — bấm Làm mới huy hiệu.', // DRAFT — Kevin reviews
  'nav.badgechk.ok': 'Cả {n} huy hiệu khớp với máy chủ.', // DRAFT — Kevin reviews
  'nav.badgechk.col.badge': 'Huy hiệu', // DRAFT — Kevin reviews
  'nav.badgechk.col.shown': 'Đang hiển thị', // DRAFT — Kevin reviews
  'nav.badgechk.col.server': 'Máy chủ hiện tại', // DRAFT — Kevin reviews
  'nav.badgechk.col.result': 'Kết quả', // DRAFT — Kevin reviews
  'nav.badgechk.match': 'Khớp', // DRAFT — Kevin reviews
  'nav.badgechk.mismatch': 'Khác', // DRAFT — Kevin reviews
  'nav.badgechk.evidence': 'Đọc từ máy chủ lúc {when}. Khác biệt thường do menu chưa làm mới sau khi số thay đổi.', // DRAFT — Kevin reviews
  'nav.badgechk.asked': 'Đã yêu cầu menu đọc lại số liệu; bấm Kiểm tra lại để xác nhận.', // DRAFT — Kevin reviews
  'nav.badgechk.k.checkIn': 'Check-in', // DRAFT — Kevin reviews
  'nav.badgechk.k.techQueue': 'Hàng chờ thợ', // DRAFT — Kevin reviews
  'nav.badgechk.k.customerQueue': 'Hàng chờ khách', // DRAFT — Kevin reviews
  'nav.badgechk.k.serviceDone': 'Hoàn tất dịch vụ', // DRAFT — Kevin reviews
  'nav.badgechk.k.checkout': 'Thanh toán', // DRAFT — Kevin reviews
  'nav.badgechk.k.messages': 'Tin nhắn', // DRAFT — Kevin reviews
  'nav.badgechk.k.notifications': 'Thông báo (chuông)', // DRAFT — Kevin reviews
  'nav.badgechk.k.techReportsPending': 'Báo cáo của thợ chờ duyệt', // DRAFT — Kevin reviews
  'nav.badgechk.k.inventoryAlerts': 'Cảnh báo sắp hết hàng', // DRAFT — Kevin reviews
  'nav.badgechk.k.reviews': 'Đánh giá', // DRAFT — Kevin reviews
  'nav.badgechk.k.payrollPending': 'Bảng lương', // DRAFT — Kevin reviews
  'nav.badgechk.k.billingAlerts': 'Thanh toán gói dịch vụ', // DRAFT — Kevin reviews
  'nav.badgechk.k.aiUsageAlerts': 'Mức dùng AI', // DRAFT — Kevin reviews
  'nav.badgechk.k.supportTickets': 'Trợ giúp & Hỗ trợ', // DRAFT — Kevin reviews
  'nav.badgechk.k.setupHealthAlerts': 'Tình trạng cài đặt', // DRAFT — Kevin reviews
};
