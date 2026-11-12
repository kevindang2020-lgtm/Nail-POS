// ns/giftcard.vi.ts — the POS "gc" namespace, Vietnamese (staff-facing). Terms: gift card = thẻ quà tặng · liability = số dư
// còn nợ · redeem = sử dụng · reload = nạp thêm · void = hủy thẻ · purchaser / recipient = người mua / người nhận.
// Listed in docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md (A38).
export const GIFTCARD_VI: Record<string, string> = {
  'gc.subtitle': 'Mọi thẻ tiệm đã bán — số dư, người mua và người nhận, toàn bộ lịch sử',
  'gc.issue': 'Phát hành thẻ quà tặng', 'gc.checkBalance': 'Kiểm tra số dư', 'gc.branchLiability': 'Công nợ theo chi nhánh', 'gc.cards': 'Thẻ quà tặng', 'gc.card': 'Thẻ quà tặng', 'gc.viewCard': 'Xem thẻ',
  'gc.kpi.liability': 'Số dư còn nợ', 'gc.kpi.liabilitySub': 'Giá trị còn trên thẻ · tính đến hiện tại',
  'gc.kpi.active': 'Thẻ đang dùng', 'gc.kpi.activeSub': 'Còn số dư và dùng được · tính đến hiện tại',
  'gc.kpi.issued': 'Tổng phát hành', 'gc.kpi.issuedSub': '{n} thẻ được kích hoạt · {p}',
  'gc.kpi.redeemed': 'Giá trị đã dùng', 'gc.kpi.redeemedSub': '{n} lần sử dụng · đã trừ {r} hoàn lại',
  'gc.kpi.total': 'Tổng số thẻ', 'gc.kpi.totalSub': 'Từ trước đến nay · {p} đang chờ thanh toán',
  'gc.tab.all': 'Tất cả', 'gc.tab.active': 'Đang dùng', 'gc.tab.redeemed': 'Đã dùng hết', 'gc.tab.void': 'Đã hủy',
  'gc.searchPh': 'Tìm mã thẻ hoặc 4 số cuối, tên, SĐT hoặc email (người mua hoặc người nhận)',
  'gc.roleLabel': 'Người mua hoặc người nhận', 'gc.role.all': 'Người mua hoặc người nhận', 'gc.role.purchaser': 'Người mua', 'gc.role.recipient': 'Người nhận',
  'gc.sort.issued_desc': 'Phát hành mới nhất', 'gc.sort.issued_asc': 'Phát hành cũ nhất', 'gc.sort.activity_desc': 'Hoạt động gần nhất', 'gc.sort.balance_desc': 'Số dư cao–thấp',
  'gc.sort.balance_asc': 'Số dư thấp–cao', 'gc.sort.name_asc': 'Tên A–Z', 'gc.sort.status': 'Trạng thái',
  'gc.basis.issued': 'Ngày phát hành', 'gc.basis.redemption': 'Ngày sử dụng', 'gc.basis.created': 'Ngày tạo', 'gc.basis.activity': 'Hoạt động gần nhất', 'gc.basis.expiration': 'Ngày hết hạn',
  'gc.moreFilters': 'Thêm bộ lọc', 'gc.clearAll': 'Xóa tất cả', 'gc.f.delivery': 'Loại thẻ', 'gc.delivery.all': 'Thẻ số hoặc thẻ cứng', 'gc.delivery.digital': 'Thẻ số', 'gc.delivery.physical': 'Thẻ cứng',
  'gc.f.balanceMin': 'Số dư từ ($)', 'gc.f.balanceMax': 'Số dư đến ($)', 'gc.f.denomination': 'Mệnh giá gốc ($)',
  'gc.chip.search': 'Tìm: {q}', 'gc.chip.date': '{basis}: {p}', 'gc.chip.balance': 'Số dư ${a}–${b}', 'gc.chip.denomination': 'Mệnh giá ${a}',
  'gc.matched.purchaser': 'khớp người mua', 'gc.matched.recipient': 'khớp người nhận', 'gc.matched.card': 'khớp thẻ',
  'gc.empty': 'Chưa có thẻ quà tặng', 'gc.emptyHint': 'Phát hành thẻ quà tặng để bán giá trị lưu trữ cho khách.',
  'gc.col.card': 'Thẻ', 'gc.col.purchaser': 'Người mua', 'gc.col.recipient': 'Người nhận', 'gc.col.issued': 'Phát hành', 'gc.col.original': 'Mệnh giá gốc', 'gc.col.balance': 'Số dư',
  'gc.noPurchaser': 'Chưa ghi người mua', 'gc.sameAsPurchaser': 'Người mua',
  'gc.status.active': 'Đang dùng', 'gc.status.partially_redeemed': 'Đang dùng (đã dùng một phần)', 'gc.status.redeemed': 'Đã dùng hết', 'gc.status.pending_payment': 'Chờ thanh toán',
  'gc.status.frozen': 'Tạm khóa', 'gc.status.suspended': 'Tạm ngưng', 'gc.status.void': 'Đã hủy', 'gc.status.canceled': 'Đã hủy bỏ', 'gc.status.refunded': 'Đã hoàn tiền', 'gc.status.expired': 'Hết hạn',
  'gc.status.replaced': 'Đã thay thẻ', 'gc.status.lost_stolen': 'Mất / bị đánh cắp', 'gc.status.draft': 'Bản nháp',
  'gc.notReconciled': 'Sổ cái ghi {a} — cần kiểm tra', 'gc.pendingNote': 'Thẻ này chưa có giá trị cho đến khi Thanh toán nhận tiền.',
  'gc.f.lastActivity': 'Hoạt động gần nhất', 'gc.f.expires': 'Hết hạn', 'gc.noExpiry': 'Không hết hạn', 'gc.f.pin': 'Mã PIN', 'gc.pinSet': 'Đã đặt', 'gc.noPin': 'Không có',
  'gc.t.reloaded': 'Đã nạp thêm', 'gc.t.pendingReload': '{a} đang chờ thanh toán', 'gc.t.redeemed': 'Đã dùng', 'gc.t.refundedBack': '{a} hoàn lại vào thẻ', 'gc.t.adjusted': 'Điều chỉnh / hủy',
  'gc.t.transferred': 'Đã chuyển', 'gc.t.transactions': 'Bút toán sổ cái',
  'gc.reload': 'Nạp thêm', 'gc.reloadAmount': 'Số tiền nạp thêm ($)', 'gc.reloadNote': 'Mở một phiếu cho số tiền này; số dư chỉ tăng sau khi Thanh toán nhận tiền.',
  'gc.reloadToCheckout': 'Tiếp tục tới Thanh toán', 'gc.reloadStarted': 'Đã bắt đầu nạp {a} trên phiếu #{n} — hãy thu tiền ở Thanh toán.', 'gc.enterAmount': 'Hãy nhập số tiền.',
  'gc.void': 'Hủy thẻ', 'gc.voidConfirm': 'Hủy thẻ này? Số dư {a} sẽ không dùng được nữa. Lịch sử được giữ và có thêm một bút toán hủy.', 'gc.voidReason': 'Lý do',
  'gc.voided': 'Đã hủy {card}.', 'gc.stepupVoid': 'Nhập mật khẩu để hủy thẻ quà tặng này.', 'gc.goToCheckout': 'Tới Thanh toán',
  'gc.ledger': 'Sổ cái', 'gc.noLedger': 'Chưa có bút toán nào.', 'gc.l.date': 'Ngày', 'gc.l.type': 'Loại', 'gc.l.amount': 'Số tiền', 'gc.l.before': 'Số dư trước', 'gc.l.after': 'Số dư sau',
  'gc.l.reference': 'Tham chiếu', 'gc.lstatus.pending': 'Chờ thanh toán', 'gc.lstatus.completed': 'Hoàn tất',
  'gc.ltype.activate': 'Kích hoạt', 'gc.ltype.issue': 'Phát hành', 'gc.ltype.redeem': 'Sử dụng', 'gc.ltype.redemption': 'Sử dụng', 'gc.ltype.reload': 'Nạp thêm', 'gc.ltype.reload_pending': 'Nạp thêm (chờ thanh toán)',
  'gc.ltype.void_or_adjustment': 'Hủy / điều chỉnh', 'gc.ltype.adjustment': 'Điều chỉnh', 'gc.ltype.refund': 'Hoàn lại vào thẻ', 'gc.ltype.transfer': 'Chuyển số dư', 'gc.ltype.expire': 'Hết hạn',
  'gc.balanceSub': 'Số thẻ hoặc mã chính xác — được bảo vệ và ghi lại', 'gc.balanceInput': 'Số thẻ hoặc mã', 'gc.check': 'Kiểm tra',
  'gc.balanceNote': 'Chỉ trả lời khi nhập đúng số hoặc mã. Số lần tra cứu bị giới hạn và được ghi lại.', 'gc.notFound': 'Không có thẻ nào khớp số hoặc mã đó.', 'gc.notRedeemableHere': 'không dùng được tại chi nhánh này',
  'gc.issueSub': 'Thanh toán trước — thẻ được kích hoạt khi Thanh toán nhận tiền', 'gc.f.purchaser': 'Người mua', 'gc.customerPh': 'Tìm tên hoặc SĐT khách',
  'gc.changeCustomer': 'Đổi khách', 'gc.f.amount': 'Số tiền ($)', 'gc.amountRange': 'Từ {a} đến {b}', 'gc.amountInvalid': 'Số tiền nằm ngoài giới hạn thẻ quà tặng của tiệm.',
  'gc.f.cardNumber': 'Số thẻ cứng (16 số)', 'gc.isGift': 'Thẻ này là quà tặng cho người khác', 'gc.f.rName': 'Tên người nhận', 'gc.f.rPhone': 'SĐT người nhận',
  'gc.f.rEmail': 'Email người nhận', 'gc.f.rMsg': 'Lời nhắn', 'gc.paymentFirst': 'Chưa tạo giá trị nào cho đến khi nhận tiền. Bấm hai lần cũng không tạo hai thẻ.',
  'gc.issueToCheckout': 'Tạo và tới Thanh toán', 'gc.salesOff': 'Đang tắt bán thẻ quà tặng', 'gc.salesOffHint': 'Hãy bật trong Cài đặt thẻ quà tặng.',
  'gc.issuedTitle': 'Đã tạo thẻ quà tặng', 'gc.issuedSub': 'Phiếu #{n} sẵn sàng thanh toán', 'gc.numberOnce': 'Số thẻ — chỉ hiện một lần. Hãy đưa cho khách ngay.',
  'gc.issuedHidden': 'Đã tạo {ref} nhưng bộ lọc đang ẩn thẻ này.',
  "gc.tab.pending": "Chờ thanh toán",
  "gc.tab.frozen": "Tạm khóa",
  "gc.branchLabel": "Chi nhánh",
  "gc.allBranches": "Tất cả chi nhánh",
  "gc.adjust": "Điều chỉnh số dư",
  "gc.adjust.down": "Trừ bớt",
  "gc.adjust.up": "Cộng thêm",
  "gc.adjustNow": "Số dư hiện tại {a}. Mỗi lần điều chỉnh của quản lý đều được ghi lại kèm lý do.",
  "gc.adjustReason": "Lý do",
  "gc.adjusted": "Đã điều chỉnh {card} — số dư hiện là {a}.",
  "gc.amount": "Số tiền",
  "gc.source": "Nguồn: số dư thẻ (nợ phải trả, đang dùng, tổng) và sổ giao dịch thẻ quà tặng (đã phát hành, đã dùng) trong phạm vi chi nhánh của bạn, đọc trực tiếp vào thời điểm trên. Chạm vào ô để xem chi tiết.", // DRAFT — Kevin reviews
  "gc.adjPreview": "Số dư hiện tại {now} · thay đổi {d} · số dư sau {after}", // DRAFT — Kevin reviews
  "gc.adjOver": "Vượt quá số dư — điều chỉnh không thể làm thẻ âm.", // DRAFT — Kevin reviews
  "gc.adjAudit": "Không gắn với phiếu: ghi nhận là điều chỉnh của quản lý kèm lý do, sau khi xác nhận mật khẩu, trong sổ thẻ và nhật ký kiểm tra.", // DRAFT — Kevin reviews
  "gc.integrity.ok": "Kiểm tra sổ: số dư của cả {n} thẻ đã thanh toán khớp với lịch sử giao dịch.", // DRAFT — Kevin reviews
  "gc.integrity.bad": "Kiểm tra sổ: {n} thẻ có số dư không khớp với lịch sử giao dịch của chính thẻ đó. Chưa thay đổi gì — mở thẻ để xem:", // DRAFT — Kevin reviews
  "gc.integrity.card": "Số dư {b} · sổ cộng lại {l}", // DRAFT — Kevin reviews
  "gc.review.title": "Xem lại trước khi phát hành", // DRAFT — Kevin reviews
  "gc.review.amount": "Số tiền", // DRAFT — Kevin reviews
  "gc.review.funding": "Nguồn tiền", // DRAFT — Kevin reviews
  "gc.review.fundingValue": "{purchaser} trả tại Thanh toán — thẻ ở trạng thái chờ (chưa có giá trị) cho đến khi nhận tiền", // DRAFT — Kevin reviews
  "gc.review.card": "Thẻ", // DRAFT — Kevin reviews
  "gc.review.physical": "Thẻ vật lý số cuối {last4}, lấy từ kho thẻ", // DRAFT — Kevin reviews
  "gc.review.digital": "Thẻ điện tử — số thẻ mới chỉ hiện một lần sau khi phát hành", // DRAFT — Kevin reviews
  "gc.review.recipient": "Người nhận", // DRAFT — Kevin reviews
  "gc.review.recipientSelf": "{purchaser} (không gửi tặng)", // DRAFT — Kevin reviews
  "gc.review.where": "Dùng được tại", // DRAFT — Kevin reviews
  "gc.review.allLocations": "Tất cả chi nhánh của tiệm (Cài đặt thẻ quà tặng)", // DRAFT — Kevin reviews
  "gc.review.thisLocation": "Chỉ chi nhánh này (Cài đặt thẻ quà tặng)", // DRAFT — Kevin reviews
  "gc.review.impact": "Sau khi Thanh toán nhận tiền, thẻ có giá trị sử dụng. Muốn hoàn tác phải hoàn tiền tại Thanh toán hoặc hủy thẻ kèm lý do — không bao giờ tự động đảo ngược.", // DRAFT — Kevin reviews
  "gc.replacePreview.moves": "Số dư được chuyển: {amount}, từ {from}", // DRAFT — Kevin reviews
  "gc.replacePreview.newCard": "Số dư chuyển sang một thẻ mới tại tiệm này; lịch sử đầy đủ vẫn lưu trên cả hai thẻ.", // DRAFT — Kevin reviews
  "gc.replacePreview.irreversible": "Thẻ cũ bị ngưng vĩnh viễn và không bao giờ dùng lại được.", // DRAFT — Kevin reviews
};
