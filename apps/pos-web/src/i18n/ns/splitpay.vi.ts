// ns/splitpay.vi.ts — the POS "sp" namespace, Vietnamese (staff-facing). Terms: tender = khoản thanh toán · split = thanh toán
// nhiều phần · balance = còn lại · refund = hoàn tiền · register = quầy. Listed in docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md (A39).
export const SPLITPAY_VI: Record<string, string> = {
  'sp.subtitle': 'Phiếu thanh toán bằng nhiều khoản — mỗi phiếu một dòng, chi tiết ngay trên dòng',
  'sp.kpi.tickets': 'Phiếu thanh toán nhiều phần', 'sp.kpi.ticketsSub': 'Từ hai khoản đã xác nhận · {n} phiếu khác (chưa đủ / thất bại)',
  'sp.kpi.total': 'Tổng thanh toán nhiều phần', 'sp.kpi.totalSub': 'Mỗi phiếu tính một lần, tổng cuối · gồm {t} tiền tip',
  'sp.kpi.avg': 'Số khoản TB / phiếu', 'sp.kpi.avgSub': 'Khoản đã xác nhận ÷ phiếu nhiều phần',
  'sp.kpi.completed': 'Đã hoàn tất', 'sp.kpi.completedSub': 'Đã trả đủ · {r} có hoàn tiền',
  'sp.kpi.outstanding': 'Số dư còn nợ', 'sp.kpi.outstandingSub': 'Còn phải trả trên {n} phiếu trả một phần — không phải tiền chờ về',
  'sp.searchPh': 'Tìm tên khách, SĐT, email, số phiếu, mã giao dịch hoặc số tiền…', 'sp.chip.search': 'Tìm: {q}',
  'sp.methods': 'Hình thức thanh toán', 'sp.allMethods': 'Mọi kết hợp', 'sp.register': 'Quầy', 'sp.allRegisters': 'Tất cả quầy',
  'sp.combo.card_cash': 'Thẻ + Tiền mặt', 'sp.combo.gift_card': 'Thẻ quà tặng + Thẻ', 'sp.combo.cash_gift': 'Tiền mặt + Thẻ quà tặng', 'sp.combo.card_card': 'Thẻ + Thẻ', 'sp.combo.three_plus': 'Từ ba hình thức', 'sp.combo.any_gift': 'Có thẻ quà tặng', 'sp.combo.any_cash': 'Có tiền mặt',
  'sp.sort.created_desc': 'Tạo mới nhất', 'sp.sort.created_asc': 'Tạo cũ nhất', 'sp.sort.completed_desc': 'Hoàn tất gần đây', 'sp.sort.total_desc': 'Tổng cao nhất', 'sp.sort.total_asc': 'Tổng thấp nhất', 'sp.sort.tenders_desc': 'Nhiều khoản nhất', 'sp.sort.due_desc': 'Còn nợ nhiều nhất',
  'sp.basis.completed': 'Ngày hoàn tất', 'sp.basis.created': 'Ngày tạo', 'sp.basis.tender': 'Ngày thanh toán khoản', 'sp.basis.refund': 'Ngày hoàn tiền', 'sp.basis.activity': 'Hoạt động gần nhất',
  'sp.dateShown.completed': 'Cột ngày: hoàn tất', 'sp.dateShown.created': 'Cột ngày: tạo', 'sp.dateShown.tender': 'Cột ngày: khoản gần nhất', 'sp.dateShown.refund': 'Cột ngày: hoàn tất', 'sp.dateShown.activity': 'Cột ngày: hoàn tất',
  'sp.tableTitle': 'Phiếu thanh toán nhiều phần', 'sp.noMatches': 'Không có phiếu nào khớp', 'sp.noMatchesHint': 'Không có gì trong {p} với bộ lọc này. Phiếu trả bằng một khoản không hiện ở đây.', 'sp.tryAllTime': 'Xem mọi thời gian',
  'sp.empty': 'Chưa có phiếu thanh toán nhiều phần', 'sp.emptyHint': 'Phiếu sẽ hiện ở đây khi được trả bằng từ hai khoản (ví dụ một phần thẻ, một phần tiền mặt) tại Thanh toán.',
  'sp.col.ticket': 'Phiếu', 'sp.col.customer': 'Khách hàng', 'sp.col.date': 'Ngày', 'sp.col.methods': 'Hình thức', 'sp.col.tenders': 'Số khoản', 'sp.col.total': 'Tổng phiếu', 'sp.col.paid': 'Đã trả', 'sp.col.due': 'Còn lại',
  'sp.noNumber': 'Không số', 'sp.walkIn': 'Khách vãng lai / chưa liên kết', 'sp.matched.reference': 'khớp mã', 'sp.matched.name': 'khớp tên', 'sp.failedAttempts': '{n} lần thất bại',
  'sp.showBreakdown': 'Xem chi tiết thanh toán', 'sp.hideBreakdown': 'Ẩn chi tiết thanh toán',
  'sp.bd.total': 'Tổng phiếu', 'sp.bd.refunded': 'Đã hoàn', 'sp.bd.balance': 'Số dư còn lại', 'sp.bd.noConfirmed': 'Chưa có khoản nào được xác nhận', 'sp.bd.tenders': '{n} xác nhận / {a} lần thử', 'sp.bd.tip': 'gồm {t} tiền tip', 'sp.viewTenders': 'Xem từng khoản',
  'sp.method.cash': 'Tiền mặt', 'sp.method.card': 'Thẻ tín dụng', 'sp.method.gift_card': 'Thẻ quà tặng', 'sp.method.check': 'Séc', 'sp.method.deposit': 'Tiền cọc', 'sp.method.loyalty': 'Điểm thưởng', 'sp.method.other': 'Khác',
  'sp.status.completed': 'Đã trả', 'sp.status.partially_paid': 'Trả một phần', 'sp.status.pending': 'Đang chờ', 'sp.status.failed': 'Thất bại', 'sp.status.partially_refunded': 'Hoàn một phần', 'sp.status.refunded': 'Đã hoàn', 'sp.status.void': 'Đã hủy',
  'sp.statusNote.completed': 'Các khoản đã xác nhận cộng đúng bằng tổng phiếu.', 'sp.statusNote.partially_paid': 'Một số khoản thành công; phần còn lại vẫn phải trả. Hoàn tất ở Thanh toán.', 'sp.statusNote.pending': 'Một khoản đã bắt đầu nhưng chưa có kết quả cuối.',
  'sp.statusNote.failed': 'Không khoản nào được xác nhận. Lần bị từ chối không bao giờ tính là đã trả.', 'sp.statusNote.partially_refunded': 'Một phần tiền đã trả được hoàn về đúng khoản gốc.', 'sp.statusNote.refunded': 'Toàn bộ tiền đã trả được hoàn về các khoản gốc.', 'sp.statusNote.void': 'Phiếu đã bị hủy hoặc xóa.',
  'sp.finishAtCheckout': 'Hoàn tất ở Thanh toán', 'sp.openTransactions': 'Mở trong Giao dịch',
  'sp.f.subtotal': 'Dịch vụ & Sản phẩm', 'sp.f.discount': 'Giảm giá', 'sp.f.tax': 'Thuế', 'sp.f.tip': 'Tiền tip', 'sp.f.surcharge': 'Phụ phí thẻ', 'sp.f.created': 'Tạo lúc', 'sp.f.completed': 'Hoàn tất lúc', 'sp.notCompleted': 'Chưa hoàn tất', 'sp.f.technician': 'Thợ',
  'sp.tendersTitle': 'Các khoản thanh toán', 'sp.t.method': 'Hình thức', 'sp.t.channel': 'Kênh', 'sp.t.amount': 'Số tiền', 'sp.t.state': 'Trạng thái', 'sp.t.reference': 'Mã tham chiếu', 'sp.t.refunded': 'Đã hoàn', 'sp.t.time': 'Thời gian', 'sp.t.surchargeIncl': 'gồm {a} phụ phí', 'sp.t.refundable': 'còn hoàn được {a}',
  'sp.tstate.confirmed': 'Đã xác nhận', 'sp.tstate.pending': 'Đang chờ', 'sp.tstate.failed': 'Thất bại', 'sp.tstate.reversal': 'Đảo ngược',
  'sp.channel.pos': 'Tại quầy', 'sp.channel.cardpointe_terminal': 'Máy quẹt thẻ', 'sp.channel.clover_compact': 'Máy quẹt thẻ', 'sp.channel.tap_to_pay_iphone': 'iPhone Tap to Pay', 'sp.channel.customer_display': 'Màn hình khách', 'sp.channel.cash': 'Két tiền mặt', 'sp.channel.manual_external': 'Ghi tay', 'sp.channel.online': 'Trực tuyến',
  'sp.giftLedger': 'Bút toán thẻ quà tặng', 'sp.drawerEntry': 'Bút toán két tiền',
  'sp.refundsTitle': 'Hoàn tiền', 'sp.rstate.refunded': 'Đã hoàn', 'sp.rstate.pending': 'Đang chờ', 'sp.rstate.processing': 'Đang xử lý', 'sp.rstate.reserved': 'Đã giữ', 'sp.rstate.failed': 'Thất bại', 'sp.rstate.voided': 'Đã hủy', 'sp.rstate.cancelled': 'Đã hủy bỏ',
  'sp.linesTitle': 'Dịch vụ & Sản phẩm', 'sp.auditTitle': 'Nhật ký',
  'sp.refundNote': 'Hoàn tiền được thực hiện từ mục Hoàn tiền & Hủy, về đúng khoản gốc, qua bộ xử lý. Trang này không chuyển tiền.',
  'sp.pendingBanner': '{n} hóa đơn có thanh toán thẻ đang chờ kết quả. Khoản này chưa được tính là đã trả — hãy kiểm tra lần thanh toán gốc trong hóa đơn trước khi quẹt lại.', // DRAFT — Kevin reviews
  'sp.dup.title': 'Kiểm tra sự kiện trùng', // DRAFT — Kevin reviews
  'sp.dup.none': 'Không có sự kiện trùng trong {n} khoản thanh toán: không có callback lặp lại, không có mã tham chiếu lặp lại, không ghi sổ hai lần.', // DRAFT — Kevin reviews
  'sp.dup.row': '{t} — {n}', // DRAFT — Kevin reviews
  'sp.dup.k.repeated_callbacks': 'Callback bộ xử lý lặp lại', // DRAFT — Kevin reviews
  'sp.dup.k.repeated_operation': 'Cùng mã tham chiếu trên khoản khác', // DRAFT — Kevin reviews
  'sp.dup.k.duplicate_gift_posting': 'Ghi hai lần vào sổ thẻ quà tặng', // DRAFT — Kevin reviews
  'sp.dup.k.duplicate_drawer_posting': 'Ghi hai lần vào ngăn kéo tiền', // DRAFT — Kevin reviews
  'sp.dup.safe': 'Chỉ để chẩn đoán — không xóa hay đảo ngược gì ở đây. Xác minh, sau đó sửa qua Hoàn tiền & Hủy hoặc ngăn kéo tiền kèm lý do.', // DRAFT — Kevin reviews
  'sp.readOnly.title': 'Chỉ xem — không thể làm mới dữ liệu thanh toán.', // DRAFT — Kevin reviews
  'sp.readOnly.stale': 'Số liệu đang hiển thị được đọc lúc {t} và có thể đã cũ.', // DRAFT — Kevin reviews
  'sp.readOnly.none': 'Không đọc được số liệu nào.', // DRAFT — Kevin reviews
  'sp.readOnly.paused': 'Xuất tệp và Hoàn tất tại quầy thanh toán tạm dừng cho đến khi kết nối lại.', // DRAFT — Kevin reviews
  'sp.xm.title': 'Đối chiếu giữa các mục', // DRAFT — Kevin reviews
  'sp.xm.gift': 'Thẻ quà tặng', // DRAFT — Kevin reviews
  'sp.xm.giftLine': 'Thanh toán bằng thẻ quà tặng {t} · sổ thẻ quà tặng ghi trừ {l}', // DRAFT — Kevin reviews
  'sp.xm.tips': 'Tiền tip', // DRAFT — Kevin reviews
  'sp.xm.tipsLine': 'Tip trên hóa đơn {t} · đã chia cho thợ {a}', // DRAFT — Kevin reviews
  'sp.xm.cash': 'Két tiền / chốt sổ cuối ngày', // DRAFT — Kevin reviews
  'sp.xm.cashLine': 'Tiền mặt {a} ngày {d}', // DRAFT — Kevin reviews
  'sp.xm.noCash': 'Hóa đơn này không có tiền mặt', // DRAFT — Kevin reviews
  'sp.xm.checkout': 'Thanh toán so với các khoản trả', // DRAFT — Kevin reviews
  'sp.xm.checkoutPaid': 'Hóa đơn đã đánh dấu trả xong · các khoản trả còn thiếu {d}', // DRAFT — Kevin reviews
  'sp.xm.checkoutOpen': 'Hóa đơn chưa trả xong · còn nợ {d}', // DRAFT — Kevin reviews
  'sp.xm.safe': 'So theo mã hóa đơn, mã thanh toán và ngày làm việc chung. Chỉ xem: không chuyển, ghi sổ hay sửa tiền ở đây.', // DRAFT — Kevin reviews
  'sp.xm.st.matched': 'Khớp', // DRAFT — Kevin reviews
  'sp.xm.st.differs': 'Lệch', // DRAFT — Kevin reviews
  'sp.xm.st.not_used': 'Không dùng', // DRAFT — Kevin reviews
  'sp.xm.st.unallocated': 'Chưa chia', // DRAFT — Kevin reviews
  'sp.xm.st.counted': 'Két đã đếm', // DRAFT — Kevin reviews
  'sp.xm.st.open': 'Két chưa đếm', // DRAFT — Kevin reviews
  'sp.xm.st.not_opened': 'Không có két cho ngày đó', // DRAFT — Kevin reviews
  'sp.xm.st.aligned': 'Khớp', // DRAFT — Kevin reviews
  'sp.xm.st.misaligned': 'Không khớp', // DRAFT — Kevin reviews
};
