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
  'nav.badgechk.k.alertsUnread': 'Cảnh báo chưa đọc (bạn)', // DRAFT — Kevin reviews
  'nav.alertreads.title': 'Cảnh báo chưa đọc', // DRAFT — Kevin reviews
  'nav.alertreads.failed': 'Không tải được cảnh báo của bạn.', // DRAFT — Kevin reviews
  'nav.alertreads.markAll': 'Đánh dấu đã đọc tất cả', // DRAFT — Kevin reviews
  'nav.alertreads.mark': 'Đánh dấu đã đọc', // DRAFT — Kevin reviews
  'nav.alertreads.read': 'Đã đọc', // DRAFT — Kevin reviews
  'nav.alertreads.none': 'Không có cảnh báo mở trong {days} ngày qua.', // DRAFT — Kevin reviews
  'nav.alertreads.lifecycle': 'Cảnh báo: {status}', // DRAFT — Kevin reviews
  'nav.alertreads.note': 'Đánh dấu đã đọc chỉ xóa số chưa đọc của bạn, trên mọi thiết bị bạn đang đăng nhập. Việc này không xác nhận hay khắc phục cảnh báo — cảnh báo vẫn mở cho đến khi có người xác nhận hoặc giải quyết.', // DRAFT — Kevin reviews
  'nav.alertreads.sev.info': 'Thông tin', // DRAFT — Kevin reviews
  'nav.alertreads.sev.warning': 'Cảnh báo', // DRAFT — Kevin reviews
  'nav.alertreads.sev.high': 'Cao', // DRAFT — Kevin reviews
  'nav.alertreads.sev.critical': 'Nghiêm trọng', // DRAFT — Kevin reviews
  'nav.alertreads.st.new': 'mới', // DRAFT — Kevin reviews
  'nav.alertreads.st.acknowledged': 'đã xác nhận', // DRAFT — Kevin reviews
  'nav.alertreads.st.in_progress': 'đang xử lý', // DRAFT — Kevin reviews
  'nav.alertreads.st.resolved': 'đã giải quyết', // DRAFT — Kevin reviews
  'nav.alertreads.st.dismissed': 'đã bỏ qua', // DRAFT — Kevin reviews
  'nav.alertreads.cat.loyalty': 'Mạng lưới điểm thưởng', // DRAFT — Kevin reviews
  'nav.alertreads.cat.ai_business_alert': 'Cảnh báo kinh doanh', // DRAFT — Kevin reviews
  'nav.alertreads.cat.messaging_failure': 'Tin nhắn', // DRAFT — Kevin reviews
  'nav.alertreads.cat.general': 'Chung', // DRAFT — Kevin reviews
  'nav.badgesync.title': 'Thiết bị của bạn', // DRAFT — Kevin reviews
  'nav.badgesync.failed': 'Không tải được danh sách thiết bị.', // DRAFT — Kevin reviews
  'nav.badgesync.some': '{n} trong {total} thiết bị đang đăng nhập có thể chưa hiện đúng số hiện tại.', // DRAFT — Kevin reviews
  'nav.badgesync.all': 'Cả {total} thiết bị đang đăng nhập đều hiện đúng số hiện tại.', // DRAFT — Kevin reviews
  'nav.badgesync.now': 'Cảnh báo chưa đọc hiện tại: {n}.', // DRAFT — Kevin reviews
  'nav.badgesync.none': 'Không có thiết bị nào khác đang đăng nhập.', // DRAFT — Kevin reviews
  'nav.badgesync.col.device': 'Thiết bị', // DRAFT — Kevin reviews
  'nav.badgesync.col.synced': 'Lần làm mới gần nhất', // DRAFT — Kevin reviews
  'nav.badgesync.col.showed': 'Đã hiện', // DRAFT — Kevin reviews
  'nav.badgesync.col.state': 'Trạng thái', // DRAFT — Kevin reviews
  'nav.badgesync.col.repair': 'Cách xử lý', // DRAFT — Kevin reviews
  'nav.badgesync.unnamed': 'Thiết bị chưa đặt tên', // DRAFT — Kevin reviews
  'nav.badgesync.thisDevice': 'Thiết bị này', // DRAFT — Kevin reviews
  'nav.badgesync.st.in_sync': 'Đã đồng bộ', // DRAFT — Kevin reviews
  'nav.badgesync.st.behind': 'Chậm', // DRAFT — Kevin reviews
  'nav.badgesync.st.stale': 'Lâu chưa dùng', // DRAFT — Kevin reviews
  'nav.badgesync.st.broken': 'Không làm mới', // DRAFT — Kevin reviews
  'nav.badgesync.st.never': 'Chưa từng báo', // DRAFT — Kevin reviews
  'nav.badgesync.fix.in_sync': 'Không cần làm gì.', // DRAFT — Kevin reviews
  'nav.badgesync.fix.behind': 'Thiết bị sẽ cập nhật ở lần làm mới tiếp theo (khoảng 30 giây), hoặc tải lại trang trên thiết bị đó.', // DRAFT — Kevin reviews
  'nav.badgesync.fix.stale': 'Bình thường với thiết bị không ai dùng; sẽ làm mới khi mở. Nếu không còn dùng, hãy đăng xuất thiết bị trong Tài khoản → Bảo mật.', // DRAFT — Kevin reviews
  'nav.badgesync.fix.broken': 'Thiết bị đang được dùng nhưng đã hơn {min} phút không làm mới số đếm: tải lại trang trên thiết bị; nếu vẫn không được, đăng xuất thiết bị trong Tài khoản → Bảo mật rồi đăng nhập lại.', // DRAFT — Kevin reviews
  'nav.badgesync.fix.never': 'Mở POS trên thiết bị đó một lần; nếu vẫn không báo, tải lại trang hoặc cập nhật ứng dụng.', // DRAFT — Kevin reviews
  'nav.badgesync.how': 'Thiết bị bị coi là lâu chưa dùng hoặc không làm mới sau {min} phút không làm mới số đếm. Chỉ có số đếm — không hiện nội dung cảnh báo ở đây.', // DRAFT — Kevin reviews
  'nav.alertreads.cat.deal_schedule': 'Ưu đãi & mã giảm giá', // DRAFT — Kevin reviews
};
