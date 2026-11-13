// ns/rewardsnet.vi.ts — Loyalty & Rewards → Rewards Network (Oct 30 2026) (Vietnamese). Staff-facing Front Desk POS only.
// Glossary (docs/i18n/VI_GLOSSARY.md): Khách hàng · hóa đơn · Lưu / Hủy / Đóng. "điểm" = points; "token" kept as the
// product word for prepaid reward funding (1 token = $1).
export const REWARDSNET_VI = {
  'rn.view.program': 'Chương trình của tiệm', 'rn.view.network': 'Mạng lưới điểm thưởng', 'rn.view.label': 'Chế độ xem điểm thưởng',
  'rn.loadFailed': 'Không tải được mạng lưới điểm thưởng. Hãy thử lại.', 'rn.noPermission': 'Chỉ chủ tiệm (hoặc quản lý có quyền cài đặt) mới đổi được mục này.',
  'rn.stepUp': 'Thay đổi cách tiệm nạp tiền cho điểm thưởng cần nhập mật khẩu của bạn.',
  'rn.rate': '{spend} = {points} điểm', 'rn.rate.one': '{spend} = 1 điểm', 'rn.rate.min': 'Hóa đơn tối thiểu {amount}', 'rn.rate.cap': 'Tối đa {points} điểm mỗi hóa đơn', 'rn.rate.noCap': 'Áp dụng giới hạn của mạng lưới',
  'rn.value': '{points} điểm = {amount}',
  'rn.mode.global': 'AI PowerSalon chung', 'rn.mode.custom': 'Quy tắc riêng của tiệm', 'rn.mode.globalShort': 'Chung', 'rn.mode.customShort': 'Riêng',
  'rn.source.global': 'Mặc định chung của AI PowerSalon', 'rn.source.custom': 'Quy tắc riêng của tiệm', 'rn.globalRules': 'Quy tắc chung của AI PowerSalon',
  'rn.kpi.mode': 'Chế độ tích điểm', 'rn.kpi.scheduledSub': 'Đã hẹn: {mode} từ {date}', 'rn.kpi.rate': 'Tỷ lệ tích điểm hiện tại', 'rn.kpi.earningOff': 'Hiện chưa tích điểm',
  'rn.kpi.tokens': 'Token hiện có', 'rn.kpi.tokensSub': '{value} đã nạp · {level}', 'rn.kpi.value': 'Giá trị điểm thưởng', 'rn.kpi.valueSub': 'Do AI PowerSalon quy định · 1 token = {token}',
  'rn.kpi.pending': 'Đang chờ nạp', 'rn.kpi.pendingSub': '{n} lần mua đang xác minh · đã dùng {used} tháng này',
  'rn.alert.ok': 'Ổn định', 'rn.alert.low': 'Sắp hết', 'rn.alert.critical': 'Gần hết', 'rn.alert.empty': 'Đã hết — khách hàng không được tích điểm',
  'rn.earning.title': 'Quy tắc tích điểm', 'rn.earning.true': 'Đang áp dụng: {source}',
  'rn.off': 'Mạng lưới điểm thưởng AI PowerSalon chưa được bật cho tiệm này. Chương trình riêng của tiệm vẫn hoạt động như cũ.',
  'rn.notEnrolled': 'Tiệm này chưa tham gia mạng lưới điểm thưởng AI PowerSalon.', 'rn.earnPaused': 'AI PowerSalon đang tạm dừng tích điểm trên toàn mạng lưới.',
  'rn.custom.kept': 'Quy tắc tích điểm riêng đã tắt cho thay đổi mới. Quy tắc riêng hiện tại vẫn áp dụng cho đến khi tiệm chuyển sang quy tắc chung.',
  'rn.custom.off': 'Quy tắc tích điểm riêng chưa được bật cho tiệm này.',
  'rn.current': 'Hiện tại:', 'rn.since': 'từ {date}', 'rn.globalNext': 'Quy tắc chung sẽ đổi thành {rate} vào {date}.',
  'rn.scheduledAndDrafts': 'Thay đổi đã hẹn và bản nháp', 'rn.scheduledLine': '{mode} từ {date}', 'rn.draftLine': 'Bản nháp #{n}',
  'rn.cancelChange': 'Hủy thay đổi', 'rn.editDraft': 'Sửa bản nháp', 'rn.discardDraft': 'Bỏ bản nháp',
  'rn.setCustom': 'Đặt quy tắc riêng', 'rn.changeCustom': 'Đổi quy tắc riêng', 'rn.useGlobal': 'Dùng quy tắc chung',
  'rn.customNote': 'Quy tắc riêng chỉ đổi tốc độ khách hàng tích điểm. Giá trị của điểm ({value}) và giá trị của token không bao giờ thay đổi.',
  'rn.wallet.title': 'Ví token & lần mua', 'rn.buy': 'Mua Token', 'rn.noPurchases': 'Chưa có lần mua token nào.',
  'rn.buy.noProvider': 'Chưa thể mua token: chưa kết nối nhà cung cấp thanh toán được duyệt.', 'rn.buy.off': 'Việc mua token chưa được bật cho tiệm này.',
  'rn.buy.paused': 'Việc mua token đang tạm dừng.', 'rn.purchaseLine': '{tokens} token', 'rn.details': 'Chi tiết',
  'rn.ledger.title': 'Hoạt động token', 'rn.noLedger': 'Chưa có hoạt động token.', 'rn.balanceAfter': 'Số dư {n}',
  'rn.le.purchase_funded': 'Đã nạp từ lần mua', 'rn.le.earn_allocation': 'Trả cho điểm của một hóa đơn', 'rn.le.earn_reversal': 'Hoàn lại do hoàn tiền', 'rn.le.purchase_reversal': 'Lần mua bị đảo ngược', 'rn.le.adjustment': 'Điều chỉnh',
  'rn.history.title': 'Lịch sử quy tắc tích điểm', 'rn.noHistory': 'Chưa có thay đổi — tiệm luôn dùng quy tắc chung.',
  'rn.versionLine': 'Phiên bản {n} · {mode}', 'rn.from': 'Từ {date}', 'rn.createdOn': 'Tạo lúc {date}',
  'rn.state.ACTIVE': 'Đang áp dụng', 'rn.state.SCHEDULED': 'Đã hẹn', 'rn.state.DRAFT': 'Bản nháp', 'rn.state.SUPERSEDED': 'Đã thay thế', 'rn.state.DISCARDED': 'Đã bỏ', 'rn.state.CANCELED': 'Đã hủy',
  'rn.facts': 'Cách hoạt động', 'rn.fact.funded': 'Mỗi điểm khách hàng tích ở đây được trả trước bằng token của tiệm. Khách hàng có thể dùng điểm ở bất kỳ tiệm nào trong mạng lưới.',
  'rn.fact.sandbox': 'Chế độ thử: lần mua dùng nhà cung cấp thử nghiệm — không có tiền thật.', 'rn.fact.noProvider': 'Mua Token đang chờ nhà cung cấp thanh toán được duyệt.',
  // custom rule editor
  'rn.custom.title': 'Quy tắc tích điểm riêng', 'rn.custom.editDraftTitle': 'Sửa bản nháp #{n}', 'rn.custom.reviewTitle': 'Xem lại và kích hoạt',
  'rn.custom.sub': 'Mỗi đô la ở tiệm này được bao nhiêu điểm. Token của tiệm trả cho mọi điểm.',
  'rn.f.spend': 'Cứ mỗi ($)', 'rn.f.points': 'Khách hàng được (điểm)', 'rn.f.minimum': 'Hóa đơn tối thiểu để tích ($)', 'rn.f.cap': 'Tối đa điểm mỗi hóa đơn', 'rn.f.capPh': 'Giới hạn mạng lưới',
  'rn.f.when': 'Bắt đầu', 'rn.f.now': 'Ngay', 'rn.f.later': 'Sau', 'rn.f.at': 'Ngày giờ bắt đầu', 'rn.f.reason': 'Ghi chú (không bắt buộc)',
  'rn.v.spend': 'Nhập số tiền, ví dụ 5.00.', 'rn.v.points': 'Điểm phải lớn hơn 0, theo bước 0.1.', 'rn.v.minimum': 'Nhập mức tối thiểu bằng đô la, ví dụ 0.00.', 'rn.v.cap': 'Giới hạn mỗi hóa đơn phải lớn hơn 0, theo bước 0.1 — hoặc để trống.',
  'rn.limits': 'Cho phép: mỗi {min}–{max}; tối đa {pts} điểm mỗi bước và {cap} điểm mỗi hóa đơn.',
  'rn.preview.wait': 'Nhập quy tắc hợp lệ để xem chi phí.', 'rn.preview.caption': 'Khách hàng được bao nhiêu điểm và tốn bao nhiêu token',
  'rn.preview.sale': 'Hóa đơn', 'rn.preview.points': 'Điểm', 'rn.preview.cost': 'Token dùng', 'rn.preview.global': 'Quy tắc chung', 'rn.preview.globalCell': '{points} điểm · {tokens} token', 'rn.preview.diff': 'Chênh lệch',
  'rn.custom.never': 'Không bao giờ đổi: {value} · 1 token = {token}.',
  'rn.saveDraft': 'Lưu bản nháp', 'rn.reviewActivate': 'Xem lại & Kích hoạt', 'rn.back': 'Quay lại', 'rn.confirmActivate': 'Kích hoạt ngay', 'rn.confirmSchedule': 'Hẹn thay đổi',
  'rn.review.before': 'Trước', 'rn.review.after': 'Sau', 'rn.review.starts': 'Bắt đầu', 'rn.review.immediately': 'Ngay lập tức',
  'rn.review.rules': 'Hóa đơn đã thanh toán giữ nguyên quy tắc lúc thanh toán. Điểm chỉ được cộng khi ví còn token — nếu hết, hóa đơn không được tích điểm cho đến khi mua thêm (không tự chuyển sang quy tắc chung).',
  // return to global
  'rn.global.title': 'Dùng quy tắc chung của AI PowerSalon', 'rn.global.body': 'Khách hàng sẽ tích điểm theo tỷ lệ chung ({rate}). Điểm đã tích và token của tiệm giữ nguyên.',
  'rn.global.confirm': 'Đồng ý, chuyển tiệm sang quy tắc chung.',
  // buy tokens
  'rn.buy.title': 'Mua Token', 'rn.buy.reviewTitle': 'Xem lại lần mua', 'rn.buy.pendingTitle': 'Đang chờ xác minh', 'rn.buy.doneTitle': 'Đã gửi lần mua',
  'rn.buy.sub': 'Token trả cho điểm khách hàng tích được. 1 token = {token}.', 'rn.buy.amount': 'Số token',
  'rn.buy.other': 'Số khác (1–{max} token)', 'rn.buy.qtyBad': 'Chọn từ 1 đến {max} token.', 'rn.buy.review': 'Xem lại',
  'rn.buy.funds': 'Token chỉ dùng được sau khi nhà cung cấp thanh toán xác minh tiền. Trước đó token hiển thị là đang chờ.',
  'rn.buy.tokens': 'Token', 'rn.buy.total': 'Tổng', 'rn.buy.balanceNow': 'Ví hiện tại', 'rn.buy.paidBy': 'Thanh toán qua', 'rn.buy.sandbox': 'Thử nghiệm (không có tiền thật)', 'rn.buy.provider': 'Nhà cung cấp thanh toán được duyệt',
  'rn.buy.confirm': 'Xác nhận {amount}', 'rn.buy.submitting': 'Đang gửi…', 'rn.buy.resuming': 'Đây là tiếp tục cùng một lần mua — sẽ không bị trừ tiền hai lần.',
  'rn.buy.lost': 'Chưa nhận được phản hồi. Lần mua được giữ ở trạng thái “Đang chờ xác minh” và sẽ không bị trừ tiền hai lần. Hãy kiểm tra lại sau ít phút.',
  'rn.buy.checkAgain': 'Kiểm tra lại', 'rn.done': 'Xong',
  'rn.ps.REQUESTED': 'Đã yêu cầu', 'rn.ps.PROCESSING': 'Đang xử lý', 'rn.ps.UNKNOWN': 'Đang chờ xác minh', 'rn.ps.PAYMENT_CONFIRMED': 'Đã xác nhận thanh toán', 'rn.ps.SETTLEMENT_PENDING': 'Đang chờ quyết toán',
  'rn.ps.FUNDS_VERIFIED': 'Đã xác minh tiền', 'rn.ps.FAILED': 'Thất bại', 'rn.ps.DECLINED': 'Bị từ chối', 'rn.ps.REVERSED': 'Đã đảo ngược', 'rn.ps.CHARGED_BACK': 'Bị bồi hoàn', 'rn.ps.CANCELED': 'Đã hủy',
  'rn.psHelp.REQUESTED': 'Đang chờ gửi tới nhà cung cấp thanh toán.', 'rn.psHelp.PROCESSING': 'Nhà cung cấp thanh toán đang xử lý.',
  'rn.psHelp.UNKNOWN': 'Mất phản hồi. Đang xác minh — sẽ không bị trừ tiền hai lần.', 'rn.psHelp.PAYMENT_CONFIRMED': 'Đã xác nhận thanh toán. Token dùng được khi tiền được xác minh.',
  'rn.psHelp.SETTLEMENT_PENDING': 'Đang chờ tiền về. Token dùng được khi tiền được xác minh.', 'rn.psHelp.FUNDS_VERIFIED': 'Đã xác minh tiền — token đã vào ví của tiệm.',
  'rn.psHelp.FAILED': 'Lần mua thất bại. Không có gì được cộng.', 'rn.psHelp.DECLINED': 'Thanh toán bị từ chối. Không có gì được cộng.', 'rn.psHelp.REVERSED': 'Lần mua đã bị đảo ngược.',
  'rn.psHelp.CHARGED_BACK': 'Thanh toán đã bị bồi hoàn.', 'rn.psHelp.CANCELED': 'Lần mua đã bị hủy.',
  'rn.purchase.title': 'Lần mua token', 'rn.purchase.timeline': 'Lịch sử trạng thái', 'rn.status': 'Trạng thái', 'rn.requested': 'Đã yêu cầu', 'rn.confirmed': 'Đã xác nhận thanh toán', 'rn.funded': 'Đã xác minh tiền', 'rn.ref': 'Mã tham chiếu', 'rn.fee': 'phí {amount}',
  // notes + errors
  'rn.note.draftSaved': 'Đã lưu bản nháp. Quy tắc đang áp dụng không đổi.', 'rn.note.activated': 'Quy tắc tích điểm riêng đã được áp dụng.', 'rn.note.scheduled': 'Đã hẹn quy tắc tích điểm riêng vào {date}.',
  'rn.note.global': 'Tiệm đang dùng quy tắc chung của AI PowerSalon.', 'rn.note.globalScheduled': 'Đã hẹn chuyển về quy tắc chung vào {date}.',
  'rn.note.canceled': 'Đã hủy thay đổi đã hẹn.', 'rn.note.discarded': 'Đã bỏ bản nháp.',
  'rn.note.buyPending': 'Đã gửi lần mua token. Đang xác minh.', 'rn.note.buyFunded': 'Đã cộng token vào ví.', 'rn.note.buySent': 'Đã cập nhật lần mua token.',
  'rn.err.cancel': 'Không hủy được thay đổi.', 'rn.err.discard': 'Không bỏ được bản nháp.', 'rn.err.preview': 'Không tính được bản xem trước.', 'rn.err.save': 'Không lưu được bản nháp.',
  'rn.err.activate': 'Không kích hoạt được quy tắc.', 'rn.err.global': 'Không chuyển được sang quy tắc chung.', 'rn.err.buy': 'Không mua được token.', 'rn.err.load': 'Không tải được lần mua này.',
  // Checkout tender (Final Completion guide §04)
  'rn.co.label': 'Điểm thưởng AI PowerSalon',
  'rn.co.held': 'Đang giữ {points} điểm · −{amount} (trừ khi thanh toán xong)',
  'rn.co.redeemed': 'Đã dùng {points} điểm · −{amount}',
  'rn.co.remove': 'Bỏ điểm thưởng',
  'rn.co.notJoined': 'Khách hàng chưa tham gia AI PowerSalon Rewards',
  'rn.co.notVerified': 'Khách hàng cần tài khoản điểm thưởng đã xác minh',
  'rn.co.off': 'Hiện không dùng được ở tiệm này',
  'rn.co.notEnrolled': 'Tiệm này chưa tham gia mạng lưới điểm thưởng',
  'rn.co.notEnough': '{points} điểm — cần {need} điểm cho $1',
  'rn.levels.btn': 'Mức cảnh báo',
  'rn.levels.title': 'Cảnh báo số dư token',
  'rn.levels.body': 'Tiệm được cảnh báo khi số dư token còn bằng các mức này. Để trống để dùng mặc định của AI PowerSalon (thấp {low}, nguy cấp {critical}).',
  'rn.levels.low': 'Cảnh báo thấp tại ($)',
  'rn.levels.critical': 'Cảnh báo nguy cấp tại ($)',
  'rn.levels.save': 'Lưu mức',
  'rn.levels.saved': 'Đã lưu mức cảnh báo.',
  'rn.levels.failed': 'Không lưu được mức cảnh báo.',
  'rn.co.earns': 'Hóa đơn này sẽ được khoảng {points} điểm khi thanh toán',
  'rn.co.earnsBelowMin': 'Hóa đơn này chưa đạt mức tối thiểu để tích điểm',
  'rn.co.earnsNone': 'Hóa đơn này chưa đủ một bậc tích điểm',
  'rn.co.has': 'Có {points} điểm',
  'rn.co.amount': 'Số điểm thưởng dùng',
  'rn.co.option': '{amount} ({points} điểm)',
  'rn.co.use': 'Dùng điểm thưởng',
  'rn.co.failed': 'Không áp dụng được điểm thưởng.',
  'rn.forecast.days': 'Ước tính: còn khoảng {n} ngày token theo mức dùng tháng này', // DRAFT — Kevin reviews
  'rn.forecast.none': 'Tháng này chưa dùng token — chưa có ước tính', // DRAFT — Kevin reviews
  'rn.branches.btn': 'Theo chi nhánh', // DRAFT — Kevin reviews
  'rn.branches.title': 'Dùng ví theo chi nhánh', // DRAFT — Kevin reviews
  'rn.branches.since': 'Tháng này của tiệm, từ {date}. Một ví chung cho cả tiệm; mỗi dòng là phần chi nhánh đó tích điểm và nhận thưởng.', // DRAFT — Kevin reviews
  'rn.branches.none': 'Tháng này chưa có tích điểm hay đổi thưởng', // DRAFT — Kevin reviews
  'rn.branches.branch': 'Chi nhánh', // DRAFT — Kevin reviews
  'rn.branches.earnings': 'Lượt tích điểm', // DRAFT — Kevin reviews
  'rn.branches.points': 'Điểm', // DRAFT — Kevin reviews
  'rn.branches.funded': 'Token đã dùng', // DRAFT — Kevin reviews
  'rn.branches.redeemed': 'Thưởng đã nhận', // DRAFT — Kevin reviews
  'rn.branches.redeemedCell': '{n} · {amount}', // DRAFT — Kevin reviews
  'rn.branches.unassigned': 'Không ghi chi nhánh', // DRAFT — Kevin reviews
  'rn.branches.matches': 'Các chi nhánh khớp với ví: đã dùng {n} token tháng này.', // DRAFT — Kevin reviews
  'rn.branches.mismatch': 'Các chi nhánh cộng lại {a} token nhưng ví ghi đã dùng {b} tháng này — hãy nhờ hỗ trợ kiểm tra.', // DRAFT — Kevin reviews
  'rn.branches.noDouble': 'Không có lượt tích điểm nào bị trừ token hai lần.', // DRAFT — Kevin reviews
  'rn.branches.double': '{n} lượt tích điểm bị trừ token nhiều hơn một lần — hãy nhờ hỗ trợ kiểm tra.', // DRAFT — Kevin reviews
  'rn.pay.btn': 'Tiền hoàn trả', // DRAFT — Kevin reviews
  'rn.pay.title': 'Tiền mạng lưới nợ tiệm', // DRAFT — Kevin reviews
  'rn.pay.sub': 'Điểm của mạng lưới thưởng mà tiệm đã nhận khi thanh toán. Chỉ xem: mạng lưới chi trả, không bao giờ chi trả từ đây.', // DRAFT — Kevin reviews
  'rn.pay.providerOn': 'Đã kết nối nhà cung cấp chi trả.', // DRAFT — Kevin reviews
  'rn.pay.providerOff': 'Chưa kết nối nhà cung cấp chi trả nên chưa thể chi trả. Mọi khoản vẫn được ghi nợ cho tiệm.', // DRAFT — Kevin reviews
  'rn.pay.lastVerified': 'Lần quyết toán đã xác minh gần nhất: {date}', // DRAFT — Kevin reviews
  'rn.pay.noVerified': 'Chưa có lần quyết toán nào được xác minh.', // DRAFT — Kevin reviews
  'rn.pay.waiting': 'Đang chờ: {n} lệnh chi trả đã gửi nhà cung cấp, đang chờ quyết toán (lâu nhất từ {date}).', // DRAFT — Kevin reviews
  'rn.pay.noWaiting': 'Đang chờ: không có lệnh chi trả nào chờ nhà cung cấp.', // DRAFT — Kevin reviews
  'rn.pay.unknown': 'Không rõ: {n} lệnh chi trả không nhận được trả lời từ nhà cung cấp (lâu nhất từ {date}). Không tính là đã trả hay thất bại.', // DRAFT — Kevin reviews
  'rn.pay.noUnknown': 'Không rõ: không có.', // DRAFT — Kevin reviews
  'rn.pay.all': 'Tất cả ({n})', // DRAFT — Kevin reviews
  'rn.pay.totalChip': '{label} · {n} · {amount}', // DRAFT — Kevin reviews
  'rn.pay.none': 'Chưa có khoản hoàn trả nào', // DRAFT — Kevin reviews
  'rn.pay.line': '{amount} · {status}', // DRAFT — Kevin reviews
  'rn.pay.amount': 'Số tiền', // DRAFT — Kevin reviews
  'rn.pay.adjusted': '{amount} bị trừ do hoàn tiền', // DRAFT — Kevin reviews
  'rn.pay.holdReason': 'Lý do tạm giữ', // DRAFT — Kevin reviews
  'rn.pay.paidAt': 'Đã trả', // DRAFT — Kevin reviews
  'rn.pay.ref': 'mã quyết toán {ref}', // DRAFT — Kevin reviews
  'rn.pay.attempts': 'Các lần chi trả (trả lời của nhà cung cấp)', // DRAFT — Kevin reviews
  'rn.pay.noAttempts': 'Chưa có lần chi trả nào.', // DRAFT — Kevin reviews
  'rn.pay.attemptLine': '{amount} yêu cầu lúc {date}', // DRAFT — Kevin reviews
  'rn.pay.verified': 'chữ ký đã xác minh', // DRAFT — Kevin reviews
  'rn.pay.settledAt': 'quyết toán lúc {date}', // DRAFT — Kevin reviews
  'rn.pay.adjustments': 'Điều chỉnh', // DRAFT — Kevin reviews
  'rn.pay.journal': 'Bút toán trên tài khoản của tiệm', // DRAFT — Kevin reviews
  'rn.pay.j.entry': 'Bút toán', // DRAFT — Kevin reviews
  'rn.pay.j.account': 'Tài khoản', // DRAFT — Kevin reviews
  'rn.pay.j.debit': 'Nợ', // DRAFT — Kevin reviews
  'rn.pay.j.credit': 'Có', // DRAFT — Kevin reviews
  'rn.pay.j.at': 'Lúc', // DRAFT — Kevin reviews
  'rn.pay.st.ACCRUED_OWED': 'Đang nợ', // DRAFT — Kevin reviews
  'rn.pay.st.PAYOUT_ELIGIBLE': 'Sẵn sàng chi trả', // DRAFT — Kevin reviews
  'rn.pay.st.PAYOUT_PENDING': 'Đang chi trả', // DRAFT — Kevin reviews
  'rn.pay.st.PAID': 'Đã trả', // DRAFT — Kevin reviews
  'rn.pay.st.PAYOUT_FAILED': 'Chi trả thất bại', // DRAFT — Kevin reviews
  'rn.pay.st.ON_HOLD': 'Tạm giữ', // DRAFT — Kevin reviews
  'rn.pay.st.ADJUSTED': 'Đã đảo (hoàn tiền)', // DRAFT — Kevin reviews
  'rn.pay.st.OFFSET': 'Yêu cầu thu hồi', // DRAFT — Kevin reviews
  'rn.pay.stage.PAYABLE': 'Phải trả', // DRAFT — Kevin reviews
  'rn.pay.stage.PROCESSING': 'Đang xử lý', // DRAFT — Kevin reviews
  'rn.pay.stage.PAID': 'Đã trả', // DRAFT — Kevin reviews
  'rn.pay.stage.EXCEPTION': 'Ngoại lệ', // DRAFT — Kevin reviews
  'rn.pay.stage.CLOSED': 'Đã đóng', // DRAFT — Kevin reviews
  'rn.pay.why.owed_awaiting_review': 'Đang nợ; chờ mạng lưới kiểm tra sổ sách trước khi chi trả.', // DRAFT — Kevin reviews
  'rn.pay.why.owed_no_provider': 'Đang nợ; chưa kết nối nhà cung cấp chi trả.', // DRAFT — Kevin reviews
  'rn.pay.why.eligible_awaiting_payout': 'Đã duyệt chi trả; đang chờ gửi.', // DRAFT — Kevin reviews
  'rn.pay.why.eligible_no_provider': 'Đã duyệt chi trả nhưng chưa kết nối nhà cung cấp chi trả.', // DRAFT — Kevin reviews
  'rn.pay.why.pending_provider_answer': 'Đã gửi nhà cung cấp; đang chờ quyết toán.', // DRAFT — Kevin reviews
  'rn.pay.why.pending_provider_unknown': 'Đã gửi nhưng nhà cung cấp không trả lời. Chưa trả cho đến khi có quyết toán đã xác minh.', // DRAFT — Kevin reviews
  'rn.pay.why.paid_verified_settlement': 'Đã trả: quyết toán của nhà cung cấp đã được xác minh và khớp số tiền.', // DRAFT — Kevin reviews
  'rn.pay.why.payout_failed_still_owed': 'Chi trả thất bại; khoản tiền vẫn được ghi nợ.', // DRAFT — Kevin reviews
  'rn.pay.why.on_hold_finance_review': 'Tạm giữ để bộ phận tài chính xem xét; khoản tiền vẫn được ghi nợ.', // DRAFT — Kevin reviews
  'rn.pay.why.adjusted_refund_before_payout': 'Đã đảo: phần thưởng được hoàn tiền trước khi chi trả.', // DRAFT — Kevin reviews
  'rn.pay.why.offset_refund_after_payout': 'Hoàn tiền sau khi đã chi trả: mạng lưới ghi một yêu cầu thu hồi.', // DRAFT — Kevin reviews
  'rn.pay.at.REQUESTED': 'Đã yêu cầu', // DRAFT — Kevin reviews
  'rn.pay.at.SUBMITTED': 'Đang chờ', // DRAFT — Kevin reviews
  'rn.pay.at.SETTLED': 'Đã quyết toán', // DRAFT — Kevin reviews
  'rn.pay.at.FAILED': 'Thất bại', // DRAFT — Kevin reviews
  'rn.pay.at.UNKNOWN': 'Không rõ', // DRAFT — Kevin reviews
  'rn.pay.fail.PROVIDER_NO_ANSWER': 'nhà cung cấp không trả lời', // DRAFT — Kevin reviews
  'rn.pay.adj.ADJUSTMENT': 'Hoàn tiền trước khi chi trả', // DRAFT — Kevin reviews
  'rn.pay.adj.OFFSET_CLAIM': 'Yêu cầu thu hồi sau khi chi trả', // DRAFT — Kevin reviews
  'rn.pay.je.redemption_committed': 'Nhận điểm', // DRAFT — Kevin reviews
  'rn.pay.je.redemption_reversed': 'Hoàn tiền đảo điểm', // DRAFT — Kevin reviews
  'rn.pay.je.reimbursement_paid': 'Chi trả đã quyết toán', // DRAFT — Kevin reviews
  'rn.pay.je.reimbursement_offset': 'Yêu cầu thu hồi', // DRAFT — Kevin reviews
  'rn.pay.acct.reimbursement_payable': 'Nợ tiệm', // DRAFT — Kevin reviews
  'rn.pay.acct.merchant_recovery_receivable': 'Thu hồi từ tiệm', // DRAFT — Kevin reviews
};
