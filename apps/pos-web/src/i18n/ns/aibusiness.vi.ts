// aibusiness.vi.ts — AI Business Reports + Alerts (Nov 3 2026) in Vietnamese. Glossary: Thợ · hóa đơn · hàng chờ · thẻ quà tặng · Hội viên.
// Pending a native-speaker review (docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md).
export const AIBUSINESS_VI: Record<string, string> = {
  "bzx.refresh": "Làm mới",
  "bzx.search": "Tìm",
  "bzx.clear": "Xóa bộ lọc",
  "bzx.rows": "Số dòng",
  "bzx.close": "Đóng",
  "bzx.cancel": "Hủy",
  "bzx.loading": "Đang tải…",
  "bzx.sort": "Sắp xếp",
  "bzx.matching": "{n} kết quả",
  "bzx.noMatch": "Không có gì khớp tìm kiếm hoặc bộ lọc.",
  "bzx.loadFailed": "Không tải được. Hãy thử lại hoặc chạy kiểm tra hệ thống — đây không phải là \"không có gì\".",
  "bzx.err.forbidden": "Vai trò của bạn không dùng được AI Kinh doanh.",
  "bzx.check.reports": "Kiểm tra hệ thống Báo cáo AI",
  "bzx.check.alerts": "Kiểm tra hệ thống Cảnh báo AI",
  "bzx.cond": "{m} {op} {v}",
  "bzx.op.lt": "xuống dưới",
  "bzx.op.gt": "lên trên",
  "bzx.r.title": "Báo cáo kinh doanh AI",
  "bzx.r.sub": "Tạo báo cáo có cấu trúc từ dữ liệu bạn được phép xem — số liệu khớp với các báo cáo của bạn.",
  "bzx.r.kpi.total": "Lịch sử báo cáo",
  "bzx.r.kpi.processing": "Đang tạo",
  "bzx.r.kpi.stuck": "{n} kẹt hơn 10 phút",
  "bzx.r.kpi.failed": "Lỗi",
  "bzx.r.kpi.viewable": "Xem được",
  "bzx.r.kpi.expired": "Hết hạn nội dung",
  "bzx.r.kpi.expiredSub": "Nội dung hiển thị trong {n} ngày",
  "bzx.r.generate": "Tạo báo cáo",
  "bzx.r.history": "Lịch sử báo cáo",
  "bzx.r.searchPh": "Loại báo cáo, kỳ, mã hoặc người tạo",
  "bzx.r.type": "Loại báo cáo",
  "bzx.r.allTypes": "Mọi báo cáo",
  "bzx.r.status": "Trạng thái",
  "bzx.r.generatedFilter": "Lọc theo lúc tạo báo cáo (không phải các ngày báo cáo bao gồm):",
  "bzx.r.none": "Chưa có báo cáo — hãy tạo ở trên.",
  "bzx.r.col.report": "Báo cáo",
  "bzx.r.col.generated": "Đã tạo",
  "bzx.r.col.status": "Trạng thái",
  "bzx.r.col.actions": "Thao tác",
  "bzx.r.view": "Xem",
  "bzx.r.genNote": "Chọn các ngày báo cáo bao gồm. Báo cáo được tạo ngay từ báo cáo gốc và lưu số liệu của các ngày đó.",
  "bzx.r.generateNow": "Tạo",
  "bzx.r.generating": "Đang tạo…",
  "bzx.r.covers": "Bao gồm {d} (giờ tiệm, {tz})",
  "bzx.r.noPeriod": "Kỳ: {p} (tạo trước khi báo cáo ghi ngày chính xác)",
  "bzx.r.partial": "Kỳ này còn đang diễn ra khi tạo.",
  "bzx.r.expiredNote": "Đã tạo xong. Nội dung chỉ hiển thị 7 ngày và đã quá hạn — hãy tạo lại để có số liệu hiện tại.",
  "bzx.r.fullData": "Dữ liệu đầy đủ ({s})",
  "bzx.r.verify": "Kiểm tra số liệu",
  "bzx.r.verifying": "Đang đối chiếu với Báo cáo doanh thu…",
  "bzx.r.regenerate": "Tạo lại với dữ liệu hiện tại",
  "bzx.r.metric": "Số liệu",
  "bzx.r.inReport": "Trong báo cáo",
  "bzx.r.now": "Báo cáo doanh thu hiện tại",
  "bzx.r.diff": "Chênh lệch",
  "bzx.r.openSales": "Mở Báo cáo doanh thu",
  "bzx.r.matchNote": "Số liệu lấy từ cùng cách tính của Báo cáo doanh thu; tạo lại sẽ tạo báo cáo mới và giữ nguyên báo cáo này.",
  "bzx.a.title": "Cảnh báo kinh doanh AI",
  "bzx.a.sub": "Theo dõi một chỉ số và biết khi nó vượt ngưỡng — có số mẫu tối thiểu để vài hóa đơn không làm kích hoạt cảnh báo.",
  "bzx.a.kpi.active": "Quy tắc đang bật",
  "bzx.a.kpi.paused": "{n} tạm dừng",
  "bzx.a.kpi.triggered": "Đã kích hoạt, chưa xác nhận",
  "bzx.a.kpi.review": "Cần xem lại (mẫu quá nhỏ)",
  "bzx.a.kpi.never": "Chưa từng đánh giá",
  "bzx.a.kpi.last": "Lần đánh giá gần nhất",
  "bzx.a.never": "Chưa đánh giá",
  "bzx.a.manualNote": "Tự động đánh giá đang tắt trên máy chủ này: quy tắc được đánh giá khi có người bấm \"Đánh giá ngay\".",
  "bzx.a.new": "Cảnh báo mới",
  "bzx.a.name": "Tên cảnh báo",
  "bzx.a.metric": "Chỉ số",
  "bzx.a.comparison": "So sánh",
  "bzx.a.amount.cents": "Số tiền ($)",
  "bzx.a.amount.count": "Số lượng",
  "bzx.a.amount.percent": "Phần trăm",
  "bzx.a.period": "Kỳ đánh giá",
  "bzx.a.minSample": "Số mẫu tối thiểu",
  "bzx.a.create": "Tạo cảnh báo",
  "bzx.a.created": "Đã tạo cảnh báo.",
  "bzx.a.formInvalid": "Nhập tên và số từ 0 trở lên.",
  "bzx.a.sampleInvalid": "Số mẫu tối thiểu phải từ 1 trở lên.",
  "bzx.a.rules": "Quy tắc cảnh báo",
  "bzx.a.searchPh": "Tên cảnh báo, chỉ số hoặc người tạo",
  "bzx.a.status": "Trạng thái",
  "bzx.a.allMetrics": "Mọi chỉ số",
  "bzx.a.none": "Chưa có cảnh báo — hãy tạo ở trên.",
  "bzx.a.col.alert": "Cảnh báo",
  "bzx.a.col.condition": "Điều kiện",
  "bzx.a.col.period": "Kỳ",
  "bzx.a.col.status": "Trạng thái",
  "bzx.a.col.actions": "Thao tác",
  "bzx.a.col.when": "Đánh giá lúc",
  "bzx.a.col.result": "Giá trị so với ngưỡng",
  "bzx.a.col.days": "Ngày",
  "bzx.a.col.state": "Thay đổi",
  "bzx.a.minSampleN": "số mẫu tối thiểu {n}",
  "bzx.a.active": "Đang bật",
  "bzx.a.pausedOne": "Tạm dừng",
  "bzx.a.unack": "chưa xác nhận",
  "bzx.a.evaluate": "Đánh giá ngay",
  "bzx.a.pause": "Tạm dừng",
  "bzx.a.resume": "Tiếp tục",
  "bzx.a.delete": "Xóa",
  "bzx.a.deleteTitle": "Xóa \"{t}\"?",
  "bzx.a.deleteNote": "Quy tắc và lịch sử đánh giá sẽ bị xóa. Không thể hoàn tác.",
  "bzx.a.deleted": "Đã xóa \"{t}\".",
  "bzx.a.valueVs": "{v} so với {t}",
  "bzx.a.sample": "mẫu {n}",
  "bzx.a.sampleOf": "mẫu {n} (tối thiểu {m})",
  "bzx.a.history": "Lịch sử đánh giá",
  "bzx.a.hSearchPh": "Tên cảnh báo hoặc chỉ số",
  "bzx.a.state": "Thay đổi",
  "bzx.a.noHistory": "Chưa có lần đánh giá nào.",
  "bzx.a.ack": "Xác nhận",
  "bzx.a.ackTitle": "Xác nhận \"{t}\"",
  "bzx.a.ackNote": "Ghi chú (không bắt buộc)",
  "bzx.a.ackBy": "Đã xác nhận bởi {who} · {at}",
  "bzx.a.explain": "Giải thích",
  "bzx.a.explainTitle": "Số liệu cho thấy gì",
  "bzx.a.valueWas": "giá trị là {v}",
  "bzx.a.openSource": "Mở báo cáo gốc",
  "bzx.a.notProof": "Thay đổi đo được, không phải bằng chứng nguyên nhân. Không thay đổi gì từ đây — giá, lịch và chiến dịch vẫn ở màn hình riêng.",
  "bzx.x.current": "Kỳ này",
  "bzx.x.previous": "Kỳ trước tương ứng",
  "bzx.x.netChange": "Thay đổi doanh thu thuần",
  "bzx.x.totalBookings": "Lượt đặt",
  "bzx.x.completed": "Đã làm xong",
  "bzx.x.cancelled": "Đã hủy",
  "bzx.x.noShow": "Không đến",
  "bzx.x.cancelledPercent": "Tỷ lệ hủy",
  "bzx.x.noShowPercent": "Tỷ lệ không đến",
  "bzx.an.title": "Kiểm tra ngày bất thường",
  "bzx.an.sub": "So sánh hôm qua (một ngày làm việc trọn vẹn) với cùng thứ trong 8 tuần trước, từ Báo cáo doanh thu. Chỉ đọc.",
  "bzx.an.run": "Kiểm tra hôm qua",
  "bzx.an.metric": "{day}",
  "bzx.an.actual": "Thực tế",
  "bzx.an.baseline": "Thường lệ (trung vị)",
  "bzx.an.result": "Kết quả",
  "bzx.an.note": "Gợi ý để xem xét, không phải nguyên nhân đã chứng minh. Ngày lễ, ngày nghỉ và ngày làm ngắn được tính như ngày thường trong mức chuẩn.",
  "bzx.type.daily_brief": "Tóm tắt ngày",
  "bzx.type.weekly_summary": "Tổng kết tuần",
  "bzx.type.monthly_review": "Đánh giá tháng",
  "bzx.type.branch_comparison": "So sánh chi nhánh",
  "bzx.period.today": "Hôm nay",
  "bzx.period.yesterday": "Hôm qua",
  "bzx.period.week": "Tuần này",
  "bzx.period.month": "Tháng này",
  "bzx.period.quarter": "Quý này",
  "bzx.period.year": "Năm nay",
  "bzx.period.last7": "7 ngày qua",
  "bzx.period.last30": "30 ngày qua",
  "bzx.period.last_month": "Tháng trước",
  "bzx.preset.all": "Mọi ngày",
  "bzx.preset.today": "Hôm nay",
  "bzx.preset.yesterday": "Hôm qua",
  "bzx.preset.week": "Tuần này",
  "bzx.preset.last_7": "7 ngày qua",
  "bzx.preset.month": "Tháng này",
  "bzx.preset.last_30": "30 ngày qua",
  "bzx.preset.last_month": "Tháng trước",
  "bzx.preset.year": "Năm nay",
  "bzx.preset.custom": "Tùy chọn",
  "bzx.rs.all": "Mọi trạng thái",
  "bzx.rs.viewable": "Xem được",
  "bzx.rs.content_expired": "Hết hạn nội dung",
  "bzx.rs.queued": "Đang chờ",
  "bzx.rs.running": "Đang tạo",
  "bzx.rs.completed": "Hoàn tất",
  "bzx.rs.failed": "Lỗi",
  "bzx.avail.viewable": "Có nội dung",
  "bzx.avail.content_expired": "Nội dung không còn hiển thị (hạn 7 ngày) — hãy tạo lại",
  "bzx.avail.not_ready": "Chưa sẵn sàng",
  "bzx.avail.failed": "Tạo thất bại",
  "bzx.sort.newest": "Mới nhất trước",
  "bzx.sort.oldest": "Cũ nhất trước",
  "bzx.m.net_sales": "Doanh thu thuần",
  "bzx.m.paid_tickets": "Hóa đơn đã thanh toán",
  "bzx.m.average_ticket": "Trung bình mỗi hóa đơn",
  "bzx.m.refunds": "Hoàn tiền",
  "bzx.m.completed_appointments": "Lịch hẹn đã làm xong",
  "bzx.m.bookings": "Lượt đặt",
  "bzx.m.new_customers": "Khách mới",
  "bzx.m.branches": "Chi nhánh so sánh",
  "bzx.vm.netSalesCents": "Doanh thu thuần",
  "bzx.vm.grossSalesCents": "Doanh thu gộp",
  "bzx.vm.ticketsCount": "Hóa đơn đã thanh toán",
  "bzx.vm.averageTicketCents": "Trung bình mỗi hóa đơn",
  "bzx.vm.refundsCents": "Hoàn tiền",
  "bzx.vm.discountsCents": "Giảm giá",
  "bzx.vs.matched": "Khớp — báo cáo trùng với Báo cáo doanh thu cho cùng các ngày.",
  "bzx.vs.changed": "Đã thay đổi kể từ khi tạo báo cáo.",
  "bzx.vs.cannot_verify": "Không kiểm tra được báo cáo này.",
  "bzx.vr.period_was_in_progress": "kỳ còn đang diễn ra nên có thêm doanh thu sau đó",
  "bzx.vr.source_changed_since": "có giao dịch, hoàn tiền hoặc hủy cho các ngày đó được ghi sau báo cáo",
  "bzx.vr.not_completed": "báo cáo chưa hoàn tất",
  "bzx.vr.no_period": "được tạo trước khi báo cáo ghi ngày chính xác — hãy tạo lại",
  "bzx.vr.no_snapshot": "được tạo bởi vai trò không xem được số tiền",
  "bzx.vr.no_permission": "vai trò của bạn không xem được số liệu Báo cáo doanh thu",
  "bzx.metric.net_sales": "Doanh thu thuần",
  "bzx.metric.average_ticket": "Trung bình mỗi hóa đơn",
  "bzx.metric.completed_appointments": "Lịch hẹn đã làm xong",
  "bzx.metric.cancellation_rate": "Tỷ lệ hủy",
  "bzx.metric.no_show_rate": "Tỷ lệ không đến",
  "bzx.metric.customer_retention": "Giữ chân khách",
  "bzx.rst.all": "Mọi quy tắc",
  "bzx.rst.active": "Đang bật",
  "bzx.rst.paused": "Tạm dừng",
  "bzx.rst.triggered": "Đã kích hoạt, chưa xác nhận",
  "bzx.rst.needs_review": "Cần xem lại",
  "bzx.rst.never_evaluated": "Chưa từng đánh giá",
  "bzx.est.all": "Mọi kết quả",
  "bzx.est.triggered": "Đã kích hoạt",
  "bzx.est.unacknowledged": "Đã kích hoạt, chưa xác nhận",
  "bzx.est.recovered": "Đã trở lại bình thường",
  "bzx.est.unchanged": "Không đổi",
  "bzx.est.not_evaluated": "Không đánh giá (mẫu quá nhỏ)",
  "bzx.es.triggered": "Đã kích hoạt",
  "bzx.es.recovered": "Đã trở lại bình thường",
  "bzx.es.unchanged": "Không đổi",
  "bzx.es.not_evaluated": "Không đánh giá — mẫu quá nhỏ",
  "bzx.an.st.normal": "Trong mức thường lệ ({n} ngày so sánh)",
  "bzx.an.st.unusually_low": "Thấp bất thường ({n} ngày so sánh)",
  "bzx.an.st.unusually_high": "Cao bất thường ({n} ngày so sánh)",
  "bzx.an.st.insufficient_history": "Chưa đủ dữ liệu: {n} ngày so sánh có doanh thu (cần 4)",
  "bzx.health.PASSED": "Đạt",
  "bzx.health.WARNING": "Cảnh báo",
  "bzx.health.FAILED": "Lỗi",
  "bzx.health.INSUFFICIENT_DATA": "Chưa đủ dữ liệu",
  "bzx.health.UNAVAILABLE": "Chưa có",
  "bzx.health.running": "Đang kiểm tra…",
  "bzx.health.overall": "Tổng thể: {s} · {at}",
  "bzx.health.recent": "(kết quả kiểm tra trong 30 giây qua)",
  "bzx.health.readOnly": "Chỉ đọc: việc kiểm tra không thay đổi giao dịch, báo cáo, quy tắc hay lịch và không gửi gì.",
  "bzx.health.retry": "Kiểm tra lại",
  "bzx.health.part": "Bộ phận: {c}",
  "bzx.health.lastPassed": "Lần đạt gần nhất: {at}",
  "bzx.health.neverPassed": "Chưa từng đạt",
  "bzx.comp.metrics": "Số liệu báo cáo",
  "bzx.comp.storage": "Lưu báo cáo",
  "bzx.comp.generation": "Tạo báo cáo",
  "bzx.comp.verification": "Đối chiếu",
  "bzx.comp.automation": "Tự động",
  "bzx.comp.rules": "Quy tắc",
  "bzx.comp.evaluation": "Đánh giá",
  "bzx.comp.notifications": "Thông báo",
  "bzx.comp.security": "Bảo mật",
  "bzx.health.k.sales_source": "Báo cáo doanh thu phản hồi",
  "bzx.health.d.sales_source.PASSED": "Đọc được Báo cáo doanh thu gốc của tiệm.",
  "bzx.health.d.sales_source.UNAVAILABLE": "Không đọc được Báo cáo doanh thu (hoặc vai trò không xem được số tiền). Không kiểm tra được báo cáo và cảnh báo tiền.",
  "bzx.health.k.period_matches": "Kỳ đúng các ngày ghi",
  "bzx.health.d.period_matches.PASSED": "\"Hôm nay\" trả đúng số liệu hôm nay — giống khi chọn đúng ngày hôm nay.",
  "bzx.health.d.period_matches.FAILED": "Tên kỳ trả số liệu khác với chính các ngày đó. Hãy báo ngay — báo cáo và cảnh báo sẽ sai.",
  "bzx.health.k.appointments_source": "Số liệu lịch hẹn phản hồi",
  "bzx.health.d.appointments_source.PASSED": "Đọc được số liệu lịch hẹn.",
  "bzx.health.d.appointments_source.UNAVAILABLE": "Không đọc được số liệu lịch hẹn với vai trò của bạn.",
  "bzx.health.k.reports_readable": "Đọc được lịch sử báo cáo",
  "bzx.health.d.reports_readable.PASSED": "Liệt kê được mọi báo cáo của tiệm.",
  "bzx.health.k.no_stuck_reports": "Không có báo cáo bị kẹt",
  "bzx.health.d.no_stuck_reports.PASSED": "Không có báo cáo nào chờ hoặc đang tạo quá 10 phút.",
  "bzx.health.d.no_stuck_reports.FAILED": "Có báo cáo chờ hoặc đang tạo quá 10 phút. Hãy tạo lại.",
  "bzx.health.k.recent_failures": "Không có lỗi gần đây",
  "bzx.health.d.recent_failures.PASSED": "Không có báo cáo lỗi trong 7 ngày qua.",
  "bzx.health.d.recent_failures.WARNING": "Có báo cáo lỗi trong 7 ngày qua. Mở ra để xem lý do rồi tạo lại.",
  "bzx.health.k.content_window": "Hạn nội dung",
  "bzx.health.d.content_window.PASSED": "Mọi báo cáo hoàn tất vẫn xem được.",
  "bzx.health.d.content_window.WARNING": "Một số báo cáo đã quá hạn nội dung 7 ngày. Chúng đã hoàn tất — hãy tạo lại để có số liệu hiện tại.",
  "bzx.health.k.reports_record_period": "Báo cáo ghi ngày",
  "bzx.health.d.reports_record_period.PASSED": "Mọi báo cáo xem được đều ghi đúng các ngày nên kiểm tra được số liệu.",
  "bzx.health.d.reports_record_period.WARNING": "Một số báo cáo được tạo trước khi ghi ngày nên không kiểm tra được. Hãy tạo lại.",
  "bzx.health.k.scheduled_reports": "Báo cáo tự động",
  "bzx.health.d.scheduled_reports.UNAVAILABLE": "Chưa cài đặt báo cáo tự động theo lịch — báo cáo được tạo khi có người bấm nút.",
  "bzx.health.k.rules_readable": "Đọc được quy tắc",
  "bzx.health.d.rules_readable.PASSED": "Đọc được các quy tắc đang bật của tiệm.",
  "bzx.health.d.rules_readable.INSUFFICIENT_DATA": "Chưa có quy tắc nào đang bật.",
  "bzx.health.k.rules_evaluated": "Quy tắc được đánh giá gần đây",
  "bzx.health.d.rules_evaluated.PASSED": "Mọi quy tắc đang bật đều được đánh giá trong ngày qua.",
  "bzx.health.d.rules_evaluated.WARNING": "Một số quy tắc chưa được đánh giá trong ngày qua (hoặc chưa bao giờ). Hãy bấm \"Đánh giá ngay\".",
  "bzx.health.k.automatic_evaluation": "Đánh giá tự động",
  "bzx.health.d.automatic_evaluation.UNAVAILABLE": "Đánh giá tự động đang tắt trên máy chủ này (AI_BUSINESS_ALERTS_SCHEDULE=off).",
  "bzx.health.d.automatic_evaluation.PASSED": "Mọi quy tắc đang bật đều được đánh giá đúng lịch.",
  "bzx.health.d.automatic_evaluation.WARNING": "Một số quy tắc đang bật bị trễ lịch — bộ đánh giá nền có thể không chạy.",
  "bzx.health.k.sample_guard": "Đã đặt số mẫu tối thiểu",
  "bzx.health.d.sample_guard.PASSED": "Mọi quy tắc đang bật cần ít nhất một giao dịch hoặc lượt đặt mới kích hoạt.",
  "bzx.health.d.sample_guard.WARNING": "Một số quy tắc không có số mẫu tối thiểu nên ngày gần như trống cũng kích hoạt.",
  "bzx.health.k.delivery_channels": "Kênh gửi",
  "bzx.health.d.delivery_channels.PASSED": "Không có email hay SMS cảnh báo nào gửi lỗi trong 7 ngày qua.",
  "bzx.health.d.delivery_channels.WARNING": "Một số email hoặc tin nhắn cảnh báo gửi lỗi trong 7 ngày qua — mở sự cố để xem lý do.",
  "bzx.health.k.tenant_isolation": "Chỉ dữ liệu của tiệm này",
  "bzx.health.d.tenant_isolation.PASSED": "Mọi bản ghi đều thuộc tiệm này.",
  "bzx.health.d.tenant_isolation.FAILED": "Có bản ghi trỏ tới tiệm khác. Hãy báo ngay.",
  "bzx.health.k.no_side_effects": "Kiểm tra không thay đổi gì",
  "bzx.health.d.no_side_effects.PASSED": "Việc kiểm tra không thay đổi giao dịch, báo cáo, quy tắc hay lịch và không gửi gì.",
  "bzx.est.failed": "Thất bại (không đọc được số liệu)",
  "bzx.es.failed": "Thất bại — không đọc được số liệu",
  "bzx.a.kpi.failed": "Lần đánh giá thất bại",
  "bzx.a.edit": "Sửa",
  // A2 incidents + notifications (Nov 6 2026)
  "bzx.i.title": "Sự cố",
  "bzx.i.status": "Trạng thái sự cố",
  "bzx.i.none": "Không có sự cố.",
  "bzx.i.open": "Mở",
  "bzx.i.st.active": "Cần xử lý",
  "bzx.i.st.open": "Mới",
  "bzx.i.st.investigating": "Đang xem xét",
  "bzx.i.st.snoozed": "Tạm hoãn",
  "bzx.i.st.resolved": "Đã xử lý",
  "bzx.i.st.all": "Tất cả sự cố",
  "bzx.i.col.alert": "Cảnh báo",
  "bzx.i.col.value": "Giá trị",
  "bzx.i.col.status": "Trạng thái",
  "bzx.i.col.assignee": "Giao cho",
  "bzx.i.col.when": "Thời gian",
  "bzx.i.col.channel": "Kênh",
  "bzx.i.col.to": "Gửi đến",
  "bzx.i.col.result": "Kết quả",
  "bzx.i.sev.info": "Thông tin",
  "bzx.i.sev.warning": "Cảnh báo",
  "bzx.i.sev.critical": "Nghiêm trọng",
  "bzx.i.until": "đến {t}",
  "bzx.i.note": "Ghi chú",
  "bzx.i.investigate": "Xem xét",
  "bzx.i.resolve": "Đánh dấu đã xử lý (kèm ghi chú)",
  "bzx.i.reopen": "Mở lại",
  "bzx.i.addNote": "Thêm ghi chú",
  "bzx.i.snoozeFor": "Tạm hoãn trong",
  "bzx.i.snooze": "Tạm hoãn",
  "bzx.i.hours": "{n} giờ",
  "bzx.i.minutes": "{n} phút",
  "bzx.i.assignTo": "Giao cho",
  "bzx.i.nobody": "Không ai",
  "bzx.i.assign": "Giao",
  "bzx.i.log": "Nhật ký sự cố",
  "bzx.i.deliveries": "Thông báo đã gửi",
  "bzx.i.noDeliveries": "Không có thông báo cho sự cố này.",
  "bzx.i.resolved": "Đã xử lý:",
  "bzx.i.escalation": "nhắc lại",
  "bzx.i.ch.in_app": "Trong ứng dụng",
  "bzx.i.ch.email": "Email",
  "bzx.i.ch.sms": "SMS",
  "bzx.i.ds.sent": "Đã gửi",
  "bzx.i.ds.skipped": "Chưa gửi",
  "bzx.i.ds.failed": "Lỗi",
  "bzx.i.why.cooldown": "Trong thời gian chờ",
  "bzx.i.why.quiet_hours": "Giờ yên lặng",
  "bzx.i.why.no_email": "Chưa có email",
  "bzx.i.why.no_phone": "Chưa có số di động",
  "bzx.i.why.no_recipients": "Không có người nhận",
  "bzx.i.why.messaging_not_available": "Chưa cài đặt nhắn tin",
  "bzx.d.open": "Thông báo",
  "bzx.d.title": "Thông báo — {t}",
  "bzx.d.severity": "Mức độ",
  "bzx.d.quietFrom": "Giờ yên lặng từ",
  "bzx.d.quietTo": "Giờ yên lặng đến",
  "bzx.d.cooldown": "Thời gian chờ",
  "bzx.d.noCooldown": "Không chờ",
  "bzx.d.channels": "Gửi qua",
  "bzx.d.recipients": "Người nhận email / SMS",
  "bzx.d.recipientsHint": "Không chọn ai = chủ tiệm và quản lý.",
  "bzx.d.noEmail": "chưa có email",
  "bzx.d.noPhone": "chưa có số di động",
  "bzx.d.note": "Thông báo trong ứng dụng luôn vào mục Cảnh báo của Owner app. Email và SMS chờ hết giờ yên lặng (giờ của tiệm). Sự cố nghiêm trọng còn mở sau 30 phút sẽ được gửi lại một lần cho chủ tiệm.",
  "bzx.d.needChannel": "Chọn ít nhất một cách gửi.",
  "bzx.d.saved": "Đã lưu thông báo cho “{t}”.",
  // A3 branch scorecard / advisor / explanation / data check (Nov 6 2026)
  "bzx.check.branches": "Kiểm tra dữ liệu chi nhánh",
  "bzx.comp.branches": "Chi nhánh",
  "bzx.comp.time_clock": "Chấm công",
  "bzx.health.k.branch_time_zones": "Múi giờ chi nhánh",
  "bzx.health.d.branch_time_zones.PASSED": "Mọi chi nhánh đang hoạt động đều có múi giờ.",
  "bzx.health.d.branch_time_zones.WARNING": "Một số chi nhánh chưa có múi giờ — ngày của chi nhánh được tính theo giờ New York.",
  "bzx.health.k.opening_hours": "Giờ mở cửa",
  "bzx.health.d.opening_hours.PASSED": "Mọi chi nhánh đang hoạt động đều có giờ mở cửa.",
  "bzx.health.d.opening_hours.WARNING": "Một số chi nhánh chưa có giờ mở cửa nên không so sánh được doanh thu theo giờ mở cửa.",
  "bzx.health.k.open_shifts": "Ca chưa chấm công ra",
  "bzx.health.d.open_shifts.PASSED": "Không có ca nào mở quá 16 giờ.",
  "bzx.health.d.open_shifts.WARNING": "Một số ca đã mở quá 16 giờ — giờ làm của Thợ được tính tối đa 12 giờ cho đến khi có người chấm công ra.",
  "bzx.health.k.inactive_branch_sales": "Doanh thu ở chi nhánh ngưng hoạt động",
  "bzx.health.d.inactive_branch_sales.PASSED": "Không có chi nhánh ngưng hoạt động nào có doanh thu trong 7 ngày qua.",
  "bzx.health.d.inactive_branch_sales.WARNING": "Một chi nhánh ngưng hoạt động có doanh thu trong 7 ngày qua — chi nhánh này bị ẩn khỏi bảng so sánh trừ khi bạn chọn hiện chi nhánh ngưng hoạt động.",
  "bcx.s.title": "Bảng điểm công bằng",
  "bcx.s.sub": "Theo giờ làm của Thợ, theo giờ mở cửa và khách quay lại — thứ hạng (#) công bằng với chi nhánh nhỏ.",
  "bcx.s.techHours": "Giờ làm của Thợ",
  "bcx.s.perTechHour": "Doanh thu thuần / giờ Thợ",
  "bcx.s.openHours": "Giờ mở cửa",
  "bcx.s.perOpenHour": "Doanh thu thuần / giờ mở cửa",
  "bcx.s.returning": "Khách quay lại",
  "bcx.s.hours": "{n} giờ",
  "bcx.s.note1": "Thứ hạng dùng số liệu theo giờ và theo khách, nên chi nhánh nhỏ hoặc mở ít giờ hơn không bị xếp thấp vì quy mô.",
  "bcx.s.note2": "Giờ làm của Thợ là giờ chấm công; giờ mở cửa lấy từ giờ mở cửa của từng chi nhánh.",
  "bcx.s.note3": "Vai trò của bạn không xem được doanh thu: số liệu doanh thu theo giờ bị ẩn.",
  "bcx.a.title": "Gợi ý tăng trưởng",
  "bcx.a.none": "Không có điểm nào nổi bật giữa các chi nhánh trong khoảng thời gian này.",
  "bcx.a.go": "Mở",
  "bcx.a.k.low_yield_per_tech_hour": "Giờ làm của Thợ",
  "bcx.a.k.high_no_shows": "Khách không đến",
  "bcx.a.k.low_return_rate": "Khách quay lại",
  "bcx.a.k.no_opening_hours": "Giờ mở cửa",
  "bcx.a.m.low_yield_per_tech_hour": "{b} đạt {v} mỗi giờ làm của Thợ, thấp hơn mức trung vị của tiệm là {m}. Hãy so sánh lịch làm với lượng đặt hẹn — có thể số giờ có Thợ nhiều hơn nhu cầu.",
  "bcx.a.m.high_no_shows": "{b} có {v}% khách không đến, so với mức trung vị {m}% của tiệm. Nhắc hẹn và gọi xác nhận trước một ngày thường là bước đầu tiên.",
  "bcx.a.m.low_return_rate": "{v}% khách của {b} trong kỳ này là khách cũ, so với {m}% ở các chi nhánh. Một chiến dịch mời khách quay lại có thể giúp ích.",
  "bcx.a.m.no_opening_hours": "{b} chưa có giờ mở cửa nên không so sánh được doanh thu theo giờ mở cửa. Hãy cài giờ trong mục Chi nhánh.",
  "bcx.e.open": "Giải thích chênh lệch",
  "bcx.e.title": "Giải thích chênh lệch giữa hai chi nhánh",
  "bcx.e.a": "Chi nhánh",
  "bcx.e.b": "So với",
  "bcx.e.run": "Giải thích",
  "bcx.e.hint": "Chọn hai chi nhánh. Kết quả được đo từ số liệu — không đoán nguyên nhân.",
  "bcx.e.l.more": "{a} thu nhiều hơn {b} {v}.",
  "bcx.e.l.less": "{a} thu ít hơn {b} {v}.",
  "bcx.e.l.volumeMore": "{v} trong số đó đến từ {n} hóa đơn thanh toán nhiều hơn ({x} so với {y}) theo giá trị trung bình của {b}.",
  "bcx.e.l.volumeFewer": "{v} trong số đó đến từ {n} hóa đơn thanh toán ít hơn ({x} so với {y}) theo giá trị trung bình của {b}.",
  "bcx.e.l.price": "{v} đến từ giá trị hóa đơn trung bình ({x} so với {y}).",
  "bcx.e.l.hidden": "Vai trò của bạn không xem được doanh thu, nên chỉ so sánh lịch hẹn, giờ làm và khách.",
  "bcx.e.l.completion": "Lịch hẹn hoàn thành: {x}% so với {y}%.",
  "bcx.e.l.noShow": "Khách không đến: {x}% so với {y}%.",
  "bcx.e.l.hours": "Giờ làm của Thợ: {x} so với {y}.",
  "bcx.e.l.returning": "Khách quay lại: {x}% so với {y}%.",
  "bcx.e.l.notCause": "Đây là chênh lệch đo được, không phải nguyên nhân — mở Báo cáo doanh thu của từng chi nhánh để xem kỹ hơn.",
  "bzx.period.custom": "Chọn ngày",
  "aib.customSnapshot": "Các số liệu chính ở trên theo các khoảng thời gian có sẵn; câu trả lời bên dưới dùng các ngày bạn đã chọn.",
  "aib.chip.profit": "Lợi nhuận sau chi phí",
  "aib.chip.growth": "Làm sao để phát triển?",
  "aib.rec.title": "Kết quả tìm",
  "aib.rec.how": "Gõ “tìm” và tên, số điện thoại hoặc “hóa đơn 1042”.",
  "aib.rec.none": "Không tìm thấy gì trong tiệm này.",
  "aib.rec.ticket": "Hóa đơn {n}",
  "aib.rec.hidden": "Một số dữ liệu bị ẩn theo vai trò của bạn.",
  "aib.rec.private": "Tên và số điện thoại của khách chỉ được tra cứu tại đây — không bao giờ gửi cho AI.",
  "aib.p.expenses": "Chi phí đã duyệt",
  "aib.p.result": "Kết quả kinh doanh",
  "aib.p.margin": "Tỷ suất",
  "aib.p.pending": "{n} khoản chi {v} còn chờ duyệt và chưa được tính.",
  "aib.p.note": "Chi phí là các khoản đã duyệt có ngày trong khoảng thời gian này. Doanh thu thuần không gồm tiền tip và thuế.",
  "aib.g.title": "Gợi ý phát triển",
  "aib.g.none": "Không có điểm nào nổi bật trong khoảng thời gian này.",
  "aib.g.no_shows": "{noShowPercent}% trong {bookings} lịch hẹn là khách không đến. Tin nhắn nhắc hẹn và cuộc gọi xác nhận trước một ngày thường giúp giảm tình trạng này.",
  "aib.g.cancellations": "{cancelledPercent}% lịch hẹn bị hủy. Hãy mời khách trong danh sách chờ vào các giờ trống để không mất thời gian.",
  "aib.g.retention": "Chỉ {retentionRatePercent}% khách quay lại. Bước tiếp theo thường là chiến dịch mời lại khách chưa đến trong 60 ngày.",
  "aib.g.new_customers": "Khách mới giảm {abs}% ({newCustomers} trong kỳ này). Phần thưởng giới thiệu sẽ mang bạn bè của khách quen đến tiệm.",
  "aib.g.retail": "Không có hóa đơn nào trong {ticketsCount} hóa đơn đã thanh toán có sản phẩm. Gợi ý khi thanh toán có thể giới thiệu sản phẩm chăm sóc đúng lúc.",
  "aib.h.title": "Lịch sử câu hỏi của bạn",
  "aib.h.search": "Tìm trong câu hỏi và câu trả lời",
  "aib.h.csv": "Tải CSV",
  "aib.h.none": "Chưa có câu hỏi nào.",
  "aib.h.again": "Hỏi lại",
  "aib.h.loadFailed": "Không tải được lịch sử.",
  "aib.h.deleteFailed": "Không xóa được câu hỏi này.",
  "aib.h.note": "Chỉ bạn xem được lịch sử của mình. Câu hỏi được giữ {n} ngày.",
  "aib.h.c.at": "Thời gian hỏi",
  "aib.h.c.question": "Câu hỏi",
  "aib.h.c.topic": "Chủ đề",
  "aib.h.c.period": "Khoảng thời gian",
  "aib.h.c.from": "Từ",
  "aib.h.c.to": "Đến",
  "aib.h.c.by": "Trả lời bởi",
  "aib.h.c.answer": "Câu trả lời",
  "aib.h.topic.daily_summary": "Tóm tắt trong ngày",
  "aib.h.topic.revenue_summary": "Tóm tắt doanh thu",
  "aib.h.topic.explain_revenue": "Vì sao doanh thu thay đổi",
  "aib.h.topic.appointments": "Xu hướng lịch hẹn",
  "aib.h.topic.compare_branches": "So sánh chi nhánh",
  "aib.h.topic.customer_growth": "Tăng trưởng khách",
  "aib.h.topic.technician_performance": "Hiệu suất Thợ",
  "aib.h.topic.find_record": "Tìm dữ liệu",
  "aib.h.topic.profit_expenses": "Lợi nhuận sau chi phí",
  "aib.h.topic.growth_advice": "Gợi ý phát triển",
  "aib.h.topic.none": "Câu hỏi",
  "bzx.check.assistant": "Kiểm tra dữ liệu kinh doanh",
  "bzx.comp.access": "Gói AI",
  "bzx.comp.expenses": "Chi phí",
  "bzx.health.k.ai_package": "Gói AI",
  "bzx.health.d.ai_package.PASSED": "Tiệm này dùng được câu trả lời AI.",
  "bzx.health.d.ai_package.WARNING": "Tiệm này chưa dùng được câu trả lời AI — câu hỏi vẫn hiển thị số liệu.",
  "bzx.health.k.sales_report": "Báo cáo doanh thu",
  "bzx.health.d.sales_report.PASSED": "Số liệu Báo cáo doanh thu hôm nay đọc được.",
  "bzx.health.d.sales_report.FAILED": "Không đọc được số liệu Báo cáo doanh thu — không nên tin câu trả lời cho đến khi sửa xong.",
  "bzx.health.k.zero_tickets": "Hóa đơn thanh toán $0",
  "bzx.health.d.zero_tickets.PASSED": "Không có hóa đơn nào thanh toán $0 trong 30 ngày qua.",
  "bzx.health.d.zero_tickets.WARNING": "Một số hóa đơn trong 30 ngày qua thanh toán $0 — hãy kiểm tra trong Giao dịch; chúng làm giảm giá trị hóa đơn trung bình.",
  "bzx.health.k.expenses_waiting": "Chi phí chờ duyệt",
  "bzx.health.d.expenses_waiting.PASSED": "Không có khoản chi nào chờ duyệt quá 14 ngày.",
  "bzx.health.d.expenses_waiting.WARNING": "Một số khoản chi đã chờ duyệt quá 14 ngày — câu trả lời về lợi nhuận chưa tính các khoản này.",
  "bzx.health.k.history_private": "Lịch sử riêng tư",
  "bzx.health.d.history_private.PASSED": "Mỗi người chỉ xem được câu hỏi của mình.",
  "bzx.a.duplicate": "Nhân bản",
  "bzx.a.viewHistory": "Lịch sử",
  "bzx.a.editTitle": "Sửa cảnh báo — {t}",
  "bzx.a.save": "Lưu",
  "bzx.a.saved": "Đã lưu cảnh báo “{t}”.",
  "bzx.a.duplicated": "Đã tạo bản sao của “{t}” (tạm dừng cho đến khi bạn bật lại).",
  "bzx.a.copyOf": "Bản sao của {t}",
  "bzx.a.oneAlert": "Chỉ hiển thị “{t}”",
  "bzx.a.showAll": "Hiện tất cả cảnh báo",
  "bcx.na": "Không áp dụng",
  "bcx.asOf": "Đọc lúc {at}",
  "bcx.k.net": "Doanh thu thuần (mọi chi nhánh)",
  "bcx.k.avg": "Hóa đơn trung bình",
  "bcx.k.bookings": "Lịch hẹn",
  "bcx.k.completion": "Tỷ lệ hoàn thành",
  "bcx.k.branches": "Số chi nhánh so sánh",
  "bcx.inactiveHidden": "Ẩn {n} chi nhánh ngừng hoạt động",
  "bcx.searchPh": "Tìm tên chi nhánh",
  "bcx.showInactive": "Hiện chi nhánh ngừng hoạt động",
  "bcx.inactive": "Ngừng hoạt động",
  "bcx.d.tickets": "Hóa đơn đã thanh toán",
  "bcx.d.cancelled": "Đã hủy",
  "bcx.d.noShow": "Không đến",
  "bcx.d.note": "Không áp dụng nghĩa là kỳ này không có gì để chia (không có lịch hẹn hoặc hóa đơn) — không phải bằng 0.",
  "aib.tickets": "Hóa đơn đã thanh toán",
  "aib.completed": "Lịch hẹn hoàn thành",
  "aib.snapshotUnavailable": "Không đọc được số liệu kỳ này.",
  "aib.retry": "Thử lại",
  "aib.copy": "Sao chép câu trả lời",
  "aib.copied": "Đã sao chép",
  "aib.rerun": "Chạy lại cho {p}",
  "aib.savedSearch": "Tìm câu hỏi đã lưu",
  "aib.sessionLog": "Câu hỏi trong phiên này ({n}) — cũng được lưu trong lịch sử bên dưới",
  "bcx.k.completed": "Đã hoàn tất",
  "bcx.small": "mẫu nhỏ", // DRAFT — Kevin reviews
  "bcx.smallTip": "Chỉ có {n} lịch hẹn trong kỳ — tỷ lệ là thật nhưng quá ít để so sánh chi nhánh.", // DRAFT — Kevin reviews
  "bcx.defs": "Cách tính các số này", // DRAFT — Kevin reviews
  "bcx.def.net": "Doanh số thuần — các phiếu đã trả trong kỳ của chi nhánh, trước thuế, tip và phụ phí, sau giảm giá (theo Báo cáo doanh số), tính theo ngày của chi nhánh.", // DRAFT — Kevin reviews
  "bcx.def.avg": "Trung bình mỗi phiếu — Doanh số thuần ÷ số phiếu đã trả. Không áp dụng khi không có phiếu.", // DRAFT — Kevin reviews
  "bcx.def.bookings": "Lịch hẹn — các lịch hẹn trong kỳ, mọi trạng thái, mỗi lịch tính một lần.", // DRAFT — Kevin reviews
  "bcx.def.completed": "Hoàn tất — các lịch hẹn được ghi là hoàn tất (lịch đã qua không bị coi là hoàn tất).", // DRAFT — Kevin reviews
  "bcx.def.completion": "Tỷ lệ hoàn tất — Hoàn tất ÷ Lịch hẹn. Không áp dụng khi không có lịch.", // DRAFT — Kevin reviews
  "bcx.def.revCompleted": "Doanh thu / lịch hoàn tất — Doanh số thuần ÷ số lịch hoàn tất. Không áp dụng khi không có lịch hoàn tất.", // DRAFT — Kevin reviews
  "bcx.def.small": "Dưới {n} lịch hẹn được đánh dấu “mẫu nhỏ”: hãy cân nhắc khi so sánh các chi nhánh này.", // DRAFT — Kevin reviews
  "bzx.a.collision": "Đã có cảnh báo đang bật “{t}” theo dõi cùng chỉ số, phép so sánh và kỳ — hai cảnh báo sẽ báo trùng nhau.", // DRAFT — Kevin reviews
  "bzc.periods": "So sánh", // DRAFT — Kevin reviews
  "bzc.vs": "{a} so với {b}", // DRAFT — Kevin reviews
  "bzc.prevOf": "kỳ trước của {p}", // DRAFT — Kevin reviews
  "bzc.partial": "kỳ hiện tại chưa kết thúc", // DRAFT — Kevin reviews
  "bzc.basis": "Cách tính", // DRAFT — Kevin reviews
  "bzc.def.net_sales": "Doanh thu thuần: doanh thu gộp trừ giảm giá, hoàn tiền và hủy; không gồm tiền tip và thuế.", // DRAFT — Kevin reviews
  "bzc.notProfit": "Doanh thu và lợi nhuận", // DRAFT — Kevin reviews
  "bzc.notProfitV": "Đây là so sánh doanh thu (doanh thu thuần), không phải lợi nhuận — lợi nhuận còn trừ chi phí. Hãy hỏi “Lợi nhuận & chi phí” để xem.", // DRAFT — Kevin reviews
  "bzx.a.confirmChange": "Xác nhận thay đổi", // DRAFT — Kevin reviews
  "bzx.a.compareTitle": "Xem lại thay đổi", // DRAFT — Kevin reviews
  "bzx.a.current": "Hiện tại", // DRAFT — Kevin reviews
  "bzx.a.proposed": "Đề xuất", // DRAFT — Kevin reviews
  "bzx.a.unchanged": "Không đổi", // DRAFT — Kevin reviews
  "bzx.a.noChanges": "Không có gì thay đổi — không có gì để lưu.", // DRAFT — Kevin reviews
  "bzx.a.compareNote": "Chưa lưu gì cho đến khi bạn xác nhận. Lần đánh giá tiếp theo dùng giá trị đề xuất.", // DRAFT — Kevin reviews
  "aib.related.title": "Câu hỏi liên quan", // DRAFT — Kevin reviews
  "aib.related.note": "Chỉ xem — mỗi câu hỏi chỉ đọc báo cáo của kỳ đã chọn. Trợ lý không bao giờ gửi tin nhắn, thu tiền hay thay đổi gì.", // DRAFT — Kevin reviews
  "aib.brief.toggle": "Tóm tắt trước", // DRAFT — Kevin reviews
  "aib.brief.expand": "Xem toàn bộ câu trả lời", // DRAFT — Kevin reviews
  "aib.brief.collapse": "Xem bản tóm tắt", // DRAFT — Kevin reviews
  "bcx.cmp.toggle": "So sánh với kỳ trước", // DRAFT — Kevin reviews
  "bcx.cmp.vs": "{d} so với kỳ trước", // DRAFT — Kevin reviews
  "bcx.cmp.pts": "{n} điểm", // DRAFT — Kevin reviews
  "bcx.cmp.basis": "{cur} so với {prior} — cùng định nghĩa, mỗi chi nhánh theo múi giờ riêng", // DRAFT — Kevin reviews
  "bcx.cmp.prior.today": "hôm qua", // DRAFT — Kevin reviews
  "bcx.cmp.prior.yesterday": "hôm kia", // DRAFT — Kevin reviews
  "bcx.cmp.prior.week": "tuần trước, từ thứ Hai đến cùng thứ", // DRAFT — Kevin reviews
  "bcx.cmp.prior.month": "tháng trước, từ ngày 1 đến cùng ngày", // DRAFT — Kevin reviews
  "bcx.cmp.prior.quarter": "quý trước, đến cùng ngày", // DRAFT — Kevin reviews
  "bcx.cmp.prior.year": "năm trước, đến cùng ngày", // DRAFT — Kevin reviews
  "bcx.fair.shareNet": "Tỷ lệ trong doanh thu thuần của tiệm", // DRAFT — Kevin reviews
  "bcx.fair.shareBookings": "Tỷ lệ trong lượt đặt hẹn của tiệm", // DRAFT — Kevin reviews
  "bcx.fair.ofTotal": "{pct}% của {total}", // DRAFT — Kevin reviews
  "bcx.fair.ofCount": "{pct}% ({n} trên {total})", // DRAFT — Kevin reviews
  "bcx.fair.note": "Tỷ lệ tính trên tổng của tất cả {n} chi nhánh trong phần so sánh này. Chi nhánh lớn hơn (nhiều ghế, nhân viên hoặc giờ mở cửa hơn) đương nhiên có tổng cao hơn — hãy so sánh các tỷ lệ (hóa đơn trung bình, tỷ lệ hoàn thành, doanh thu mỗi lượt hẹn hoàn thành) để đánh giá chi nhánh. Các tỷ lệ này không điều chỉnh theo nhân viên hay giờ — các dòng mỗi giờ từ Bảng điểm chi nhánh thì có.", // DRAFT — Kevin reviews
  "bcx.def.fair": "Công bằng — tổng phụ thuộc vào quy mô chi nhánh; mở một chi nhánh để xem tỷ lệ của nó trong tổng của tiệm và mẫu số. Các tỷ lệ tính theo hóa đơn hoặc lượt đặt hẹn, nên so sánh được các chi nhánh khác quy mô.", // DRAFT — Kevin reviews
  "bcx.ready.ready": "Sẵn sàng so sánh", // DRAFT — Kevin reviews
  "bcx.ready.limited": "So sánh thận trọng", // DRAFT — Kevin reviews
  "bcx.ready.not_ready": "Chưa đủ dữ liệu để so sánh", // DRAFT — Kevin reviews
  "bcx.ready.coverage": "{n} trên {of} chi nhánh có lịch hẹn hoặc doanh thu trong kỳ này ({p}%)", // DRAFT — Kevin reviews
  "bcx.ready.fresh": "đọc trực tiếp từ báo cáo lúc {at}", // DRAFT — Kevin reviews
  "bcx.ready.r.single_branch": "Chỉ có một chi nhánh — không có gì để so sánh", // DRAFT — Kevin reviews
  "bcx.ready.r.too_few_with_activity": "Ít hơn hai chi nhánh có hoạt động — xếp hạng sẽ không có ý nghĩa", // DRAFT — Kevin reviews
  "bcx.ready.r.branch_without_activity": "{n} chi nhánh không có lịch hẹn hoặc doanh thu", // DRAFT — Kevin reviews
  "bcx.ready.r.small_sample": "{n} chi nhánh có ít hơn 5 lịch hẹn", // DRAFT — Kevin reviews
  "bcx.ready.r.revenue_hidden": "Doanh thu bị ẩn với vai trò của bạn", // DRAFT — Kevin reviews
  "bcx.ready.r.partial_period": "Hôm nay vẫn đang diễn ra", // DRAFT — Kevin reviews
  "bcx.t.title": "Dấu hiệu xu hướng từ quy tắc cảnh báo", // DRAFT — Kevin reviews
  "bcx.t.none": "Quy tắc cảnh báo không ghi nhận gì cho các chi nhánh này trong kỳ.", // DRAFT — Kevin reviews
  "bcx.t.f.revenue": "Doanh thu", // DRAFT — Kevin reviews
  "bcx.t.f.bookings": "Lịch hẹn", // DRAFT — Kevin reviews
  "bcx.t.f.retention": "Giữ chân khách", // DRAFT — Kevin reviews
  "bcx.t.f.other": "Khác", // DRAFT — Kevin reviews
  "bcx.t.line": "{b}: {m} đã vượt quy tắc {n} lần — gần nhất {v} so với {t} ({at}).", // DRAFT — Kevin reviews
  "bcx.t.open": "{n} vẫn đang mở.", // DRAFT — Kevin reviews
  "bcx.t.go": "Mở cảnh báo", // DRAFT — Kevin reviews
  "bcx.t.note": "Chỉ hiện các quy tắc đặt cho từng chi nhánh; quy tắc cho toàn tiệm nằm trong Cảnh báo AI Kinh doanh. Trang này không tự phát hiện gì.", // DRAFT — Kevin reviews
  "bcx.ev.title": "Các số liệu này lấy từ đâu", // DRAFT — Kevin reviews
  "bcx.ev.asOf": "Đọc lúc {at}", // DRAFT — Kevin reviews
  "bcx.ev.days": "{from} – {to} ({tz})", // DRAFT — Kevin reviews
  "bcx.ev.figure": "Số liệu", // DRAFT — Kevin reviews
  "bcx.ev.source": "Nguồn", // DRAFT — Kevin reviews
  "bcx.ev.f.net_sales": "Doanh thu thuần", // DRAFT — Kevin reviews
  "bcx.ev.f.paid_tickets": "Phiếu đã thanh toán", // DRAFT — Kevin reviews
  "bcx.ev.f.average_ticket": "Phiếu trung bình", // DRAFT — Kevin reviews
  "bcx.ev.f.bookings": "Lịch hẹn", // DRAFT — Kevin reviews
  "bcx.ev.f.completed": "Đã hoàn thành", // DRAFT — Kevin reviews
  "bcx.ev.f.completion_rate": "Tỷ lệ hoàn thành", // DRAFT — Kevin reviews
  "bcx.ev.f.no_show_rate": "Không đến", // DRAFT — Kevin reviews
  "bcx.ev.f.technician_hours": "Giờ làm của thợ", // DRAFT — Kevin reviews
  "bcx.ev.f.operating_hours": "Giờ mở cửa", // DRAFT — Kevin reviews
  "bcx.ev.f.customers": "Khách hàng", // DRAFT — Kevin reviews
  "bcx.ev.f.returning_customers": "Khách quay lại", // DRAFT — Kevin reviews
  "bcx.ev.f.returning_rate": "Tỷ lệ quay lại", // DRAFT — Kevin reviews
  "bcx.ev.s.sales_report": "Báo cáo doanh thu", // DRAFT — Kevin reviews
  "bcx.ev.s.booking_report": "Báo cáo lịch hẹn", // DRAFT — Kevin reviews
  "bcx.ev.s.time_clock": "Ca chấm công", // DRAFT — Kevin reviews
  "bcx.ev.s.opening_hours": "Giờ mở cửa của địa điểm", // DRAFT — Kevin reviews
  "bcx.ev.s.paid_tickets": "Phiếu đã thanh toán (Báo cáo khách hàng)", // DRAFT — Kevin reviews
  "bcx.l.col": "So sánh tương đương", // DRAFT — Kevin reviews
  "bcx.l.rank": "#{n} trên {of} theo giờ làm của thợ", // DRAFT — Kevin reviews
  "bcx.l.with": "tương tự {names}", // DRAFT — Kevin reviews
  "bcx.l.r.no_peers": "Không có chi nhánh tương tự", // DRAFT — Kevin reviews
  "bcx.l.r.no_staffing": "Chưa có giờ chấm công", // DRAFT — Kevin reviews
  "bcx.l.r.no_opening_hours": "Chưa đặt giờ mở cửa", // DRAFT — Kevin reviews
  "bcx.l.r.no_services": "Chưa có dịch vụ đã thanh toán", // DRAFT — Kevin reviews
  "bcx.snap.title": "So sánh đã lưu & xác nhận", // DRAFT — Kevin reviews
  "bcx.snap.sub": "Lưu so sánh này để giữ nguyên số liệu như hiện tại; người duyệt thêm ghi chú xác nhận. Ghi chú không bao giờ thay đổi số liệu đã lưu.", // DRAFT — Kevin reviews
  "bcx.snap.save": "Lưu so sánh này", // DRAFT — Kevin reviews
  "bcx.snap.namePh": "Tên (không bắt buộc)", // DRAFT — Kevin reviews
  "bcx.snap.confirm": "Lưu", // DRAFT — Kevin reviews
  "bcx.snap.saved": "Đã lưu so sánh. Số liệu sẽ không thay đổi.", // DRAFT — Kevin reviews
  "bcx.snap.none": "Chưa có so sánh nào được lưu", // DRAFT — Kevin reviews
  "bcx.snap.line": "{p} · đọc lúc {at} · lưu bởi {who} · {n} chi nhánh", // DRAFT — Kevin reviews
  "bcx.snap.unreviewed": "Chưa được xác nhận", // DRAFT — Kevin reviews
  "bcx.snap.d.approved": "Đã duyệt", // DRAFT — Kevin reviews
  "bcx.snap.d.needs_follow_up": "Cần theo dõi", // DRAFT — Kevin reviews
  "bcx.snap.d.noted": "Đã ghi nhận", // DRAFT — Kevin reviews
  "bcx.snap.frozen": "Số liệu cho {p} đọc lúc {at}, lưu bởi {who}. Không thay đổi.", // DRAFT — Kevin reviews
  "bcx.snap.moneyHidden": "Doanh thu bị ẩn với vai trò của bạn.", // DRAFT — Kevin reviews
  "bcx.snap.signoffs": "Ghi chú xác nhận", // DRAFT — Kevin reviews
  "bcx.snap.by": "— {who}, {at}", // DRAFT — Kevin reviews
  "bcx.snap.decision": "Quyết định", // DRAFT — Kevin reviews
  "bcx.snap.note": "Ghi chú (bắt buộc)", // DRAFT — Kevin reviews
  "bcx.snap.sign": "Thêm xác nhận", // DRAFT — Kevin reviews
  "bcx.snap.noteRequired": "Hãy viết ghi chú ngắn (ít nhất 3 ký tự).", // DRAFT — Kevin reviews
  "bcx.snap.cannotSign": "Cần quyền xem số liệu doanh thu để xác nhận.", // DRAFT — Kevin reviews
  "bcx.snap.rule": "Ghi chú xác nhận được giữ theo thứ tự và không thể sửa hay xóa. Không có gì ở đây thay đổi doanh thu, lịch hẹn hay lịch làm việc.", // DRAFT — Kevin reviews
  "bzx.sp.title": "Ngân sách SMS (cài đặt đã lưu)", // DRAFT — Kevin reviews
  "bzx.sp.recipients": "Tin nhắn mỗi lần kích hoạt: {n} trên {total} người nhận có số di động", // DRAFT — Kevin reviews
  "bzx.sp.segments": "{seg} đoạn mỗi tin · {total} đoạn mỗi lần kích hoạt", // DRAFT — Kevin reviews
  "bzx.sp.cost": "Chi phí ước tính mỗi lần kích hoạt: {cost} (chi phí trung bình mỗi đoạn của nhà cung cấp trong 30 ngày qua)", // DRAFT — Kevin reviews
  "bzx.sp.costUnknown": "Chi phí ước tính mỗi lần kích hoạt: — (nhà cung cấp chưa báo chi phí trong 30 ngày qua)", // DRAFT — Kevin reviews
  "bzx.sp.sender": "Số gửi SMS: đã thiết lập (kiểm tra lần cuối {at})", // DRAFT — Kevin reviews
  "bzx.sp.senderNoCheck": "Số gửi SMS: đã thiết lập (chưa kiểm tra)", // DRAFT — Kevin reviews
  "bzx.sp.senderMissing": "Số gửi SMS: chưa thiết lập — chưa gửi được tin cho đến khi hoàn tất Thiết lập nhắn tin", // DRAFT — Kevin reviews
  "bzx.sp.limits": "Giới hạn tin nhắn của tiệm: {daily} mỗi ngày · {monthly} mỗi tháng · {mode}", // DRAFT — Kevin reviews
  "bzx.sp.noLimits": "Giới hạn tin nhắn của tiệm: chưa đặt", // DRAFT — Kevin reviews
  "bzx.sp.unlimited": "không giới hạn", // DRAFT — Kevin reviews
  "bzx.sp.mode.soft": "chỉ cảnh báo", // DRAFT — Kevin reviews
  "bzx.sp.mode.hard": "chặn tin vượt mức", // DRAFT — Kevin reviews
  "bzx.sp.mode.approval": "cần duyệt", // DRAFT — Kevin reviews
  "bzx.sp.guards": "Chống lặp: {cooldown} · nhắc lại một lần sau {esc} phút · {quiet}", // DRAFT — Kevin reviews
  "bzx.sp.quietOn": "có giờ yên lặng", // DRAFT — Kevin reviews
  "bzx.sp.quietOff": "không có giờ yên lặng", // DRAFT — Kevin reviews
  "bzx.sp.sent": "SMS cảnh báo này đã gửi trong 24 giờ qua: {rule} (tất cả cảnh báo: {salon})", // DRAFT — Kevin reviews
  "bzx.sp.w.no_phone_recipients": "Không người nhận nào có số di động — SMS sẽ bị bỏ qua.", // DRAFT — Kevin reviews
  "bzx.sp.w.sender_not_configured": "Tiệm chưa thiết lập số gửi SMS.", // DRAFT — Kevin reviews
  "bzx.sp.w.no_cooldown": "Không có thời gian chờ: mỗi lần cảnh báo kích hoạt sẽ gửi tin lại.", // DRAFT — Kevin reviews
  "bzx.sp.dirty": "Bạn đã thay đổi cài đặt — hãy lưu để cập nhật ước tính.", // DRAFT — Kevin reviews
  "bzx.sch.title": "Báo cáo tự động", // DRAFT — Kevin reviews
  "bzx.sch.note": "Bật báo cáo hằng ngày, hằng tuần hoặc hằng tháng của riêng bạn. Máy chủ tạo báo cáo vào hoặc sau giờ đã chọn (giờ {tz}) — không cần mở trang này — và một dòng trong hộp Cảnh báo cho biết khi báo cáo sẵn sàng.", // DRAFT — Kevin reviews
  "bzx.sch.when.every_day": "Mỗi ngày, cho {p}", // DRAFT — Kevin reviews
  "bzx.sch.when.sunday": "Mỗi Chủ nhật, cho {p}", // DRAFT — Kevin reviews
  "bzx.sch.when.last_day_of_month": "Vào ngày cuối mỗi tháng, cho {p}", // DRAFT — Kevin reviews
  "bzx.sch.hour": "Lúc", // DRAFT — Kevin reviews
  "bzx.sch.on": "Bật", // DRAFT — Kevin reviews
  "bzx.sch.off": "Tắt", // DRAFT — Kevin reviews
  "bzx.sch.never": "Chưa tạo lần nào", // DRAFT — Kevin reviews
  "bzx.sch.last.generated": "Tạo lần cuối {at}", // DRAFT — Kevin reviews
  "bzx.sch.last.failed": "Lần thử cuối thất bại {at}", // DRAFT — Kevin reviews
  "bzx.sch.last.skipped": "Bỏ qua {at} — người lập lịch không còn dùng được AI Business", // DRAFT — Kevin reviews
  "bzx.exec.btn": "Tóm tắt điều hành", // DRAFT — Kevin reviews
  "bzx.exec.title": "Tóm tắt điều hành", // DRAFT — Kevin reviews
  "bzx.exec.rule": "Số liệu là số của Báo cáo doanh thu lưu trong báo cáo này, được đối chiếu lại với Báo cáo doanh thu hiện tại. Không có số nào là ước tính.", // DRAFT — Kevin reviews
  "bzx.exec.check.matches_sales_report": "Khớp với Báo cáo doanh thu hiện tại", // DRAFT — Kevin reviews
  "bzx.exec.check.changed_since": "Đã thay đổi — Báo cáo doanh thu hiện cho thấy {now}", // DRAFT — Kevin reviews
  "bzx.exec.check.not_checkable": "Lấy từ báo cáo; không đối chiếu lại được", // DRAFT — Kevin reviews
  "bzx.exec.opps": "Cơ hội cần xem xét", // DRAFT — Kevin reviews
  "bzx.exec.noOpps": "Không có cơ hội nổi bật trong số liệu của báo cáo này.", // DRAFT — Kevin reviews
  "bzx.exec.review": "Xem", // DRAFT — Kevin reviews
  "bzx.exec.proposals": "Đây là gợi ý để bạn xem xét. Không có gì được thay đổi, gửi đi hay bắt đầu từ đây.", // DRAFT — Kevin reviews
  "bzx.exec.unavailable": "Nội dung báo cáo này không còn hiển thị nên không có gì để tóm tắt. Hãy tạo lại để có số liệu hiện tại.", // DRAFT — Kevin reviews
  "bzx.opp.no_shows": "{noShowPercent}% trong {bookings} lịch hẹn là khách không đến. Tin nhắn nhắc lịch và xác nhận trước một ngày thường giảm được tình trạng này.", // DRAFT — Kevin reviews
  "bzx.opp.cancellations": "{cancelledPercent}% lịch hẹn bị hủy. Mời khách trong danh sách chờ vào các chỗ trống để không mất thời gian.", // DRAFT — Kevin reviews
  "bzx.opp.retention": "Chỉ {retentionRatePercent}% khách quay lại. Chiến dịch mời lại khách đã vắng 60 ngày là bước thường làm tiếp theo.", // DRAFT — Kevin reviews
  "bzx.opp.new_customers": "Khách mới giảm {trendPercent}% ({newCustomers} trong kỳ này). Phần thưởng giới thiệu giúp có thêm bạn bè của khách quen.", // DRAFT — Kevin reviews
  "bzx.opp.retail": "Không có hóa đơn nào trong {ticketsCount} hóa đơn đã thanh toán có sản phẩm. Gợi ý khi thanh toán có thể giới thiệu sản phẩm chăm sóc đúng lúc.", // DRAFT — Kevin reviews
  "bzx.i.unread": "Chưa đọc", // DRAFT — Kevin reviews
  "bzx.cmp.btn": "Đã thay đổi gì từ lần trước…", // DRAFT — Kevin reviews
  "bzx.cmp.pick": "So sánh với báo cáo khác:", // DRAFT — Kevin reviews
  "bzx.cmp.rule": "Điều chỉnh dữ liệu = những thay đổi sau đó trên chính các ngày của báo cáo cũ (hoàn tiền, sửa, phiếu nhập trễ). Thay đổi kinh doanh = báo cáo mới so với các ngày cũ đã điều chỉnh.", // DRAFT — Kevin reviews
  "bzx.cmp.same": "Hai báo cáo cùng các ngày — mọi chênh lệch đều là điều chỉnh dữ liệu, không phải thay đổi kinh doanh.", // DRAFT — Kevin reviews
  "bzx.cmp.older": "Báo cáo cũ", // DRAFT — Kevin reviews
  "bzx.cmp.correction": "Điều chỉnh dữ liệu", // DRAFT — Kevin reviews
  "bzx.cmp.newer": "Báo cáo mới", // DRAFT — Kevin reviews
  "bzx.cmp.business": "Thay đổi kinh doanh", // DRAFT — Kevin reviews
  "bzx.cmp.cannot.not_completed": "Cả hai báo cáo phải hoàn tất mới so sánh được.", // DRAFT — Kevin reviews
  "bzx.cmp.cannot.no_snapshot": "Một báo cáo không có số liệu Báo cáo doanh số đã xác minh để so sánh.", // DRAFT — Kevin reviews
  "bzx.cmp.cannot.no_permission": "Vai trò của bạn không xem được số liệu Báo cáo doanh số.", // DRAFT — Kevin reviews
  "bzx.cmp.cannot.same_report": "Hãy chọn báo cáo khác.", // DRAFT — Kevin reviews
  "bzx.src.sales": "Doanh thu kỳ này", // DRAFT — Kevin reviews
  "bzx.src.booking": "Lịch hẹn ngày đó", // DRAFT — Kevin reviews
  "bzx.src.history": "Lịch sử lịch hẹn", // DRAFT — Kevin reviews
  "bzx.src.staff": "Hiệu suất nhân viên", // DRAFT — Kevin reviews
  "bzx.src.customers": "Khách hàng", // DRAFT — Kevin reviews
  "aib.trust.title": "Câu trả lời này dựa trên gì", // DRAFT — Kevin reviews
  "aib.trust.answered": "Trả lời lúc", // DRAFT — Kevin reviews
  "aib.trust.check": "Lần kiểm tra dữ liệu gần nhất", // DRAFT — Kevin reviews
  "aib.trust.checkAt": "{s} lúc {at}", // DRAFT — Kevin reviews
  "aib.trust.noCheck": "Chưa có lần kiểm tra dữ liệu — hãy chạy Kiểm tra dữ liệu kinh doanh", // DRAFT — Kevin reviews
  "aib.trust.state.PASSED": "Đạt", // DRAFT — Kevin reviews
  "aib.trust.state.WARNING": "Có cảnh báo", // DRAFT — Kevin reviews
  "aib.trust.state.FAILED": "Lỗi", // DRAFT — Kevin reviews
  "aib.trust.state.INSUFFICIENT_DATA": "Chưa đủ dữ liệu", // DRAFT — Kevin reviews
  "aib.trust.sources": "Nguồn", // DRAFT — Kevin reviews
  "aib.trust.src.sales": "Báo cáo doanh thu", // DRAFT — Kevin reviews
  "aib.trust.src.appointments": "Lịch hẹn", // DRAFT — Kevin reviews
  "aib.trust.src.customers": "Khách hàng", // DRAFT — Kevin reviews
  "aib.trust.src.technicians": "Thợ", // DRAFT — Kevin reviews
  "aib.trust.src.expenses": "Chi phí", // DRAFT — Kevin reviews
  "aib.trust.src.branches": "Chi nhánh", // DRAFT — Kevin reviews
  "aib.trust.src.tickets": "Phiếu", // DRAFT — Kevin reviews
  "aib.trust.reason.included": "có", // DRAFT — Kevin reviews
  "aib.trust.reason.no_permission": "không có — vai trò của bạn không được xem", // DRAFT — Kevin reviews
  "aib.trust.reason.no_data": "không có dữ liệu", // DRAFT — Kevin reviews
  "aib.trust.pending": "Đang chờ cập nhật", // DRAFT — Kevin reviews
  "aib.trust.openTickets": "{n} phiếu đang mở chưa thanh toán", // DRAFT — Kevin reviews
  "aib.trust.expensesWaiting": "{n} chi phí chờ duyệt", // DRAFT — Kevin reviews
  "aib.trust.events": "{n} cập nhật chưa gửi xong", // DRAFT — Kevin reviews
  "aib.trust.lag": "lâu nhất {n} phút", // DRAFT — Kevin reviews
  "aib.trust.stale.event_lag": "Một số cập nhật bị trễ nên số liệu có thể chưa mới nhất.", // DRAFT — Kevin reviews
  "aib.trust.stale.check_failed": "Lần kiểm tra dữ liệu gần nhất bị lỗi.", // DRAFT — Kevin reviews
  "aib.trust.stale.source_missing": "Một nguồn không có dữ liệu.", // DRAFT — Kevin reviews
  "aib.empty.noData": "Kỳ này không có dữ liệu nên chưa có gì để giải thích.", // DRAFT — Kevin reviews
  "aib.empty.wider": "Thử 30 ngày qua", // DRAFT — Kevin reviews
  "aib.empty.denied": "Một phần câu trả lời bị ẩn vì vai trò của bạn không được xem. Hãy hỏi chủ tiệm hoặc quản lý nếu cần.", // DRAFT — Kevin reviews
  "aib.empty.forbidden": "Hãy chọn câu hỏi khác hoặc hỏi chủ tiệm hoặc quản lý.", // DRAFT — Kevin reviews
  "aib.prov.title": "Bản ghi", // DRAFT — Kevin reviews
  "aib.prov.tool": "Trả lời bằng công cụ {tool}", // DRAFT — Kevin reviews
  "aib.prov.private": "Chỉ bạn xem được bản ghi này; nó không bao giờ bị sửa.", // DRAFT — Kevin reviews
  "bcx10.fresh": "Hoạt động gần nhất ở đây", // DRAFT — Kevin reviews
  "bcx10.freshV": "thanh toán {t} · đặt lịch {b}", // DRAFT — Kevin reviews
  "bcx10.waiting": "{n} cập nhật chưa gửi xong", // DRAFT — Kevin reviews
  "bcx10.delayed": "Dữ liệu trễ", // DRAFT — Kevin reviews
  "bcx10.delayedTip": "{n} cập nhật từ chi nhánh này đang chờ (lâu nhất {m} phút); số liệu có thể chưa mới nhất.", // DRAFT — Kevin reviews
  "bcx10.fairNote": "Mỗi giờ của thợ là chia cho thời gian ca đã ghi ở đây; mỗi giờ mở cửa là chia cho giờ mở cửa của chi nhánh — cả hai lấy từ Bảng điểm chi nhánh bên dưới.", // DRAFT — Kevin reviews
  "bzx.word.btn": "Diễn đạt bằng AI", // DRAFT — Kevin reviews
  "bzx.word.byModel": "AI diễn đạt từ các số liệu đã xác minh ở trên; mọi con số đều đã được đối chiếu.", // DRAFT — Kevin reviews
  "bzx.word.state.not_configured": "Chưa diễn đạt bằng AI được: chưa kết nối mô hình AI. Các số liệu ở trên là bản tóm tắt.", // DRAFT — Kevin reviews
  "bzx.word.state.denied": "Gói Trợ lý Kinh doanh AI hiện không cho phép việc này. Các số liệu ở trên là bản tóm tắt.", // DRAFT — Kevin reviews
  "bzx.word.state.rejected_numbers": "Không hiện bản diễn đạt: có số không nằm trong số liệu đã xác minh ({n}).", // DRAFT — Kevin reviews
  "bzx.word.state.provider_error": "Không kết nối được AI. Các số liệu ở trên là bản tóm tắt.", // DRAFT — Kevin reviews
  "bzx.word.state.unavailable": "Báo cáo này không có số liệu đã xác minh để diễn đạt.", // DRAFT — Kevin reviews
};
