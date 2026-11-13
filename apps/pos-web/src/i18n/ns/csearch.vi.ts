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
  "csx.status.churn_watch": "Có nguy cơ rời bỏ",
  "csx.status.rebooking": "Cần đặt lại lịch",
  "cnx.check": "Kiểm tra hệ thống ghi chú khách",
  "cnx.refresh": "Làm mới",
  "cnx.findLabel": "Tìm khách để sửa ghi chú",
  "cnx.loadFailed": "Không tải được ghi chú khách.",
  "cnx.kpi.customers": "Khách có ghi chú",
  "cnx.kpi.customersSub": "Số khách có ít nhất một ghi chú",
  "cnx.kpi.warnings": "Cảnh báo an toàn",
  "cnx.kpi.warningsSub": "Cảnh báo dịch vụ quan trọng đã ghi",
  "cnx.kpi.preferences": "Sở thích đã ghi",
  "cnx.kpi.preferencesSub": "Sở thích dịch vụ và thợ",
  "cnx.kpi.review": "Cần xem lại",
  "cnx.kpi.reviewSub": "Ghi chú an toàn chưa được xem lại",
  "cnx.kpi.reviewSubCorr": "{n} cần sửa",
  "cnx.searchPh": "Tìm tên khách, số điện thoại hoặc nội dung ghi chú",
  "cnx.search": "Tìm",
  "cnx.f.category": "Loại",
  "cnx.f.review": "Xem lại",
  "cnx.f.sort": "Sắp xếp",
  "cnx.f.dateField": "Theo ngày",
  "cnx.cat.all": "Tất cả loại",
  "cnx.cat.general": "Ghi chú chung của tiệm",
  "cnx.cat.service_preference": "Sở thích dịch vụ",
  "cnx.cat.technician_preference": "Thợ yêu thích",
  "cnx.cat.allergy": "Dị ứng / nhạy cảm",
  "cnx.cat.warning": "Cảnh báo dịch vụ quan trọng",
  "cnx.cat.visit": "Ghi chú lần làm",
  "cnx.rv.all": "Mọi trạng thái",
  "cnx.rv.needs_review": "Cần xem lại",
  "cnx.rv.reviewed": "Đã xem lại",
  "cnx.rv.needs_correction": "Cần sửa",
  "cnx.rv.not_required": "Không cần xem lại",
  "cnx.sort.newest": "Mới nhất trước",
  "cnx.sort.oldest": "Cũ nhất trước",
  "cnx.sort.name": "Tên khách A–Z",
  "cnx.date.updated": "Ngày sửa ghi chú",
  "cnx.date.reviewed": "Ngày xem lại",
  "cnx.preset.all": "Mọi thời gian",
  "cnx.preset.today": "Hôm nay",
  "cnx.preset.week": "Tuần này",
  "cnx.preset.month": "Tháng này",
  "cnx.preset.year": "Năm nay",
  "cnx.preset.custom": "Tùy chọn",
  "cnx.clear": "Xóa bộ lọc",
  "cnx.list": "Ghi chú khách",
  "cnx.count": "{n} ghi chú · mới nhất trước",
  "cnx.loading": "Đang tải ghi chú…",
  "cnx.noMatch": "Không có ghi chú nào khớp bộ lọc.",
  "cnx.empty": "Chưa có khách nào có ghi chú.",
  "cnx.col.customer": "Khách",
  "cnx.col.category": "Loại",
  "cnx.col.note": "Ghi chú",
  "cnx.col.review": "Xem lại",
  "cnx.col.updated": "Cập nhật",
  "cnx.visitTicket": "Từ lần làm (Hoàn tất dịch vụ)",
  "cnx.view": "Xem",
  "cnx.edit": "Sửa",
  "cnx.rows": "Số dòng",
  "cnx.footNote": "Ghi chú là thông tin nhạy cảm. Dị ứng và cảnh báo là điều khách báo hoặc nhân viên thấy — không phải chẩn đoán. Việc mở ghi chú của khách được ghi lại.",
  "cnx.detail": "Ghi chú khách",
  "cnx.updatedAt": "ghi chú lưu lúc {at}",
  "cnx.editNotes": "Sửa ghi chú",
  "cnx.noNotes": "Khách này chưa có ghi chú.",
  "cnx.confirm": "Xác nhận nội dung này",
  "cnx.needsCorrection": "Cần sửa",
  "cnx.markCorrect": "Đánh dấu cần sửa",
  "cnx.correctWhy": "Cần sửa điều gì?",
  "cnx.reviewNote": "Lần xem lại chỉ áp dụng cho đúng nội dung này; sửa ghi chú sẽ cần xem lại lần nữa.",
  "cnx.history": "Lịch sử xem lại",
  "cnx.noHistory": "Chưa có lần xem lại nào.",
  "cnx.dec.confirmed": "Đã xác nhận",
  "cnx.dec.needs_correction": "Đánh dấu cần sửa",
  "cnx.olderText": "cho nội dung cũ",
  "cnx.saved": "Đã lưu ghi chú.",
  "cnx.safetyEditNote": "Sửa dị ứng hoặc cảnh báo sẽ đưa ghi chú về trạng thái cần xem lại.",
  "cnx.health.overall": "{s} · kiểm tra lúc {at}",
  "cnx.health.running": "Đang kiểm tra…",
  "cnx.health.readOnly": "Chỉ đọc: việc kiểm tra không sửa ghi chú hay lần xem lại nào.",
  "cnx.health.READY": "Đạt",
  "cnx.health.WARNING": "Cảnh báo",
  "cnx.health.FAILED": "Lỗi",
  "cnx.health.k.notes_readable": "Đọc được ghi chú",
  "cnx.health.k.legacy_mirror": "Cột ghi chú cũ khớp",
  "cnx.health.k.safety_review_backlog": "Ghi chú an toàn chờ quá 7 ngày",
  "cnx.health.k.corrections_open": "Ghi chú cần sửa",
  "cnx.health.k.no_side_effects": "Không thay đổi gì",
  "cnx.health.d.notes_readable.READY": "Ghi chú của mọi khách đều đọc được.",
  "cnx.health.d.notes_readable.FAILED": "Ghi chú của một số khách bị lưu sai dạng, không đọc được.",
  "cnx.health.d.legacy_mirror.READY": "Cột ghi chú tiệm và cảnh báo cũ khớp với ghi chú.",
  "cnx.health.d.legacy_mirror.WARNING": "Một số cột ghi chú cũ khác với ghi chú; màn hình cũ có thể hiện nội dung cũ.",
  "cnx.health.d.safety_review_backlog.READY": "Không có ghi chú an toàn nào chờ xem lại quá 7 ngày.",
  "cnx.health.d.safety_review_backlog.WARNING": "Một số ghi chú an toàn đã chờ xem lại quá 7 ngày.",
  "cnx.health.d.corrections_open.READY": "Không có ghi chú nào cần sửa.",
  "cnx.health.d.corrections_open.WARNING": "Một số ghi chú được đánh dấu cần sửa nhưng chưa sửa.",
  "cnx.health.d.no_side_effects.READY": "Việc kiểm tra không thay đổi gì.",
  "cnx.err.CUSTOMER_NOTES_CHANGED": "Ghi chú đã bị sửa sau khi bạn mở. Hãy đọc lại trước khi xác nhận.",
  "cnx.err.CUSTOMER_NOTES_REASON_REQUIRED": "Hãy ghi cần sửa điều gì.",
  "cnx.err.CUSTOMER_NOTES_INVALID_PERIOD": "Chọn ngày bắt đầu và kết thúc (bắt đầu không sau kết thúc).",
  "cnx.err.CUSTOMER_NOTES_SEARCH_TOO_SHORT": "Gõ ít nhất 2 ký tự để tìm.",
  "cnx.err.CUSTOMER_NOTES_NOT_FOUND": "Không tìm thấy khách này.",
  "cnx.err.forbidden": "Vai trò của bạn không được xem ghi chú khách.",
  "ahx.subtitle": "Mọi lịch hẹn của tiệm — sắp tới, đã xong, đã hủy và vắng mặt. Chỉ xem: không thay đổi lịch hẹn nào.",
  "ahx.findLabel": "Tìm khách để xem lịch sử",
  "ahx.check": "Kiểm tra hệ thống lịch sử lịch hẹn",
  "ahx.refresh": "Làm mới",
  "ahx.unavailable": "Không có dữ liệu",
  "ahx.loadFailed": "Không tải được lịch sử lịch hẹn.",
  "ahx.kpi.appointments": "Lịch hẹn",
  "ahx.kpi.upcoming": "Sắp tới",
  "ahx.kpi.completed": "Đã hoàn tất",
  "ahx.kpi.canceled": "Đã hủy",
  "ahx.kpi.noShows": "Vắng mặt",
  "ahx.kpi.rescheduled": "Đã dời lịch",
  "ahx.searchPh": "Khách, số điện thoại, dịch vụ hoặc thợ",
  "ahx.search": "Tìm",
  "ahx.clearSearch": "Xóa tìm kiếm",
  "ahx.f.status": "Trạng thái",
  "ahx.f.technician": "Thợ",
  "ahx.f.sort": "Sắp xếp",
  "ahx.f.dateField": "Theo ngày",
  "ahx.anyTech": "Mọi thợ",
  "ahx.st.all": "Tất cả",
  "ahx.st.upcoming": "Sắp tới",
  "ahx.st.completed": "Đã hoàn tất",
  "ahx.st.canceled": "Đã hủy",
  "ahx.st.no_show": "Vắng mặt",
  "ahx.st.rescheduled": "Đã dời lịch",
  "ahx.sort.newest": "Mới nhất trước",
  "ahx.sort.scheduled": "Theo ngày hẹn",
  "ahx.sort.upcoming": "Sắp tới trước",
  "ahx.sort.updated": "Cập nhật gần đây",
  "ahx.date.scheduled": "Ngày hẹn",
  "ahx.date.created": "Ngày đặt",
  "ahx.date.updated": "Cập nhật lần cuối",
  "ahx.date.completed": "Ngày hoàn tất",
  "ahx.date.canceled": "Ngày hủy",
  "ahx.err.APPOINTMENT_HISTORY_INVALID_PERIOD": "Khoảng ngày không hợp lệ — chọn ngày bắt đầu trước hoặc bằng ngày kết thúc.",
  "ahx.err.APPOINTMENT_HISTORY_SEARCH_TOO_SHORT": "Nhập ít nhất 2 chữ, hoặc 4 số điện thoại.",
  "ahx.err.forbidden": "Vai trò của bạn không xem được lịch sử lịch hẹn. Hãy hỏi chủ tiệm hoặc quản lý.",
  "ahx.count": "{n} lịch hẹn · {order}",
  "ahx.noMatch": "Không có lịch hẹn nào khớp bộ lọc.",
  "ahx.empty": "Chưa có lịch hẹn nào.",
  "ahx.col.customer": "Khách",
  "ahx.col.services": "Dịch vụ",
  "ahx.col.created": "Đã đặt",
  "ahx.minutes": "{n} phút",
  "ahx.anyTechnician": "Thợ nào rảnh",
  "ahx.moved": "Dời {n} lần",
  "ahx.view": "Xem",
  "ahx.footNote": "Giờ theo giờ của tiệm. Tiền của từng lần ghé nằm trong lịch sử riêng của khách.",
  "ahx.customerHistory": "Lịch sử của khách",
  "ahx.updated": "Cập nhật lần cuối",
  "ahx.completedAt": "Hoàn tất lúc",
  "ahx.canceledAt": "Hủy lúc",
  "ahx.never": "Chưa lần nào",
  "ahx.detailNote": "Muốn thay đổi lịch hẹn này, hãy mở trên Lịch.",
  "ahx.visits": "{n} lần ghé",
  "ahx.onRecord": "{n} lịch hẹn đã ghi",
  "ahx.health.readOnly": "Kiểm tra này chỉ đọc — không thay đổi lịch hẹn nào.",
  "ahx.health.k.appointments_readable": "Đọc được lịch hẹn",
  "ahx.health.d.appointments_readable.READY": "Tải được lịch hẹn của tiệm.",
  "ahx.health.d.appointments_readable.WARNING": "Một số lịch hẹn không đọc được.",
  "ahx.health.d.appointments_readable.FAILED": "Không đọc được lịch hẹn.",
  "ahx.health.k.lifecycle_history": "Lịch sử thay đổi",
  "ahx.health.d.lifecycle_history.READY": "Dời lịch, hoàn tất và hủy đều được ghi lại.",
  "ahx.health.d.lifecycle_history.WARNING": "Một số lịch hẹn đã xong hoặc đã hủy không có bản ghi thay đổi.",
  "ahx.health.d.lifecycle_history.FAILED": "Không đọc được lịch sử thay đổi.",
  "ahx.health.k.customer_links": "Liên kết khách",
  "ahx.health.d.customer_links.READY": "Mọi lịch hẹn đều gắn với khách có hồ sơ.",
  "ahx.health.d.customer_links.WARNING": "Một số lịch hẹn không gắn với khách nào (khách vãng lai hoặc hồ sơ đã xóa).",
  "ahx.health.d.customer_links.FAILED": "Không kiểm tra được liên kết khách.",
  "ahx.health.k.past_open_appointments": "Lịch hẹn cũ chưa đóng",
  "ahx.health.d.past_open_appointments.READY": "Không có lịch hẹn cũ nào còn mở.",
  "ahx.health.d.past_open_appointments.WARNING": "Một số lịch hẹn trước hôm nay vẫn đang đặt hoặc đang làm — hãy hoàn tất, hủy hoặc đánh vắng mặt trên Lịch.",
  "ahx.health.d.past_open_appointments.FAILED": "Không kiểm tra được lịch hẹn cũ còn mở.",
  "ahx.health.k.deposit_failed_upcoming": "Lịch hẹn sắp tới bị lỗi tiền cọc", // DRAFT — Kevin reviews
  "ahx.health.d.deposit_failed_upcoming.READY": "Không có lịch hẹn sắp tới nào bị lỗi tiền cọc.", // DRAFT — Kevin reviews
  "ahx.health.d.deposit_failed_upcoming.WARNING": "Một số lịch hẹn sắp tới bị lỗi tiền cọc — hãy liên hệ khách để thử lại trước ngày hẹn.", // DRAFT — Kevin reviews
  "ahx.health.d.deposit_failed_upcoming.FAILED": "Không kiểm tra được tiền cọc lỗi.", // DRAFT — Kevin reviews
  "ahx.health.k.no_side_effects": "Chỉ đọc",
  "ahx.health.d.no_side_effects.READY": "Trang này không thay đổi lịch hẹn, phiếu hay thanh toán nào.",
  "ahx.health.d.no_side_effects.WARNING": "Kiểm tra quyền truy cập của trang.",
  "ahx.health.d.no_side_effects.FAILED": "Bảo vệ chỉ đọc bị lỗi.",
  "cpf.act.book": "+ Đặt lịch",
  "cpf.act.close": "Đóng",
  "cpf.act.editNotes": "Sửa ghi chú trong Ghi chú khách hàng",
  "cpf.act.full": "Xem đầy đủ",
  "cpf.act.history": "Lịch sử lịch hẹn",
  "cpf.act.message": "Tin nhắn",
  "cpf.bonusHint": "Điểm thưởng được yêu cầu ở trang Xem đầy đủ (chủ tiệm duyệt, được bảo vệ).",
  "cpf.check": "Kiểm tra hệ thống hồ sơ khách",
  "cpf.refresh": "Làm mới",
  "cpf.col.date": "Ngày",
  "cpf.col.service": "Dịch vụ",
  "cpf.col.tech": "Thợ",
  "cpf.col.total": "Tổng",
  "cpf.count": "{n} khách · {order}",
  "cpf.empty": "Không có khách nào khớp chế độ xem này.",
  "cpf.err.forbidden": "Vai trò của bạn không xem được hồ sơ khách.",
  "cpf.loadFailed": "Không tải được danh sách khách.",
  "cpf.loading": "Đang tải…",
  "cpf.f.allergies": "Dị ứng / nhạy cảm",
  "cpf.f.avg": "Hóa đơn trung bình",
  "cpf.f.birthday": "Sinh nhật",
  "cpf.f.consent": "Đồng ý nhận tin",
  "cpf.f.dateField": "Theo ngày",
  "cpf.f.earned": "Tổng điểm đã nhận",
  "cpf.f.email": "Email",
  "cpf.f.giftCards": "Thẻ quà tặng",
  "cpf.f.last": "Lần ghé gần nhất",
  "cpf.f.membership": "Gói thành viên",
  "cpf.f.next": "Lịch hẹn tới",
  "cpf.f.phone": "Điện thoại",
  "cpf.f.points": "Điểm",
  "cpf.f.prefService": "Dịch vụ ưa thích",
  "cpf.f.prefStyle": "Kiểu ưa thích",
  "cpf.f.prefTech": "Thợ ưa thích",
  "cpf.f.redeemed": "Đã đổi",
  "cpf.f.salonNotes": "Ghi chú của tiệm",
  "cpf.f.sort": "Sắp xếp",
  "cpf.f.spend": "Tổng chi tiêu",
  "cpf.f.tags": "Nhãn",
  "cpf.f.tier": "Hạng",
  "cpf.f.visits": "Lần ghé đã hoàn tất",
  "cpf.f.warnings": "Cảnh báo an toàn",
  "cpf.kpi.total": "Tổng số khách",
  "cpf.kpi.active": "Mới hoạt động",
  "cpf.kpi.activeSub": "đã ghé trong {d} ngày qua",
  "cpf.kpi.review": "Cần xem lại",
  "cpf.kpi.reviewSub": "dùng chung số điện thoại hoặc email — kiểm tra trùng",
  "cpf.lastVisit": "Ghé lần cuối {d}",
  "cpf.marketing": "Tiếp thị",
  "cpf.member": "Thành viên",
  "cpf.next": "Hẹn tới {d}",
  "cpf.noConsent": "Chưa ghi nhận đồng ý",
  "cpf.noPhone": "Chưa có số điện thoại",
  "cpf.noVisitYet": "Chưa có lần ghé hoàn tất",
  "cpf.noVisits": "Chưa có lần ghé nào.",
  "cpf.none": "Không có",
  "cpf.shared": "Dùng chung liên hệ ×{n}",
  "cpf.unavailable": "Không có dữ liệu",
  "cpf.unnamed": "Khách chưa có tên",
  "cpf.visits": "{n} lần ghé",
  "cpf.date.created": "Ngày tạo",
  "cpf.date.updated": "Ngày cập nhật",
  "cpf.date.last_visit": "Lần ghé hoàn tất gần nhất",
  "cpf.date.appointment": "Lịch hẹn tới",
  "cpf.life.active": "Đang hoạt động",
  "cpf.life.inactive": "Không hoạt động",
  "cpf.life.never": "Chưa ghé",
  "cpf.life.archived": "Đã lưu trữ",
  "cpf.life.unknown": "Chưa rõ",
  "cpf.sort.newest": "Mới tạo nhất",
  "cpf.sort.last_visit": "Mới hoạt động",
  "cpf.sort.name": "Tên A–Z",
  "cpf.sort.visits": "Ghé nhiều nhất",
  "cpf.status.active": "Đang hoạt động",
  "cpf.status.inactive": "Không hoạt động",
  "cpf.status.archived": "Đã lưu trữ",
  "cpf.status.blocked": "Bị chặn",
  "cpf.status.vip": "VIP",
  "cpf.status.new": "Mới",
  "cpf.tab.overview": "Tổng quan",
  "cpf.tab.loyalty": "Tích điểm & Thành viên",
  "cpf.tab.visits": "Lần ghé",
  "cpf.tab.notes": "Ghi chú & Sở thích",
  "cpf.view.all": "Tất cả khách",
  "cpf.view.active": "Mới hoạt động",
  "cpf.view.new": "Mới thêm",
  "cpf.view.review": "Cần xem lại",
  "cpf.vip": "VIP",
  "cnx.unsaved": "Bạn có thay đổi chưa lưu. Đóng mà không lưu?", // DRAFT — Kevin reviews
  "cnx.keepEditing": "Tiếp tục sửa", // DRAFT — Kevin reviews
  "cnx.discard": "Bỏ thay đổi", // DRAFT — Kevin reviews
  "cnx.q.shape": "Dáng móng", // DRAFT — Kevin reviews
  "cnx.q.length": "Độ dài", // DRAFT — Kevin reviews
  "cnx.q.finish": "Loại sơn", // DRAFT — Kevin reviews
  "cnx.q.shape.square": "Vuông", // DRAFT — Kevin reviews
  "cnx.q.shape.round": "Tròn", // DRAFT — Kevin reviews
  "cnx.q.shape.oval": "Oval", // DRAFT — Kevin reviews
  "cnx.q.shape.squoval": "Vuông bo tròn", // DRAFT — Kevin reviews
  "cnx.q.shape.almond": "Hạnh nhân", // DRAFT — Kevin reviews
  "cnx.q.shape.coffin": "Coffin", // DRAFT — Kevin reviews
  "cnx.q.shape.stiletto": "Nhọn", // DRAFT — Kevin reviews
  "cnx.q.length.short": "Ngắn", // DRAFT — Kevin reviews
  "cnx.q.length.medium": "Vừa", // DRAFT — Kevin reviews
  "cnx.q.length.long": "Dài", // DRAFT — Kevin reviews
  "cnx.q.finish.gel": "Gel", // DRAFT — Kevin reviews
  "cnx.q.finish.dip": "Bột nhúng (dip)", // DRAFT — Kevin reviews
  "cnx.q.finish.acrylic": "Bột acrylic", // DRAFT — Kevin reviews
  "cnx.q.finish.regular": "Sơn thường", // DRAFT — Kevin reviews
  "cnx.q.finish.builder": "Gel đắp (builder)", // DRAFT — Kevin reviews
  "csx.filtersRestored": "Bộ lọc của bạn từ trước trong phiên này (không lưu nội dung tìm kiếm)", // DRAFT — Kevin reviews
  "cnx.conflict": "Có người đã thay đổi ghi chú này sau khi bạn mở. Chưa lưu gì.", // DRAFT — Kevin reviews
  "cnx.loadTheirs": "Tải phiên bản của họ", // DRAFT — Kevin reviews
  "cnx.saveAnyway": "Vẫn lưu bản của tôi", // DRAFT — Kevin reviews
  "ahx.changes.title": "Các thay đổi đã ghi", // DRAFT — Kevin reviews
  "ahx.changes.none": "Chưa ghi nhận thay đổi nào cho lịch hẹn này.", // DRAFT — Kevin reviews
  "ahx.changes.unknownActor": "Không ghi nhận", // DRAFT — Kevin reviews
  "ahx.changes.record": "(một bản ghi)", // DRAFT — Kevin reviews
  "ahx.changes.k.created": "Đã tạo", // DRAFT — Kevin reviews
  "ahx.changes.k.updated": "Đã cập nhật", // DRAFT — Kevin reviews
  "ahx.changes.k.status_changed": "Đổi trạng thái", // DRAFT — Kevin reviews
  "ahx.changes.k.rescheduled": "Đổi lịch", // DRAFT — Kevin reviews
  "ahx.changes.k.cancelled": "Đã hủy", // DRAFT — Kevin reviews
  "ahx.changes.k.assigned": "Đã gán thợ", // DRAFT — Kevin reviews
  "ahx.changes.f.status": "Trạng thái", // DRAFT — Kevin reviews
  "ahx.changes.f.appt_date": "Ngày", // DRAFT — Kevin reviews
  "ahx.changes.f.start_time": "Giờ bắt đầu", // DRAFT — Kevin reviews
  "ahx.changes.f.end_time": "Giờ kết thúc", // DRAFT — Kevin reviews
  "ahx.changes.f.technician_id": "Thợ", // DRAFT — Kevin reviews
  "ahx.changes.a.user": "Nhân viên", // DRAFT — Kevin reviews
  "ahx.changes.a.customer": "Khách hàng", // DRAFT — Kevin reviews
  "ahx.changes.a.system": "Hệ thống", // DRAFT — Kevin reviews
  "ahx.changes.a.ai": "Lễ tân AI", // DRAFT — Kevin reviews
  "ahx.rebook.title": "Theo dõi và đặt lại lịch (chỉ xem xét)", // DRAFT — Kevin reviews
  "ahx.rebook.next": "Đã có lịch hẹn tiếp theo: {when}", // DRAFT — Kevin reviews
  "ahx.rebook.none": "Khách này chưa có lịch hẹn nào sắp tới.", // DRAFT — Kevin reviews
  "ahx.rebook.loading": "Đang kiểm tra lịch hẹn sắp tới…", // DRAFT — Kevin reviews
  "ahx.rebook.unknown": "Không kiểm tra được lịch hẹn sắp tới.", // DRAFT — Kevin reviews
  "ahx.rebook.review": "Xem xét đặt lại lịch", // DRAFT — Kevin reviews
  "ahx.rebook.assistant": "Trợ lý đặt lịch AI", // DRAFT — Kevin reviews
  "ahx.rebook.note": "Mở các màn hình xem xét hiện có — không đặt lịch hay gửi tin nào từ đây.", // DRAFT — Kevin reviews
  "cnx.pc.title": "Có thể có sở thích mâu thuẫn — vui lòng xem lại:", // DRAFT — Kevin reviews
  "cnx.pc.note": "Không có gì bị thay đổi. Giữ cái đang đúng và xóa cái còn lại.", // DRAFT — Kevin reviews
  "cnx.receipt.current": "Đã xem xét: {d} bởi {who} · {at} · cho đúng nội dung này (phiên bản {v})", // DRAFT — Kevin reviews
  "cnx.receipt.older": "Lần xem xét gần nhất ({d} bởi {who} · {at}) là cho nội dung trước — phiên bản này ({v}) chưa được xem xét", // DRAFT — Kevin reviews
  "cnx.receipt.none": "Nội dung này chưa được xem xét (phiên bản {v})", // DRAFT — Kevin reviews
  "ahx.detail.bookingId": "Mã lịch hẹn", // DRAFT — Kevin reviews
  "ahx.detail.scheduled": "Thời gian hẹn", // DRAFT — Kevin reviews
  "ahx.detail.minutes": "{n} phút", // DRAFT — Kevin reviews
  "ahx.detail.tz": "giờ của tiệm ({tz})", // DRAFT — Kevin reviews
  "ahx.detail.contact": "Liên hệ", // DRAFT — Kevin reviews
  "ahx.health.k.inactive_technician": "Lịch hẹn sắp tới với thợ không còn hoạt động", // DRAFT — Kevin reviews
  "ahx.health.d.inactive_technician.READY": "Mọi lịch hẹn sắp tới đều với thợ đang hoạt động.", // DRAFT — Kevin reviews
  "ahx.health.d.inactive_technician.WARNING": "Một số lịch hẹn sắp tới với thợ đã lưu trữ hoặc ngưng hoạt động — hãy đổi thợ trong Đặt lịch.", // DRAFT — Kevin reviews
  "ahx.health.d.inactive_technician.FAILED": "Không kiểm tra được trạng thái thợ.", // DRAFT — Kevin reviews
  "ahx.health.k.status_log_mismatch": "Trạng thái so với lịch sử thay đổi", // DRAFT — Kevin reviews
  "ahx.health.d.status_log_mismatch.READY": "Trạng thái của mọi lịch hẹn khớp với trạng thái cuối cùng trong lịch sử thay đổi.", // DRAFT — Kevin reviews
  "ahx.health.d.status_log_mismatch.WARNING": "Một số lịch hẹn có trạng thái khác với trạng thái cuối cùng được ghi trong lịch sử — hãy mở trong Đặt lịch để xác nhận.", // DRAFT — Kevin reviews
  "ahx.health.d.status_log_mismatch.FAILED": "Không so sánh được lịch sử trạng thái.", // DRAFT — Kevin reviews
  "cpf.fu.title": "Tình trạng theo dõi", // DRAFT — Kevin reviews
  "cpf.fu.upcoming": "{n} lịch hẹn sắp tới", // DRAFT — Kevin reviews
  "cpf.fu.noUpcoming": "Không có lịch hẹn sắp tới", // DRAFT — Kevin reviews
  "cpf.fu.overdue": "{n} việc theo dõi quá hạn trong {a} việc đang mở", // DRAFT — Kevin reviews
  "cpf.fu.open": "{n} việc theo dõi đang mở", // DRAFT — Kevin reviews
  "cpf.fu.noTasks": "Không có việc theo dõi đang mở", // DRAFT — Kevin reviews
  "cpf.fu.tasksUnknown": "Việc theo dõi: —", // DRAFT — Kevin reviews
  "cpf.fu.noPhone": "Chưa có số điện thoại", // DRAFT — Kevin reviews
  "cpf.fu.phoneUnverified": "Số điện thoại chưa xác minh", // DRAFT — Kevin reviews
  "cpf.fu.noEmail": "Chưa có email", // DRAFT — Kevin reviews
  "cpf.fu.contactOk": "Thông tin liên hệ đầy đủ", // DRAFT — Kevin reviews
  "cpf.fu.note": "Chỉ để tham khảo — không gửi gì từ đây.", // DRAFT — Kevin reviews
  "cnx.rel.safety": "An toàn — đọc trước", // DRAFT — Kevin reviews
  "cnx.rel.same_service": "Từ lần ghé cùng dịch vụ", // DRAFT — Kevin reviews
  "cnx.rel.same_technician": "Từ lần ghé cùng thợ", // DRAFT — Kevin reviews
  "cnx.rel.same_branch": "Từ lần ghé tại chi nhánh này", // DRAFT — Kevin reviews
  "cnx.rel.preference": "Sở thích", // DRAFT — Kevin reviews
  "cnx.rel.noteVisit": "Ghi chú liên quan nhất tới lần ghé này hiện trước; mọi ghi chú vẫn được hiện.", // DRAFT — Kevin reviews
  "cnx.rel.noteSession": "Ghi chú từ các lần bạn làm và chi nhánh này hiện trước; mọi ghi chú vẫn được hiện.", // DRAFT — Kevin reviews
  "cnx.health.k.read_failures": "Lần đọc ghi chú bị lỗi (24 giờ qua)", // DRAFT — Kevin reviews
  "cnx.health.k.warning_latency": "Thời gian mở ghi chú của khách (24 giờ qua)", // DRAFT — Kevin reviews
  "cnx.health.k.version_conflicts": "Lần sửa bị từ chối vì người khác đã lưu trước (24 giờ qua)", // DRAFT — Kevin reviews
  "cnx.health.d.read_failures.READY": "Ghi chú tải ổn định cho tiệm này.", // DRAFT — Kevin reviews
  "cnx.health.d.read_failures.WARNING": "Từ 5% lần đọc ghi chú trở lên bị lỗi — nhân viên có thể không thấy ghi chú an toàn. Báo bộ phận hỗ trợ.", // DRAFT — Kevin reviews
  "cnx.health.d.warning_latency.READY": "Ghi chú của khách, kể cả ghi chú an toàn, mở nhanh.", // DRAFT — Kevin reviews
  "cnx.health.d.warning_latency.WARNING": "Mở ghi chú của khách bị chậm (hơn 1,5 giây ở 5% lần chậm nhất). Kiểm tra kết nối hoặc báo bộ phận hỗ trợ.", // DRAFT — Kevin reviews
  "cnx.health.d.version_conflicts.READY": "Ít hoặc không có lần sửa nào trùng với người khác lưu.", // DRAFT — Kevin reviews
  "cnx.health.d.version_conflicts.WARNING": "Nhiều lần sửa bị từ chối vì người khác đã lưu cùng ghi chú trước — thống nhất ai cập nhật ghi chú.", // DRAFT — Kevin reviews
  "cnx.health.m.read_failures": "{f}/{r} lần đọc bị lỗi ({p}%)", // DRAFT — Kevin reviews
  "cnx.health.m.warning_latency": "95% trong {n} lần mở mất tối đa {ms} ms (giới hạn {l} ms)", // DRAFT — Kevin reviews
  "cnx.health.m.version_conflicts": "{c}/{w} lần lưu bị từ chối vì người khác đã lưu trước", // DRAFT — Kevin reviews
  "cnx.health.m.notMeasured": "Chưa đo — nhật ký yêu cầu không có dữ liệu trong 24 giờ qua.", // DRAFT — Kevin reviews
  "cnx.src.customer_reported": "Khách hàng cho biết", // DRAFT — Kevin reviews
  "cnx.src.staff_observed": "Nhân viên ghi nhận", // DRAFT — Kevin reviews
  "cnx.src.source_confirmed": "Đã xác nhận theo nguồn", // DRAFT — Kevin reviews
  "cnx.src.ai_suggested": "AI gợi ý", // DRAFT — Kevin reviews
  "cnx.src.not_stated": "Chưa ghi nguồn", // DRAFT — Kevin reviews
  "cnx.src.derivedVisit": "Do nhân viên viết khi hoàn tất dịch vụ", // DRAFT — Kevin reviews
  "cnx.src.by": "Ghi nguồn bởi {who} · {at}", // DRAFT — Kevin reviews
  "cnx.src.earlier": "Bản ghi chú trước đã có nguồn; nguồn đó không áp dụng cho nội dung đã sửa", // DRAFT — Kevin reviews
  "cnx.src.none": "Chưa ai cho biết ghi chú này từ đâu", // DRAFT — Kevin reviews
  "cnx.src.ref": "Nguồn: {r}", // DRAFT — Kevin reviews
  "cnx.src.ask": "Ghi chú này từ đâu?", // DRAFT — Kevin reviews
  "cnx.src.choose": "Chọn…", // DRAFT — Kevin reviews
  "cnx.src.reference": "Nguồn nào đã xác nhận (bắt buộc)", // DRAFT — Kevin reviews
  "cnx.src.save": "Lưu nguồn", // DRAFT — Kevin reviews
  "cnx.src.set": "Ghi nguồn", // DRAFT — Kevin reviews
  "cnx.err.CUSTOMER_NOTES_INVALID_SOURCE": "Hãy chọn ghi chú và nguồn của nó.", // DRAFT — Kevin reviews
  "cnx.err.CUSTOMER_NOTES_REFERENCE_REQUIRED": "Hãy ghi tên nguồn đã xác nhận.", // DRAFT — Kevin reviews
  "cnx.pr.title": "Sở thích có thể đã cũ hoặc mâu thuẫn — vui lòng xem lại:", // DRAFT — Kevin reviews
  "cnx.pr.technician_inactive": "Thợ ưa thích {tech} hiện {status} tại tiệm", // DRAFT — Kevin reviews
  "cnx.pr.technician_differs_from_profile": "Ghi chú ghi tên thợ khác với hồ sơ ({profile})", // DRAFT — Kevin reviews
  "cnx.pr.notes_older_than_visits": "Ghi chú này cập nhật lần cuối {notes}, hơn một năm trước lần ghé gần nhất ({visit})", // DRAFT — Kevin reviews
  "cnx.pr.status.archived": "đã lưu trữ", // DRAFT — Kevin reviews
  "cnx.pr.status.inactive": "ngừng hoạt động", // DRAFT — Kevin reviews
};
