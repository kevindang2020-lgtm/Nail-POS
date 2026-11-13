// ns/tips.vi.ts — the POS "tp" namespace, Vietnamese (staff-facing). Terms: tip = tiền tip · collected = đã thu · allocated =
// đã phân bổ · unallocated = chưa phân bổ · reversed = đã đảo ngược · paid out = đã chi trả · payroll snapshot = bản chốt
// lương · technician = thợ. Listed in docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md (A39).
export const TIPS_VI: Record<string, string> = {
  'tp.subtitle': 'Khách tip bao nhiêu, ai được hưởng, thu bằng cách nào, còn nợ hay đã chi trả',
  'tp.exportTips': 'Xuất tiền tip', 'tp.tipsSearchPh': 'Tìm khách, SĐT, thợ, số phiếu, mã giao dịch hoặc số tiền…', 'tp.chip.search': 'Tìm: {q}',
  'tp.allTechnicians': 'Tất cả thợ', 'tp.methodLabel': 'Cách thu', 'tp.allMethods': 'Mọi cách thu', 'tp.noTechnician': 'Chưa có thợ',
  'tp.method.card': 'Thẻ', 'tp.method.cash': 'Tiền mặt', 'tp.method.split': 'Thẻ + tiền mặt', 'tp.method.none': 'Không tip', 'tp.method.gift': 'Thẻ quà tặng',
  'tp.status.tipped': 'Có tip', 'tp.status.no_tip': 'Không tip', 'tp.status.unallocated': 'Chưa phân bổ', 'tp.status.partial': 'Phân bổ một phần', 'tp.status.mismatch': 'Lệch bản chốt lương', 'tp.status.reversed': 'Đã đảo ngược / hoàn', 'tp.status.paid_out': 'Đã chi trả', 'tp.status.pending_payout': 'Chờ chi trả',
  'tp.basis.collected': 'Ngày thu tip', 'tp.basis.checkout': 'Ngày thanh toán', 'tp.basis.allocation': 'Ngày phân bổ', 'tp.basis.adjustment': 'Ngày điều chỉnh', 'tp.basis.payout': 'Ngày chi trả',
  'tp.kpi.total': 'Tổng tiền tip', 'tp.kpi.totalSub': 'Thu trên {n} phiếu có tip', 'tp.kpi.totalSubRev': 'Thu trên {n} phiếu có tip · {r} đã đảo ngược sau đó',
  'tp.kpi.card': 'Tip thẻ', 'tp.kpi.cardSub': 'Giao dịch thẻ đã thành công · không tính lần bị từ chối', 'tp.kpi.cash': 'Tip tiền mặt', 'tp.kpi.cashSub': 'Tiền mặt ghi nhận tại quầy',
  'tp.kpi.avg': 'Tip trung bình', 'tp.kpi.avgSub': '{a} mỗi phiếu có tip · tỷ lệ = tip ÷ doanh thu trước tip', 'tp.kpi.avgSubNone': 'Tip ÷ doanh thu trước tip (chưa thuế)',
  'tp.kpi.noTip': 'Số phiếu không tip', 'tp.kpi.noTipSub': 'Phiếu đã trả không có tip · trong {n} phiếu hợp lệ',
  'tp.views': 'Các mục tiền tip', 'tp.tab.overview': 'Tổng quan', 'tp.tab.transactions': 'Giao dịch tip', 'tp.tab.distribution': 'Phân bổ theo thợ', 'tp.tab.adjustments': 'Điều chỉnh & báo cáo',
  'tp.recon.collected': 'Đã thu', 'tp.recon.allocated': 'Đã phân bổ', 'tp.recon.unallocated': 'Chưa phân bổ', 'tp.recon.paidOut': 'Đã chi trả', 'tp.recon.pending': 'Chờ chi trả', 'tp.recon.reversed': 'Đã đảo ngược', 'tp.recon.manual': 'Điều chỉnh tay (ròng)',
  'tp.recon.snapshot': 'Bản chốt lương', 'tp.recon.mismatch': '{n} phiếu lệch với bản chốt lương', 'tp.recon.ok': 'khớp',
  'tp.reconRule': 'Đã thu + điều chỉnh = đã phân bổ + chưa phân bổ. Chi trả làm giảm số thợ được nhận; không bao giờ tạo thêm tip. Phiếu có bản chốt lương lệch với tip đã thu được đánh dấu ở đây, không bao giờ tự sửa.',
  'tp.byTechnician': 'Tip theo thợ', 'tp.viewAll': 'Xem tất cả', 'tp.distribution': 'Phân bổ', 'tp.recentTitle': 'Giao dịch tip gần đây',
  'tp.barsAlt': 'Tip đã phân bổ theo thợ: {list}', 'tp.ticketsN': '{n} phiếu', 'tp.onePerson': 'Chỉ một thợ có tip được phân bổ trong kỳ này ({a}).',
  'tp.noDistribution': 'Không có tip cho thợ trong kỳ này', 'tp.noDistributionHint': 'Đổi khoảng ngày hoặc kiểm tra bộ lọc phía trên.',
  'tp.d.card': 'Thẻ', 'tp.d.cash': 'Tiền mặt', 'tp.d.allocated': 'Đã phân bổ', 'tp.d.payout': 'Đã chi / chờ chi', 'tp.d.share': 'Tỷ lệ', 'tp.d.corrections': 'Điều chỉnh', 'tp.d.paidOut': 'Đã chi trả', 'tp.d.pending': 'Chờ chi', 'tp.d.tickets': 'Phiếu', 'tp.d.snapshot': 'Bản chốt lương', 'tp.d.net': 'Ròng',
  'tp.paidOut': 'đã chi', 'tp.pending': 'chờ chi', 'tp.noTips': 'Không có tip trong kỳ này', 'tp.noTipsHint': 'Đổi khoảng ngày hoặc xóa bộ lọc.',
  'tp.noMatches': 'Không có tip nào khớp tìm kiếm hoặc bộ lọc', 'tp.noMatchesHint': 'Không có gì trong {p} với bộ lọc này.',
  'tp.col.collected': 'Đã thu', 'tp.col.ticket': 'Phiếu / giao dịch', 'tp.col.customer': 'Khách hàng', 'tp.col.technicians': 'Thợ', 'tp.col.method': 'Cách thu', 'tp.col.amount': 'Tiền tip', 'tp.col.allocation': 'Phân bổ', 'tp.col.payout': 'Chi trả',
  'tp.sort.collected_desc': 'Mới nhất trước', 'tp.sort.collected_asc': 'Cũ nhất trước', 'tp.sort.amount_desc': 'Tip lớn nhất', 'tp.sort.amount_asc': 'Tip nhỏ nhất', 'tp.sort.ticket_desc': 'Số phiếu',
  'tp.splitTender': '{n} khoản', 'tp.matched.reference': 'khớp mã', 'tp.matched.name': 'khớp tên', 'tp.techCount': '{n} thợ', 'tp.reversed': 'đã đảo ngược',
  'tp.alloc.allocated': 'Đã phân bổ', 'tp.alloc.partial': 'Phân bổ một phần', 'tp.alloc.unallocated': 'Chưa phân bổ', 'tp.alloc.over': 'Phân bổ vượt', 'tp.alloc.none': 'Không tip',
  'tp.payout.paid': 'Đã chi trả', 'tp.payout.approved': 'Đã duyệt', 'tp.payout.open': 'Chờ chi trả', 'tp.payout.none': 'Chưa vào kỳ lương',
  'tp.mismatch': 'Lệch bản chốt lương', 'tp.mismatchLong': 'Bản chốt lương {s} ≠ đã thu {c} — kiểm tra trước khi tính lương',
  'tp.dsort.allocated_desc': 'Phân bổ nhiều nhất', 'tp.dsort.allocated_asc': 'Phân bổ ít nhất', 'tp.dsort.name_asc': 'Tên A–Z', 'tp.dsort.tickets_desc': 'Nhiều phiếu nhất', 'tp.archived': 'Đã lưu trữ', 'tp.viewTips': 'Xem tip',
  'tp.reportsTitle': 'Đối soát & báo cáo', 'tp.exportMatching': 'Xuất tất cả tip khớp (CSV)', 'tp.adjustmentsTitle': 'Điều chỉnh & đảo ngược', 'tp.adjSearchPh': 'Thợ, số phiếu hoặc lý do',
  'tp.kindLabel': 'Loại', 'tp.kind.all': 'Điều chỉnh và đảo ngược', 'tp.kind.correction': 'Điều chỉnh tay', 'tp.kind.reversal': 'Đảo ngược do hoàn / hủy',
  'tp.source.refund': 'hoàn tiền', 'tp.source.void': 'hủy giao dịch', 'tp.source.chargeback': 'bồi hoàn',
  'tp.noAdjustments': 'Không có điều chỉnh tip trong kỳ này', 'tp.noAdjustmentsHint': 'Điều chỉnh từ chi tiết một khoản tip và đảo ngược do hoàn tiền sẽ hiện ở đây.',
  'tp.a.date': 'Ngày', 'tp.a.kind': 'Loại', 'tp.a.reason': 'Lý do', 'tp.a.by': 'Người thực hiện',
  'tp.astatus.posted': 'Đã ghi', 'tp.astatus.approved': 'Đã duyệt', 'tp.astatus.applied': 'Đã áp dụng', 'tp.astatus.pending': 'Đang chờ', 'tp.astatus.pending_review': 'Chờ xem xét', 'tp.astatus.rejected': 'Bị từ chối',
  'tp.detailTitle': 'Tip trên phiếu #{n}', 'tp.detailTitleBare': 'Tiền tip', 'tp.stepup': 'Nhập mật khẩu để điều chỉnh phân bổ tip.',
  'tp.f.tipEvent': 'Mã khoản tip', 'tp.f.payments': 'Thanh toán', 'tp.f.tipPart': '{a} tip', 'tp.f.cardCash': 'Thẻ / tiền mặt', 'tp.f.pretip': 'Doanh thu trước tip · tỷ lệ', 'tp.f.collected': 'Đã thu', 'tp.f.checkout': 'Thanh toán', 'tp.f.splitRule': 'Cách chia', 'tp.f.reversed': 'Đã đảo ngược', 'tp.f.payout': 'Chi trả',
  'tp.rule.none': 'Chưa phân bổ', 'tp.rule.single': 'Một thợ', 'tp.rule.equal': 'Chia đều', 'tp.rule.weighted_or_directed': 'Chia theo tỷ trọng / chỉ định',
  'tp.allocTitle': 'Phân bổ cho thợ', 'tp.noAllocations': 'Chưa ghi nhận phân bổ thợ cho khoản tip này.',
  'tp.adjust': 'Điều chỉnh phân bổ', 'tp.reason': 'Lý do', 'tp.saveAdjustment': 'Ghi điều chỉnh', 'tp.sumCheck': 'Tổng phân bổ {s} · tip đã thu {t}', 'tp.adjusted': 'Đã ghi phân bổ tip trên #{n}.',
  'tp.adjustNote': 'Tổng chia phải bằng tip đã thu. Với phiếu đã trả, hệ thống ghi các bút toán điều chỉnh có dấu; bản chốt lương và giao dịch thẻ không bao giờ bị sửa. Hoàn tiền thẻ ở mục Hoàn tiền & Hủy.',
  'tp.audit.ticket.tip_allocation_set': 'Đã đặt phân bổ tip', 'tp.audit.tips_exported': 'Đã xuất tiền tip',
  'tp.freeAdjust': 'Thêm hoặc bớt tiền tip',
  'tp.freeDir': 'Thay đổi',
  'tp.freeAdd': 'Thêm vào tiền tip',
  'tp.freeRemove': 'Bớt khỏi tiền tip',
  'tp.freeConfirm': 'Sẽ ghi {a} cho {n} trên hóa đơn này.',
  'tp.freeNote': 'Được ghi là điều chỉnh tiền tip kèm tên và lý do của bạn. Tiền tip đã thu và khoản thu thẻ không đổi; hoàn tiền thẻ làm ở mục Hoàn tiền. Nếu kỳ lương đã duyệt hoặc đã trả, khoản này chuyển sang kỳ đang mở tiếp theo.',
  'tp.audit.ticket.tip_adjusted': 'Đã điều chỉnh tiền tip',
  'tp.split.even': 'Chia đều', // DRAFT — Kevin reviews
  'tp.split.now': 'Hiện tại', // DRAFT — Kevin reviews
  'tp.split.after': 'Sau khi đổi', // DRAFT — Kevin reviews
  'tp.split.change': 'Thay đổi', // DRAFT — Kevin reviews
  'tp.split.remainder': 'Phần lẻ làm tròn: {c}¢, mỗi người một xu cho {n}', // DRAFT — Kevin reviews
  'tp.split.diff': 'Lệch {a} — các phần phải cộng đúng bằng tiền tip đã thu', // DRAFT — Kevin reviews
  'tp.split.nothingSaved': 'Chỉ xem trước — không có gì thay đổi cho đến khi bạn lưu kèm lý do.', // DRAFT — Kevin reviews
  'tp.src.verified': 'Đã xác minh', // DRAFT — Kevin reviews
  'tp.src.verified.why': 'tiền tip đã thu, đã chia và bản ghi lương khớp nhau', // DRAFT — Kevin reviews
  'tp.src.pending': 'Đang chờ', // DRAFT — Kevin reviews
  'tp.src.pending.why': 'chưa chia hết, hoặc bảng lương chưa ghi nhận', // DRAFT — Kevin reviews
  'tp.src.adjusted': 'Đã điều chỉnh', // DRAFT — Kevin reviews
  'tp.src.adjusted.why': 'đã có khoản hoàn hoặc điều chỉnh thủ công sau khi chia', // DRAFT — Kevin reviews
  'tp.src.review': 'Cần xem lại', // DRAFT — Kevin reviews
  'tp.src.review.why': 'bản ghi lương không khớp với tiền tip đã thu', // DRAFT — Kevin reviews
  'tp.ri.open': 'Hoàn tiền sẽ ảnh hưởng thế nào?', // DRAFT — Kevin reviews
  'tp.ri.title': 'Xem trước ảnh hưởng hoàn tiền', // DRAFT — Kevin reviews
  'tp.ri.scenario': 'Nếu phiếu này được', // DRAFT — Kevin reviews
  'tp.ri.sc.service_only': 'Hoàn tiền — chỉ dịch vụ (giữ tip)', // DRAFT — Kevin reviews
  'tp.ri.sc.full_with_tip': 'Hoàn tiền — gồm cả tip', // DRAFT — Kevin reviews
  'tp.ri.sc.void': 'Hủy phiếu', // DRAFT — Kevin reviews
  'tp.ri.sc.chargeback': 'Khiếu nại (chargeback)', // DRAFT — Kevin reviews
  'tp.ri.collected': 'Tip đã thu', // DRAFT — Kevin reviews
  'tp.ri.collectedSame': 'giữ nguyên như đã thu; khoản hoàn được ghi riêng bên cạnh', // DRAFT — Kevin reviews
  'tp.ri.net': 'Tip thực nhận', // DRAFT — Kevin reviews
  'tp.ri.payable': 'Phải trả', // DRAFT — Kevin reviews
  'tp.ri.post.none': 'Không thay đổi — tip không bị hoàn.', // DRAFT — Kevin reviews
  'tp.ri.post.posted_now': 'Khoản hoàn được trừ của thợ trong kỳ lương đang mở.', // DRAFT — Kevin reviews
  'tp.ri.post.future_period_pending': 'Kỳ lương này đã trả: khoản hoàn chuyển sang kỳ sau và chờ duyệt.', // DRAFT — Kevin reviews
  'tp.ri.post.pending_review': 'Chargeback không bị trừ tự động — chờ quản lý xem xét.', // DRAFT — Kevin reviews
  'tp.ri.readOnly': 'Chỉ xem trước — không hoàn tiền, hủy hay ghi sổ gì từ đây.', // DRAFT — Kevin reviews
  'tp.kpi.cashSourceSub': 'Ngăn kéo {d} · đưa thợ {t}', // DRAFT — Kevin reviews
  'tp.cashSource.drawer': 'vào ngăn kéo', // DRAFT — Kevin reviews
  'tp.cashSource.technician': 'đưa trực tiếp cho thợ', // DRAFT — Kevin reviews
};
