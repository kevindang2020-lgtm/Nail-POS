// ns/bookverify.vi.ts — Liên lạc → Xác minh số điện thoại khi đặt lịch (Booking Phone Verification Complete Build Guide) (Tiếng Việt).
// Chỉ cho màn hình Front Desk POS của nhân viên.
export const BOOKVERIFY_VI = {
  "bv.sub": "Cài đặt · theo dõi trực tiếp · lịch sử",
  "bv.updated": "cập nhật {time}",
  "bv.refresh": "Làm mới",
  "bv.check": "Kiểm tra hệ thống xác minh",
  "bv.checking": "Đang kiểm tra…",
  "bv.kpi.pending": "Đang chờ",
  "bv.kpi.pendingSub": "mã đang chờ khách nhập",
  "bv.kpi.verified": "Đã xác minh hôm nay",
  "bv.kpi.verifiedSub": "từ nửa đêm, giờ của tiệm",
  "bv.kpi.failed": "Thất bại / hết hạn hôm nay",
  "bv.kpi.failedSub": "bị khóa, lỗi nhà cung cấp, hết hạn",
  "bv.kpi.holds": "Giữ chỗ đang hoạt động",
  "bv.kpi.holdsSub": "{n} sắp hết hạn trong 2 phút",
  "bv.kpi.sms": "Tình trạng SMS",
  "bv.kpi.smsSub": "{n} lỗi nhà cung cấp trong 24 giờ",
  "bv.kpi.rate": "Tỷ lệ thành công",
  "bv.kpi.rateSub": "{ok} / {all} đã xác minh, 30 ngày qua",
  "bv.kpi.rateUnknown": "Chưa rõ — chưa có mã nào được yêu cầu",
  "bv.settings": "Cài đặt",
  "bv.health": "Tình trạng SMS & hệ thống",
  "bv.health.never": "Chưa kiểm tra — bấm Kiểm tra hệ thống xác minh.",
  "bv.health.checkedAt": "Đã kiểm tra {time}",
  "bv.health.next": "Bước tiếp theo:",
  "bv.hs.ready": "Sẵn sàng",
  "bv.hs.needs_setup": "Cần cài đặt",
  "bv.hs.pending_provider_action": "Chờ nhà cung cấp",
  "bv.hs.degraded": "Giảm chất lượng",
  "bv.hs.failed": "Thất bại",
  "bv.hs.unknown": "Chưa rõ",
  "bv.hk.twilio_identity": "Tài khoản Twilio",
  "bv.hk.verify_service": "Dịch vụ Verify",
  "bv.hk.sender": "Số gửi",
  "bv.hk.policy": "Chính sách đang áp dụng",
  "bv.hk.recent_errors": "Lỗi gần đây",
  "bv.hk.integration": "Giữ chỗ & chốt chặn đặt lịch",
  "bv.ch.kiosk": "Kiosk",
  "bv.ch.front_desk": "Quầy lễ tân (nhân viên tạo)",
  "bv.ch.walk_in": "Khách vãng lai check-in",
  "bv.ch.inSalon": "Không bao giờ hỏi — nhân viên xác nhận trực tiếp",
  "bv.special": "Luôn xác minh lại",
  "bv.special.hint": "Các quy tắc này hỏi lại ngay cả trong thời gian tin cậy.",
  "bv.special.group": "Đặt lịch theo nhóm",
  "bv.special.groupNote": "Hiện chưa có kênh trực tuyến, ứng dụng hay lễ tân AI nào đặt cho nhiều khách, nên quy tắc này chưa có gì để kiểm tra.",
  "bv.special.deposit": "Đặt lịch cần tiền cọc",
  "bv.special.depositNote": "Dùng chính sách tiền cọc của tiệm (cài đặt Đặt lịch & Hẹn).",
  "bv.special.high": "Đặt lịch giá trị cao",
  "bv.special.highAmount": "Mức giá trị cao ($)",
  "bv.special.highNone": "Chưa đặt — quy tắc này không áp dụng cho tới khi nhập số tiền.",
  "bv.special.highSave": "Lưu số tiền",
  "bv.special.highClear": "Xóa",
  "bv.live": "Xác minh & giữ chỗ trực tiếp",
  "bv.live.order": "Gấp nhất trước (sắp hết hạn). Không bao giờ hiển thị mã.",
  "bv.live.empty": "Hiện không có ai đang chờ mã.",
  "bv.history": "Lịch sử xác minh",
  "bv.history.order": "Mới nhất trước",
  "bv.history.empty": "Không có bản ghi xác minh nào phù hợp.",
  "bv.search": "Tìm tên khách, số điện thoại, mã đặt lịch, thợ hoặc mã xác minh…",
  "bv.f.status": "Trạng thái",
  "bv.f.channel": "Kênh",
  "bv.f.all": "Tất cả",
  "bv.f.clear": "Xóa tất cả",
  "bv.st.pending": "Đang chờ",
  "bv.st.verified": "Đã xác minh",
  "bv.st.failed": "Thất bại",
  "bv.st.expired": "Hết hạn",
  "bv.st.cancelled": "Đã hủy",
  "bv.st.provider_error": "Lỗi nhà cung cấp",
  "bv.hold.none": "Không giữ chỗ",
  "bv.hold.active": "Đang giữ",
  "bv.hold.expiring_soon": "Sắp hết hạn",
  "bv.hold.expired": "Giữ chỗ hết hạn",
  "bv.hold.released": "Đã trả chỗ",
  "bv.hold.converted": "Đã đặt",
  "bv.basis.requested": "Ngày yêu cầu xác minh",
  "bv.basis.completed": "Ngày hoàn tất / thất bại",
  "bv.basis.hold_created": "Ngày tạo giữ chỗ",
  "bv.basis.hold_expired": "Ngày giữ chỗ hết hạn",
  "bv.basis.appointment": "Ngày hẹn",
  "bv.col.requested": "Yêu cầu lúc",
  "bv.col.customer": "Khách hàng",
  "bv.col.phone": "Điện thoại",
  "bv.col.booking": "Đặt lịch",
  "bv.col.channel": "Kênh",
  "bv.col.tech": "Thợ",
  "bv.col.status": "Trạng thái",
  "bv.col.hold": "Giữ chỗ",
  "bv.col.expires": "Hết hạn",
  "bv.col.attempts": "Số lần thử",
  "bv.left": "còn {s}",
  "bv.lapsed": "đã hết",
  "bv.unknownCustomer": "Chưa gắn với khách hàng",
  "bv.detail": "Chi tiết xác minh",
  "bv.d.why": "Lý do phải xác minh",
  "bv.d.whyNone": "Không có (yêu cầu trước khi thông tin này được lưu).",
  "bv.d.policy": "Phiên bản chính sách",
  "bv.d.provider": "Nhà cung cấp",
  "bv.d.services": "Dịch vụ",
  "bv.d.time": "Giờ hẹn",
  "bv.d.branch": "Chi nhánh",
  "bv.d.attempts": "Số lần thử / gửi lại",
  "bv.d.override": "Nhân viên duyệt không cần mã",
  "bv.d.timeline": "Dòng thời gian",
  "bv.d.openCustomer": "Mở khách hàng",
  "bv.d.openBooking": "Mở lịch hẹn",
  "bv.d.resend": "Gửi lại mã",
  "bv.d.resendSent": "Đã gửi mã mới tới số trong hồ sơ của khách.",
  "bv.d.resendOther": "Chưa gửi: {msg}",
  "bv.d.noCode": "Mã không bao giờ hiển thị — chỉ điện thoại của khách nhận được.",
  "bv.close": "Đóng",
  "bv.noPermission": "Bạn không có quyền xem hoạt động xác minh đặt lịch.",
  "bv.hs.unchecked": "Chưa kiểm tra",
  "bv.hd.twilio_identity": "Tài khoản Twilio của tiệm đã kết nối và phản hồi.",
  "bv.hd.verify_service": "Dịch vụ Verify gửi mã đang tồn tại và hoạt động.",
  "bv.hd.sender": "Số điện thoại hoặc tên người gửi mã.",
  "bv.hd.policy": "Điều đang được áp dụng cho từng nguồn đặt lịch ngay lúc này.",
  "bv.hd.recent_errors": "Lỗi từ nhà cung cấp trong 24 giờ qua.",
  "bv.hd.integration": "Giữ chỗ hết hạn đúng giờ và không lịch hẹn nào bỏ qua bước kiểm tra.",
  "bv.funnel.title": "Phễu xác minh · {d} ngày qua", // DRAFT — Kevin reviews
  "bv.funnel.requested": "Đã yêu cầu", // DRAFT — Kevin reviews
  "bv.funnel.sent": "Đã gửi mã", // DRAFT — Kevin reviews
  "bv.funnel.verified": "Đã xác minh", // DRAFT — Kevin reviews
  "bv.funnel.holdConverted": "Giữ chỗ → lịch hẹn", // DRAFT — Kevin reviews
  "bv.funnel.confirmed": "Đặt lịch đã xác nhận", // DRAFT — Kevin reviews
  "bv.funnel.conv": "{p}% so với bước trước", // DRAFT — Kevin reviews
  "bv.funnel.convUnknown": "— so với bước trước", // DRAFT — Kevin reviews
  "bv.funnel.overrides": "Quản lý cho qua (không tính là đã xác minh): {n}", // DRAFT — Kevin reviews
  "bv.triage.title": "Lỗi nhà cung cấp · {d} ngày qua", // DRAFT — Kevin reviews
  "bv.triage.none": "Không có lỗi nhà cung cấp trong {d} ngày qua.", // DRAFT — Kevin reviews
  "bv.triage.codes": "mã {c}", // DRAFT — Kevin reviews
  "bv.triage.cat.permission": "Quyền / tài khoản", // DRAFT — Kevin reviews
  "bv.triage.cat.service": "Dịch vụ Verify", // DRAFT — Kevin reviews
  "bv.triage.cat.sender": "Số gửi tin", // DRAFT — Kevin reviews
  "bv.triage.cat.rate_limit": "Giới hạn tần suất", // DRAFT — Kevin reviews
  "bv.triage.cat.unavailable": "Nhà cung cấp không phản hồi", // DRAFT — Kevin reviews
  "bv.triage.cat.wrong_phone": "Số điện thoại sai hoặc không dùng được", // DRAFT — Kevin reviews
  "bv.triage.cat.other": "Khác / chưa nhận diện", // DRAFT — Kevin reviews
  "bv.triage.fix.permission": "Kiểm tra tài khoản Twilio còn hoạt động và khóa / quyền vùng cho phép nhắn tin tại Mỹ.", // DRAFT — Kevin reviews
  "bv.triage.fix.service": "Kiểm tra Verify Service trong Điện thoại & Nhắn tin (thiếu, hoặc đã tắt SMS).", // DRAFT — Kevin reviews
  "bv.triage.fix.sender": "Kiểm tra số gửi tin và đăng ký A2P / số miễn phí.", // DRAFT — Kevin reviews
  "bv.triage.fix.rate_limit": "Gửi quá nhiều — hãy chờ, và xem có yêu cầu lặp lại từ một số không.", // DRAFT — Kevin reviews
  "bv.triage.fix.unavailable": "Không kết nối được Twilio — thường là tạm thời; hãy chạy kiểm tra hệ thống.", // DRAFT — Kevin reviews
  "bv.triage.fix.wrong_phone": "Số không hợp lệ, là số bàn hoặc không phải di động — hãy xác nhận lại với khách.", // DRAFT — Kevin reviews
  "bv.triage.fix.other": "Mở lịch sử xác minh và xem mã lỗi của từng lần thất bại.", // DRAFT — Kevin reviews
  "bv.dev.title": "Bằng chứng gửi SMS · {d} ngày qua", // DRAFT — Kevin reviews
  "bv.dev.sender": "Sẵn sàng gửi", // DRAFT — Kevin reviews
  "bv.dev.senderNote": "Chỉ kiểm tra tài khoản — không chứng minh tin nhắn đã đến", // DRAFT — Kevin reviews
  "bv.dev.sends": "Mã đã gửi", // DRAFT — Kevin reviews
  "bv.dev.attempts": "{n} lần gửi kể cả gửi lại", // DRAFT — Kevin reviews
  "bv.dev.delivered": "Báo đã giao", // DRAFT — Kevin reviews
  "bv.dev.pctOfSent": "{p}% số mã đã gửi", // DRAFT — Kevin reviews
  "bv.dev.pctUnknown": "— số mã đã gửi", // DRAFT — Kevin reviews
  "bv.dev.failedNoReport": "Nhà cung cấp lỗi: {f} · Không có báo cáo: {r}", // DRAFT — Kevin reviews
  "bv.dev.checks": "Mã đúng đã kiểm tra", // DRAFT — Kevin reviews
  "bv.cmp.title": "Cài đặt tiệm so với chi nhánh", // DRAFT — Kevin reviews
  "bv.cmp.location": "Chi nhánh", // DRAFT — Kevin reviews
  "bv.cmp.pick": "Chọn chi nhánh", // DRAFT — Kevin reviews
  "bv.cmp.failed": "Không tải được cài đặt của chi nhánh đó.", // DRAFT — Kevin reviews
  "bv.cmp.inherits": "Theo tiệm", // DRAFT — Kevin reviews
  "bv.cmp.on": "Bật", // DRAFT — Kevin reviews
  "bv.cmp.off": "Tắt", // DRAFT — Kevin reviews
  "bv.cmp.hours": "{n} giờ", // DRAFT — Kevin reviews
  "bv.cmp.own": "Chi nhánh này có cài đặt riêng; giá trị để trống sẽ theo tiệm.", // DRAFT — Kevin reviews
  "bv.cmp.inheritsAll": "Chi nhánh này không có cài đặt riêng — dùng cài đặt của tiệm.", // DRAFT — Kevin reviews
  "bv.cmp.noSalon": "Tiệm chưa lưu cài đặt, nên áp dụng mặc định có sẵn (tắt).", // DRAFT — Kevin reviews
  "bv.cmp.setting": "Cài đặt", // DRAFT — Kevin reviews
  "bv.cmp.salon": "Tiệm", // DRAFT — Kevin reviews
  "bv.cmp.branch": "Chi nhánh", // DRAFT — Kevin reviews
  "bv.cmp.effective": "Đang áp dụng", // DRAFT — Kevin reviews
  "bv.cmp.source": "Lấy từ", // DRAFT — Kevin reviews
  "bv.cmp.f.enabled": "Xác minh số điện thoại", // DRAFT — Kevin reviews
  "bv.cmp.f.channel.online": "Đặt lịch trực tuyến", // DRAFT — Kevin reviews
  "bv.cmp.f.channel.customer_app": "Ứng dụng khách hàng", // DRAFT — Kevin reviews
  "bv.cmp.f.channel.ai_receptionist": "Lễ tân AI", // DRAFT — Kevin reviews
  "bv.cmp.f.verifyEveryBooking": "Xác minh mọi lịch hẹn", // DRAFT — Kevin reviews
  "bv.cmp.f.reverifyAfterSeconds": "Tin số đã xác minh trong", // DRAFT — Kevin reviews
  "bv.cmp.f.reverifyOnGroupBooking": "Xác minh lại lịch hẹn nhóm", // DRAFT — Kevin reviews
  "bv.cmp.f.reverifyOnDeposit": "Xác minh lại lịch hẹn có đặt cọc", // DRAFT — Kevin reviews
  "bv.cmp.f.reverifyOnHighValue": "Xác minh lại lịch hẹn giá trị cao", // DRAFT — Kevin reviews
  "bv.cmp.src.platform": "Chính sách nền tảng AI PowerSalon", // DRAFT — Kevin reviews
  "bv.cmp.src.branch": "Chi nhánh này", // DRAFT — Kevin reviews
  "bv.cmp.src.salon": "Cài đặt của tiệm", // DRAFT — Kevin reviews
  "bv.cmp.src.default": "Mặc định có sẵn", // DRAFT — Kevin reviews
  "bv.hk.code_rules": "Quy tắc mã đặt lịch", // DRAFT — Kevin reviews
  "bv.hd.code_rules": "Độ dài mã, thời hạn, số lần thử và giới hạn gửi lại qua được bài tự kiểm tra an toàn — không gửi mã nào.", // DRAFT — Kevin reviews
} as const;
