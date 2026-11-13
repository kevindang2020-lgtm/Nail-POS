// inventorycenter.vi.ts — AI Inventory Assistant (Nov 3 2026) in Vietnamese. Glossary: Thợ · hóa đơn · hàng chờ · thẻ quà tặng · Hội viên.
// Pending a native-speaker review (docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md).
export const INVENTORYCENTER_VI: Record<string, string> = {
  "icx.check": "Kiểm tra hệ thống tồn kho",
  "icx.close": "Đóng",
  "icx.refresh": "Làm mới",
  "icx.search": "Tìm",
  "icx.clear": "Xóa bộ lọc",
  "icx.rows": "Số dòng",
  "icx.loading": "Đang tải…",
  "icx.readOnly": "Chỉ là đề xuất: trang này không đặt hàng, kiểm kê, chuyển kho, điều chỉnh hay hủy hàng.",
  "icx.loadFailed": "Không tải được tồn kho. Hãy thử lại hoặc chạy kiểm tra hệ thống — đây không phải là \"không có sản phẩm\".",
  "icx.err.forbidden": "Vai trò của bạn không xem được tồn kho.",
  "icx.err.IC_INVALID_PERIOD": "Hãy chọn ngày bắt đầu và ngày kết thúc; ngày bắt đầu phải trước hoặc bằng ngày kết thúc.",
  "icx.scope.branch": "Số liệu của chi nhánh này.",
  "icx.scope.all_branches": "Số liệu cộng tất cả chi nhánh.",
  "icx.reasons": "Lý do: {e} sản phẩm nghiêm trọng theo mức nghiêm trọng riêng, {d} sản phẩm nghiêm trọng vì còn bằng hoặc dưới một nửa mức đặt lại (chưa đặt mức nghiêm trọng).",
  "icx.noThreshold": "{n} sản phẩm chưa có mức đặt lại hoặc mức nghiêm trọng nên sẽ không bao giờ báo thấp.",
  "icx.mismatch": "{n} sản phẩm có số tồn khác với lịch sử tồn kho.",
  "icx.def.products": "Sản phẩm đang dùng trong danh mục.",
  "icx.def.inStock": "Trên mức đặt lại và không vượt mức tối đa.",
  "icx.def.low": "Trên mức nghiêm trọng, bằng hoặc dưới mức đặt lại.",
  "icx.def.critical": "Còn hàng, bằng hoặc dưới mức nghiêm trọng.",
  "icx.def.outOfStock": "Hết hàng.",
  "icx.def.overstock": "Vượt mức tồn tối đa.",
  "icx.products": "Sản phẩm",
  "icx.searchPh": "Tên sản phẩm, SKU, nhà cung cấp hoặc danh mục",
  "icx.statusLabel": "Trạng thái",
  "icx.sortLabel": "Sắp xếp",
  "icx.noProducts": "Danh mục chưa có sản phẩm.",
  "icx.noMatch": "Không có gì khớp tìm kiếm hoặc bộ lọc.",
  "icx.col.product": "Sản phẩm",
  "icx.col.onHand": "Tồn kho",
  "icx.col.levels": "Mức đặt lại / nghiêm trọng",
  "icx.col.ordered": "Đang đặt",
  "icx.col.status": "Trạng thái",
  "icx.col.ledger": "Lịch sử tồn",
  "icx.derived": "(một nửa mức đặt lại)",
  "icx.noLevels": "Chưa đặt mức",
  "icx.ledgerSame": "Khớp",
  "icx.ledgerDiff": "Lịch sử ghi {n}",
  "icx.noLedger": "Chưa có lịch sử",
  "icx.reserved": "{n} đã giữ",
  "icx.noRecord": "Chưa có bản ghi tồn",
  "icx.activity": "Biến động tồn kho",
  "icx.actSearchPh": "Sản phẩm, SKU, lý do hoặc mã tham chiếu",
  "icx.typeLabel": "Loại",
  "icx.noActivity": "Không có biến động tồn kho.",
  "icx.col.when": "Thời gian",
  "icx.col.type": "Loại",
  "icx.col.change": "Thay đổi",
  "icx.col.after": "Sau",
  "icx.col.by": "Người làm",
  "icx.health.running": "Đang kiểm tra…",
  "icx.health.overall": "Tổng thể: {s} · {at}",
  "icx.health.recent": "(kết quả kiểm tra trong 30 giây qua)",
  "icx.health.readOnly": "Chỉ đọc: việc kiểm tra không thay đổi tồn kho, đơn hàng hay sản phẩm.",
  "icx.health.part": "Bộ phận: {c}",
  "icx.health.lastPassed": "Lần đạt gần nhất: {at}",
  "icx.health.neverPassed": "Chưa từng đạt",
  "icx.st.all": "Mọi trạng thái",
  "icx.st.in_stock": "Còn hàng",
  "icx.st.low": "Thấp",
  "icx.st.critical": "Nghiêm trọng",
  "icx.st.out_of_stock": "Hết hàng",
  "icx.st.overstock": "Tồn quá nhiều",
  "icx.st.no_threshold": "Chưa đặt mức",
  "icx.st.ledger_mismatch": "Khác lịch sử",
  "icx.sort.attention": "Cần chú ý trước",
  "icx.sort.name": "Tên",
  "icx.sort.on_hand": "Tồn ít nhất trước",
  "icx.sort.updated": "Thay đổi gần đây",
  "icx.type.all": "Mọi loại",
  "icx.type.received": "Nhận hàng",
  "icx.type.retail_sale": "Bán lẻ",
  "icx.type.service_usage": "Dùng cho dịch vụ",
  "icx.type.adjustment": "Điều chỉnh",
  "icx.type.count": "Kiểm kê",
  "icx.type.transfer": "Chuyển kho",
  "icx.type.damage_waste": "Hư hỏng hoặc hao hụt",
  "icx.type.return": "Trả hàng",
  "icx.type.other": "Khác",
  "icx.preset.all": "Mọi thời gian",
  "icx.preset.today": "Hôm nay",
  "icx.preset.yesterday": "Hôm qua",
  "icx.preset.week": "Tuần này",
  "icx.preset.last_7": "7 ngày qua",
  "icx.preset.month": "Tháng này",
  "icx.preset.last_30": "30 ngày qua",
  "icx.preset.last_90": "90 ngày qua",
  "icx.preset.last_month": "Tháng trước",
  "icx.preset.year": "Năm nay",
  "icx.preset.custom": "Tùy chọn",
  "icx.health.PASSED": "Đạt",
  "icx.health.WARNING": "Cảnh báo",
  "icx.health.FAILED": "Lỗi",
  "icx.health.INSUFFICIENT_DATA": "Chưa đủ dữ liệu",
  "icx.health.UNAVAILABLE": "Không khả dụng",
  "icx.comp.catalog": "Danh mục sản phẩm",
  "icx.comp.stock": "Tồn kho",
  "icx.comp.ledger": "Lịch sử tồn",
  "icx.comp.thresholds": "Mức tồn",
  "icx.comp.purchasing": "Mua hàng",
  "icx.comp.security": "Bảo mật",
  "icx.health.k.products_tracked": "Có sản phẩm theo dõi",
  "icx.health.d.products_tracked.PASSED": "Danh mục có sản phẩm đang dùng.",
  "icx.health.d.products_tracked.INSUFFICIENT_DATA": "Chưa có sản phẩm. Hãy thêm trong Tồn kho.",
  "icx.health.k.stock_records": "Có bản ghi tồn",
  "icx.health.d.stock_records.PASSED": "Mọi sản phẩm đều có bản ghi tồn ở đây.",
  "icx.health.d.stock_records.WARNING": "Một số sản phẩm chưa có bản ghi tồn ở đây nên được tính là 0 (hết hàng). Hãy kiểm kê trong Tồn kho.",
  "icx.health.d.stock_records.INSUFFICIENT_DATA": "Chưa có sản phẩm.",
  "icx.health.k.no_negative_stock": "Không tồn âm",
  "icx.health.d.no_negative_stock.PASSED": "Không có số tồn nào dưới 0.",
  "icx.health.d.no_negative_stock.FAILED": "Có tồn âm — đã ghi dùng hàng khi không còn hàng. Hãy kiểm kê các sản phẩm đó.",
  "icx.health.k.ledger_matches_stock": "Tồn khớp lịch sử",
  "icx.health.d.ledger_matches_stock.PASSED": "Mọi số tồn đều bằng số dư cuối trong lịch sử.",
  "icx.health.d.ledger_matches_stock.FAILED": "Một số tồn khác lịch sử. Nguyên nhân: có thay đổi không ghi lịch sử. Cách xử lý: kiểm kê các sản phẩm đó.",
  "icx.health.d.ledger_matches_stock.INSUFFICIENT_DATA": "Chưa có lịch sử tồn.",
  "icx.health.k.thresholds_set": "Đã đặt mức tồn",
  "icx.health.d.thresholds_set.PASSED": "Mọi sản phẩm đều có mức đặt lại hoặc mức nghiêm trọng.",
  "icx.health.d.thresholds_set.WARNING": "Một số sản phẩm chưa có mức nên không bao giờ báo thấp. Hãy đặt mức đặt lại trong Tồn kho.",
  "icx.health.d.thresholds_set.INSUFFICIENT_DATA": "Chưa có sản phẩm.",
  "icx.health.k.critical_explained": "Mức nghiêm trọng được đặt rõ",
  "icx.health.d.critical_explained.PASSED": "Mọi sản phẩm nghiêm trọng đều có mức nghiêm trọng riêng.",
  "icx.health.d.critical_explained.WARNING": "Một số sản phẩm nghiêm trọng chỉ vì còn một nửa mức đặt lại (chưa đặt mức nghiêm trọng). Hãy đặt mức nghiêm trọng nếu quá chặt.",
  "icx.health.k.levels_consistent": "Các mức hợp lý",
  "icx.health.d.levels_consistent.PASSED": "Không có mức nghiêm trọng nào cao hơn mức đặt lại.",
  "icx.health.d.levels_consistent.WARNING": "Một số mức nghiêm trọng cao hơn mức đặt lại nên sản phẩm bỏ qua \"Thấp\".",
  "icx.health.k.movements_recorded": "Có ghi biến động tồn",
  "icx.health.d.movements_recorded.PASSED": "Có biến động tồn trong 30 ngày qua.",
  "icx.health.d.movements_recorded.WARNING": "Không có biến động trong 30 ngày — bán hàng và dịch vụ có thể chưa trừ tồn.",
  "icx.health.d.movements_recorded.INSUFFICIENT_DATA": "Chưa có lịch sử tồn.",
  "icx.health.k.orders_received": "Đơn hàng nhận đúng hạn",
  "icx.health.d.orders_received.PASSED": "Không có đơn mua quá hạn hơn 3 ngày.",
  "icx.health.d.orders_received.WARNING": "Một số đơn mua quá hạn hơn 3 ngày. Hãy nhận hàng hoặc cập nhật ngày.",
  "icx.health.k.reorder_data": "Đủ thông tin đặt lại",
  "icx.health.d.reorder_data.PASSED": "Mọi sản phẩm cần đặt lại đều có nhà cung cấp và thời gian giao.",
  "icx.health.d.reorder_data.WARNING": "Một số sản phẩm cần đặt lại chưa có nhà cung cấp hoặc thời gian giao nên không tính được ngày đặt.",
  "icx.health.k.tenant_isolation": "Chỉ dữ liệu của tiệm này",
  "icx.health.d.tenant_isolation.PASSED": "Mọi bản ghi tồn đều thuộc sản phẩm của tiệm này.",
  "icx.health.d.tenant_isolation.FAILED": "Có bản ghi tồn trỏ tới sản phẩm của tiệm khác. Hãy báo ngay.",
  "icx.health.k.no_side_effects": "Kiểm tra không thay đổi gì",
  "icx.health.d.no_side_effects.PASSED": "Trang này và việc kiểm tra không đặt hàng, kiểm kê, chuyển hay điều chỉnh tồn.",
  "icx.health.k.sku_unique": "Mỗi SKU thuộc một sản phẩm", // DRAFT — Kevin reviews
  "icx.health.d.sku_unique.PASSED": "Không có hai sản phẩm đang dùng trùng SKU.", // DRAFT — Kevin reviews
  "icx.health.d.sku_unique.WARNING": "Một số sản phẩm đang dùng trùng SKU nên tìm kiếm hoặc quét mã có thể chọn nhầm. Đặt SKU riêng cho từng sản phẩm hoặc lưu trữ bản trùng.", // DRAFT — Kevin reviews
  "icx.health.d.sku_unique.INSUFFICIENT_DATA": "Chưa có sản phẩm để kiểm tra.", // DRAFT — Kevin reviews
  "icx.health.k.barcode_unique": "Mỗi mã vạch thuộc một sản phẩm", // DRAFT — Kevin reviews
  "icx.health.d.barcode_unique.PASSED": "Không có hai sản phẩm đang dùng trùng mã vạch.", // DRAFT — Kevin reviews
  "icx.health.d.barcode_unique.WARNING": "Một số sản phẩm đang dùng trùng mã vạch nên quét có thể chọn nhầm sản phẩm. Sửa mã vạch của một trong số đó.", // DRAFT — Kevin reviews
  "icx.health.d.barcode_unique.INSUFFICIENT_DATA": "Chưa có sản phẩm để kiểm tra.", // DRAFT — Kevin reviews
  "icx.health.k.count_variance_applied": "Kiểm kê thực tế đã vào sổ kho", // DRAFT — Kevin reviews
  "icx.health.d.count_variance_applied.PASSED": "Mọi lần kiểm kê đã đối chiếu đều điều chỉnh sổ kho đúng bằng số đếm trừ số dự kiến.", // DRAFT — Kevin reviews
  "icx.health.d.count_variance_applied.FAILED": "Một lần kiểm kê đã đối chiếu chưa điều chỉnh sổ kho đủ chênh lệch (ví dụ số chai còn ít hơn số chai kiểm kê báo thiếu). Hãy đếm lại các sản phẩm đó.", // DRAFT — Kevin reviews
  "icx.health.d.count_variance_applied.INSUFFICIENT_DATA": "Chưa có lần kiểm kê thực tế nào được đối chiếu.", // DRAFT — Kevin reviews
  "icx.po.sku": "SKU", // DRAFT — Kevin reviews
  "icx.po.barcode": "Mã vạch", // DRAFT — Kevin reviews
  "icx.po.category": "Danh mục", // DRAFT — Kevin reviews
  "icx.po.vendor": "Nhà cung cấp", // DRAFT — Kevin reviews
  "icx.po.lead": "giao trong {n} ngày", // DRAFT — Kevin reviews
  "icx.po.max": "tối đa {n}", // DRAFT — Kevin reviews
  "icx.po.differs": "khác với số tồn đã ghi", // DRAFT — Kevin reviews
  "icx.po.stockUpdated": "Cập nhật số tồn lúc", // DRAFT — Kevin reviews
  "icx.po.history": "Lịch sử tồn kho của sản phẩm này (mới nhất trước)", // DRAFT — Kevin reviews
  "icx.fresh": "Tồn kho cập nhật lần cuối {at}.", // DRAFT — Kevin reviews
  "icx.cc.title": "Tín hiệu Trung tâm điều hành", // DRAFT — Kevin reviews
  "icx.cc.po": "Đơn đặt hàng đang mở: {a} đã duyệt · {o} đã đặt · {p} nhận một phần", // DRAFT — Kevin reviews
  "icx.cc.overdue": "{n} đã quá ngày dự kiến", // DRAFT — Kevin reviews
  "icx.cc.counts": "Đợt kiểm kho còn mở: {i} đang đếm · {s} chờ đối chiếu", // DRAFT — Kevin reviews
  "icx.cc.reorder": "{n} sản phẩm thấp / nghiêm trọng / hết hàng chưa có hàng đang đặt", // DRAFT — Kevin reviews
  "icx.cc.onHand": "còn {n}", // DRAFT — Kevin reviews
  "icx.cc.onOrder": "đang đặt {n}", // DRAFT — Kevin reviews
  "icx.cc.none": "Không có sản phẩm nào thấp, nghiêm trọng hoặc hết hàng.", // DRAFT — Kevin reviews
  "icx.categoryLabel": "Danh mục", // DRAFT — Kevin reviews
  "icx.allCategories": "Tất cả danh mục", // DRAFT — Kevin reviews
  "icx.dateBasis": "Ngày lọc theo thời điểm hàng xuất nhập (thời gian biến động).", // DRAFT — Kevin reviews
  "icx.var.expected": "Dự kiến", // DRAFT — Kevin reviews
  "icx.var.counted": "Đã đếm", // DRAFT — Kevin reviews
  "icx.var.posted": "Đã ghi sổ", // DRAFT — Kevin reviews
  "icx.var.unexplained": "Chưa ghi sổ", // DRAFT — Kevin reviews
  "icx.var.when": "Đối chiếu lúc", // DRAFT — Kevin reviews
};
