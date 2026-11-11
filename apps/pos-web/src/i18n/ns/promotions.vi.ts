// ns/promotions.vi.ts — Marketing → Promotions (Promotions Management guide, Oct 30 2026) (Tiếng Việt). Chỉ dành cho nhân viên
// quầy lễ tân POS. Khuyến mãi là cùng bản ghi với Mã giảm giá và Giảm giá; màn hình này không gửi tin, không thu tiền.
import type { PROMOTIONS_EN } from './promotions.en';
export const PROMOTIONS_VI: Record<keyof typeof PROMOTIONS_EN, string> = {
  'promo.checkPromotion': 'Kiểm tra khuyến mãi', 'promo.viewHistory': 'Xem lịch sử sử dụng', 'promo.assistant': 'Trợ lý khuyến mãi',
  'promo.kpi.value': 'Giá trị giảm đã dùng', 'promo.scope': 'Tìm trong',
  'promo.tab.library': 'Khuyến mãi', 'promo.tab.redemptions': 'Lịch sử sử dụng', 'promo.tab.checks': 'Lượt kiểm tra điều kiện', 'promo.tab.insights': 'Thống kê', 'promo.tab.health': 'Kiểm tra hệ thống',
  'promo.searchLib': 'Tìm tên, mã, ID, mô tả, dịch vụ khuyến mãi hoặc khách đã dùng…',
  'promo.searchRed': 'Tìm tên khách, số điện thoại, email, số phiếu, mã lịch hẹn, khuyến mãi, mã hoặc ID lượt dùng…',
  'promo.searchChecks': 'Tìm tên khách, số điện thoại, email, số phiếu, khuyến mãi hoặc ID lượt kiểm tra…',
  'promo.branch': 'Chi nhánh', 'promo.allBranches': 'Tất cả chi nhánh',
  'promo.verdict': 'Kết quả', 'promo.verdict.all': 'Mọi kết quả', 'promo.verdict.eligible': 'Đủ điều kiện', 'promo.verdict.not_eligible': 'Không đủ điều kiện',
  'promo.grain': 'Nhóm theo', 'promo.grain.day': 'Theo ngày', 'promo.grain.week': 'Theo tuần', 'promo.grain.month': 'Theo tháng',
  'promo.basis.redeemed': 'Ngày dùng hoàn tất', 'promo.basis.checked': 'Ngày kiểm tra',
  'promo.library': 'Danh sách khuyến mãi', 'promo.col.dates': 'Thời gian áp dụng', 'promo.now': 'Ngay bây giờ', 'promo.col.promotion': 'Khuyến mãi', 'promo.col.wouldTake': 'Sẽ giảm', 'promo.col.by': 'Người kiểm tra',
  'promo.noChecks': 'Chưa có lượt kiểm tra nào. Dùng Kiểm tra khuyến mãi để xem trước — việc kiểm tra không dùng khuyến mãi.', 'promo.noCustomer': 'Không có khách (lượt mẫu)',
  'promo.checksNote': 'Đây là các lần xem trước bằng Kiểm tra khuyến mãi. Kiểm tra không dùng, không giữ và không tính lượt khuyến mãi; lượt dùng hoàn tất nằm ở Lịch sử sử dụng.',
  'promo.checkSub': 'Cùng quy tắc với Thanh toán. Kiểm tra không dùng, không giữ khuyến mãi và không gửi gì — được ghi vào Lượt kiểm tra điều kiện.',
  'promo.checkLogged': 'Đã ghi vào Lượt kiểm tra điều kiện (chỉ xem trước — không áp dụng gì).', 'promo.chooseSub': 'Chọn khuyến mãi cần kiểm tra.',
  'promo.trend': 'Lượt dùng hoàn tất', 'promo.trendTotals': '{n} lượt · giảm ròng {v} · hoàn lại {r}', 'promo.top': 'Khuyến mãi dùng nhiều nhất', 'promo.byBranch': 'Theo chi nhánh',
  'promo.byService': 'Dịch vụ trên các phiếu đó', 'promo.associated': 'Doanh thu liên quan {v}',
  'promo.dtab.campaigns': 'Chiến dịch liên kết', 'promo.dtab.activity': 'Hoạt động',
  'promo.createdBy': 'Tạo bởi {who} · {at}', 'promo.fromAssistant': 'Nháp từ trợ lý bởi {who} · {at} (mục tiêu: {goal})', 'promo.noActivity': 'Chưa có thay đổi nào được ghi.', 'promo.system': 'Hệ thống',
  'promo.newTitle': 'Khuyến mãi mới', 'promo.saveActivate': 'Lưu và kích hoạt',
  'promo.created': '"{name}" đã được lưu nháp. Kích hoạt để dùng được khi thanh toán.',
  'promo.activated': '"{name}" đang hoạt động.', 'promo.scheduled': '"{name}" đã được lên lịch và dùng được từ lúc bắt đầu.',
  'promo.savedNotActivated': 'Đã lưu nháp và CHƯA hoạt động.',
  'promo.confirmTitle': 'Vui lòng xác nhận', 'promo.confirm.archive': 'Lưu trữ "{name}"? Khuyến mãi sẽ ẩn khỏi danh sách đang chạy; lượt dùng và báo cáo vẫn giữ nguyên.',
  'promo.confirm.cancel': 'Huỷ "{name}"? Không thể dùng khi thanh toán nữa; lượt dùng trước đây vẫn giữ.',
  'promo.flag.ok': 'Đã kiểm tra', 'promo.flag.warn': 'Cần xem lại', 'promo.flag.unknown': 'Chưa kiểm tra',
  'promo.flagKey.discount_size': 'Mức giảm', 'promo.flagKey.exposure': 'Tổng mức giảm có thể', 'promo.flagKey.conflicts': 'Khuyến mãi trùng', 'promo.flagKey.consent': 'Đồng ý nhận tiếp thị',
  'promo.flagKey.provider': 'Sẵn sàng nhắn tin', 'promo.flagKey.staffing': 'Nhân sự', 'promo.flagKey.service_cost': 'Chi phí dịch vụ',
  'promo.msgPreview': 'Xem trước tin nhắn (không lưu, không gửi)',
  'promo.pause.title': 'Tạm dừng “{name}”?', // DRAFT — Kevin reviews
  'promo.pause.where': 'Áp dụng tại', // DRAFT — Kevin reviews
  'promo.pause.allBranches': 'Mọi chi nhánh', // DRAFT — Kevin reviews
  'promo.pause.effect': 'Thanh toán sẽ ngừng nhận khuyến mãi này ngay khi bạn tạm dừng. Hóa đơn đã trả vẫn giữ giảm giá và lịch sử được giữ nguyên. Chọn Tiếp tục để bật lại.', // DRAFT — Kevin reviews
};
