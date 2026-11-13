// ns/phonemgmt.vi.ts — Khách hàng → Quản lý số điện thoại (Phone Number Management Complete Build Guide) (Tiếng Việt).
// Chỉ cho màn hình Front Desk POS của nhân viên.
export const PHONEMGMT_VI = {
  "phm.title": "Quản lý số điện thoại",
  "phm.sub": "Số đã xác minh · Thay đổi đang chờ · Lịch sử bảo mật",
  "phm.updated": "cập nhật {time}",
  "phm.refresh": "Làm mới",
  "phm.updatePhone": "Đổi số điện thoại",
  "phm.checkHealth": "Kiểm tra xác minh",
  "phm.noPermission": "Bạn không có quyền xem quản lý số điện thoại.",
  "phm.kpi.verified": "Số đã xác minh",
  "phm.kpi.pending": "Đang chờ xác minh",
  "phm.kpi.failed": "Thay đổi thất bại (30 ngày)",
  "phm.kpi.today": "Thay đổi hôm nay",
  "phm.kpi.shared": "Số dùng chung",
  "phm.kpi.smsHealth": "Tình trạng SMS",
  "phm.settings": "Cài đặt số điện thoại",
  "phm.healthTitle": "Tình trạng xác minh & đồng bộ",
  "phm.health.sender": "Gửi mã",
  "phm.health.failures": "Yêu cầu mã thất bại",
  "phm.health.expired": "Yêu cầu hết hạn",
  "phm.health.sync": "Đồng bộ hồ sơ",
  "phm.health.policy": "Chính sách ngoại lệ của quản lý",
  "phm.health.limits": "Mã: {digits} số · hiệu lực {minutes} phút · {attempts} lần thử · gửi lại sau {cooldown} giây",
  "phm.state.ready": "Sẵn sàng",
  "phm.state.unchecked": "Chưa kiểm tra",
  "phm.state.attention_required": "Cần xử lý",
  "phm.state.not_configured": "Chưa thiết lập",
  "phm.state.pending": "Đang chờ",
  "phm.state.unknown": "Không rõ",
  "phm.tab.pending": "Đang chờ & Khôi phục",
  "phm.tab.history": "Lịch sử đổi số",
  "phm.tab.sync": "Theo dõi đồng bộ",
  "phm.search": "Tìm tên, số điện thoại, email, mã khách hoặc mã yêu cầu…",
  "phm.f.status": "Trạng thái",
  "phm.f.source": "Nguồn",
  "phm.f.method": "Xác minh",
  "phm.f.shared": "Số dùng chung",
  "phm.f.sync": "Đồng bộ",
  "phm.f.all": "Tất cả",
  "phm.f.clear": "Xóa bộ lọc",
  "phm.f.yes": "Chỉ số dùng chung",
  "phm.basis.requested": "Thời điểm yêu cầu",
  "phm.basis.verified": "Thời điểm xác minh",
  "phm.basis.applied": "Thời điểm áp dụng",
  "phm.basis.failed": "Thời điểm thất bại",
  "phm.basis.audit": "Thời điểm sự kiện",
  "phm.st.pending": "Đang chờ",
  "phm.st.code_sent": "Đã gửi mã",
  "phm.st.retry_allowed": "Có thể thử lại",
  "phm.st.expired": "Hết hạn",
  "phm.st.failed": "Thất bại",
  "phm.st.manager_review": "Chờ quản lý duyệt",
  "phm.st.cancelled": "Đã hủy",
  "phm.st.completed": "Hoàn tất",
  "phm.st.sync_attention": "Cần xử lý đồng bộ",
  "phm.src.staff_pos": "Quầy lễ tân",
  "phm.src.customer_app": "Ứng dụng khách",
  "phm.src.kiosk": "Kiosk",
  "phm.src.ai_receptionist": "Lễ tân AI",
  "phm.src.import": "Nhập dữ liệu",
  "phm.m.sms": "Đã xác minh SMS",
  "phm.m.manual": "Ngoại lệ thủ công",
  "phm.m.sms_verified": "Đã xác minh SMS",
  "phm.m.manual_exception": "Ngoại lệ thủ công — chưa xác minh SMS",
  "phm.sync.not_needed": "Không cần",
  "phm.sync.pending": "Đang chờ",
  "phm.sync.in_progress": "Đang chạy",
  "phm.sync.synced": "Đã đồng bộ",
  "phm.sync.retry_scheduled": "Đã hẹn thử lại",
  "phm.sync.failed": "Thất bại",
  "phm.sync.unknown": "Không rõ",
  "phm.sync.attention": "Cần xử lý",
  "phm.col.customer": "Khách hàng",
  "phm.col.numbers": "Số cũ / mới",
  "phm.col.source": "Nguồn",
  "phm.col.requestedBy": "Người yêu cầu",
  "phm.col.date": "Ngày",
  "phm.col.expires": "Hết hạn",
  "phm.col.age": "Đã chờ",
  "phm.col.status": "Trạng thái",
  "phm.col.attempts": "Lần thử",
  "phm.col.sync": "Đồng bộ",
  "phm.col.lastError": "Lỗi gần nhất",
  "phm.col.next": "Lần thử tới",
  "phm.col.actions": "Thao tác",
  "phm.open": "Mở",
  "phm.minutes": "{n} phút",
  "phm.hours": "{n} giờ",
  "phm.days": "{n} ngày",
  "phm.emptyPending": "Không có gì đang chờ. Mọi thay đổi đã xong, đã hủy hoặc hết hạn.",
  "phm.emptyHistory": "Không có thay đổi số nào khớp bộ lọc.",
  "phm.emptySync": "Mọi thay đổi đã xác minh đều đã đồng bộ.",
  "phm.loadError": "Không tải được quản lý số điện thoại.",
  "phm.retry": "Thử lại",
  "phm.pageSize": "Số dòng",
  "phm.order.history": "Mới nhất trước",
  "phm.order.pending": "Sắp hết hạn trước",
  "phm.ov.title": "Đổi số — {name}",
  "phm.ov.keepActive": "Số đã xác minh hiện tại vẫn được dùng cho đến khi số mới được xác minh.",
  "phm.ov.current": "Số hiện tại (tin cậy)",
  "phm.ov.proposed": "Số mới đề xuất",
  "phm.ov.proof.sms_verified": "Đã xác minh SMS",
  "phm.ov.proof.manual_exception": "Ngoại lệ thủ công — chưa xác minh SMS",
  "phm.ov.proof.unverified": "Chưa xác minh",
  "phm.ov.proof.unknown": "Không rõ",
  "phm.ov.stage": "Bước xác minh",
  "phm.ov.attempts": "Còn {left}/{max} lần thử",
  "phm.ov.resendIn": "Có thể gửi lại sau {s} giây",
  "phm.ov.codeExpires": "Mã có hiệu lực đến {time}",
  "phm.ov.sender": "Người gửi",
  "phm.ov.notice": "Thông báo tới số cũ",
  "phm.ov.notice.off_by_policy": "Tắt theo chính sách tiệm",
  "phm.ov.notice.not_due": "Chỉ gửi sau khi đổi số",
  "phm.ov.notice.not_recorded": "Không có ghi nhận",
  "phm.ov.notice.submitted": "Đã gửi — chưa xác nhận đã nhận",
  "phm.ov.notice.delivered": "Đã nhận",
  "phm.ov.notice.failed": "Thất bại",
  "phm.ov.history": "Các lần đổi số gần đây",
  "phm.ov.source": "Nguồn",
  "phm.ov.requested": "Yêu cầu lúc {time} bởi {who}",
  "phm.ov.reenter": "Nhập lại số mới để gửi hoặc kiểm tra mã",
  "phm.ov.newNumber": "Số điện thoại mới",
  "phm.ov.code": "Mã 6 số",
  "phm.ov.sendCode": "Gửi mã",
  "phm.ov.resendCode": "Gửi lại mã",
  "phm.ov.verify": "Xác minh mã",
  "phm.ov.cancel": "Hủy yêu cầu",
  "phm.ov.cancelConfirm": "Hủy thay đổi này? Số hiện tại giữ nguyên.",
  "phm.ov.approve": "Duyệt (quản lý)",
  "phm.ov.retrySync": "Đồng bộ lại",
  "phm.ov.manual": "Xác nhận không qua SMS (ngoại lệ)",
  "phm.ov.manualReason": "Lý do (ít nhất 12 ký tự, được ghi nhật ký)",
  "phm.ov.manualWarn": "Đánh giá của quản lý không phải là SMS. Số này sẽ hiện là ngoại lệ thủ công, không bao giờ là đã xác minh.",
  "phm.ov.startNew": "Bắt đầu thay đổi mới",
  "phm.ov.close": "Đóng",
  "phm.ov.done": "Xong",
  "phm.ov.noSender": "Chưa thiết lập gửi tin nhắn nên không gửi được mã. Không có gì thay đổi cho đến khi mã được xác minh.",
  "phm.ov.dupConflict": "Số này đang thuộc khách khác. Quản lý phải quyết định trước khi gửi mã — không gộp hồ sơ.",
  "phm.up.title": "Đổi số điện thoại khách",
  "phm.up.find": "Tìm khách theo tên, số điện thoại, email hoặc mã",
  "phm.up.pick": "Chọn",
  "phm.up.open": "Đang có thay đổi — mở",
  "phm.up.shared": "dùng chung số với {n} người",
  "phm.up.newNumber": "Số điện thoại mới",
  "phm.up.reason": "Lý do (không bắt buộc)",
  "phm.up.family": "Đây là số dùng chung trong gia đình (giữ hồ sơ riêng)",
  "phm.up.review": "Xem lại",
  "phm.up.confirm": "Lưu ở trạng thái chờ",
  "phm.up.reviewText": "{name}: {old} → {new}. Số hiện tại vẫn dùng đến khi số mới được xác minh.",
  "phm.up.back": "Quay lại",
  "phm.up.none": "Không có khách nào khớp.",
  "phm.pol.on": "Bật", // DRAFT — Kevin reviews
  "phm.pol.off": "Tắt", // DRAFT — Kevin reviews
  "phm.pol.tag.branchDiffers": "Đặt riêng cho chi nhánh này (toàn tiệm: {v})", // DRAFT — Kevin reviews
  "phm.pol.tag.branchSame": "Đặt riêng cho chi nhánh này (giống toàn tiệm)", // DRAFT — Kevin reviews
  "phm.pol.tag.inherited": "Theo chính sách toàn tiệm", // DRAFT — Kevin reviews
  "phm.pol.tag.salonDiffers": "Tiệm tự chọn (mặc định nền tảng: {v})", // DRAFT — Kevin reviews
  "phm.pol.tag.salonSame": "Tiệm tự chọn (giống mặc định nền tảng)", // DRAFT — Kevin reviews
  "phm.pol.tag.default": "Mặc định nền tảng (chưa từng lưu)", // DRAFT — Kevin reviews
  "phm.pol.source.branch_override": "Chi nhánh này có chính sách riêng đã lưu; các giá trị dưới đây là của chi nhánh.", // DRAFT — Kevin reviews
  "phm.pol.source.salon_policy": "Các giá trị này lấy từ chính sách toàn tiệm.", // DRAFT — Kevin reviews
  "phm.pol.source.platform_default": "Chưa lưu chính sách nào, nên áp dụng mặc định của nền tảng.", // DRAFT — Kevin reviews
  "phm.pol.sa.none": "Không có thiết lập nào của Super Admin ghi đè các mục này. Xem không làm thay đổi gì.", // DRAFT — Kevin reviews
  "phm.pol.sa.yes": "Có thiết lập của Super Admin ghi đè các mục này.", // DRAFT — Kevin reviews
  "phm.dup.titleBlocked": "Số này đã có trên hồ sơ của khách khác", // DRAFT — Kevin reviews
  "phm.dup.titleShared": "Đã ghi nhận là số điện thoại dùng chung trong gia đình", // DRAFT — Kevin reviews
  "phm.dup.separate": "Mỗi hồ sơ vẫn riêng biệt: dùng chung số không bao giờ gộp khách, lượt ghé, ghi chú, điểm thưởng hay thẻ quà tặng của họ.", // DRAFT — Kevin reviews
  "phm.dup.manager": "Nhiều khách đã dùng số này, nên quản lý phải xem lại. Chưa có gì thay đổi.", // DRAFT — Kevin reviews
  "phm.dup.samePerson": "Hồ sơ kia có tên rất giống và có thể là cùng một người bị ghi hai lần. Chưa có gì bị thay đổi hay gộp.", // DRAFT — Kevin reviews
  "phm.dup.blocked": "Chưa có gì thay đổi. Nếu đây là người nhà dùng chung một điện thoại, hãy ghi nhận là số dùng chung trong gia đình.", // DRAFT — Kevin reviews
  "phm.dup.other": "Dùng số khác", // DRAFT — Kevin reviews
  "phm.dup.family": "Đây là số dùng chung trong gia đình, tiếp tục", // DRAFT — Kevin reviews
  "phm.dup.continue": "Tiếp tục", // DRAFT — Kevin reviews
  "phm.risk.title": "Thay đổi số cần xem lại", // DRAFT — Kevin reviews
  "phm.risk.sub": "Các lần đổi số điện thoại bất thường trong {d} ngày qua. Để người có thẩm quyền xem lại: ở đây không khóa khách hay đổi số nào.", // DRAFT — Kevin reviews
  "phm.risk.r.frequent_changes": "Đổi số nhiều lần", // DRAFT — Kevin reviews
  "phm.risk.r.failed_codes": "Nhập mã sai nhiều lần", // DRAFT — Kevin reviews
  "phm.risk.r.cross_device": "Nhiều thiết bị hoặc kênh", // DRAFT — Kevin reviews
  "phm.risk.facts": "{c} yêu cầu, {f} lỗi hoặc hết hạn, {a} lần nhập mã, {ch} kênh", // DRAFT — Kevin reviews
  "phm.risk.review": "Xem yêu cầu mới nhất", // DRAFT — Kevin reviews
  "phm.tl.title": "Dòng thời gian kiểm tra thay đổi", // DRAFT — Kevin reviews
  "phm.tl.requested": "Đã yêu cầu", // DRAFT — Kevin reviews
  "phm.tl.sms_sent": "Đã gửi SMS", // DRAFT — Kevin reviews
  "phm.tl.verified": "Đã xác minh", // DRAFT — Kevin reviews
  "phm.tl.applied": "Đã áp dụng", // DRAFT — Kevin reviews
  "phm.tl.synced": "Đã đồng bộ", // DRAFT — Kevin reviews
  "phm.tl.security_notice": "Thông báo bảo mật", // DRAFT — Kevin reviews
  "phm.tl.notReached": "chưa tới bước này", // DRAFT — Kevin reviews
  "phm.tl.unverified": "chưa được xác nhận", // DRAFT — Kevin reviews
  "phm.tl.ref": "mã nhà cung cấp {r}", // DRAFT — Kevin reviews
  "phm.rp.preview": "Xem trước đồng bộ lại", // DRAFT — Kevin reviews
  "phm.rp.title": "Thử đồng bộ lại sẽ làm gì", // DRAFT — Kevin reviews
  "phm.rp.would": "Đồng bộ MỘT thay đổi này ({p}) vào hồ sơ khách, đánh dấu đã đồng bộ và ghi lại người thực hiện. Không thay đổi nào khác bị ảnh hưởng.", // DRAFT — Kevin reviews
  "phm.rp.refused.PHONE_SYNC_NOTHING_LEFT": "Không có gì để đồng bộ lại: thay đổi này không chờ đồng bộ.", // DRAFT — Kevin reviews
  "phm.rp.refused.PERMISSION_DENIED": "Bạn không có quyền đồng bộ lại.", // DRAFT — Kevin reviews
  "phm.rp.refused.PHONE_SYNC_IN_PROGRESS": "Đang có một lần đồng bộ cho thay đổi này.", // DRAFT — Kevin reviews
  "phm.rp.refused.other": "Không thể đồng bộ lại thay đổi này lúc này.", // DRAFT — Kevin reviews
  "phm.rp.facts": "Số lần tự động đã thử: {a} trên {m}", // DRAFT — Kevin reviews
  "phm.rp.safe": "Chưa có gì bị thay đổi. Đồng bộ lại cùng một thay đổi lần thứ hai sẽ không làm gì.", // DRAFT — Kevin reviews
  "phm.up.restored": "Thay đổi chưa lưu của khách này đã được khôi phục. Hãy nhập lại số mới — số điện thoại và mã không bao giờ được lưu lại.", // DRAFT — Kevin reviews
  "phm.mo.title": "Báo cáo thay đổi số điện thoại theo tháng", // DRAFT — Kevin reviews
  "phm.mo.sub": "{n} tháng gần nhất theo chi nhánh, theo giờ của tiệm ({tz}).", // DRAFT — Kevin reviews
  "phm.mo.branch": "Chi nhánh", // DRAFT — Kevin reviews
  "phm.mo.allBranches": "Tất cả chi nhánh", // DRAFT — Kevin reviews
  "phm.mo.from": "Từ tháng", // DRAFT — Kevin reviews
  "phm.mo.to": "Đến tháng", // DRAFT — Kevin reviews
  "phm.mo.none": "Không có thay đổi số nào trong khoảng này.", // DRAFT — Kevin reviews
  "phm.mo.noBranch": "Không có chi nhánh", // DRAFT — Kevin reviews
  "phm.mo.month": "Tháng", // DRAFT — Kevin reviews
  "phm.mo.requests": "Yêu cầu", // DRAFT — Kevin reviews
  "phm.mo.verified": "Thay đổi đã xác minh", // DRAFT — Kevin reviews
  "phm.mo.failed": "Lần thất bại", // DRAFT — Kevin reviews
  "phm.mo.shared": "Số dùng chung", // DRAFT — Kevin reviews
  "phm.mo.pendingSync": "Chờ đồng bộ", // DRAFT — Kevin reviews
  "phm.mo.manual": "{n} thủ công", // DRAFT — Kevin reviews
  "phm.mo.basis": "Cách đếm từng số", // DRAFT — Kevin reviews
  "phm.mo.d.requests": "Yêu cầu", // DRAFT — Kevin reviews
  "phm.mo.d.verifiedChanges": "Thay đổi đã xác minh", // DRAFT — Kevin reviews
  "phm.mo.d.failedAttempts": "Lần thất bại", // DRAFT — Kevin reviews
  "phm.mo.d.sharedContacts": "Số dùng chung", // DRAFT — Kevin reviews
  "phm.mo.d.pendingSync": "Chờ đồng bộ", // DRAFT — Kevin reviews
  "phm.mo.def.requests": "các yêu cầu thay đổi được tạo trong tháng", // DRAFT — Kevin reviews
  "phm.mo.def.verifiedChanges": "các yêu cầu có số mới bắt đầu hiệu lực trong tháng (ngoại lệ thủ công hiển thị riêng)", // DRAFT — Kevin reviews
  "phm.mo.def.failedAttempts": "các yêu cầu kết thúc thất bại, hết hạn hoặc gửi lỗi, theo tháng thay đổi gần nhất", // DRAFT — Kevin reviews
  "phm.mo.def.sharedContacts": "trong các yêu cầu của tháng, những yêu cầu có số mới đang thuộc một khách khác", // DRAFT — Kevin reviews
  "phm.mo.def.pendingSync": "trong các yêu cầu của tháng, những thay đổi đã xác minh vẫn đang chờ đồng bộ", // DRAFT — Kevin reviews
  "phm.tl.ok": "được hồ sơ xác nhận", // DRAFT — Kevin reviews
};
