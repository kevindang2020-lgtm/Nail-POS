// sunmi.vi.ts — Vietnamese for the Screen Check overlay (SUNMI FLEX 3 mandates, Nov 6 2026). Keys: `sunmi.*`.
export const SUNMI_VI: Record<string, string> = {
  'sunmi.menu': 'Kiểm tra màn hình này',
  'sunmi.title': 'Kiểm tra màn hình',
  'sunmi.readOnly': 'Chỉ đọc: đo màn hình này; không thay đổi hay lưu gì.',
  'sunmi.runAgain': 'Kiểm tra lại',
  'sunmi.refreshNow': 'Tải lại dữ liệu ngay',
  'sunmi.refreshAsked': 'Mọi màn hình đang mở đang tải lại dữ liệu từ máy chủ.',
  'sunmi.copy': 'Sao chép báo cáo',
  'sunmi.copied': 'Đã sao chép báo cáo (chỉ mã mô-đun, kích thước và số lượng).',
  'sunmi.copyFailed': 'Trình duyệt này không cho phép sao chép.',
  'sunmi.verdict.PASS': 'ĐẠT',
  'sunmi.verdict.WARN': 'CẢNH BÁO',
  'sunmi.verdict.FAIL': 'KHÔNG ĐẠT',
  'sunmi.verdict.NOT_TESTED': 'CHƯA KIỂM TRA',
  'sunmi.col.result': 'Kết quả',
  'sunmi.col.check': 'Hạng mục',
  'sunmi.col.detail': 'Đã đo được',
  'sunmi.col.remedy': 'Cách khắc phục',
  'sunmi.col.profile': 'Cấu hình màn hình',
  'sunmi.col.size': 'Kích thước CSS',
  'sunmi.col.density': 'Mật độ',
  'sunmi.profiles': 'Các cấu hình màn hình đã chứng nhận',
  'sunmi.profile.windows-1080-browser': 'Windows 1920×1080, có thanh tab, thanh địa chỉ của Edge/Chrome và thanh tác vụ (chính)',   // DRAFT — Kevin reviews
  'sunmi.profile.sunmi-flex3-chrome': 'SUNMI FLEX 3 27″, Chrome Android 13, có thanh trạng thái, thanh công cụ và thanh điều hướng (DPR 1)',   // DRAFT — Kevin reviews
  'sunmi.profile.sunmi-flex3-kiosk': 'SUNMI FLEX 3 27″, chế độ kiosk / ứng dụng web đã cài, có thanh điều hướng (DPR 1)',   // DRAFT — Kevin reviews
  'sunmi.profile.sunmi-flex3-full': 'SUNMI FLEX 3 27″, toàn màn hình (DPR 1)',   // DRAFT — Kevin reviews
  'sunmi.profile.desktop-1440p': 'Màn hình 2560×1440 (rộng rãi)',   // DRAFT — Kevin reviews
  'sunmi.profile.desktop-900p': '1600×900 (chật)',   // DRAFT — Kevin reviews
  'sunmi.profile.laptop-768': '1366×768 (chật, dự phòng)',   // DRAFT — Kevin reviews
  'sunmi.profile.sunmi-flex3-dpr15-chrome': 'SUNMI FLEX 3 nếu màn hình chạy DPR 1.5: 1280×720 trừ các thanh Android (báo cáo dự phòng)',   // DRAFT — Kevin reviews
  'sunmi.thisScreen': 'màn hình này',
  'sunmi.deviceNote': 'Kích thước là điểm ảnh CSS mà trình duyệt thực sự dành cho POS, không phải điểm ảnh vật lý của tấm nền. Kiểm tra trên trình duyệt máy tính không thay cho thử nghiệm trên chính thiết bị SUNMI.',
  'sunmi.density.comfortable': 'Thoáng',
  'sunmi.density.compact': 'Gọn',
  'sunmi.density.tight': 'Chặt',
  'sunmi.density.fallback': 'Dự phòng',
  'sunmi.mode.browser': 'cửa sổ trình duyệt',
  'sunmi.mode.fullscreen': 'toàn màn hình',
  'sunmi.mode.standalone': 'ứng dụng đã cài',
  'sunmi.check.display': 'Màn hình',
  'sunmi.check.displayDetail': '{w} × {h} px CSS · tỉ lệ điểm ảnh {dpr} · {density} · {mode} · vùng nội dung {cw} × {ch}',
  'sunmi.check.fit': 'Vừa một màn hình',
  'sunmi.check.keyboardOpen': 'Bàn phím ảo đang mở — sẽ kiểm tra lại khi bàn phím đóng.',
  'sunmi.check.pageScroll': 'Trang làm việc dài: cuộn dọc là theo thiết kế ({px} px); mọi mô-đun được kiểm tra có mặt và không tràn ngang',
  'sunmi.check.scrollsBy': 'Trang cuộn thêm {px} px',
  'sunmi.check.noScroll': 'Trang không phải cuộn',
  'sunmi.check.horizontal': 'Không cuộn ngang',
  'sunmi.check.modules': 'Đủ mọi mô-đun',
  'sunmi.check.unregistered': 'Màn hình này chưa có trong sổ đăng ký mô-đun nên chưa kiểm tra các mô-đun.',
  'sunmi.check.modulesDetail': '{ok} trên {total} mô-đun đã đăng ký đang có trên màn hình',
  'sunmi.check.inView': 'Mọi mô-đun đều thấy được mà không cần cuộn',
  'sunmi.check.outside': '{n} mô-đun nằm ngoài vùng nhìn thấy',
  'sunmi.check.allInView': 'Mọi mô-đun đã đăng ký đều nằm trong vùng nhìn thấy',
  'sunmi.check.counts': 'Đủ bộ (thẻ KPI, Thao tác nhanh)',
  'sunmi.check.overlap': 'Không có mô-đun chồng lên nhau',
  'sunmi.check.noOverlap': 'Không có hai mô-đun nào chồng lên nhau',
  'sunmi.check.balance': 'Các hàng cân đối',
  'sunmi.check.balanced': 'Các mô-đun cùng hàng có chiều cao tương đương',
  'sunmi.check.clipped': 'Chữ trên nút không bị cắt',
  'sunmi.check.noClipped': 'Mọi nút và thẻ đều hiện đủ chữ',
  'sunmi.check.touch': 'Vùng chạm',
  'sunmi.check.smallTargets': '{n} nút nhỏ hơn 32 px và không có vùng chạm lớn hơn: {list}',
  'sunmi.check.touchOk': 'Mọi nút đều từ 32 px trở lên hoặc có vùng chạm 44 px',
  'sunmi.check.realtime': 'Cập nhật trực tiếp',
  'sunmi.check.realtimeDetail': 'Kết nối: {status} · lần làm mới thành công gần nhất {at}',
  'sunmi.fix.fallback': 'Cửa sổ này nhỏ hơn các cấu hình đã chứng nhận; các mô-đun vẫn dùng được nhưng có thể phải cuộn. Hãy dùng toàn bộ màn hình 27 inch.',
  'sunmi.fix.vertical': 'Đặt min-height:0 cho các hàng lưới, giới hạn danh sách dài trong khung của nó, giảm khoảng đệm ngoài — không bao giờ thu nhỏ trang.',
  'sunmi.fix.horizontal': 'Thêm min-width:0 cho các phần tử lưới đang rộng hơn trang.',
  'sunmi.fix.restore': 'Thiếu hoặc bị ẩn một mô-đun bắt buộc: hãy khôi phục (sổ đăng ký mô-đun) — làm vừa màn hình không bao giờ được bỏ mô-đun.',
  'sunmi.fix.inView': 'Đưa mô-đun vào màn hình đầu tiên: giới hạn chiều cao khung, vài dòng đầu + Xem tất cả, hoặc lớp chi tiết.',
  'sunmi.fix.counts': 'Bộ thẻ KPI hoặc Thao tác nhanh chưa đủ — mọi thẻ và thao tác phải còn trên màn hình.',
  'sunmi.fix.overlap': 'Hai mô-đun đang vẽ chồng lên nhau: kiểm tra vùng lưới và chiều cao cố định.',
  'sunmi.fix.balance': 'Các mô-đun cùng hàng nên cao bằng nhau; việc lớn hơn thì cho cột rộng hơn.',
  'sunmi.fix.clipped': 'Cho phép hai dòng ngắn hoặc dấu “…”, chạm vào để xem đủ chữ.',
  'sunmi.fix.touch': 'Cho các nút nhỏ một vùng chạm 44 px (hit-slop) hoặc làm nút lớn hơn.',
  'sunmi.fix.realtime': 'Cập nhật trực tiếp đang gián đoạn: bấm “Tải lại dữ liệu ngay”; nếu vẫn vậy, hãy kiểm tra mạng.',
  "sunmi.pay.ready.calculated": "Đã tính",   // DRAFT — Kevin reviews
  "sunmi.pay.ready.managerReview": "Quản lý xem lại",   // DRAFT — Kevin reviews
  "sunmi.pay.ready.withOwner": "Chờ chủ tiệm",   // DRAFT — Kevin reviews
  "sunmi.pay.ready.approved": "Đã duyệt",   // DRAFT — Kevin reviews
  "sunmi.pay.ready.paid": "Đã trả",   // DRAFT — Kevin reviews
  "sunmi.pay.ready.canceled": "Đã hủy",   // DRAFT — Kevin reviews
  "sunmi.pay.ready.label": "Tiến độ tuần lương",   // DRAFT — Kevin reviews
  "sunmi.pay.kpi.earned": "Đã làm được",   // DRAFT — Kevin reviews
  "sunmi.pay.kpi.alreadyPaid": "Đã trả trước",   // DRAFT — Kevin reviews
  "sunmi.pay.kpi.exceptions": "Cần xem lại",   // DRAFT — Kevin reviews
  "sunmi.pay.worklist": "Danh sách lương",   // DRAFT — Kevin reviews
  "sunmi.pay.worklistOrder": "Thợ có việc cần kiểm tra được xếp lên trước.",   // DRAFT — Kevin reviews
  "sunmi.pay.selected": "Thợ đang chọn",   // DRAFT — Kevin reviews
  "sunmi.pay.selectHint": "Chạm vào một thợ để xem bảng lương, cách chia và các khoản trả ở đây.",   // DRAFT — Kevin reviews
  "sunmi.pay.exceptions": "Ngoại lệ",   // DRAFT — Kevin reviews
  "sunmi.pay.exceptionsNone": "Tuần này không có gì cần xem lại.",   // DRAFT — Kevin reviews
  "sunmi.pay.showOnly": "Chỉ hiện những thợ này",   // DRAFT — Kevin reviews
  "sunmi.pay.showAll": "Hiện tất cả",   // DRAFT — Kevin reviews
  "sunmi.pay.weekIssue": "Cả tuần",   // DRAFT — Kevin reviews
  "sunmi.pay.owner": "Chủ tiệm duyệt",   // DRAFT — Kevin reviews
  "sunmi.pay.submittedAt": "Đã gửi lúc {at}",   // DRAFT — Kevin reviews
  "sunmi.pay.notSubmitted": "Chưa gửi cho chủ tiệm.",   // DRAFT — Kevin reviews
  "sunmi.pay.decision": "Chủ tiệm: {decision}",   // DRAFT — Kevin reviews
  "sunmi.pay.lastWeek": "Tuần trước phải trả",   // DRAFT — Kevin reviews
  "sunmi.pay.thisWeek": "Tuần này phải trả",   // DRAFT — Kevin reviews
  "sunmi.pay.change": "Chênh lệch",   // DRAFT — Kevin reviews
  "sunmi.pay.customSplits": "Cách chia riêng",   // DRAFT — Kevin reviews
  "sunmi.pay.noLastWeek": "Chưa có tuần trước để so sánh.",   // DRAFT — Kevin reviews
  "sunmi.pay.payouts": "Khoản trả",   // DRAFT — Kevin reviews
  "sunmi.pay.cashWaiting": "Tiền mặt chờ giao",   // DRAFT — Kevin reviews
  "sunmi.pay.checksToDeliver": "Chi phiếu chờ giao",   // DRAFT — Kevin reviews
  "sunmi.pay.problemPayouts": "Khoản trả có vấn đề",   // DRAFT — Kevin reviews
  "sunmi.pay.pendingApproval": "Bảng lương chờ chủ tiệm",   // DRAFT — Kevin reviews
  "sunmi.pay.openPrep": "Mở phần chuẩn bị",   // DRAFT — Kevin reviews
  "sunmi.pay.summaryUnavailable": "Không xem được tóm tắt khoản trả.",   // DRAFT — Kevin reviews
  "sunmi.pay.audit": "Lịch sử kiểm tra",   // DRAFT — Kevin reviews
  "sunmi.pay.version": "Phiên bản",   // DRAFT — Kevin reviews
  "sunmi.pay.approvedBy": "Người duyệt",   // DRAFT — Kevin reviews
  "sunmi.pay.fingerprint": "Mã xác nhận duyệt",   // DRAFT — Kevin reviews
  "sunmi.pay.payoutStatus": "Tình trạng trả",   // DRAFT — Kevin reviews
  "sunmi.pay.scope": "Phạm vi",   // DRAFT — Kevin reviews
  "sunmi.pay.scopeTenant": "Cả tiệm",   // DRAFT — Kevin reviews
  "sunmi.pay.scopeBranch": "Một chi nhánh",   // DRAFT — Kevin reviews
  "sunmi.pay.quick": "Thao tác nhanh",   // DRAFT — Kevin reviews
  "sunmi.pay.export": "Xuất CSV",   // DRAFT — Kevin reviews
  "sunmi.pay.exported": "Đã tải tệp xuất ({n} dòng).",   // DRAFT — Kevin reviews
  "sunmi.pay.notPaidYet": "Đã duyệt chưa phải là đã trả: khoản trả chỉ xong khi chi phiếu được thanh toán hoặc thợ xác nhận đã nhận tiền mặt.",   // DRAFT — Kevin reviews
};
