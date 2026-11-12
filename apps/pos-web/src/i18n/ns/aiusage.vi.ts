// ns/aiusage.vi.ts — AI Usage & Limits Complete Build Guide (Oct 30 2026) (Vietnamese). Staff-facing Front Desk POS only.
export const AIUSAGE_VI = {
  'aiu.subtitle': 'Các gói AI của tiệm, chi phí từng gói, mức đã dùng trong kỳ này và việc có thể làm tiếp.',
  'aiu.asOf': 'Kiểm tra lúc {t}',
  'aiu.refresh': 'Làm mới',
  'aiu.history': 'Lịch sử sử dụng',
  'aiu.loadFailed': 'Không tải được dữ liệu sử dụng AI.',
  'aiu.kpi.total': 'Có sẵn',
  'aiu.kpi.totalSub': 'Theo danh mục AI',
  'aiu.kpi.active': 'Tiện ích AI đang dùng',
  'aiu.kpi.activeSub': 'Đã trả phí và còn hiệu lực',
  'aiu.kpi.activeSubPastDue': '+ {n} quá hạn thanh toán (không tính)',
  'aiu.kpi.trials': 'Dùng thử / Chờ xử lý',
  'aiu.kpi.trialsSub': '{t} đang dùng thử · {e} hết hạn dùng thử · {p} quá hạn',
  'aiu.kpi.cost': 'Chi phí AI hằng tháng',
  'aiu.kpi.costRestricted': 'Chỉ vai trò quản lý thanh toán của chủ tiệm mới xem chi phí',
  'aiu.restricted': 'Bị giới hạn',
  'aiu.basis.reconciled': 'Khớp với các khoản đã thanh toán trong kỳ',
  'aiu.basis.subscription_records': 'Theo hồ sơ gói — chưa ghi nhận đủ thanh toán',
  'aiu.basis.no_paid_packages': 'Chưa có gói AI trả phí',
  'aiu.basis.occurred': 'Ngày sử dụng',
  'aiu.basis.current_period': 'Kỳ thanh toán hiện tại',
  'aiu.alert.80': '{name}: đã dùng {used} / {limit} (80%) — còn {left} trong kỳ này.',
  'aiu.alert.90': '{name}: đã dùng {used} / {limit} (90%) — chỉ còn {left} trong kỳ này.',
  'aiu.alert.100': '{name}: đã dùng hết {limit} — yêu cầu mới bị dừng đến khi kỳ mới bắt đầu.',
  'aiu.viewDetails': 'Xem chi tiết',
  'aiu.ack': 'Đã hiểu',
  'aiu.ackFailed': 'Không đánh dấu được cảnh báo là đã xem.',
  'aiu.moreAlerts': '+ {n} cảnh báo khác',
  'aiu.toolbar': 'Tìm kiếm và bộ lọc',
  'aiu.search': 'Tìm gói AI…',
  'aiu.statusFilter': 'Trạng thái',
  'aiu.filter.all': 'Tất cả',
  'aiu.filter.active': 'Đang hoạt động',
  'aiu.filter.trialing': 'Đang dùng thử',
  'aiu.filter.trial_expired': 'Hết hạn dùng thử',
  'aiu.filter.cancelled': 'Đã hủy',
  'aiu.filter.past_due': 'Quá hạn',
  'aiu.filter.disabled': 'Đã tắt',
  'aiu.filter.available': 'Chưa đăng ký',
  'aiu.category': 'Danh mục',
  'aiu.cat.all': 'Mọi danh mục',
  'aiu.cat.front_desk': 'Quầy lễ tân',
  'aiu.cat.operations': 'Vận hành',
  'aiu.cat.growth': 'Tăng trưởng',
  'aiu.cat.finance': 'Tài chính',
  'aiu.cat.insights': 'Phân tích',
  'aiu.cat.unknown': 'Khác',
  'aiu.sort': 'Sắp xếp',
  'aiu.sort.catalog': 'Thứ tự danh mục',
  'aiu.sort.name': 'Tên',
  'aiu.sort.newest': 'Đăng ký mới nhất',
  'aiu.sort.usage': '% sử dụng (cao nhất)',
  'aiu.sort.cost': 'Chi phí hằng tháng (cao nhất)',
  'aiu.sortNote': 'Sắp xếp theo {s}',
  'aiu.packages': 'Gói AI',
  'aiu.noMatch': 'Không có gói AI nào khớp bộ lọc.',
  'aiu.cardAria': '{name}, {state}. Mở chi tiết',
  'aiu.unknownPackage': 'Gói {code} không còn trong danh mục AI; dữ liệu vẫn được giữ.',
  'aiu.notMetered': 'Chưa sử dụng',
  'aiu.usageUnknown': 'Không đọc được mức sử dụng',
  'aiu.unlimited': '{used} · không giới hạn cố định',
  'aiu.trialLeft': 'Dùng thử: còn {n} ngày (hết {date})',
  'aiu.trialEndedOn': 'Hết dùng thử {date}',
  'aiu.disabledByAdmin': 'Đã bị nền tảng tắt',
  'aiu.resets': 'Làm mới {date}',
  'aiu.trialDays': 'Dùng thử miễn phí {n} ngày',
  'aiu.perMonth': '/tháng',
  'aiu.perYear': '/năm',
  'aiu.included': 'Đã bao gồm',
  'aiu.state.available': 'Chưa đăng ký',
  'aiu.state.trial_available': 'Có thể dùng thử',
  'aiu.state.trialing': 'Đang dùng thử',
  'aiu.state.trial_expired': 'Hết hạn dùng thử',
  'aiu.state.active': 'Đang hoạt động',
  'aiu.state.cancelled': 'Đã hủy',
  'aiu.state.expired': 'Đã hết hạn',
  'aiu.state.past_due': 'Quá hạn thanh toán',
  'aiu.state.suspended': 'Tạm ngưng',
  'aiu.state.disabled_by_admin': 'Bị quản trị tắt',
  'aiu.state.unable_to_verify': 'Không xác minh được',
  'aiu.action.view_details': 'Xem chi tiết',
  'aiu.action.start_trial': 'Bắt đầu dùng thử',
  'aiu.action.cancel': 'Hủy gói',
  'aiu.action.upgrade': 'Nâng cấp',
  'aiu.action.reactivate': 'Kích hoạt lại',
  'aiu.action.update_billing': 'Cập nhật thanh toán',
  'aiu.action.open_module': 'Mở mô-đun',
  'aiu.level.warn_80': 'Đã dùng 80%',
  'aiu.level.critical_90': 'Đã dùng 90%',
  'aiu.level.exhausted_100': 'Đã hết hạn mức',
  'aiu.unit.calls': '{n} lượt gọi',
  'aiu.unit.messages': '{n} tin nhắn',
  'aiu.unit.minutes': '{n} phút',
  'aiu.unit.runs': '{n} lượt chạy',
  'aiu.unit.generations': '{n} lượt tạo',
  'aiu.unit.scans': '{n} lượt quét',
  'aiu.unit.units': '{n} đơn vị',
  'aiu.details': 'Chi tiết gói',
  'aiu.tab.overview': 'Tổng quan',
  'aiu.tab.subscription': 'Đăng ký',
  'aiu.tab.usage': 'Sử dụng',
  'aiu.tab.billing': 'Thanh toán',
  'aiu.tab.history': 'Lịch sử',
  'aiu.tab.settings': 'Cài đặt',
  'aiu.confirm.start_trial': 'Bắt đầu dùng thử miễn phí',
  'aiu.confirm.cancel': 'Hủy gói này ngay',
  'aiu.confirmTrial': 'Bắt đầu dùng thử {name} miễn phí {days} ngày? Không thu phí lúc này. Sau thời gian dùng thử, giá gói là {price}; kích hoạt trả phí thực hiện qua mục Thanh toán. Mỗi tiệm chỉ được dùng thử một lần cho mỗi gói.',
  'aiu.confirmCancel': 'Hủy {name} (hiện {state})? Gói ngừng hoạt động ngay cho cả tiệm. Kết quả AI đã tạo vẫn được giữ. Sau đó sẽ không được dùng thử miễn phí lại.',
  'aiu.trialStarted': 'Đã bắt đầu dùng thử {name}.',
  'aiu.cancelled': 'Đã hủy {name}.',
  'aiu.actionFailed': 'Không thực hiện được.',
  'aiu.posArea': 'Nơi sử dụng',
  'aiu.price': 'Giá',
  'aiu.priceSource.subscription': 'gói của tiệm',
  'aiu.priceSource.catalog_list': 'giá niêm yết',
  'aiu.noFixedLimit': 'Không giới hạn cố định',
  'aiu.next': 'Bước tiếp theo',
  'aiu.nextStep.available': 'Liên hệ mục Thanh toán để kích hoạt — gói này không còn lượt dùng thử.',
  'aiu.nextStep.trial_available': 'Bắt đầu dùng thử miễn phí để trải nghiệm.',
  'aiu.nextStep.trialing': 'Dùng thử trong mô-đun; nâng cấp qua mục Thanh toán trước khi hết hạn để tiếp tục.',
  'aiu.nextStep.trial_expired': 'Đã hết thời gian dùng thử. Nâng cấp qua mục Thanh toán để dùng lại.',
  'aiu.nextStep.active': 'Không cần làm gì. Theo dõi mức sử dụng trước khi kỳ mới bắt đầu.',
  'aiu.nextStep.cancelled': 'Kích hoạt lại qua mục Thanh toán nếu cần dùng lại.',
  'aiu.nextStep.expired': 'Kích hoạt lại qua mục Thanh toán nếu cần dùng lại.',
  'aiu.nextStep.past_due': 'Cập nhật phương thức thanh toán trong mục Thanh toán để dùng lại.',
  'aiu.nextStep.suspended': 'Liên hệ bộ phận hỗ trợ AI PowerSalon.',
  'aiu.nextStep.disabled_by_admin': 'Nền tảng đã tắt gói này. Nâng cấp không bật lại được — hãy liên hệ hỗ trợ.',
  'aiu.nextStep.unable_to_verify': 'Không xác minh được trạng thái. Hãy làm mới, hoặc liên hệ hỗ trợ nếu vẫn vậy.',
  'aiu.noModulePage': 'Gói này không có trang riêng trong menu POS.',
  'aiu.state': 'Trạng thái',
  'aiu.stored': 'lưu là “{s}”',
  'aiu.plan': 'Gói',
  'aiu.period.monthly': 'hằng tháng',
  'aiu.period.yearly': 'hằng năm',
  'aiu.trialStart': 'Bắt đầu dùng thử',
  'aiu.trialEnd': 'Hết dùng thử',
  'aiu.subscribedOn': 'Ngày đăng ký',
  'aiu.cancelledOn': 'Ngày hủy',
  'aiu.lastPayment': 'Trạng thái thanh toán gần nhất',
  'aiu.used': 'Đã dùng trong kỳ',
  'aiu.limit': 'Hạn mức',
  'aiu.remaining': 'Còn lại',
  'aiu.periodLabel': 'Kỳ thanh toán',
  'aiu.atLimit': 'Khi đạt 100%',
  'aiu.overageOn': 'Vẫn hoạt động; phần dùng thêm tính {p} mỗi {u}',
  'aiu.overageOnShort': 'Vẫn hoạt động (tính phí phần dùng thêm)',
  'aiu.overageOff': 'Yêu cầu mới dừng đến khi kỳ mới bắt đầu',
  'aiu.countsRule': 'Chỉ yêu cầu thành công mới tính vào hạn mức; yêu cầu lỗi hoặc bị chặn không tính.',
  'aiu.acked': 'Đã xem',
  'aiu.open': 'Chưa xem',
  'aiu.billingRestricted': 'Chi tiết thanh toán chỉ hiển thị cho vai trò quản lý thanh toán của chủ tiệm.',
  'aiu.noBilling': 'Chưa ghi nhận sự kiện thanh toán nào cho gói này.',
  'aiu.when': 'Thời gian',
  'aiu.event': 'Sự kiện',
  'aiu.provider': 'Nhà cung cấp',
  'aiu.change': 'Thay đổi',
  'aiu.noHistory': 'Chưa có thay đổi nào được ghi nhận.',
  'aiu.kind.tenant': 'tiệm này',
  'aiu.kind.platform': 'nền tảng',
  'aiu.kind.billing': 'thanh toán',
  'aiu.platform': 'Trạng thái trên nền tảng',
  'aiu.platformOn': 'Đang bật',
  'aiu.platformOff': 'Đã tắt — {r}',
  'aiu.salonSub': 'Đăng ký của tiệm',
  'aiu.none': 'Không có',
  'aiu.limitSource': 'Hạn mức theo',
  'aiu.limitFrom.subscription': 'gói của tiệm',
  'aiu.limitFrom.catalog': 'danh mục (chưa đăng ký)',
  'aiu.recurringMonthly': 'định kỳ mỗi tháng (gói năm quy ra theo tháng)',
  'aiu.noPaid': 'Chưa có gói AI trả phí.',
  'aiu.package': 'Gói',
  'aiu.monthlyEq': 'Mỗi tháng',
  'aiu.paymentThisPeriod': 'Thanh toán kỳ này',
  'aiu.normalized': '(năm ÷ 12)',
  'aiu.recorded': 'Đã ghi nhận',
  'aiu.notRecorded': 'Chưa ghi nhận',
  'aiu.trialsNotCost': 'Dùng thử (không tính vào chi phí)',
  'aiu.afterTrial': 'Hết dùng thử {date} · sau đó {price}',
  'aiu.overageEst': 'Ước tính phí dùng thêm: {s} (đến khi có hóa đơn)',
  'aiu.costRule': 'Giá lấy từ hồ sơ gói của tiệm, không lấy giá niêm yết của gói tiệm chưa có. Gói quá hạn được liệt kê và không được xem là đã thanh toán.',
  'aiu.lastBillingEvent': 'Sự kiện thanh toán gần nhất {t} ({n} đã ghi nhận).',
  'aiu.noBillingEvents': 'Chưa ghi nhận sự kiện thanh toán nào.',
  'aiu.historySub': '{n} bản ghi · {c} đơn vị thành công',
  'aiu.export': 'Xuất CSV',
  'aiu.exported': 'Đã tải file xuất dữ liệu sử dụng.',
  'aiu.exportFailed': 'Không tạo được file xuất.',
  'aiu.allPackages': 'Tất cả gói',
  'aiu.hstatus.all': 'Mọi kết quả',
  'aiu.hstatus.success': 'Thành công (được tính)',
  'aiu.hstatus.error': 'Lỗi',
  'aiu.hstatus.blocked': 'Bị chặn',
  'aiu.noUsage': 'Không có lượt dùng AI trong khoảng này.',
  'aiu.time': 'Thời gian',
  'aiu.unitH': 'Đơn vị',
  'aiu.qty': 'Số lượng',
  'aiu.statusH': 'Kết quả',
  'aiu.ref': 'Mã tham chiếu',
  'aiu.hst.success': 'Được tính',
  'aiu.hst.blocked': 'Bị chặn',
  'aiu.hst.error': 'Lỗi',
  'aiu.bp.current': 'Hiện tại',
  'aiu.bp.previous': 'Trước đó',
  'aiu.bp.none': '—',
  'aiu.fewerAlerts': 'Thu gọn',
  'aiu.why.titleOn': 'Vì sao đang bật', // DRAFT — Kevin reviews
  'aiu.why.titleOff': 'Vì sao bị chặn', // DRAFT — Kevin reviews
  'aiu.why.gate': 'Kiểm tra quyền dùng AI cho biết: {r}', // DRAFT — Kevin reviews
  'aiu.why.you': 'Với bạn (theo vai trò): {r}', // DRAFT — Kevin reviews
  'aiu.why.platform': 'Công tắc nền tảng', // DRAFT — Kevin reviews
  'aiu.why.own': 'Gói đăng ký của tiệm', // DRAFT — Kevin reviews
  'aiu.why.sub': '{s} · {p}', // DRAFT — Kevin reviews
  'aiu.why.lastPay': 'lần thanh toán gần nhất: {s}', // DRAFT — Kevin reviews
  'aiu.why.noSub': 'Tiệm chưa đăng ký gói này', // DRAFT — Kevin reviews
  'aiu.why.trial': 'Dùng thử', // DRAFT — Kevin reviews
  'aiu.why.trialLeft': 'còn {n} ngày', // DRAFT — Kevin reviews
  'aiu.why.trialEnded': 'Đã kết thúc {d}', // DRAFT — Kevin reviews
  'aiu.why.plans': 'Gói tổng hợp có chứa', // DRAFT — Kevin reviews
  'aiu.why.noPlan': 'Không thuộc gói tổng hợp nào', // DRAFT — Kevin reviews
  'aiu.why.planNone': 'chưa đăng ký', // DRAFT — Kevin reviews
  'aiu.why.verified': 'Lần cuối được xác nhận qua thanh toán', // DRAFT — Kevin reviews
  'aiu.why.verifiedAt': '{d} · {p}', // DRAFT — Kevin reviews
  'aiu.why.neverVerified': 'Chưa có sự kiện thanh toán nào', // DRAFT — Kevin reviews
  'aiu.why.r.ok': 'được phép', // DRAFT — Kevin reviews
  'aiu.why.r.tenant_not_active': 'tài khoản tiệm chưa hoạt động', // DRAFT — Kevin reviews
  'aiu.why.r.package_disabled': 'Super Admin đã tắt cho mọi tiệm', // DRAFT — Kevin reviews
  'aiu.why.r.not_subscribed': 'chưa đăng ký', // DRAFT — Kevin reviews
  'aiu.why.r.trial_expired': 'thời gian dùng thử đã hết', // DRAFT — Kevin reviews
  'aiu.why.r.past_due': 'thanh toán đã quá hạn', // DRAFT — Kevin reviews
  'aiu.why.r.unpaid': 'chưa thanh toán', // DRAFT — Kevin reviews
  'aiu.why.r.cancelled': 'đã hủy', // DRAFT — Kevin reviews
  'aiu.why.r.expired': 'gói đăng ký đã hết hạn', // DRAFT — Kevin reviews
  'aiu.why.r.subscription_suspended': 'gói đăng ký bị tạm ngưng', // DRAFT — Kevin reviews
  'aiu.why.r.permission_denied': 'vai trò của bạn không được dùng', // DRAFT — Kevin reviews
  'aiu.why.r.limit_exceeded': 'đã hết hạn mức sử dụng của kỳ này', // DRAFT — Kevin reviews
  'aiu.why.r.branch_disabled': 'đã tắt cho chi nhánh này', // DRAFT — Kevin reviews
  'aiu.why.r.unable_to_check': 'hiện không kiểm tra được', // DRAFT — Kevin reviews
  'aiu.why.s.trialing': 'Đang dùng thử', // DRAFT — Kevin reviews
  'aiu.why.s.active': 'Đang hoạt động', // DRAFT — Kevin reviews
  'aiu.why.s.past_due': 'Quá hạn thanh toán', // DRAFT — Kevin reviews
  'aiu.why.s.unpaid': 'Chưa thanh toán', // DRAFT — Kevin reviews
  'aiu.why.s.cancelled': 'Đã hủy', // DRAFT — Kevin reviews
  'aiu.why.s.expired': 'Đã hết hạn', // DRAFT — Kevin reviews
  'aiu.why.s.suspended': 'Tạm ngưng', // DRAFT — Kevin reviews
  'aiu.why.s.disabled': 'Đã tắt', // DRAFT — Kevin reviews
  'aiu.why.pay.paid': 'đã thanh toán', // DRAFT — Kevin reviews
  'aiu.why.pay.failed': 'thất bại', // DRAFT — Kevin reviews
  'aiu.why.pay.pending': 'đang chờ', // DRAFT — Kevin reviews
  'aiu.proj.title': 'Ước tính:', // DRAFT — Kevin reviews
  'aiu.proj.tooEarly': 'kỳ này mới qua {pct}% — còn quá sớm để ước tính cuối kỳ.', // DRAFT — Kevin reviews
  'aiu.proj.fits': 'theo mức dùng kỳ này, bạn sẽ dùng khoảng {n} trên {limit} (đã qua {pct}% kỳ) — gói vẫn đủ.', // DRAFT — Kevin reviews
  'aiu.proj.close': 'theo mức dùng kỳ này, bạn sẽ dùng khoảng {n} trên {limit} (đã qua {pct}% kỳ) — gần hết mức của gói.', // DRAFT — Kevin reviews
  'aiu.proj.likely_over': 'theo mức dùng kỳ này, bạn sẽ dùng khoảng {n} trên {limit} (đã qua {pct}% kỳ) — vượt mức gói bao gồm.', // DRAFT — Kevin reviews
  'aiu.proj.overage': 'Đang bật tính phí vượt mức: thêm khoảng {amount} theo giá vượt mức.', // DRAFT — Kevin reviews
  'aiu.proj.blocked': 'Đang tắt tính phí vượt mức: AI sẽ dừng khi tới giới hạn cho đến kỳ sau.', // DRAFT — Kevin reviews
  'aiu.proj.note': 'Chỉ là ước tính từ mức dùng đã đếm trong kỳ này — không mua hay thay đổi gì.', // DRAFT — Kevin reviews
  'aiu.priceCmp.list': 'Giá niêm yết hiện tại: {list}/tháng.', // DRAFT — Kevin reviews
  'aiu.priceCmp.kept_below_list': 'Giá của tiệm {yours}/tháng được giữ — thấp hơn {diff} so với giá niêm yết hiện tại {list}/tháng.', // DRAFT — Kevin reviews
  'aiu.priceCmp.above_list': 'Giá của tiệm {yours}/tháng cao hơn {diff} so với giá niêm yết hiện tại {list}/tháng.', // DRAFT — Kevin reviews
};
