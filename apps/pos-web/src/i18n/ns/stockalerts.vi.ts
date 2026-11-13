// ns/stockalerts.vi.ts — the POS "sa" namespace, Vietnamese: Inventory → Stock Alerts + Technician Product Usage (Oct 29 2026 one-screen build). Staff-facing.
export const STOCKALERTS_VI = {
  'sa.subtitle': 'Hàng tồn kho có nguy cơ, lượng sản phẩm đã dùng và thợ dùng gần nhất của từng sản phẩm',
  'sa.recordUse': 'Ghi nhận dùng sản phẩm',
  'sa.viewInventory': 'Xem kho hàng',
  'sa.createPo': 'Tạo đơn đặt hàng',
  'sa.alertSettings': 'Cài đặt cảnh báo',
  'sa.settingsHint': 'Mức đặt lại hàng và mức nguy cấp được cài trên từng sản phẩm (và theo chi nhánh)',
  'sa.viewProduct': 'Xem sản phẩm',
  'sa.acked': 'Đã xác nhận cảnh báo. Cảnh báo sẽ hiện lại nếu tồn kho giảm thêm.',
  'sa.kpi.openSub': 'Cùng số với thanh bên · {a} đã xác nhận',
  'sa.kpi.outSub': 'Không còn hàng dùng được',
  'sa.kpi.critSub': 'Thêm {l} sản phẩm sắp hết',
  'sa.kpi.uses': 'Lượt dùng hôm nay',
  'sa.kpi.usesSub': 'Lượt dùng đã xác nhận · giờ tiệm',
  'sa.kpi.techs': 'Thợ có dùng sản phẩm',
  'sa.kpi.techsSub': 'Có dùng sản phẩm hôm nay',
  'sa.workspaces': 'Khu vực cảnh báo tồn kho',
  'sa.tab.active': 'Cảnh báo hiện tại',
  'sa.tab.usage': 'Lượng sản phẩm đã dùng',
  'sa.tab.technicians': 'Tất cả thợ',
  'sa.tab.history': 'Lịch sử cảnh báo',
  'sa.searchPh': 'Tìm sản phẩm, SKU, mã vạch, thương hiệu, danh mục, nhà cung cấp, số đơn hoặc thợ…',
  'sa.severity': 'Mức độ',
  'sa.allSeverities': 'Mọi mức độ',
  'sa.sev.out_of_stock': 'Hết hàng',
  'sa.sev.critical': 'Nguy cấp',
  'sa.sev.low': 'Sắp hết',
  'sa.basis.occurred': 'Thời điểm dùng',
  'sa.basis.recorded': 'Thời điểm ghi nhận',
  'sa.hint.active': 'Tồn kho thực tế tại chi nhánh · cảnh báo mới nhất trước',
  'sa.hint.usage': 'Mọi sản phẩm đã dùng trong kỳ · Dùng gần nhất = lượt dùng mới nhất theo thời điểm dùng',
  'sa.hint.technicians': 'Ai đã dùng sản phẩm trong kỳ, theo từng thợ (không gộp theo tên)',
  'sa.hint.history': 'Mọi cảnh báo đã phát sinh, xác nhận hoặc đã xử lý · mới nhất trước',
  'sa.col.product': 'Sản phẩm',
  'sa.col.severity': 'Mức độ',
  'sa.col.onHand': 'Tồn kho',
  'sa.col.reorder': 'Đặt lại khi còn',
  'sa.col.lastUsed': 'Dùng gần nhất',
  'sa.col.since': 'Cảnh báo từ',
  'sa.col.used': 'Đã dùng',
  'sa.col.uses': 'Lượt dùng',
  'sa.col.technicians': 'Số thợ',
  'sa.col.technician': 'Thợ',
  'sa.col.products': 'Sản phẩm',
  'sa.col.lastProduct': 'Sản phẩm gần nhất',
  'sa.col.lastAt': 'Lần dùng gần nhất',
  'sa.col.onHandAt': 'Tồn kho lúc đó',
  'sa.col.created': 'Phát sinh',
  'sa.col.state': 'Trạng thái',
  'sa.col.ackBy': 'Người xác nhận',
  'sa.col.occurred': 'Dùng lúc',
  'sa.col.qty': 'Lượng',
  'sa.col.source': 'Nguồn',
  'sa.col.recorded': 'Ghi nhận lúc',
  'sa.noUse': 'Chưa có lượt dùng',
  'sa.unknownTech': 'Không rõ / Dữ liệu cũ',
  'sa.ackBy': 'bởi {who}',
  'sa.onOrder': '{n} đang đặt',
  'sa.suggest': 'nên đặt {n}',
  'sa.draftPo': 'nháp {po} chưa đặt',
  'sa.sinceUnknown': 'Trước khi theo dõi cảnh báo',
  'sa.reorder': 'Đặt hàng',
  'sa.unattributed': '{n} không rõ thợ',
  'sa.viewUsage': 'Xem lượt dùng',
  'sa.state.open': 'Đang mở',
  'sa.state.acknowledged': 'Đã xác nhận',
  'sa.state.resolved': 'Đã xử lý',
  'sa.noMatches': 'Không có kết quả phù hợp',
  'sa.empty.active': 'Không có sản phẩm nào chạm mức đặt lại hàng tại chi nhánh này',
  'sa.empty.usage': 'Chưa ghi nhận lượt dùng nào trong kỳ này',
  'sa.empty.technicians': 'Chưa có thợ nào dùng sản phẩm trong kỳ này',
  'sa.empty.history': 'Không có cảnh báo trong kỳ này',
  'sa.productTitle': 'Lượt dùng sản phẩm',
  'sa.onHandN': 'Tồn {n}',
  'sa.thresholds': 'đặt lại khi còn {r} · nguy cấp khi còn {c}',
  'sa.lastRecorded': 'Lần ghi nhận gần nhất',
  'sa.recordedDiffers': 'Có mục ghi lùi ngày — Dùng gần nhất theo thời điểm dùng',
  'sa.allTechs': 'Tất cả thợ đã dùng',
  'sa.events': 'Các lượt dùng',
  'sa.noEvents': 'Không có lượt dùng trong kỳ này',
  'sa.onBehalfShown': 'ghi thay: {r}',
  'sa.correctedFrom': 'đã điều chỉnh từ {q}',
  'sa.reversed': 'đã hoàn tác',
  'sa.correct': 'Điều chỉnh',
  'sa.correctTitle': 'Điều chỉnh lượt dùng này',
  'sa.giveBack': 'Dùng ít hơn (trả lại kho)',
  'sa.usedMore': 'Dùng nhiều hơn',
  'sa.amountUnit': 'Lượng ({u})',
  'sa.saveCorrection': 'Lưu điều chỉnh',
  'sa.correctNote': 'Lượt dùng gốc được giữ nguyên. Điều chỉnh được ghi kèm tên và lý do của bạn, tồn kho chỉ thay đổi một lần.',
  'sa.source.front_desk': 'Quầy lễ tân',
  'sa.source.technician_app': 'Ứng dụng thợ',
  'sa.source.scan': 'Quét mã vạch',
  'sa.source.manager': 'Quản lý (ghi thay thợ)',
  'sa.source.correction': 'Điều chỉnh',
  'sa.source.service_recipe': 'Hoàn tất dịch vụ (công thức)',
  'sa.unit.unit': 'đơn vị',
  'sa.unit.bottle': 'chai',
  'sa.unit.piece': 'cái',
  'sa.unit.pair': 'đôi',
  'sa.unit.ml': 'ml',
  'sa.unit.oz': 'oz',
  'sa.unit.jar': 'hũ',
  'sa.unit.pack': 'gói',
  'sa.unit.box': 'hộp',
  'sa.rec.sub': 'Sản phẩm → thợ → lượng → kiểm tra tồn kho → xác nhận một lần',
  'sa.rec.step1': '1 · Sản phẩm',
  'sa.rec.step2': '2 · Thợ',
  'sa.rec.step3': '3 · Lượng và thời gian',
  'sa.rec.findPh': 'Tìm tên hoặc SKU, hoặc quét mã vạch…',
  'sa.rec.inStock': 'Còn {s} {u}',
  'sa.rec.change': 'Đổi',
  'sa.rec.noProduct': 'Không có sản phẩm phù hợp',
  'sa.rec.chooseTech': 'Chọn thợ…',
  'sa.rec.me': 'bạn',
  'sa.rec.yourself': 'Ghi nhận là lượt dùng của bạn',
  'sa.rec.noTechRecord': 'Tài khoản của bạn chưa gắn với thợ. Hãy nhờ quản lý ghi nhận lượt dùng này.',
  'sa.rec.onBehalfReason': 'Vì sao bạn ghi thay? (bắt buộc)',
  'sa.rec.when': 'Thời điểm dùng (để trống nếu là bây giờ)',
  'sa.rec.whenHint': 'Tối đa 31 ngày trước. Lượt dùng cũ hơn được điều chỉnh bằng kiểm kho.',
  'sa.rec.note': 'Ghi chú (không bắt buộc)',
  'sa.rec.review': 'Xem lại',
  'sa.rec.confirm': 'Xác nhận lượt dùng',
  'sa.rec.before': 'Tồn trước',
  'sa.rec.use': 'Dùng',
  'sa.rec.after': 'Tồn sau',
  'sa.rec.negative': 'Lượt này làm tồn kho dưới 0. Chỉ được phép khi sản phẩm cho tồn âm — nếu không, hãy kiểm kho trước.',
  'sa.rec.reviewNote': '{p} được lấy từ chai đang mở trước, rồi tới chai mới ({u}).',
  'sa.rec.onBehalfNote': 'Bạn được ghi là người nhập.',
  'sa.rec.done': 'Đã ghi nhận: {t} dùng {q} {p}.',
  'sa.rec.replayed': 'Lượt dùng này đã được ghi nhận — không trừ kho hai lần.',
  'sa.cause.title': 'Biến động tồn kho', // DRAFT — Kevin reviews
  'sa.cause.titleLow': 'Vì sao sắp hết', // DRAFT — Kevin reviews
  'sa.cause.usage': 'Đã dùng: {n} cho dịch vụ và thợ trong {d} ngày qua.', // DRAFT — Kevin reviews
  'sa.cause.losses': 'Hao hụt: {n} hỏng, hết hạn, trả lại hoặc chuyển đi trong {d} ngày qua.', // DRAFT — Kevin reviews
  'sa.cause.noReceiving': 'Không nhận hàng trong {d} ngày qua (lần nhận gần nhất: {last}).', // DRAFT — Kevin reviews
  'sa.cause.never': 'chưa có', // DRAFT — Kevin reviews
  'sa.cause.delayed': 'Nhận hàng bị trễ: đang đặt {n}, dự kiến {date}.', // DRAFT — Kevin reviews
  'sa.cause.onOrder': 'Đang đặt {n}, dự kiến {date}.', // DRAFT — Kevin reviews
  'sa.cause.corrections': 'Điều chỉnh đã trừ {n}.', // DRAFT — Kevin reviews
  'sa.cause.inconsistent': 'Sổ biến động kết thúc ở {a} nhưng tồn kho hiện {b} — hãy kiểm đếm trước khi đặt hàng.', // DRAFT — Kevin reviews
  'sa.cause.none': 'Không có biến động nào trong {d} ngày qua giải thích mức tồn này.', // DRAFT — Kevin reviews
  'sa.cause.buckets': '{d} ngày qua: dùng {u} · nhận {r} · hao hụt {l} · điều chỉnh {c}', // DRAFT — Kevin reviews
  'sa.recon.suggest': 'Đề xuất đặt thêm: {n} (sau khi trừ {o} đang đặt).', // DRAFT — Kevin reviews
  'sa.recon.covered': 'Sắp hết, nhưng {o} đang đặt đã đủ — không đề xuất thêm.', // DRAFT — Kevin reviews
  'sa.recon.notLow': 'Hiện trên mức đặt lại — cảnh báo tự hết theo tồn kho.', // DRAFT — Kevin reviews
  'sa.recon.partial': '{n} dòng đơn hàng mới nhận một phần.', // DRAFT — Kevin reviews
  'sa.recon.lastReceipt': 'Lần nhận gần nhất thêm {n}.', // DRAFT — Kevin reviews
  'sa.rank.priority': 'Ưu tiên nhập hàng', // DRAFT — Kevin reviews
  'sa.rank.hint': 'Xếp hạng theo lượng dùng thực tế 30 ngày qua và thời gian giao hàng của nhà cung cấp. Chỉ là gợi ý — mọi lần mua vẫn phải qua duyệt đơn đặt hàng.', // DRAFT — Kevin reviews
  'sa.restock.now': 'Đặt ngay', // DRAFT — Kevin reviews
  'sa.restock.soon': 'Đặt sớm', // DRAFT — Kevin reviews
  'sa.restock.later': 'Có thể chờ', // DRAFT — Kevin reviews
  'sa.restock.covered': 'Đã đặt hàng', // DRAFT — Kevin reviews
  'sa.restock.unknown': 'Chưa rõ nhu cầu', // DRAFT — Kevin reviews
  'sa.restock.detail': '{d}/ngày · đủ dùng {c} ngày', // DRAFT — Kevin reviews
  'sa.restock.lead': 'giao hàng {n} ngày', // DRAFT — Kevin reviews
  'sa.restock.noLead': 'chưa đặt thời gian giao hàng', // DRAFT — Kevin reviews
  'sa.restock.noUse': 'không dùng trong {n} ngày', // DRAFT — Kevin reviews
  'sa.exportEvents': 'Xuất từng lần dùng', // DRAFT — Kevin reviews
  'sa.col.services': 'Dịch vụ đã làm', // DRAFT — Kevin reviews
  'sa.per10': '{n} lần dùng mỗi 10 dịch vụ', // DRAFT — Kevin reviews
  'sa.per10.na': 'không có dịch vụ trong kỳ này', // DRAFT — Kevin reviews
  'sa.col.restocked': 'Đã nhập lại', // DRAFT — Kevin reviews
  'sa.restockedQty': '+{n} đã nhận từ đó', // DRAFT — Kevin reviews
  'sa.notRestocked': 'Chưa nhập lại', // DRAFT — Kevin reviews
  'sa.sel.count': 'Đã chọn {n}', // DRAFT — Kevin reviews
  'sa.sel.ack': 'Xác nhận các mục đã chọn', // DRAFT — Kevin reviews
  'sa.sel.clear': 'Bỏ chọn', // DRAFT — Kevin reviews
  'sa.sel.page': 'Chọn mọi cảnh báo trên trang này', // DRAFT — Kevin reviews
  'sa.sel.row': 'Chọn {n}', // DRAFT — Kevin reviews
  'sa.sel.askTitle': 'Xác nhận {n} cảnh báo?', // DRAFT — Kevin reviews
  'sa.sel.askSub': 'Mỗi cảnh báo được xác nhận giống như nút Xác nhận riêng của nó, kèm tên bạn và thời gian.', // DRAFT — Kevin reviews
  'sa.sel.askNote': 'Xác nhận chỉ đánh dấu là đã xem. Tồn kho, đơn đặt hàng và sản phẩm không thay đổi.', // DRAFT — Kevin reviews
  'sa.sel.done': '{n} đã xác nhận · {f} không xác nhận được', // DRAFT — Kevin reviews
};
