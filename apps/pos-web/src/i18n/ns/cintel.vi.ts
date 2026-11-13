// cintel.vi.ts — Customer Intelligence (Nov 1 2026) in Vietnamese. Glossary: Thợ · hóa đơn · hàng chờ · thẻ quà tặng · Hội viên.
// Pending a native-speaker review (docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md).
export const CINTEL_VI: Record<string, string> = {
  "cix.loadFailed": "Không tải được Phân tích khách hàng. Hãy thử lại.",
  "cix.loading": "Đang tải…",
  "cix.close": "Đóng",
  "cix.all": "Tất cả",
  "cix.none": "Không có",
  "cix.notProvided": "Chưa có",
  "cix.unavailable": "Không khả dụng",
  "cix.check": "Kiểm tra hệ thống Phân tích khách hàng",
  "cix.customerSearch": "Tìm khách hàng",
  "cix.rule": "Quy tắc phân loại {v}",
  "cix.fresh.never": "Chưa quét lần nào",
  "cix.fresh.up_to_date": "Mới nhất · quét lúc {at}",
  "cix.fresh.stale": "Đã cũ · lần quét gần nhất {at}",
  "cix.fresh.failed": "Lần quét gần nhất bị lỗi · lần tốt gần nhất {at}",
  "cix.fresh.running": "Đang quét…",
  "cix.scanReused": "Vừa quét xong — đang hiển thị kết quả đó.",
  "cix.scanDone": "Đã quét xong: phân loại {n} khách hàng.",
  "cix.dupNotScanned": "Rà soát trùng lặp chưa quét",
  "cix.updated": "Cập nhật lúc {at} · mất {ms} ms",
  "cix.noScanYet": "Chưa có lần quét nào.",
  "cix.whyNumbers": "Vì sao ra các con số này?",
  "cix.view.customers": "Khách hàng",
  "cix.view.history": "Lịch sử quét",
  "cix.searchPh": "Tìm tên, số điện thoại, email, mã khách, thợ, dịch vụ hoặc mã lịch hẹn",
  "cix.f.status": "Trạng thái",
  "cix.f.flag": "Tín hiệu",
  "cix.f.sort": "Sắp xếp",
  "cix.f.dateField": "Ngày",
  "cix.status.active": "Đang hoạt động",
  "cix.status.rebooking_soon": "Sắp đến hạn đặt lại",
  "cix.status.due_for_return": "Đến hạn quay lại",
  "cix.status.inactive_all": "Không hoạt động (gồm lâu ngày)",
  "cix.status.inactive": "Không hoạt động",
  "cix.status.long_term_inactive": "Không hoạt động lâu ngày",
  "cix.status.insufficient_history": "Chưa đủ lịch sử",
  "cix.status.never_served": "Chưa từng phục vụ",
  "cix.status.not_scanned": "Chưa được quét",
  "cix.flag.churn_watch": "Theo dõi rời bỏ",
  "cix.flag.rebooking": "Cơ hội đặt lại",
  "cix.flag.upcoming": "Có lịch hẹn sắp tới",
  "cix.flag.duplicate": "Có thể trùng",
  "cix.date.last_visit": "Lần hoàn tất gần nhất",
  "cix.date.created": "Ngày tạo khách",
  "cix.date.next_appointment": "Lịch hẹn kế tiếp",
  "cix.date.profile_updated": "Cập nhật hồ sơ",
  "cix.preset.all": "Mọi thời gian",
  "cix.preset.today": "Hôm nay",
  "cix.preset.yesterday": "Hôm qua",
  "cix.preset.week": "Tuần này",
  "cix.preset.last_7": "7 ngày qua",
  "cix.preset.month": "Tháng này",
  "cix.preset.last_month": "Tháng trước",
  "cix.preset.last_30": "30 ngày qua",
  "cix.preset.last_90": "90 ngày qua",
  "cix.preset.year": "Năm nay",
  "cix.preset.custom": "Tùy chọn",
  "cix.sort.last_visit": "Lần đến gần nhất trước",
  "cix.sort.recently_added": "Mới thêm",
  "cix.sort.name": "Tên",
  "cix.sort.visits": "Nhiều lượt nhất",
  "cix.sort.days_since": "Lâu nhất từ lần đến cuối",
  "cix.clearAll": "Xóa tất cả",
  "cix.customers": "Tổng quan khách hàng",
  "cix.count": "{n} khách hàng · {order}",
  "cix.noMatch": "Không có khách nào khớp bộ lọc.",
  "cix.empty": "Chưa có khách hàng trong hồ sơ tiệm bạn được xem.",
  "cix.col.customer": "Khách hàng",
  "cix.col.history": "Lịch sử dịch vụ",
  "cix.col.next": "Lịch hẹn kế tiếp",
  "cix.col.technician": "Thợ",
  "cix.col.status": "Trạng thái",
  "cix.col.benefits": "Điểm / hội viên",
  "cix.visitsLine": "{n} lượt · gần nhất {last}",
  "cix.lastTech": "Gần nhất: {n}",
  "cix.prefTech": "Ưa thích: {n} (đã ghi nhận)",
  "cix.points": "{n} điểm",
  "cix.member": "Hội viên",
  "cix.view": "Xem",
  "cix.rows": "Số dòng",
  "cix.contactFull": "Hiển thị đầy đủ số điện thoại và email",
  "cix.contactMasked": "Số điện thoại và email được che theo vai trò của bạn",
  "cix.readOnly": "Chỉ xem: không gộp, đặt lịch, nhắn tin hay đổi điểm.",
  "cix.why.title": "Sáu thẻ số liệu liên quan với nhau thế nào",
  "cix.why.intro": "Đã quét {n} hồ sơ khách đang hoạt động. Mỗi hồ sơ thuộc đúng một trạng thái dưới đây:",
  "cix.why.def.active": "Còn trong khoảng thời gian quen thuộc, hoặc có lịch hẹn sắp tới.",
  "cix.why.def.rebooking_soon": "Sắp đến khoảng thời gian quen thuộc.",
  "cix.why.def.due_for_return": "Đã qua khoảng thời gian quen thuộc (hoặc quá nửa {d} ngày), chưa đặt lịch.",
  "cix.why.def.inactive": "Quá xa khoảng thời gian quen thuộc (hoặc hơn {d} ngày), tối đa {l} ngày.",
  "cix.why.def.long_term_inactive": "Hơn {l} ngày từ lần hoàn tất gần nhất.",
  "cix.why.def.insufficient_history": "Chưa có lượt hoàn tất, hoặc ít hơn {m} lượt và chưa đặt lịch.",
  "cix.why.total": "Tổng",
  "cix.why.matches": "= số khách đã quét",
  "cix.why.mismatch": "Không khớp tổng đã quét — hãy chạy kiểm tra.",
  "cix.why.insufficient": "\"Chưa đủ lịch sử\" = {never} chưa từng phục vụ + {under} có ít hơn {m} lượt hoàn tất. Họ chưa được tính là hoạt động hay không hoạt động.",
  "cix.why.cards": "Thẻ Không hoạt động = Không hoạt động + Không hoạt động lâu ngày. Theo dõi rời bỏ = đến hạn, không hoạt động hoặc lâu ngày mà chưa đặt lịch. Đây là danh sách cần xem, không phải kết luận.",
  "cix.why.excluded": "Không tính: {a} hồ sơ đã lưu trữ (đã gộp hoặc gỡ). {n} hồ sơ được thêm sau lần quét — bấm Làm mới để tính vào.",
  "cix.hist.when": "Thời điểm",
  "cix.hist.status": "Kết quả",
  "cix.hist.scanned": "Khách hàng",
  "cix.hist.by": "Người chạy",
  "cix.hist.completed": "Hoàn tất",
  "cix.hist.failed": "Lỗi",
  "cix.hist.running": "Đang chạy",
  "cix.hist.manual": "Làm mới",
  "cix.hist.auto": "Tự động (khi mở trang)",
  "cix.hist.scheduled": "Theo lịch",
  "cix.ov.title": "Khách hàng",
  "cix.ov.openCustomer": "Mở hồ sơ khách",
  "cix.ov.timeline": "Dòng thời gian khách hàng",
  "cix.ov.book": "Đặt lịch mới",
  "cix.ov.notScanned": "Khách này được thêm sau lần quét gần nhất. Bấm Làm mới để phân loại.",
  "cix.ov.visits": "Lượt đã hoàn tất",
  "cix.ov.first": "lần đầu {d}",
  "cix.ov.interval": "Khoảng thời gian quen thuộc",
  "cix.ov.days": "khoảng {n} ngày",
  "cix.ov.noCadence": "Chưa xác định được",
  "cix.ov.next": "Lịch hẹn kế tiếp",
  "cix.ov.evidence": "Lý do",
  "cix.ov.computed": "Phân loại lúc",
  "cix.ov.contact": "Liên hệ",
  "cix.ov.prefTech": "Thợ ưa thích",
  "cix.ov.recorded": "đã ghi nhận",
  "cix.ov.noneRecorded": "Chưa ghi nhận",
  "cix.ov.loyalty": "Điểm tích lũy",
  "cix.ov.notEnrolled": "Chưa tham gia",
  "cix.ov.membership": "Hội viên",
  "cix.ov.profileUnavailable": "Hồ sơ khách hiện không khả dụng.",
  "cix.ov.readOnly": "Chỉ xem. Muốn thay đổi, hãy mở mục quản lý dữ liệu đó.",
  "cix.err.AI_CUSTOMER_PROFILE_DISABLED": "Trợ lý Hồ sơ khách hàng AI đang tắt cho tiệm này. Hãy bật trong Cài đặt AI khách hàng.",
  "cix.err.CUSTOMER_NOT_FOUND": "Không tìm thấy khách trong hồ sơ tiệm bạn được xem.",
  "cix.err.INTELLIGENCE_INVALID_PERIOD": "Hãy chọn khoảng ngày hợp lệ (Từ ngày không sau Đến ngày).",
  "cix.err.INTELLIGENCE_SEARCH_TOO_SHORT": "Hãy nhập ít nhất 2 ký tự.",
  "cix.err.INTELLIGENCE_SCAN_FAILED": "Không quét xong được. Không có gì bị thay đổi.",
  "cix.err.PERMISSION_DENIED": "Vai trò của bạn không được xem Phân tích khách hàng.",
  "cix.health.overall": "{s} · kiểm tra lúc {at}",
  "cix.health.running": "Đang kiểm tra…",
  "cix.health.readOnly": "Việc kiểm tra chỉ đọc. Không bao giờ gộp, đặt lịch, nhắn tin, sửa hồ sơ hay đổi điểm.",
  "cix.health.recent": "(Vừa kiểm tra xong — đang hiển thị kết quả đó.)",
  "cix.health.PASSED": "Đạt",
  "cix.health.WARNING": "Cảnh báo",
  "cix.health.FAILED": "Lỗi",
  "cix.health.INSUFFICIENT_DATA": "Chưa đủ dữ liệu",
  "cix.health.UNAVAILABLE": "Không khả dụng",
  "cix.health.eligibility": "{s} đã quét = {a} hoạt động + {i} không hoạt động (thẻ) + {r} đến hạn hoặc sắp đặt lại + {n} chưa từng phục vụ + {u} có quá ít lượt.",
  "cix.health.k.assistant_enabled": "Trợ lý Hồ sơ khách hàng AI",
  "cix.health.d.assistant_enabled.PASSED": "Trợ lý đang bật cho tiệm này.",
  "cix.health.d.assistant_enabled.WARNING": "Trợ lý đang tắt; không thể làm mới số liệu. Hãy bật trong Cài đặt AI khách hàng.",
  "cix.health.k.scan_freshness": "Lần quét còn mới",
  "cix.health.d.scan_freshness.PASSED": "Lần quét gần nhất còn mới và dùng quy tắc hiện tại.",
  "cix.health.d.scan_freshness.WARNING": "Lần quét gần nhất đã hơn một giờ hoặc dùng quy tắc / cài đặt khác. Hãy bấm Làm mới.",
  "cix.health.d.scan_freshness.FAILED": "Lần quét gần nhất bị lỗi. Hãy bấm Làm mới; nếu vẫn lỗi, hãy báo lại.",
  "cix.health.d.scan_freshness.INSUFFICIENT_DATA": "Chưa quét lần nào. Hãy bấm Làm mới.",
  "cix.health.k.counts_reconcile": "Các thẻ số liệu cộng khớp",
  "cix.health.d.counts_reconcile.PASSED": "Mỗi khách đã quét thuộc đúng một trạng thái.",
  "cix.health.d.counts_reconcile.FAILED": "Các trạng thái không cộng khớp tổng đã quét. Hãy Làm mới và báo lại nếu lặp lại.",
  "cix.health.d.counts_reconcile.INSUFFICIENT_DATA": "Chưa quét lần nào.",
  "cix.health.k.eligibility": "Ai được tính vào đâu",
  "cix.health.k.snapshot_matches_scan": "Danh sách khách khớp với thẻ",
  "cix.health.d.snapshot_matches_scan.PASSED": "Danh sách có đúng số khách đã quét.",
  "cix.health.d.snapshot_matches_scan.FAILED": "Danh sách và thẻ không khớp. Hãy bấm Làm mới.",
  "cix.health.d.snapshot_matches_scan.INSUFFICIENT_DATA": "Chưa quét lần nào.",
  "cix.health.k.coverage": "Mọi khách hiện tại đều được tính",
  "cix.health.d.coverage.PASSED": "Lần quét bao gồm mọi khách hiện tại.",
  "cix.health.d.coverage.WARNING": "Có khách được thêm hoặc lưu trữ sau lần quét. Hãy bấm Làm mới.",
  "cix.health.d.coverage.INSUFFICIENT_DATA": "Chưa quét lần nào.",
  "cix.health.k.tenant_isolation": "Chỉ khách của tiệm này",
  "cix.health.d.tenant_isolation.PASSED": "Mọi khách được phân loại đều thuộc tiệm này.",
  "cix.health.d.tenant_isolation.FAILED": "Có khách được phân loại thuộc tiệm khác. Hãy báo ngay.",
  "cix.health.k.completed_visits": "Lượt hoàn tất có thời điểm",
  "cix.health.d.completed_visits.PASSED": "Các lượt hoàn tất đều có thời điểm hoàn tất.",
  "cix.health.d.completed_visits.WARNING": "Một số lượt hoàn tất không có thời điểm hoàn tất; dùng thời điểm mở hóa đơn.",
  "cix.health.k.booking_sync": "Lịch hẹn trỏ tới khách đang hoạt động",
  "cix.health.d.booking_sync.PASSED": "Lịch hẹn sắp tới đều thuộc hồ sơ khách đang hoạt động.",
  "cix.health.d.booking_sync.WARNING": "Một số lịch hẹn sắp tới thuộc hồ sơ đã lưu trữ; các khách đó trông như \"chưa đặt lịch\". Hãy kiểm tra Rà soát trùng lặp.",
  "cix.health.k.duplicate_review": "Rà soát trùng lặp",
  "cix.health.d.duplicate_review.PASSED": "Không có nhóm trùng lặp nào cần xem.",
  "cix.health.d.duplicate_review.WARNING": "Một số hồ sơ có thể là cùng một khách; lượt đến bị tách cho đến khi được xem. Không tự động gộp.",
  "cix.health.d.duplicate_review.INSUFFICIENT_DATA": "Rà soát trùng lặp chưa quét lần nào.",
  "cix.health.k.phone_normalizer": "Đối chiếu số điện thoại",
  "cix.health.d.phone_normalizer.PASSED": "Số điện thoại ở mọi định dạng đều khớp số đã lưu.",
  "cix.health.d.phone_normalizer.FAILED": "Bộ chuẩn hóa số điện thoại lỗi trên số mẫu. Hãy báo lại.",
  "cix.health.k.indexes": "Chỉ mục",
  "cix.health.d.indexes.PASSED": "Đã có chỉ mục phân loại và lượt khách.",
  "cix.health.d.indexes.WARNING": "Thiếu một số chỉ mục; danh sách có thể chậm. Hãy áp dụng bản cập nhật cơ sở dữ liệu mới nhất.",
  "cix.ret.sub": "Lấy từ Giữ chân khách — mở để xử lý", // DRAFT — Kevin reviews
  "cix.scope.label": "Chi nhánh", // DRAFT — Kevin reviews
  "cix.scope.all": "Tất cả chi nhánh của tôi", // DRAFT — Kevin reviews
  "cix.scope.current": "Chi nhánh này", // DRAFT — Kevin reviews
  "cix.scope.line": "Theo chi nhánh: {b} — tổng {d} khách hàng khác nhau ({o} khách ghé nhiều chi nhánh và chỉ được tính một lần).", // DRAFT — Kevin reviews
  "cix.via.customer": "Khớp: thông tin của chính khách hàng", // DRAFT — Kevin reviews
  "cix.via.visit_technician": "Khớp: đã được thợ này phục vụ (lượt ghé hoàn tất)", // DRAFT — Kevin reviews
  "cix.via.assigned_technician": "Khớp: đã đặt lịch với thợ này (chưa chắc đã phục vụ)", // DRAFT — Kevin reviews
  "cix.via.preferred_technician": "Khớp: đây là thợ khách hàng ưa thích", // DRAFT — Kevin reviews
  "cix.via.service": "Khớp: một dịch vụ trong lượt ghé", // DRAFT — Kevin reviews
  "cix.via.appointment": "Khớp: một lịch hẹn", // DRAFT — Kevin reviews
  "cix.flag.high_value": "Chi tiêu cao", // DRAFT — Kevin reviews
  "cix.sort.spend": "Chi tiêu cao nhất", // DRAFT — Kevin reviews
  "cix.spent": "Đã chi {amount}", // DRAFT — Kevin reviews
  "cix.360.open": "Xem toàn cảnh 360°", // DRAFT — Kevin reviews
  "cix.360.failed": "Không tải được thông tin toàn cảnh 360°.", // DRAFT — Kevin reviews
  "cix.360.identity": "Danh tính", // DRAFT — Kevin reviews
  "cix.360.masked": "đã ẩn", // DRAFT — Kevin reviews
  "cix.360.spend": "Tổng cộng", // DRAFT — Kevin reviews
  "cix.360.spendLine": "{amount} qua {n} lượt ghé", // DRAFT — Kevin reviews
  "cix.360.prefs": "Sở thích", // DRAFT — Kevin reviews
  "cix.360.history": "Lịch sử dịch vụ", // DRAFT — Kevin reviews
  "cix.360.noVisits": "Chưa có lượt ghé nào hoàn tất.", // DRAFT — Kevin reviews
  "cix.360.col.date": "Ngày", // DRAFT — Kevin reviews
  "cix.360.col.services": "Dịch vụ", // DRAFT — Kevin reviews
  "cix.360.col.tech": "Thợ", // DRAFT — Kevin reviews
  "cix.360.col.total": "Tổng", // DRAFT — Kevin reviews
  "cix.360.suggestions": "Gợi ý cần xem xét", // DRAFT — Kevin reviews
  "cix.360.noSuggestions": "Không có gì cần xem xét cho khách này.", // DRAFT — Kevin reviews
  "cix.360.advisory": "Gợi ý chỉ để nhân viên xem xét. Không có gì ở đây tự đặt lịch, gửi tin, gộp hồ sơ hay đổi điểm.", // DRAFT — Kevin reviews
  "cix.360.state.verified": "Đã xác minh số điện thoại", // DRAFT — Kevin reviews
  "cix.360.state.unverified": "Chưa xác minh số điện thoại", // DRAFT — Kevin reviews
  "cix.360.state.possible_duplicate": "Có thể trùng hồ sơ", // DRAFT — Kevin reviews
  "cix.360.mem.active": "Đang hoạt động", // DRAFT — Kevin reviews
  "cix.360.mem.paused": "Tạm dừng", // DRAFT — Kevin reviews
  "cix.360.mem.canceled": "Đã hủy", // DRAFT — Kevin reviews
  "cix.360.mem.cancelled": "Đã hủy", // DRAFT — Kevin reviews
  "cix.360.mem.expired": "Hết hạn", // DRAFT — Kevin reviews
  "cix.360.sug.rebook_review": "Xem xét đặt lịch lại", // DRAFT — Kevin reviews
  "cix.360.sug.verify_phone": "Xác minh số điện thoại", // DRAFT — Kevin reviews
  "cix.360.sug.add_contact": "Thêm số điện thoại hoặc email", // DRAFT — Kevin reviews
  "cix.360.sug.review_duplicate": "Xem xét hồ sơ có thể trùng", // DRAFT — Kevin reviews
  "cix.360.sug.retention_at_risk": "Có nguy cơ rời bỏ trong Giữ chân khách", // DRAFT — Kevin reviews
  "cix.360.ev.kv": "{k}: {v}", // DRAFT — Kevin reviews
  "cix.360.ev.group": "Nhóm hồ sơ trùng đang mở", // DRAFT — Kevin reviews
  "cix.360.ev.last_visit": "Lần ghé gần nhất", // DRAFT — Kevin reviews
  "cix.360.ev.usual_interval_days": "Chu kỳ thường lệ (ngày)", // DRAFT — Kevin reviews
  "cix.360.ev.days_since_last": "Số ngày từ lần ghé gần nhất", // DRAFT — Kevin reviews
  "cix.360.ev.days_away": "Số ngày vắng", // DRAFT — Kevin reviews
  "cix.360.ev.reason": "Lý do", // DRAFT — Kevin reviews
  "cix.360.ev.no_future_booking": "Chưa có lịch hẹn sắp tới", // DRAFT — Kevin reviews
  "cix.360.ev.phone_on_file": "Đã có số điện thoại", // DRAFT — Kevin reviews
  "cix.360.ev.not_verified": "Chưa xác minh", // DRAFT — Kevin reviews
  "cix.360.ev.no_phone": "Không có số điện thoại", // DRAFT — Kevin reviews
  "cix.360.ev.no_email": "Không có email", // DRAFT — Kevin reviews
  "cix.360.ev.customer_retention": "Giữ chân khách", // DRAFT — Kevin reviews
  "cix.360.evv.at_risk": "Có nguy cơ", // DRAFT — Kevin reviews
  "cix.360.evv.phone": "Trùng số điện thoại", // DRAFT — Kevin reviews
  "cix.360.evv.email": "Trùng email", // DRAFT — Kevin reviews
  "cix.360.evv.name": "Trùng tên", // DRAFT — Kevin reviews
};
