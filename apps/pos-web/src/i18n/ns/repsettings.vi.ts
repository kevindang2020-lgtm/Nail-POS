// repsettings.vi.ts — Review & Reputation Settings (Nov 1 2026) in Vietnamese. Glossary: Thợ · hóa đơn · hàng chờ · thẻ quà tặng · Hội viên.
// Pending a native-speaker review (docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md).
export const REPSETTINGS_VI: Record<string, string> = {
  "rssx.loadFailed": "Không tải được cài đặt. Hãy thử lại hoặc mở Tình trạng hệ thống — không có gì được giả định.",
  "rssx.saveFailed": "Không lưu được cài đặt. Thay đổi của bạn vẫn còn ở đây; chưa có gì thay đổi.",
  "rssx.loading": "Đang tải…",
  "rssx.close": "Đóng",
  "rssx.cancel": "Hủy",
  "rssx.search": "Tìm",
  "rssx.clear": "Xóa bộ lọc",
  "rssx.rows": "Số dòng",
  "rssx.on": "Bật",
  "rssx.off": "Tắt",
  "rssx.unknown": "Không ghi nhận",
  "rssx.minutes": "{n} phút",
  "rssx.unsaved": "{n} thay đổi chưa lưu",
  "rssx.discard": "Bỏ thay đổi",
  "rssx.notAllowed": "Vai trò của bạn chỉ xem, không đổi được các cài đặt này.",
  "rssx.saved": "Đã lưu. Phiên bản cài đặt {v} áp dụng cho bản nháp và lượt thanh toán tiếp theo.",
  "rssx.toneHint": "Thay đổi giọng văn của bản nháp mới — không thay đổi nội dung được hứa hay việc đăng.",
  "rssx.conflict": "Không thể bật phản hồi tự động khi đang bật \"Yêu cầu phê duyệt trước khi đăng\". Hãy tắt một trong hai để lưu.",
  "rssx.smsMissing": "Tiệm chưa thiết lập số gửi SMS (Thiết lập nhắn tin). Yêu cầu qua SMS không thể gửi được.",
  "rssx.delayHint": "Tính từ lúc thanh toán. Nếu rơi vào giờ yên lặng ({s}:00–{e}:00 giờ tiệm) sẽ dời đến hết giờ yên lặng.",
  "rssx.delayBad": "Nhập số phút nguyên từ 0 đến 10080 (7 ngày).",
  "rssx.safeguards": "Giới hạn yêu cầu (luôn áp dụng)",
  "rssx.lastChange": "Thay đổi gần nhất {at} bởi {by} · phiên bản {v}",
  "rssx.noChange": "Chưa có thay đổi nào — đây là mặc định của nền tảng.",
  "rssx.liveNote": "Soạn thảo AI và thanh toán đọc cài đặt mỗi lần, nên thay đổi đã lưu áp dụng cho bản nháp và lượt thanh toán tiếp theo. Không ảnh hưởng tiệm khác.",
  "rssx.confirmTitle": "Lưu các thay đổi này?",
  "rssx.confirmIntro": "Cho tiệm này:",
  "rssx.confirmRole": "Lưu với vai trò: {role}",
  "rssx.scopeNote": "Thay đổi chỉ áp dụng cho tiệm này. Không thay đổi gói đăng ký, thanh toán, công tắc Super Admin hay tiệm khác.",
  "rssx.reason": "Lý do (không bắt buộc, lưu trong Lịch sử)",
  "rssx.searchHistory": "Cài đặt, người, vai trò, lý do hoặc mã thay đổi",
  "rssx.anyType": "Mọi thay đổi",
  "rssx.noHistory": "Chưa có thay đổi nào.",
  "rssx.noMatch": "Không có thay đổi nào khớp bộ lọc.",
  "rssx.legacy": "Ghi nhận trước khi lưu chi tiết thay đổi — không rõ giá trị trước đó.",
  "rssx.check": "Kiểm tra cài đặt danh tiếng",
  "rssx.sg.quiet": "Giờ yên lặng {s}:00–{e}:00 (giờ tiệm)",
  "rssx.sg.cooldown": "Mỗi khách tối đa một yêu cầu trong {n} ngày",
  "rssx.sg.max": "Tối đa {n} yêu cầu mỗi khách mỗi kỳ",
  "rssx.sg.consent": "Chỉ khách có thông tin liên lạc và chưa từ chối; không bao giờ chọn theo số sao dự đoán.",
  "rssx.rt.approval": "Luôn áp dụng: phản hồi chỉ được đăng từ bản nháp đã có người duyệt, bất kể ô này.",
  "rssx.rt.autoResponse": "Đã lưu, nhưng chưa có gì chạy phản hồi tự động — không phản hồi nào được đăng mà không có người.",
  "rssx.rt.requests": "Yêu cầu được lên lịch khi thanh toán ({n} đang chờ), nhưng chưa có bộ gửi — không có gì được gửi. {o} đã quá giờ.",
  "rssx.rt.reminder": "Đã lưu, nhưng chưa có bộ gửi nhắc lại — không có lời nhắc nào được gửi.",
  "rssx.disabledAt": "Đã tắt ở cấp {l}.",
  "rssx.branchOff": "Cài đặt chi nhánh đang tắt tại đây.",
  "rssx.sms.configured": "Đã thiết lập",
  "rssx.sms.notConfigured": "Chưa thiết lập",
  "rssx.sms.validationFailed": "Lần kiểm tra thông tin xác thực gần nhất thất bại.",
  "rssx.providers.none": "Chưa kết nối",
  "rssx.providers.n": "{n} đã kết nối",
  "rssx.tab.settings": "Cài đặt",
  "rssx.tab.history": "Lịch sử",
  "rssx.tab.health": "Tình trạng hệ thống",
  "rssx.strip.effective": "Trợ lý hiện tại",
  "rssx.strip.package": "Gói & đăng ký",
  "rssx.strip.sms": "Số gửi SMS",
  "rssx.strip.providers": "Nguồn đánh giá",
  "rssx.src.default": "Mặc định",
  "rssx.src.tenant": "Tiệm này",
  "rssx.src.branch": "Chi nhánh này",
  "rssx.op.operational": "Đang chạy",
  "rssx.op.disabled": "Đã tắt",
  "rssx.op.subscription_blocked": "Bị chặn bởi gói đăng ký",
  "rssx.op.unknown_entitlement": "Chưa rõ trạng thái đăng ký",
  "rssx.level.tenant": "tiệm này",
  "rssx.level.branch": "chi nhánh này",
  "rssx.level.platform": "nền tảng",
  "rssx.ent.ok": "Được phép",
  "rssx.ent.package_disabled": "Super Admin đã tắt cho mọi tiệm",
  "rssx.ent.not_subscribed": "Chưa đăng ký",
  "rssx.ent.trial_expired": "Hết thời gian dùng thử",
  "rssx.ent.past_due": "Quá hạn thanh toán",
  "rssx.ent.unpaid": "Chưa thanh toán",
  "rssx.ent.cancelled": "Đã hủy",
  "rssx.ent.expired": "Đã hết hạn",
  "rssx.ent.subscription_suspended": "Đã tạm ngưng",
  "rssx.ent.tenant_not_active": "Tài khoản tiệm chưa hoạt động",
  "rssx.ent.branch_disabled": "Đã tắt cho chi nhánh này",
  "rssx.ent.permission_denied": "Vai trò của bạn không được phép",
  "rssx.ent.limit_exceeded": "Đã hết hạn mức sử dụng",
  "rssx.ent.unreadable": "Không đọc được",
  "rssx.ent.unknown": "Chưa rõ",
  "rssx.mode.observe": "Chưa áp dụng — chỉ ghi nhận",
  "rssx.mode.enforce": "Đang áp dụng",
  "rssx.mode.off": "Tắt kiểm tra",
  "rssx.tone.professional": "Chuyên nghiệp",
  "rssx.tone.warm": "Ấm áp",
  "rssx.tone.luxury": "Sang trọng",
  "rssx.tone.friendly": "Thân thiện",
  "rssx.tone.concise": "Ngắn gọn",
  "rssx.tone.apologetic": "Xin lỗi chân thành",
  "rssx.tone.brand": "Giọng thương hiệu của tiệm",
  "rssx.chan.sms": "SMS",
  "rssx.chan.email": "Email",
  "rssx.chan.app": "Ứng dụng khách",
  "rssx.event.settings_changed": "Đã đổi cài đặt",
  "rssx.event.assistant_enabled": "Đã bật trợ lý",
  "rssx.event.assistant_disabled": "Đã tắt trợ lý",
  "rssx.preset.all": "Mọi thời gian",
  "rssx.preset.today": "Hôm nay",
  "rssx.preset.yesterday": "Hôm qua",
  "rssx.preset.week": "Tuần này",
  "rssx.preset.last_7": "7 ngày qua",
  "rssx.preset.month": "Tháng này",
  "rssx.preset.last_month": "Tháng trước",
  "rssx.preset.last_30": "30 ngày qua",
  "rssx.preset.last_90": "90 ngày qua",
  "rssx.preset.year": "Năm nay",
  "rssx.preset.custom": "Tùy chọn",
  "rssx.hist.when": "Thời gian",
  "rssx.hist.change": "Thay đổi",
  "rssx.hist.keys": "Cài đặt",
  "rssx.hist.by": "Người thực hiện",
  "rssx.hist.version": "Phiên bản",
  "rssx.ov.title": "Thay đổi cài đặt",
  "rssx.ov.id": "Mã thay đổi",
  "rssx.ov.scope": "Cấp",
  "rssx.ov.reason": "Lý do",
  "rssx.ov.before": "Trước",
  "rssx.ov.after": "Sau",
  "rssx.ov.default": "Mặc định",
  "rssx.ov.live": "Đọc trực tiếp: {d} bản nháp AI và {r} yêu cầu đánh giá đã dùng cài đặt kể từ thay đổi này.",
  "rssx.err.RSS_STALE_VERSION": "Người khác vừa đổi các cài đặt này. Đã tải lại — thay đổi của bạn chưa được lưu.",
  "rssx.err.RSS_NO_CHANGE": "Không có gì thay đổi.",
  "rssx.err.RSS_INVALID_VALUE": "Có giá trị không hợp lệ.",
  "rssx.err.RSS_POLICY_CONFLICT": "Không thể bật phản hồi tự động khi đang yêu cầu phê duyệt. Chưa có gì được lưu.",
  "rssx.err.RSS_VERSION_REQUIRED": "Hãy tải lại cài đặt và thử lại.",
  "rssx.err.RSS_INVALID_PERIOD": "Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.",
  "rssx.err.RSS_EVENT_NOT_FOUND": "Không tìm thấy thay đổi đó.",
  "rssx.err.PERMISSION_DENIED": "Vai trò của bạn không thực hiện được việc này.",
  "rssx.health.PASSED": "Đạt",
  "rssx.health.WARNING": "Cảnh báo",
  "rssx.health.FAILED": "Lỗi",
  "rssx.health.INSUFFICIENT_DATA": "Chưa đủ dữ liệu",
  "rssx.health.UNAVAILABLE": "Không khả dụng",
  "rssx.health.intro": "Chỉ đọc: không gửi, đăng, duyệt hay thay đổi gì.",
  "rssx.health.running": "Đang kiểm tra…",
  "rssx.health.overall": "Tổng thể: {s} · {at}",
  "rssx.health.recent": "(kết quả kiểm tra trong 30 giây qua)",
  "rssx.health.k.settings_readable": "Đọc được cài đặt",
  "rssx.health.d.settings_readable.PASSED": "Đã đọc được cài đặt và nguồn của chúng.",
  "rssx.health.d.settings_readable.FAILED": "Không đọc được cài đặt. Soạn thảo dừng và thanh toán không lên lịch yêu cầu cho đến khi sửa.",
  "rssx.health.k.values_valid": "Giá trị lưu hợp lệ",
  "rssx.health.d.values_valid.PASSED": "Mọi giá trị đã lưu đều hợp lệ.",
  "rssx.health.d.values_valid.WARNING": "Một số giá trị đã lưu không hợp lệ nên bị bỏ qua (dùng mặc định). Hãy lưu lại cài đặt.",
  "rssx.health.k.assistant_state": "Trợ lý đang bật",
  "rssx.health.d.assistant_state.PASSED": "Trợ lý đang bật cho tiệm này.",
  "rssx.health.d.assistant_state.WARNING": "Trợ lý đang tắt tại đây — không có bản nháp AI và không có yêu cầu đánh giá mới.",
  "rssx.health.k.subscription": "Gói & đăng ký",
  "rssx.health.d.subscription.PASSED": "Gói Đánh giá & Danh tiếng AI được phép cho tiệm này.",
  "rssx.health.d.subscription.WARNING": "Gói đăng ký không cho phép, nhưng hiện chỉ ghi nhận.",
  "rssx.health.d.subscription.FAILED": "Gói đăng ký đang chặn. Đánh giá vẫn hiển thị; soạn thảo AI không dùng được.",
  "rssx.health.d.subscription.UNAVAILABLE": "Không đọc được trạng thái đăng ký.",
  "rssx.health.k.auto_response": "Phản hồi tự động",
  "rssx.health.d.auto_response.PASSED": "Phản hồi tự động đang tắt.",
  "rssx.health.d.auto_response.WARNING": "Phản hồi tự động được lưu là bật, nhưng chưa có gì chạy — không phản hồi nào được đăng mà không có người.",
  "rssx.health.k.requests_sender": "Gửi yêu cầu đánh giá",
  "rssx.health.d.requests_sender.PASSED": "Yêu cầu đang tắt và không có yêu cầu nào đang chờ.",
  "rssx.health.d.requests_sender.WARNING": "Yêu cầu được lên lịch khi thanh toán nhưng chưa có bộ gửi — không có gì được gửi.",
  "rssx.health.k.reminder": "Nhắc lại",
  "rssx.health.d.reminder.PASSED": "Nhắc lại đang tắt.",
  "rssx.health.d.reminder.WARNING": "\"Gửi một lời nhắc\" đang bật, nhưng chưa có bộ gửi nhắc — không có lời nhắc nào được gửi.",
  "rssx.health.k.sms_sender": "Số gửi SMS của tiệm",
  "rssx.health.d.sms_sender.PASSED": "Số gửi SMS riêng của tiệm đã được thiết lập.",
  "rssx.health.d.sms_sender.WARNING": "Yêu cầu dùng SMS nhưng tiệm chưa thiết lập số gửi SMS.",
  "rssx.health.d.sms_sender.INSUFFICIENT_DATA": "Chưa thiết lập số gửi SMS (không cần khi tắt yêu cầu qua SMS).",
  "rssx.health.k.provider_connected": "Đã kết nối nguồn đánh giá",
  "rssx.health.d.provider_connected.PASSED": "Có ít nhất một nguồn đánh giá đã kết nối.",
  "rssx.health.d.provider_connected.WARNING": "Chưa kết nối nguồn đánh giá — không thể đăng phản hồi lên Google hoặc Facebook.",
  "rssx.health.k.policy_conflict": "Phê duyệt và phản hồi tự động không xung đột",
  "rssx.health.d.policy_conflict.PASSED": "Không cấp nào bật phản hồi tự động khi đang yêu cầu phê duyệt.",
  "rssx.health.d.policy_conflict.FAILED": "Có cài đặt tiệm hoặc chi nhánh bật phản hồi tự động khi đang yêu cầu phê duyệt. Hãy tắt một trong hai.",
  "rssx.health.k.approval_enforced": "Mọi phản hồi đã đăng đều được duyệt",
  "rssx.health.d.approval_enforced.PASSED": "Mọi phản hồi đã đăng đều có ghi nhận phê duyệt.",
  "rssx.health.d.approval_enforced.FAILED": "Có phản hồi đã đăng mà không có ghi nhận phê duyệt. Hãy báo ngay.",
  "rssx.health.k.delay_honoured": "Thời gian chờ sau lượt được tuân thủ",
  "rssx.health.d.delay_honoured.PASSED": "Không có yêu cầu nào gửi trước giờ đã lên lịch.",
  "rssx.health.d.delay_honoured.FAILED": "Có yêu cầu được gửi trước giờ đã lên lịch.",
  "rssx.health.k.consent": "Khách vẫn đồng ý",
  "rssx.health.d.consent.PASSED": "Không có yêu cầu đang chờ nào cho khách đã từ chối.",
  "rssx.health.d.consent.WARNING": "Một số yêu cầu đang chờ dành cho khách đã từ chối; chúng sẽ bị bỏ qua khi gửi.",
  "rssx.health.k.no_duplicate_requests": "Mỗi lượt một yêu cầu",
  "rssx.health.d.no_duplicate_requests.PASSED": "Không có lượt nào có hai yêu cầu cùng kênh.",
  "rssx.health.d.no_duplicate_requests.FAILED": "Có lượt có nhiều hơn một yêu cầu cùng kênh.",
  "rssx.health.k.branch_overrides": "Cài đặt chi nhánh",
  "rssx.health.d.branch_overrides.PASSED": "Không có chi nhánh nào ghi đè cài đặt của tiệm.",
  "rssx.health.d.branch_overrides.WARNING": "Có chi nhánh có cài đặt riêng; áp dụng tại chi nhánh đó thay cho cài đặt của tiệm.",
  "rssx.health.k.history_complete": "Mọi thay đổi có trong Lịch sử",
  "rssx.health.d.history_complete.PASSED": "Cài đặt hiện tại khớp với một thay đổi đã ghi.",
  "rssx.health.d.history_complete.WARNING": "Cài đặt hiện tại được ghi mà không có mục Lịch sử (trước bản cập nhật này).",
  "rssx.health.k.tenant_isolation": "Chỉ dữ liệu của tiệm này",
  "rssx.health.d.tenant_isolation.PASSED": "Mọi thay đổi đã ghi đều do nhân viên tiệm này thực hiện.",
  "rssx.health.d.tenant_isolation.FAILED": "Có thay đổi gắn với người dùng của tiệm khác. Hãy báo ngay.",
  "rssx.health.k.no_side_effects": "Không gửi, đăng hay tính phí",
  "rssx.health.d.no_side_effects.PASSED": "Việc kiểm tra và các cài đặt này không gửi tin, đăng, duyệt hay tính phí.",
  "rssx.health.k.request_dry_run": "Chạy thử yêu cầu đánh giá (7 ngày qua)", // DRAFT — Kevin reviews
  "rssx.health.d.request_dry_run.PASSED": "Chính sách hiện tại đã được áp dụng thử cho các lượt khách đã thanh toán gần đây. Không có gì được lên lịch hay gửi đi.", // DRAFT — Kevin reviews
  "rssx.health.d.request_dry_run.WARNING": "Một số khách sẽ được hỏi qua kênh chưa kết nối. Không có gì được lên lịch hay gửi đi.", // DRAFT — Kevin reviews
  "rssx.health.d.request_dry_run.INSUFFICIENT_DATA": "Không có lượt khách đã thanh toán nào trong 7 ngày qua để chạy thử.", // DRAFT — Kevin reviews
  "rssx.dry.line": "{days} ngày qua: {v} lượt khách đã thanh toán — {a} sẽ được hỏi, {s} sẽ bỏ qua", // DRAFT — Kevin reviews
  "rssx.dry.quiet": "{n} sẽ được dời ra khỏi giờ yên lặng.", // DRAFT — Kevin reviews
  "rssx.dry.channel": "Kênh: {c}.", // DRAFT — Kevin reviews
  "rssx.dry.notReady": "Số gửi SMS của tiệm chưa được kết nối.", // DRAFT — Kevin reviews
  "rssx.dry.off": "Yêu cầu đánh giá đang tắt — đây là kết quả nếu bật lên.", // DRAFT — Kevin reviews
  "rssx.dry.r.opted_out": "đã từ chối hoặc bị chặn", // DRAFT — Kevin reviews
  "rssx.dry.r.no_contact_method": "không có số điện thoại / email", // DRAFT — Kevin reviews
  "rssx.dry.r.no_customer": "lượt khách không có khách hàng", // DRAFT — Kevin reviews
  "rssx.dry.r.below_min_value": "dưới giá trị tối thiểu", // DRAFT — Kevin reviews
  "rssx.dry.r.frequency_cap": "đã hỏi trong kỳ này", // DRAFT — Kevin reviews
  "rssx.dry.r.cooldown": "mới hỏi gần đây", // DRAFT — Kevin reviews
  "rssx.dry.r.already_requested": "đã yêu cầu cho lượt này", // DRAFT — Kevin reviews
  "rssx.dry.r.requests_disabled": "yêu cầu đang tắt", // DRAFT — Kevin reviews
  "rssx.dry.ch.sms": "SMS", // DRAFT — Kevin reviews
  "rssx.dry.ch.email": "Email", // DRAFT — Kevin reviews
  "rssx.dry.ch.app": "Ứng dụng", // DRAFT — Kevin reviews
  "rssx.fresh.lastSync": "Đồng bộ thành công gần nhất: {at}", // DRAFT — Kevin reviews
  "rssx.fresh.neverSynced": "Chưa đồng bộ lần nào", // DRAFT — Kevin reviews
  "rssx.fresh.failing": "{n} nhà cung cấp bị lỗi ở lần đồng bộ gần nhất", // DRAFT — Kevin reviews
  "rssx.fresh.waiting": "{n} phản hồi công khai đã duyệt đang chờ đăng.", // DRAFT — Kevin reviews
  "rssx.fresh.publishFailed": "{n} phản hồi công khai đăng không thành công — mở Trợ lý đánh giá AI để thử lại.", // DRAFT — Kevin reviews
  "rssx.fresh.overdue": "{n} yêu cầu đánh giá đã quá giờ gửi mà chưa gửi.", // DRAFT — Kevin reviews
  "rssx.inv.title": "Trang đánh giá và nguồn phản hồi", // DRAFT — Kevin reviews
  "rssx.inv.site": "Trang", // DRAFT — Kevin reviews
  "rssx.inv.connection": "Kết nối", // DRAFT — Kevin reviews
  "rssx.inv.sync": "Đồng bộ thành công gần nhất", // DRAFT — Kevin reviews
  "rssx.inv.replies": "Trả lời", // DRAFT — Kevin reviews
  "rssx.inv.import": "Đánh giá mới", // DRAFT — Kevin reviews
  "rssx.inv.reviews": "Đánh giá đã lưu", // DRAFT — Kevin reviews
  "rssx.inv.src.google": "Google Business Profile", // DRAFT — Kevin reviews
  "rssx.inv.src.facebook": "Facebook", // DRAFT — Kevin reviews
  "rssx.inv.src.yelp": "Yelp", // DRAFT — Kevin reviews
  "rssx.inv.conn.connected": "Đã kết nối", // DRAFT — Kevin reviews
  "rssx.inv.conn.disconnected": "Đã ngắt kết nối", // DRAFT — Kevin reviews
  "rssx.inv.conn.not_connected": "Chưa kết nối", // DRAFT — Kevin reviews
  "rssx.inv.conn.no_connector": "Chưa có bộ kết nối", // DRAFT — Kevin reviews
  "rssx.inv.failedAt": "lỗi lúc {at}", // DRAFT — Kevin reviews
  "rssx.inv.replyApi": "Có thể đăng câu trả lời đã duyệt từ đây", // DRAFT — Kevin reviews
  "rssx.inv.replyManual": "Trả lời ngay trên trang đó", // DRAFT — Kevin reviews
  "rssx.inv.importOn": "Tự động nhập", // DRAFT — Kevin reviews
  "rssx.inv.importOff": "Không tự động nhập", // DRAFT — Kevin reviews
  "rssx.inv.internal": "Phản hồi của tiệm (tại tiệm, khảo sát, tin nhắn, nhập tay): {n} đã lưu · đã gửi {r} lời mời đánh giá.", // DRAFT — Kevin reviews
  "rssx.inv.note": "Chỉ những kết nối nền tảng hỗ trợ mới được ghi là đã kết nối; ở đây không kết nối, nhập hay đăng gì.", // DRAFT — Kevin reviews
  "rssx.lock.branch_override": "Chi nhánh này có giá trị riêng — đổi giá trị của tiệm sẽ không đổi ở đây.", // DRAFT — Kevin reviews
  "rssx.lock.assistant_disabled": "Trợ lý đang tắt, nên cài đặt này không có tác dụng cho đến khi bật lại.", // DRAFT — Kevin reviews
  "rssx.lock.subscription_blocked": "Gói đăng ký đang chặn trợ lý — bật lên cũng không chạy.", // DRAFT — Kevin reviews
  "rssx.sec.line": "{d} ngày qua: {e} lần cố vượt quyền và {c} lần truy cập tiệm khác đã bị từ chối (gần nhất {at}). Hãy xem lại vai trò trong Quản lý nhóm.", // DRAFT — Kevin reviews
  "rssx.openIntegrations": "Mở Tích hợp", // DRAFT — Kevin reviews
  "rssx.applied": "Đang chạy bản v{v} (lưu lúc {at}) — soạn trả lời và thanh toán đọc trực tiếp", // DRAFT — Kevin reviews
};
