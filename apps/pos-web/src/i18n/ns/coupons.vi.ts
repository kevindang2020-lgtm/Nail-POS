// ns/coupons.vi.ts — Tiếp thị → Phiếu giảm giá (Coupons & Promotions, 30/10/2026) (Tiếng Việt). Chỉ dùng cho POS quầy lễ tân.
export const COUPONS_VI = {
  'cp.title': 'Phiếu giảm giá & Khuyến mãi', 'cp.subtitle': 'Mã ưu đãi, điều kiện, lượt dùng và số tiền giảm mà Thanh toán thực sự áp dụng',
  'cp.checkCustomer': 'Khách hàng (không bắt buộc)',
  'cp.checkCustomerPh': 'Tên hoặc số điện thoại — cho quy tắc khách mới và mỗi khách một lần',
  'cp.healthHistory': 'Lịch sử kiểm tra',
  'cp.healthRun': 'Kiểm tra ngay',
  'cp.healthNoRuns': 'Chưa có lần kiểm tra nào được ghi lại.',
  'cp.healthAllClear': 'không có vấn đề',
  'cp.location': 'Chi nhánh',
  'cp.allLocations': 'Mọi chi nhánh',
  'cp.expiringWindow': 'Khoảng sắp hết hạn',
  'cp.expiringIn': 'Hết hạn trong {n} ngày',
  'cp.exportCsv': 'Xuất CSV',
  'cp.redBasis.applied': 'Lúc áp mã',
  'cp.redBasis.finalized': 'Lúc hóa đơn thanh toán xong',
  'cp.assistant': 'Trợ lý phiếu giảm giá', 'cp.newCoupon': 'Phiếu giảm giá mới', 'cp.editTitle': 'Sửa {name}', 'cp.failed': 'Không thực hiện được — vui lòng thử lại.',
  'cp.created': 'Đã lưu "{name}" dưới dạng nháp. Gửi duyệt và kích hoạt để dùng được khi thanh toán.', 'cp.saved': 'Đã lưu "{name}" (phiên bản mới).',
  'cp.duplicated': 'Đã tạo bản nháp sao chép "{name}" — không sao chép mã, lượt dùng hay lịch sử.', 'cp.assistDrafted': 'Đã lưu "{name}" dưới dạng nháp từ trợ lý. Chưa có gì được kích hoạt hay gửi đi.',
  'cp.hiddenByFilters': 'Bộ lọc hiện tại đang ẩn nó — xóa bộ lọc để thấy ở đầu danh sách.',
  'cp.kpi.total': 'Tổng', 'cp.kpi.totalSub': 'Mọi phiếu giảm giá ({a} đã lưu trữ)', 'cp.kpi.active': 'Đang hoạt động', 'cp.kpi.paused': 'Tạm dừng', 'cp.kpi.pausedSub': 'Tạm dừng có chủ ý; lịch sử được giữ',
  'cp.kpi.redSub': 'Đã hoàn tất khi thanh toán · {p} đang chờ trên phiếu chưa trả (không tính)', 'cp.kpi.value': 'Số tiền giảm đã dùng', 'cp.kpi.valueSub': 'Thực tế · đã giảm {g}, hoàn lại {r} do hoàn tiền',
  'cp.searchLib': 'Tìm mã, tên, ID, dịch vụ hoặc khách đã dùng…', 'cp.searchRed': 'Tìm tên khách, số điện thoại, số phiếu #, mã hoặc ID lượt dùng…',
  'cp.service': 'Dịch vụ', 'cp.anyService': 'Mọi dịch vụ',
  'cp.basis.created': 'Ngày tạo', 'cp.basis.updated': 'Ngày cập nhật', 'cp.basis.starts': 'Ngày bắt đầu', 'cp.basis.ends': 'Ngày kết thúc', 'cp.basis.active': 'Có hiệu lực trong khoảng', 'cp.basisShown': 'Lọc theo ngày: {b}',
  'cp.tab.library': 'Thư viện', 'cp.tab.redemptions': 'Lịch sử sử dụng', 'cp.tab.health': 'Tình trạng', 'cp.library': 'Thư viện phiếu giảm giá / khuyến mãi',
  'cp.col.value': 'Giá trị', 'cp.minSpend': 'Chi tối thiểu {v}', 'cp.ends': 'Kết thúc {d}', 'cp.view': 'Xem', 'cp.check': 'Kiểm tra', 'cp.rows': 'Số dòng',
  'cp.empty': 'Chưa có phiếu giảm giá.', 'cp.redTotals': '{c} khách đã tiết kiệm {v}',
  'cp.health.ready': 'Ổn định', 'cp.health.attention': 'Cần chú ý', 'cp.health.failed': 'Lỗi', 'cp.health.unknown': 'Chưa rõ',
  'cp.check.counters': 'Số lượt dùng khớp sổ ghi', 'cp.check.paid_not_marked': 'Phiếu đã trả đã ghi nhận mã giảm giá', 'cp.check.stuck_holds': 'Không có mã nào bị giữ trên phiếu bỏ dở',
  'cp.check.confirmed_unpaid': 'Lượt dùng hoàn tất đều trên phiếu đã trả', 'cp.check.expiry_lag': 'Phiếu hết hạn đã được đóng đúng giờ',
  'cp.healthNote': 'Kiểm tra lúc {t}. Vấn đề được báo cho quản lý — không tự động sửa dữ liệu.',
  'cp.dtab.codes': 'Mã', 'cp.dtab.financial': 'Tài chính', 'cp.dtab.campaigns': 'Chiến dịch liên quan',
  'cp.fin.net': 'Tổng giảm thực tế', 'cp.fin.linked': 'Phiếu đã trả có dùng mã', 'cp.fin.avg': 'Mức giảm trung bình',
  'cp.fin.note': 'Tổng phiếu liên quan đến mã giảm giá, không phải do mã tạo ra — không có thử nghiệm đo lượt ghé thêm.',
  'cp.noCampaigns': 'Chưa có chiến dịch nào liên kết với phiếu này.', 'cp.codesLinked': '{n} mã', 'cp.campaignNote': 'Chiến dịch được liên kết khi mã được tạo cho nó. Tin nhắn chỉ nhắc đến ưu đãi không phải là liên kết.',
  'cp.edit': 'Sửa', 'cp.duplicate': 'Nhân bản', 'cp.readOnly': 'Chỉ xem — chủ tiệm hoặc quản lý mới thay đổi được.',
  'cp.act.submit': 'Gửi duyệt', 'cp.act.approve': 'Duyệt', 'cp.act.publish': 'Kích hoạt', 'cp.act.pause': 'Tạm dừng', 'cp.act.resume': 'Tiếp tục', 'cp.act.cancel': 'Hủy', 'cp.act.archive': 'Lưu trữ',
  'cp.did.submit': 'Đã gửi duyệt "{name}".', 'cp.did.approve': 'Đã duyệt "{name}" — kích hoạt để sử dụng.', 'cp.did.publish': '"{name}" đã hoạt động (hoặc được lên lịch bắt đầu).',
  'cp.did.pause': 'Đã tạm dừng "{name}". Phiếu mới không dùng được; lượt dùng cũ được giữ.', 'cp.did.resume': '"{name}" hoạt động trở lại.', 'cp.did.cancel': 'Đã hủy "{name}".', 'cp.did.archive': 'Đã lưu trữ "{name}". Lịch sử vẫn có trong báo cáo.',
  'cp.checkTitle': 'Kiểm tra {name}', 'cp.checkSub': 'Cùng quy tắc với Thanh toán. Kiểm tra không dùng, giữ hay tính lượt mã.',
  'cp.ticketNumber': 'Số phiếu (không bắt buộc)', 'cp.orHypothetical': 'Hoặc kiểm tra một lượt ghé mẫu:', 'cp.spend': 'Tạm tính phiếu ($)', 'cp.services': 'Dịch vụ', 'cp.codeEntered': 'Khách có mã',
  'cp.checkRun': 'Kiểm tra', 'cp.wouldTake': 'Sẽ giảm {v} trên {b}', 'cp.readOnlyCheck': 'Chỉ kiểm tra — không áp dụng hay tính lượt.',
  'cp.v.ELIGIBLE': 'Hợp lệ', 'cp.v.NOT_YET_ACTIVE': 'Chưa bắt đầu', 'cp.v.EXPIRED': 'Đã hết hạn', 'cp.v.PAUSED': 'Tạm dừng', 'cp.v.WRONG_BRANCH': 'Sai chi nhánh',
  'cp.v.INELIGIBLE_SERVICE': 'Dịch vụ không áp dụng', 'cp.v.MIN_SPEND': 'Chưa đủ chi tối thiểu', 'cp.v.LIMIT_REACHED': 'Đã hết lượt', 'cp.v.ALREADY_USED': 'Đã dùng rồi',
  'cp.v.REQUIRES_APPROVAL': 'Cần duyệt', 'cp.v.CONFIG_MISSING': 'Chưa thiết lập', 'cp.v.NOT_COMBINABLE': 'Không thể kết hợp', 'cp.v.NEEDS_CUSTOMER': 'Chọn khách hàng',
  'cp.v.NEEDS_CODE': 'Cần mã', 'cp.v.CUSTOMER_INELIGIBLE': 'Khách không đủ điều kiện', 'cp.v.NOT_AVAILABLE': 'Không khả dụng',
  'cp.va.ELIGIBLE': 'Có thể áp dụng khi thanh toán.', 'cp.va.NOT_YET_ACTIVE': 'Chờ đến ngày bắt đầu, hoặc nhờ quản lý thay đổi.', 'cp.va.EXPIRED': 'Đã kết thúc; quản lý có thể gia hạn ngày kết thúc.',
  'cp.va.PAUSED': 'Quản lý đã tạm dừng (hoặc ưu đãi của tiệm đang tạm dừng).', 'cp.va.WRONG_BRANCH': 'Dùng tại chi nhánh đã tạo.', 'cp.va.INELIGIBLE_SERVICE': 'Thêm một dịch vụ áp dụng vào phiếu.',
  'cp.va.MIN_SPEND': 'Phiếu cần đạt mức chi tối thiểu trước.', 'cp.va.LIMIT_REACHED': 'Đã hết tổng lượt hoặc ngân sách.', 'cp.va.ALREADY_USED': 'Khách hoặc mã này đã dùng đủ số lần cho phép.',
  'cp.va.REQUIRES_APPROVAL': 'Đây là bản nháp hoặc đang chờ duyệt — chủ tiệm hoặc quản lý cần kích hoạt.', 'cp.va.CONFIG_MISSING': 'Chưa có mức giảm hoặc chưa có mã — quản lý cần hoàn tất.',
  'cp.va.NOT_COMBINABLE': 'Quy tắc kết hợp giữ ưu đãi tốt hơn đã có trên phiếu.', 'cp.va.NEEDS_CUSTOMER': 'Chọn khách hàng trước.', 'cp.va.NEEDS_CODE': 'Hỏi khách mã giảm giá.',
  'cp.va.CUSTOMER_INELIGIBLE': 'Khách này không thuộc đối tượng áp dụng.', 'cp.va.NOT_AVAILABLE': 'Không khả dụng.',
  'cp.duplicateTitle': 'Nhân bản {name}', 'cp.duplicateSub': 'Bản nháp mới với cùng điều khoản. Không bao giờ sao chép mã, lượt dùng hay lịch sử.', 'cp.newCode': 'Mã (không bắt buộc)',
  'cp.assistSub': 'Gợi ý từ chính phiếu của tiệm bạn. Bạn quyết định; trợ lý chỉ lưu bản nháp.', 'cp.goal': 'Mục tiêu', 'cp.suggest': 'Gợi ý',
  'cp.goal.slow_weekdays': 'Lấp đầy ngày vắng', 'cp.goal.promote_service': 'Quảng bá một dịch vụ', 'cp.goal.returning_visits': 'Khuyến khích quay lại lần hai', 'cp.goal.reconnect_inactive': 'Kết nối lại khách lâu không ghé',
  'cp.percentOff': 'Giảm phần trăm', 'cp.onePerCustomer': 'mỗi khách một lần', 'cp.eligibleCustomers': 'Số khách có thể dùng', 'cp.exposure': 'Chi phí tối đa', 'cp.exposureNote': 'nếu {n} lượt ghé như cũ lặp lại cùng mã',
  'cp.assistSave': 'Lưu bản nháp', 'cp.assistSafety': 'Lưu chỉ tạo bản nháp. Kích hoạt và gửi cho khách là các bước riêng, cần duyệt.',
  'cp.check.stacking_overlap': 'Không có phiếu đang chạy nào vô tình cộng dồn với nhau', // DRAFT — Kevin reviews
  'cp.check.cap_exceeded': 'Không có phiếu nào bị dùng quá giới hạn', // DRAFT — Kevin reviews
  'cp.check.repeat_accounts': 'Không có phiếu nào bị dùng bởi hồ sơ khách trùng nhau', // DRAFT — Kevin reviews
  'cp.stk.title': 'Cách kết hợp · quy tắc tiệm: {m}', // DRAFT — Kevin reviews
  'cp.stk.mode.best_single': 'một ưu đãi mỗi phiếu', // DRAFT — Kevin reviews
  'cp.stk.mode.stack_all': 'các ưu đãi kết hợp được thì cộng dồn', // DRAFT — Kevin reviews
  'cp.stk.mode.stack_groups': 'cộng dồn, mỗi nhóm một', // DRAFT — Kevin reviews
  'cp.stk.mode.exclusive': 'độc quyền', // DRAFT — Kevin reviews
  'cp.stk.b.other_offer': 'Ưu đãi hoặc coupon khác', // DRAFT — Kevin reviews
  'cp.stk.b.membership_discount': 'Giảm giá hội viên', // DRAFT — Kevin reviews
  'cp.stk.b.membership_credit': 'Tín dụng hội viên trả trước', // DRAFT — Kevin reviews
  'cp.stk.b.loyalty_reward': 'Phần thưởng tích điểm', // DRAFT — Kevin reviews
  'cp.stk.b.gift_card_tender': 'Thanh toán bằng thẻ quà tặng', // DRAFT — Kevin reviews
  'cp.stk.b.price_floor': 'Giá tối thiểu', // DRAFT — Kevin reviews
  'cp.stk.b.discount_cap': 'Tổng giảm giá tối đa', // DRAFT — Kevin reviews
  'cp.stk.a.yes': 'Kết hợp được', // DRAFT — Kevin reviews
  'cp.stk.a.no': 'Không kết hợp', // DRAFT — Kevin reviews
  'cp.stk.a.conditional': 'Tùy trường hợp', // DRAFT — Kevin reviews
  'cp.stk.a.limit': 'Giới hạn', // DRAFT — Kevin reviews
  'cp.stk.a.none': 'Chưa đặt', // DRAFT — Kevin reviews
  'cp.stk.r.other_offer.policy_one_offer': 'Tiệm chỉ cho một ưu đãi hoặc coupon mỗi phiếu — giữ cái có lợi nhất cho khách.', // DRAFT — Kevin reviews
  'cp.stk.r.other_offer.offer_not_stackable': 'Ưu đãi này không được đánh dấu kết hợp, nên được so riêng; giữ kết quả tốt hơn.', // DRAFT — Kevin reviews
  'cp.stk.r.other_offer.other_stackable_other_group': 'Kết hợp với các ưu đãi kết hợp được khác, trừ ưu đãi cùng nhóm.', // DRAFT — Kevin reviews
  'cp.stk.r.other_offer.other_stackable': 'Kết hợp với các ưu đãi hoặc coupon khác cũng được đánh dấu kết hợp.', // DRAFT — Kevin reviews
  'cp.stk.r.membership_discount.policy_exclusive': 'Quy tắc độc quyền: không dùng chung với giảm giá hội viên — giữ cái tốt hơn.', // DRAFT — Kevin reviews
  'cp.stk.r.membership_discount.allowed_by_policy': 'Được dùng thêm trên giảm giá hội viên (giảm giá hội viên tính trước).', // DRAFT — Kevin reviews
  'cp.stk.r.membership_discount.not_allowed_by_policy': 'Không được dùng chung với giảm giá hội viên — Thanh toán giữ cái tốt hơn.', // DRAFT — Kevin reviews
  'cp.stk.r.membership_credit.prepaid_credit': 'Tín dụng hội viên trả trước luôn được áp dụng — khách đã trả cho dịch vụ đó.', // DRAFT — Kevin reviews
  'cp.stk.r.loyalty_reward.policy_exclusive': 'Quy tắc độc quyền: không dùng chung với phần thưởng tích điểm — giữ cái tốt hơn.', // DRAFT — Kevin reviews
  'cp.stk.r.loyalty_reward.allowed_by_policy': 'Có thể dùng phần thưởng tích điểm trên cùng phiếu (tính sau cùng).', // DRAFT — Kevin reviews
  'cp.stk.r.loyalty_reward.not_allowed_by_policy': 'Không được dùng chung với phần thưởng tích điểm — Thanh toán giữ cái tốt hơn.', // DRAFT — Kevin reviews
  'cp.stk.r.gift_card_tender.payment_not_discount': 'Thẻ quà tặng là cách thanh toán, không phải giảm giá: trả phần còn lại và không thay đổi giảm giá.', // DRAFT — Kevin reviews
  'cp.stk.r.price_floor.floor_set': 'Khách luôn trả ít nhất {v}% tổng phụ; phần giảm vượt bị cắt, cắt cái sau cùng trước.', // DRAFT — Kevin reviews
  'cp.stk.r.price_floor.floor_unset': 'Không đặt phần tối thiểu — một dòng có thể giảm về 0, không thấp hơn.', // DRAFT — Kevin reviews
  'cp.stk.r.discount_cap.cap_set': 'Tổng mọi giảm giá tối đa {v}% tổng phụ; phần vượt bị cắt, cắt cái sau cùng trước.', // DRAFT — Kevin reviews
  'cp.stk.r.discount_cap.cap_unset': 'Không có tổng giảm giá tối đa ngoài giá tối thiểu.', // DRAFT — Kevin reviews
  'cp.roi.title': 'Nguồn gốc số tiền (toàn thời gian)', // DRAFT — Kevin reviews
  'cp.roi.revenue': 'Doanh số có dùng ưu đãi', // DRAFT — Kevin reviews
  'cp.roi.tickets': '{n} phiếu đã thanh toán', // DRAFT — Kevin reviews
  'cp.roi.discount': 'Chi phí giảm giá', // DRAFT — Kevin reviews
  'cp.roi.spend': 'Chi phí chiến dịch', // DRAFT — Kevin reviews
  'cp.roi.spendKnown': '{a} · {n} chiến dịch · {m} tin nhắn', // DRAFT — Kevin reviews
  'cp.roi.spendUnknown': 'Chưa biết — nhà cung cấp mới báo chi phí của {c} trên {m} tin nhắn.', // DRAFT — Kevin reviews
  'cp.roi.noCampaign': 'Không có chiến dịch nào gắn với ưu đãi này.', // DRAFT — Kevin reviews
  'cp.roi.lift': 'Lượt ghé thêm do ưu đãi', // DRAFT — Kevin reviews
  'cp.roi.liftUnverified': 'Chưa xác minh — không có nhóm so sánh nên không đưa ra con số.', // DRAFT — Kevin reviews
  'cp.roi.branches': 'Theo chi nhánh', // DRAFT — Kevin reviews
  'cp.roi.branch': 'Chi nhánh', // DRAFT — Kevin reviews
  'cp.roi.customers': 'Khách hàng', // DRAFT — Kevin reviews
  'cp.roi.noBranch': 'Không có chi nhánh', // DRAFT — Kevin reviews
  'cp.dtab.related': 'Ưu đãi liên quan', // DRAFT — Kevin reviews
  'cp.rel.same': 'Cùng quyền lợi', // DRAFT — Kevin reviews
  'cp.rel.noneSame': 'Không có ưu đãi nào khác đang chạy hoặc sắp chạy cho cùng quyền lợi.', // DRAFT — Kevin reviews
  'cp.rel.allBranches': 'Tất cả chi nhánh', // DRAFT — Kevin reviews
  'cp.rel.allServices': 'Mọi dịch vụ', // DRAFT — Kevin reviews
  'cp.rel.sharedServices': '{n} dịch vụ chung', // DRAFT — Kevin reviews
  'cp.rel.stackable': 'Cộng gộp được', // DRAFT — Kevin reviews
  'cp.rel.note': 'Cùng quyền lợi = cùng loại và mức giảm, chi nhánh và dịch vụ trùng nhau, và ngày trùng nhau. Hãy xem lại cả hai có đúng ý không; ở đây không thay đổi gì.', // DRAFT — Kevin reviews
} as const;
