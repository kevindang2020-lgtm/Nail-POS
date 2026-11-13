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
  'promo.exp.title': 'Lịch hết hạn', // DRAFT — Kevin reviews
  'promo.exp.sub': 'Khuyến mãi kết thúc {from} – {to}', // DRAFT — Kevin reviews
  'promo.exp.window': 'Khoảng thời gian', // DRAFT — Kevin reviews
  'promo.exp.days': '{n} ngày tới', // DRAFT — Kevin reviews
  'promo.exp.none': 'Không có khuyến mãi nào kết thúc trong khoảng này.', // DRAFT — Kevin reviews
  'promo.exp.capped': 'Đang hiện {n} đầu tiên trong {total} — thu hẹp khoảng thời gian để xem phần còn lại.', // DRAFT — Kevin reviews
  'promo.sim.open': 'Mô phỏng xung đột', // DRAFT — Kevin reviews
  'promo.sim.title': 'Mô phỏng xung đột khi thanh toán', // DRAFT — Kevin reviews
  'promo.sim.sub': 'Vé thử chạy qua quy tắc tính giá và hoàn tiền thật', // DRAFT — Kevin reviews
  'promo.sim.readOnly': 'Chỉ là vé thử — không trừ tiền, không dùng ưu đãi, không hoàn tiền, không lưu gì, và không liên quan khách thật.', // DRAFT — Kevin reviews
  'promo.sim.none': 'Không có vé thử để hiển thị.', // DRAFT — Kevin reviews
  'promo.sim.summary': '{n} vé thử · {c} vé có xung đột', // DRAFT — Kevin reviews
  'promo.sim.col.case': 'Vé thử', // DRAFT — Kevin reviews
  'promo.sim.col.subtotal': 'Tạm tính', // DRAFT — Kevin reviews
  'promo.sim.col.discount': 'Giảm giá', // DRAFT — Kevin reviews
  'promo.sim.col.due': 'Phải trả', // DRAFT — Kevin reviews
  'promo.sim.col.tendered': 'Đã trả', // DRAFT — Kevin reviews
  'promo.sim.col.conflicts': 'Xung đột', // DRAFT — Kevin reviews
  'promo.sim.clean': 'Không', // DRAFT — Kevin reviews
  'promo.sim.offers': 'Ưu đãi:', // DRAFT — Kevin reviews
  'promo.sim.policy': 'Cộng dồn:', // DRAFT — Kevin reviews
  'promo.sim.tenders': 'Trả bằng:', // DRAFT — Kevin reviews
  'promo.sim.refund': 'Hoàn tiền:', // DRAFT — Kevin reviews
  'promo.sim.applied': 'Đã áp dụng:', // DRAFT — Kevin reviews
  'promo.sim.noConflicts': 'Không có xung đột — ưu đãi, thanh toán và hoàn tiền khớp nhau.', // DRAFT — Kevin reviews
  'promo.sim.floor': 'giá sàn {p}%', // DRAFT — Kevin reviews
  'promo.sim.mode.best_single': 'Một ưu đãi tốt nhất', // DRAFT — Kevin reviews
  'promo.sim.mode.stack_all': 'Cộng dồn mọi ưu đãi được phép', // DRAFT — Kevin reviews
  'promo.sim.mode.stack_groups': 'Cộng dồn giữa các nhóm', // DRAFT — Kevin reviews
  'promo.sim.mode.exclusive': 'Chỉ một ưu đãi độc quyền', // DRAFT — Kevin reviews
  'promo.sim.tender.card': 'Thẻ', // DRAFT — Kevin reviews
  'promo.sim.tender.cash': 'Tiền mặt', // DRAFT — Kevin reviews
  'promo.sim.tender.gift_card': 'Thẻ quà tặng', // DRAFT — Kevin reviews
  'promo.sim.refund.none': 'Không hoàn tiền', // DRAFT — Kevin reviews
  'promo.sim.refund.whole': 'Cả vé', // DRAFT — Kevin reviews
  'promo.sim.refund.lines': 'Dòng: {lines}', // DRAFT — Kevin reviews
  'promo.sim.code.offer_rejected': '{offer} không được áp dụng', // DRAFT — Kevin reviews
  'promo.sim.code.tenders_short': 'Thanh toán thiếu {cents} so với số phải trả', // DRAFT — Kevin reviews
  'promo.sim.code.tenders_over': 'Thanh toán dư {cents} so với số phải trả', // DRAFT — Kevin reviews
  'promo.sim.code.negative_tender': 'Số tiền thanh toán không hợp lệ ({cents})', // DRAFT — Kevin reviews
  'promo.sim.code.refund_reverses_offer': 'Hoàn tiền hủy {offer} ({cents})', // DRAFT — Kevin reviews
  'promo.sim.code.refund_partial_offer': 'Hoàn tiền hủy một phần {offer} ({cents})', // DRAFT — Kevin reviews
  'promo.sim.reason.not_best': 'ưu đãi khác tiết kiệm hơn', // DRAFT — Kevin reviews
  'promo.sim.reason.not_stackable': 'không cộng dồn được', // DRAFT — Kevin reviews
  'promo.sim.reason.same_stack_group': 'cùng nhóm với ưu đãi khác', // DRAFT — Kevin reviews
  'promo.sim.reason.not_with_membership': 'không dùng chung với giảm giá hội viên', // DRAFT — Kevin reviews
  'promo.sim.reason.not_with_loyalty': 'không dùng chung với phần thưởng tích điểm', // DRAFT — Kevin reviews
  'promo.sim.reason.price_floor': 'sẽ thấp hơn giá sàn', // DRAFT — Kevin reviews
  'promo.sim.reason.no_value': 'không tiết kiệm thêm', // DRAFT — Kevin reviews
  'promo.sim.reason.too_many': 'quá nhiều ưu đãi', // DRAFT — Kevin reviews
  'promo.sim.case.coupon_alone_card': 'Chỉ phiếu giảm giá, trả bằng thẻ', // DRAFT — Kevin reviews
  'promo.sim.case.coupon_vs_deal_best_single': 'Phiếu giảm giá so với ưu đãi (một tốt nhất)', // DRAFT — Kevin reviews
  'promo.sim.case.coupon_with_membership_blocked': 'Phiếu giảm giá + hội viên (không cho phép)', // DRAFT — Kevin reviews
  'promo.sim.case.coupon_with_membership_allowed': 'Phiếu giảm giá + hội viên (cho phép), tiền mặt', // DRAFT — Kevin reviews
  'promo.sim.case.coupon_with_loyalty_split_gift_card': 'Phiếu giảm giá + tích điểm, thẻ quà tặng + thẻ', // DRAFT — Kevin reviews
  'promo.sim.case.price_floor_caps_stack': 'Ưu đãi cộng dồn bị giới hạn bởi giá sàn', // DRAFT — Kevin reviews
  'promo.sim.case.split_tenders_short': 'Trả nhiều cách nhưng thiếu', // DRAFT — Kevin reviews
  'promo.sim.case.refund_one_line_partial': 'Hoàn một dịch vụ (một phần)', // DRAFT — Kevin reviews
  'promo.sim.case.refund_whole_ticket_reverses': 'Hoàn cả vé', // DRAFT — Kevin reviews
  'promo.healthDaily': 'Các kiểm tra này cũng tự chạy mỗi ngày một lần; các lần chạy theo lịch hiện trong lịch sử bên dưới.', // DRAFT — Kevin reviews
  'promo.ver.title': 'Điều khoản theo phiên bản', // DRAFT — Kevin reviews
  'promo.ver.rule': 'Mỗi phiên bản giữ đúng điều khoản khách đã nhận; phiên bản không bao giờ bị sửa. Mỗi lượt dùng được tính theo điều khoản có hiệu lực lúc đó.', // DRAFT — Kevin reviews
  'promo.ver.none': 'Không có phiên bản nào được lưu.', // DRAFT — Kevin reviews
  'promo.ver.used': '{n} lượt dùng · giảm {v} · {from} → {to}', // DRAFT — Kevin reviews
  'promo.ver.unused': 'Chưa dùng', // DRAFT — Kevin reviews
  'promo.ver.cap': 'giới hạn {n}', // DRAFT — Kevin reviews
  'promo.ver.ends': 'kết thúc {d}', // DRAFT — Kevin reviews
  'promo.ver.unversioned': '{n} lượt dùng cũ được thực hiện trước khi có lưu phiên bản.', // DRAFT — Kevin reviews
};
