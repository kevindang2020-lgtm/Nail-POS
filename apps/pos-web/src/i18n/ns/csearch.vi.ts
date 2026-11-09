// csearch.vi.ts — Customer Search Complete Build Guide (Nov 1 2026): the KPI row, filters, date field + range, results,
// the Customer 360° overlay and Check Customer Search System. Keys: `csx.*`. Listed for Kevin's review in
// docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md (section "Customer Search").
export const CSEARCH_VI: Record<string, string> = {
  "csx.updated": "Cập nhật {time}",
  "csx.refresh": "Làm mới",
  "csx.check": "Kiểm tra hệ thống tìm khách",
  "csx.clearSearch": "Xóa tìm kiếm",
  "csx.clearAll": "Xóa tất cả",
  "csx.noAccess": "Vai trò của bạn không được tìm khách hàng.",
  "csx.loadFailed": "Không tải được kết quả tìm khách. Vui lòng thử lại.",
  "csx.loading": "Đang tải…",
  "csx.any": "Tất cả",
  "csx.allBranches": "Tất cả chi nhánh của tôi",
  "csx.kpi.customers": "Khách hàng",
  "csx.kpi.customersSub": "Hồ sơ đang hoạt động bạn được xem",
  "csx.kpi.active": "Đang quay lại",
  "csx.kpi.activeSub": "Có lượt làm xong trong {d} ngày qua",
  "csx.kpi.never": "Chưa có lượt làm",
  "csx.kpi.neverSub": "Chỉ có hồ sơ — chưa từng phục vụ",
  "csx.kpi.upcoming": "Có lịch hẹn sắp tới",
  "csx.kpi.upcomingSub": "Đặt từ hôm nay trở đi",
  "csx.kpi.created": "Hồ sơ mới",
  "csx.kpi.shared": "Trùng số điện thoại hoặc email",
  "csx.kpi.sharedSub": "Xem lại trong Kiểm tra trùng lặp",
  "csx.f.status": "Trạng thái khách",
  "csx.f.booking": "Lịch hẹn",
  "csx.f.technician": "Thợ",
  "csx.f.service": "Dịch vụ",
  "csx.f.branch": "Chi nhánh",
  "csx.f.sort": "Sắp xếp",
  "csx.f.dateField": "Loại ngày",
  "csx.status.all": "Tất cả",
  "csx.status.active": "Đang quay lại",
  "csx.status.inactive": "Lâu chưa quay lại",
  "csx.status.new": "Mới (1 lượt)",
  "csx.status.returning": "Khách quen (2+ lượt)",
  "csx.status.never": "Chưa có lượt làm",
  "csx.status.duplicate": "Có thể trùng lặp",
  "csx.status.archived": "Đã lưu trữ",
  "csx.booking.upcoming": "Sắp tới",
  "csx.booking.completed": "Đã hoàn tất",
  "csx.booking.canceled": "Đã hủy",
  "csx.booking.no_show": "Không đến",
  "csx.date.created": "Ngày tạo hồ sơ",
  "csx.date.updated": "Ngày cập nhật hồ sơ",
  "csx.date.last_visit": "Lượt làm gần nhất",
  "csx.date.first_visit": "Lượt làm đầu tiên",
  "csx.date.appointment": "Ngày hẹn",
  "csx.date.booking_created": "Ngày đặt lịch",
  "csx.date.service_completed": "Ngày hoàn tất dịch vụ",
  "csx.preset.all": "Mọi thời gian",
  "csx.preset.today": "Hôm nay",
  "csx.preset.week": "Tuần này",
  "csx.preset.month": "Tháng này",
  "csx.preset.year": "Năm nay",
  "csx.preset.custom": "Chọn khoảng ngày…",
  "csx.sort.relevance": "Khớp nhất",
  "csx.sort.newest": "Mới thêm nhất",
  "csx.sort.oldest": "Thêm lâu nhất",
  "csx.sort.name": "Tên A–Z",
  "csx.sort.last_visit": "Lượt làm gần nhất",
  "csx.sort.visits": "Nhiều lượt nhất",
  "csx.order.relevance": "khớp nhất trước",
  "csx.results": "Khách hàng",
  "csx.count": "{n} kết quả · {order}",
  "csx.newer": "{n} khách mới — hiển thị",
  "csx.noMatch": "Không tìm thấy khách hàng phù hợp trong hồ sơ tiệm bạn được xem.",
  "csx.empty": "Chưa có khách hàng.",
  "csx.col.customer": "Khách hàng",
  "csx.col.contact": "Điện thoại / email",
  "csx.col.lastVisit": "Lượt làm gần nhất",
  "csx.col.next": "Lịch hẹn kế tiếp",
  "csx.col.technician": "Thợ gần nhất",
  "csx.col.visits": "Số lượt",
  "csx.col.status": "Trạng thái",
  "csx.col.created": "Ngày thêm",
  "csx.view": "Xem",
  "csx.match.customer_id": "Khớp mã khách",
  "csx.match.appointment_or_ticket": "Lịch hẹn / phiếu",
  "csx.match.phone": "Khớp số điện thoại",
  "csx.match.email": "Khớp email",
  "csx.match.name": "Khớp tên",
  "csx.match.partial": "Khớp một phần",
  "csx.sharedChip": "Trùng liên lạc ({n})",
  "csx.sharedHint": "Có hồ sơ khác cùng số điện thoại hoặc email. Điều đó không có nghĩa là cùng một người — hãy xem lại trong Kiểm tra trùng lặp.",
  "csx.member": "Hội viên",
  "csx.verifiedHint": "Số điện thoại đã xác minh",
  "csx.life.active": "Đang quay lại",
  "csx.life.inactive": "Lâu chưa quay lại",
  "csx.life.never": "Chưa có lượt làm",
  "csx.life.archived": "Đã lưu trữ",
  "csx.life.unknown": "Chưa rõ",
  "csx.rows": "Số dòng",
  "csx.contactFull": "Hiển thị đầy đủ số điện thoại và email",
  "csx.contactMasked": "Số điện thoại và email được che theo vai trò của bạn",
  "csx.fresh": "Dữ liệu trực tiếp — thay đổi gần nhất {at}",
  "csx.unavailable": "Hiện không có dữ liệu",
  "csx.close": "Đóng",
  "csx.anyTech": "Thợ bất kỳ",
  "csx.appt.booked": "Đã đặt",
  "csx.appt.confirmed": "Đã xác nhận",
  "csx.appt.arrived": "Đã đến",
  "csx.appt.checked_in": "Đã tiếp nhận",
  "csx.appt.waiting": "Đang chờ",
  "csx.appt.in_service": "Đang phục vụ",
  "csx.appt.completed": "Đã hoàn tất",
  "csx.appt.cancelled": "Đã hủy",
  "csx.appt.canceled": "Đã hủy",
  "csx.appt.no_show": "Không đến",
  "csx.appt.late": "Trễ",
  "csx.mstatus.active": "Đang hoạt động",
  "csx.mstatus.trialing": "Dùng thử",
  "csx.mstatus.past_due": "Quá hạn thanh toán",
  "csx.mstatus.paused": "Tạm dừng",
  "csx.mstatus.canceled": "Đã hủy",
  "csx.mstatus.cancelled": "Đã hủy",
  "csx.mstatus.expired": "Hết hạn",
  "csx.mstatus.pending": "Đang chờ",
  "csx.ov.title": "Khách hàng",
  "csx.ov.since": "thêm ngày {d}",
  "csx.ov.book": "Đặt lịch mới",
  "csx.ov.openCustomer": "Mở hồ sơ khách",
  "csx.ov.reviewDuplicates": "Kiểm tra trùng lặp",
  "csx.ov.unavailable": "Hiện không có: {list}. Các mục này không được hiển thị là trống.",
  "csx.ov.tab.identity": "Hồ sơ",
  "csx.ov.tab.appointments": "Lịch hẹn",
  "csx.ov.tab.services": "Dịch vụ",
  "csx.ov.tab.benefits": "Tích điểm & hội viên",
  "csx.ov.tab.duplicates": "Có thể trùng lặp",
  "csx.ov.tab.ai": "Hồ sơ AI",
  "csx.ov.id": "Mã khách",
  "csx.ov.phone": "Điện thoại",
  "csx.ov.email": "Email",
  "csx.ov.verified": "Đã xác minh",
  "csx.ov.unverified": "Chưa xác minh",
  "csx.ov.visits": "Lượt làm đã hoàn tất",
  "csx.ov.visitsLine": "{n} · đầu tiên {first} · gần nhất {last}",
  "csx.ov.homeBranch": "Chi nhánh chính",
  "csx.ov.prefers": "thích {b}",
  "csx.ov.prefTech": "Thợ ưa thích",
  "csx.ov.recorded": "đã ghi nhận",
  "csx.ov.noneRecorded": "Chưa ghi nhận",
  "csx.ov.updated": "Cập nhật lần cuối",
  "csx.ov.archived": "Đã lưu trữ",
  "csx.ov.upcoming": "Sắp tới",
  "csx.ov.history": "Lịch sử",
  "csx.ov.noUpcoming": "Không có lịch hẹn sắp tới.",
  "csx.ov.noHistory": "Không có lịch hẹn trước đây.",
  "csx.ov.cancelNoShow": "{c} đã hủy · {n} không đến",
  "csx.ov.viewBooking": "Mở trong Đặt lịch",
  "csx.ov.noServices": "Chưa có dịch vụ hoàn tất.",
  "csx.ov.minutes": "{n} phút",
  "csx.ov.loyalty": "Tích điểm",
  "csx.ov.notEnrolled": "Chưa tham gia.",
  "csx.ov.points": "{n} điểm (theo sổ điểm)",
  "csx.ov.conflict": "Hồ sơ ghi {p}, sổ điểm ghi {l} — tính theo sổ điểm",
  "csx.ov.memberships": "Hội viên",
  "csx.ov.noMemberships": "Không có gói hội viên.",
  "csx.ov.readOnly": "Chỉ xem. Điểm và gói hội viên chỉ thay đổi trong Tích điểm và Hội viên.",
  "csx.ov.dupRule": "Các hồ sơ này cùng số điện thoại hoặc email với khách này. Đó chỉ là dấu hiệu, không phải bằng chứng: ở đây không gộp hồ sơ nào — hãy quyết định trong Kiểm tra trùng lặp.",
  "csx.ov.samePhone": "cùng số điện thoại",
  "csx.ov.sameEmail": "cùng email",
  "csx.ov.decision.keep_separate": "đã giữ riêng",
  "csx.ov.decision.not_sure": "đánh dấu chưa chắc",
  "csx.ov.noDuplicates": "Không có hồ sơ nào khác cùng số điện thoại hoặc email này.",
  "csx.health.overall": "{s} · kiểm tra lúc {at}",
  "csx.health.running": "Đang kiểm tra…",
  "csx.health.readOnly": "Chỉ đọc: việc kiểm tra đọc dữ liệu thật và không thay đổi gì.",
  "csx.health.recent": "Đây là kết quả của lần kiểm tra trong 30 giây vừa qua.",
  "csx.health.next": "Bước tiếp theo:",
  "csx.health.READY": "Sẵn sàng",
  "csx.health.WARNING": "Cần chú ý",
  "csx.health.FAILED": "Lỗi",
  "csx.health.UNKNOWN": "Chưa rõ",
  "csx.health.k.directory": "Danh bạ khách hàng",
  "csx.health.k.exact_lookup": "Tìm một khách đã biết",
  "csx.health.k.phone_normalization": "Số điện thoại sẵn sàng để tìm",
  "csx.health.k.indexes": "Chỉ mục tìm kiếm",
  "csx.health.k.tenant_isolation": "Tách biệt giữa các tiệm",
  "csx.health.k.booking_links": "Liên kết lịch hẹn",
  "csx.health.k.service_history": "Liên kết lịch sử dịch vụ",
  "csx.health.k.duplicate_signals": "Trùng số điện thoại / email",
  "csx.health.k.ai_profile": "Gói Hồ sơ khách AI",
  "csx.health.k.freshness": "Độ mới của dữ liệu",
  "csx.src.visits": "lượt làm",
  "csx.src.booking": "lịch hẹn",
  "csx.src.services": "dịch vụ",
  "csx.src.loyalty": "tích điểm",
  "csx.src.memberships": "hội viên",
  "csx.src.duplicates": "hồ sơ có thể trùng",
  "csx.src.preferences": "sở thích",
  "csx.health.d.failed": "Không chạy được bước kiểm tra. Hãy thử lại; nếu vẫn lỗi, hãy kiểm tra kết nối cơ sở dữ liệu.",
  "csx.health.d.directory.READY": "{live} hồ sơ khách đang hoạt động và {archived} hồ sơ đã lưu trữ trong tiệm này.",
  "csx.health.d.exact_lookup.READY": "Đã tìm thấy khách mới nhất theo mã và theo số điện thoại.",
  "csx.health.d.exact_lookup.FAILED": "Không tìm được một khách đã biết (theo mã: {byId}, theo điện thoại: {byPhone}). Hãy kiểm tra cách chuẩn hóa số điện thoại.",
  "csx.health.d.exact_lookup.UNKNOWN": "Chưa có khách nào có số điện thoại để kiểm tra.",
  "csx.health.d.phone_normalization.READY": "Số điện thoại đã lưu đúng định dạng tìm kiếm (đã kiểm tra {n}).",
  "csx.health.d.phone_normalization.WARNING": "{missing} khách có hiện số điện thoại nhưng chưa lưu để tìm kiếm; {off} trong {n} số gần nhất không đúng định dạng. Hãy mở họ trong Quản lý khách hàng và lưu lại số điện thoại.",
  "csx.health.d.indexes.READY": "Đã có chỉ mục tìm kiếm danh bạ, email và tên tiếng Việt.",
  "csx.health.d.indexes.WARNING": "Thiếu chỉ mục tìm kiếm: {list}. Hãy áp dụng bản cập nhật cơ sở dữ liệu mới nhất; danh bạ lớn sẽ tìm chậm nếu thiếu.",
  "csx.health.d.tenant_isolation.READY": "Không có lịch hẹn hay hóa đơn nào của tiệm trỏ tới khách của tiệm khác.",
  "csx.health.d.tenant_isolation.FAILED": "{a} lịch hẹn và {t} hóa đơn của tiệm trỏ tới khách của tiệm khác. Hãy báo ngay cho bộ phận hỗ trợ.",
  "csx.health.d.booking_links.READY": "{total} lịch hẹn trong 90 ngày qua, đều đã gắn với khách.",
  "csx.health.d.booking_links.WARNING": "{total} lịch hẹn trong 90 ngày qua; {unlinked} chưa gắn hồ sơ khách (khách vãng lai hoặc đặt hộ). Hãy gắn khách trong mục Đặt lịch khi biết là ai.",
  "csx.health.d.booking_links.FAILED": "{n} lịch hẹn gần đây trỏ tới hồ sơ khách không còn tồn tại. Hãy báo cho bộ phận hỗ trợ.",
  "csx.health.d.service_history.READY": "{total} lượt hoàn tất trong 90 ngày qua; {anon} lượt không có khách (không tính vào lịch sử của ai).",
  "csx.health.d.duplicate_signals.READY": "Không có số điện thoại hay email trùng nào chưa xem xét.",
  "csx.health.d.duplicate_signals.WARNING": "{n} hồ sơ trùng số điện thoại hoặc email với hồ sơ khác. Hãy xem xét trong mục Hồ sơ trùng — tìm kiếm không bao giờ tự gộp.",
  "csx.health.d.ai_profile.READY": "Gói Hồ sơ khách hàng AI đang hoạt động. Tìm kiếm không phụ thuộc vào gói này.",
  "csx.health.d.ai_profile.WARNING": "Gói Hồ sơ khách hàng AI chưa hoạt động ({status}). Tìm kiếm khách vẫn hoạt động; hãy gia hạn để dùng bảng hồ sơ AI.",
  "csx.health.d.ai_profile.UNKNOWN": "Chưa có gói Hồ sơ khách hàng AI. Tìm kiếm vẫn hoạt động.",
  "csx.health.d.freshness.READY": "Tìm kiếm đọc trực tiếp hồ sơ (thay đổi gần nhất {at}); không có chỉ mục riêng nào bị cũ.",
  "csx.health.d.freshness.UNKNOWN": "Chưa có hồ sơ khách nào.",
  "csx.status.churn_watch": "Có nguy cơ rời bỏ",   // DRAFT — Kevin reviews
  "csx.status.rebooking": "Cần đặt lại lịch",   // DRAFT — Kevin reviews,
  "cnx.check": "Kiểm tra hệ thống ghi chú khách",   // DRAFT — Kevin reviews
  "cnx.refresh": "Làm mới",   // DRAFT — Kevin reviews
  "cnx.findLabel": "Tìm khách để sửa ghi chú",   // DRAFT — Kevin reviews
  "cnx.loadFailed": "Không tải được ghi chú khách.",   // DRAFT — Kevin reviews
  "cnx.kpi.customers": "Khách có ghi chú",   // DRAFT — Kevin reviews
  "cnx.kpi.customersSub": "Số khách có ít nhất một ghi chú",   // DRAFT — Kevin reviews
  "cnx.kpi.warnings": "Cảnh báo an toàn",   // DRAFT — Kevin reviews
  "cnx.kpi.warningsSub": "Cảnh báo dịch vụ quan trọng đã ghi",   // DRAFT — Kevin reviews
  "cnx.kpi.preferences": "Sở thích đã ghi",   // DRAFT — Kevin reviews
  "cnx.kpi.preferencesSub": "Sở thích dịch vụ và thợ",   // DRAFT — Kevin reviews
  "cnx.kpi.review": "Cần xem lại",   // DRAFT — Kevin reviews
  "cnx.kpi.reviewSub": "Ghi chú an toàn chưa được xem lại",   // DRAFT — Kevin reviews
  "cnx.kpi.reviewSubCorr": "{n} cần sửa",   // DRAFT — Kevin reviews
  "cnx.searchPh": "Tìm tên khách, số điện thoại hoặc nội dung ghi chú",   // DRAFT — Kevin reviews
  "cnx.search": "Tìm",   // DRAFT — Kevin reviews
  "cnx.f.category": "Loại",   // DRAFT — Kevin reviews
  "cnx.f.review": "Xem lại",   // DRAFT — Kevin reviews
  "cnx.f.sort": "Sắp xếp",   // DRAFT — Kevin reviews
  "cnx.f.dateField": "Theo ngày",   // DRAFT — Kevin reviews
  "cnx.cat.all": "Tất cả loại",   // DRAFT — Kevin reviews
  "cnx.cat.general": "Ghi chú chung của tiệm",   // DRAFT — Kevin reviews
  "cnx.cat.service_preference": "Sở thích dịch vụ",   // DRAFT — Kevin reviews
  "cnx.cat.technician_preference": "Thợ yêu thích",   // DRAFT — Kevin reviews
  "cnx.cat.allergy": "Dị ứng / nhạy cảm",   // DRAFT — Kevin reviews
  "cnx.cat.warning": "Cảnh báo dịch vụ quan trọng",   // DRAFT — Kevin reviews
  "cnx.cat.visit": "Ghi chú lần làm",   // DRAFT — Kevin reviews
  "cnx.rv.all": "Mọi trạng thái",   // DRAFT — Kevin reviews
  "cnx.rv.needs_review": "Cần xem lại",   // DRAFT — Kevin reviews
  "cnx.rv.reviewed": "Đã xem lại",   // DRAFT — Kevin reviews
  "cnx.rv.needs_correction": "Cần sửa",   // DRAFT — Kevin reviews
  "cnx.rv.not_required": "Không cần xem lại",   // DRAFT — Kevin reviews
  "cnx.sort.newest": "Mới nhất trước",   // DRAFT — Kevin reviews
  "cnx.sort.oldest": "Cũ nhất trước",   // DRAFT — Kevin reviews
  "cnx.sort.name": "Tên khách A–Z",   // DRAFT — Kevin reviews
  "cnx.date.updated": "Ngày sửa ghi chú",   // DRAFT — Kevin reviews
  "cnx.date.reviewed": "Ngày xem lại",   // DRAFT — Kevin reviews
  "cnx.preset.all": "Mọi thời gian",   // DRAFT — Kevin reviews
  "cnx.preset.today": "Hôm nay",   // DRAFT — Kevin reviews
  "cnx.preset.week": "Tuần này",   // DRAFT — Kevin reviews
  "cnx.preset.month": "Tháng này",   // DRAFT — Kevin reviews
  "cnx.preset.year": "Năm nay",   // DRAFT — Kevin reviews
  "cnx.preset.custom": "Tùy chọn",   // DRAFT — Kevin reviews
  "cnx.clear": "Xóa bộ lọc",   // DRAFT — Kevin reviews
  "cnx.list": "Ghi chú khách",   // DRAFT — Kevin reviews
  "cnx.count": "{n} ghi chú · mới nhất trước",   // DRAFT — Kevin reviews
  "cnx.loading": "Đang tải ghi chú…",   // DRAFT — Kevin reviews
  "cnx.noMatch": "Không có ghi chú nào khớp bộ lọc.",   // DRAFT — Kevin reviews
  "cnx.empty": "Chưa có khách nào có ghi chú.",   // DRAFT — Kevin reviews
  "cnx.col.customer": "Khách",   // DRAFT — Kevin reviews
  "cnx.col.category": "Loại",   // DRAFT — Kevin reviews
  "cnx.col.note": "Ghi chú",   // DRAFT — Kevin reviews
  "cnx.col.review": "Xem lại",   // DRAFT — Kevin reviews
  "cnx.col.updated": "Cập nhật",   // DRAFT — Kevin reviews
  "cnx.visitTicket": "Từ lần làm (Hoàn tất dịch vụ)",   // DRAFT — Kevin reviews
  "cnx.view": "Xem",   // DRAFT — Kevin reviews
  "cnx.edit": "Sửa",   // DRAFT — Kevin reviews
  "cnx.rows": "Số dòng",   // DRAFT — Kevin reviews
  "cnx.footNote": "Ghi chú là thông tin nhạy cảm. Dị ứng và cảnh báo là điều khách báo hoặc nhân viên thấy — không phải chẩn đoán. Việc mở ghi chú của khách được ghi lại.",   // DRAFT — Kevin reviews
  "cnx.detail": "Ghi chú khách",   // DRAFT — Kevin reviews
  "cnx.updatedAt": "ghi chú lưu lúc {at}",   // DRAFT — Kevin reviews
  "cnx.editNotes": "Sửa ghi chú",   // DRAFT — Kevin reviews
  "cnx.noNotes": "Khách này chưa có ghi chú.",   // DRAFT — Kevin reviews
  "cnx.confirm": "Xác nhận nội dung này",   // DRAFT — Kevin reviews
  "cnx.needsCorrection": "Cần sửa",   // DRAFT — Kevin reviews
  "cnx.markCorrect": "Đánh dấu cần sửa",   // DRAFT — Kevin reviews
  "cnx.correctWhy": "Cần sửa điều gì?",   // DRAFT — Kevin reviews
  "cnx.reviewNote": "Lần xem lại chỉ áp dụng cho đúng nội dung này; sửa ghi chú sẽ cần xem lại lần nữa.",   // DRAFT — Kevin reviews
  "cnx.history": "Lịch sử xem lại",   // DRAFT — Kevin reviews
  "cnx.noHistory": "Chưa có lần xem lại nào.",   // DRAFT — Kevin reviews
  "cnx.dec.confirmed": "Đã xác nhận",   // DRAFT — Kevin reviews
  "cnx.dec.needs_correction": "Đánh dấu cần sửa",   // DRAFT — Kevin reviews
  "cnx.olderText": "cho nội dung cũ",   // DRAFT — Kevin reviews
  "cnx.saved": "Đã lưu ghi chú.",   // DRAFT — Kevin reviews
  "cnx.safetyEditNote": "Sửa dị ứng hoặc cảnh báo sẽ đưa ghi chú về trạng thái cần xem lại.",   // DRAFT — Kevin reviews
  "cnx.health.overall": "{s} · kiểm tra lúc {at}",   // DRAFT — Kevin reviews
  "cnx.health.running": "Đang kiểm tra…",   // DRAFT — Kevin reviews
  "cnx.health.readOnly": "Chỉ đọc: việc kiểm tra không sửa ghi chú hay lần xem lại nào.",   // DRAFT — Kevin reviews
  "cnx.health.READY": "Đạt",   // DRAFT — Kevin reviews
  "cnx.health.WARNING": "Cảnh báo",   // DRAFT — Kevin reviews
  "cnx.health.FAILED": "Lỗi",   // DRAFT — Kevin reviews
  "cnx.health.k.notes_readable": "Đọc được ghi chú",   // DRAFT — Kevin reviews
  "cnx.health.k.legacy_mirror": "Cột ghi chú cũ khớp",   // DRAFT — Kevin reviews
  "cnx.health.k.safety_review_backlog": "Ghi chú an toàn chờ quá 7 ngày",   // DRAFT — Kevin reviews
  "cnx.health.k.corrections_open": "Ghi chú cần sửa",   // DRAFT — Kevin reviews
  "cnx.health.k.no_side_effects": "Không thay đổi gì",   // DRAFT — Kevin reviews
  "cnx.health.d.notes_readable.READY": "Ghi chú của mọi khách đều đọc được.",   // DRAFT — Kevin reviews
  "cnx.health.d.notes_readable.FAILED": "Ghi chú của một số khách bị lưu sai dạng, không đọc được.",   // DRAFT — Kevin reviews
  "cnx.health.d.legacy_mirror.READY": "Cột ghi chú tiệm và cảnh báo cũ khớp với ghi chú.",   // DRAFT — Kevin reviews
  "cnx.health.d.legacy_mirror.WARNING": "Một số cột ghi chú cũ khác với ghi chú; màn hình cũ có thể hiện nội dung cũ.",   // DRAFT — Kevin reviews
  "cnx.health.d.safety_review_backlog.READY": "Không có ghi chú an toàn nào chờ xem lại quá 7 ngày.",   // DRAFT — Kevin reviews
  "cnx.health.d.safety_review_backlog.WARNING": "Một số ghi chú an toàn đã chờ xem lại quá 7 ngày.",   // DRAFT — Kevin reviews
  "cnx.health.d.corrections_open.READY": "Không có ghi chú nào cần sửa.",   // DRAFT — Kevin reviews
  "cnx.health.d.corrections_open.WARNING": "Một số ghi chú được đánh dấu cần sửa nhưng chưa sửa.",   // DRAFT — Kevin reviews
  "cnx.health.d.no_side_effects.READY": "Việc kiểm tra không thay đổi gì.",   // DRAFT — Kevin reviews
  "cnx.err.CUSTOMER_NOTES_CHANGED": "Ghi chú đã bị sửa sau khi bạn mở. Hãy đọc lại trước khi xác nhận.",   // DRAFT — Kevin reviews
  "cnx.err.CUSTOMER_NOTES_REASON_REQUIRED": "Hãy ghi cần sửa điều gì.",   // DRAFT — Kevin reviews
  "cnx.err.CUSTOMER_NOTES_INVALID_PERIOD": "Chọn ngày bắt đầu và kết thúc (bắt đầu không sau kết thúc).",   // DRAFT — Kevin reviews
  "cnx.err.CUSTOMER_NOTES_SEARCH_TOO_SHORT": "Gõ ít nhất 2 ký tự để tìm.",   // DRAFT — Kevin reviews
  "cnx.err.CUSTOMER_NOTES_NOT_FOUND": "Không tìm thấy khách này.",   // DRAFT — Kevin reviews
  "cnx.err.forbidden": "Vai trò của bạn không được xem ghi chú khách.",   // DRAFT — Kevin reviews,
  "ahx.subtitle": "Mọi lịch hẹn của tiệm — sắp tới, đã xong, đã hủy và vắng mặt. Chỉ xem: không thay đổi lịch hẹn nào.",   // DRAFT — Kevin reviews
  "ahx.findLabel": "Tìm khách để xem lịch sử",   // DRAFT — Kevin reviews
  "ahx.check": "Kiểm tra hệ thống lịch sử lịch hẹn",   // DRAFT — Kevin reviews
  "ahx.refresh": "Làm mới",   // DRAFT — Kevin reviews
  "ahx.unavailable": "Không có dữ liệu",   // DRAFT — Kevin reviews
  "ahx.loadFailed": "Không tải được lịch sử lịch hẹn.",   // DRAFT — Kevin reviews
  "ahx.kpi.appointments": "Lịch hẹn",   // DRAFT — Kevin reviews
  "ahx.kpi.upcoming": "Sắp tới",   // DRAFT — Kevin reviews
  "ahx.kpi.completed": "Đã hoàn tất",   // DRAFT — Kevin reviews
  "ahx.kpi.canceled": "Đã hủy",   // DRAFT — Kevin reviews
  "ahx.kpi.noShows": "Vắng mặt",   // DRAFT — Kevin reviews
  "ahx.kpi.rescheduled": "Đã dời lịch",   // DRAFT — Kevin reviews
  "ahx.searchPh": "Khách, số điện thoại, dịch vụ hoặc thợ",   // DRAFT — Kevin reviews
  "ahx.search": "Tìm",   // DRAFT — Kevin reviews
  "ahx.clearSearch": "Xóa tìm kiếm",   // DRAFT — Kevin reviews
  "ahx.f.status": "Trạng thái",   // DRAFT — Kevin reviews
  "ahx.f.technician": "Thợ",   // DRAFT — Kevin reviews
  "ahx.f.sort": "Sắp xếp",   // DRAFT — Kevin reviews
  "ahx.f.dateField": "Theo ngày",   // DRAFT — Kevin reviews
  "ahx.anyTech": "Mọi thợ",   // DRAFT — Kevin reviews
  "ahx.st.all": "Tất cả",   // DRAFT — Kevin reviews
  "ahx.st.upcoming": "Sắp tới",   // DRAFT — Kevin reviews
  "ahx.st.completed": "Đã hoàn tất",   // DRAFT — Kevin reviews
  "ahx.st.canceled": "Đã hủy",   // DRAFT — Kevin reviews
  "ahx.st.no_show": "Vắng mặt",   // DRAFT — Kevin reviews
  "ahx.st.rescheduled": "Đã dời lịch",   // DRAFT — Kevin reviews
  "ahx.sort.newest": "Mới nhất trước",   // DRAFT — Kevin reviews
  "ahx.sort.scheduled": "Theo ngày hẹn",   // DRAFT — Kevin reviews
  "ahx.sort.upcoming": "Sắp tới trước",   // DRAFT — Kevin reviews
  "ahx.sort.updated": "Cập nhật gần đây",   // DRAFT — Kevin reviews
  "ahx.date.scheduled": "Ngày hẹn",   // DRAFT — Kevin reviews
  "ahx.date.created": "Ngày đặt",   // DRAFT — Kevin reviews
  "ahx.date.updated": "Cập nhật lần cuối",   // DRAFT — Kevin reviews
  "ahx.date.completed": "Ngày hoàn tất",   // DRAFT — Kevin reviews
  "ahx.date.canceled": "Ngày hủy",   // DRAFT — Kevin reviews
  "ahx.err.APPOINTMENT_HISTORY_INVALID_PERIOD": "Khoảng ngày không hợp lệ — chọn ngày bắt đầu trước hoặc bằng ngày kết thúc.",   // DRAFT — Kevin reviews
  "ahx.err.APPOINTMENT_HISTORY_SEARCH_TOO_SHORT": "Nhập ít nhất 2 chữ, hoặc 4 số điện thoại.",   // DRAFT — Kevin reviews
  "ahx.err.forbidden": "Vai trò của bạn không xem được lịch sử lịch hẹn. Hãy hỏi chủ tiệm hoặc quản lý.",   // DRAFT — Kevin reviews
  "ahx.count": "{n} lịch hẹn · {order}",   // DRAFT — Kevin reviews
  "ahx.noMatch": "Không có lịch hẹn nào khớp bộ lọc.",   // DRAFT — Kevin reviews
  "ahx.empty": "Chưa có lịch hẹn nào.",   // DRAFT — Kevin reviews
  "ahx.col.customer": "Khách",   // DRAFT — Kevin reviews
  "ahx.col.services": "Dịch vụ",   // DRAFT — Kevin reviews
  "ahx.col.created": "Đã đặt",   // DRAFT — Kevin reviews
  "ahx.minutes": "{n} phút",   // DRAFT — Kevin reviews
  "ahx.anyTechnician": "Thợ nào rảnh",   // DRAFT — Kevin reviews
  "ahx.moved": "Dời {n} lần",   // DRAFT — Kevin reviews
  "ahx.view": "Xem",   // DRAFT — Kevin reviews
  "ahx.footNote": "Giờ theo giờ của tiệm. Tiền của từng lần ghé nằm trong lịch sử riêng của khách.",   // DRAFT — Kevin reviews
  "ahx.customerHistory": "Lịch sử của khách",   // DRAFT — Kevin reviews
  "ahx.updated": "Cập nhật lần cuối",   // DRAFT — Kevin reviews
  "ahx.completedAt": "Hoàn tất lúc",   // DRAFT — Kevin reviews
  "ahx.canceledAt": "Hủy lúc",   // DRAFT — Kevin reviews
  "ahx.never": "Chưa lần nào",   // DRAFT — Kevin reviews
  "ahx.detailNote": "Muốn thay đổi lịch hẹn này, hãy mở trên Lịch.",   // DRAFT — Kevin reviews
  "ahx.visits": "{n} lần ghé",   // DRAFT — Kevin reviews
  "ahx.onRecord": "{n} lịch hẹn đã ghi",   // DRAFT — Kevin reviews
  "ahx.health.readOnly": "Kiểm tra này chỉ đọc — không thay đổi lịch hẹn nào.",   // DRAFT — Kevin reviews
  "ahx.health.k.appointments_readable": "Đọc được lịch hẹn",   // DRAFT — Kevin reviews
  "ahx.health.d.appointments_readable.READY": "Tải được lịch hẹn của tiệm.",   // DRAFT — Kevin reviews
  "ahx.health.d.appointments_readable.WARNING": "Một số lịch hẹn không đọc được.",   // DRAFT — Kevin reviews
  "ahx.health.d.appointments_readable.FAILED": "Không đọc được lịch hẹn.",   // DRAFT — Kevin reviews
  "ahx.health.k.lifecycle_history": "Lịch sử thay đổi",   // DRAFT — Kevin reviews
  "ahx.health.d.lifecycle_history.READY": "Dời lịch, hoàn tất và hủy đều được ghi lại.",   // DRAFT — Kevin reviews
  "ahx.health.d.lifecycle_history.WARNING": "Một số lịch hẹn đã xong hoặc đã hủy không có bản ghi thay đổi.",   // DRAFT — Kevin reviews
  "ahx.health.d.lifecycle_history.FAILED": "Không đọc được lịch sử thay đổi.",   // DRAFT — Kevin reviews
  "ahx.health.k.customer_links": "Liên kết khách",   // DRAFT — Kevin reviews
  "ahx.health.d.customer_links.READY": "Mọi lịch hẹn đều gắn với khách có hồ sơ.",   // DRAFT — Kevin reviews
  "ahx.health.d.customer_links.WARNING": "Một số lịch hẹn không gắn với khách nào (khách vãng lai hoặc hồ sơ đã xóa).",   // DRAFT — Kevin reviews
  "ahx.health.d.customer_links.FAILED": "Không kiểm tra được liên kết khách.",   // DRAFT — Kevin reviews
  "ahx.health.k.past_open_appointments": "Lịch hẹn cũ chưa đóng",   // DRAFT — Kevin reviews
  "ahx.health.d.past_open_appointments.READY": "Không có lịch hẹn cũ nào còn mở.",   // DRAFT — Kevin reviews
  "ahx.health.d.past_open_appointments.WARNING": "Một số lịch hẹn trước hôm nay vẫn đang đặt hoặc đang làm — hãy hoàn tất, hủy hoặc đánh vắng mặt trên Lịch.",   // DRAFT — Kevin reviews
  "ahx.health.d.past_open_appointments.FAILED": "Không kiểm tra được lịch hẹn cũ còn mở.",   // DRAFT — Kevin reviews
  "ahx.health.k.no_side_effects": "Chỉ đọc",   // DRAFT — Kevin reviews
  "ahx.health.d.no_side_effects.READY": "Trang này không thay đổi lịch hẹn, phiếu hay thanh toán nào.",   // DRAFT — Kevin reviews
  "ahx.health.d.no_side_effects.WARNING": "Kiểm tra quyền truy cập của trang.",   // DRAFT — Kevin reviews
  "ahx.health.d.no_side_effects.FAILED": "Bảo vệ chỉ đọc bị lỗi.",   // DRAFT — Kevin reviews,
  "cpf.act.book": "+ Đặt lịch",   // DRAFT — Kevin reviews
  "cpf.act.close": "Đóng",   // DRAFT — Kevin reviews
  "cpf.act.editNotes": "Sửa ghi chú trong Ghi chú khách hàng",   // DRAFT — Kevin reviews
  "cpf.act.full": "Xem đầy đủ",   // DRAFT — Kevin reviews
  "cpf.act.history": "Lịch sử lịch hẹn",   // DRAFT — Kevin reviews
  "cpf.act.message": "Tin nhắn",   // DRAFT — Kevin reviews
  "cpf.bonusHint": "Điểm thưởng được yêu cầu ở trang Xem đầy đủ (chủ tiệm duyệt, được bảo vệ).",   // DRAFT — Kevin reviews
  "cpf.check": "Kiểm tra hệ thống hồ sơ khách",   // DRAFT — Kevin reviews
  "cpf.refresh": "Làm mới",   // DRAFT — Kevin reviews
  "cpf.col.date": "Ngày",   // DRAFT — Kevin reviews
  "cpf.col.service": "Dịch vụ",   // DRAFT — Kevin reviews
  "cpf.col.tech": "Thợ",   // DRAFT — Kevin reviews
  "cpf.col.total": "Tổng",   // DRAFT — Kevin reviews
  "cpf.count": "{n} khách · {order}",   // DRAFT — Kevin reviews
  "cpf.empty": "Không có khách nào khớp chế độ xem này.",   // DRAFT — Kevin reviews
  "cpf.err.forbidden": "Vai trò của bạn không xem được hồ sơ khách.",   // DRAFT — Kevin reviews
  "cpf.loadFailed": "Không tải được danh sách khách.",   // DRAFT — Kevin reviews
  "cpf.loading": "Đang tải…",   // DRAFT — Kevin reviews
  "cpf.f.allergies": "Dị ứng / nhạy cảm",   // DRAFT — Kevin reviews
  "cpf.f.avg": "Hóa đơn trung bình",   // DRAFT — Kevin reviews
  "cpf.f.birthday": "Sinh nhật",   // DRAFT — Kevin reviews
  "cpf.f.consent": "Đồng ý nhận tin",   // DRAFT — Kevin reviews
  "cpf.f.dateField": "Theo ngày",   // DRAFT — Kevin reviews
  "cpf.f.earned": "Tổng điểm đã nhận",   // DRAFT — Kevin reviews
  "cpf.f.email": "Email",   // DRAFT — Kevin reviews
  "cpf.f.giftCards": "Thẻ quà tặng",   // DRAFT — Kevin reviews
  "cpf.f.last": "Lần ghé gần nhất",   // DRAFT — Kevin reviews
  "cpf.f.membership": "Gói thành viên",   // DRAFT — Kevin reviews
  "cpf.f.next": "Lịch hẹn tới",   // DRAFT — Kevin reviews
  "cpf.f.phone": "Điện thoại",   // DRAFT — Kevin reviews
  "cpf.f.points": "Điểm",   // DRAFT — Kevin reviews
  "cpf.f.prefService": "Dịch vụ ưa thích",   // DRAFT — Kevin reviews
  "cpf.f.prefStyle": "Kiểu ưa thích",   // DRAFT — Kevin reviews
  "cpf.f.prefTech": "Thợ ưa thích",   // DRAFT — Kevin reviews
  "cpf.f.redeemed": "Đã đổi",   // DRAFT — Kevin reviews
  "cpf.f.salonNotes": "Ghi chú của tiệm",   // DRAFT — Kevin reviews
  "cpf.f.sort": "Sắp xếp",   // DRAFT — Kevin reviews
  "cpf.f.spend": "Tổng chi tiêu",   // DRAFT — Kevin reviews
  "cpf.f.tags": "Nhãn",   // DRAFT — Kevin reviews
  "cpf.f.tier": "Hạng",   // DRAFT — Kevin reviews
  "cpf.f.visits": "Lần ghé đã hoàn tất",   // DRAFT — Kevin reviews
  "cpf.f.warnings": "Cảnh báo an toàn",   // DRAFT — Kevin reviews
  "cpf.kpi.total": "Tổng số khách",   // DRAFT — Kevin reviews
  "cpf.kpi.active": "Mới hoạt động",   // DRAFT — Kevin reviews
  "cpf.kpi.activeSub": "đã ghé trong {d} ngày qua",   // DRAFT — Kevin reviews
  "cpf.kpi.review": "Cần xem lại",   // DRAFT — Kevin reviews
  "cpf.kpi.reviewSub": "dùng chung số điện thoại hoặc email — kiểm tra trùng",   // DRAFT — Kevin reviews
  "cpf.lastVisit": "Ghé lần cuối {d}",   // DRAFT — Kevin reviews
  "cpf.marketing": "Tiếp thị",   // DRAFT — Kevin reviews
  "cpf.member": "Thành viên",   // DRAFT — Kevin reviews
  "cpf.next": "Hẹn tới {d}",   // DRAFT — Kevin reviews
  "cpf.noConsent": "Chưa ghi nhận đồng ý",   // DRAFT — Kevin reviews
  "cpf.noPhone": "Chưa có số điện thoại",   // DRAFT — Kevin reviews
  "cpf.noVisitYet": "Chưa có lần ghé hoàn tất",   // DRAFT — Kevin reviews
  "cpf.noVisits": "Chưa có lần ghé nào.",   // DRAFT — Kevin reviews
  "cpf.none": "Không có",   // DRAFT — Kevin reviews
  "cpf.shared": "Dùng chung liên hệ ×{n}",   // DRAFT — Kevin reviews
  "cpf.unavailable": "Không có dữ liệu",   // DRAFT — Kevin reviews
  "cpf.unnamed": "Khách chưa có tên",   // DRAFT — Kevin reviews
  "cpf.visits": "{n} lần ghé",   // DRAFT — Kevin reviews
  "cpf.date.created": "Ngày tạo",   // DRAFT — Kevin reviews
  "cpf.date.updated": "Ngày cập nhật",   // DRAFT — Kevin reviews
  "cpf.date.last_visit": "Lần ghé hoàn tất gần nhất",   // DRAFT — Kevin reviews
  "cpf.date.appointment": "Lịch hẹn tới",   // DRAFT — Kevin reviews
  "cpf.life.active": "Đang hoạt động",   // DRAFT — Kevin reviews
  "cpf.life.inactive": "Không hoạt động",   // DRAFT — Kevin reviews
  "cpf.life.never": "Chưa ghé",   // DRAFT — Kevin reviews
  "cpf.life.archived": "Đã lưu trữ",   // DRAFT — Kevin reviews
  "cpf.life.unknown": "Chưa rõ",   // DRAFT — Kevin reviews
  "cpf.sort.newest": "Mới tạo nhất",   // DRAFT — Kevin reviews
  "cpf.sort.last_visit": "Mới hoạt động",   // DRAFT — Kevin reviews
  "cpf.sort.name": "Tên A–Z",   // DRAFT — Kevin reviews
  "cpf.sort.visits": "Ghé nhiều nhất",   // DRAFT — Kevin reviews
  "cpf.status.active": "Đang hoạt động",   // DRAFT — Kevin reviews
  "cpf.status.inactive": "Không hoạt động",   // DRAFT — Kevin reviews
  "cpf.status.archived": "Đã lưu trữ",   // DRAFT — Kevin reviews
  "cpf.status.blocked": "Bị chặn",   // DRAFT — Kevin reviews
  "cpf.status.vip": "VIP",   // DRAFT — Kevin reviews
  "cpf.status.new": "Mới",   // DRAFT — Kevin reviews
  "cpf.tab.overview": "Tổng quan",   // DRAFT — Kevin reviews
  "cpf.tab.loyalty": "Tích điểm & Thành viên",   // DRAFT — Kevin reviews
  "cpf.tab.visits": "Lần ghé",   // DRAFT — Kevin reviews
  "cpf.tab.notes": "Ghi chú & Sở thích",   // DRAFT — Kevin reviews
  "cpf.view.all": "Tất cả khách",   // DRAFT — Kevin reviews
  "cpf.view.active": "Mới hoạt động",   // DRAFT — Kevin reviews
  "cpf.view.new": "Mới thêm",   // DRAFT — Kevin reviews
  "cpf.view.review": "Cần xem lại",   // DRAFT — Kevin reviews,
  "cpf.vip": "VIP",   // DRAFT — Kevin reviews
};
