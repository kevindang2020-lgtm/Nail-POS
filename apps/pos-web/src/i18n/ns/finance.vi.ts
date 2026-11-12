// ns/finance.vi.ts — the POS "finance" namespace, Vietnamese (staff-facing; the customer invoice PDF stays English). Terms:
// settlement = (lô) quyết toán · processor = bộ xử lý thanh toán · bank deposit = tiền về ngân hàng · payout = khoản chi trả ·
// reconciliation = đối soát · match / unmatch = khớp / bỏ khớp · allocation = phân bổ. Listed in docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md (A37).
export const FINANCE_VI: Record<string, string> = {
  // ── shared ──
  'finance.actions': 'Thao tác', 'finance.active': 'Đang dùng', 'finance.allProcessors': 'Tất cả bộ xử lý', 'finance.allStatuses': 'Tất cả trạng thái',
  'finance.change': 'Đổi', 'finance.clearFilters': 'Xóa bộ lọc', 'finance.clearSearch': 'Xóa tìm kiếm', 'finance.exportCsv': 'Xuất CSV',
  'finance.exportDetail': 'Xuất chi tiết', 'finance.exportPdf': 'Xuất PDF', 'finance.exportReport': 'Xuất báo cáo', 'finance.exported': 'Đã tải tệp xuất (thao tác đã được ghi lại).',
  'finance.filters': 'Bộ lọc', 'finance.noLinkedCustomer': 'Không có khách liên kết', 'finance.noMatches': 'Không có bản ghi phù hợp.', 'finance.noneReported': 'Không báo cáo',
  'finance.notBankVerified': 'Chưa xác minh với ngân hàng', 'finance.notSet': 'Chưa đặt', 'finance.notSuppliedByProcessor': 'Bộ xử lý không cung cấp', 'finance.notSuppliedShort': 'Không có',
  'finance.notVerified': 'Chưa xác minh', 'finance.openCustomer': 'Mở hồ sơ khách', 'finance.processor': 'Bộ xử lý', 'finance.reason': 'Lý do', 'finance.refresh': 'Làm mới',
  'finance.removeFilter': 'Bỏ bộ lọc {f}', 'finance.resetFilters': 'Đặt lại bộ lọc', 'finance.review': 'Xem xét', 'finance.sort': 'Sắp xếp', 'finance.status': 'Trạng thái', 'finance.total': 'Tổng',
  'finance.tryThisYear': 'Thử Năm nay', 'finance.unmatched': 'Đã bỏ khớp', 'finance.view': 'Xem', 'finance.viewRecord': 'Xem bản ghi',
  'finance.state.forbidden': 'Vai trò của bạn không được xem thông tin này.', 'finance.state.forbiddenHint': 'Hỏi chủ tiệm nếu bạn cần quyền truy cập.',
  'finance.state.loadFailed': 'Không tải được dữ liệu này.', 'finance.state.searchUnavailable': 'Tìm kiếm tạm thời không dùng được.', 'finance.state.unavailable': 'Không kết nối được máy chủ. Không hiển thị $0.00 cho đến khi có phản hồi.',
  'finance.period.label': 'Kỳ báo cáo', 'finance.period.all': 'Tất cả', 'finance.period.today': 'Hôm nay', 'finance.period.week': 'Tuần này', 'finance.period.month': 'Tháng này', 'finance.period.year': 'Năm nay',
  'finance.period.custom': 'Khoảng tùy chọn', 'finance.period.allTime': 'Mọi thời gian', 'finance.period.dateField': 'Theo ngày',
  'finance.cal.apply': 'Áp dụng', 'finance.cal.clear': 'Xóa', 'finance.cal.customRange': 'Khoảng ngày tùy chọn', 'finance.cal.from': 'Từ', 'finance.cal.to': 'Đến', 'finance.cal.pick': 'Chọn ngày',
  'finance.cal.hintFrom': 'Chọn ngày đầu tiên.', 'finance.cal.hintTo': 'Chọn ngày cuối cùng (được tính vào).', 'finance.cal.month': 'Tháng', 'finance.cal.year': 'Năm',
  'finance.cal.monthA': 'Tháng thứ nhất', 'finance.cal.monthB': 'Tháng thứ hai', 'finance.cal.nextMonth': 'Tháng sau', 'finance.cal.prevMonth': 'Tháng trước',
  'finance.cal.notAfter': 'Không sau {d}', 'finance.cal.toBeforeFrom': 'Ngày “Đến” phải bằng hoặc sau ngày “Từ”.',
  'finance.basis.settlement_date': 'Ngày quyết toán', 'finance.basis.expected_payout': 'Ngày dự kiến chi trả', 'finance.basis.created': 'Ngày tạo', 'finance.basis.refund_date': 'Ngày hoàn tiền',
  'finance.drBasis.settlement': 'Ngày quyết toán', 'finance.drBasis.expected_deposit': 'Ngày dự kiến tiền về', 'finance.drBasis.bank_posted': 'Ngày ngân hàng ghi nhận', 'finance.drBasis.payment': 'Ngày thanh toán', 'finance.drBasis.created': 'Ngày tạo',
  'finance.basisIv.issued': 'Ngày lập', 'finance.basisIv.due': 'Ngày đến hạn', 'finance.basisIv.created': 'Ngày tạo', 'finance.basisIv.paid': 'Ngày thanh toán',
  'finance.processorName.cardpointe': 'CardPointe', 'finance.processorName.fiserv': 'Fiserv', 'finance.processorName.payanywhere': 'PayAnywhere', 'finance.processorName.clover': 'Clover',
  'finance.provider.pending': 'Đang chờ', 'finance.provider.settled': 'Đã quyết toán', 'finance.provider.posted': 'Đã chi trả', 'finance.provider.needs_review': 'Cần xem xét', 'finance.provider.failed': 'Thất bại', 'finance.provider.returned': 'Bị trả lại',
  'finance.bank.unverified': 'Chưa xác minh', 'finance.bank.partial': 'Khớp một phần', 'finance.bank.matched': 'Đã khớp ngân hàng',
  'finance.refund.requested': 'Đã yêu cầu', 'finance.refund.processing': 'Đang xử lý', 'finance.refund.completed': 'Hoàn tất', 'finance.refund.failed': 'Thất bại', 'finance.refund.reversed': 'Đã đảo / hủy',
  'finance.matchedBy.settlement': 'Mã quyết toán', 'finance.matchedBy.payment': 'Giao dịch thanh toán', 'finance.matchedBy.amount': 'Số tiền', 'finance.matchedBy.bank_deposit': 'Tiền về ngân hàng đã liên kết', 'finance.matchedBy.funding_account': 'Tài khoản nhận',
  'finance.matchedBy.processor': 'Bộ xử lý', 'finance.matchedBy.customer': 'Khách (qua thanh toán)', 'finance.matchedBy.refund': 'Mã hoàn tiền', 'finance.matchedBy.exception': 'Ngoại lệ',
  'finance.method.card': 'Thẻ', 'finance.method.cash': 'Tiền mặt', 'finance.method.gift_card': 'Thẻ quà tặng',
  'finance.sortBy.created_desc': 'Mới tạo nhất', 'finance.sortBy.created_asc': 'Tạo lâu nhất', 'finance.sortBy.settled_desc': 'Ngày quyết toán mới nhất', 'finance.sortBy.settled_asc': 'Ngày quyết toán cũ nhất',
  'finance.sortBy.gross_desc': 'Tổng gộp: cao → thấp', 'finance.sortBy.gross_asc': 'Tổng gộp: thấp → cao', 'finance.sortBy.net_desc': 'Chi trả ròng: cao → thấp', 'finance.sortBy.net_asc': 'Chi trả ròng: thấp → cao',
  'finance.sortBy.amount_desc': 'Số tiền: cao → thấp', 'finance.sortBy.amount_asc': 'Số tiền: thấp → cao',
  // ── Deposits & Settlements ──
  'finance.st.title': 'Tiền về & Quyết toán', 'finance.st.subtitle': 'Quyết toán của bộ xử lý, hoàn tiền, phí và tiền về ngân hàng đã xác nhận',
  'finance.st.refreshHint': 'Tải lại những gì hệ thống đã nhận. Không yêu cầu bộ xử lý gửi dữ liệu mới.', 'finance.st.viewRecon': 'Xem Đối soát tiền về',
  'finance.st.searchPh': 'Tìm mã quyết toán, giao dịch, hoàn tiền, số tiền, tên hoặc SĐT khách…', 'finance.st.providerStatus': 'Trạng thái bộ xử lý', 'finance.st.bankState': 'Khớp ngân hàng',
  'finance.st.configureProcessor': 'Cài đặt bộ xử lý',
  'finance.st.source.not_configured': 'Tiệm chưa kết nối bộ xử lý thẻ — số liệu quyết toán không thể hiển thị là đã xác minh.',
  'finance.st.source.inactive': 'Kết nối bộ xử lý thẻ không hoạt động — dữ liệu có thể thiếu hoặc cũ.',
  'finance.st.source.awaiting_first_settlement': 'Đã kết nối bộ xử lý; chưa nhận lô quyết toán nào.',
  'finance.st.source.connected': 'Đã kết nối bộ xử lý',
  'finance.st.kpi.settlements': 'Quyết toán', 'finance.st.kpi.settlementsSub': 'Lô của bộ xử lý · {basis}', 'finance.st.kpi.gross': 'Gộp đã quyết toán', 'finance.st.kpi.grossSub': 'Theo báo cáo của bộ xử lý',
  'finance.st.kpi.fees': 'Phí bộ xử lý', 'finance.st.kpi.feesSub': 'Trừ trong lô · phí tháng không được cung cấp', 'finance.st.kpi.net': 'Chi trả ròng của bộ xử lý', 'finance.st.kpi.netSubBank': 'Ngân hàng xác nhận {v}',
  'finance.st.kpi.refunds': 'Hoàn tiền', 'finance.st.kpi.refundsSub': '{c} hoàn tất · {o} đang mở · {f} thất bại', 'finance.st.kpi.refundsTotal': 'Tổng hoàn tiền', 'finance.st.kpi.refundsTotalSub': 'Chỉ hoàn tiền đã hoàn tất · theo ngày hoàn',
  'finance.st.reconTitle': 'Đối soát', 'finance.st.r.gross': 'Gộp đã quyết toán', 'finance.st.r.fees': 'Phí đã trừ', 'finance.st.r.refundsIn': 'Hoàn tiền / bồi hoàn trong lô',
  'finance.st.r.refundsInHint': 'Đã nằm trong số ròng của bộ xử lý — không trừ lần nữa.', 'finance.st.r.adjustments': 'Điều chỉnh', 'finance.st.r.providerDiff': 'Chênh lệch do bộ xử lý xác định',
  'finance.st.r.providerDiffHint': 'Số ròng của bộ xử lý lệch so với các thành phần của chính nó bằng số tiền này.', 'finance.st.r.expected': 'Chi trả dự kiến của bộ xử lý', 'finance.st.r.bank': 'Ngân hàng xác nhận',
  'finance.st.r.difference': 'Chênh lệch', 'finance.st.r.differenceHint': '{m} đã khớp · {p} một phần · {u} chưa xác minh',
  'finance.st.tab.settlements': 'Quyết toán', 'finance.st.tab.refunds': 'Hoàn tiền',
  'finance.st.col.id': 'Mã quyết toán', 'finance.st.col.date': 'Ngày quyết toán', 'finance.st.col.txns': 'Giao dịch', 'finance.st.col.gross': 'Gộp', 'finance.st.col.fees': 'Phí', 'finance.st.col.net': 'Chi trả ròng',
  'finance.st.col.bank': 'Xác nhận ngân hàng', 'finance.st.col.status': 'Trạng thái',
  'finance.st.rcol.ref': 'Mã hoàn tiền', 'finance.st.rcol.payment': 'Thanh toán gốc', 'finance.st.rcol.customer': 'Khách hàng', 'finance.st.rcol.date': 'Ngày hoàn', 'finance.st.rcol.amount': 'Số tiền',
  'finance.st.rcol.status': 'Trạng thái', 'finance.st.rcol.impact': 'Ảnh hưởng quyết toán',
  'finance.st.saleBatch': 'Lô bán hàng {ref}', 'finance.st.notInBatch': 'Giao dịch bán chưa vào lô', 'finance.st.nettingNotReported': 'bộ xử lý không cho biết khoản chi trả nào đã trừ khoản này',
  'finance.st.emptyPeriod': 'Không có quyết toán nào trong kỳ này.', 'finance.st.emptyNoSource': 'Không có dữ liệu bộ xử lý — hãy kết nối bộ xử lý thẻ để nhận quyết toán.',
  'finance.st.newOutside': 'Có quyết toán mới nhưng bộ lọc hiện tại đang ẩn nó.', 'finance.st.newRefundOutside': 'Có hoàn tiền mới nhưng bộ lọc hiện tại đang ẩn nó.',
  'finance.st.detail': 'Quyết toán', 'finance.st.detailTitle': 'Quyết toán {ref}', 'finance.st.bothStatuses': 'Một lô có thể đã được bộ xử lý quyết toán trước khi có tiền về ngân hàng được xác minh.',
  'finance.st.f.ref': 'Mã của bộ xử lý', 'finance.st.f.internalId': 'Mã nội bộ', 'finance.st.f.processor': 'Bộ xử lý', 'finance.st.f.funding': 'tài khoản nhận', 'finance.st.f.settled': 'Đã quyết toán',
  'finance.st.f.expectedPayout': 'Chi trả dự kiến', 'finance.st.f.retrieved': 'Đã nhận', 'finance.st.f.viaWebhook': 'từ sự kiện quyết toán của bộ xử lý', 'finance.st.f.transactions': 'Giao dịch',
  'finance.st.f.reported': 'được báo cáo', 'finance.st.f.linked': 'đã liên kết', 'finance.st.f.refundsIn': 'Hoàn tiền trong lô', 'finance.st.f.chargebacksIn': 'Bồi hoàn trong lô', 'finance.st.f.reserves': 'Tiền giữ lại',
  'finance.st.f.refundsOnPayment': 'Số lần hoàn trên thanh toán này',
  'finance.st.allocations': 'Tiền về ngân hàng đã khớp với khoản chi trả này', 'finance.st.noAllocations': 'Chưa khớp khoản tiền về ngân hàng nào.',
  'finance.st.a.deposit': 'Tiền về', 'finance.st.a.account': 'Tài khoản', 'finance.st.a.posted': 'Ngân hàng ghi nhận', 'finance.st.a.allocated': 'Đã phân bổ', 'finance.st.a.by': 'Người khớp',
  'finance.st.relatedTransactions': 'Giao dịch thanh toán liên quan', 'finance.st.txSearchPh': 'Tìm giao dịch, phiếu, số tiền, khách…', 'finance.st.noLinkedPayments': 'Không có thanh toán nào liên kết với lô này.',
  'finance.st.t.txn': 'Giao dịch', 'finance.st.t.date': 'Ngày', 'finance.st.t.method': 'Phương thức', 'finance.st.t.ticket': 'Phiếu', 'finance.st.t.customer': 'Khách hàng', 'finance.st.t.amount': 'Số tiền',
  'finance.st.batchNotOnePerson': 'Một lô gộp thanh toán của nhiều khách — khoản chi trả không thuộc về một người.',
  'finance.st.viewTransactions': 'Xem giao dịch', 'finance.st.openRecon': 'Mở Đối soát tiền về', 'finance.st.back': 'Về danh sách quyết toán',
  'finance.st.refundTitle': 'Hoàn tiền {ref}', 'finance.st.notCountedInTotal': 'không tính vào Tổng hoàn tiền', 'finance.st.openSaleBatch': 'Mở lô bán hàng',
  'finance.st.refundViewOnly': 'Xem hoàn tiền không bao giờ tạo hay thay đổi hoàn tiền. Hoàn tiền được thực hiện từ giao dịch thanh toán, với quyền thanh toán.',
  // ── AI Deposit Reconciliation ──
  'finance.dr.subtitle': 'Khớp khoản chi trả của bộ xử lý với tiền về ngân hàng · phí · ngoại lệ · báo cáo', 'finance.dr.tabs': 'Các phần đối soát',
  'finance.dr.tab.overview': 'Tổng quan', 'finance.dr.tab.fees': 'Phí', 'finance.dr.tab.exceptions': 'Ngoại lệ', 'finance.dr.tab.reports': 'Báo cáo',
  'finance.dr.searchPh': 'Tìm mã quyết toán, mã ngân hàng, số tiền, mã thanh toán, tên, SĐT hoặc email khách…',
  'finance.resultType.settlement': 'Quyết toán', 'finance.resultType.payment': 'Thanh toán', 'finance.resultType.bank_deposit': 'Tiền về ngân hàng', 'finance.resultType.exception': 'Ngoại lệ',
  'finance.dr.bankAccount': 'Tài khoản ngân hàng', 'finance.dr.allAccounts': 'Tất cả tài khoản ngân hàng',
  'finance.dr.kpi.expected': 'Tiền về dự kiến', 'finance.dr.kpi.expectedSub': 'Chi trả ròng của bộ xử lý trong phạm vi', 'finance.dr.kpi.matched': 'Đã khớp', 'finance.dr.kpi.matchedSub': '{m} đã khớp · {p} một phần',
  'finance.dr.kpi.settlements': 'Quyết toán', 'finance.dr.kpi.settlementsSub': 'Số lô · {basis}', 'finance.dr.kpi.missing': 'Tiền về bị thiếu', 'finance.dr.kpi.missingSub': 'Quá hạn dự kiến + {g} ngày',
  'finance.dr.kpi.difference': 'Chênh lệch ròng', 'finance.dr.kpi.differenceSub': 'Đã khớp {m} − dự kiến {e} (đến hạn)',
  'finance.dr.kpi.differenceExplain': 'Chênh lệch ròng = đã khớp {m} − dự kiến {e} = {d}, cho các khoản chi trả đã đến hạn. Không tính: {n} khoản chưa đến hạn ({nc}) và tiền về ngân hàng chưa khớp với quyết toán nào.',
  'finance.dr.s2d': 'Quyết toán → Tiền về', 'finance.dr.noSettlements': 'Không có quyết toán nào trong kỳ này.',
  'finance.dr.noSettlementsButDeposits': 'Có tiền về ngân hàng đang chờ ở bên phải — có thể cần xem xét thủ công.', 'finance.dr.noSettlementsHint': 'Thử khoảng ngày khác hoặc kiểm tra kết nối bộ xử lý.',
  'finance.dr.col.settlement': 'Quyết toán', 'finance.dr.col.date': 'Ngày quyết toán', 'finance.dr.col.gross': 'Gộp', 'finance.dr.col.fees': 'Phí / đ.chỉnh', 'finance.dr.col.expected': 'Ròng dự kiến',
  'finance.dr.col.arrival': 'Dự kiến về', 'finance.dr.col.deposits': 'Tiền về đã liên kết', 'finance.dr.col.matched': 'Đã khớp', 'finance.dr.col.difference': 'Chênh lệch', 'finance.dr.est': '(ước tính)',
  'finance.drSort.created_desc': 'Mới tạo nhất', 'finance.drSort.created_asc': 'Tạo lâu nhất', 'finance.drSort.settled_desc': 'Ngày quyết toán mới nhất', 'finance.drSort.arrival_asc': 'Ngày dự kiến về',
  'finance.drSort.difference_desc': 'Chưa khớp nhiều nhất', 'finance.drSort.expected_desc': 'Chi trả lớn nhất', 'finance.drSort.fee_desc': 'Phí cao nhất',
  'finance.recon.pending': 'Đang chờ', 'finance.recon.expected': 'Dự kiến', 'finance.recon.matched': 'Đã khớp', 'finance.recon.partially_matched': 'Khớp một phần', 'finance.recon.overdue': 'Quá hạn / thiếu',
  'finance.recon.exception': 'Ngoại lệ', 'finance.recon.under_review': 'Đang xem xét', 'finance.recon.no_payout': 'Không có chi trả',
  'finance.recon.help.pending': 'Lô của bộ xử lý vẫn đang chờ.', 'finance.recon.help.expected': 'Chưa khớp; khoản chi trả chưa đến hạn.', 'finance.recon.help.matched': 'Tiền về ngân hàng đã phủ toàn bộ khoản chi trả dự kiến.',
  'finance.recon.help.partially_matched': 'Một phần khoản chi trả đã khớp; phần còn lại vẫn đang chờ.', 'finance.recon.help.overdue': 'Đã quá ngày dự kiến và thời gian chờ mà chưa có tiền về khớp.',
  'finance.recon.help.exception': 'Có hồ sơ đang mở hoặc lỗi từ bộ xử lý cần xử lý.', 'finance.recon.help.under_review': 'Người xem xét đang xử lý hồ sơ của khoản chi trả này.', 'finance.recon.help.no_payout': 'Bộ xử lý báo không có khoản chi trả dương cho lô này.',
  'finance.dr.bankAccounts': 'Tài khoản ngân hàng', 'finance.dr.addAccount': 'Thêm tài khoản', 'finance.dr.noAccounts': 'Chưa có tài khoản ngân hàng.', 'finance.dr.noAccountsHint': 'Thêm tài khoản nhận tiền của tiệm (chỉ 4 số cuối).',
  'finance.dr.noAccountsAsk': 'Nhờ chủ tiệm thêm tài khoản nhận tiền.', 'finance.dr.default': 'Mặc định', 'finance.dr.inactive': 'Ngừng dùng', 'finance.dr.manage': 'Quản lý', 'finance.dr.manageAccount': 'Quản lý {a}',
  'finance.dr.depositsN': '{n} khoản tiền về', 'finance.accountType.checking': 'Thanh toán', 'finance.accountType.savings': 'Tiết kiệm', 'finance.accountType.other': 'Khác',
  'finance.dr.unmatched': 'Tiền về chưa khớp', 'finance.dr.noUnmatched': 'Không có tiền về ngân hàng chưa khớp trong kỳ này.', 'finance.dr.noReference': 'Không có mã', 'finance.dr.suggestions': 'Gợi ý', 'finance.dr.match': 'Khớp',
  'finance.depositSource.manual': 'Nhập tay', 'finance.depositSource.csv_import': 'Nhập sao kê', 'finance.depositSource.bank_feed': 'Nguồn ngân hàng',
  'finance.matchState.reconciled': 'Đã đối soát đủ', 'finance.matchState.partial_allocation': 'Phân bổ một phần', 'finance.matchState.possible_candidate': 'Có thể khớp', 'finance.matchState.reviewed_unresolved': 'Đã xem, chưa xử lý',
  'finance.matchState.no_candidates': 'Không có ứng viên',
  'finance.dr.reviewTitle': 'Xem xét quyết toán {ref}', 'finance.dr.remaining': 'Còn chưa khớp', 'finance.dr.allocationHistory': 'Các phân bổ khớp', 'finance.dr.basis': 'Căn cứ',
  'finance.basisName.manual': 'Khớp thủ công', 'finance.basisName.legacy_link': 'Liên kết trước đây', 'finance.basisName.suggestion_accepted': 'Chấp nhận gợi ý', 'finance.basisName.exact_reference': 'Trùng mã tham chiếu',
  'finance.basisName.amount_and_date': 'Trùng số tiền + ngày', 'finance.basisName.similar_amount': 'Số tiền gần giống (xem kỹ)',
  'finance.dr.unmatch': 'Bỏ khớp', 'finance.dr.unmatchReason': 'Lý do bỏ khớp', 'finance.dr.confirmUnmatch': 'Xác nhận bỏ khớp', 'finance.dr.unmatchedDone': 'Đã bỏ khớp (ghi lại cùng lý do của bạn).',
  'finance.dr.cases': 'Hồ sơ', 'finance.dr.payments': 'Thanh toán trong lô này', 'finance.dr.notes': 'Ghi chú xem xét', 'finance.dr.viewTransactions': 'Xem giao dịch liên quan', 'finance.dr.addNote': 'Thêm ghi chú',
  'finance.dr.investigate': 'Điều tra', 'finance.dr.matchManually': 'Khớp thủ công',
  'finance.dr.deposit': 'Tiền về ngân hàng', 'finance.dr.depositTitle': 'Tiền về ngân hàng {a}', 'finance.dr.depositIsRecord': 'Khoản tiền về ở đây là bản ghi số tiền ngân hàng đã nhận — màn hình này không chuyển tiền.',
  'finance.dr.f.amount': 'Số tiền', 'finance.dr.f.unallocated': 'chưa phân bổ', 'finance.dr.f.posted': 'Ngày ngân hàng ghi nhận', 'finance.dr.f.account': 'Tài khoản ngân hàng', 'finance.dr.f.reference': 'Mã tham chiếu ngân hàng',
  'finance.dr.f.source': 'Nguồn', 'finance.dr.f.enteredBy': '{who} nhập lúc {when}', 'finance.dr.f.notes': 'Ghi chú', 'finance.dr.noAllocationsDeposit': 'Khoản tiền về này chưa khớp với quyết toán nào.',
  'finance.dr.reviewSuggestion': 'Xem gợi ý', 'finance.dr.searchSettlements': 'Tìm quyết toán có thể khớp',
  'finance.dr.suggestionsTitle': 'Quyết toán được gợi ý', 'finance.dr.suggestionsNote': 'Gợi ý dựa trên quy tắc (mã tham chiếu, số tiền, ngày). Đây không phải số liệu sổ sách — hãy xem xét và tự khớp.',
  'finance.dr.noSuggestions': 'Không tìm thấy quyết toán phù hợp.', 'finance.dr.confidence': 'Độ tin cậy', 'finance.dr.evidence': 'Bằng chứng', 'finance.dr.reviewAndMatch': 'Xem & khớp',
  'finance.dr.conf.high': 'Cao', 'finance.dr.conf.medium': 'Trung bình', 'finance.dr.conf.low': 'Thấp',
  'finance.dr.ev.amountDelta': 'chênh lệch số tiền {d}', 'finance.dr.ev.dayDelta': '{n} ngày sau quyết toán', 'finance.dr.ev.reference': 'mã tham chiếu chứa mã lô',
  'finance.dr.matchTitle': 'Khớp khoản chi trả với tiền về ngân hàng', 'finance.dr.matchSub': 'Phân bổ một phần hoặc toàn bộ khoản tiền về cho một khoản chi trả quyết toán.', 'finance.dr.stillExpected': 'còn chờ',
  'finance.dr.findSettlement': 'Tìm quyết toán còn khoản chi trả chưa khớp…', 'finance.dr.findDeposit': 'Tìm khoản tiền về ngân hàng chưa khớp…', 'finance.dr.allocateAmount': 'Số tiền phân bổ', 'finance.dr.matchNote': 'Ghi chú (không bắt buộc)',
  'finance.dr.maxAllocate': 'Tối đa có thể phân bổ {a}.', 'finance.dr.tooMuch': 'vượt quá phần chưa khớp', 'finance.dr.partialBothApprover': 'Việc này để cả khoản chi trả và khoản tiền về đều còn một phần chưa khớp — bạn đang phê duyệt một khớp chưa chắc chắn.',
  'finance.dr.partialBothNeedsOwner': 'Việc này sẽ để cả hai bên còn một phần chưa khớp — loại khớp này cần chủ tiệm phê duyệt.', 'finance.dr.reviewedEvidence': 'Tôi đã xem xét bằng chứng cho lần khớp này.',
  'finance.dr.matchMovesNoMoney': 'Khớp chỉ ghi lại mối liên hệ giữa tiền về và khoản chi trả. Không chuyển tiền, không thay đổi bản ghi của ngân hàng hay bộ xử lý.', 'finance.dr.confirmMatch': 'Xác nhận khớp',
  'finance.dr.matched': 'Đã khớp {a}.', 'finance.dr.remainingNow': 'còn chưa khớp: chi trả {s}, tiền về {d}',
  'finance.dr.recordDeposit': 'Ghi nhận tiền về', 'finance.dr.recordSub': 'Nhập một khoản ghi có bạn thấy trên sao kê ngân hàng.', 'finance.dr.noActiveAccount': 'Hãy thêm một tài khoản ngân hàng đang dùng trước.',
  'finance.dr.amountInvalid': 'Nhập số tiền dạng 1250.00.', 'finance.dr.sourceManual': 'Nguồn: nhập tay', 'finance.dr.fileNotAvailable': 'Chưa thể đính kèm tệp sao kê trên màn hình này.',
  'finance.dr.recordIsRecord': 'Thao tác này chỉ tạo bản ghi tiền về ngân hàng. Không chuyển tiền, không trừ thẻ, không hoàn tiền và không đánh dấu quyết toán đã trả.',
  'finance.dr.duplicateRef': 'Tài khoản này đã có một khoản tiền về với cùng mã tham chiếu ({a}, {d}).', 'finance.dr.recordAnyway': 'Đây là khoản khác — vẫn ghi nhận',
  'finance.dr.saveDeposit': 'Lưu tiền về', 'finance.dr.depositRecorded': 'Đã ghi nhận khoản tiền về {a}.', 'finance.dr.depositOutside': 'Đã ghi nhận khoản tiền về {a} — ngày ngân hàng nằm ngoài kỳ đang chọn nên không có trong danh sách.',
  'finance.dr.accountSub': 'Nhãn dùng cho sổ sách của tiệm.', 'finance.dr.nickname': 'Tên gọi', 'finance.dr.bank': 'Ngân hàng', 'finance.dr.accountType': 'Loại tài khoản', 'finance.dr.last4': '4 số cuối',
  'finance.dr.depositsOnFile': 'Số khoản tiền về đã lưu', 'finance.dr.labelNotPayout': 'Đây là nhãn để đối soát. Nó không thay đổi nơi bộ xử lý chuyển tiền — việc đó phải thay đổi với bộ xử lý.',
  'finance.dr.saveNickname': 'Lưu tên gọi', 'finance.dr.setDefault': 'Đặt làm mặc định', 'finance.dr.deactivate': 'Ngừng dùng', 'finance.dr.deactivateConfirm': 'Các khoản tiền về cũ vẫn được giữ. Ngừng dùng?',
  'finance.dr.accountAdded': 'Đã thêm tài khoản ngân hàng.', 'finance.dr.accountSaved': 'Đã lưu tài khoản ngân hàng.', 'finance.dr.defaultSet': 'Đã đặt tài khoản mặc định.', 'finance.dr.deactivated': 'Đã ngừng dùng tài khoản ngân hàng.',
  'finance.dr.case': 'Hồ sơ', 'finance.dr.markReview': 'Đánh dấu đang xem xét', 'finance.dr.markedReview': 'Đã đánh dấu đang xem xét.', 'finance.dr.resolve': 'Giải quyết', 'finance.dr.resolveReason': 'Cách giải quyết (bằng chứng)',
  'finance.dr.resolved': 'Đã giải quyết hồ sơ.', 'finance.dr.reopen': 'Mở lại', 'finance.dr.reopened': 'Đã mở lại hồ sơ.', 'finance.dr.assign': 'Giao người xem xét', 'finance.dr.assigned': 'Đã giao người xem xét.', 'finance.dr.unassigned': 'Chưa giao',
  'finance.dr.history': 'Lịch sử', 'finance.dr.e.amount': 'Số tiền', 'finance.dr.e.evidence': 'Bằng chứng', 'finance.dr.e.reference': 'Tham chiếu', 'finance.dr.e.reviewer': 'Người xem xét', 'finance.dr.e.resolution': 'Giải quyết',
  'finance.dr.e.case': 'Hồ sơ', 'finance.dr.e.type': 'Loại', 'finance.dr.e.source': 'Bộ xử lý / ngân hàng', 'finance.dr.e.age': 'Tuổi',
  'finance.dr.investigateTitle': 'Điều tra {t}', 'finance.dr.caseType': 'Loại hồ sơ', 'finance.dr.whatYouSee': 'Bạn thấy gì? (không bắt buộc)', 'finance.dr.openCase': 'Mở hồ sơ',
  'finance.dr.caseRaised': 'Đã mở hồ sơ.', 'finance.dr.caseExists': 'Đã có hồ sơ đang mở cho việc này — không tạo trùng.',
  'finance.dr.noteTitle': 'Ghi chú cho {t}', 'finance.dr.note': 'Ghi chú', 'finance.dr.noteHint': 'Ghi chú được lưu cùng bản ghi và không sửa được về sau.', 'finance.dr.saveNote': 'Lưu ghi chú', 'finance.dr.noteAdded': 'Đã thêm ghi chú.',
  'finance.dr.fee.total': 'Tổng phí', 'finance.dr.fee.gross': 'Gộp', 'finance.dr.fee.net': 'Chi trả ròng', 'finance.dr.fee.rate': 'Tỷ lệ phí thực', 'finance.dr.fee.interchange': 'Phí liên ngân hàng',
  'finance.dr.fee.assessment': 'Phí tổ chức thẻ', 'finance.dr.fee.markup': 'Phí cộng thêm', 'finance.dr.fee.other': 'Đ.chỉnh khác', 'finance.dr.feeCategory': 'Loại phí', 'finance.dr.noFees': 'Không có quyết toán trong kỳ này.',
  'finance.feeCat.all': 'Tất cả phí', 'finance.feeCat.deducted': 'Có trừ phí', 'finance.feeCat.zero_fee': 'Không phí', 'finance.feeCat.adjusted': 'Có điều chỉnh', 'finance.feeCat.components': 'Có chi tiết phí',
  'finance.dr.atRisk': 'Chưa giải quyết', 'finance.dr.unresolved': 'Chưa giải quyết', 'finance.dr.severity': 'Mức độ', 'finance.dr.allSeverities': 'Mọi mức độ', 'finance.dr.allTypes': 'Mọi loại', 'finance.dr.noCases': 'Không có hồ sơ phù hợp bộ lọc.',
  'finance.dr.days': '{n} ngày', 'finance.dr.viewEvidence': 'Xem bằng chứng',
  'finance.exc.open': 'Đang mở', 'finance.exc.in_review': 'Đang xem xét', 'finance.exc.escalated': 'Đã chuyển cấp', 'finance.exc.reopened': 'Đã mở lại', 'finance.exc.resolved': 'Đã giải quyết',
  'finance.sev.critical': 'Nghiêm trọng', 'finance.sev.high': 'Cao', 'finance.sev.moderate': 'Trung bình', 'finance.sev.low': 'Thấp', 'finance.sev.info': 'Thông tin',
  'finance.excClass.missing': 'Thiếu / trễ tiền về', 'finance.excClass.amount_mismatch': 'Lệch số tiền', 'finance.excClass.duplicate': 'Trùng / không rõ', 'finance.excClass.unmatched_credit': 'Tiền về chưa khớp',
  'finance.excClass.fee_reversal': 'Sai lệch phí / đảo giao dịch', 'finance.excClass.integration': 'Lỗi tích hợp / dữ liệu',
  'finance.excClassHelp.missing': 'Khoản chi trả dự kiến đã quá thời gian về mà không có ghi nhận ngân hàng phù hợp.', 'finance.excClassHelp.amount_mismatch': 'Số tiền đã khớp khác với khoản chi trả dự kiến.',
  'finance.excClassHelp.duplicate': 'Nghi nhập trùng hoặc có nhiều khoản ngân hàng có thể khớp.', 'finance.excClassHelp.unmatched_credit': 'Khoản ghi có ngân hàng chưa gắn với quyết toán nào.',
  'finance.excClassHelp.fee_reversal': 'Phí bất thường, đảo hoàn tiền / bồi hoàn, tiền giữ lại hoặc bị khấu trừ.', 'finance.excClassHelp.integration': 'Thiếu bản ghi nguồn, ngày sai định dạng hoặc nguồn dữ liệu lỗi.',
  'finance.excKind.missing_deposit': 'Thiếu / trễ tiền về', 'finance.excKind.amount_mismatch': 'Lệch số tiền', 'finance.excKind.duplicate': 'Trùng / không rõ', 'finance.excKind.unmatched_deposit': 'Tiền về chưa khớp',
  'finance.excKind.fee_difference': 'Sai lệch phí / đảo giao dịch', 'finance.excKind.integration_error': 'Lỗi tích hợp / dữ liệu',
  'finance.role.OWNER': 'Chủ tiệm', 'finance.role.MANAGER': 'Quản lý',
  'finance.auditAction.exception_raised': 'Đã mở hồ sơ', 'finance.auditAction.exception_assigned': 'Đã giao người xem xét', 'finance.auditAction.exception_under_review': 'Đã đánh dấu đang xem xét',
  'finance.auditAction.exception_resolved': 'Đã giải quyết', 'finance.auditAction.exception_reopened': 'Đã mở lại', 'finance.auditAction.note_added': 'Đã thêm ghi chú',
  'finance.dr.reportTypes': 'Báo cáo', 'finance.dr.noReportRows': 'Không có bản ghi trong phạm vi này.',
  'finance.report.settlement_summary': 'Tóm tắt quyết toán', 'finance.report.matched_deposits': 'Tiền về đã khớp', 'finance.report.unmatched_deposits': 'Tiền về ngân hàng chưa khớp', 'finance.report.missing_overdue': 'Tiền về thiếu / quá hạn',
  'finance.report.processing_fees': 'Phí xử lý', 'finance.report.exceptions_aging': 'Tuổi ngoại lệ', 'finance.report.net_difference_trend': 'Xu hướng chênh lệch ròng', 'finance.report.bank_accounts': 'Đối soát tài khoản ngân hàng',
  'finance.report.processor_comparison': 'So sánh bộ xử lý',
  'finance.reportDef.settlement_summary': 'Các lô của bộ xử lý theo ngày quyết toán (giờ tiệm); Đã khớp = tiền về ngân hàng được phân bổ cho chúng.', 'finance.reportDef.matched_deposits': 'Các phân bổ đang hiệu lực do người dùng thực hiện cho các quyết toán trong phạm vi.',
  'finance.reportDef.unmatched_deposits': 'Tiền về ngân hàng (theo ngày ngân hàng ghi nhận) còn phần chưa phân bổ.', 'finance.reportDef.missing_overdue': 'Khoản chi trả chưa khớp gì sau ngày dự kiến về cộng thời gian chờ.',
  'finance.reportDef.processing_fees': 'Phí bộ xử lý đã trừ, theo tháng và bộ xử lý. Chi tiết phí chỉ hiện khi bộ xử lý cung cấp.', 'finance.reportDef.exceptions_aging': 'Hồ sơ theo tuổi; hồ sơ đã giải quyết vẫn có trong báo cáo.',
  'finance.reportDef.net_difference_trend': 'Đã khớp trừ dự kiến cho các khoản đã đến hạn, theo tuần quyết toán. Khoản chưa đến hạn được hiển thị riêng.', 'finance.reportDef.bank_accounts': 'Tiền về theo từng tài khoản ngân hàng và phần đã khớp.',
  'finance.reportDef.processor_comparison': 'Quyết toán, phí và mức khớp theo từng bộ xử lý.',
  'finance.reportCol.day': 'Ngày quyết toán', 'finance.reportCol.settlements': 'Quyết toán', 'finance.reportCol.grossCents': 'Gộp', 'finance.reportCol.feesCents': 'Phí', 'finance.reportCol.expectedCents': 'Chi trả dự kiến',
  'finance.reportCol.matchedCents': 'Đã khớp', 'finance.reportCol.differenceCents': 'Chênh lệch', 'finance.reportCol.matchedAt': 'Ngày khớp', 'finance.reportCol.depositDate': 'Ngân hàng ghi nhận', 'finance.reportCol.depositReference': 'Mã ngân hàng',
  'finance.reportCol.account': 'Tài khoản', 'finance.reportCol.settlement': 'Quyết toán', 'finance.reportCol.processor': 'Bộ xử lý', 'finance.reportCol.source': 'Nguồn', 'finance.reportCol.allocatedCents': 'Đã phân bổ',
  'finance.reportCol.reference': 'Mã ngân hàng', 'finance.reportCol.state': 'Tình trạng khớp', 'finance.reportCol.amountCents': 'Số tiền', 'finance.reportCol.remainingCents': 'Chưa phân bổ', 'finance.reportCol.settled': 'Quyết toán',
  'finance.reportCol.expectedArrival': 'Dự kiến về', 'finance.reportCol.month': 'Tháng', 'finance.reportCol.effectiveRate': 'Tỷ lệ phí thực', 'finance.reportCol.bucket': 'Tuổi', 'finance.reportCol.open': 'Đang mở',
  'finance.reportCol.inReview': 'Đang xem xét', 'finance.reportCol.resolved': 'Đã giải quyết', 'finance.reportCol.atRiskCents': 'Số tiền chưa giải quyết', 'finance.reportCol.week': 'Tuần bắt đầu', 'finance.reportCol.dueExpectedCents': 'Dự kiến (đến hạn)',
  'finance.reportCol.dueMatchedCents': 'Đã khớp', 'finance.reportCol.notYetDueCents': 'Chưa đến hạn', 'finance.reportCol.status': 'Trạng thái', 'finance.reportCol.deposits': 'Số khoản tiền về', 'finance.reportCol.depositsCents': 'Đã về',
  'finance.reportCol.unallocatedCents': 'Chưa khớp',
  'finance.accountStatus.active': 'Đang dùng', 'finance.accountStatus.inactive': 'Ngừng dùng',
  'finance.ageBucket.0_7': '0–7 ngày', 'finance.ageBucket.8_30': '8–30 ngày', 'finance.ageBucket.31_60': '31–60 ngày', 'finance.ageBucket.61_plus': 'Trên 60 ngày',
  // ── Invoices ──
  'finance.iv.subtitle': 'Lập hóa đơn cho khách và theo dõi khoản còn nợ', 'finance.iv.new': 'Hóa đơn mới', 'finance.iv.list': 'Hóa đơn',
  'finance.iv.searchPh': 'Tìm số hóa đơn, tên, SĐT hoặc email khách…', 'finance.iv.min': 'Từ $', 'finance.iv.max': 'Đến $', 'finance.iv.minAmount': 'Tổng tối thiểu', 'finance.iv.maxAmount': 'Tổng tối đa',
  'finance.iv.amountRangeBad': 'Kiểm tra khoảng số tiền: nhập dạng 25 hoặc 25.00, tối thiểu không lớn hơn tối đa.',
  'finance.iv.status.draft': 'Nháp', 'finance.iv.status.sent': 'Đã gửi', 'finance.iv.status.overdue': 'Quá hạn', 'finance.iv.status.partially_paid': 'Trả một phần', 'finance.iv.status.paid': 'Đã thanh toán', 'finance.iv.status.void': 'Đã hủy',
  'finance.ivSort.created_desc': 'Mới tạo nhất', 'finance.ivSort.created_asc': 'Tạo lâu nhất', 'finance.ivSort.issue_desc': 'Ngày lập (mới nhất)', 'finance.ivSort.issue_asc': 'Ngày lập (cũ nhất)',
  'finance.ivSort.due_asc': 'Đến hạn (sớm nhất)', 'finance.ivSort.due_desc': 'Đến hạn (muộn nhất)', 'finance.ivSort.amount_desc': 'Số tiền: cao → thấp', 'finance.ivSort.amount_asc': 'Số tiền: thấp → cao', 'finance.ivSort.customer_asc': 'Khách hàng A–Z',
  'finance.iv.kpi.outstanding': 'Còn nợ', 'finance.iv.kpi.outstandingSub': '{n} hóa đơn còn nợ · {o} quá hạn', 'finance.iv.kpi.paid': 'Đã thu', 'finance.iv.kpi.paidSub': 'Tiền đã thu · {n} trả đủ · {p} một phần',
  'finance.iv.kpi.drafts': 'Nháp', 'finance.iv.kpi.draftsSub': 'Chưa phát hành · {a}', 'finance.iv.kpi.total': 'Tổng số', 'finance.iv.kpi.totalSub': 'Mọi trạng thái · {v} đã hủy',
  'finance.iv.kpiScope': 'Các thẻ hiển thị', 'finance.iv.scopeAll': 'tất cả hóa đơn', 'finance.iv.scopeFiltered': 'phù hợp với tìm kiếm / khoảng số tiền',
  'finance.iv.col.number': 'Số hóa đơn', 'finance.iv.col.customer': 'Khách hàng', 'finance.iv.col.issued': 'Ngày lập', 'finance.iv.col.due': 'Đến hạn', 'finance.iv.col.total': 'Tổng', 'finance.iv.col.balance': 'Còn nợ',
  'finance.iv.unlinked': 'Chưa liên kết khách', 'finance.iv.customerMissing': 'Không tìm thấy hồ sơ khách', 'finance.iv.noMatches': 'Không có hóa đơn phù hợp tìm kiếm hoặc bộ lọc.', 'finance.iv.none': 'Chưa có hóa đơn.',
  'finance.iv.recordPayment': 'Ghi nhận thanh toán', 'finance.iv.outsideFilters': 'Hóa đơn không hiện vì bộ lọc hiện tại.', 'finance.iv.viewInvoice': 'Xem hóa đơn',
  'finance.iv.createdDraft': 'Đã lưu {n} dạng nháp.', 'finance.iv.createdSent': 'Đã tạo {n} và đánh dấu đã gửi.', 'finance.iv.saved': 'Đã lưu {n}.',
  'finance.iv.detail': 'Hóa đơn', 'finance.iv.detailTitle': 'Hóa đơn {n}', 'finance.iv.edit': 'Sửa', 'finance.iv.preview': 'Xem trước', 'finance.iv.print': 'In', 'finance.iv.pdf': 'Tải PDF', 'finance.iv.send': 'Gửi',
  'finance.iv.linkCustomer': 'Liên kết khách', 'finance.iv.void': 'Hủy', 'finance.iv.back': 'Quay lại',
  'finance.iv.issuedAt': 'Phát hành {w}', 'finance.iv.voidReasonShown': 'Đã hủy: {r}', 'finance.iv.billTo': 'Lập cho', 'finance.iv.profileNow': 'Tên hồ sơ hiện tại', 'finance.iv.phone': 'Điện thoại', 'finance.iv.email': 'Email',
  'finance.iv.unlinkedHelp': 'Hóa đơn này được lưu mà không có khách. Quản lý có thể liên kết đúng khách (có ghi lại); hệ thống không bao giờ đoán theo tên.',
  'finance.iv.subtotal': 'Tạm tính', 'finance.iv.discount': 'Giảm giá', 'finance.iv.tax': 'Thuế', 'finance.iv.paidSoFar': 'Đã trả', 'finance.iv.balanceDue': 'Còn phải trả',
  'finance.iv.lines': 'Dòng hàng', 'finance.iv.description': 'Mô tả', 'finance.iv.qty': 'SL', 'finance.iv.unitPrice': 'Đơn giá', 'finance.iv.amount': 'Thành tiền',
  'finance.iv.paymentHistory': 'Lịch sử thanh toán', 'finance.iv.noPayments': 'Chưa ghi nhận thanh toán nào.', 'finance.iv.notes': 'Ghi chú',
  'finance.iv.deliveryNote': 'Gửi sẽ đánh dấu hóa đơn đã phát hành. Chưa kết nối gửi hóa đơn qua email / tin nhắn — hãy chia sẻ PDF cho khách.',
  'finance.iv.sentNote': 'Đã đánh dấu {n} là đã gửi (chưa kết nối gửi cho khách — hãy chia sẻ PDF).', 'finance.iv.popupBlocked': 'Trình duyệt chặn cửa sổ PDF. Hãy dùng Tải PDF.',
  'finance.iv.editTitle': 'Sửa {n}', 'finance.iv.formSub': 'Máy chủ tính tổng tiền khi bạn lưu.', 'finance.iv.customer': 'Khách hàng', 'finance.iv.noPhone': 'Không có SĐT', 'finance.iv.noEmail': 'Không có email',
  'finance.iv.findCustomer': 'Tìm khách theo tên, SĐT hoặc email…', 'finance.iv.noCustomerFound': 'Không tìm thấy khách trong tiệm.', 'finance.iv.findHint': 'Nhập ít nhất 2 ký tự.', 'finance.iv.invoicesN': '{n} hóa đơn',
  'finance.iv.dueBeforeIssue': 'Ngày đến hạn phải bằng hoặc sau ngày lập.', 'finance.iv.removeLine': 'Xóa dòng', 'finance.iv.addLine': 'Thêm dòng',
  'finance.iv.lineInvalid': 'Mỗi dòng cần mô tả, số lượng nguyên và giá dạng 35.00.', 'finance.iv.discountTooBig': 'Giảm giá không được lớn hơn tạm tính.',
  'finance.iv.serverComputes': 'Số tiền hiển thị chỉ để xem trước; tổng hóa đơn được tính lại trên máy chủ.',
  'finance.iv.saveAndPreview': 'Lưu & xem trước', 'finance.iv.saveDraft': 'Lưu nháp', 'finance.iv.sendInvoice': 'Gửi hóa đơn',
  'finance.iv.recordPaymentTitle': 'Ghi nhận thanh toán · {n}', 'finance.iv.paymentAmount': 'Số tiền thanh toán', 'finance.iv.paymentDate': 'Ngày thanh toán', 'finance.iv.method': 'Phương thức', 'finance.iv.reference': 'Mã tham chiếu (không bắt buộc)',
  'finance.iv.note': 'Ghi chú (không bắt buộc)', 'finance.iv.overBalance': 'Số tiền vượt quá số còn phải trả.', 'finance.iv.partialPreview': 'Trả một phần — còn lại {b}.',
  'finance.iv.notACharge': 'Thao tác này ghi nhận tiền đã nhận (tiền mặt, séc, máy quẹt bên ngoài, chuyển khoản). Không trừ tiền thẻ.',
  'finance.iv.confirmPayment': 'Ghi nhận {a}', 'finance.iv.balanceNow': 'hiện còn phải trả {b}', 'finance.iv.paymentRecorded': 'Đã ghi nhận {a} cho {n}; còn {b}.', 'finance.iv.paidInFull': '{n} đã trả đủ (ghi nhận {a}).',
  'finance.payMethod.cash': 'Tiền mặt', 'finance.payMethod.check': 'Séc', 'finance.payMethod.card_external': 'Thẻ (máy bên ngoài)', 'finance.payMethod.bank_transfer': 'Chuyển khoản', 'finance.payMethod.other': 'Khác',
  'finance.iv.voidTitle': 'Hủy {n}', 'finance.iv.voidImpact': 'Hủy vẫn giữ hóa đơn và các dòng hàng nhưng không còn thu được. Không thể hoàn tác. Hóa đơn đã có thanh toán cần hoàn tiền hoặc ghi có thay vì hủy.',
  'finance.iv.deliveryTitle': 'Gửi cho khách',
  'finance.iv.emailInvoice': 'Gửi email hóa đơn',
  'finance.iv.textInvoice': 'Nhắn tin hóa đơn',
  'finance.iv.emailNotConnected': 'Tiệm chưa kết nối email.',
  'finance.iv.smsNotConnected': 'Tiệm chưa kết nối tin nhắn.',
  'finance.iv.deliverAfterIssue': 'Hãy phát hành hóa đơn trước khi gửi cho khách.',
  'finance.iv.channelEmail': 'Email',
  'finance.iv.channelSms': 'Tin nhắn',
  'finance.iv.deliveryStatus.submitting': 'Đang gửi',
  'finance.iv.deliveryStatus.submitted': 'Đã chuyển đi',
  'finance.iv.deliveryStatus.simulated': 'Đã ghi nhận (chưa có nhà cung cấp)',
  'finance.iv.deliveryStatus.delivered': 'Đã nhận',
  'finance.iv.deliveryStatus.undelivered': 'Không đến được',
  'finance.iv.deliveryStatus.blocked': 'Bị chặn',
  'finance.iv.deliveryStatus.failed': 'Thất bại',
  'finance.iv.deliveryStatus.unknown': 'Không rõ',
  'finance.iv.deliveryReason.opted_out': '(khách đã từ chối nhận tin)',
  'finance.iv.deliveryReason.not_configured': '(chưa thiết lập người gửi)',
  'finance.iv.deliveryReason.no_credits': '(hết lượt tin nhắn)',
  'finance.iv.deliveryHonest': '"Đã chuyển đi" nghĩa là nhà cung cấp đã nhận; "Đã nhận" chỉ hiện khi nhà cung cấp xác nhận. Tin nhắn và email gửi bằng tiếng Anh.',
  'finance.iv.emailSubmitted': 'Đã gửi email {n} — đã chuyển cho nhà cung cấp.',
  'finance.iv.smsSubmitted': 'Đã nhắn tin {n} — đã chuyển cho nhà cung cấp.',
  'finance.iv.deliverySimulated': '{n}: đã ghi nhận nhưng chưa có nhà cung cấp nên chưa gửi đến khách.',
  'finance.iv.deliveryNotSent': 'Chưa gửi {why}',
  'finance.iv.fromCatalog': '+ Từ dịch vụ / sản phẩm',
  'finance.iv.catalogFind': 'Tìm dịch vụ và sản phẩm…',
  'finance.iv.catalogNone': 'Không có dịch vụ hay sản phẩm nào phù hợp.',
  'finance.iv.kindService': 'Dịch vụ',
  'finance.iv.kindProduct': 'Sản phẩm',
  'finance.iv.customerChip': 'Khách hàng',
  'finance.iv.anyCustomer': 'Mọi khách hàng',
  'finance.iv.profileTitle': 'Hóa đơn',
  'finance.iv.profileAll': 'Mở trong Hóa đơn',
  'finance.iv.profileNoAccess': 'Vai trò của bạn không xem được hóa đơn.',
  'finance.iv.profileNone': 'Khách này chưa có hóa đơn.',
  'finance.iv.profileBalance': 'Còn nợ {b} trên {n} hóa đơn',
  'finance.iv.profileOverdue': '{n} quá hạn',
  'finance.iv.status.credited': 'Đã ghi có',
  'finance.iv.credit': 'Ghi có / hoàn tiền',
  'finance.iv.creditNotes': 'Phiếu ghi có',
  'finance.iv.refunded': 'Đã hoàn tiền',
  'finance.iv.refundShown': 'Đã hoàn {a} ({m})',
  'finance.iv.creditTitle': 'Phiếu ghi có cho {n}',
  'finance.iv.confirmCredit': 'Ghi có {a}',
  'finance.iv.creditable': 'Còn có thể ghi có',
  'finance.iv.creditAmount': 'Số tiền ghi có',
  'finance.iv.creditReason': 'Lý do',
  'finance.iv.refundMethod': 'Cách hoàn tiền',
  'finance.iv.overCreditable': 'Số tiền vượt quá phần còn có thể ghi có của hóa đơn này.',
  'finance.iv.refundPreview': '{r} trong số tiền ghi có này khách đã trả và sẽ được ghi nhận là đã hoàn lại cho khách.',
  'finance.iv.creditNote': 'Phiếu ghi có vẫn giữ hóa đơn, các dòng hàng và thanh toán. Hoàn tiền ở đây chỉ ghi nhận số tiền đã trả lại — không trừ hay hoàn tiền vào thẻ.',
  'finance.iv.creditIssued': 'Đã tạo phiếu ghi có {c} cho {n}. Số dư còn {b}.',
  'finance.iv.creditIssuedRefund': 'Đã tạo phiếu ghi có {c} cho {n}; ghi nhận đã hoàn {r}. Số dư còn {b}.',
  'finance.iv.voidReason': 'Lý do', 'finance.iv.confirmVoid': 'Hủy hóa đơn', 'finance.iv.voided': 'Đã hủy {n}.',
  'finance.iv.linkTitle': 'Liên kết khách với {n}', 'finance.iv.linkSub': 'Chọn khách sở hữu hóa đơn này.', 'finance.iv.updateBillTo': 'Đồng thời thay tên và liên hệ trên hóa đơn bằng thông tin hồ sơ',
  'finance.iv.neverGuess': 'Hãy tự chọn khách — hệ thống không bao giờ ghép hóa đơn với khách theo tên.', 'finance.iv.linked': 'Đã liên kết {n} với khách.',
  'finance.iv.previewTitle': 'Xem trước {n}', 'finance.iv.englishOnly': 'Hóa đơn cho khách bằng tiếng Anh.', 'finance.iv.openToPrint': 'Mở ở tab mới để in',
  // ── Expenses (guide Nov 4 2026) ──
  "finance.ex.title": "Chi phí",
  "finance.ex.subtitle": "Ghi lại, duyệt và báo cáo các khoản chi của tiệm. Mọi con số đều lấy từ dữ liệu của chính tiệm.",
  "finance.ex.kpi.total": "Tổng chi phí",
  "finance.ex.kpi.totalSub": "đã duyệt · kỳ này và bộ lọc",
  "finance.ex.kpi.entries": "Số khoản chi",
  "finance.ex.kpi.entriesSub": "trên mọi trang",
  "finance.ex.kpi.top": "Danh mục chi nhiều nhất",
  "finance.ex.kpi.topSub": "{a} · theo số tiền · chạm để xem mọi danh mục",
  "finance.ex.kpi.topNone": "chưa có khoản chi đã duyệt",
  "finance.ex.kpi.cats": "Danh mục đã dùng",
  "finance.ex.kpi.catsSub": "số danh mục khác nhau trong nhóm này",
  "finance.ex.scope": "Các thẻ tính các khoản chi ĐÃ DUYỆT theo ngày chi, cùng bộ lọc tìm kiếm, danh mục và phương thức (mọi trang). Bản nháp, khoản bị từ chối và khoản đã hủy không được tính.",
  "finance.ex.tab.all": "Tất cả",
  "finance.ex.list": "Khoản chi",
  "finance.ex.searchPh": "Tìm nhà cung cấp, mô tả, số hóa đơn hoặc số tiền",
  "finance.ex.allCategories": "Tất cả danh mục",
  "finance.ex.allMethods": "Mọi phương thức thanh toán",
  "finance.ex.sort.created": "Mới thêm trước",
  "finance.ex.sort.date": "Ngày chi (mới nhất)",
  "finance.ex.sort.amount": "Số tiền lớn nhất",
  "finance.ex.col.date": "Ngày",
  "finance.ex.col.expense": "Khoản chi",
  "finance.ex.col.category": "Danh mục",
  "finance.ex.col.vendor": "Nhà cung cấp / Người nhận",
  "finance.ex.col.amount": "Số tiền",
  "finance.ex.col.method": "Phương thức",
  "finance.ex.col.receipt": "Hóa đơn",
  "finance.ex.col.status": "Trạng thái",
  "finance.ex.empty": "Không có khoản chi nào trong kỳ này.",
  "finance.ex.emptyFiltered": "Không có khoản chi nào khớp bộ lọc.",
  "finance.ex.tryAnother": "Chọn ngày khác",
  "finance.ex.savedHere": "Đã lưu khoản chi — khoản này ở đầu Trang 1.",
  "finance.ex.savedHidden": "Đã lưu khoản chi, nhưng nằm ngoài kỳ hoặc bộ lọc hiện tại nên không có trong danh sách này.",
  "finance.ex.movedOut": "Đã lưu. Khoản chi không còn khớp kỳ hoặc bộ lọc hiện tại.",
  "finance.ex.updated": "Đã cập nhật khoản chi.",
  "finance.ex.view": "Xem khoản chi",
  "finance.ex.details": "Chi tiết khoản chi",
  "finance.ex.edit": "Sửa",
  "finance.ex.editTitle": "Sửa khoản chi",
  "finance.ex.correctionReason": "Vì sao sửa khoản chi đã duyệt?",
  "finance.ex.noReceipt": "Chưa đính kèm hóa đơn",
  "finance.ex.openReceipt": "Mở hóa đơn",
  "finance.ex.receiptAttached": "Đã đính kèm hóa đơn",
  "finance.ex.receiptPreviewOff": "Không xem trước hóa đơn tại đây được — hãy mở trong Receipt AI.",
  "finance.ex.byCategory": "Tiền đã chi vào đâu",
  "finance.ex.byCategorySub": "Các khoản chi đã duyệt trong kỳ này, theo danh mục.",
  "finance.ex.exportScope": "Xuất các khoản chi đã duyệt của kỳ đã chọn, cùng bộ lọc danh mục, phương thức và tìm kiếm đang dùng.",
  "finance.ex.dateRequired": "Hãy chọn ngày chi.",
  "finance.ex.notes": "Mô tả",
  "finance.ex.more": "Thao tác khác",
  "finance.ex.workflow": "Duyệt và thanh toán",
  "finance.ex.created": "Thêm lúc {d}",
  "finance.ex.payee": "Trả cho",
  "finance.st.notSetUp": "Chưa thiết lập",
  "finance.st.investigate": "Kiểm tra",
  "finance.st.invTitle": "Mở hồ sơ đối soát cho lô này",
  "finance.st.invKind": "Điều gì có vẻ sai",
  "finance.st.invNote": "Ghi chú (tùy chọn)",
  "finance.st.invRaised": "Đã mở hồ sơ — xem trong Đối soát tiền gửi → Ngoại lệ.",
  "finance.st.invExisting": "Lô này đã có hồ sơ cùng loại đang mở — không tạo thêm.",
  "finance.st.invKind.missing_deposit": "Tiền chưa về ngân hàng",
  "finance.st.invKind.amount_mismatch": "Số tiền không khớp",
  "finance.st.invKind.fee_difference": "Phí có vẻ sai",
  "finance.st.invKind.duplicate": "Có vẻ bị trùng",
  "finance.st.invKind.integration_error": "Lỗi dữ liệu từ bộ xử lý",
  "finance.st.source.stale": "Bộ xử lý thanh toán không gửi dữ liệu hơn 3 ngày — các số liệu bên dưới có thể đã cũ. Hãy kiểm tra kết nối cổng thanh toán.",
  // moved from the frozen catalog.vi.ts (Nov 6 2026) — keys unchanged
  'pos.cash_drawer_register': 'Quầy',
  'pos.cash_drawer_unassigned': 'Tiền mặt chưa gán quầy',
  "gc.clearingOpen": "Bảng đầy đủ · chọn ngày",
  "finance.iv.balanceAfter": "Còn lại sau lần trả này", // DRAFT — Kevin reviews
  "finance.iv.dupWarning": "Khách này đã có hóa đơn {n} số tiền {a}, xuất ngày {d}. Hãy kiểm tra để tránh trùng trước khi lưu.", // DRAFT — Kevin reviews
  "finance.iv.why.draft": "Bản nháp — chưa xuất nên chưa phải trả cho tới khi gửi.", // DRAFT — Kevin reviews
  "finance.iv.why.sent": "Đã xuất, chưa ghi nhận thanh toán — còn {b}.", // DRAFT — Kevin reviews
  "finance.iv.why.sentDue": "Đã xuất, chưa ghi nhận thanh toán — còn {b}, hạn {d}.", // DRAFT — Kevin reviews
  "finance.iv.why.overdue": "Đã quá hạn ({d}), còn {b} chưa trả.", // DRAFT — Kevin reviews
  "finance.iv.why.partial": "Đã trả {p} trên {t} — còn {b}.", // DRAFT — Kevin reviews
  "finance.iv.why.paid": "Đã trả đủ (ghi nhận {p}).", // DRAFT — Kevin reviews
  "finance.iv.why.paidCredit": "Đã tất toán: trả {p} và ghi có {c}.", // DRAFT — Kevin reviews
  "finance.iv.why.credited": "Đã đóng bằng giấy ghi có ({c}).", // DRAFT — Kevin reviews
  "finance.iv.why.void": "Đã hủy — không còn tính vào số dư nào.", // DRAFT — Kevin reviews
  "finance.freshAt": "Số liệu cập nhật {t}", // DRAFT — Kevin reviews
  "finance.freshStale": "Làm mới thất bại — số liệu đúng gần nhất lúc {t}", // DRAFT — Kevin reviews
  "exp.cancel": "Hủy", // DRAFT — Kevin reviews
  "exp.download": "Tải CSV", // DRAFT — Kevin reviews
  "exp.records": "Số bản ghi", // DRAFT — Kevin reviews
  "exp.period": "Khoảng thời gian", // DRAFT — Kevin reviews
  "exp.filters": "Bộ lọc", // DRAFT — Kevin reviews
  "exp.noFilters": "Không có — mọi bản ghi trong khoảng thời gian", // DRAFT — Kevin reviews
  "exp.masked": "Số điện thoại và email của khách được che.", // DRAFT — Kevin reviews
  "exp.formula": "Ô bắt đầu giống công thức bảng tính được làm an toàn.", // DRAFT — Kevin reviews
  "exp.audited": "Lần xuất được ghi vào nhật ký kiểm tra kèm tên bạn.", // DRAFT — Kevin reviews
  "exp.nothing": "Không có bản ghi nào khớp bộ lọc nên không có gì để xuất.", // DRAFT — Kevin reviews
  "exp.cap": "Chỉ {n} bản ghi đầu tiên được xuất — hãy thu hẹp bộ lọc để lấy phần còn lại.", // DRAFT — Kevin reviews
  "finance.bills.calTitle": "Lịch hạn thanh toán hóa đơn", // DRAFT — Kevin reviews
  "finance.bills.calSub": "Hóa đơn chưa thanh toán đến hạn trước {to}, quá hạn hiện trước", // DRAFT — Kevin reviews
  "finance.bills.window": "Khoảng thời gian", // DRAFT — Kevin reviews
  "finance.bills.days": "{n} ngày tới", // DRAFT — Kevin reviews
  "finance.bills.none": "Không có hóa đơn nào đến hạn trong khoảng này.", // DRAFT — Kevin reviews
  "finance.bills.capped": "Đang hiện 200 hóa đơn đầu tiên — thu hẹp khoảng thời gian để xem phần còn lại.", // DRAFT — Kevin reviews
  "finance.bills.overdue": "Quá hạn", // DRAFT — Kevin reviews
  "finance.bills.today": "Đến hạn hôm nay", // DRAFT — Kevin reviews
  "finance.bills.openSum": "Còn nợ {v}", // DRAFT — Kevin reviews
  "finance.alloc.title": "Phân bổ theo chi nhánh", // DRAFT — Kevin reviews
  "finance.alloc.branch": "Chi nhánh", // DRAFT — Kevin reviews
  "finance.alloc.exact": "Chính xác: phần của các chi nhánh cộng lại đúng {v}.", // DRAFT — Kevin reviews
  "finance.alloc.off": "Lệch {v}: các phần cộng lại {s}, chi phí là {t}. Hãy sửa phân bổ trước khi báo cáo.", // DRAFT — Kevin reviews
  "finance.alloc.notCounted": "Chưa vào báo cáo — chỉ chi phí đã duyệt mới được tính.", // DRAFT — Kevin reviews
  "finance.alloc.oneBranch": "Chỉ tính trong báo cáo của {b}.", // DRAFT — Kevin reviews
  "finance.alloc.split": "Báo cáo mỗi chi nhánh tính phần của chi nhánh đó ở trên; tổng của tiệm tính toàn bộ số tiền một lần.", // DRAFT — Kevin reviews
  "finance.alloc.salonWide": "Toàn tiệm, không phân bổ: tính trong tổng của tiệm; báo cáo chi nhánh hiển thị phần được tính toán.", // DRAFT — Kevin reviews
  "finance.pf.title": "Trước khi xuất ({f})", // DRAFT — Kevin reviews
  "finance.pf.export": "Xuất", // DRAFT — Kevin reviews
  "finance.pf.period": "Kỳ", // DRAFT — Kevin reviews
  "finance.pf.scope": "Phạm vi chi nhánh", // DRAFT — Kevin reviews
  "finance.pf.oneBranch": "Một chi nhánh", // DRAFT — Kevin reviews
  "finance.pf.allBranches": "Tất cả chi nhánh bạn được xem", // DRAFT — Kevin reviews
  "finance.pf.rows": "Số dòng", // DRAFT — Kevin reviews
  "finance.pf.filtered": "Đang áp dụng bộ lọc (danh mục, phương thức hoặc tìm kiếm).", // DRAFT — Kevin reviews
  "finance.pf.noDups": "Không có khoản nghi trùng.", // DRAFT — Kevin reviews
  "finance.pf.dups": "{n} khoản nghi trùng — hãy xem lại trước.", // DRAFT — Kevin reviews
  "finance.pf.noUncat": "Mọi dòng đều có danh mục.", // DRAFT — Kevin reviews
  "finance.pf.uncat": "{n} dòng chưa có danh mục.", // DRAFT — Kevin reviews
  "finance.pf.allReceipts": "Mọi dòng đều có biên lai đính kèm.", // DRAFT — Kevin reviews
  "finance.pf.receipts": "{n} dòng chưa có biên lai đính kèm.", // DRAFT — Kevin reviews
  "finance.pf.noUnapproved": "Không có khoản chưa duyệt trong kỳ này.", // DRAFT — Kevin reviews
  "finance.pf.unapproved": "{n} khoản chưa duyệt không được xuất (chỉ xuất chi phí đã duyệt).", // DRAFT — Kevin reviews
  "finance.pf.recon": "Khớp: các dòng cộng lại đúng tổng đã tính {v}.", // DRAFT — Kevin reviews
  "finance.pf.reconOff": "Không khớp: các dòng {a} so với tổng đã tính {b}.", // DRAFT — Kevin reviews
  "finance.pf.reconNa": "Đang lọc hoặc có khoản chưa duyệt: không so sánh với tổng đã tính.", // DRAFT — Kevin reviews
  "finance.pf.note": "Các kiểm tra này không chặn việc xuất; chúng cho thấy kế toán sẽ nhận được gì.", // DRAFT — Kevin reviews
  "finance.rule.openDrafts": "{n} bản nháp đang mở dùng danh mục khác — giữ nguyên trừ khi có người sửa.", // DRAFT — Kevin reviews
  "finance.rule.title": "Quy tắc danh mục theo nhà cung cấp", // DRAFT — Kevin reviews
  "finance.rule.always": "Luôn xếp vào danh mục", // DRAFT — Kevin reviews
  "finance.rule.save": "Lưu quy tắc", // DRAFT — Kevin reviews
  "finance.rule.saved": "Đã lưu quy tắc: {v} → {c} cho các bản nháp sau này.", // DRAFT — Kevin reviews
  "finance.rule.future": "Chỉ áp dụng cho bản nháp sau này: chi phí mới từ nhà cung cấp này sẽ được gợi ý là {c}.", // DRAFT — Kevin reviews
  "finance.rule.history": "Trong 180 ngày qua (từ {since}) nhà cung cấp này có {n} khoản chi; {same} khoản đã dùng danh mục này.", // DRAFT — Kevin reviews
  "finance.rule.noHistory": "Không có khoản chi nào từ nhà cung cấp này từ {since}.", // DRAFT — Kevin reviews
  "finance.rule.approved": "{n} khoản đã duyệt dùng danh mục khác — vẫn giữ nguyên; lịch sử không bao giờ thay đổi.", // DRAFT — Kevin reviews
  "finance.rule.replaces": "Thay thế quy tắc hiện tại của nhà cung cấp này ({c}).", // DRAFT — Kevin reviews
  "finance.rule.noPerm": "Bạn có thể xem trước, nhưng cần quyền danh mục để lưu quy tắc.", // DRAFT — Kevin reviews
  "finance.rule.open": "Quy tắc cho nhà cung cấp này", // DRAFT — Kevin reviews
  "finance.st.sync.title": "Đồng bộ nhà xử lý", // DRAFT — Kevin reviews
  "finance.st.sync.lastBatch": "Lô gần nhất nhận lúc {t}", // DRAFT — Kevin reviews
  "finance.st.sync.lastEvent": "Sự kiện gần nhất từ nhà xử lý {t}", // DRAFT — Kevin reviews
  "finance.st.sync.staleAfter": "Coi là cũ sau {h} giờ không có dữ liệu", // DRAFT — Kevin reviews
  "finance.st.sync.errors": "{p}: {b} sai chữ ký · {u} đã nhận nhưng chưa xử lý (7 ngày qua)", // DRAFT — Kevin reviews
  "finance.st.sync.noErrors": "Không có sự kiện bị từ chối hay chưa xử lý trong 7 ngày qua", // DRAFT — Kevin reviews
  "finance.st.sync.noEvents": "Không nhận được sự kiện nào từ nhà xử lý trong 7 ngày qua", // DRAFT — Kevin reviews
  "finance.iv.recon.clean": "Kiểm tra đối chiếu: không có sai lệch thanh toán–hóa đơn trong {n} hóa đơn thuộc phạm vi.", // DRAFT — Kevin reviews
  "finance.iv.recon.flagged": "Kiểm tra đối chiếu: {f} trong {n} hóa đơn cần xem lại", // DRAFT — Kevin reviews
  "finance.iv.recon.show": "Hiện", // DRAFT — Kevin reviews
  "finance.iv.recon.hide": "Ẩn", // DRAFT — Kevin reviews
  "finance.iv.recon.safe": "Chỉ là gợi ý để kiểm tra — không thay đổi gì. Sửa bằng một khoản thanh toán hoặc phiếu ghi có.", // DRAFT — Kevin reviews
  "finance.iv.recon.detail": "Cần kiểm tra", // DRAFT — Kevin reviews
  "finance.iv.recon.status_paid_with_balance": "Đánh dấu đã trả nhưng số dư khác $0", // DRAFT — Kevin reviews
  "finance.iv.recon.status_partial_no_balance": "Trả một phần nhưng không còn nợ", // DRAFT — Kevin reviews
  "finance.iv.recon.payment_on_unissued": "Có thanh toán trên hóa đơn chưa ở trạng thái thanh toán", // DRAFT — Kevin reviews
  "finance.iv.recon.negative_balance": "Thu nhiều hơn số nợ", // DRAFT — Kevin reviews
  "finance.iv.recon.duplicate_reference": "Mã tham chiếu thanh toán đã dùng cho khoản khác", // DRAFT — Kevin reviews
  "finance.iv.recon.no_reference": "Thanh toán bên ngoài không có mã tham chiếu", // DRAFT — Kevin reviews
};
