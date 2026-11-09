// ns/payment.vi.ts — the POS "payment" namespace, Vietnamese. Typed against the English keys. The §35 lines are the mandate's
// exact Vietnamese; technician = "Thợ". New strings are listed in docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md.
import type { PAYMENT_EN } from './payment.en';
export const PAYMENT_VI: Record<keyof typeof PAYMENT_EN, string> = {
  'payment.unknown.title': 'Trạng thái thanh toán chưa xác định.',
  'payment.unknown.doNotPayAgain': 'Không thanh toán lại.',
  'payment.unknown.verifyFirst': 'Hãy kiểm tra giao dịch trước.',
  'payment.unknown.verifying': 'Đang kiểm tra trạng thái thanh toán. Không thu tiền khách lần nữa.',
  'payment.unknown.completeBlocked': 'Hãy kiểm tra thanh toán trước khi hoàn tất thanh toán.',
  'payment.unknown.verifyPayment': 'Kiểm tra thanh toán',
  'payment.verify.approved': 'Đơn vị xử lý xác nhận thanh toán ĐÃ ĐƯỢC CHẤP THUẬN. Hóa đơn đã được thanh toán.',
  'payment.verify.declined': 'Đơn vị xử lý báo thẻ BỊ TỪ CHỐI. Bạn có thể thử lại thẻ.',
  'payment.verify.failed': 'Giao dịch chưa đến đơn vị xử lý — chưa trừ tiền. Bạn có thể quẹt thẻ lại.',
  'payment.verify.pending': 'Đơn vị xử lý chưa có ghi nhận. Kiểm tra lại sau khoảng {seconds} giây — không thu tiền lại.',
  'payment.verify.unreachable': 'Không kết nối được đơn vị xử lý. Chưa trừ tiền lại; hãy kiểm tra lại sau giây lát.',
  'payment.verify.none': 'Hóa đơn này không có giao dịch nào cần kiểm tra.',
  'payment.verify.other': 'Kiểm tra: {status}',
  'payment.result.cardStatus': 'Thanh toán thẻ: {status}',
  'payment.result.splitRecorded': 'Chia thanh toán: {status}, {count} phương thức.',
  'payment.result.bookedDealNotApplied': 'Chưa áp dụng ưu đãi đã đặt: {reason}',
  'payment.totals.taxRate': 'Thuế ({rate}%)',
  'payment.totals.giftCard': 'Thẻ quà tặng',
  'payment.totals.cardSurcharge': 'Phụ phí thẻ',
  'payment.totals.discountCode': 'Giảm giá ({code})',
  'payment.totals.totalDue': 'Tổng phải trả',
  'payment.badge.paid': 'ĐÃ THANH TOÁN',
  'payment.board.action.priority': 'Ưu tiên',
  'payment.board.action.continue': 'Tiếp tục',
  'payment.board.action.resume': 'Tiếp tục lại',
  'payment.board.action.open': 'Mở',
  'payment.board.vip': 'VIP',
  'payment.attention.discountApproval': 'Duyệt giảm giá',
  'payment.attention.partialPayment': 'Thanh toán một phần',
  'payment.attention.failedReceipt': 'Gửi hóa đơn thất bại',
  'payment.attention.failedPayment': 'Thanh toán thất bại',
  'payment.attention.splitPayment': 'Chia thanh toán',
  'payment.attention.giftCard': 'Thẻ quà tặng',
  'payment.staff.frontDesk': 'Quầy lễ tân',
  'payment.staff.ready': 'Sẵn sàng',
  'payment.staff.busy': 'Đang bận',
  'payment.staff.break': 'Giờ nghỉ',
  'payment.insight.retryNow': 'Thử lại ngay',
  'payment.insight.openQueue': 'Mở hàng chờ',
  'payment.channel.sms': 'SMS',
  'payment.channel.email': 'Email',
  'payment.channel.app': 'Ứng dụng',
  'payment.channel.both': 'Cả hai',
  'payment.channel.print': 'In',
  'payment.channel.result': '{channel}: {result}',
  'payment.tab.all': 'Tất cả giao dịch',
  'payment.tab.payments': 'Thanh toán',
  'payment.tab.refunds': 'Hoàn tiền',
  'payment.tab.voids': 'Hủy giao dịch',
  'payment.tab.pending': 'Đang chờ',
  'payment.tab.failed': 'Thất bại',
  'payment.txType.Payment': 'Thanh toán',
  'payment.txType.Refund': 'Hoàn tiền',
  'payment.txType.Void': 'Hủy giao dịch',
  'payment.deposit.tab.overview': 'Tổng quan',
  'payment.deposit.tab.fees': 'Phí',
  'payment.deposit.tab.exceptions': 'Ngoại lệ',
  'payment.deposit.tab.reports': 'Báo cáo',
  'payment.terminal.type.other': 'Khác',
  'payment.discount.deal': 'Ưu đãi',
  'payment.discount.coupon': 'Mã giảm giá',
  'payment.discount.manual': 'Giảm giá thủ công',
  'payment.discount.membership': 'Hội viên',
  'payment.discount.loyalty': 'Phần thưởng',
  'payment.discount.bundle': 'Gói',
  'payment.cash.over': 'thừa',
  'payment.cash.short': 'thiếu',
  'payment.method.unknown': 'Không rõ',
  // Checkout One-Screen + Payment Safety mandate (Oct 28 2026)
  'payment.attention.paymentUnknown': 'Chưa rõ thanh toán',
  'payment.attention.paymentProcessing': 'Đang xử lý thanh toán',
  'payment.attention.refundUncertain': 'Chưa rõ hoàn tiền',
  'payment.attention.paymentUnknownIssue': 'Mất phản hồi thẻ — không quẹt lại. Hãy Kiểm tra thanh toán.',
  'payment.attention.paymentProcessingIssue': 'Thanh toán thẻ đang xử lý — hãy chờ phản hồi.',
  'payment.attention.refundUncertainIssue': 'Chưa xác nhận hoàn tiền — hãy kiểm tra trước khi hoàn lại lần nữa.',
  'payment.board.live.CONNECTED': 'Trực tiếp',
  'payment.board.live.RECONNECTING': 'Đang kết nối lại',
  'payment.board.live.OFFLINE': 'Mất kết nối',
  'payment.board.live.DEGRADED': 'Cập nhật chậm',
  'payment.board.autoRefreshHint': 'Bật: bảng tự cập nhật theo sự kiện trực tiếp. Tắt: bảng chỉ đổi khi bạn bấm Làm mới.',
  'payment.board.viewFullQueue': 'Xem toàn bộ hàng chờ ({count})',
  'payment.board.viewAllAttention': 'Xem tất cả ({count})',
  'payment.board.fullQueueTitle': 'Hàng chờ thanh toán — tất cả khách',
  'payment.board.allAttentionTitle': 'Giao dịch cần chú ý — tất cả',
  'payment.lines.viewAll': 'Xem cả {count} dòng',
  'payment.lines.title': 'Các dòng hóa đơn',
  'payment.summary.title': 'Tóm tắt thanh toán',
  'payment.summary.readOnly': 'Chỉ xem, theo dữ liệu máy chủ',
  'payment.summary.tenders': 'Các khoản thanh toán của hóa đơn',
  'payment.summary.noTenders': 'Chưa có thanh toán',
  'payment.summary.paid': 'Đã trả',
  'payment.summary.balance': 'Còn phải trả',
  'payment.summary.unreadable': 'Không đọc được các khoản thanh toán — hãy kiểm tra trước khi thu thêm.',
  'payment.staff.summary': '{ready} sẵn sàng · {busy} đang bận · {onBreak} nghỉ — hiện {shown}/{total}',
  'payment.kpi.noReceiptsYet': 'Chưa gửi hóa đơn nào',
  'payment.kpi.unreadable': 'Không đọc được',
  'payment.insight.verifyUnknown': 'Thanh toán cần kiểm tra: {count} — không quẹt lại',
  'payment.insight.failedReceipts': 'Hóa đơn gửi không thành công: {count} — gửi lại',
  'payment.insight.review': 'Xem',
  'payment.assist.title': 'Tự động hỗ trợ — chỉ gợi ý; bạn xác nhận mọi thay đổi',
  'payment.qa.noReadyGuest': 'Không có khách nào chờ thanh toán.',
  'payment.workspace.paidBalance': 'Đã trả {paid} · Còn {balance}',
  // moved from the frozen catalog.vi.ts (Nov 6 2026) — keys unchanged
  'pos.per_technician_tips': 'Khách tip riêng cho từng Thợ trên màn hình khách (thử nghiệm — mặc định tắt)',
  'payment.tipsOnBehalf.title': 'Tip chưa được xác nhận.',
  'payment.tipsOnBehalf.body': 'Khách chưa xác nhận tip cho từng Thợ trên màn hình. Hãy nhờ khách xác nhận, hoặc xác nhận thay khách bên dưới — việc này được ghi lại dưới tên của bạn.',
  'payment.tipsOnBehalf.reason': 'Lý do bạn xác nhận thay khách',
  'payment.tipsOnBehalf.confirm': 'Xác nhận thay khách và thanh toán',
  'payment.tipsOnBehalf.cancel': 'Hủy',
  'payment.customerTips.title': 'Tip của khách (màn hình)',
  'payment.customerTips.stale': 'Thợ đã thay đổi — khách cần chọn lại',
  'payment.customerTips.byStaff': 'nhân viên nhập',
  'payment.customerTips.total': 'Tổng tip',
  'payment.customerTips.state.DRAFT': 'Chưa xác nhận',
  'payment.customerTips.state.CONFIRMED': 'Đã xác nhận',
  'payment.customerTips.state.LOCKED': 'Đã xác nhận · đang thanh toán',
  'payment.customerTips.state.SUPERSEDED': 'Quầy đã thay đổi',
  'payment.terminal.label': 'Máy Clover Compact',
  'payment.terminal.none': 'Chi nhánh này chưa kết nối máy thanh toán. Hãy kết nối trong mục Thiết bị.',
  'payment.terminal.disabled': '(đã tắt)',
  'payment.terminal.amountOnDevice': 'Khách xác nhận {amount} trên máy thanh toán.',
  'payment.terminal.waiting': 'Đang chờ khách chạm, cắm hoặc quẹt thẻ trên {terminal}…',
  'payment.terminal.cancel': 'Hủy trên máy',
  'payment.terminal.cancelSent': 'Đã gửi lệnh hủy. Nếu thẻ đã được gửi đi duyệt, hãy bấm Kiểm tra trước khi tính tiền lại.',
  'payment.terminal.cancelFailed': 'Không hủy được trên máy: {reason}',
  'payment.terminal.approved': 'ĐÃ DUYỆT — {amount} trên máy thanh toán.',
  'payment.terminal.declined': 'BỊ TỪ CHỐI — {reason}. Có thể thử thẻ khác.',
  'payment.terminal.unavailable': 'TẠM THỜI KHÔNG DÙNG ĐƯỢC — {reason}',
  'payment.terminal.inProgress': 'ĐANG XỬ LÝ — {reason}',
  'payment.terminal.cancelled': 'ĐÃ HỦY trên máy — chưa trừ tiền. Bạn có thể thanh toán lại.',   // DRAFT — Kevin reviews
  'payment.terminal.unknown': 'CHƯA RÕ — CẦN KIỂM TRA. {reason}',
  'payment.terminal.unassignedWarning': 'Chưa có chi nhánh — máy này không nhận thanh toán thẻ cho đến khi được gán.',
  'payment.terminal.assignHere': 'Gán cho chi nhánh này',
  'payment.terminal.noLocation': 'Chưa có địa điểm',   // DRAFT — Kevin reviews
  'payment.terminal.assigned': '{label} đã được gán cho chi nhánh này.',
  'payment.surcharge.disclosure': 'Chỉ áp dụng cho thẻ tín dụng: đơn vị xử lý thẻ có thể cộng thêm phụ phí {rate}%. Thẻ ghi nợ và thẻ trả trước không bao giờ bị tính phụ phí. Biên lai ghi rõ số tiền thực tế đã thu.',
  "ways.btn": "Ba cách thanh toán",   // DRAFT — Kevin reviews
  "ways.btnHint": "Clover Compact, iPhone của nhân viên và ứng dụng khách — trạng thái và chuyển thanh toán",   // DRAFT — Kevin reviews
  "ways.title": "Ba cách thanh toán",   // DRAFT — Kevin reviews
  "ways.merchant": "Mã người bán {mid}",   // DRAFT — Kevin reviews
  "ways.live": "Thanh toán thật",   // DRAFT — Kevin reviews
  "ways.testOnly": "Chỉ thanh toán thử — thanh toán thẻ thật đang tắt",   // DRAFT — Kevin reviews
  "ways.check": "Kiểm tra ba kênh thanh toán",   // DRAFT — Kevin reviews
  "ways.refresh": "Làm mới",   // DRAFT — Kevin reviews
  "ways.back": "Quay lại thanh toán",   // DRAFT — Kevin reviews
  "ways.loading": "Đang tải các kênh thanh toán…",   // DRAFT — Kevin reviews
  "ways.loadFailed": "Không tải được các kênh thanh toán.",   // DRAFT — Kevin reviews
  "ways.actionFailed": "Thao tác không thành công. Chưa trừ tiền.",   // DRAFT — Kevin reviews
  "ways.err.forbidden": "Vai trò của bạn không xem được các kênh thanh toán.",   // DRAFT — Kevin reviews
  "ways.ticket": "Phiếu",   // DRAFT — Kevin reviews
  "ways.balance": "Còn phải trả (thẻ)",   // DRAFT — Kevin reviews
  "ways.paidSoFar": "Đã trả {amount}",   // DRAFT — Kevin reviews
  "ways.tstatus.unpaid": "Chưa trả",   // DRAFT — Kevin reviews
  "ways.tstatus.partially_paid": "Đã trả một phần",   // DRAFT — Kevin reviews
  "ways.tstatus.in_progress": "Đang thanh toán",   // DRAFT — Kevin reviews
  "ways.tstatus.unknown": "Chưa rõ — kiểm tra trạng thái",   // DRAFT — Kevin reviews
  "ways.tstatus.paid": "Đã trả",   // DRAFT — Kevin reviews
  "ways.paidVia.clover_compact": "Đã trả trên Clover Compact",   // DRAFT — Kevin reviews
  "ways.paidVia.tap_to_pay_iphone": "Đã trả trên iPhone của nhân viên",   // DRAFT — Kevin reviews
  "ways.paidVia.customer_app": "Đã trả trong ứng dụng khách",   // DRAFT — Kevin reviews
  "ways.paidVia.other": "Đã trả tại quầy",   // DRAFT — Kevin reviews
  "ways.via.clover_compact": "trên Clover Compact",   // DRAFT — Kevin reviews
  "ways.via.tap_to_pay_iphone": "trên iPhone của nhân viên",   // DRAFT — Kevin reviews
  "ways.via.customer_app": "trong ứng dụng khách",   // DRAFT — Kevin reviews
  "ways.via.front_desk": "tại quầy",   // DRAFT — Kevin reviews
  "ways.unknownHelp": "Chưa nhận được kết quả của một lần thanh toán trên phiếu này. Đừng thanh toán lại — đóng cửa sổ này và bấm Kiểm tra thanh toán trên phiếu.",   // DRAFT — Kevin reviews
  "ways.inProgressHelp": "Phiếu này đang được thanh toán. Hãy chờ xong — các kênh khác tạm khóa để không ai bị trừ tiền hai lần.",   // DRAFT — Kevin reviews
  "ways.noTicket": "Chọn một phiếu trong hàng chờ để thanh toán. Các kênh dưới đây cho biết mức sẵn sàng của tiệm.",   // DRAFT — Kevin reviews
  "ways.pickTicket": "Hãy chọn phiếu trước.",   // DRAFT — Kevin reviews
  "ways.title.clover_compact": "Clover Compact",   // DRAFT — Kevin reviews
  "ways.title.tap_to_pay_iphone": "iPhone nhân viên — Tap to Pay",   // DRAFT — Kevin reviews
  "ways.title.customer_app": "Ứng dụng khách — Thẻ đã lưu / Trả ngay",   // DRAFT — Kevin reviews
  "ways.where.clover_compact": "Tại quầy · máy quẹt thẻ",   // DRAFT — Kevin reviews
  "ways.where.tap_to_pay_iphone": "Trên iPhone nhân viên đã duyệt · ứng dụng trên điện thoại",   // DRAFT — Kevin reviews
  "ways.where.customer_app": "Trên điện thoại của khách · thẻ lưu an toàn",   // DRAFT — Kevin reviews
  "ways.state.ready": "Sẵn sàng",   // DRAFT — Kevin reviews
  "ways.state.setup_required": "Cần cài đặt",   // DRAFT — Kevin reviews
  "ways.state.provider_pending": "Đang chờ duyệt",   // DRAFT — Kevin reviews
  "ways.state.blocked": "Bị chặn",   // DRAFT — Kevin reviews
  "ways.state.unavailable": "Không dùng được",   // DRAFT — Kevin reviews
  "ways.uat": "Chế độ thử",   // DRAFT — Kevin reviews
  "ways.uatHint": "Kênh thử của Fiserv — không phải tiền thật. Chưa phải chứng nhận.",   // DRAFT — Kevin reviews
  "ways.f.terminal": "Máy quẹt",   // DRAFT — Kevin reviews
  "ways.f.merchant": "Người bán",   // DRAFT — Kevin reviews
  "ways.f.lastPing": "Lần kiểm tra tốt gần nhất",   // DRAFT — Kevin reviews
  "ways.f.phones": "Điện thoại",   // DRAFT — Kevin reviews
  "ways.f.apple": "Apple Tap to Pay",   // DRAFT — Kevin reviews
  "ways.f.processorTtp": "Fiserv CommerceHub",   // DRAFT — Kevin reviews
  "ways.f.appPayments": "Trả trong ứng dụng",   // DRAFT — Kevin reviews
  "ways.f.tokenizer": "Mẫu thẻ an toàn",   // DRAFT — Kevin reviews
  "ways.f.savedCards": "Thẻ đã lưu của khách",   // DRAFT — Kevin reviews
  "ways.phonesOnline": "{online}/{total} đang trực tuyến",   // DRAFT — Kevin reviews
  "ways.onb.not_started": "Chưa bắt đầu",   // DRAFT — Kevin reviews
  "ways.onb.requested": "Đã yêu cầu",   // DRAFT — Kevin reviews
  "ways.onb.approved": "Đã duyệt",   // DRAFT — Kevin reviews
  "ways.onb.active": "Đang hoạt động",   // DRAFT — Kevin reviews
  "ways.onb.rejected": "Bị từ chối",   // DRAFT — Kevin reviews
  "ways.onb.suspended": "Tạm ngưng",   // DRAFT — Kevin reviews
  "ways.on": "Bật",   // DRAFT — Kevin reviews
  "ways.off": "Tắt",   // DRAFT — Kevin reviews
  "ways.ready": "Sẵn sàng",   // DRAFT — Kevin reviews
  "ways.notReady": "Chưa sẵn sàng",   // DRAFT — Kevin reviews
  "ways.never": "Chưa có",   // DRAFT — Kevin reviews
  "ways.lastVerified": "Xác nhận lần cuối {at}",   // DRAFT — Kevin reviews
  "ways.notVerifiedYet": "Chưa được xác nhận",   // DRAFT — Kevin reviews
  "ways.act.clover": "Dùng Clover Compact",   // DRAFT — Kevin reviews
  "ways.act.terminalDetails": "Chi tiết máy quẹt",   // DRAFT — Kevin reviews
  "ways.act.phone": "Gửi đến {name}",   // DRAFT — Kevin reviews
  "ways.act.phoneNone": "Không có điện thoại trực tuyến",   // DRAFT — Kevin reviews
  "ways.aPhone": "điện thoại",   // DRAFT — Kevin reviews
  "ways.act.app": "Gửi đến ứng dụng khách",   // DRAFT — Kevin reviews
  "ways.act.verifyApp": "Kiểm tra thanh toán trong ứng dụng",   // DRAFT — Kevin reviews
  "ways.sentPhone": "Đã gửi đến {name}. Điện thoại sẽ nhận thanh toán; phiếu cập nhật khi bên xử lý xác nhận.",   // DRAFT — Kevin reviews
  "ways.sentApp": "Đã gửi đến ứng dụng của khách. Phiếu cập nhật khi thanh toán được xác nhận.",   // DRAFT — Kevin reviews
  "ways.verifiedApp": "Đã hỏi bên xử lý — xem trạng thái phiếu ở trên.",   // DRAFT — Kevin reviews
  "ways.held.ticket_paid": "Phiếu đã trả — không trừ tiền lần hai.",   // DRAFT — Kevin reviews
  "ways.held.payment_in_progress": "Đang có một lần thanh toán.",   // DRAFT — Kevin reviews
  "ways.held.verify_first": "Hãy kiểm tra lần thanh toán chưa rõ trước.",   // DRAFT — Kevin reviews
  "ways.held.nothing_due": "Không còn gì phải trả.",   // DRAFT — Kevin reviews
  "ways.held.no_customer": "Phiếu này không có hồ sơ khách để gửi.",   // DRAFT — Kevin reviews
  "ways.foot": "Trạng thái thanh toán luôn lấy từ bên xử lý và sổ sách của tiệm — không phải từ màn hình này. Không bao giờ nhập số thẻ ở đây.",   // DRAFT — Kevin reviews
  "ways.checking": "Đang kiểm tra — chỉ đọc, không trừ tiền thử…",   // DRAFT — Kevin reviews
  "ways.health.overall": "Tổng quát: {s} · {at}",   // DRAFT — Kevin reviews
  "ways.health.readOnly": "Chỉ đọc: không trừ tiền, không gửi, không thay đổi gì.",   // DRAFT — Kevin reviews
  "ways.health.layoutNote": "Kết quả vừa màn hình chỉ nói về bố cục — không phải chứng nhận thanh toán.",   // DRAFT — Kevin reviews
  "ways.hs.PASSED": "Đạt",   // DRAFT — Kevin reviews
  "ways.hs.WARNING": "Cảnh báo",   // DRAFT — Kevin reviews
  "ways.hs.FAILED": "Lỗi",   // DRAFT — Kevin reviews
  "ways.hs.INSUFFICIENT_DATA": "Chưa đủ dữ liệu",   // DRAFT — Kevin reviews
  "ways.hs.UNAVAILABLE": "Không dùng được",   // DRAFT — Kevin reviews
  "ways.hs.PROVIDER_APPROVAL_PENDING": "Đang chờ bên cung cấp duyệt",   // DRAFT — Kevin reviews
  "ways.hk.channels_readable": "Đọc được các kênh thanh toán",   // DRAFT — Kevin reviews
  "ways.hk.unknown_payments": "Thanh toán chưa rõ kết quả",   // DRAFT — Kevin reviews
  "ways.hk.stuck_payments": "Thanh toán bị kẹt",   // DRAFT — Kevin reviews
  "ways.hk.app_payments_unsettled": "Thanh toán trong ứng dụng cần kiểm tra",   // DRAFT — Kevin reviews
  "ways.hk.clover_compact": "Clover Compact",   // DRAFT — Kevin reviews
  "ways.hk.terminal_ping": "Lần kiểm tra máy quẹt",   // DRAFT — Kevin reviews
  "ways.hk.tap_to_pay_iphone": "iPhone nhân viên — Tap to Pay",   // DRAFT — Kevin reviews
  "ways.hk.customer_app": "Thẻ lưu trong ứng dụng khách",   // DRAFT — Kevin reviews
  "ways.hk.live_mode": "Thanh toán thẻ thật",   // DRAFT — Kevin reviews
  "ways.hk.surcharge_policy": "Quy định phụ phí thẻ",   // DRAFT — Kevin reviews
  "ways.hk.no_side_effects": "Chỉ đọc",   // DRAFT — Kevin reviews
  "ways.hk.screen_fit": "Vừa màn hình (máy này)",   // DRAFT — Kevin reviews
  "ways.fit": "{w}×{h} px CSS · tỉ lệ điểm ảnh {dpr} · bề rộng thẻ {cards}",   // DRAFT — Kevin reviews
  "ways.fitOverflow": "trang bị cuộn ngang",   // DRAFT — Kevin reviews
  "ways.reason.UAT_TEST_LANE": "Kênh thử của Fiserv — không phải tiền thật.",   // DRAFT — Kevin reviews
  "ways.reason.NO_TERMINAL": "Chưa có máy quẹt nào gắn với tiệm này. Gắn máy trong Thiết bị → Máy quẹt thẻ.",   // DRAFT — Kevin reviews
  "ways.reason.TERMINALS_ALL_DISABLED": "Mọi máy quẹt ở đây đều đang tắt. Bật lại một máy trong Máy quẹt thẻ.",   // DRAFT — Kevin reviews
  "ways.reason.TERMINAL_HSN_MISSING": "Máy quẹt chưa có số sê-ri (HSN). Nhập HSN của Clover Compact trong Máy quẹt thẻ.",   // DRAFT — Kevin reviews
  "ways.reason.TERMINALS_UNREADABLE": "Không đọc được danh sách máy quẹt. Thử lại.",   // DRAFT — Kevin reviews
  "ways.reason.ROUTER_UNAVAILABLE": "Máy chủ này không hỗ trợ thanh toán thẻ.",   // DRAFT — Kevin reviews
  "ways.reason.MERCHANT_UNREADABLE": "Không đọc được tài khoản người bán. Thử lại.",   // DRAFT — Kevin reviews
  "ways.reason.PLATFORM_PAUSED": "Nền tảng đang tạm dừng thanh toán thẻ.",   // DRAFT — Kevin reviews
  "ways.reason.MERCHANT_SUSPENDED": "Thanh toán thẻ của tiệm này đang tạm dừng.",   // DRAFT — Kevin reviews
  "ways.reason.MERCHANT_BRANCH_MISMATCH": "Máy quẹt này thuộc tài khoản người bán của tiệm khác — không trừ tiền ở đây.",   // DRAFT — Kevin reviews
  "ways.reason.HOST_NOT_ALLOWED": "Địa chỉ máy quẹt không phải máy chủ Fiserv được duyệt. Hỏi hỗ trợ AIPowerSalon.",   // DRAFT — Kevin reviews
  "ways.reason.SECRET_UNREADABLE": "Không mở được khóa máy quẹt. Nhờ hỗ trợ AIPowerSalon nhập lại.",   // DRAFT — Kevin reviews
  "ways.reason.MERCHANT_NOT_CONFIGURED": "Tiệm này chưa có tài khoản người bán đang hoạt động.",   // DRAFT — Kevin reviews
  "ways.reason.TERMINAL_NOT_CONFIGURED": "Kết nối máy quẹt (Bolt) chưa được cài cho tiệm này.",   // DRAFT — Kevin reviews
  "ways.reason.PRODUCTION_NOT_APPROVED": "Thanh toán thẻ thật chưa được duyệt cho người bán này.",   // DRAFT — Kevin reviews
  "ways.reason.PLATFORM_NOT_VALIDATED_BY_FISERV": "Đang chờ Fiserv xác nhận bằng văn bản trước khi thanh toán thật.",   // DRAFT — Kevin reviews
  "ways.reason.PLATFORM_PRODUCTION_DISABLED": "Thanh toán thật đang tắt trên nền tảng.",   // DRAFT — Kevin reviews
  "ways.reason.MERCHANT_NOT_BOARDED": "Người bán chưa được Fiserv kích hoạt.",   // DRAFT — Kevin reviews
  "ways.reason.MERCHANT_CREDENTIALS_NOT_VERIFIED": "Thông tin người bán chưa được xác minh.",   // DRAFT — Kevin reviews
  "ways.reason.MERCHANT_PRODUCTION_NOT_ENABLED": "Thanh toán thật chưa bật cho người bán này.",   // DRAFT — Kevin reviews
  "ways.reason.PRODUCTION_DISABLED_IN_THIS_DEPLOYMENT": "Thanh toán thật đang tắt trên máy chủ này (chỉ chế độ thử).",   // DRAFT — Kevin reviews
  "ways.reason.SANDBOX_MERCHANT_IN_LIVE_DEPLOYMENT": "Không dùng tài khoản thử trên máy chủ thật.",   // DRAFT — Kevin reviews
  "ways.reason.TAP_TO_PAY_SERVICE_UNAVAILABLE": "Máy chủ này không hỗ trợ Tap to Pay.",   // DRAFT — Kevin reviews
  "ways.reason.TAP_TO_PAY_UNREADABLE": "Không đọc được trạng thái Tap to Pay. Thử lại.",   // DRAFT — Kevin reviews
  "ways.reason.TAP_TO_PAY_OFF_PLATFORM": "Nền tảng đang tắt Tap to Pay.",   // DRAFT — Kevin reviews
  "ways.reason.TAP_TO_PAY_OFF_PROVIDER": "Tap to Pay qua bên cung cấp này đang tắt.",   // DRAFT — Kevin reviews
  "ways.reason.TAP_TO_PAY_NOT_IN_ROLLOUT": "Tap to Pay chưa được bật cho tiệm này.",   // DRAFT — Kevin reviews
  "ways.reason.APPLE_ENTITLEMENT_PENDING": "Đang chờ Apple duyệt Tap to Pay.",   // DRAFT — Kevin reviews
  "ways.reason.PROCESSOR_TTP_PENDING": "Đang chờ Fiserv CommerceHub kích hoạt.",   // DRAFT — Kevin reviews
  "ways.reason.TAP_TO_PAY_CREDENTIALS_MISSING": "Chưa cài thông tin Tap to Pay.",   // DRAFT — Kevin reviews
  "ways.reason.TAP_TO_PAY_MERCHANT_MISSING": "Tiệm này chưa có tài khoản người bán Tap to Pay.",   // DRAFT — Kevin reviews
  "ways.reason.NO_APPROVED_PHONE": "Chưa có điện thoại Tap to Pay được duyệt ở tiệm này. Duyệt máy trong Thiết bị thanh toán.",   // DRAFT — Kevin reviews
  "ways.reason.NO_PHONE_ONLINE": "Hiện không có điện thoại Tap to Pay nào trực tuyến. Mở ứng dụng thanh toán trên điện thoại.",   // DRAFT — Kevin reviews
  "ways.reason.APP_SETTINGS_UNREADABLE": "Không đọc được cài đặt thanh toán trong ứng dụng — xem như đang tắt.",   // DRAFT — Kevin reviews
  "ways.reason.APP_PAYMENTS_OFF": "Thanh toán trong ứng dụng khách đang tắt. Bật Thanh toán không cần xếp hàng trong Cài đặt.",   // DRAFT — Kevin reviews
  "ways.reason.TOKENIZER_UNAVAILABLE": "Mẫu thẻ an toàn chưa dùng được cho người bán này.",   // DRAFT — Kevin reviews
  "ways.reason.TOKENIZER_GATEWAY_NOT_CONFIGURED": "Mẫu thẻ an toàn cần cài cổng thanh toán thẻ của tiệm trước.",   // DRAFT — Kevin reviews
  "ways.reason.VERIFY_UNKNOWN_PAYMENTS": "Hãy kiểm tra với bên xử lý trước khi trừ tiền lại.",   // DRAFT — Kevin reviews
  "ways.reason.PAYMENTS_STUCK_IN_PROGRESS": "Một số thanh toán đã treo hơn 15 phút.",   // DRAFT — Kevin reviews
  "ways.reason.APP_PAYMENTS_NEED_VERIFY": "Một số thanh toán trong ứng dụng vẫn đang xử lý — hãy kiểm tra.",   // DRAFT — Kevin reviews
  "ways.reason.LEDGER_UNREADABLE": "Không đọc được sổ thanh toán.",   // DRAFT — Kevin reviews
  "ways.reason.CHANNELS_UNREADABLE": "Không đọc được các kênh thanh toán.",   // DRAFT — Kevin reviews
  "ways.reason.NO_SUCCESSFUL_PING_ON_RECORD": "Chưa có lần kiểm tra máy quẹt thành công — chạy Kiểm tra kết nối trong Máy quẹt thẻ.",   // DRAFT — Kevin reviews
  "ways.reason.PRODUCTION_PAYMENTS_DISABLED": "Thanh toán thẻ thật tắt cho tới khi Fiserv chứng nhận.",   // DRAFT — Kevin reviews
  "ways.reason.SURCHARGE_ON_WITHOUT_PROVIDER_ENROLLMENT": "Phụ phí thẻ đang bật nhưng người bán chưa đăng ký với bên cung cấp.",   // DRAFT — Kevin reviews
  "ways.reason.SURCHARGE_PROVIDER_ENROLLED": "Phụ phí đã đăng ký với bên cung cấp.",   // DRAFT — Kevin reviews
  "ways.reason.SETTINGS_UNREADABLE": "Không đọc được cài đặt.",   // DRAFT — Kevin reviews
  "ways.reason.generic.ready": "Sẵn sàng ({code}).",   // DRAFT — Kevin reviews
  "ways.reason.generic.setup_required": "Cần cài đặt ({code}).",   // DRAFT — Kevin reviews
  "ways.reason.generic.provider_pending": "Đang chờ bên cung cấp ({code}).",   // DRAFT — Kevin reviews
  "ways.reason.generic.blocked": "Bị chặn để an toàn ({code}).",   // DRAFT — Kevin reviews
  "ways.reason.generic.unavailable": "Hiện không dùng được ({code}).",   // DRAFT — Kevin reviews,
  "pgx.checked": "kiểm tra lúc {at}",   // DRAFT — Kevin reviews
  "pgx.toTerminals": "Máy thanh toán",   // DRAFT — Kevin reviews
  "pgx.check": "Kiểm tra cổng thanh toán",   // DRAFT — Kevin reviews
  "pgx.sandboxBanner": "Sandbox (UAT) — chỉ thanh toán thử. Không có tiền thật, và đây không phải chứng nhận của Fiserv.",   // DRAFT — Kevin reviews
  "pgx.selected": "Đã chọn {p}",   // DRAFT — Kevin reviews
  "pgx.statusMeans": "hồ sơ người bán đang hoạt động — chưa phải duyệt thanh toán thật",   // DRAFT — Kevin reviews
  "pgx.connector": "Kết nối",   // DRAFT — Kevin reviews
  "pgx.terminalKey": "Khóa máy quẹt thẻ",   // DRAFT — Kevin reviews
  "pgx.terminalHost": "Địa chỉ dịch vụ máy quẹt",   // DRAFT — Kevin reviews
  "pgx.ttpMerchant": "Người bán Tap to Pay",   // DRAFT — Kevin reviews
  "pgx.livePayments": "Thanh toán thẻ thật",   // DRAFT — Kevin reviews
  "pgx.stored": "Đã lưu trên máy chủ (không hiển thị)",   // DRAFT — Kevin reviews
  "pgx.notStored": "Chưa cài",   // DRAFT — Kevin reviews
  "pgx.on": "Bật",   // DRAFT — Kevin reviews
  "pgx.offUntilCert": "Tắt cho tới khi Fiserv chứng nhận",   // DRAFT — Kevin reviews
  "pgx.billingNote": "Đây là cách tiệm nhận thanh toán thẻ của khách. Phí dịch vụ AI PowerSalon là riêng (Tài khoản → Thanh toán).",   // DRAFT — Kevin reviews
  "pgx.channels": "Kênh thanh toán",   // DRAFT — Kevin reviews
  "pgx.readiness": "Danh sách sẵn sàng",   // DRAFT — Kevin reviews
  "pgx.done": "Xong",   // DRAFT — Kevin reviews
  "pgx.notYet": "Chưa",   // DRAFT — Kevin reviews
  "pgx.unknown": "Chưa rõ",   // DRAFT — Kevin reviews
  "pgx.readinessNote": "Mỗi dòng là một thông tin riêng. Đã kết nối hoặc hồ sơ người bán đang hoạt động không có nghĩa là đã được duyệt thanh toán thật.",   // DRAFT — Kevin reviews
  "pgx.history": "Lịch sử máy quẹt & kết nối",   // DRAFT — Kevin reviews
  "pgx.line.provider": "Đã chọn nhà cung cấp: {p}",   // DRAFT — Kevin reviews
  "pgx.line.noProvider": "Chưa chọn nhà cung cấp thanh toán",   // DRAFT — Kevin reviews
  "pgx.line.merchant": "Đã có tài khoản người bán ({mid})",   // DRAFT — Kevin reviews
  "pgx.line.noMerchant": "Chưa có tài khoản người bán",   // DRAFT — Kevin reviews
  "pgx.line.sandbox": "Môi trường: sandbox (chỉ thử UAT)",   // DRAFT — Kevin reviews
  "pgx.line.production": "Môi trường: thật",   // DRAFT — Kevin reviews
  "pgx.line.onboarding": "Hồ sơ người bán: {s}",   // DRAFT — Kevin reviews
  "pgx.line.terminalKey": "Đã lưu khóa máy quẹt (Clover Compact)",   // DRAFT — Kevin reviews
  "pgx.line.noTerminalKey": "Chưa cài khóa máy quẹt",   // DRAFT — Kevin reviews
  "pgx.line.ttp": "Đã gán người bán Tap to Pay ({mid})",   // DRAFT — Kevin reviews
  "pgx.line.noTtp": "Chưa gán người bán Tap to Pay",   // DRAFT — Kevin reviews
  "pgx.line.live": "Đã bật thanh toán thẻ thật",   // DRAFT — Kevin reviews
  "pgx.line.notLive": "Thanh toán thẻ thật tắt cho tới khi Fiserv chứng nhận",   // DRAFT — Kevin reviews
  "pgx.line.liveUnknown": "Chưa đọc được trạng thái thanh toán thật",   // DRAFT — Kevin reviews
};
