// ns/ops.vi.ts — the POS "ops" namespace, Vietnamese. Same keys as ops.en.ts (check-i18n: key parity, no empty value,
// matching {placeholders}); glossary terms from docs/i18n/VI_GLOSSARY.md (technician = "thợ", queue = "hàng chờ").
// New values await Kevin's review: docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md (section WP-C1).
import type { OPS_EN } from './ops.en';
export const OPS_VI: Record<keyof typeof OPS_EN, string> = {
  'ops.common.messageName': 'Nhắn tin cho {name}',
  'ops.common.minutesShort': '{n} phút',
  'ops.common.egMinutes': 'vd: 15',
  'ops.techQueue.next.now': 'Ngay bây giờ',
  'ops.techQueue.next.on_break': 'Đang nghỉ',
  'ops.techQueue.next.off': 'Nghỉ hôm nay',
  'ops.techQueue.next.soon': 'Sắp rảnh',
  'ops.techQueue.insight.ot': 'Thợ sắp làm quá giờ: {count}',
  'ops.techQueue.insight.otSub': 'Theo dõi lịch để tránh làm quá giờ.',
  'ops.techQueue.insight.reviewNow': 'Xem ngay',
  'ops.techQueue.insight.up': '{name} dẫn đầu doanh thu hôm nay',
  'ops.techQueue.insight.upSub': '{revenue} từ {services} dịch vụ.',
  'ops.techQueue.insight.wait': 'Khách đang chờ chỉ định: {count}',
  'ops.techQueue.insight.waitSub': 'Cân nhắc chỉ định lại để hợp kỹ năng hơn.',
  'ops.techQueue.assignedTo': 'Đã chỉ định {customer} cho {tech}.',
  'ops.techQueue.queuedNextFor': '{customer} được xếp kế tiếp cho {tech}.',
  'ops.techQueue.unassignableLeft': '{count} khách đang chờ chưa ghép được với thợ nào đang rảnh và vẫn ở trong hàng chờ.',
  'ops.checkIn.source.inPerson': 'Tại tiệm',
  'ops.checkIn.source.staffBooking': 'Nhân viên đặt lịch',
  'ops.customer.favoriteService': 'Dịch vụ yêu thích',
  'ops.checkIn.eta': 'Giờ đến dự kiến',
  'ops.checkIn.insight.peak': 'Khách đến đông nhất vào khoảng {hour} ({count} lượt tiếp nhận).',
  'ops.checkIn.insight.wait': 'Thời gian chờ trung bình là {minutes} phút. Cân nhắc thêm thợ.',
  'ops.checkIn.insight.noIdle': '{count} khách đang chờ và không có thợ nào rảnh.',
  'ops.checkIn.insight.vip': 'Hôm nay có {count} khách VIP đã tiếp nhận. Hãy đảm bảo trải nghiệm cao cấp.',
  'ops.checkIn.insight.walkIn': 'Khách vãng lai chiếm {percent}% lượt tiếp nhận hôm nay.',
  'ops.checkIn.nextHours': 'Trong {h} giờ tới',
  'ops.checkIn.onDuty': 'rảnh / đang làm',
  'ops.checkIn.availableOf': '{available}/{onDuty} thợ rảnh',
  'ops.checkIn.noneOnDuty': 'Hiện không có thợ nào đang làm.',
  'ops.checkIn.loadHint': 'Số khách đã chỉ định cho thợ này và chưa bắt đầu dịch vụ',
  'ops.checkIn.smsConsent': 'Khách đồng ý nhận tin nhắn về lịch hẹn',
  'ops.checkIn.insight.longWait': '{count} khách đã chờ hơn {minutes} phút.',
  'ops.checkIn.insight.late': '{count} lịch hẹn đến trễ — có thể vắng mặt.',
  'ops.checkIn.insight.arriving': '{count} lịch hẹn sẽ đến trong {minutes} phút tới.',
  'ops.checkIn.insight.available': '{count} thợ đang rảnh.',
  'ops.common.minutesSeconds': '{m} phút {s} giây',
  'ops.common.ai': 'AI',
  'ops.overview.timeLeft': 'Thời gian còn lại',
  'ops.overview.viewFullCalendar': 'Xem toàn bộ lịch',
  'ops.channel.sms': 'SMS',
  'ops.channel.email': 'Email',
  'ops.channel.push': 'Thông báo đẩy',
  'ops.channel.app': 'Ứng dụng',
  'ops.channel.whatsapp': 'WhatsApp',
  'ops.status.scheduled': 'Đã lên lịch',
  'ops.status.sent': 'Đã gửi',
  'ops.status.delivered': 'Đã nhận',
  'ops.status.failed': 'Thất bại',
  'ops.status.queued': 'Đang chờ gửi',
  'ops.status.read': 'Đã xem',
  'ops.status.missed': 'Nhỡ',
  'ops.status.upcoming': 'Sắp tới',
  'ops.status.in_progress': 'Đang thực hiện',
  'ops.status.open': 'Đang mở',
  'ops.status.pending': 'Đang chờ',
  'ops.status.paid': 'Đã thanh toán',
  'ops.liveOps.cardPaymentsMtd': 'thanh toán thẻ từ đầu tháng',
  'ops.liveOps.nWaiting': '{n} đang chờ',
  'ops.liveOps.nRemaining': 'còn {n}',
  'ops.liveOps.perPaidTicket': 'mỗi hóa đơn đã thanh toán',
  'ops.liveOps.returningGuests': 'khách quay lại',
  'ops.liveOps.viaAiAssistant': 'qua trợ lý AI',
  'ops.liveOps.viewLeaderboard': 'Xem bảng xếp hạng',
  'ops.liveOps.viewServiceReports': 'Xem báo cáo dịch vụ',
  'ops.liveOps.viewRetentionReport': 'Xem báo cáo giữ chân khách',
  'ops.liveOps.viewPaymentCenter': 'Xem trung tâm thanh toán',
  'ops.liveOps.viewAllLocations': 'Xem tất cả chi nhánh',
  'ops.liveOps.ai.peak': 'Giờ cao điểm hôm nay: {window}',
  'ops.liveOps.ai.peakService': 'Nhu cầu cao cho {service}.',
  'ops.liveOps.ai.peakPlan': 'Sắp xếp nhân sự cho khung giờ đông khách.',
  'ops.liveOps.ai.staffing': 'Đề xuất thêm 1 thợ',
  'ops.liveOps.ai.staffingWindow': 'Trong khoảng {window} để giảm thời gian chờ.',
  'ops.liveOps.ai.staffingPeak': 'Trong giờ cao điểm để giảm thời gian chờ.',
  'ops.liveOps.ai.missedCalls': '{count} cuộc gọi nhỡ hôm nay',
  'ops.liveOps.ai.missedCallsValue': 'Lịch hẹn tiềm năng trị giá khoảng {value}.',
  'ops.liveOps.ai.viewCallBack': 'Xem & gọi lại',
  'ops.liveOps.ai.upsell': 'Cơ hội bán thêm',
  'ops.liveOps.ai.upsellGuests': '{count} khách phù hợp với dịch vụ thêm.',
  'ops.liveOps.ai.rebooking': '{count} khách đến hạn đặt lịch lại',
  'ops.liveOps.ai.rebookingReach': 'Liên hệ để giữ chân khách.',
  'ops.liveOps.ai.lowStock': 'Cảnh báo sắp hết hàng',
  'ops.liveOps.ai.lowStockCount': '{count} sản phẩm sắp hết.',
  'ops.liveOps.ai.viewInventory': 'Xem tồn kho',
  'ops.booking.selectCustomerOrGuest': 'Vui lòng chọn khách hàng hoặc tiếp tục với khách lẻ.',
  'ops.booking.selectService': 'Vui lòng chọn ít nhất một dịch vụ.',
  'ops.booking.selectStartTime': 'Vui lòng chọn giờ bắt đầu lịch hẹn.',
  'ops.booking.phoneRequired': 'Cần nhập số điện thoại.',
  'ops.booking.catalogLoadFailed': 'Không tải được danh mục dịch vụ. Hãy kiểm tra kết nối và thử lại.',
  'ops.booking.blockTeamMeeting': 'Họp nhóm',
  'ops.booking.moveFailed': 'Không dời được lịch hẹn.',
  'ops.booking.doubleBookReason': 'Lý do đặt trùng lịch',
  'ops.verify.channel.online': 'Trang đặt lịch trực tuyến',
  'ops.verify.channel.kiosk': 'Ki-ốt tự phục vụ',
  'ops.verify.overrideAsk': 'Hoàn tất đặt lịch cho {phone} mà không cần mã? Hãy ghi lý do. Lý do được lưu lại và hiển thị trên lịch hẹn.',
  'ops.verify.overrideApproved': 'Đã duyệt. Hãy nhờ khách bấm Đặt lịch lại. Lịch hẹn sẽ được đánh dấu “Đã bỏ qua xác minh điện thoại thủ công”.',
  'ops.verify.usage.requested': 'Đã yêu cầu mã',
  'ops.verify.usage.codesSent': 'Mã đã gửi',
  'ops.verify.usage.verified': 'Đã xác minh',
  'ops.verify.usage.completed': 'Lịch hẹn đã hoàn tất',
  'ops.verify.usage.overridden': 'Quản lý đã duyệt',
  'ops.verify.usage.locked': 'Bị khóa (nhập sai mã)',
  'ops.verify.usage.expired': 'Chưa hoàn tất (hết hạn)',
  'ops.verify.usage.failed': 'Gửi không thành công',
  'ops.booking.saveFailed': 'Không lưu được lịch hẹn.',
  'ops.queue.unlockWhy': 'Vì sao mở khóa khách này?',
  'ops.queue.guestDeclinedNote': 'Khách không muốn thợ này. Ghi chú (không bắt buộc)',
  'ops.queue.party': 'Nhóm khách',
  'ops.queue.app': 'Ứng dụng',
  'ops.queue.splitVisit': 'Lượt ghé chia thợ',
  'ops.queue.sendToTech': 'Chuyển cho thợ',
  'ops.queue.insight.peak': 'Khung giờ khách đến đông nhất: {window}',
  'ops.queue.insight.peakSub': 'Lượng khách cao. Cân nhắc tăng nhân sự.',
  'ops.queue.insight.vip': '{name} đã chờ {minutes} phút',
  'ops.queue.insight.vipSub': 'Khách VIP. Nên ưu tiên chỉ định.',
  'ops.queue.insight.upsell': 'Cơ hội bán thêm: {count} khách',
  'ops.queue.insight.upsellSub': 'Gợi ý dịch vụ thêm cho dịch vụ chăm sóc chân.',
  'ops.queue.insight.assignVip': 'Chỉ định khách VIP ngay',
  'ops.queue.quotedWait': 'Thời gian chờ báo trước',
  'ops.queue.actualWait': 'Thời gian chờ thực tế',
  'ops.booking.priceReasonRequired': 'Hãy nhập lý do đổi giá.',
  'ops.schedule.lunchBreak': 'Nghỉ trưa',
  'ops.assign.free': 'đang rảnh',
  'ops.assign.guests': '{count} khách',
  'ops.techQueue.drop.midService': 'Thợ đang làm dịch vụ',
  'ops.techQueue.drop.onBreak': 'Thợ đang nghỉ',
  'ops.techQueue.drop.off': 'Thợ nghỉ hôm nay / chưa vào ca',
  'ops.techQueue.drop.unavailable': 'Thợ không có mặt',
  'ops.common.hoursMinutes': '{h} giờ {m} phút',
  'ops.turn.status.clockedIn': 'Đã chấm công vào — chưa vào vòng lượt',
  'ops.turn.mode.AUTOMATIC': 'Tự động',
  'ops.turn.mode.RECOMMEND_AND_CONFIRM': 'Gợi ý & xác nhận',
  'ops.turn.mode.MANUAL': 'Thủ công',
  'ops.turn.err.board': 'Không tải được bảng lượt',
  'ops.turn.err.history': 'Không tải được lịch sử lượt',
  'ops.turn.err.fairness': 'Không tải được mức công bằng lượt',
  'ops.turn.err.summary': 'Không tải được tóm tắt của thợ này',
  'ops.turn.err.report': 'Không tải được báo cáo nhóm',
  'ops.turn.err.settings': 'Không tải được cài đặt lượt',
  'ops.turn.err.save': 'Lưu thất bại',
  'ops.turn.err.rule': 'Không lưu được quy tắc',
  'ops.turn.err.simulate': 'Mô phỏng thất bại',
  'ops.turn.ask.setNext': 'Cho {name} làm người kế tiếp? Lý do?',
  'ops.turn.ok.setNext': '{name} là người kế tiếp.',
  'ops.turn.ask.back': 'Chuyển {name} xuống cuối hàng? Lý do?',
  'ops.turn.ok.back': 'Đã chuyển {name} xuống cuối hàng.',
  'ops.turn.ask.hold': 'Tạm dừng hàng chờ cho {name} (không phải giờ nghỉ tính lương)? Lý do?',
  'ops.turn.ok.hold': '{name} đang tạm dừng hàng chờ.',
  'ops.turn.ok.release': '{name} đã trở lại vòng lượt.',
  'ops.turn.ask.adjustTurns': 'Điều chỉnh số lượt của {name} — bao nhiêu lượt (vd: 0.5 hoặc -0.5)?',
  'ops.turn.ask.adjustWhy': 'Vì sao điều chỉnh {name} {turns} lượt?',
  'ops.turn.ok.adjust': 'Đã điều chỉnh lượt của {name}: {turns}.',
  'ops.turn.ok.join': '{name} đã vào vòng lượt.',
  'ops.turn.ok.closeDay': 'Đã chốt ngày lượt {date}.',
  'ops.turn.ask.saveRules': 'Vì sao thay đổi quy tắc lượt? (lưu cùng phiên bản mới)',
  'ops.turn.ask.ruleWhy': 'Vì sao chọn mức lượt này?',
  'ops.turn.ask.retire': 'Ngừng dùng quy tắc lượt này? Lý do?',
  'ops.turn.sim.sampleService': 'Sơn gel tay',
  'ops.turn.fair.WITHIN_FAIR_RANGE': 'Trong mức công bằng',
  'ops.turn.fair.BELOW_EXPECTED_OPPORTUNITY': 'Thấp hơn cơ hội dự kiến {turns} lượt',
  'ops.turn.fair.ABOVE_EXPECTED_OPPORTUNITY': 'Cao hơn cơ hội dự kiến {turns} lượt',
  'ops.turn.opt.traditional_weighted_rotation': 'Xoay vòng truyền thống có trọng số',
  'ops.turn.opt.lowest_turn_units': 'Ít lượt nhất',
  'ops.turn.opt.workload_balanced': 'Cân bằng khối lượng việc',
  'ops.turn.opt.hybrid_fairness': 'Công bằng kết hợp',
  'ops.turn.opt.manual_order': 'Thứ tự thủ công',
  'ops.turn.opt.BACK_OF_QUEUE': 'Cuối hàng chờ',
  'ops.turn.opt.MANAGER_SELECTED_POSITION': 'Vị trí do quản lý chọn',
  'ops.turn.opt.FAIRNESS_ENGINE_BASELINE': 'Theo mức nền của hệ thống công bằng',
  'ops.turn.opt.DO_NOT_CONSUME_ROTATION_TURN': 'Không tính lượt xoay vòng',
  'ops.turn.opt.COUNT_FULL_TURN': 'Tính một lượt đủ',
  'ops.turn.opt.COUNT_WEIGHTED_TURN': 'Tính lượt theo trọng số',
  'ops.turn.opt.MANAGER_DECIDES': 'Quản lý quyết định',
  'ops.turn.opt.DO_NOT_COUNT': 'Không tính',
  'ops.turn.opt.COUNT_ALL': 'Tính tất cả',
  'ops.turn.opt.COUNT_ANY_TECH_APPOINTMENTS': 'Tính lịch hẹn "thợ bất kỳ"',
  'ops.turn.opt.COUNT_REQUESTED_APPOINTMENTS': 'Tính lịch hẹn có yêu cầu thợ',
  'ops.turn.opt.WEIGHT_BY_SERVICE': 'Theo trọng số dịch vụ',
  'ops.turn.opt.FAIR_TURN_ENGINE': 'Hệ thống chia lượt công bằng',
  'ops.turn.opt.PREFERRED_TECHNICIAN_FIRST': 'Ưu tiên thợ khách chọn',
  'ops.turn.opt.OFF': 'Tắt',
  'ops.turn.opt.SOFT': 'Ưu tiên',
  'ops.turn.opt.HARD': 'Bắt buộc',
  'ops.turn.opt.PRESERVE_POSITION': 'Giữ vị trí',
  'ops.turn.opt.MOVE_TO_BACK_ON_RETURN': 'Xuống cuối hàng khi quay lại',
  'ops.turn.opt.REJOIN_BY_FAIRNESS': 'Vào lại theo mức công bằng',
  'ops.turn.opt.PRESERVE': 'Giữ vị trí',
  'ops.turn.opt.MOVE_BACK': 'Xuống cuối hàng',
  'ops.turn.opt.WAIT_UNTIL_FULL_TURN': 'Chờ đủ một lượt',
  'ops.turn.opt.KEEP_RELATIVE_POSITION': 'Giữ vị trí tương đối',
  'ops.turn.opt.MOVE_PARTIALLY': 'Dời một phần',
  'ops.turn.opt.KEEP_POSITION': 'Giữ vị trí',
  'ops.turn.opt.MOVE_TO_BACK': 'Xuống cuối hàng',
  'ops.turn.opt.CHARGE_HALF_TURN': 'Tính nửa lượt',
  'ops.turn.opt.CHARGE_FULL_TURN': 'Tính một lượt đủ',
  'ops.turn.opt.MANAGER_REVIEW': 'Quản lý xem xét',
  'ops.turn.opt.COUNT_AS_TURN': 'Tính là một lượt',
  'ops.turn.opt.NO_QUEUE_PENALTY': 'Không bị phạt vị trí',
  'ops.turn.opt.JOIN_BACK': 'Vào cuối hàng',
  'ops.turn.opt.NONE': 'Không',
  'ops.turn.opt.PARTIAL': 'Một phần',
  'ops.turn.opt.FULL': 'Toàn bộ',
  'ops.turn.opt.CLOCK_IN_ORDER': 'Thứ tự chấm công vào',
  'ops.turn.opt.SCHEDULE_ORDER': 'Thứ tự theo lịch làm',
  'ops.turn.opt.PREVIOUS_ROTATION_CARRYOVER': 'Giữ vòng lượt của hôm trước',
  'ops.turn.opt.MANAGER_DEFINED': 'Quản lý sắp xếp',
  'ops.turn.opt.FULL_TEAM_QUEUE': 'Toàn bộ hàng chờ của nhóm',
  'ops.turn.opt.POSITION_ONLY': 'Chỉ vị trí của mình',
  'ops.turn.opt.NEXT_FEW': 'Vài người kế tiếp',
  'ops.turn.opt.PRIVATE_POSITION': 'Vị trí riêng tư',
  'ops.status.polish': 'Sơn',
  'ops.status.prep': 'Chuẩn bị',
  'ops.status.drying': 'Đang hong khô',
  'ops.status.quality_check': 'Kiểm tra chất lượng',
  'ops.status.finishing_soon': 'Sắp xong',
  'ops.status.just_started': 'Vừa bắt đầu',
  'ops.status.available': 'Đang rảnh',
  'ops.status.busy': 'Đang bận',
  'ops.status.break': 'Giờ nghỉ',
  'ops.status.now': 'Ngay bây giờ',
  'ops.status.soon': 'Sắp rảnh',
  'ops.serving.lineQueued': 'Đang chờ',
  'ops.serving.vs30': 'so với 30 phút trước',
  'ops.serving.utilized': 'Đã dùng {pct}% công suất',
  'ops.insight.reviewNow': 'Xem ngay',
  'ops.insight.openProfile': 'Mở hồ sơ',
  'ops.serving.insight.overtime': '{count} dịch vụ đã quá thời gian dự kiến',
  'ops.serving.insightSub.overtime': 'Kiểm tra khách và cập nhật giờ xong dự kiến.',
  'ops.serving.insight.vip': 'Quản lý nên ghé xem {name}',
  'ops.serving.insightSub.vip': 'Kiểm tra chất lượng dịch vụ cho khách VIP.',
  'ops.serviceDone.insight.delayed': '{count} khách đã làm xong, chờ thanh toán',
  'ops.serviceDone.insight.vip': '{name} là khách VIP',
  'ops.serviceDone.insightSub.vip': 'Mời khách đặt lịch lại trước khi thanh toán.',
  'ops.serving.rev.helper_assigned': 'Đã thêm thợ phụ',
  'ops.serving.rev.service_added': 'Đã thêm dịch vụ',
  'ops.serving.rev.service_done_locked': 'Đã khóa phần hoàn tất dịch vụ',
  'ops.serving.rev.service_done_reopened': 'Đã mở lại phần hoàn tất dịch vụ',
  'ops.serving.rev.service_marked_done': 'Đã đánh dấu hoàn tất dịch vụ',
  'ops.serving.rev.service_paused': 'Đã tạm dừng dịch vụ',
  'ops.serving.rev.service_removed': 'Đã bỏ dịch vụ',
  'ops.serving.rev.service_resumed': 'Đã tiếp tục dịch vụ',
  'ops.serving.rev.service_started': 'Đã bắt đầu dịch vụ',
  'ops.serving.rev.service_updated': 'Đã cập nhật dịch vụ',
  'ops.serving.rev.technician_assigned': 'Đã chỉ định thợ',
  'ops.common.hoursShort': '{n} giờ',
  'ops.liveSchedule.findPlaceholder': 'Tên hoặc #số',
  'ops.liveSchedule.ok.breakStarted': 'Đã bắt đầu giờ nghỉ.',
  'ops.liveSchedule.ok.breakEnded': 'Đã kết thúc giờ nghỉ.',
  'ops.liveSchedule.ok.timeBlocked': 'Đã chặn khung giờ.',
  'ops.liveSchedule.ok.shiftUpdated': 'Đã cập nhật ca làm.',
  'ops.liveSchedule.ok.slotBooked': 'Đã đặt khung giờ.',
  'ops.liveSchedule.todayShift': 'Ca hôm nay',
  'ops.liveSchedule.shiftReason': 'Đã cập nhật ca: {shifts} | Giờ nghỉ: {breaks}',
  'ops.sched.tab.inputs': 'Nghỉ phép & khóa lịch',
  'ops.sched.status.generated': 'Mới',
  'ops.sched.status.review_required': 'Cần xem xét',
  'ops.sched.status.review_in_progress': 'Đang xem xét',
  'ops.sched.status.accepted': 'Đã chấp nhận — sẵn sàng áp dụng',
  'ops.sched.status.partially_accepted': 'Chấp nhận một phần',
  'ops.sched.status.rejected': 'Đã từ chối',
  'ops.sched.status.needs_revision': 'Đã trả lại để chỉnh sửa',
  'ops.sched.status.customer_approval_required': 'Đang chờ khách',
  'ops.sched.status.customer_approved': 'Khách đã đồng ý — sẵn sàng áp dụng',
  'ops.sched.status.application_pending': 'Đang áp dụng…',
  'ops.sched.status.applied': 'Đã áp dụng',
  'ops.sched.status.application_failed': 'Áp dụng thất bại',
  'ops.sched.status.expired': 'Đã hết hạn',
  'ops.sched.status.superseded': 'Đã được thay thế',
  'ops.sched.status.rolled_back': 'Đã hoàn tác',
  'ops.sched.type.move_appointment': 'Dời lịch hẹn',
  'ops.sched.type.change_technician': 'Đổi thợ',
  'ops.sched.type.offer_alternate_time': 'Đề xuất giờ khác',
  'ops.sched.type.open_availability': 'Mở khung giờ trống',
  'ops.sched.type.close_availability': 'Đóng khung giờ',
  'ops.sched.type.add_buffer': 'Thêm thời gian đệm',
  'ops.sched.type.adjust_duration': 'Điều chỉnh thời lượng',
  'ops.sched.type.add_staffing': 'Thêm nhân sự',
  'ops.sched.type.move_break': 'Dời giờ nghỉ',
  'ops.sched.type.fill_gap': 'Lấp khoảng trống',
  'ops.sched.type.resolve_overbooking': 'Xử lý đặt trùng quá tải',
  'ops.sched.type.preserve_schedule': 'Giữ nguyên lịch',
  'ops.sched.metric.unusedGaps': 'Khoảng trống chưa dùng',
  'ops.sched.metric.latenessRisk': 'Nguy cơ trễ giờ',
  'ops.sched.code.proposed': 'Đã đề xuất',
  'ops.sched.code.customer_notified': 'Đã báo khách',
  'ops.sched.code.customer_approved': 'Khách đã đồng ý',
  'ops.sched.code.customer_rejected': 'Khách đã từ chối',
  'ops.sched.code.expired': 'Đã hết hạn',
  'ops.sched.code.applied': 'Đã áp dụng',
  'ops.sched.code.withdrawn': 'Đã rút lại',
  'ops.sched.code.waiting': 'Đang chờ',
  'ops.sched.code.review_required': 'Cần xem xét',
  'ops.sched.code.approved': 'Đã duyệt',
  'ops.sched.code.rejected': 'Đã từ chối',
  'ops.sched.code.superseded': 'Đã được thay thế',
  'ops.sched.code.pending': 'Đang chờ',
  'ops.sched.code.cancelled': 'Đã hủy',
  'ops.sched.code.started': 'Đang chạy',
  'ops.sched.code.completed': 'Hoàn tất',
  'ops.sched.code.failed': 'Thất bại',
  'ops.sched.code.info': 'Thông tin',
  'ops.sched.code.warning': 'Cảnh báo',
  'ops.sched.code.critical': 'Nghiêm trọng',
  'ops.sched.code.data_insufficient': 'Chưa đủ dữ liệu',
  'ops.sched.code.adequately_staffed': 'Đủ nhân sự',
  'ops.sched.code.slightly_understaffed': 'Hơi thiếu nhân sự',
  'ops.sched.code.understaffed': 'Thiếu nhân sự',
  'ops.sched.code.severely_understaffed': 'Thiếu nhân sự nghiêm trọng',
  'ops.sched.code.DOUBLE_BOOK': 'Thợ bị đặt trùng giờ',
  'ops.sched.code.BEYOND_SHIFT': 'Ngoài ca làm của thợ',
  'ops.sched.code.OUTSIDE_HOURS': 'Ngoài giờ mở cửa',
  'ops.sched.code.STATION_OVERBOOK': 'Quá nhiều khách ở một bàn',
  'ops.sched.code.UNDERSTAFFED': 'Thiếu nhân sự',
  'ops.sched.code.sms': 'Tin nhắn SMS',
  'ops.sched.code.phone': 'Điện thoại',
  'ops.sched.code.email': 'Email',
  'ops.sched.code.link': 'Đường liên kết',
  'ops.sched.code.weights': 'Trọng số chấm điểm',
  'ops.sched.code.automationEnabled': 'Tự động hóa',
  'ops.sched.code.allowedAutoActions': 'Thao tác tự động an toàn',
  'ops.sched.safe.open_empty_slot': 'Mở khung giờ trống để đặt lịch',
  'ops.sched.safe.close_unavailable_tech': 'Đóng khung giờ của thợ vắng mặt',
  'ops.sched.safe.recalc_estimated_end': 'Tính lại giờ xong dự kiến',
  'ops.sched.safe.add_internal_warning': 'Thêm cảnh báo nội bộ',
  'ops.sched.safe.update_internal_capacity': 'Cập nhật công suất nội bộ',
  'ops.sched.safe.apply_preapproved_gap_rule': 'Áp dụng quy tắc khoảng trống đã duyệt',
  'ops.sched.num.confidenceThreshold': 'Độ tin cậy để tự động (0–1)',
  'ops.sched.num.gapMinServiceMin': 'Khoảng trống nhỏ nhất có ích (phút)',
  'ops.sched.num.largeBlockMin': 'Khoảng trống lớn (phút)',
  'ops.sched.num.utilizationTargetPct': 'Mục tiêu công suất (%)',
  'ops.sched.num.bookingIntervalMin': 'Bước đặt lịch (phút)',
  'ops.sched.num.minLeadTimeMin': 'Thời gian báo trước tối thiểu (phút)',
  'ops.sched.num.maxHorizonDays': 'Xem trước (ngày)',
  'ops.sched.num.recommendationTtlMin': 'Thời hạn của gợi ý (phút)',
  'ops.sched.num.proposalTtlHours': 'Thời hạn đề xuất cho khách (giờ)',
  'ops.sched.weight.preferredTimeProximity': 'Gần giờ khách muốn',
  'ops.sched.weight.waitReduction': 'Ít phải chờ',
  'ops.sched.weight.gapFit': 'Lấp khoảng trống',
  'ops.sched.weight.preferencePreservation': 'Giữ đúng ý khách',
  'ops.sched.weight.utilization': 'Công suất',
  'ops.sched.weight.fragmentation': 'Ít lịch bị chia vụn',
  'ops.sched.weight.overtimeAvoidance': 'Tránh làm quá giờ',
  'ops.sched.weight.workloadBalance': 'Cân bằng khối lượng việc',
  'ops.sched.weight.idleReduction': 'Ít thời gian rảnh',
  'ops.sched.inheritsLayer': '(kế thừa)',
  'ops.sched.inheritOnOff': 'Kế thừa ({value})',
  'ops.sched.layer.salon': 'toàn tiệm',
  'ops.sched.layer.location': 'chi nhánh',
  'ops.sched.kind.duration': 'Thời lượng dịch vụ',
  'ops.sched.kind.staffing': 'Mức đủ nhân sự',
  'ops.sched.kind.availability': 'Mở / đóng khung giờ',
  'ops.sched.insight.open': 'Mở {when}',
  'ops.sched.insight.close': 'Đóng {when}',
  'ops.sched.ok.approved': 'Đã duyệt.',
  'ops.sched.ok.rejected': 'Đã từ chối.',
  'ops.sched.ok.applied': 'Đã áp dụng.',
  'ops.sched.ok.timeOffAdded': 'Đã thêm ngày nghỉ.',
  'ops.sched.ok.timeOffRemoved': 'Đã xóa ngày nghỉ.',
  'ops.sched.ok.unlocked': 'Đã mở khóa.',
  'ops.sched.ok.locked': 'Đã khóa — hệ thống tối ưu sẽ không đụng tới.',
  'ops.sched.ok.profileSaved': 'Đã lưu {name}.',
  'ops.sched.ok.runDone': 'Xong — {recs} gợi ý, {gaps} khoảng trống, {conflicts} xung đột.',
  'ops.sched.ok.explained': 'Đã cập nhật lời giải thích.',
  'ops.sched.ok.returned': 'Đã trả lại để chỉnh sửa.',
  'ops.sched.ok.appliedCalendar': 'Đã áp dụng qua lịch đặt hẹn.',
  'ops.sched.ok.appliedRetry': 'Đã áp dụng khi thử lại.',
  'ops.sched.ok.rolledBack': 'Đã hoàn tác — lịch hẹn trở về như cũ.',
  'ops.sched.ok.resent': 'Đã gửi lại đề xuất cho khách.',
  'ops.sched.ok.resentShort': 'Đã gửi lại cho khách.',
  'ops.sched.ok.customerApproved': 'Đã ghi nhận: khách đồng ý.',
  'ops.sched.ok.customerDeclined': 'Đã ghi nhận: khách từ chối — giữ nguyên lịch cũ.',
  'ops.sched.ok.customerDeclinedLong': 'Đã ghi nhận: khách từ chối — giữ nguyên lịch hẹn cũ.',
  'ops.sched.explain.template': 'mẫu',
  'ops.sched.explain.aiEnglish': 'Giải thích do AI viết (tiếng Anh):',
  'ops.sched.explain.aiVietnamese': 'Giải thích do AI viết (tiếng Việt):',
  'ops.sched.runBy.automation': 'tự động',
  'ops.sched.err.generic': 'Không thực hiện được.',
  'ops.sched.err.findOptions': 'Không tìm được lựa chọn.',
  'ops.sched.err.releaseHold': 'Không hủy giữ chỗ được.',
  'ops.sched.err.timeOff': 'Không tải được ngày nghỉ.',
  'ops.sched.err.insights': 'Không tải được phân tích.',
  'ops.sched.err.runs': 'Không tải được các lần chạy hôm nay.',
  'ops.sched.err.runFailed': 'Lần chạy thất bại.',
  'ops.sched.err.approvals': 'Không tải được các phê duyệt của khách.',
  'ops.sched.day.title': "Lịch trong ngày của Thợ — {d}",
  'ops.sched.day.shift': "Ca làm",
  'ops.sched.day.breaks': "Giờ nghỉ",
  'ops.sched.day.empty': "Không có lịch hẹn.",
  'ops.sched.day.thisOne': "Lịch hẹn này",
  'ops.sched.day.locked': "Đã khóa",
  'ops.sched.day.gaps': "Khoảng trống",
  'ops.sched.day.min': "phút",
  'ops.sched.day.prev': "Trước đó: {s}–{e} (trống {g} phút)",
  'ops.sched.day.noPrev': "Không có lịch hẹn trước",
  'ops.sched.day.next': "Sau đó: {s}–{e} (trống {g} phút)",
  'ops.sched.day.noNext': "Không có lịch hẹn sau",
  'ops.sched.day.change': "Thay đổi này mở {ng} khoảng trống, lấp {cg}, thêm {nc} xung đột và giải quyết {rc}.",
  'ops.sched.day.note': "Đọc từ lịch ngay lúc này — chưa thay đổi gì cho đến khi đề xuất được chấp nhận và áp dụng.",
  'ops.sched.err.recommendation': 'Không tải được gợi ý này.',
  'ops.sched.err.recommendations': 'Không tải được các gợi ý.',
  'ops.sched.err.create': 'Không tạo được gợi ý.',
  'ops.sched.err.run': 'Không tải được lần chạy.',
  'ops.sched.err.history': 'Không tải được lịch sử chạy.',
  'ops.sched.err.save': 'Không lưu được.',
  'ops.sched.err.usage': 'Không tải được mức sử dụng.',
  'ops.sched.err.export': 'Xuất dữ liệu thất bại.',
  'ops.sched.code.before_first': 'Trước lịch hẹn đầu tiên',
  'ops.sched.code.after_last': 'Sau lịch hẹn cuối cùng',
  'ops.sched.code.between_appointments': 'Giữa các lịch hẹn',
  'ops.sched.code.too_small_for_service': 'Quá ngắn cho mọi dịch vụ',
  'ops.sched.code.large_unused': 'Khoảng trống lớn chưa dùng',
  'ops.sched.code.staff_recorded': 'Nhân viên ghi nhận',
  'ops.sched.code.cancellation': 'Do lịch bị hủy',
  'ops.sched.code.double_booking': 'Đặt trùng giờ',
  // checkout payout preview (Oct 27 2026): the server's roleCode / nameCode
  'ops.checkout.payout.role.primary': 'Thợ chính',
  'ops.checkout.payout.role.assist': 'Thợ phụ',
  'ops.checkout.payout.name.technician': 'Thợ',
  'ops.checkout.payout.name.unassigned': 'Chưa chỉ định',
  // Tech Queue assignment-source mix (Oct 27 2026): the server's slice code
  'ops.techQueue.sourceMix.appointment': 'Lịch hẹn',
  'ops.techQueue.sourceMix.walk_in': 'Khách vãng lai',
  'ops.techQueue.sourceMix.ai': 'AI phân công',
  'ops.techQueue.sourceMix.manual': 'Lễ tân phân công',
  // Service Done one-screen mandate (Oct 28 2026)
  'ops.serviceDone.insight.quality': '{count} vấn đề chất lượng đang giữ thanh toán',
  'ops.serviceDone.staffSummary': '{available} rảnh · {finishing} sắp xong · {busy} bận · {onBreak} nghỉ — hiện {shown}/{onDuty} đang làm',
  'ops.serviceDone.notEnoughData': 'Chưa đủ dữ liệu',
  'ops.serviceDone.manageTitle': 'Quản lý {guest}',
  'ops.serviceDone.qualityTitle': 'Kiểm tra chất lượng / khách xác nhận',
  'ops.serviceDone.issueFound': 'Có vấn đề',
  'ops.serviceDone.qualityNote': 'Ghi chú (không bắt buộc khi duyệt, bắt buộc khi mở lại)',
  'ops.serviceDone.notesTitle': 'Ghi chú dịch vụ',
  'ops.serviceDone.internalNotes': 'Ghi chú nội bộ',
  'ops.serviceDone.guestNotes': 'Ghi chú khách xem được',
  'ops.serviceDone.saveNotes': 'Lưu ghi chú',
  'ops.serviceDone.notesSaved': 'Đã lưu ghi chú.',
  'ops.serviceDone.reopenTitle': 'Mở lại dịch vụ (sửa)',
  'ops.serviceDone.reopenHint': 'Mở lại sẽ đưa lượt khách về Đang phục vụ kèm lý do của bạn. Phần việc đã xong vẫn được giữ trong lịch sử.',
  'ops.serviceDone.upsellTitle': 'Thêm dịch vụ hoặc dịch vụ kèm',
  'ops.serviceDone.upsellHint': 'Dịch vụ thêm sau khi xong phải qua Đang phục vụ: mở lại lượt khách kèm lý do, thêm dịch vụ ở đó theo giá danh mục và đúng thợ đã làm, rồi hoàn tất lại.',
  'ops.serviceDone.reopenAndAdd': 'Mở lại và đến Đang phục vụ',
  'ops.serviceDone.upsellPaid': 'Lượt khách này đã thanh toán — hãy tạo giao dịch mới ở Thanh toán.',
  'ops.serviceDone.summaryTitle': 'Tóm tắt dịch vụ',
  'ops.serviceDone.notAReceipt': 'Không phải hóa đơn đã thanh toán — hóa đơn cuối cùng do Thanh toán cấp sau khi trả tiền.',
  'ops.serviceDone.tipEntered': 'Tiền tip đã nhập (chưa thu)',
  'ops.serviceDone.balanceTitle': 'Tự cân bằng chuyển giao',
  'ops.serviceDone.balanceHint': 'Gợi ý: khách đã được duyệt chất lượng và chưa ở quầy lễ tân, cũ nhất trước. Không có gì được chuyển cho đến khi bạn xác nhận.',
  'ops.serviceDone.balanceConfirm': 'Chuyển {count} sang Thanh toán',
  'ops.serviceDone.balanceNone': 'Hiện chưa có khách nào sẵn sàng để chuyển.',
  'ops.serviceDone.balanceResult': '{moved} đã chuyển sang Thanh toán · {already} đã ở đó · {refused} bị từ chối',
  'ops.serviceDone.allInsights': 'Tất cả gợi ý',
  'ops.serviceDone.viewAll': 'Xem tất cả ({count})',
  'ops.serviceDone.fullQueueTitle': 'Hàng chờ dịch vụ đã xong — tất cả khách',
  'ops.serviceDone.fullBoardTitle': 'Bảng Hoàn tất dịch vụ — mọi giai đoạn',
  'ops.serviceDone.selectGuestFirst': 'Hãy chọn một khách trước.',
  'ops.serviceDone.moved': 'Đã chuyển sang Thanh toán.',
  'ops.serviceDone.alreadyMoved': 'Đã ở Thanh toán — không có gì thay đổi.',
  'ops.serviceDone.guestDetailTitle': 'Chi tiết hoàn tất của khách',
  'ops.serviceDone.lineTech': 'Thợ làm',
  // Serving mandate (Oct 28 2026) — one-screen Serving board
  'ops.serving.subtitle': 'Sàn phục vụ trực tiếp — khách nào đang làm, sắp xong và sẵn sàng hoàn tất dịch vụ.',
  'ops.serving.staffSummary': '{available} rảnh · {finishing} sắp xong · {busy} đang bận · {onBreak} đang nghỉ — {onDuty} đang trong ca',
  'ops.serving.ofOnDuty': 'trên {n} thợ trong ca',
  'ops.serving.selectGuest': 'Hãy chọn một khách trên sàn trước.',
  'ops.serving.noLegalMove': 'Hiện chưa thể chuyển bước cho khách này.',
  'ops.serving.moveStageTitle': 'Chuyển {name} sang…',
  'ops.serving.started': 'Đã bắt đầu dịch vụ.',
  'ops.serving.alreadyStarted': 'Khách đã đang được phục vụ — không có gì thay đổi.',
  'ops.serving.markedReady': 'Sẵn sàng hoàn tất dịch vụ.',
  'ops.serving.alreadyReady': 'Khách đã ở Hoàn tất dịch vụ — không có gì thay đổi.',
  'ops.serving.sent': 'Đã chuyển sang Hoàn tất dịch vụ.',
  'ops.serving.alreadySent': 'Khách đã ở Hoàn tất dịch vụ — không có gì thay đổi.',
  'ops.serving.paused': 'Đã tạm dừng dịch vụ.',
  'ops.serving.resumed': 'Đã tiếp tục dịch vụ.',
  'ops.serving.cannotStart': 'Khách này chưa sẵn sàng để bắt đầu.',
  'ops.serving.upsellTitle': 'Thêm dịch vụ bán thêm',
  'ops.serving.upsellSub': 'Giá lấy từ danh mục của tiệm. Dịch vụ thêm do thợ bạn chọn thực hiện.',
  'ops.serving.addOnTab': 'Dịch vụ thêm',
  'ops.serving.retailTab': 'Sản phẩm bán lẻ',
  'ops.serving.noAddOns': 'Danh mục chưa có dịch vụ thêm nào.',
  'ops.serving.addedAddOn': 'Đã thêm {name}.',
  'ops.serving.addOnDuplicate': 'Dịch vụ thêm này đã được thêm — không có gì thay đổi.',
  'ops.serving.doneBy': 'Thợ thực hiện',
  'ops.serving.updateTitle': 'Gửi cập nhật',
  'ops.serving.updateSub': 'Gửi cập nhật tình trạng cho {name}. Không thay đổi dịch vụ.',
  'ops.serving.kind.status': 'Cập nhật dịch vụ',
  'ops.serving.kind.running_late': 'Đang trễ một chút',
  'ops.serving.kind.almost_done': 'Sắp xong',
  'ops.serving.kind.ready': 'Đã làm xong',
  'ops.serving.channel.app': 'Ứng dụng khách hàng',
  'ops.serving.channel.sms': 'Tin nhắn',
  'ops.serving.updateSent': 'Đã gửi cập nhật vào ứng dụng của khách.',
  'ops.serving.alertTitle': 'Gửi thông báo cho thợ',
  'ops.serving.alertSub': 'Một thông báo trong ứng dụng của thợ. Không thay đổi dịch vụ nào.',
  'ops.serving.alertTech': 'Thợ',
  'ops.serving.alertMessage': 'Nội dung',
  'ops.serving.alertSend': 'Gửi thông báo',
  'ops.serving.alertSent': 'Đã gửi thông báo cho {name}.',
  'ops.serving.balanceTitle': 'Cân bằng sàn tự động',
  'ops.serving.balanceSub': 'Chỉ là đề xuất — không có gì thay đổi cho đến khi bạn chỉ định. Kỹ năng, chi nhánh và lịch được kiểm tra lại khi chỉ định.',
  'ops.serving.balanceRow': '{guest}: {from} → {to}',
  'ops.serving.balanceNone': 'Hiện không cần điều phối lại.',
  'ops.serving.balanceAssigned': 'Đã chỉ định {guest} cho {to}.',
  'ops.serving.balanceReason.technician_busy': 'Thợ còn đang làm cho khách khác',
  'ops.serving.balanceReason.unassigned': 'Chưa chỉ định thợ',
  'ops.serving.floorTitle': 'Sàn phục vụ',
  'ops.serving.loadError': 'Không tải được sàn phục vụ.',
  'ops.serving.lineDone': 'Xong',
  'ops.serving.started_at': 'Bắt đầu',
  'ops.serving.estimated': 'Dự kiến {min} phút',
  'ops.serving.lateBy': 'Trễ {min} phút',
  'ops.serving.delayedTag': 'Bị trễ',
  'ops.insight.balance': 'Cân bằng',
  'ops.insight.open': 'Mở',
  'ops.serving.insight.balance': '{count} khách đang chờ thợ đang bận',
  'ops.serving.insightSub.balance': 'Có thợ đang rảnh — xem Cân bằng sàn.',
  'ops.serving.insight.ready': '{count} khách sẵn sàng hoàn tất dịch vụ',
  'ops.serving.insightSub.ready': 'Chuyển khách đi để bắt đầu thanh toán.',
  'ops.serving.insight.imbalance': '{name} có {count} dịch vụ đang mở',
  'ops.serving.insightSub.imbalance': 'Cân nhắc chia việc cho một thợ đang rảnh.',
  'ops.serving.insight.waiting': '{count} khách sẵn sàng bắt đầu',
  'ops.serving.insightSub.waiting': 'Bắt đầu dịch vụ khi thợ đã ở trạm.',
  'ops.serving.alertPickTech': 'Hãy chọn thợ trước.',
  // Customer Queue one-screen mandate (Oct 28 2026) — A32
  'ops.queue.selectGuest': 'Hãy chọn một khách trong hàng chờ trước.',
  'ops.queue.insight.longWait': '{name} đã chờ {minutes} phút',
  'ops.queue.insightSub.longWait': 'Lâu hơn thời gian làm dịch vụ trung bình.',
  'ops.queue.insight.unassigned': '{count} khách đang chờ thợ · {free} thợ rảnh',
  'ops.queue.insightSub.unassigned': 'Xem Cân bằng tự động — chưa chỉ định ai cho đến khi bạn xác nhận.',
  'ops.queue.insight.noShow': '{count} khách có hẹn đang chờ lâu hơn dự kiến',
  'ops.queue.insightSub.noShow': 'Hỏi thăm khách trước khi khách bỏ về.',
  'ops.queue.priorityCounts': '{urgent} khẩn · {vip} VIP · {high} cao · {normal} thường',
  'ops.queue.priorityReason': 'Lý do (cần khi cho khách lên trước)',
  'ops.queue.addSub': 'Ghi nhận khách một lần — bấm lại cũng không thêm khách hai lần.',
  'ops.queue.noteTitle': 'Ghi chú cho {name}',
  'ops.queue.noteSaved': 'Đã lưu ghi chú.',
  'ops.queue.noPhone': 'Khách này chưa có số điện thoại.',
  'ops.queue.upsellTitle': 'Thêm dịch vụ cho {name}',
  'ops.queue.upsellSub': 'Giá lấy từ danh mục. Dịch vụ được thêm vào lượt này trước khi bắt đầu.',
  'ops.queue.alertSent': 'Đã gửi thông báo thời gian chờ vào ứng dụng của {name}.',
  'ops.queue.alertNoApp': '{name} chưa dùng ứng dụng khách hàng — hãy báo trực tiếp tại quầy.',
  'ops.queue.needTech': 'Hãy chỉ định thợ trước khi bắt đầu dịch vụ.',
  'ops.queue.fullBoardTitle': 'Bảng luồng hàng chờ — tất cả khách',
  'ops.queue.fullQueueTitle': 'Hàng chờ khách trực tiếp — tất cả khách',
  'ops.queue.waitDelayed': 'Chờ lâu hơn thời gian dịch vụ trung bình',
  'ops.queue.projected': 'Dự kiến — chưa thu',
  'ops.queue.sentToTech': 'Đã chuyển sang hàng chờ thợ.',
  'ops.queue.alreadySentToTech': 'Khách đã ở hàng chờ thợ — không có gì thay đổi.',
  'ops.queue.inLine': 'Thứ {n} trong hàng',
  // Overview 27-inch one-screen mandate (Oct 28 2026) — A33
  'ops.overview.moreCount': '+{count} khác',
  'ops.overview.paidToday': '{count} vé đã thanh toán hôm nay',
  'ops.overview.onBreak': '{count} đang nghỉ',
  'ops.overview.leaderboard': 'Xem bảng xếp hạng',
  'ops.overview.messagesLocked': 'Tin nhắn nằm trong Hộp thư, dành cho nhân viên có quyền xem liên lạc.',
  'ops.overview.ofTotal': '{shown} trên {total}',
  'ops.overview.insight.long_wait': 'Thời gian chờ bất thường',
  'ops.overview.insightV.long_wait': 'Chờ lâu nhất {minutes} phút · {waiting} khách đang chờ',
  'ops.overview.insight.unassigned': 'Khách đang chờ thợ',
  'ops.overview.insightV.unassigned': '{count} chưa có thợ · {free} thợ rảnh',
  'ops.overview.insight.checkout_backlog': 'Khách sẵn sàng thanh toán',
  'ops.overview.insightV.checkout_backlog': '{count} khách đang chờ thanh toán',
  'ops.overview.insight.inventory_low': 'Hàng tồn kho thấp',
  'ops.overview.insightV.inventory_low': '{count} sản phẩm đã tới mức đặt lại',
  'ops.overview.insight.staff_on_break': 'Nhân viên đang nghỉ',
  'ops.overview.insightV.staff_on_break': '{count} trên {onDuty} người trong ca',
  'ops.overview.insight.high_revenue_service': 'Dịch vụ doanh thu cao',
  'ops.overview.insight.booking_opportunity': 'Cơ hội nhận lịch hẹn',
  'ops.overview.insightV.booking_opportunity': 'Hôm nay không còn lịch hẹn — còn chỗ cho khách vãng lai và đặt lịch trực tuyến',
  // moved from the frozen catalog.vi.ts (Nov 6 2026) — keys unchanged
  'pos.copilot_conflict_check_failed': 'Chưa kiểm tra trùng lịch được — chưa có gì được quyết định. Hãy thử lại.',
  'pos.copilot_phone_unavailable': 'Không hiển thị được cuộc gọi AI: lễ tân AI chưa được thiết lập ở đây hoặc không đọc được cuộc gọi.',
  'pos.copilot_choose_branch_for_service': 'Hãy chọn chi nhánh trước — dịch vụ và giá được đặt theo từng chi nhánh.',
  "sox.how.btn": "Cách hoạt động",
  "sox.how.title": "Cách Tối ưu lịch hẹn hoạt động",
  "sox.how.1": "Hệ thống đọc lịch thật, lịch làm của thợ, kỹ năng và thời lượng dịch vụ — không bịa ra gì.",
  "sox.how.2": "Hệ thống gợi ý giờ tốt hơn, lấp khoảng trống và sửa trùng lịch. Gợi ý không tự thay đổi lịch hẹn đã xác nhận.",
  "sox.how.3": "Khi cần khách đồng ý, gợi ý được gửi cho khách trước; chỉ câu trả lời của khách mới dời lịch.",
  "sox.how.4": "Tối ưu tự động luôn tắt trừ khi chủ tiệm bật, và khi bật vẫn theo quy định và giới hạn của tiệm.",
  "sox.how.5": "Mọi gợi ý, phê duyệt và thay đổi đều lưu trong Lịch sử để biết ai quyết định gì và khi nào.",
  "dfx.checkedAt": "kiểm tra lúc {at}",
  "dfx.checking": "Đang kiểm tra — chỉ đọc…",
  "dfx.clear": "Xóa bộ lọc",
  "dfx.count": "{n} thiết bị",
  "dfx.f.dateField": "Theo ngày",
  "dfx.f.sort": "Sắp xếp",
  "dfx.f.status": "Trạng thái",
  "dfx.kioskSupport": "Máy tự check-in do bộ phận hỗ trợ AIPowerSalon cài đặt và thay đổi.",
  "dfx.loading": "Đang tải…",
  "dfx.noBranch": "Chưa gán chi nhánh",
  "dfx.noMatch": "Không có thiết bị nào khớp bộ lọc.",
  "dfx.notConfigured": "Chưa cài đặt",
  "dfx.range": "Từ – Đến",
  "dfx.readOnly": "Chỉ đọc: không ghép nối, không gửi tín hiệu, không thu hồi, không thay đổi gì.",
  "dfx.refresh": "Làm mới",
  "dfx.rows": "Số dòng",
  "dfx.search": "Tìm",
  "dfx.searchPh": "Thiết bị, chi nhánh, quầy hoặc mã",
  "dfx.unnamed": "Thiết bị chưa đặt tên",
  "dfx.view": "Chi tiết",
  "dfx.tab.devices": "Thiết bị",
  "dfx.tab.history": "Lịch sử",
  "dfx.tab.printers": "Máy in",
  "dfx.tab.receipts": "Hóa đơn điện tử",
  "dfx.list.devices": "Thiết bị đã đăng ký",
  "dfx.list.assignments": "Phân công thiết bị",
  "dfx.noun.device": "thiết bị",
  "dfx.manage.registers": "Quản lý quầy & màn hình",
  "dfx.manage.displays": "Quản lý màn hình khách",
  "dfx.manage.terminals": "Mở máy thanh toán",
  "dfx.kpi.attention": "Cần xử lý",
  "dfx.kpi.attentionSub": "mất kết nối, lâu không phản hồi hoặc chưa cài xong",
  "dfx.kpi.unassigned": "Chưa phân công",
  "dfx.kpi.assigned": "Đã phân công",
  "dfx.kpi.assignedSub": "đã gán chi nhánh và quầy",
  "dfx.kpi.retiredSub": "không tính {n} đã ngưng / thu hồi",
  "dfx.kpi.rpos.registered": "Quầy đã đăng ký",
  "dfx.kpi.rpos.online": "Quầy đang hoạt động",
  "dfx.kpi.rpos.onlineSub": "màn hình của quầy đã báo trong 75 giây qua",
  "dfx.kpi.rpos.unassignedSub": "chưa ghép màn hình khách nào",
  "dfx.kpi.kiosk.registered": "Máy tự check-in đã đăng ký",
  "dfx.kpi.kiosk.online": "Đang kết nối",
  "dfx.kpi.kiosk.onlineSub": "đã báo trong 5 phút qua",
  "dfx.kpi.kiosk.today": "Check-in hôm nay",
  "dfx.kpi.kiosk.todaySub": "khách đã check-in xong trên máy",
  "dfx.kpi.kiosk.unassignedSub": "chưa gán chi nhánh",
  "dfx.kpi.tablet.registered": "Máy tính bảng đã đăng ký",
  "dfx.kpi.tablet.online": "Đang hoạt động",
  "dfx.kpi.tablet.onlineSub": "vừa báo gần đây (màn hình 75 giây · máy check-in 5 phút)",
  "dfx.kpi.tablet.unassignedSub": "chưa gán quầy hoặc chi nhánh",
  "dfx.kpi.assign.registered": "Thiết bị đã đăng ký",
  "dfx.kpi.assign.online": "Đang kết nối",
  "dfx.kpi.assign.onlineSub": "đang báo tín hiệu",
  "dfx.kpi.assign.unassignedSub": "chưa gán quầy hoặc chi nhánh",
  "dfx.kpi.printers": "Máy in hóa đơn",
  "dfx.kpi.emailToday": "Hóa đơn email hôm nay",
  "dfx.kpi.smsToday": "Hóa đơn SMS hôm nay",
  "dfx.kpi.noneToday": "Không lấy hóa đơn hôm nay",
  "dfx.kpi.todaySub": "khách chọn trên màn hình",
  "dfx.kpi.failedSub": "{n} không gửi được",
  "dfx.check.rpos": "Kiểm tra hệ thống quầy lễ tân",
  "dfx.check.kiosk": "Kiểm tra hệ thống máy check-in",
  "dfx.check.tablet": "Kiểm tra hệ thống máy tính bảng",
  "dfx.check.receipt": "Kiểm tra hệ thống hóa đơn",
  "dfx.check.assign": "Kiểm tra phân công",
  "dfx.check.health": "Kiểm tra tình trạng thiết bị",
  "dfx.empty.rpos": "Quầy lễ tân là một quầy thu ngân. Thêm quầy và ghép màn hình khách cho từng quầy ở trang Màn hình khách.",
  "dfx.empty.kiosk": "Máy tự check-in do bộ phận hỗ trợ AIPowerSalon cài đặt. Liên hệ hỗ trợ để thêm máy cho chi nhánh này.",
  "dfx.empty.tablet": "iPad và máy tính bảng Android sẽ hiện ở đây sau khi được ghép làm màn hình khách hoặc cài làm máy check-in.",
  "dfx.empty.assign": "Thiết bị sẽ hiện ở đây khi ghép màn hình, cài máy check-in hoặc thêm máy thanh toán.",
  "dfx.empty.health": "Thiết bị sẽ hiện ở đây khi ghép màn hình, cài máy check-in hoặc thêm máy thanh toán.",
  "dfx.foot.rpos": "Quầy là các quầy thu ngân của bạn. Quầy hoạt động khi màn hình riêng của quầy báo tín hiệu.",
  "dfx.foot.kiosk": "Trạng thái máy lấy từ tín hiệu của chính máy. Khách check-in vào cùng hàng chờ với quầy lễ tân.",
  "dfx.foot.tablet": "Máy tính bảng dùng làm màn hình khách hoặc máy check-in, lấy từ danh sách riêng của từng loại.",
  "dfx.foot.assign": "Vị trí của từng màn hình, máy check-in và máy thanh toán. Đổi vị trí trên trang riêng của thiết bị.",
  "dfx.foot.health": "Trạng thái theo lần báo gần nhất của từng thiết bị. Máy thanh toán chưa từng phản hồi hiện là chưa kiểm tra, không bao giờ là đã kết nối.",
  "dfx.h.by": "Người thực hiện",
  "dfx.h.choice": "Hóa đơn",
  "dfx.h.device": "Thiết bị",
  "dfx.h.event": "Sự kiện",
  "dfx.h.result": "Kết quả",
  "dfx.h.searchPh": "Sự kiện hoặc người",
  "dfx.h.receiptPh": "Số phiếu, loại hóa đơn hoặc quầy",
  "dfx.h.theKiosk": "Máy check-in",
  "dfx.h.ticket": "Phiếu",
  "dfx.h.when": "Thời gian",
  "dfx.h.empty": "Không có lịch sử trong khoảng này.",
  "dfx.h.noReceipts": "Không có hóa đơn điện tử trong khoảng này.",
  "dfx.st.all": "Tất cả",
  "dfx.st.online": "Đang hoạt động",
  "dfx.st.offline": "Mất kết nối",
  "dfx.st.attention": "Cần xử lý",
  "dfx.st.pending": "Chưa cài xong",
  "dfx.st.unassigned": "Chưa phân công",
  "dfx.st.disabled": "Đã tắt",
  "dfx.st.unknown": "Chưa kiểm tra",
  "dfx.st.retired": "Đã ngưng",
  "dfx.st.revoked": "Đã thu hồi",
  "dfx.st.maintenance": "Bảo trì",
  "dfx.sort.newest": "Mới nhất trước",
  "dfx.sort.last_seen": "Lần báo gần nhất",
  "dfx.sort.name": "Tên A–Z",
  "dfx.sort.status": "Cần xử lý trước",
  "dfx.date.created": "Ngày thêm",
  "dfx.date.last_seen": "Lần báo gần nhất",
  "dfx.date.updated": "Ngày cập nhật",
  "dfx.reason.NO_DEDICATED_DISPLAY": "Quầy chưa ghép màn hình khách",
  "dfx.reason.REGISTER_DISPLAY_NOT_REPORTING": "Màn hình của quầy lâu không báo tín hiệu",
  "dfx.reason.KIOSK_LINK_EXPIRED": "Liên kết máy check-in đã hết hạn — nhờ hỗ trợ gia hạn",
  "dfx.reason.NEVER_CONNECTED": "Chưa từng kết nối",
  "dfx.reason.NOT_HEARD_FROM": "Lâu không phản hồi",
  "dfx.reason.NO_BRANCH": "Chưa gán chi nhánh",
  "dfx.reason.PAIRING_NOT_FINISHED": "Chưa ghép nối xong",
  "dfx.reason.NO_REGISTER": "Chưa gán quầy",
  "dfx.reason.TERMINAL_NOT_TESTED": "Chưa kiểm tra — bấm Kiểm tra kết nối",
  "dfx.reason.TERMINAL_OFFLINE": "Mất kết nối — kiểm tra nguồn và mạng",
  "dfx.hs.READY": "Sẵn sàng",
  "dfx.hs.WARNING": "Cảnh báo",
  "dfx.hs.FAILED": "Lỗi",
  "dfx.hs.NOT_CONFIGURED": "Chưa cài đặt",
  "dfx.hk.registry_readable": "Đọc được danh sách thiết bị",
  "dfx.hk.devices_registered": "Thiết bị đã đăng ký",
  "dfx.hk.devices_reporting": "Thiết bị không báo tín hiệu",
  "dfx.hk.pairing_finished": "Chưa cài xong",
  "dfx.hk.assignments_complete": "Thiết bị chưa có vị trí",
  "dfx.hk.digital_receipts": "Hóa đơn điện tử hôm nay",
  "dfx.hk.receipt_failures_today": "Hóa đơn không gửi được hôm nay",
  "dfx.hk.history_readable": "Đọc được lịch sử",
  "dfx.hk.no_side_effects": "Chỉ đọc",
  "dfx.choice.email": "Email",
  "dfx.choice.sms": "SMS",
  "dfx.choice.none": "Không lấy hóa đơn",
  "dfx.rs.sending": "Đang gửi",
  "dfx.rs.sent": "Đã gửi",
  "dfx.rs.skipped": "Không cần",
  "dfx.rs.unavailable": "Không khả dụng",
  "dfx.rs.failed": "Không gửi được",
  "dfx.ent.customer_display": "Màn hình khách",
  "dfx.ent.pos_station": "Quầy",
  "dfx.ent.payment_terminal": "Máy thanh toán",
  "dfx.ent.pos_payment_terminal": "Máy thanh toán",
  "dfx.ent.kiosk": "Máy check-in",
  "dfx.ent.device": "Thiết bị",
  "dfx.fact.displays": "Màn hình khách",
  "dfx.fact.terminals": "Máy thanh toán",
  "dfx.fact.role": "Dùng làm",
  "dfx.fact.appVersion": "Phiên bản ứng dụng",
  "dfx.fact.mode": "Chế độ màn hình",
  "dfx.fact.screen": "Kích thước màn hình",
  "dfx.fact.operational": "Trạng thái máy",
  "dfx.fact.hsnMasked": "Số sê-ri (HSN)",
  "dfx.val.kiosk": "Máy check-in",
  "dfx.val.customer_display": "Màn hình khách",
  "dfx.ev.customer_display_paired": "Đã ghép màn hình",
  "dfx.ev.customer_display_revoked": "Đã gỡ màn hình",
  "dfx.ev.customer_display_updated": "Đã đổi màn hình",
  "dfx.ev.pos_station_created": "Đã thêm quầy",
  "dfx.ev.pos_station_updated": "Đã đổi tên quầy",
  "dfx.ev.pos_station_retired": "Đã ngưng quầy",
  "dfx.ev.heartbeat": "Máy check-in báo tín hiệu",
  "dfx.ev.check_in_completed": "Khách đã check-in",
  "lgx.subtitle": "Sự kiện thiết bị và tích hợp, mới nhất trước. Chỉ xem.",
  "lgx.toHealth": "Tình trạng thiết bị",
  "lgx.kpi.events": "Sự kiện trong khoảng",
  "lgx.kpi.warnings": "Cảnh báo",
  "lgx.kpi.errors": "Lỗi",
  "lgx.kpi.device": "Sự kiện thiết bị",
  "lgx.kpi.integration": "Sự kiện tích hợp",
  "lgx.category": "Loại",
  "lgx.severity": "Mức độ",
  "lgx.source": "Nguồn",
  "lgx.message": "Nội dung",
  "lgx.events": "Sự kiện",
  "lgx.count": "{n} sự kiện",
  "lgx.related": "Bản ghi liên quan",
  "lgx.correlation": "Mã liên kết",
  "lgx.foot": "Sự kiện thiết bị lấy từ hệ thống quản lý từng thiết bị (màn hình, quầy, máy thanh toán, máy check-in); sự kiện tích hợp lấy từ việc gửi webhook và triển khai. Không bao giờ ghi số thẻ hay thông tin bí mật.",
  "cdx.check": "Kiểm tra hệ thống màn hình",
  "cdx.findPh": "Tìm màn hình",
  "cdx.history": "Lịch sử màn hình",
  "dfx.embedTitle": "Tất cả thiết bị · danh sách & lịch sử",
  "dfx.embedSub": "Tìm mọi thiết bị đã đăng ký; lịch sử mới nhất trước",
  "dvx.kpi.registered": "Thiết bị đã đăng ký",
  "dvx.kpi.registeredSub": "{n} đang báo trực tuyến",
  "dvx.kpi.healthySub": "đã xác minh ổn định",
  "dvx.kpi.meteredSub": "có đo lường",
  "dvx.builtIn": "Tích hợp sẵn",
  "dvx.builtInHint": "Lịch hẹn chạy ngay trong AI PowerSalon — không có đồng bộ bên ngoài cần kết nối",
  "aicx.check": "Kiểm tra AI & Liên lạc",
  "aicx.m.configured": "Trợ lý",
  "aicx.m.entitled": "Được quyền dùng",
  "aicx.m.verified": "Nhà cung cấp đã xác minh",
  "aicx.m.attention": "Cần chú ý",
  "aicx.lastCheck": "Lần kiểm tra nhà cung cấp gần nhất: {at}",
  "aicx.providerUnavailable": "vai trò này không xem được trạng thái nhà cung cấp",
  "aicx.axis.ent": "Gói đăng ký",
  "aicx.axis.prov": "Nhà cung cấp",
  "aicx.axis.ready": "Sẵn sàng",
  "aicx.ent.active": "Đang hoạt động",
  "aicx.ent.trial": "Dùng thử",
  "aicx.ent.trial_expired": "Hết dùng thử",
  "aicx.ent.cancelled": "Đã hủy",
  "aicx.ent.paused": "Tạm ngưng",
  "aicx.ent.past_due": "Quá hạn thanh toán",
  "aicx.ent.unpaid": "Chưa thanh toán",
  "aicx.ent.expired": "Đã hết hạn",
  "aicx.ent.not_subscribed": "Chưa đăng ký",
  "aicx.ent.unavailable": "Không khả dụng",
  "aicx.ent.no_permission": "Không có quyền",
  "aicx.ent.limit": "Đã đạt giới hạn sử dụng",
  "aicx.ent.branch_off": "Tắt ở chi nhánh này",
  "aicx.ent.account_inactive": "Tài khoản không hoạt động",
  "aicx.ent.unknown": "Gói đăng ký: —",
  "aicx.prov.connected": "Đã kết nối nhà cung cấp",
  "aicx.prov.unauthorized": "Nhà cung cấp từ chối xác thực",
  "aicx.prov.stale": "Kiểm tra nhà cung cấp đã cũ",
  "aicx.prov.untested": "Chưa kiểm tra nhà cung cấp",
  "aicx.prov.not_configured": "Chưa thiết lập nhà cung cấp",
  "aicx.prov.not_required": "Không cần nhà cung cấp",
  "aicx.ready.ready": "Sẵn sàng",
  "aicx.ready.missing_config": "Thiếu cấu hình",
  "aicx.ready.blocked": "Bị chặn",
  "aicx.ready.degraded": "Suy giảm",
  "aicx.ready.not_permitted": "Không được phép hoạt động",
  "aicx.foot": "Gói đăng ký, nhà cung cấp và mức sẵn sàng được kiểm tra riêng. Nhà cung cấp hoạt động không bao giờ bật lại gói đã hủy; nút Quản lý không mua hay hủy gói.",
  "arq.duplicate": "Bạn đã có một yêu cầu đang mở cho vai trò này — hãy chờ quyết định hoặc hủy yêu cầu đó trước.",
  "arq.policy": "Gửi yêu cầu không có nghĩa là được cấp quyền. Quản trị viên nền tảng xem xét mọi yêu cầu; không ai được tự phê duyệt yêu cầu của mình.",
  "arq.submitted": "Đã gửi {at}",
  "arq.decided": "đã quyết định {at}",
  "arq.expires": "hết hạn {at}",
  "arq.notes": "Ghi chú của người duyệt",
  "acx.notConfigured": "Chưa cấu hình",
  "acx.nh.verified": "Đã xác minh",
  "acx.nh.degraded": "Suy giảm",
  "acx.nh.blocked": "Bị chặn",
  "acx.nh.unknownSub": "Không có trạng thái",
  "acx.nh.checked": "Kiểm tra lúc {at}",
  "acx.nh.neverChecked": "Chưa kiểm tra",
  "acx.usage.unknown": "Không có dữ liệu sử dụng",
  "acx.usage.of": "{used} / {limit}",
  "acx.usage.noLimit": "Chưa đặt giới hạn lưu trữ",
  "acx.usage.ai": "{n} AI đang hoạt động",
  "acx.notif.saved": "Đã lưu.",
  "acx.notif.sub": "Thông báo của riêng bạn — được lưu khi máy chủ xác nhận",
  "acx.notif.foot": "Công tắc Bật là lựa chọn của bạn; để gửi được còn cần kênh đã thiết lập (SMS cần thiết lập nhắn tin của tiệm).",
  "acx.eff.on": "Bật",
  "acx.eff.off": "Tắt",
  "acx.eff.blocked": "Bật — SMS chưa gửi được",
  "acx.eff.unknown": "Bật — chưa rõ trạng thái gửi",
  "acx.act.sub": "Hoạt động tài khoản, bảo mật và hệ thống mới nhất của tiệm — mới nhất trước",
  "acx.act.back": "Quay lại Tài khoản",
  "acx.act.searchPh": "Tìm sự kiện, người hoặc mã tham chiếu",
  "acx.act.clear": "Xóa lọc",
  "acx.act.noMatch": "Không có hoạt động phù hợp trong khoảng này",
  "acx.act.details": "Chi tiết",
  "acx.act.by": "Bởi",
  "acx.act.role": "Vai trò",
  "acx.act.module": "Phân hệ",
  "acx.act.status": "Kết quả",
  "acx.act.code": "Mã sự kiện",
  "acx.act.id": "ID sự kiện",
  "acx.act.readOnly": "Chỉ xem — mở sự kiện không thay đổi gì.",
  "acx.act.viewAll": "Xem tất cả",
  "alg.unverified": "Không xác minh được chính sách đã lưu — bấm Sửa để tải.",
  "alg.status": "Trạng thái",
  "alg.grace": "Thời gian gia hạn",
  "alg.afterClose": "Gia hạn sau giờ đóng cửa",
  "alg.warnings": "Cảnh báo trước khi đăng xuất",
  "alg.exempt": "Vai trò được miễn",
  "alg.tz": "Múi giờ",
  "alg.min": "{n} phút",
  "alg.none": "Không có",
  "alg.serverNote": "Máy chủ kết thúc phiên không hoạt động; đồng hồ đếm ngược trên màn hình chỉ để cảnh báo.",
  "locx.searchPh": "Tìm tên, số điện thoại, địa chỉ hoặc mã",
  "locx.map": "Ghim bản đồ",
  "locx.booking": "Đặt lịch trực tuyến",
  "locx.clear": "Xóa bộ lọc",
  "locx.noMatch": "Không có chi nhánh nào khớp với bộ lọc.",
  "locx.st.all": "Mọi trạng thái",
  "locx.st.active": "Đang hoạt động",
  "locx.st.inactive": "Ngưng hoạt động",
  "locx.st.draft": "Bản nháp",
  "locx.st.unverified": "Chưa xác minh",
  "locx.st.verified": "Đã xác minh",
  "locx.st.published": "Đã công khai",
  "locx.map.all": "Tất cả",
  "locx.map.pin_set": "Đã đặt ghim",
  "locx.map.pin_confirmed": "Ghim đã xác nhận",
  "locx.map.missing_pin": "Thiếu ghim",
  "locx.bk.all": "Tất cả",
  "locx.bk.accepting": "Đang nhận đặt lịch",
  "locx.bk.disabled": "Tắt đặt lịch",
  "locx.date.created": "Ngày thêm",
  "locx.date.updated": "Cập nhật gần nhất",
  "locx.sort.newest": "Mới nhất trước",
  "locx.sort.oldest": "Cũ nhất trước",
  "locx.sort.name_asc": "Tên A–Z",
  "locx.sort.name_desc": "Tên Z–A",
  "locx.sort.updated": "Cập nhật gần đây",
  "ftx.subscription": "Gói đăng ký",
  "ftx.usage": "Mức dùng & giới hạn",
  "ftx.planUnlinked": "Chưa liên kết với danh mục tính năng",
  "ftx.enabledSub": "Đang bật cho tiệm",
  "ftx.availableSub": "Có trong gói của bạn",
  "ftx.attention": "Cần chú ý",
  "ftx.attentionSub": "Bị nền tảng chặn",
  "ftx.why.unlinked": "Gói \"{plan}\" của bạn chưa được liên kết với một gói trong danh mục tính năng, nên chưa liệt kê được tính năng nào. Bộ phận hỗ trợ AI PowerSalon sẽ liên kết — trang này không thay đổi gói của bạn.",
  "ftx.why.noPlan": "Tiệm chưa có gói đăng ký nào được ghi nhận.",
  "ftx.why.empty": "Gói của bạn chưa được cấu hình tính năng nào.",
  "ftx.searchPh": "Tìm tên hoặc mã tính năng",
  "ftx.f.all": "Tất cả",
  "ftx.f.enabled": "Bật",
  "ftx.f.off": "Tắt",
  "ftx.f.attention": "Cần chú ý",
  "ftx.count": "{n} / {total}",
  "ftx.noMatch": "Không có tính năng phù hợp.",
  "ftx.st.enabled": "Bật",
  "ftx.st.blocked": "Bị nền tảng chặn",
  "ftx.st.override_off": "Đã tắt cho tài khoản của bạn",
  "ftx.st.not_in_plan": "Không có trong gói",
  "ftx.d.key": "Mã tính năng",
  "ftx.d.plan": "Thiết lập theo gói",
  "ftx.d.notInPlan": "Không có trong gói",
  "ftx.d.override": "Ghi đè cho tài khoản",
  "ftx.d.none": "Không có",
  "ftx.d.srcOverride": "Ghi đè cho tài khoản",
  "ftx.d.srcPlan": "Gói",
  "ftx.d.effective": "Hiệu lực",
  "ftx.d.blocked": "Nền tảng đã hạn chế tính năng này cho tài khoản của bạn. Hãy liên hệ bộ phận hỗ trợ AI PowerSalon.",
  "ftx.d.readOnly": "Chỉ xem — thay đổi gói thực hiện qua mục Gói đăng ký; trang này không mua hay bật tính năng.",
  "acx.planFee": "{fee} / tháng",
  "acx.trustedN": "{n} thiết bị tin cậy",
  "brx.primary": "Màu thương hiệu",
  "brx.accent": "Màu nhấn",
  "brx.notSet": "Chưa đặt",
  "brx.clear": "Xóa",
  "arq.openTag": "đang có yêu cầu",
  "acx.dh.title": "Lịch sử gửi",
  "acx.dh.searchPh": "Tìm thông báo hoặc địa chỉ",
  "acx.dh.channel": "Kênh",
  "acx.dh.status": "Trạng thái",
  "acx.dh.alert": "Thông báo",
  "acx.dh.to": "Gửi đến",
  "acx.dh.none": "Chưa có thông báo nào được gửi cho bạn.",
  "acx.dh.noMatch": "Không có lần gửi nào khớp với bộ lọc.",
  "acx.dh.ch.all": "Mọi kênh",
  "acx.dh.ch.sms": "SMS",
  "acx.dh.ch.email": "Email",
  "acx.dh.ch.push": "Thông báo đẩy",
  "acx.dh.st.all": "Mọi trạng thái",
  "acx.dh.st.delivered": "Đã nhận",
  "acx.dh.st.sent": "Đã gửi",
  "acx.dh.st.queued": "Đang chờ",
  "acx.dh.st.failed": "Thất bại",
  "acx.dh.st.suppressed": "Bị chặn theo lựa chọn",
  "acx.dh.st.blocked": "Bị chặn",
  "ksk.noteTitle": "Kiosk do AI PowerSalon thiết lập",
  "ksk.note": "Kiosk check-in là thiết bị do AI PowerSalon chuẩn bị và liên kết với tiệm, nên không thể thêm ở đây. Bạn có thể tìm, kiểm tra và xem lại mọi kiosk trên trang này.",
  "ksk.request": "Yêu cầu hỗ trợ thêm kiosk",
  "dfx.kpi.printersSub": "hóa đơn là điện tử — chưa có danh sách máy in",
  "dfx.receipt.why": "Hóa đơn AI PowerSalon là điện tử: khách chọn Email, SMS hoặc Không lấy hóa đơn trên màn hình khách, và mọi hóa đơn được lưu trong lịch sử của khách.",
  "dfx.receipt.1": "Máy in là tùy chọn. Cần có cầu nối máy in được hỗ trợ, hiện tiệm chưa cài.",
  "dfx.receipt.2": "Thanh toán không bao giờ chờ máy in — hóa đơn điện tử vẫn hoạt động.",
  "dfx.receipt.3": "Xem hóa đơn điện tử hôm nay ở thẻ Hóa đơn điện tử.",
  "dfx.hk.printer_registry": "Danh sách máy in",
  "sv.button": "Chế độ xem", // DRAFT — Kevin reviews
  "sv.open": "Chế độ xem đã lưu cho màn hình này", // DRAFT — Kevin reviews
  "sv.openNamed": "Chế độ xem đã lưu — đang xem {name}", // DRAFT — Kevin reviews
  "sv.title": "Chế độ xem đã lưu", // DRAFT — Kevin reviews
  "sv.sub": "Bộ lọc riêng của bạn cho màn hình này. Chỉ bạn thấy; không bao giờ hiện nhiều hơn quyền của bạn.", // DRAFT — Kevin reviews
  "sv.name": "Tên chế độ xem", // DRAFT — Kevin reviews
  "sv.namePh": "Đặt tên cho bộ lọc hiện tại", // DRAFT — Kevin reviews
  "sv.makeDefault": "Mở mặc định", // DRAFT — Kevin reviews
  "sv.save": "Lưu bộ lọc hiện tại", // DRAFT — Kevin reviews
  "sv.loading": "Đang tải…", // DRAFT — Kevin reviews
  "sv.empty": "Chưa có chế độ xem nào. Chọn bộ lọc, đặt tên bên dưới rồi lưu.", // DRAFT — Kevin reviews
  "sv.default": "Mặc định", // DRAFT — Kevin reviews
  "sv.showing": "đang xem", // DRAFT — Kevin reviews
  "sv.setDefault": "Đặt mặc định", // DRAFT — Kevin reviews
  "sv.unsetDefault": "Bỏ mặc định", // DRAFT — Kevin reviews
  "sv.overwrite": "Cập nhật theo hiện tại", // DRAFT — Kevin reviews
  "sv.delete": "Xóa", // DRAFT — Kevin reviews
  "sv.deleteNamed": "Xóa chế độ xem {name}", // DRAFT — Kevin reviews
  "sv.full": "Bạn đã có {n} chế độ xem ở đây — hãy xóa một cái để lưu thêm.", // DRAFT — Kevin reviews
  "sv.loadFailed": "Không tải được các chế độ xem đã lưu.", // DRAFT — Kevin reviews
  "sv.saveFailed": "Không lưu được chế độ xem này.", // DRAFT — Kevin reviews
  "syschk.button": "Kiểm tra hệ thống", // DRAFT — Kevin reviews
  "syschk.sub": "Chỉ đọc. Đếm lỗi trong dữ liệu của chính tiệm; không thay đổi gì.", // DRAFT — Kevin reviews
  "syschk.run": "Chạy lại", // DRAFT — Kevin reviews
  "syschk.running": "Đang kiểm tra…", // DRAFT — Kevin reviews
  "syschk.state.READY": "Đạt", // DRAFT — Kevin reviews
  "syschk.state.WARNING": "Cảnh báo", // DRAFT — Kevin reviews
  "syschk.state.FAILED": "Lỗi", // DRAFT — Kevin reviews
  "syschk.state.NOT_TESTED": "Chưa kiểm tra", // DRAFT — Kevin reviews
  "syschk.overall.READY": "Tất cả đều đạt", // DRAFT — Kevin reviews
  "syschk.overall.WARNING": "Có mục cần chú ý", // DRAFT — Kevin reviews
  "syschk.overall.FAILED": "Phát hiện lỗi", // DRAFT — Kevin reviews
  "syschk.overall.NOT_TESTED": "Có mục không chạy được", // DRAFT — Kevin reviews
  "syschk.count": "Có {n}", // DRAFT — Kevin reviews
  "syschk.notTested": "Mục này không chạy được — không phải là đạt.", // DRAFT — Kevin reviews
  "syschk.checkedAt": "Kiểm tra lúc {when}", // DRAFT — Kevin reviews
  "syschk.scopeBranch": "Chi nhánh này", // DRAFT — Kevin reviews
  "syschk.scopeAll": "Tất cả chi nhánh của bạn", // DRAFT — Kevin reviews
  "syschk.failed": "Không chạy được việc kiểm tra.", // DRAFT — Kevin reviews
  "syschk.expenses.title": "Kiểm tra hệ thống Chi phí", // DRAFT — Kevin reviews
  "syschk.invoices.title": "Kiểm tra hệ thống Hóa đơn", // DRAFT — Kevin reviews
  "syschk.settlements.title": "Kiểm tra hệ thống Quyết toán", // DRAFT — Kevin reviews
  "syschk.payments.title": "Kiểm tra hệ thống Thanh toán", // DRAFT — Kevin reviews
  "syschk.discounts.title": "Kiểm tra hệ thống Giảm giá", // DRAFT — Kevin reviews
  "syschk.catalog.title": "Kiểm tra hệ thống Dịch vụ", // DRAFT — Kevin reviews
  "syschk.inventory.title": "Kiểm tra hệ thống Kho hàng", // DRAFT — Kevin reviews
  "syschk.technicians.title": "Kiểm tra hệ thống Thợ", // DRAFT — Kevin reviews
  "syschk.memberships.title": "Kiểm tra hệ thống Thành viên", // DRAFT — Kevin reviews
  "syschk.expenses.parts_mismatch": "Tạm tính, thuế, tip và phí cộng lại đúng tổng", // DRAFT — Kevin reviews
  "syschk.expenses.parts_mismatch.fix": "Mở chi phí và sửa các khoản hoặc tổng.", // DRAFT — Kevin reviews
  "syschk.expenses.future_dated": "Không có chi phí ghi ngày trong tương lai", // DRAFT — Kevin reviews
  "syschk.expenses.future_dated.fix": "Sửa ngày của chi phí.", // DRAFT — Kevin reviews
  "syschk.expenses.possible_duplicates": "Các khoản có thể trùng đã được xem xét", // DRAFT — Kevin reviews
  "syschk.expenses.possible_duplicates.fix": "Xem từng khoản có thể trùng rồi giữ hoặc hủy.", // DRAFT — Kevin reviews
  "syschk.expenses.bills_past_due": "Không có hóa đơn chưa trả quá hạn", // DRAFT — Kevin reviews
  "syschk.expenses.bills_past_due.fix": "Trả hoặc cập nhật các hóa đơn quá hạn.", // DRAFT — Kevin reviews
  "syschk.expenses.review_waiting": "Không có chi phí chờ duyệt quá 7 ngày", // DRAFT — Kevin reviews
  "syschk.expenses.review_waiting.fix": "Duyệt hoặc từ chối các chi phí đang chờ.", // DRAFT — Kevin reviews
  "syschk.invoices.total_mismatch": "Tạm tính, thuế và giảm giá cộng lại đúng tổng", // DRAFT — Kevin reviews
  "syschk.invoices.total_mismatch.fix": "Mở hóa đơn và sửa các khoản.", // DRAFT — Kevin reviews
  "syschk.invoices.paid_not_covered": "Mọi hóa đơn ghi Đã trả đều có khoản thanh toán đủ", // DRAFT — Kevin reviews
  "syschk.invoices.paid_not_covered.fix": "Ghi khoản thanh toán còn thiếu hoặc mở lại hóa đơn.", // DRAFT — Kevin reviews
  "syschk.invoices.overpaid": "Không có hóa đơn nhận nhiều hơn tổng", // DRAFT — Kevin reviews
  "syschk.invoices.overpaid.fix": "Kiểm tra các khoản thanh toán và hoàn lại hoặc ghi có phần dư.", // DRAFT — Kevin reviews
  "syschk.invoices.due_before_issue": "Không có ngày đến hạn trước ngày lập", // DRAFT — Kevin reviews
  "syschk.invoices.due_before_issue.fix": "Sửa ngày trên hóa đơn.", // DRAFT — Kevin reviews
  "syschk.invoices.open_past_due": "Không có hóa đơn còn mở quá hạn", // DRAFT — Kevin reviews
  "syschk.invoices.open_past_due.fix": "Liên hệ khách hoặc cập nhật hóa đơn.", // DRAFT — Kevin reviews
  "syschk.invoices.missing_bill_to": "Mọi hóa đơn đều ghi tên người được lập", // DRAFT — Kevin reviews
  "syschk.invoices.missing_bill_to.fix": "Thêm khách hàng hoặc tên người nhận hóa đơn.", // DRAFT — Kevin reviews
  "syschk.invoices.void_without_reason": "Mọi hóa đơn đã hủy đều có lý do", // DRAFT — Kevin reviews
  "syschk.invoices.void_without_reason.fix": "Thêm lý do cho các hóa đơn đã hủy.", // DRAFT — Kevin reviews
  "syschk.settlements.duplicate_batch": "Không có lô thanh toán nào bị ghi hai lần", // DRAFT — Kevin reviews
  "syschk.settlements.duplicate_batch.fix": "Xem lại các lô trùng trước khi đối chiếu.", // DRAFT — Kevin reviews
  "syschk.settlements.missing_batch_id": "Mọi quyết toán đều có mã lô", // DRAFT — Kevin reviews
  "syschk.settlements.missing_batch_id.fix": "Kiểm tra báo cáo của đơn vị xử lý để tìm mã lô còn thiếu.", // DRAFT — Kevin reviews
  "syschk.settlements.deposit_overdue": "Không có khoản tiền gửi nào trễ quá 2 ngày", // DRAFT — Kevin reviews
  "syschk.settlements.deposit_overdue.fix": "Kiểm tra tài khoản ngân hàng và đơn vị xử lý cho các khoản trễ.", // DRAFT — Kevin reviews
  "syschk.settlements.deposit_difference": "Tiền gửi khớp với số tiền dự kiến", // DRAFT — Kevin reviews
  "syschk.settlements.deposit_difference.fix": "Mở quyết toán và giải thích hoặc xử lý phần chênh lệch.", // DRAFT — Kevin reviews
  "syschk.settlements.bank_unmatched": "Tiền gửi ngân hàng quá 3 ngày đã được khớp", // DRAFT — Kevin reviews
  "syschk.settlements.bank_unmatched.fix": "Khớp từng khoản tiền gửi với quyết toán của nó.", // DRAFT — Kevin reviews
  "syschk.settlements.refunds_stuck": "Không có khoản hoàn tiền nào chờ quá một ngày", // DRAFT — Kevin reviews
  "syschk.settlements.refunds_stuck.fix": "Kiểm tra từng khoản hoàn tiền đang chờ với đơn vị xử lý.", // DRAFT — Kevin reviews
  "syschk.settlements.refund_over_payment": "Không có khoản thanh toán nào bị hoàn nhiều hơn số đã trả", // DRAFT — Kevin reviews
  "syschk.settlements.refund_over_payment.fix": "Xem lại các khoản hoàn tiền trên những thanh toán đó.", // DRAFT — Kevin reviews
  "syschk.payments.stuck_in_progress": "Không có thanh toán nào bị kẹt đang xử lý quá một giờ", // DRAFT — Kevin reviews
  "syschk.payments.stuck_in_progress.fix": "Mở từng thanh toán và xác nhận kết quả trước khi thử lại.", // DRAFT — Kevin reviews
  "syschk.payments.stranded": "Không có thanh toán nào bị treo không có kết quả", // DRAFT — Kevin reviews
  "syschk.payments.stranded.fix": "Xử lý từng thanh toán bị treo với đơn vị xử lý.", // DRAFT — Kevin reviews
  "syschk.payments.duplicate_processor_txn": "Không có giao dịch nào của đơn vị xử lý bị ghi hai lần", // DRAFT — Kevin reviews
  "syschk.payments.duplicate_processor_txn.fix": "Xem lại các thanh toán trùng trước khi đóng ngày.", // DRAFT — Kevin reviews
  "syschk.payments.negative_amount": "Không có thanh toán, tip hay phụ phí nào âm", // DRAFT — Kevin reviews
  "syschk.payments.negative_amount.fix": "Xem lại các thanh toán đó; hoàn tiền được ghi riêng.", // DRAFT — Kevin reviews
  "syschk.payments.test_payments": "Không có thanh toán thử nào được tính trong 30 ngày qua", // DRAFT — Kevin reviews
  "syschk.payments.test_payments.fix": "Đảm bảo thanh toán thử không nằm trong báo cáo.", // DRAFT — Kevin reviews
  "syschk.discounts.over_redeemed": "Không có ưu đãi nào dùng quá giới hạn", // DRAFT — Kevin reviews
  "syschk.discounts.over_redeemed.fix": "Tạm dừng ưu đãi và xem lại các lần dùng.", // DRAFT — Kevin reviews
  "syschk.discounts.percent_missing": "Mọi ưu đãi phần trăm đều có tỷ lệ", // DRAFT — Kevin reviews
  "syschk.discounts.percent_missing.fix": "Sửa ưu đãi và nhập tỷ lệ phần trăm.", // DRAFT — Kevin reviews
  "syschk.discounts.fixed_over_price": "Không có giảm giá cố định nào lớn hơn giá", // DRAFT — Kevin reviews
  "syschk.discounts.fixed_over_price.fix": "Giảm mức giảm hoặc sửa giá.", // DRAFT — Kevin reviews
  "syschk.discounts.ends_before_starts": "Không có ưu đãi nào kết thúc trước khi bắt đầu", // DRAFT — Kevin reviews
  "syschk.discounts.ends_before_starts.fix": "Sửa ngày bắt đầu và kết thúc.", // DRAFT — Kevin reviews
  "syschk.discounts.active_but_ended": "Không có ưu đãi đang chạy nào đã quá ngày kết thúc", // DRAFT — Kevin reviews
  "syschk.discounts.active_but_ended.fix": "Kết thúc hoặc gia hạn các ưu đãi đó.", // DRAFT — Kevin reviews
  "syschk.discounts.waiting_approval_started": "Không có ưu đãi chờ duyệt nào đã đến ngày bắt đầu", // DRAFT — Kevin reviews
  "syschk.discounts.waiting_approval_started.fix": "Duyệt hoặc từ chối các ưu đãi đó.", // DRAFT — Kevin reviews
  "syschk.catalog.active_without_price": "Mọi dịch vụ đang hoạt động đều có giá", // DRAFT — Kevin reviews
  "syschk.catalog.active_without_price.fix": "Đặt giá hoặc lưu trữ dịch vụ.", // DRAFT — Kevin reviews
  "syschk.catalog.zero_duration": "Mọi dịch vụ đang hoạt động đều có thời lượng", // DRAFT — Kevin reviews
  "syschk.catalog.zero_duration.fix": "Nhập thời gian làm dịch vụ.", // DRAFT — Kevin reviews
  "syschk.catalog.missing_category": "Mọi dịch vụ đều thuộc một danh mục có thật", // DRAFT — Kevin reviews
  "syschk.catalog.missing_category.fix": "Chuyển các dịch vụ đó vào một danh mục.", // DRAFT — Kevin reviews
  "syschk.catalog.in_closed_category": "Không có dịch vụ đang hoạt động nào nằm trong danh mục đã lưu trữ", // DRAFT — Kevin reviews
  "syschk.catalog.in_closed_category.fix": "Chuyển dịch vụ hoặc mở lại danh mục.", // DRAFT — Kevin reviews
  "syschk.catalog.duplicate_names": "Không có hai dịch vụ đang hoạt động trùng tên", // DRAFT — Kevin reviews
  "syschk.catalog.duplicate_names.fix": "Đổi tên hoặc lưu trữ các dịch vụ trùng.", // DRAFT — Kevin reviews
  "syschk.catalog.addon_negative_price": "Không có dịch vụ thêm nào có giá âm", // DRAFT — Kevin reviews
  "syschk.catalog.addon_negative_price.fix": "Sửa giá dịch vụ thêm.", // DRAFT — Kevin reviews
  "syschk.catalog.addon_on_archived_service": "Không có dịch vụ thêm nào còn bật trên dịch vụ đã lưu trữ", // DRAFT — Kevin reviews
  "syschk.catalog.addon_on_archived_service.fix": "Tắt hoặc chuyển các dịch vụ thêm đó.", // DRAFT — Kevin reviews
  "syschk.inventory.available_over_on_hand": "Hàng có sẵn không bao giờ nhiều hơn hàng tồn", // DRAFT — Kevin reviews
  "syschk.inventory.available_over_on_hand.fix": "Kiểm đếm lại các sản phẩm đó.", // DRAFT — Kevin reviews
  "syschk.inventory.movement_math": "Mọi lần nhập xuất kho đều cộng đúng (trước + thay đổi = sau)", // DRAFT — Kevin reviews
  "syschk.inventory.movement_math.fix": "Xem lại các lần nhập xuất đó bằng một lần kiểm kho.", // DRAFT — Kevin reviews
  "syschk.inventory.below_reorder": "Không có sản phẩm nào ở mức cần đặt hàng", // DRAFT — Kevin reviews
  "syschk.inventory.below_reorder.fix": "Đặt hàng thêm các sản phẩm đó.", // DRAFT — Kevin reviews
  "syschk.inventory.archived_with_stock": "Không có sản phẩm đã lưu trữ nào còn tồn kho", // DRAFT — Kevin reviews
  "syschk.inventory.archived_with_stock.fix": "Dùng hết, chuyển hoặc ghi giảm lượng tồn đó.", // DRAFT — Kevin reviews
  "syschk.inventory.usage_without_technician": "Mọi lần dùng sản phẩm đều có tên thợ", // DRAFT — Kevin reviews
  "syschk.inventory.usage_without_technician.fix": "Thêm thợ cho các lần dùng đó.", // DRAFT — Kevin reviews
  "syschk.inventory.usage_duplicate_key": "Không có lần dùng sản phẩm nào bị ghi hai lần", // DRAFT — Kevin reviews
  "syschk.inventory.usage_duplicate_key.fix": "Hoàn tác các lần dùng bị trùng.", // DRAFT — Kevin reviews
  "syschk.technicians.active_but_archived": "Không có thợ đã lưu trữ nào còn hoạt động", // DRAFT — Kevin reviews
  "syschk.technicians.active_but_archived.fix": "Tắt hoặc khôi phục các thợ đó.", // DRAFT — Kevin reviews
  "syschk.technicians.missing_name": "Mọi thợ đều có tên", // DRAFT — Kevin reviews
  "syschk.technicians.missing_name.fix": "Thêm tên còn thiếu.", // DRAFT — Kevin reviews
  "syschk.technicians.duplicate_phone": "Không có hai thợ dùng chung số điện thoại", // DRAFT — Kevin reviews
  "syschk.technicians.duplicate_phone.fix": "Kiểm tra xem họ có phải cùng một người không.", // DRAFT — Kevin reviews
  "syschk.technicians.split_out_of_range": "Mọi tỷ lệ chia hoa hồng đều từ 0% đến 100%", // DRAFT — Kevin reviews
  "syschk.technicians.split_out_of_range.fix": "Sửa tỷ lệ chia của các thợ đó.", // DRAFT — Kevin reviews
  "syschk.technicians.no_app_account": "Mọi thợ đang làm đều đăng nhập được ứng dụng Thợ", // DRAFT — Kevin reviews
  "syschk.technicians.no_app_account.fix": "Gửi lời mời dùng ứng dụng cho các thợ đó.", // DRAFT — Kevin reviews
  "syschk.memberships.cancelled_still_billing": "Không có thẻ thành viên đã hủy hoặc hết hạn nào còn lịch thu tiền", // DRAFT — Kevin reviews
  "syschk.memberships.cancelled_still_billing.fix": "Bỏ lịch thu tiền tiếp theo của các thẻ đó.", // DRAFT — Kevin reviews
  "syschk.memberships.renew_without_consent": "Mọi thẻ tự gia hạn đều có sự đồng ý của khách", // DRAFT — Kevin reviews
  "syschk.memberships.renew_without_consent.fix": "Xin sự đồng ý hoặc tắt tự gia hạn.", // DRAFT — Kevin reviews
  "syschk.memberships.billing_overdue": "Không có lần thu tiền thẻ nào trễ quá một ngày", // DRAFT — Kevin reviews
  "syschk.memberships.billing_overdue.fix": "Kiểm tra việc thu tiền của các thẻ đó.", // DRAFT — Kevin reviews
  "syschk.memberships.active_past_period": "Không có thẻ đang hoạt động nào đã quá hết kỳ", // DRAFT — Kevin reviews
  "syschk.memberships.active_past_period.fix": "Gia hạn, kết thúc hoặc cập nhật các thẻ đó.", // DRAFT — Kevin reviews
  "syschk.memberships.paused_past_resume": "Không có thẻ tạm dừng nào đã quá ngày tiếp tục", // DRAFT — Kevin reviews
  "syschk.memberships.paused_past_resume.fix": "Tiếp tục hoặc gia hạn thời gian tạm dừng.", // DRAFT — Kevin reviews
  "syschk.service-flow.title": "Kiểm tra hệ thống Quy trình phục vụ", // DRAFT — Kevin reviews
  "syschk.terminals.title": "Kiểm tra hệ thống Máy thanh toán", // DRAFT — Kevin reviews
  "syschk.approvals.title": "Kiểm tra hệ thống Phê duyệt", // DRAFT — Kevin reviews
  "syschk.service-flow.serving_too_long": "Không có dịch vụ nào đang làm quá 8 giờ", // DRAFT — Kevin reviews
  "syschk.service-flow.serving_too_long.fix": "Hoàn tất hoặc mở lại các phiếu đó.", // DRAFT — Kevin reviews
  "syschk.service-flow.done_not_paid": "Không có dịch vụ đã xong nào chờ thanh toán quá một ngày", // DRAFT — Kevin reviews
  "syschk.service-flow.done_not_paid.fix": "Thu tiền hoặc đóng các phiếu đó.", // DRAFT — Kevin reviews
  "syschk.service-flow.paid_state_mismatch": "Mọi phiếu ghi Đã trả đều có giờ trả, và ngược lại", // DRAFT — Kevin reviews
  "syschk.service-flow.paid_state_mismatch.fix": "Mở phiếu và kiểm tra thanh toán.", // DRAFT — Kevin reviews
  "syschk.service-flow.paid_without_payment": "Mọi phiếu đã trả đều có khoản thanh toán thành công", // DRAFT — Kevin reviews
  "syschk.service-flow.paid_without_payment.fix": "Tìm khoản thanh toán hoặc mở lại phiếu.", // DRAFT — Kevin reviews
  "syschk.service-flow.queue_waiting_long": "Không có khách nào chờ trong hàng quá 3 giờ", // DRAFT — Kevin reviews
  "syschk.service-flow.queue_waiting_long.fix": "Phục vụ, chuyển hoặc xóa các khách đó.", // DRAFT — Kevin reviews
  "syschk.service-flow.in_service_without_ticket": "Mọi khách đang làm đều có phiếu", // DRAFT — Kevin reviews
  "syschk.service-flow.in_service_without_ticket.fix": "Mở phiếu cho họ từ màn hình Đang phục vụ.", // DRAFT — Kevin reviews
  "syschk.terminals.not_seen_day": "Mọi máy thanh toán đều có tín hiệu trong ngày qua", // DRAFT — Kevin reviews
  "syschk.terminals.not_seen_day.fix": "Kiểm tra máy đã bật và có kết nối.", // DRAFT — Kevin reviews
  "syschk.terminals.last_ping_failed": "Không có máy nào lỗi lần kiểm tra kết nối gần nhất", // DRAFT — Kevin reviews
  "syschk.terminals.last_ping_failed.fix": "Kiểm tra lại máy ở màn hình Máy thanh toán.", // DRAFT — Kevin reviews
  "syschk.terminals.never_verified": "Mọi máy thanh toán đều đã được xác minh", // DRAFT — Kevin reviews
  "syschk.terminals.never_verified.fix": "Chạy kiểm tra máy một lần.", // DRAFT — Kevin reviews
  "syschk.terminals.duplicate_serial": "Không có số sê-ri nào bị ghi hai lần", // DRAFT — Kevin reviews
  "syschk.terminals.duplicate_serial.fix": "Tắt bản ghi máy bị trùng.", // DRAFT — Kevin reviews
  "syschk.approvals.pending_expired": "Không có yêu cầu đang chờ nào quá hạn", // DRAFT — Kevin reviews
  "syschk.approvals.pending_expired.fix": "Quyết định hoặc hủy các yêu cầu đó.", // DRAFT — Kevin reviews
  "syschk.approvals.approved_not_executed": "Mọi yêu cầu đã duyệt đều đã được thực hiện", // DRAFT — Kevin reviews
  "syschk.approvals.approved_not_executed.fix": "Mở yêu cầu và chạy lại, hoặc hủy.", // DRAFT — Kevin reviews
  "syschk.approvals.execution_failed": "Không có yêu cầu đã duyệt nào bị lỗi khi thực hiện", // DRAFT — Kevin reviews
  "syschk.approvals.execution_failed.fix": "Mở yêu cầu để xem lý do và thử lại.", // DRAFT — Kevin reviews
  "exh.title": "Lịch sử", // DRAFT — Kevin reviews
  "exh.empty": "Chưa có thay đổi nào được ghi.", // DRAFT — Kevin reviews
  "exh.by": "bởi {name}", // DRAFT — Kevin reviews
  "exh.system": "bởi hệ thống", // DRAFT — Kevin reviews
  "exh.unknown": "bởi một nhân viên cũ", // DRAFT — Kevin reviews
  "exh.a.created": "Đã tạo", // DRAFT — Kevin reviews
  "exh.a.auto_approved": "Tự động duyệt theo quy tắc của chủ", // DRAFT — Kevin reviews
  "exh.a.updated": "Đã sửa", // DRAFT — Kevin reviews
  "exh.a.corrected": "Đã chỉnh sửa", // DRAFT — Kevin reviews
  "exh.a.category_corrected": "Đã sửa danh mục", // DRAFT — Kevin reviews
  "exh.a.document_attached": "Đã đính kèm hóa đơn", // DRAFT — Kevin reviews
  "exh.a.payment_match_checked": "Đã kiểm tra khớp thanh toán", // DRAFT — Kevin reviews
  "exh.a.payment_linked": "Đã liên kết thanh toán", // DRAFT — Kevin reviews
  "exh.a.payment_unlinked": "Đã bỏ liên kết thanh toán", // DRAFT — Kevin reviews
  "exh.a.duplicate_confirmed": "Đã đánh dấu trùng", // DRAFT — Kevin reviews
  "exh.a.duplicate_overridden": "Đã giữ — không trùng", // DRAFT — Kevin reviews
  "exh.a.bill_paid": "Đã trả đủ hóa đơn", // DRAFT — Kevin reviews
  "exh.a.bill_payment_recorded": "Đã ghi khoản trả hóa đơn", // DRAFT — Kevin reviews
  "exh.a.archived": "Đã lưu trữ", // DRAFT — Kevin reviews
  "exh.a.restored": "Đã khôi phục", // DRAFT — Kevin reviews
  "exh.a.submitted": "Đã gửi duyệt", // DRAFT — Kevin reviews
  "exh.a.approved": "Đã duyệt", // DRAFT — Kevin reviews
  "exh.a.rejected": "Đã từ chối", // DRAFT — Kevin reviews
  "exh.a.voided": "Đã hủy", // DRAFT — Kevin reviews
  "exh.a.returned_to_draft": "Đã trả về bản nháp", // DRAFT — Kevin reviews
  "exh.a.reimbursement_request": "Đã yêu cầu hoàn tiền", // DRAFT — Kevin reviews
  "exh.a.reimbursement_approve": "Đã duyệt hoàn tiền", // DRAFT — Kevin reviews
  "exh.a.reimbursement_reject": "Đã từ chối hoàn tiền", // DRAFT — Kevin reviews
  "exh.a.reimbursement_pay": "Đã trả hoàn tiền", // DRAFT — Kevin reviews
  "exh.a.reimbursement_cancel": "Đã hủy hoàn tiền", // DRAFT — Kevin reviews
  "ivt.title": "Dòng thời gian", // DRAFT — Kevin reviews
  "ivt.created": "Đã tạo hóa đơn", // DRAFT — Kevin reviews
  "ivt.issued": "Ngày lập {d}", // DRAFT — Kevin reviews
  "ivt.sent": "Đã gửi cho khách", // DRAFT — Kevin reviews
  "ivt.payment": "Đã ghi khoản thanh toán {amount}", // DRAFT — Kevin reviews
  "ivt.credit": "Phiếu ghi có {n} trị giá {amount}", // DRAFT — Kevin reviews
  "ivt.refunded": "Đã hoàn {amount}", // DRAFT — Kevin reviews
  "ivt.paid": "Đã trả đủ", // DRAFT — Kevin reviews
  "ivt.voided": "Đã hủy", // DRAFT — Kevin reviews
  "ptl.title": "Dòng thời gian thanh toán", // DRAFT — Kevin reviews
  "ptl.k.created": "Bắt đầu thanh toán", // DRAFT — Kevin reviews
  "ptl.k.approved": "Đơn vị xử lý đã duyệt", // DRAFT — Kevin reviews
  "ptl.k.failed": "Thất bại", // DRAFT — Kevin reviews
  "ptl.k.stranded": "Không có kết quả từ đơn vị xử lý", // DRAFT — Kevin reviews
  "ptl.k.refund_requested": "Đã yêu cầu hoàn tiền", // DRAFT — Kevin reviews
  "ptl.k.refund_settled": "Đã hoàn tiền xong", // DRAFT — Kevin reviews
  "ptl.k.settled": "Đã vào lô quyết toán", // DRAFT — Kevin reviews
  "ptl.k.deposited": "Đã chuyển vào ngân hàng", // DRAFT — Kevin reviews
  "exh.a.other": "Đã thay đổi", // DRAFT — Kevin reviews
  "syschk.reports.title": "Kiểm tra hệ thống Báo cáo", // DRAFT — Kevin reviews
  "syschk.reports.charged_vs_collected": "Tổng mỗi phiếu đã trả khớp với số tiền đã thu", // DRAFT — Kevin reviews
  "syschk.reports.charged_vs_collected.fix": "Mở các phiếu đó ở Giao dịch và so tổng với các khoản thanh toán.", // DRAFT — Kevin reviews
  "syschk.reports.surcharge_not_card": "Không có phụ phí trên thanh toán tiền mặt, thẻ quà tặng, điểm thưởng hay tiền cọc", // DRAFT — Kevin reviews
  "syschk.reports.surcharge_not_card.fix": "Xem lại các thanh toán đó; phụ phí chỉ được tính trên thanh toán bằng thẻ.", // DRAFT — Kevin reviews
  "rpt.how": "Cách tính?", // DRAFT — Kevin reviews
  "rpt.basisPaid": "Ngày thanh toán (theo ngày của tiệm)", // DRAFT — Kevin reviews
  "rpt.na": "Không áp dụng", // DRAFT — Kevin reviews
  "rpt.retBasis": "{n}/{d} khách quay lại", // DRAFT — Kevin reviews
  "rpt.viewDetails": "Xem chi tiết", // DRAFT — Kevin reviews
  "rpt.ins.topService": "Nhóm dịch vụ bán chạy nhất (trước thuế và phụ phí): {name} ({amount})", // DRAFT — Kevin reviews
  "rpt.ins.topMethod": "Thu nhiều nhất bằng {method}: {amount} (gồm thuế, tip và phụ phí)", // DRAFT — Kevin reviews
  "rpt.ins.source": "Tóm tắt từ dữ liệu phiếu đã trả trong kỳ — không do AI tạo.", // DRAFT — Kevin reviews
  "rpt.rec.line": "Doanh số thuần {net} + thuế {tax} + tip {tips} + phụ phí {sur} = {charged} đã thu của khách", // DRAFT — Kevin reviews
  "rpt.rec.collected": "Đã thu {amount}", // DRAFT — Kevin reviews
  "rpt.rec.diff": "Các số liệu không khớp — chênh lệch {amount}. Chạy Kiểm tra hệ thống Báo cáo để xem phiếu nào.", // DRAFT — Kevin reviews
  "rpt.calc.basis": "Tất cả số liệu: các phiếu đã trả của tiệm có ngày thanh toán (theo ngày của tiệm) trong kỳ. Hoàn tiền được hiển thị riêng.", // DRAFT — Kevin reviews
  "rpt.calc.totalRevenue.t": "Tổng doanh thu", // DRAFT — Kevin reviews
  "rpt.calc.totalRevenue.d": "Dịch vụ và hàng bán lẻ của các phiếu đã trả, trước giảm giá — không gồm thuế, tip hay phụ phí.", // DRAFT — Kevin reviews
  "rpt.calc.appointments.t": "Lịch hẹn hoàn tất", // DRAFT — Kevin reviews
  "rpt.calc.appointments.d": "Số phiếu đã trả trong kỳ, mỗi phiếu tính một lần dù có nhiều dịch vụ hay nhiều thợ.", // DRAFT — Kevin reviews
  "rpt.calc.avgTicket.t": "Trung bình mỗi phiếu", // DRAFT — Kevin reviews
  "rpt.calc.avgTicket.d": "Tổng doanh thu ÷ số phiếu đã trả. Không áp dụng khi không có phiếu.", // DRAFT — Kevin reviews
  "rpt.calc.retention.t": "Tỷ lệ giữ khách", // DRAFT — Kevin reviews
  "rpt.calc.retention.d": "Trong số khách có ghé và trả tiền ở kỳ trước cùng độ dài, tỷ lệ khách quay lại trong kỳ này. Không áp dụng khi kỳ trước không có khách.", // DRAFT — Kevin reviews
  "rpt.calc.tips.t": "Tổng tip", // DRAFT — Kevin reviews
  "rpt.calc.tips.d": "Tip ghi trên các phiếu đã trả, thẻ và tiền mặt. Không bao giờ tính vào doanh số.", // DRAFT — Kevin reviews
  "rpt.calc.rating.t": "Đánh giá trung bình", // DRAFT — Kevin reviews
  "rpt.calc.rating.d": "Trung bình các đánh giá 1–5 sao trong kỳ, không tính spam (theo định nghĩa của Đánh giá). Không áp dụng khi không có.", // DRAFT — Kevin reviews
  "rpt.calc.noShow.t": "Tỷ lệ không đến", // DRAFT — Kevin reviews
  "rpt.calc.noShow.d": "Số khách không đến ÷ số lịch hẹn trong kỳ, không tính lịch đã hủy. Không áp dụng khi không có lịch.", // DRAFT — Kevin reviews
  "rpt.calc.netSales.t": "Doanh số thuần", // DRAFT — Kevin reviews
  "rpt.calc.netSales.d": "Tổng doanh thu trừ giảm giá.", // DRAFT — Kevin reviews
  "rpt.calc.charged.t": "Đã thu của khách", // DRAFT — Kevin reviews
  "rpt.calc.charged.d": "Số khách đã trả: doanh số thuần + thuế + tip + phụ phí. Cơ cấu thanh toán và danh sách giao dịch dùng số này.", // DRAFT — Kevin reviews
  "rpt.calc.topService.t": "Dịch vụ bán chạy nhất", // DRAFT — Kevin reviews
  "rpt.calc.topService.d": "Doanh số theo nhóm dịch vụ, cùng cách tính với Tổng doanh thu (không phải số đã thu).", // DRAFT — Kevin reviews
  "rpt.tx.search": "Tìm khách, dịch vụ, thợ hoặc số phiếu", // DRAFT — Kevin reviews
  "rpt.tx.clear": "Xóa", // DRAFT — Kevin reviews
  "rpt.tx.scope": "Kỳ này · chi nhánh này", // DRAFT — Kevin reviews
  "rpt.tx.perPage": "Mỗi trang", // DRAFT — Kevin reviews
  "rpt.tx.noMatch": "Không có kết quả phù hợp", // DRAFT — Kevin reviews
  "rpt.tx.failed": "Không tải được các giao dịch.", // DRAFT — Kevin reviews
  "rpt.tx.walkIn": "Khách vãng lai", // DRAFT — Kevin reviews
  "rpt.tx.charged": "Đã thu", // DRAFT — Kevin reviews
  "rpt.tx.pager": "Các trang giao dịch", // DRAFT — Kevin reviews
  "syschk.reports.unmapped_service_lines": "Mọi dòng dịch vụ đã trả đều có nhóm dịch vụ", // DRAFT — Kevin reviews
  "syschk.reports.unmapped_service_lines.fix": "Các dòng đó là dịch vụ không còn trong danh mục; chúng hiện là \"Chưa phân nhóm / dịch vụ cũ\" trong Doanh thu theo dịch vụ.", // DRAFT — Kevin reviews
  "syschk.reports.paid_without_service_lines": "Mọi phiếu đã trả có doanh số đều có dòng dịch vụ", // DRAFT — Kevin reviews
  "syschk.reports.paid_without_service_lines.fix": "Mở các phiếu đó; doanh số của chúng nằm ở \"Không ghi dòng dịch vụ\" cho đến khi có dòng.", // DRAFT — Kevin reviews
  "rpt.svc.viewAll": "Xem tất cả dịch vụ ({n})", // DRAFT — Kevin reviews
  "rpt.svc.basis": "Doanh số trước giảm giá, theo từng dòng dịch vụ — không gồm thuế, tip hay phụ phí.", // DRAFT — Kevin reviews
  "rpt.svc.empty": "Không có doanh số dịch vụ từ {from} đến {to}.", // DRAFT — Kevin reviews
  "rpt.svc.tip": "{name}: {units} dịch vụ · {amount} doanh số trước giảm giá", // DRAFT — Kevin reviews
  "rpt.svc.noLines": "Không ghi dòng dịch vụ", // DRAFT — Kevin reviews
  "rpt.svc.unmapped": "Chưa phân nhóm / dịch vụ cũ", // DRAFT — Kevin reviews
  "rpt.svc.back": "← Tóm tắt ngày", // DRAFT — Kevin reviews
  "rpt.svc.export": "Xuất CSV (tất cả kết quả)", // DRAFT — Kevin reviews
  "rpt.svc.exported": "Đã tải CSV — tất cả các dòng phù hợp, không chỉ trang này.", // DRAFT — Kevin reviews
  "rpt.svc.search": "Tìm dịch vụ, nhóm, thợ, khách, số điện thoại hoặc số phiếu", // DRAFT — Kevin reviews
  "rpt.svc.clearAll": "Xóa tất cả", // DRAFT — Kevin reviews
  "rpt.svc.count": "{n} dòng", // DRAFT — Kevin reviews
  "rpt.svc.asOf": "Cập nhật lúc {at}", // DRAFT — Kevin reviews
  "rpt.svc.beforeDiscounts": "Trước giảm giá", // DRAFT — Kevin reviews
  "rpt.svc.avg": "Trung bình mỗi dịch vụ", // DRAFT — Kevin reviews
  "rpt.svc.discounts": "Giảm giá trên các phiếu này", // DRAFT — Kevin reviews
  "rpt.svc.refunds": "Hoàn tiền trên các phiếu này", // DRAFT — Kevin reviews
  "rpt.svc.ticketLevel": "Ghi theo phiếu, không theo dịch vụ", // DRAFT — Kevin reviews
  "rpt.svc.definition": "Cách tính: các phiếu đã trả có thanh toán vào một ngày của tiệm trong kỳ. Mỗi dòng dịch vụ tính một lần theo giá đã ghi, vào đúng nhóm của nó; phiếu có hai dịch vụ được chia cho cả hai. Hàng bán lẻ, thuế, tip và phụ phí thẻ không phải doanh số dịch vụ.", // DRAFT — Kevin reviews
  "rpt.svc.lines": "Các dòng dịch vụ (mới nhất trước)", // DRAFT — Kevin reviews
  "rpt.svc.paidAt": "Đã trả", // DRAFT — Kevin reviews
  "rpt.svc.ticket": "Phiếu", // DRAFT — Kevin reviews
  "rpt.svc.category": "Nhóm", // DRAFT — Kevin reviews
  "rpt.svc.tech": "Thợ", // DRAFT — Kevin reviews
  "rpt.svc.customer": "Khách", // DRAFT — Kevin reviews
  "rpt.svc.amount": "Doanh số", // DRAFT — Kevin reviews
  "rpt.svc.pager": "Các trang dòng dịch vụ", // DRAFT — Kevin reviews
  "rpt.svc.noCustomers": "Tên khách bị ẩn — cần quyền xem báo cáo tài chính.", // DRAFT — Kevin reviews
  "rpt.trend.revenue": "Doanh thu (trước giảm giá)", // DRAFT — Kevin reviews
  "rpt.trend.tickets": "Lịch hẹn hoàn tất (phiếu đã trả)", // DRAFT — Kevin reviews
  "rpt.trend.groupBy": "Nhóm theo", // DRAFT — Kevin reviews
  "rpt.trend.g.hour": "Giờ", // DRAFT — Kevin reviews
  "rpt.trend.g.day": "Ngày", // DRAFT — Kevin reviews
  "rpt.trend.g.week": "Tuần", // DRAFT — Kevin reviews
  "rpt.trend.g.month": "Tháng", // DRAFT — Kevin reviews
  "rpt.trend.compare": "So với kỳ trước", // DRAFT — Kevin reviews
  "rpt.trend.asTable": "Xem dạng bảng", // DRAFT — Kevin reviews
  "rpt.trend.asChart": "Xem dạng biểu đồ", // DRAFT — Kevin reviews
  "rpt.trend.none": "Không có doanh số hay phiếu đã trả trong kỳ này.", // DRAFT — Kevin reviews
  "rpt.trend.unavailable": "Máy chủ chưa trả về xu hướng.", // DRAFT — Kevin reviews
  "rpt.trend.period": "Thời gian", // DRAFT — Kevin reviews
  "rpt.trend.tip": "{label}: {amount} doanh số · {n} phiếu đã trả", // DRAFT — Kevin reviews
  "rpt.trend.weekOf": "Tuần từ {date}", // DRAFT — Kevin reviews
  "rpt.trend.basis": "Mỗi cột = các phiếu đã trả theo giờ thanh toán ở múi giờ của tiệm ({tz}). Doanh thu là doanh số trước giảm giá — không gồm thuế, tip hay phụ phí. Bấm vào một cột để xem các giao dịch.", // DRAFT — Kevin reviews
  "rpt.trend.reconciled": "Tổng các cột khớp với Tổng doanh thu và Lịch hẹn hoàn tất ở trên.", // DRAFT — Kevin reviews
  "rpt.trend.notReconciled": "Xu hướng ({trend}) không khớp với Tổng doanh thu ({kpi}) — chạy Kiểm tra hệ thống Báo cáo.", // DRAFT — Kevin reviews
  "rpt.trend.cmp": "Kỳ trước {from} – {to}: {amount} ({rpct}) · {n} phiếu đã trả ({tpct})", // DRAFT — Kevin reviews
  "rpt.trend.insufficient": "chưa đủ dữ liệu", // DRAFT — Kevin reviews
  "rpt.trend.showing": "Đang xem {label}", // DRAFT — Kevin reviews
  "rpt.sales.sub": "Các phiếu đã trả từ {from} đến {to}", // DRAFT — Kevin reviews
  "rpt.sales.refreshed": "Đã làm mới lúc {at}", // DRAFT — Kevin reviews
  "rpt.sales.exported": "Đã tải CSV doanh số cho kỳ này.", // DRAFT — Kevin reviews
  "rpt.sales.exportEmpty": "Bản xuất không có tệp.", // DRAFT — Kevin reviews
  "rpt.sales.tickets": "Tra cứu phiếu (mới nhất trước)", // DRAFT — Kevin reviews
  "rpt.sales.ticketsRestricted": "Cần quyền xem báo cáo tài chính để xem chi tiết phiếu.", // DRAFT — Kevin reviews
  "rpt.sales.ticketsFailed": "Không tải được các phiếu.", // DRAFT — Kevin reviews
  "rpt.sales.search": "Tìm khách, số điện thoại, thợ, dịch vụ, số phiếu hoặc cách trả", // DRAFT — Kevin reviews
  "rpt.sales.count": "{n} phiếu", // DRAFT — Kevin reviews
  "rpt.sales.noTickets": "Không có phiếu đã trả trong kỳ này.", // DRAFT — Kevin reviews
  "rpt.sales.servicesTechs": "Dịch vụ · thợ", // DRAFT — Kevin reviews
  "rpt.sales.col.net": "Doanh số thuần", // DRAFT — Kevin reviews
  "rpt.sales.tender": "Trả bằng", // DRAFT — Kevin reviews
  "rpt.sales.status": "Trạng thái", // DRAFT — Kevin reviews
  "rpt.sales.st.paid": "Đã trả", // DRAFT — Kevin reviews
  "rpt.sales.st.refunded": "Đã hoàn tiền", // DRAFT — Kevin reviews
  "rpt.sales.st.partially_refunded": "Hoàn tiền một phần", // DRAFT — Kevin reviews
  "rpt.sales.refunded": "Đã hoàn {amount}", // DRAFT — Kevin reviews
  "rpt.sales.breakdown": "Doanh số {sales} − giảm giá {disc} = thuần {net}; + thuế {tax} + tip {tips} + phụ phí {sur} = đã thu {charged}", // DRAFT — Kevin reviews
  "rpt.sales.pager": "Các trang phiếu", // DRAFT — Kevin reviews
  "rpt.calc.serviceSales.t": "Doanh số dịch vụ", // DRAFT — Kevin reviews
  "rpt.calc.serviceSales.d": "Các dòng dịch vụ của phiếu đã trả theo giá đã ghi, trước giảm giá — bằng tổng Doanh thu theo dịch vụ.", // DRAFT — Kevin reviews
  "rpt.calc.productSales.t": "Doanh số sản phẩm", // DRAFT — Kevin reviews
  "rpt.calc.productSales.d": "Các dòng hàng bán lẻ của phiếu đã trả theo giá đã ghi, trước giảm giá.", // DRAFT — Kevin reviews
  "rpt.calc.tax.t": "Thuế đã thu", // DRAFT — Kevin reviews
  "rpt.calc.tax.d": "Thuế ghi trên các phiếu đã trả (theo thuế suất lúc đó, không phải hôm nay). Không bao giờ tính vào doanh số.", // DRAFT — Kevin reviews
  "rpt.calc.tickets.t": "Số phiếu", // DRAFT — Kevin reviews
  "rpt.calc.tickets.d": "Các phiếu đã trả, mỗi phiếu một lần — phiếu trả bằng cả tiền mặt và thẻ vẫn là một phiếu.", // DRAFT — Kevin reviews
  "rpt.calc.customers.t": "Khách hàng", // DRAFT — Kevin reviews
  "rpt.calc.customers.d": "Số khách khác nhau có hồ sơ và có phiếu đã trả. Khách vãng lai không có hồ sơ không được tính.", // DRAFT — Kevin reviews
  "rpt.appt.open": "Còn đang mở", // DRAFT — Kevin reviews
  "rpt.appt.other": "Trạng thái khác", // DRAFT — Kevin reviews
  "rpt.appt.basisScheduled": "Ngày hẹn (theo ngày của tiệm)", // DRAFT — Kevin reviews
  "rpt.appt.unavailable": "Không đọc được kết quả lịch hẹn cho kỳ này — các số này là phiếu đã trả, không phải lịch hẹn.", // DRAFT — Kevin reviews
  "rpt.appt.eachOnce": "Mỗi lịch hẹn tính một lần", // DRAFT — Kevin reviews
  "rpt.appt.basis": "Các lịch hẹn có ngày hẹn trong kỳ (theo ngày của tiệm), mọi trạng thái, mỗi lịch một lần. Tỷ lệ tính trên Tổng lịch hẹn; Hoàn tất, Đã hủy và Không đến chỉ theo trạng thái đã ghi — lịch đã qua không bao giờ bị coi là hoàn tất hay không đến.", // DRAFT — Kevin reviews
  "rpt.appt.empty": "Không có lịch hẹn từ {from} đến {to}.", // DRAFT — Kevin reviews
  "rpt.appt.tip": "{label}: {n} lịch hẹn · {share} trên tổng", // DRAFT — Kevin reviews
  "rpt.appt.list": "Các lịch hẹn (đặt gần nhất trước)", // DRAFT — Kevin reviews
  "rpt.appt.openHistory": "Mở trong Lịch sử lịch hẹn", // DRAFT — Kevin reviews
  "rpt.appt.listRestricted": "Cần quyền khách hàng để xem danh sách lịch hẹn.", // DRAFT — Kevin reviews
  "rpt.appt.listFailed": "Không tải được các lịch hẹn.", // DRAFT — Kevin reviews
  "rpt.appt.search": "Tìm khách, số điện thoại, dịch vụ, thợ hoặc lịch hẹn", // DRAFT — Kevin reviews
  "rpt.appt.count": "{n} lịch hẹn", // DRAFT — Kevin reviews
  "rpt.appt.none": "Không có lịch hẹn trong kỳ này.", // DRAFT — Kevin reviews
  "rpt.appt.when": "Ngày hẹn", // DRAFT — Kevin reviews
  "rpt.appt.services": "Dịch vụ", // DRAFT — Kevin reviews
  "rpt.appt.source": "Nguồn", // DRAFT — Kevin reviews
  "rpt.appt.booked": "Đặt lúc", // DRAFT — Kevin reviews
  "rpt.appt.anyTech": "Thợ bất kỳ", // DRAFT — Kevin reviews
  "rpt.appt.pager": "Các trang lịch hẹn", // DRAFT — Kevin reviews
  "rpt.appt.st.completed": "Hoàn tất", // DRAFT — Kevin reviews
  "rpt.appt.st.canceled": "Đã hủy", // DRAFT — Kevin reviews
  "rpt.appt.st.no_show": "Không đến", // DRAFT — Kevin reviews
  "rpt.appt.st.upcoming": "Đang mở / sắp tới", // DRAFT — Kevin reviews
  "rpt.appt.status.booked": "Đã đặt", // DRAFT — Kevin reviews
  "rpt.appt.status.confirmed": "Đã xác nhận", // DRAFT — Kevin reviews
  "rpt.appt.status.arrived": "Đã đến", // DRAFT — Kevin reviews
  "rpt.appt.status.checked_in": "Đã check-in", // DRAFT — Kevin reviews
  "rpt.appt.status.waiting": "Đang chờ", // DRAFT — Kevin reviews
  "rpt.appt.status.in_service": "Đang làm", // DRAFT — Kevin reviews
  "rpt.appt.status.completed": "Hoàn tất", // DRAFT — Kevin reviews
  "rpt.appt.status.cancelled": "Đã hủy", // DRAFT — Kevin reviews
  "rpt.appt.status.no_show": "Không đến", // DRAFT — Kevin reviews
  "rpt.tech.unassigned": "Dòng không có thợ", // DRAFT — Kevin reviews
  "rpt.tech.basis": "Mỗi thợ chỉ được tính các dòng dịch vụ giao cho mình (phiếu có hai thợ được chia theo từng dòng). Doanh thu = doanh số trước giảm giá; không gồm thuế, tip, phụ phí, hàng bán lẻ hay hoa hồng.", // DRAFT — Kevin reviews
  "rpt.tech.unattributedNote": "{amount} nằm trên các dòng không có thợ hoặc phiếu không có dòng — hiện thành dòng riêng.", // DRAFT — Kevin reviews
  "rpt.tech.empty": "Không có doanh số dịch vụ của thợ từ {from} đến {to}.", // DRAFT — Kevin reviews
  "rpt.tech.tip": "{name}: {amount} · {n} dịch vụ", // DRAFT — Kevin reviews
  "rpt.tech.rankedBy": "Xếp theo doanh thu dịch vụ", // DRAFT — Kevin reviews
  "rpt.tech.filter": "Lọc thợ theo tên", // DRAFT — Kevin reviews
  "rpt.tech.tickets": "Phiếu", // DRAFT — Kevin reviews
  "rpt.tech.detail": "{name} — các dòng dịch vụ (mới nhất trước)", // DRAFT — Kevin reviews
  "rpt.tech.commission": "Báo cáo hoa hồng", // DRAFT — Kevin reviews
  "rpt.tech.services": "Báo cáo dịch vụ", // DRAFT — Kevin reviews
  "rpt.tech.detailTotals": "{amount} · {n} dịch vụ · {tickets} phiếu", // DRAFT — Kevin reviews
  "rpt.cust.noBase": "Không có kỳ trước để so", // DRAFT — Kevin reviews
  "rpt.cust.vsPrev": "so với kỳ trước", // DRAFT — Kevin reviews
  "rpt.cust.empty": "Không có khách đã trả tiền từ {from} đến {to}.", // DRAFT — Kevin reviews
  "rpt.cust.tip": "{label}: {n} khách · {share}", // DRAFT — Kevin reviews
  "rpt.cust.list": "Khách trong kỳ (lần ghé gần nhất trước)", // DRAFT — Kevin reviews
  "rpt.cust.listFailed": "Không tải được danh sách khách.", // DRAFT — Kevin reviews
  "rpt.cust.type": "Loại khách", // DRAFT — Kevin reviews
  "rpt.cust.t.all": "Tất cả", // DRAFT — Kevin reviews
  "rpt.cust.t.new": "Mới", // DRAFT — Kevin reviews
  "rpt.cust.t.returning": "Quay lại", // DRAFT — Kevin reviews
  "rpt.cust.search": "Tìm tên, số điện thoại hoặc số phiếu", // DRAFT — Kevin reviews
  "rpt.cust.count": "{n} khách", // DRAFT — Kevin reviews
  "rpt.cust.none": "Không có khách đã trả tiền trong kỳ này.", // DRAFT — Kevin reviews
  "rpt.cust.phone": "Điện thoại", // DRAFT — Kevin reviews
  "rpt.cust.typeCol": "Loại", // DRAFT — Kevin reviews
  "rpt.cust.visits": "Số lần ghé", // DRAFT — Kevin reviews
  "rpt.cust.last": "Lần ghé gần nhất", // DRAFT — Kevin reviews
  "rpt.cust.pager": "Các trang khách", // DRAFT — Kevin reviews
  "rpt.calc.newCustomers.t": "Khách mới", // DRAFT — Kevin reviews
  "rpt.calc.newCustomers.d": "Khách có hồ sơ mà lần ghé có trả tiền đầu tiên nằm trong kỳ này. Khách vãng lai không có hồ sơ không được tính.", // DRAFT — Kevin reviews
  "rpt.calc.returningCustomers.t": "Khách quay lại", // DRAFT — Kevin reviews
  "rpt.calc.returningCustomers.d": "Khách có hồ sơ có ghé và trả tiền trong kỳ này và đã từng trả tiền trước đó.", // DRAFT — Kevin reviews
  "pay.list.search": "Tìm kỳ lương, ngày, trạng thái hoặc tên / SĐT thợ", // DRAFT — Kevin reviews
  "pay.list.techSearchDown": "Hiện chưa tìm được theo thợ — chỉ tìm theo tên kỳ lương và ngày.", // DRAFT — Kevin reviews
  "pay.list.status": "Trạng thái", // DRAFT — Kevin reviews
  "pay.list.allStatuses": "Mọi trạng thái", // DRAFT — Kevin reviews
  "pay.list.anyDates": "Mọi ngày", // DRAFT — Kevin reviews
  "pay.list.count": "{n} kỳ lương", // DRAFT — Kevin reviews
  "pay.list.pager": "Các trang kỳ lương", // DRAFT — Kevin reviews
  "rpt.svc.groupBy": "Nhóm theo", // DRAFT — Kevin reviews
  "rpt.svc.by.category": "Nhóm dịch vụ", // DRAFT — Kevin reviews
  "rpt.svc.by.service": "Dịch vụ", // DRAFT — Kevin reviews
  "rpt.inv.asOf": "Cập nhật lúc {at}", // DRAFT — Kevin reviews
  "rpt.inv.open": "Mở Kho hàng", // DRAFT — Kevin reviews
  "rpt.inv.valueBasis": "Giá vốn × chai dùng được, chưa hết hạn", // DRAFT — Kevin reviews
  "rpt.inv.critical": "{n} rất thấp", // DRAFT — Kevin reviews
  "rpt.inv.expiringUnit": "Số chai · {days} ngày tới", // DRAFT — Kevin reviews
  "rpt.inv.health": "Tình trạng dữ liệu", // DRAFT — Kevin reviews
  "rpt.inv.h.ok": "Không lệch tồn kho, sản phẩm nào cũng có giá vốn, không có chai hết hạn trong kho.", // DRAFT — Kevin reviews
  "rpt.inv.h.expired": "Có {n} chai đã hết hạn trong kho — không tính vào Sắp hết hạn và không tính vào giá trị.", // DRAFT — Kevin reviews
  "rpt.inv.h.drift": "{n} sản phẩm: số tồn kho đang lưu khác với hồ sơ từng chai — hãy kiểm đếm lại trong Kho hàng.", // DRAFT — Kevin reviews
  "rpt.inv.h.noCost": "{n} sản phẩm chưa có giá vốn — Giá trị kho không tính chúng.", // DRAFT — Kevin reviews
  "rpt.inv.h.counts": "Sản phẩm đếm theo sản phẩm ({products}); Số chai và Sắp hết hạn đếm theo chai ({bottles} · {expiring}) — hai đơn vị khác nhau.", // DRAFT — Kevin reviews
  "rpt.inv.count": "{n} sản phẩm", // DRAFT — Kevin reviews
  "rpt.inv.st.needs_reorder": "Cần đặt thêm", // DRAFT — Kevin reviews
  "rpt.inv.st.out_of_stock": "Hết hàng", // DRAFT — Kevin reviews
  "rpt.inv.st.critical": "Rất thấp", // DRAFT — Kevin reviews
  "rpt.inv.st.low": "Thấp", // DRAFT — Kevin reviews
  "rpt.inv.search": "Tìm sản phẩm, SKU, mã vạch hoặc mã màu", // DRAFT — Kevin reviews
  "rpt.inv.failed": "Không tải được kho hàng.", // DRAFT — Kevin reviews
  "rpt.inv.expiringCol": "Chai sắp hết hạn", // DRAFT — Kevin reviews
  "rpt.inv.expiredN": "{n} đã hết hạn", // DRAFT — Kevin reviews
  "rpt.inv.moves": "Biến động kho (mới nhất trước)", // DRAFT — Kevin reviews
  "rpt.inv.movesCount": "{n} biến động", // DRAFT — Kevin reviews
  "rpt.inv.movesSearch": "Tìm sản phẩm, lý do hoặc số PO", // DRAFT — Kevin reviews
  "rpt.inv.noMoves": "Không có biến động kho trong kỳ này.", // DRAFT — Kevin reviews
  "rpt.inv.when": "Thời gian", // DRAFT — Kevin reviews
  "rpt.inv.type": "Biến động", // DRAFT — Kevin reviews
  "rpt.inv.change": "Thay đổi", // DRAFT — Kevin reviews
  "rpt.inv.after": "Tồn sau", // DRAFT — Kevin reviews
  "rpt.inv.by": "Người thực hiện", // DRAFT — Kevin reviews
  "rpt.mkt.roiNa": "ROI không áp dụng — chưa gửi hoặc chưa có chi phí", // DRAFT — Kevin reviews
  "rpt.mkt.costEntered": "(số nhập trên chiến dịch, không phải phí nhà cung cấp)", // DRAFT — Kevin reviews
  "rpt.mkt.allTime": "Toàn thời gian — mọi chiến dịch, khuyến mãi và đánh giá", // DRAFT — Kevin reviews
  "rpt.pay.other": "Cách trả khác", // DRAFT — Kevin reviews
  "rpt.pay.basis": "Đã thu = mọi khoản thanh toán (không tính hoàn tiền) ghi vào một ngày của tiệm trong kỳ, theo cách trả (thẻ, tiền mặt, thẻ quà tặng, tiền mặt cho thợ, điểm thưởng, tiền cọc …). Trả tách = phiếu trả bằng hai khoản trở lên. Hoàn tiền hiện riêng.", // DRAFT — Kevin reviews
  "rpt.pay.processorNote": "Trạng thái xử lý thanh toán là kết nối với cổng thanh toán, không phải kiểm tra các số tiền này.", // DRAFT — Kevin reviews
  "rpt.tax.retail": "Hàng bán lẻ", // DRAFT — Kevin reviews
  "rpt.tax.effective": "Thuế suất thực tế {rate} trên doanh số chịu thuế", // DRAFT — Kevin reviews
  "rpt.tax.notTracked": "Không ghi riêng", // DRAFT — Kevin reviews
  "rpt.tax.basis": "Thuế đã thu = thuế ghi trên các phiếu đã trả trong kỳ (theo thuế suất lúc đó). Chịu thuế / miễn thuế = cờ chịu thuế của từng dòng, trước giảm giá. Thuế suất là mức tiệm cài đặt; thực tế = thuế ÷ doanh số chịu thuế.", // DRAFT — Kevin reviews
  "rpt.tax.allCats": "Tất cả nhóm", // DRAFT — Kevin reviews
  "rpt.tax.perTicket": "Thuế ghi theo phiếu, không theo dòng — {amount} cho cả kỳ; không chia theo nhóm.", // DRAFT — Kevin reviews
  "rpt.tax.tickets": "Các phiếu và thuế (mới nhất trước)", // DRAFT — Kevin reviews
  "rpt.ai.caption": "Hiệu quả trợ lý AI · {from} – {to}", // DRAFT — Kevin reviews
  "rpt.ai.week": "7 ngày đến hết {to} (từ {from})", // DRAFT — Kevin reviews
  "rpt.ai.allCampaigns": "mọi chiến dịch đã gửi, không chỉ kỳ này", // DRAFT — Kevin reviews
  "mgmt.open": "Mở", // DRAFT — Kevin reviews
  "mgmt.appr.forbidden": "Không có quyền xem phê duyệt", // DRAFT — Kevin reviews
  "mgmt.appr.unavailable": "Chưa tải được phê duyệt", // DRAFT — Kevin reviews
  "mgmt.st.active": "Đang hoạt động", // DRAFT — Kevin reviews
  "mgmt.st.inactive": "Ngừng hoạt động", // DRAFT — Kevin reviews
  "mgmt.st.draft": "Bản nháp", // DRAFT — Kevin reviews
  "mgmt.snap.period": "Kỳ xem nhanh", // DRAFT — Kevin reviews
  "mgmt.snap.p.today": "Hôm nay", // DRAFT — Kevin reviews
  "mgmt.snap.p.week": "Tuần này", // DRAFT — Kevin reviews
  "mgmt.snap.p.month": "Tháng này", // DRAFT — Kevin reviews
  "mgmt.snap.search": "Tìm chi nhánh hoặc thành phố", // DRAFT — Kevin reviews
  "mgmt.snap.forbidden": "Cần quyền xem hiệu quả chi nhánh để xem số liệu — danh sách vẫn hiện mọi chi nhánh.", // DRAFT — Kevin reviews
  "mgmt.snap.unavailable": "Chưa tải được số liệu chi nhánh.", // DRAFT — Kevin reviews
  "mgmt.snap.basis": "Cùng số liệu với Báo cáo → Nhiều chi nhánh. Xu hướng so với kỳ trước cùng độ dài; không áp dụng khi kỳ trước không có doanh thu.", // DRAFT — Kevin reviews
  "set.golive.count": "{ready}/{total} mục đã sẵn sàng", // DRAFT — Kevin reviews
  "set.golive.ready": "Sẵn sàng hoạt động", // DRAFT — Kevin reviews
  "set.golive.waiting": "Đang chờ thiết lập bên ngoài", // DRAFT — Kevin reviews
  "set.sec.waiting": "Đang chờ", // DRAFT — Kevin reviews
  "set.sec.saved": "Đã lưu", // DRAFT — Kevin reviews
  "set.sec.savedNote": "Cài đặt đã lưu và có thể sửa tại đây.", // DRAFT — Kevin reviews
  "set.hist.title": "Lịch sử thay đổi cài đặt (mới nhất trước)", // DRAFT — Kevin reviews
  "set.hist.search": "Tìm mục, thay đổi hoặc người sửa", // DRAFT — Kevin reviews
  "set.hist.anyDates": "Mọi ngày", // DRAFT — Kevin reviews
  "set.hist.count": "{n} thay đổi", // DRAFT — Kevin reviews
  "set.hist.failed": "Không tải được lịch sử thay đổi.", // DRAFT — Kevin reviews
  "set.hist.forbidden": "Không có quyền xem lịch sử thay đổi.", // DRAFT — Kevin reviews
  "set.hist.loading": "Đang tải lịch sử thay đổi…", // DRAFT — Kevin reviews
  "set.hist.none": "Chưa có thay đổi cài đặt nào.", // DRAFT — Kevin reviews
  "set.hist.when": "Thời gian", // DRAFT — Kevin reviews
  "set.hist.area": "Mục", // DRAFT — Kevin reviews
  "set.hist.who": "Người sửa", // DRAFT — Kevin reviews
  "set.hist.changed": "Đã đổi", // DRAFT — Kevin reviews
  "set.area.business_branch": "Doanh nghiệp & Chi nhánh", // DRAFT — Kevin reviews
  "set.area.store_hours": "Giờ mở cửa & Tự đăng xuất", // DRAFT — Kevin reviews
  "set.area.payments_checkout": "Thanh toán & Tính tiền", // DRAFT — Kevin reviews
  "set.area.tips": "Tiền tip", // DRAFT — Kevin reviews
  "set.area.tax": "Thuế", // DRAFT — Kevin reviews
  "set.area.booking": "Đặt lịch & Lịch hẹn", // DRAFT — Kevin reviews
  "set.area.online_ai_booking": "Đặt lịch trực tuyến, Google & AI", // DRAFT — Kevin reviews
  "set.area.technician_app": "Ứng dụng thợ", // DRAFT — Kevin reviews
  "set.area.notifications": "Thông báo & Nhắc lịch", // DRAFT — Kevin reviews
  "set.area.queue_workflow": "Hàng chờ & Quy trình", // DRAFT — Kevin reviews
  "set.area.services_pricing": "Dịch vụ & Giá", // DRAFT — Kevin reviews
  "set.area.technicians_staff": "Thợ & Nhân viên", // DRAFT — Kevin reviews
  "set.area.roles_permissions": "Vai trò, Quyền & Bảo mật", // DRAFT — Kevin reviews
  "set.area.loyalty": "Khách thân thiết & Thành viên", // DRAFT — Kevin reviews
  "set.area.customer_display_devices": "Màn hình khách & Thiết bị", // DRAFT — Kevin reviews
  "set.area.receipts_branding": "Hóa đơn & Thương hiệu", // DRAFT — Kevin reviews
  "set.area.gift_card_settings": "Thẻ quà tặng", // DRAFT — Kevin reviews
  "set.area.subscription_plan": "Gói dịch vụ", // DRAFT — Kevin reviews
  "set.area.audit_logs": "Nhật ký hoạt động", // DRAFT — Kevin reviews
  "set.area.other": "Cài đặt khác", // DRAFT — Kevin reviews
  "mgmt.shift.fallback": "Không đọc được Chấm công — đang hiện số thợ rảnh lúc này", // DRAFT — Kevin reviews
  "ml.custom": "Chọn ngày", // DRAFT — Kevin reviews
  "ml.window": "{from} – {to}, so với {cf} – {ct}", // DRAFT — Kevin reviews
  "rpt.ai.viewList": "Xem danh sách →", // DRAFT — Kevin reviews
  "rpt.mkt.window": "{from} – {to}", // DRAFT — Kevin reviews
  "rpt.mkt.redemptionsAllTime": "lượt dùng tính từ trước đến nay (chưa ghi theo ngày)", // DRAFT — Kevin reviews
  "rpt.mail.failed": "Không gửi được báo cáo.", // DRAFT — Kevin reviews
  "rpt.mail.nowResult": "Gửi báo cáo qua email tới {to}: {result}", // DRAFT — Kevin reviews
  "rpt.mail.status.sent": "đã gửi", // DRAFT — Kevin reviews
  "rpt.mail.status.simulated": "đã ghi lại, chưa gửi (môi trường thử — chưa có nhà cung cấp email)", // DRAFT — Kevin reviews
  "rpt.mail.status.not_configured": "chưa gửi — email chưa được thiết lập", // DRAFT — Kevin reviews
  "rpt.mail.status.failed": "thất bại", // DRAFT — Kevin reviews
  "rpt.mail.status.skipped": "bỏ qua", // DRAFT — Kevin reviews
  "rpt.mail.status.pending": "đang gửi…", // DRAFT — Kevin reviews
  "rpt.mail.scheduledOn": "Đã bật Lên lịch báo cáo. Báo cáo gửi tới email của chính bạn.", // DRAFT — Kevin reviews
  "rpt.mail.scheduledOff": "Đã tắt Lên lịch báo cáo.", // DRAFT — Kevin reviews
  "rpt.mail.noPermission": "Bạn cần quyền xem và xuất báo cáo tài chính.", // DRAFT — Kevin reviews
  "rpt.mail.noEmail": "Tài khoản của bạn chưa có email. Hãy thêm email vào hồ sơ trước.", // DRAFT — Kevin reviews
  "rpt.mail.to": "Gửi tới email tài khoản của bạn: {to}", // DRAFT — Kevin reviews
  "rpt.mail.sender.simulated": "Môi trường thử: email được ghi lại tại đây, không gửi đi.", // DRAFT — Kevin reviews
  "rpt.mail.sender.not_configured": "Email chưa được thiết lập cho hệ thống — sẽ không gửi gì cho tới khi thiết lập.", // DRAFT — Kevin reviews
  "rpt.mail.notRunning": "Máy chủ đang tắt chức năng gửi theo lịch — lịch của bạn đã lưu nhưng sẽ không gửi.", // DRAFT — Kevin reviews
  "rpt.mail.frequency": "Tần suất", // DRAFT — Kevin reviews
  "rpt.mail.hour": "Gửi sau (giờ tiệm)", // DRAFT — Kevin reviews
  "rpt.mail.daily": "Hằng ngày (hôm qua)", // DRAFT — Kevin reviews
  "rpt.mail.weekly": "Hằng tuần (thứ Hai, tuần trước)", // DRAFT — Kevin reviews
  "rpt.mail.update": "Lưu", // DRAFT — Kevin reviews
  "rpt.mail.turnOn": "Bật cho tôi", // DRAFT — Kevin reviews
  "rpt.mail.turnOff": "Tắt", // DRAFT — Kevin reviews
  "rpt.mail.activeLine": "Đang bật: {when}, sau {hour}.", // DRAFT — Kevin reviews
  "rpt.mail.consent": "Chỉ bạn nhận, tại email tài khoản của bạn. Bạn có thể tắt tại đây bất cứ lúc nào.", // DRAFT — Kevin reviews
  "rpt.mail.kind.now": "Gửi báo cáo", // DRAFT — Kevin reviews
  "rpt.mail.kind.scheduled": "Theo lịch", // DRAFT — Kevin reviews
  "mgmt.tasks.overdue": "{n} quá hạn", // DRAFT — Kevin reviews
  "mgmt.tasks.none_overdue": "Không có việc quá hạn", // DRAFT — Kevin reviews
  "mgmt.tasks.forbidden": "Không có quyền xem việc cần theo dõi", // DRAFT — Kevin reviews
  "mgmt.tasks.unavailable": "Không tải được danh sách việc", // DRAFT — Kevin reviews
  "mgmt.health.sub": "Mục Tình trạng thiết lập cần xử lý · {warn} cảnh báo · kiểm tra ngày {date}", // DRAFT — Kevin reviews
  "mgmt.health.forbidden": "Không có quyền xem Tình trạng thiết lập", // DRAFT — Kevin reviews
  "mgmt.health.unavailable": "Không tải được Tình trạng thiết lập", // DRAFT — Kevin reviews
  "mgmt.health.never": "Chưa kiểm tra — mở Tình trạng thiết lập để chạy", // DRAFT — Kevin reviews
  "shell.spacing.compact": "Khoảng cách gọn (máy này)", // DRAFT — Kevin reviews
  "tips.basis": "Tính theo ngày nhận thanh toán (ngày của tiệm) — không phải ngày phân bổ hay ngày trả lương. Tip không bao giờ tính vào doanh số.", // DRAFT — Kevin reviews
  "tips.search": "Tìm thợ", // DRAFT — Kevin reviews
  "tips.noMatch": "Không có thợ khớp “{q}”.", // DRAFT — Kevin reviews
  "ops.liveOps.updatedAt": "cập nhật {t}", // DRAFT — Kevin reviews
  "ops.liveOps.refresh": "Làm mới ngay", // DRAFT — Kevin reviews
  "lgx.impact": "Thiết bị này dùng để", // DRAFT — Kevin reviews
  "lgx.role.card": "Nhận thanh toán thẻ tại quầy của nó — lỗi ở đây có thể làm ngừng thanh toán thẻ tại quầy đó", // DRAFT — Kevin reviews
  "lgx.role.checkout": "Chạy thanh toán và việc quầy lễ tân tại trạm của nó", // DRAFT — Kevin reviews
  "lgx.role.display": "Cho khách xem tổng tiền và lời mời tip khi thanh toán", // DRAFT — Kevin reviews
  "lgx.role.checkin": "Cho khách tự check-in", // DRAFT — Kevin reviews
  "lgx.deviceHistory": "Lịch sử của thiết bị này", // DRAFT — Kevin reviews
  "lgx.deviceOnly": "Chỉ một thiết bị", // DRAFT — Kevin reviews
  "lgx.deviceOnlyClear": "Hiện lại mọi thiết bị", // DRAFT — Kevin reviews
  "locx.next": "Bước tiếp theo", // DRAFT — Kevin reviews
  "locx.step.set_pin": "Đặt ghim bản đồ", // DRAFT — Kevin reviews
  "locx.step.confirm_pin": "Xác nhận ghim bản đồ", // DRAFT — Kevin reviews
  "locx.step.add_address": "Thêm địa chỉ công khai", // DRAFT — Kevin reviews
  "locx.step.add_contact": "Thêm số điện thoại hoặc email công khai", // DRAFT — Kevin reviews
  "locx.step.blocked_by_review": "Trạng thái xét duyệt đang chặn việc đăng", // DRAFT — Kevin reviews
  "locx.step.publish": "Sẵn sàng đăng", // DRAFT — Kevin reviews
  "locx.step.awaiting_review": "Đã đăng, đang chờ xác minh", // DRAFT — Kevin reviews
  "syschk.suppliers.title": "Kiểm tra hệ thống nhà cung cấp", // DRAFT — Kevin reviews
  "syschk.suppliers.duplicate_supplier_names": "Không có hai nhà cung cấp đang hoạt động trùng tên", // DRAFT — Kevin reviews
  "syschk.suppliers.duplicate_supplier_names.fix": "Gộp hoặc đổi tên các bản trùng, hoặc ngừng một bản.", // DRAFT — Kevin reviews
  "syschk.suppliers.supplier_no_contact": "Mỗi nhà cung cấp đang hoạt động có số điện thoại, email hoặc người liên hệ", // DRAFT — Kevin reviews
  "syschk.suppliers.supplier_no_contact.fix": "Thêm số điện thoại, email hoặc người liên hệ cho các nhà cung cấp đó.", // DRAFT — Kevin reviews
  "syschk.suppliers.po_missing_supplier": "Mỗi đơn đặt hàng đã gửi có nhà cung cấp của tiệm này", // DRAFT — Kevin reviews
  "syschk.suppliers.po_missing_supplier.fix": "Mở các đơn đó và chọn nhà cung cấp.", // DRAFT — Kevin reviews
  "syschk.suppliers.open_po_inactive_supplier": "Không có đơn đặt hàng đang mở với nhà cung cấp đã ngừng", // DRAFT — Kevin reviews
  "syschk.suppliers.open_po_inactive_supplier.fix": "Kích hoạt lại nhà cung cấp hoặc hủy đơn.", // DRAFT — Kevin reviews
  "syschk.suppliers.po_total_mismatch": "Tổng đơn đặt hàng khớp với các dòng (số lượng × giá vốn, cộng phí vận chuyển và thuế)", // DRAFT — Kevin reviews
  "syschk.suppliers.po_total_mismatch.fix": "Mở các đơn đó và lưu lại để tính lại tổng.", // DRAFT — Kevin reviews
  "syschk.suppliers.po_past_expected": "Không có đơn đang mở nào quá ngày giao dự kiến", // DRAFT — Kevin reviews
  "syschk.suppliers.po_past_expected.fix": "Hỏi nhà cung cấp và cập nhật ngày dự kiến.", // DRAFT — Kevin reviews
  "syschk.suppliers.po_status_vs_received": "Trạng thái đơn khớp với hàng đã nhận", // DRAFT — Kevin reviews
  "syschk.suppliers.po_status_vs_received.fix": "Xem lại các đơn đó: đơn đã nhận nhưng thiếu dòng, hoặc đơn chưa gửi mà đã nhận hàng.", // DRAFT — Kevin reviews
  "syschk.suppliers.received_without_movement": "Mỗi đơn đã nhận đều đưa hàng vào kho (có phiếu xuất nhập kho)", // DRAFT — Kevin reviews
  "syschk.suppliers.received_without_movement.fix": "Kiểm kê các đơn đó trước khi nhận lại.", // DRAFT — Kevin reviews
  "syschk.suppliers.stale_drafts": "Không có đơn nháp nào quá 30 ngày", // DRAFT — Kevin reviews
  "syschk.suppliers.stale_drafts.fix": "Gửi hoặc xóa các đơn nháp đó.", // DRAFT — Kevin reviews
  "syschk.inventory.usage_without_movement": "Mỗi lần dùng sản phẩm đã ghi đều trừ hàng trong kho (có phiếu xuất nhập kho)", // DRAFT — Kevin reviews
  "syschk.inventory.usage_without_movement.fix": "Kiểm kê các sản phẩm đó và hoàn tác hoặc ghi lại lần dùng.", // DRAFT — Kevin reviews
  "syschk.inventory.usage_technician_not_in_salon": "Mỗi lần dùng sản phẩm đều ghi thợ của tiệm này", // DRAFT — Kevin reviews
  "syschk.inventory.usage_technician_not_in_salon.fix": "Hoàn tác các lần dùng đó và ghi lại cho đúng thợ.", // DRAFT — Kevin reviews
  "syschk.inventory.usage_used_after_recorded": "Không có lần dùng nào có giờ dùng sau giờ ghi", // DRAFT — Kevin reviews
  "syschk.inventory.usage_used_after_recorded.fix": "Kiểm tra giờ dùng của các lần đó; Người dùng gần nhất dựa theo giờ này.", // DRAFT — Kevin reviews
  "syschk.inventory.duplicate_usage_movement": "Không có lần dùng hay dịch vụ nào trừ kho hai lần", // DRAFT — Kevin reviews
  "syschk.inventory.duplicate_usage_movement.fix": "Kiểm kê các sản phẩm đó và sửa phiếu bị thừa.", // DRAFT — Kevin reviews
  "syschk.inventory.received_over_ordered_lines": "Hàng nhận theo đơn đặt hàng khớp với số lượng đã nhận trên các dòng", // DRAFT — Kevin reviews
  "syschk.inventory.received_over_ordered_lines.fix": "So đơn với kết quả kiểm kê và sửa phần nhận thừa.", // DRAFT — Kevin reviews
  "dfx.hk.duplicate_names": "Thiết bị trùng tên trong cùng chi nhánh (không bao giờ tự gộp)", // DRAFT — Kevin reviews
  "ops.qa.needsPermission": "Vai trò của bạn không dùng được — cần quyền: {p}", // DRAFT — Kevin reviews
  "ops.qa.locked": "Không có quyền", // DRAFT — Kevin reviews
  "dfx.ver.current": "Ứng dụng {v}", // DRAFT — Kevin reviews
  "dfx.ver.older": "Phiên bản ứng dụng cũ hơn {v} — mới nhất trên thiết bị của bạn là {n}", // DRAFT — Kevin reviews
  "dfx.ver.unreported": "Thiết bị chưa báo phiên bản ứng dụng", // DRAFT — Kevin reviews
  "dfx.ver.policy": "Phiên bản ứng dụng được so với phiên bản mới nhất mà các thiết bị trong danh sách báo về. Chưa đặt phiên bản tối thiểu nên không bắt buộc cập nhật — hãy cập nhật trên thiết bị khi tiện.", // DRAFT — Kevin reviews
  "lgx.env.production": "Thanh toán: Thật (Production)", // DRAFT — Kevin reviews
  "lgx.env.productionWhy": "sự kiện thanh toán ở đây đến từ tài khoản {p} thật", // DRAFT — Kevin reviews
  "lgx.env.sandbox": "Thanh toán: Thử nghiệm (Sandbox / UAT)", // DRAFT — Kevin reviews
  "lgx.env.sandboxWhy": "sự kiện thanh toán ở đây là giao dịch thử trên {p} — không phải thật và không phải bằng chứng chứng nhận", // DRAFT — Kevin reviews
  "lgx.env.none": "Thanh toán: chưa thiết lập", // DRAFT — Kevin reviews
  "lgx.env.noneWhy": "chưa cấu hình tài khoản thanh toán nên không có sự kiện thanh toán", // DRAFT — Kevin reviews
  "lgx.env.src.branch": "tài khoản riêng của chi nhánh này", // DRAFT — Kevin reviews
  "lgx.env.src.salon": "tài khoản mặc định của tiệm", // DRAFT — Kevin reviews
  "lgx.env.cert": "Xác nhận production: {s}", // DRAFT — Kevin reviews
  "lgx.env.noCert": "Chưa ghi nhận xác nhận production", // DRAFT — Kevin reviews
  "lgx.env.certStatus.testing": "đang thử", // DRAFT — Kevin reviews
  "lgx.env.certStatus.submitted": "đã nộp", // DRAFT — Kevin reviews
  "lgx.env.certStatus.changes_requested": "cần chỉnh sửa", // DRAFT — Kevin reviews
  "lgx.env.certStatus.approved": "đã duyệt", // DRAFT — Kevin reviews
  "lgx.env.certStatus.revoked": "đã thu hồi", // DRAFT — Kevin reviews
  "lgx.env.proc.fiserv": "Fiserv", // DRAFT — Kevin reviews
  "lgx.env.proc.cardpointe": "CardPointe", // DRAFT — Kevin reviews
  "lgx.env.proc.clover": "Clover", // DRAFT — Kevin reviews
  "lgx.env.proc.none": "không có", // DRAFT — Kevin reviews
  "ops.sched.spread.none": "Chưa có dữ liệu độ chênh thời gian cho dịch vụ này.", // DRAFT — Kevin reviews
  "ops.sched.spread.too_few": "Quá ít lượt", // DRAFT — Kevin reviews
  "ops.sched.spread.steady": "Thời gian ổn định", // DRAFT — Kevin reviews
  "ops.sched.spread.variable": "Thời gian có chênh lệch", // DRAFT — Kevin reviews
  "ops.sched.spread.wide": "Thời gian chênh lệch nhiều", // DRAFT — Kevin reviews
  "ops.sched.spread.line": "{n} lượt · thường {median} phút · nửa giữa {p25}–{p75} phút · 9/10 lượt trong {p90} phút", // DRAFT — Kevin reviews
  "ops.sched.spread.check": "Hỏi lại thợ trước khi dựa vào thời gian này.", // DRAFT — Kevin reviews
  "ops.sched.affected": "Ảnh hưởng {a} lịch hẹn và {n} thợ: {names}", // DRAFT — Kevin reviews
  "syschk.discounts.redemption_pending_on_paid": "Không còn lượt dùng nào đang chờ trên phiếu đã thanh toán", // DRAFT — Kevin reviews
  "syschk.discounts.redemption_pending_on_paid.fix": "Mở phiếu trong Giao dịch; ưu đãi phải được xác nhận khi thanh toán — báo hỗ trợ nếu vẫn đang chờ.", // DRAFT — Kevin reviews
  "syschk.discounts.redeemed_ticket_unpaid": "Không có lượt dùng nào được tính trên phiếu chưa thanh toán", // DRAFT — Kevin reviews
  "syschk.discounts.redeemed_ticket_unpaid.fix": "Mở phiếu: hoàn tất hoặc hủy để lượt dùng được xác nhận hoặc trả lại.", // DRAFT — Kevin reviews
  "syschk.discounts.redemption_bad_timestamps": "Thời gian các lượt dùng đúng thứ tự", // DRAFT — Kevin reviews
  "syschk.discounts.redemption_bad_timestamps.fix": "Có lượt dùng được xác nhận hoặc hoàn lại trước khi áp dụng, hoặc ghi ngày tương lai — kiểm tra đồng hồ thiết bị và báo hỗ trợ.", // DRAFT — Kevin reviews
  "syschk.discounts.coupon_use_count_drift": "Số lần dùng của mỗi mã khớp với các lượt dùng đã ghi", // DRAFT — Kevin reviews
  "syschk.discounts.coupon_use_count_drift.fix": "Một lần ghi bị lặp hoặc bị mất đã làm lệch bộ đếm — xem lại các lượt dùng của mã trước khi khách khác dùng.", // DRAFT — Kevin reviews
  "syschk.discounts.single_use_code_reused": "Không có mã dùng một lần nào bị dùng hơn một lần", // DRAFT — Kevin reviews
  "syschk.discounts.single_use_code_reused.fix": "Thu hồi mã và xem lại cả hai phiếu.", // DRAFT — Kevin reviews
  "ops.devices.regConflict": "{register} đang do {others} phục vụ. Nếu {label} cũng phục vụ quầy này, lần quẹt thẻ bắt đầu tại quầy có thể đi đến một trong hai máy.", // DRAFT — Kevin reviews
  "ops.devices.regConflictYes": "Vẫn gán", // DRAFT — Kevin reviews
  "ops.devices.pairConflict": "{register} đang do {others} phục vụ. Ghép máy này vào quầy đó nghĩa là hai máy cùng phục vụ một quầy.", // DRAFT — Kevin reviews
  "syschk.discounts.live_deal_branch_closed": "Không có ưu đãi đang chạy nào thuộc chi nhánh đã đóng hoặc đã xóa", // DRAFT — Kevin reviews
  "syschk.discounts.live_deal_branch_closed.fix": "Chi nhánh không còn mở nhưng ưu đãi vẫn hiện là đang chạy — hãy kết thúc ưu đãi hoặc chuyển sang chi nhánh đang mở.", // DRAFT — Kevin reviews
  "syschk.discounts.live_deal_service_unavailable": "Mọi ưu đãi đang chạy chỉ áp dụng cho dịch vụ vẫn còn cung cấp", // DRAFT — Kevin reviews
  "syschk.discounts.live_deal_service_unavailable.fix": "Một dịch vụ của ưu đãi đã được lưu trữ, tắt hoặc xóa — cập nhật dịch vụ của ưu đãi để khách không thấy mức giảm không thể dùng.", // DRAFT — Kevin reviews
  "syschk.download": "Tải báo cáo", // DRAFT — Kevin reviews
  "syschk.csv.checkedAt": "Kiểm tra lúc", // DRAFT — Kevin reviews
  "syschk.csv.scope": "Phạm vi", // DRAFT — Kevin reviews
  "syschk.csv.overall": "Kết quả", // DRAFT — Kevin reviews
  "syschk.csv.check": "Mục kiểm tra", // DRAFT — Kevin reviews
  "syschk.csv.state": "Trạng thái", // DRAFT — Kevin reviews
  "syschk.csv.count": "Số dòng tìm thấy", // DRAFT — Kevin reviews
  "syschk.csv.fix": "Cần làm gì", // DRAFT — Kevin reviews
  "syschk.technicians.training_overdue": "Không có khóa đào tạo nào đang mở mà quá hạn", // DRAFT — Kevin reviews
  "syschk.technicians.training_overdue.fix": "Nhắc những người đó hoặc dời ngày hạn.", // DRAFT — Kevin reviews
  "syschk.technicians.training_certificate_unlinked": "Mọi khóa học đã hoàn thành có cấp chứng chỉ đều được liên kết với chứng chỉ", // DRAFT — Kevin reviews
  "syschk.technicians.training_certificate_unlinked.fix": "Ghi chứng chỉ vào thẻ Đào tạo của người đó.", // DRAFT — Kevin reviews
  "syschk.technicians.verified_certificate_no_date": "Mọi chứng chỉ đã xác minh đều có ngày cấp", // DRAFT — Kevin reviews
  "syschk.technicians.verified_certificate_no_date.fix": "Thêm ngày cấp thật ghi trên chứng chỉ.", // DRAFT — Kevin reviews
  "syschk.technicians.verified_certificate_expired": "Không có chứng chỉ đã xác minh nào quá ngày hết hạn", // DRAFT — Kevin reviews
  "syschk.technicians.verified_certificate_expired.fix": "Xin chứng chỉ đã gia hạn rồi xác minh lại.", // DRAFT — Kevin reviews
  "syschk.technicians.profile_change_waiting": "Không có thay đổi hồ sơ nào chờ duyệt quá 7 ngày", // DRAFT — Kevin reviews
  "syschk.technicians.profile_change_waiting.fix": "Duyệt hoặc từ chối các thay đổi hồ sơ đang chờ.", // DRAFT — Kevin reviews
  "syschk.inventory.acknowledged_still_low": "Không có cảnh báo tồn kho đã xác nhận nào vẫn ở mức cần đặt hàng (các mục này vẫn hiện trên thẻ bảng điều khiển nhưng không có trong số trên thanh bên)", // DRAFT — Kevin reviews
  "syschk.inventory.acknowledged_still_low.fix": "Đặt hoặc nhận thêm các sản phẩm đó; bảng điều khiển và thanh bên sẽ khớp lại khi tồn kho vượt mức cần đặt hàng.", // DRAFT — Kevin reviews
  "syschk.inventory.open_alert_not_live": "Không còn cảnh báo tồn kho mở nào cho sản phẩm đã nhập thêm, đã lưu trữ hoặc không có mức đặt hàng", // DRAFT — Kevin reviews
  "syschk.inventory.open_alert_not_live.fix": "Mở Cảnh báo tồn kho và đóng các cảnh báo đó; các con số đã theo tồn kho thực tế.", // DRAFT — Kevin reviews
  "syschk.catalog.addon_paid_no_technician": "Mọi dịch vụ thêm đã bán trên phiếu đã thanh toán đều ghi thợ thực hiện", // DRAFT — Kevin reviews
  "syschk.catalog.addon_paid_no_technician.fix": "Mở các phiếu đó và chọn thợ, để hoa hồng và tiền tip được chia đúng.", // DRAFT — Kevin reviews
  "syschk.catalog.addon_technician_not_on_ticket": "Mọi dịch vụ thêm đã bán đều ghi cho thợ đã làm dịch vụ trên phiếu đó", // DRAFT — Kevin reviews
  "syschk.catalog.addon_technician_not_on_ticket.fix": "Kiểm tra các phiếu đó: dịch vụ thêm có thể ghi nhầm thợ.", // DRAFT — Kevin reviews
  "syschk.catalog.addon_without_base_service": "Không phiếu nào có dịch vụ thêm mà thiếu dịch vụ chính", // DRAFT — Kevin reviews
  "syschk.catalog.addon_without_base_service.fix": "Thêm dịch vụ chính vào các phiếu đó hoặc bỏ dịch vụ thêm trước khi thanh toán.", // DRAFT — Kevin reviews
  "syschk.catalog.addon_duplicate_charge": "Không phiếu nào tính cùng một dịch vụ thêm hai lần cho cùng một thợ", // DRAFT — Kevin reviews
  "syschk.catalog.addon_duplicate_charge.fix": "Xem lại các phiếu đó; nếu chỉ làm một lần, hãy bỏ dòng thừa (hoặc hoàn tiền nếu đã thanh toán).", // DRAFT — Kevin reviews
  "lgx.trace": "Chuỗi sự kiện của yêu cầu này", // DRAFT — Kevin reviews
  "lgx.traceOnly": "Chỉ một chuỗi sự kiện", // DRAFT — Kevin reviews
  "lgx.traceOnlyClear": "Hiện lại mọi yêu cầu", // DRAFT — Kevin reviews
  "syschk.technicians.clocked_in_not_active": "Không có thợ đã lưu trữ hoặc ngưng hoạt động nào vẫn đang chấm công vào", // DRAFT — Kevin reviews
  "syschk.technicians.clocked_in_not_active.fix": "Chấm công ra cho những thợ đó (hoặc khôi phục họ) trong Chấm công.", // DRAFT — Kevin reviews
  "syschk.technicians.punch_open_past_day": "Không có lượt chấm công vào nào còn mở từ ngày trước", // DRAFT — Kevin reviews
  "syschk.technicians.punch_open_past_day.fix": "Đóng các lượt đó với giờ ra đúng trong Chấm công.", // DRAFT — Kevin reviews
  "syschk.technicians.no_service_mapping": "Mỗi thợ đang hoạt động được duyệt ít nhất một dịch vụ", // DRAFT — Kevin reviews
  "syschk.technicians.no_service_mapping.fix": "Gán dịch vụ cho họ trong Trợ lý gán dịch vụ.", // DRAFT — Kevin reviews
  "syschk.technicians.certification_expired": "Không có thợ đang hoạt động nào có chứng chỉ hết hạn", // DRAFT — Kevin reviews
  "syschk.technicians.certification_expired.fix": "Tải lên chứng chỉ đã gia hạn hoặc đánh dấu chứng chỉ cũ đã được thay thế.", // DRAFT — Kevin reviews
  "syschk.inventory.recipe_inactive_product": "Không có công thức dịch vụ nào dùng sản phẩm đã lưu trữ hoặc ngưng hoạt động", // DRAFT — Kevin reviews
  "syschk.inventory.recipe_inactive_product.fix": "Mở Kho hàng → Công thức và thay sản phẩm trong công thức của các dịch vụ đó.", // DRAFT — Kevin reviews
  "syschk.inventory.recipe_short_deduction": "Khi hoàn tất dịch vụ, kho đã trừ đủ lượng theo công thức (30 ngày qua)", // DRAFT — Kevin reviews
  "syschk.inventory.recipe_short_deduction.fix": "Kho bị thiếu khi làm dịch vụ — hãy kiểm đếm lại sản phẩm và nhập thêm hàng; lượng đã trừ không bị thay đổi.", // DRAFT — Kevin reviews
  "lgx.export.btn": "Xuất CSV đã che dữ liệu", // DRAFT — Kevin reviews
  "lgx.export.hint": "Một khoảng ngày tối đa 31 ngày, theo bộ lọc đang hiển thị. Nội dung nhạy cảm được che và việc xuất được ghi lại.", // DRAFT — Kevin reviews
  "lgx.export.done": "Đã xuất nhật ký đã che dữ liệu. Việc xuất đã được ghi lại.", // DRAFT — Kevin reviews
  "lgx.export.failed": "Không thể xuất nhật ký.", // DRAFT — Kevin reviews
  "ops.serving.insight.booking_conflict": "{name} có lịch hẹn sau {minutes} phút nhưng còn cần khoảng {remaining} phút ({count} xung đột)", // DRAFT — Kevin reviews
  "ops.serving.insightSub.booking_conflict": "Xem bảng Đặt lịch trước khi khách tiếp theo đến — không có gì bị tự động dời.", // DRAFT — Kevin reviews
  "syschk.payments.non_card_in_processor_batch": "Không có thanh toán tiền mặt hoặc thẻ quà tặng nào gắn với lô của đơn vị xử lý thẻ", // DRAFT — Kevin reviews
  "syschk.payments.non_card_in_processor_batch.fix": "Tiền mặt được tính trong ngăn kéo tiền, thẻ quà tặng được tính trong sổ của nó. Mở từng thanh toán và sửa liên kết lô để tiền không bị tính hai lần.", // DRAFT — Kevin reviews
  "syschk.memberships.benefit_balance_negative": "Không có hội viên nào dùng nhiều lượt ưu đãi hơn số được cấp", // DRAFT — Kevin reviews
  "syschk.memberships.benefit_balance_negative.fix": "Mở hội viên, so lịch sử lượt với các lần ghé và sửa bằng một điều chỉnh đã được duyệt.", // DRAFT — Kevin reviews
  "syschk.memberships.redemption_ledger_mismatch": "Mỗi ưu đãi đã dùng đều có cả hồ sơ lần ghé và mục trừ lượt", // DRAFT — Kevin reviews
  "syschk.memberships.redemption_ledger_mismatch.fix": "Mở hội viên và phiếu: lần ghé không có mục trừ lượt, hoặc một lượt bị trừ hai lần, cần quản lý xem lại.", // DRAFT — Kevin reviews
  "syschk.memberships.reservation_open_on_closed_ticket": "Không có lượt ưu đãi nào còn bị giữ cho phiếu đã đóng", // DRAFT — Kevin reviews
  "syschk.memberships.reservation_open_on_closed_ticket.fix": "Bỏ giữ lượt hoặc ghi nhận việc dùng lượt cho phiếu đó.", // DRAFT — Kevin reviews
  "syschk.memberships.redeemed_on_voided_ticket": "Không có ưu đãi nào vẫn bị tính là đã dùng trên phiếu đã hủy", // DRAFT — Kevin reviews
  "syschk.memberships.redeemed_on_voided_ticket.fix": "Xem lại phiếu đã hủy và trả lại lượt nếu dịch vụ không diễn ra.", // DRAFT — Kevin reviews
  "syschk.memberships.payment_pending_stuck": "Không có khoản thu thẻ hội viên nào chờ kết quả quá một ngày", // DRAFT — Kevin reviews
  "syschk.memberships.payment_pending_stuck.fix": "Kiểm tra khoản thu với nhà cung cấp thanh toán, rồi đánh dấu thành công hoặc thất bại.", // DRAFT — Kevin reviews
  "syschk.memberships.charged_after_cancel": "Không có khoản gia hạn nào được thu sau khi thẻ hội viên đã hủy", // DRAFT — Kevin reviews
  "syschk.memberships.charged_after_cancel.fix": "Xem lại khoản thu và hoàn tiền nếu việc hủy vẫn giữ nguyên.", // DRAFT — Kevin reviews
  "sox.cap.title": "Rủi ro công suất theo giờ", // DRAFT — Kevin reviews
  "sox.cap.show": "Xem công suất", // DRAFT — Kevin reviews
  "sox.cap.hide": "Ẩn", // DRAFT — Kevin reviews
  "sox.cap.intro": "Tùy chọn: mỗi giờ, số phút có thợ so với nhu cầu đã đặt và từng kỹ năng so với số thợ đủ điều kiện đang trong ca. Chỉ xem — đặt và dời lịch trên bảng đặt lịch.", // DRAFT — Kevin reviews
  "sox.cap.loading": "Đang tải…", // DRAFT — Kevin reviews
  "sox.cap.none": "Không có dữ liệu công suất cho ngày này.", // DRAFT — Kevin reviews
  "sox.cap.failed": "Không tải được công suất.", // DRAFT — Kevin reviews
  "sox.cap.totals": "Quá công suất: {over} giờ · Sát: {tight} giờ · Có lịch mà không ai trong ca: {unstaffed} giờ · Thiếu kỹ năng: {skill} giờ", // DRAFT — Kevin reviews
  "sox.cap.risk.ok": "Ổn", // DRAFT — Kevin reviews
  "sox.cap.risk.tight": "Sát", // DRAFT — Kevin reviews
  "sox.cap.risk.over": "Quá tải", // DRAFT — Kevin reviews
  "sox.cap.risk.unstaffed": "Không có thợ", // DRAFT — Kevin reviews
  "sox.cap.risk.closed": "Đóng", // DRAFT — Kevin reviews
  "sox.cap.skillShortShort": "kỹ năng", // DRAFT — Kevin reviews
  "sox.cap.detail": "{hour}: {techs} thợ trong ca · có thợ {staffed} phút · đã đặt {booked} phút · đang giữ {held} phút · sử dụng {use}", // DRAFT — Kevin reviews
  "sox.cap.unassigned": "{n} phút đã đặt chưa có thợ", // DRAFT — Kevin reviews
  "sox.cap.col.skill": "Kỹ năng (nhóm dịch vụ)", // DRAFT — Kevin reviews
  "sox.cap.col.demand": "Nhu cầu", // DRAFT — Kevin reviews
  "sox.cap.col.needed": "Số thợ cần", // DRAFT — Kevin reviews
  "sox.cap.col.qualified": "Thợ đủ điều kiện trong ca", // DRAFT — Kevin reviews
  "sox.cap.min": "{n} phút", // DRAFT — Kevin reviews
  "sox.cap.short": "thiếu", // DRAFT — Kevin reviews
  "sox.cap.noDemand": "Không có lịch trong giờ này.", // DRAFT — Kevin reviews
  "sox.cap.pick": "Chạm vào một giờ để xem kỹ năng.", // DRAFT — Kevin reviews
  "sox.cap.basis": "Có thợ = ca làm trừ giờ nghỉ, giờ bị chặn và ngày nghỉ đã duyệt. Sát = từ {pct}% số phút có thợ đã được đặt hoặc giữ. Đủ điều kiện = cùng quy tắc kỹ năng mà bộ tối ưu dùng. Không có gì ở đây thay đổi lịch.", // DRAFT — Kevin reviews
  "syschk.memberships.invoice_collection_not_paid": "Mọi khoản thu hội viên bằng hóa đơn vẫn có hóa đơn đã thanh toán đi kèm", // DRAFT — Kevin reviews
  "syschk.memberships.invoice_collection_not_paid.fix": "Mở hóa đơn: nếu đã hoàn tiền, hủy hoặc ghi có, hãy hoàn lại hoặc thu lại khoản hội viên.", // DRAFT — Kevin reviews
  "syschk.memberships.invoice_collection_over_invoice": "Không có khoản thu hội viên nào lớn hơn số tiền hóa đơn đã thu", // DRAFT — Kevin reviews
  "syschk.memberships.invoice_collection_over_invoice.fix": "So sánh khoản thu hội viên với tổng hóa đơn và sửa bên bị sai.", // DRAFT — Kevin reviews
  "syschk.memberships.card_collection_without_ref": "Mọi khoản thu hoặc hoàn tiền hội viên bằng thẻ đều có mã tham chiếu của bộ xử lý", // DRAFT — Kevin reviews
  "syschk.memberships.card_collection_without_ref.fix": "Tìm giao dịch trong báo cáo của bộ xử lý để đối chiếu với khoản tiền gửi.", // DRAFT — Kevin reviews
  "syschk.memberships.duplicate_member_notice": "Không hội viên nào nhận cùng một thông báo hội viên hai lần", // DRAFT — Kevin reviews
  "syschk.memberships.duplicate_member_notice.fix": "Báo cho bộ phận hỗ trợ: cơ chế mỗi sự kiện một thông báo đã không giữ được với những hội viên này.", // DRAFT — Kevin reviews
  "syschk.memberships.failed_charge_not_told": "Mọi khoản thu hội viên bị từ chối trong 30 ngày qua đều đã báo cho hội viên", // DRAFT — Kevin reviews
  "syschk.memberships.failed_charge_not_told.fix": "Liên hệ những hội viên này về khoản thanh toán bị từ chối và nhờ họ cập nhật thẻ.", // DRAFT — Kevin reviews
  "syschk.memberships.branch_or_plan_other_salon": "Mọi thẻ hội viên đều dùng chi nhánh và gói của chính tiệm này", // DRAFT — Kevin reviews
  "syschk.memberships.branch_or_plan_other_salon.fix": "Báo ngay cho bộ phận hỗ trợ: những thẻ hội viên này trỏ đến chi nhánh hoặc gói của tiệm khác.", // DRAFT — Kevin reviews
  "syschk.memberships.money_rows_other_salon": "Không có khoản thu, tín dụng hay lần sử dụng hội viên nào bị ghi vào tiệm khác", // DRAFT — Kevin reviews
  "syschk.memberships.money_rows_other_salon.fix": "Báo ngay cho bộ phận hỗ trợ: những dòng này bị ghi nhầm tiệm.", // DRAFT — Kevin reviews
  "dfx.route.title": "Kiểm tra định tuyến thanh toán", // DRAFT — Kevin reviews
  "dfx.route.v.ready": "Quầy thanh toán có thể gửi khoản thanh toán đến máy này ngay", // DRAFT — Kevin reviews
  "dfx.route.v.busy": "Đang được giữ — một quầy khác đang dùng; quầy thứ hai sẽ được báo là máy bận", // DRAFT — Kevin reviews
  "dfx.route.v.no_register": "Chưa ghép với quầy nào — không quầy thanh toán nào gửi đến được", // DRAFT — Kevin reviews
  "dfx.route.v.no_processor": "Chi nhánh này chưa chọn bộ xử lý thanh toán", // DRAFT — Kevin reviews
  "dfx.route.v.not_ready": "Chưa sẵn sàng — máy đang mất kết nối, bị tắt hoặc chưa từng phản hồi", // DRAFT — Kevin reviews
  "dfx.route.register": "Ghép với quầy", // DRAFT — Kevin reviews
  "dfx.route.paired": "Đã ghép với quầy", // DRAFT — Kevin reviews
  "dfx.route.notPaired": "Chưa ghép", // DRAFT — Kevin reviews
  "dfx.route.reserved": "Giữ máy", // DRAFT — Kevin reviews
  "dfx.route.reservedBy.ticket": "Đang được một lần thanh toán giữ đến {t}", // DRAFT — Kevin reviews
  "dfx.route.reservedBy.display": "Đang được màn hình khách giữ đến {t}", // DRAFT — Kevin reviews
  "dfx.route.reservedBy.other": "Đang được giữ đến {t}", // DRAFT — Kevin reviews
  "dfx.route.free": "Trống", // DRAFT — Kevin reviews
  "dfx.route.processor": "Bộ xử lý", // DRAFT — Kevin reviews
  "dfx.route.noProcessor": "Chưa đặt", // DRAFT — Kevin reviews
  "dfx.route.ping": "Lần kiểm tra máy gần nhất", // DRAFT — Kevin reviews
  "dfx.route.pingOk": "Có phản hồi", // DRAFT — Kevin reviews
  "dfx.route.pingFailed": "Không phản hồi", // DRAFT — Kevin reviews
  "dfx.route.pingNever": "Chưa từng kiểm tra", // DRAFT — Kevin reviews
  "dfx.route.note": "Chỉ xem: không gửi gì đến máy và không có khoản tiền nào được chuyển từ đây.", // DRAFT — Kevin reviews
  "dfx.route.gateway": "Cổng thanh toán", // DRAFT — Kevin reviews
  "dfx.proc.clover": "Clover", // DRAFT — Kevin reviews
  "dfx.proc.fiserv": "Fiserv", // DRAFT — Kevin reviews
  "dfx.proc.cardpointe": "Fiserv CardPointe", // DRAFT — Kevin reviews
  "dfx.proc.manual": "Thủ công", // DRAFT — Kevin reviews
  "dfx.env.sandbox": "Thử nghiệm / UAT", // DRAFT — Kevin reviews
  "dfx.env.production": "Chính thức", // DRAFT — Kevin reviews
  "syschk.memberships.redeemed_for_other_customer": "Mọi quyền lợi hội viên đều được dùng trên hóa đơn của chính hội viên", // DRAFT — Kevin reviews
  "syschk.memberships.redeemed_for_other_customer.fix": "Kiểm tra các hóa đơn đó: nếu quyền lợi được dùng cho người khác, hãy hoàn lại hoặc ghi rõ lý do.", // DRAFT — Kevin reviews
  "syschk.memberships.redemption_line_other_ticket": "Dịch vụ của mỗi lần sử dụng quyền lợi nằm đúng trên hóa đơn đã ghi", // DRAFT — Kevin reviews
  "syschk.memberships.redemption_line_other_ticket.fix": "Báo cho bộ phận hỗ trợ: những lần sử dụng này trỏ đến dịch vụ trên một hóa đơn khác.", // DRAFT — Kevin reviews
  "syschk.memberships.live_membership_archived_customer": "Không có thẻ hội viên còn hiệu lực nào nằm trên hồ sơ khách đã lưu trữ", // DRAFT — Kevin reviews
  "syschk.memberships.live_membership_archived_customer.fix": "Chuyển thẻ hội viên sang hồ sơ hiện tại của khách (gộp hồ sơ) hoặc kết thúc thẻ.", // DRAFT — Kevin reviews
  "ops.liveOps.trend.why": "Vì sao?", // DRAFT — Kevin reviews
  "ops.liveOps.trend.whyAria": "Điều gì đã thay đổi trong xu hướng này", // DRAFT — Kevin reviews
  "ops.liveOps.trend.whyTitle": "Điều gì đã thay đổi — doanh thu & lịch hẹn", // DRAFT — Kevin reviews
  "ops.liveOps.trend.source": "Doanh thu: các khoản thanh toán có trạng thái {statuses}, tính theo ngày của tiệm ({tz}).", // DRAFT — Kevin reviews
  "ops.liveOps.trend.apptSource": "Lịch hẹn: các lượt đặt trên lịch của mỗi ngày (mọi trạng thái).", // DRAFT — Kevin reviews
  "ops.liveOps.trend.window": "Hiển thị: {from} – {to} ({days} ngày). So với: {pfrom} – {pto}.", // DRAFT — Kevin reviews
  "ops.liveOps.trend.revUp": "Doanh thu {cur}, tăng {diff} so với {prev} ({pct}).", // DRAFT — Kevin reviews
  "ops.liveOps.trend.revDown": "Doanh thu {cur}, giảm {diff} so với {prev} ({pct}).", // DRAFT — Kevin reviews
  "ops.liveOps.trend.revSame": "Doanh thu {cur}, bằng với kỳ trước.", // DRAFT — Kevin reviews
  "ops.liveOps.trend.revNoBase": "Doanh thu {cur}; kỳ trước không có doanh thu nên không có tỷ lệ phần trăm.", // DRAFT — Kevin reviews
  "ops.liveOps.trend.appts": "Lịch hẹn: {cur} so với {prev} ở kỳ trước.", // DRAFT — Kevin reviews
  "ops.liveOps.trend.peak": "Ngày cao nhất: {day} ({amount}).", // DRAFT — Kevin reviews
  "ops.liveOps.trend.inProgress": "Khoảng thời gian kết thúc hôm nay, vẫn đang diễn ra — số liệu còn có thể thay đổi.", // DRAFT — Kevin reviews
  "ops.liveOps.trend.readOnly": "Chỉ để giải thích — không thay đổi gì; quyết định và tiền vẫn do nhân viên của bạn xử lý.", // DRAFT — Kevin reviews
  "ops.liveOps.trend.vsPrev": "so với {days} ngày trước đó", // DRAFT — Kevin reviews
  "syschk.technicians.sync_booking_tech_inactive": "Không có lịch hẹn sắp tới nào do thợ đã lưu trữ hoặc ngừng hoạt động giữ", // DRAFT — Kevin reviews
  "syschk.technicians.sync_booking_tech_inactive.fix": "Chuyển các lịch hẹn đó sang thợ đang hoạt động trên lịch đặt hẹn, hoặc khôi phục thợ.", // DRAFT — Kevin reviews
  "syschk.technicians.sync_queue_tech_inactive": "Không có khách đang chờ nào được giao cho thợ đã lưu trữ hoặc ngừng hoạt động", // DRAFT — Kevin reviews
  "syschk.technicians.sync_queue_tech_inactive.fix": "Giao lại các khách đó từ Hàng chờ khách.", // DRAFT — Kevin reviews
  "syschk.technicians.sync_workforce_role_stale": "Trạng thái trực tiếp của mọi thợ đã lưu trữ hoặc ngừng hoạt động cho biết họ không còn làm ở đây", // DRAFT — Kevin reviews
  "syschk.technicians.sync_workforce_role_stale.fix": "Đặt lại trạng thái của thợ từ mục Thợ (ví dụ Ngừng hoạt động) để hàng chờ và Ứng dụng Thợ nhận được.", // DRAFT — Kevin reviews
  "syschk.technicians.sync_availability_mismatch": "Tình trạng sẵn sàng của từng thợ khớp với giờ chấm công (đã chấm công ra = ngoài ca)", // DRAFT — Kevin reviews
  "syschk.technicians.sync_availability_mismatch.fix": "Chấm công vào hoặc ra lại cho thợ từ Chấm công để hàng chờ và Ứng dụng Thợ khớp nhau.", // DRAFT — Kevin reviews
  "syschk.technicians.sync_events_delayed": "Cập nhật lịch hẹn, hàng chờ và thợ đến các ứng dụng trong vòng 5 phút", // DRAFT — Kevin reviews
  "syschk.technicians.sync_events_delayed.fix": "Có cập nhật đang chờ hoặc gửi không thành công. Hãy làm mới màn hình; nếu vẫn còn, liên hệ hỗ trợ — không mất dữ liệu nào.", // DRAFT — Kevin reviews
  "ops.liveOps.prio.btn": "⚑ {n} việc cần xử lý", // DRAFT — Kevin reviews
  "ops.liveOps.prio.clear": "✓ Không có việc gấp", // DRAFT — Kevin reviews
  "ops.liveOps.prio.title": "Cần xử lý ngay", // DRAFT — Kevin reviews
  "ops.liveOps.prio.k.checkout_waiting": "Đang chờ thanh toán", // DRAFT — Kevin reviews
  "ops.liveOps.prio.k.long_wait": "Chờ lâu", // DRAFT — Kevin reviews
  "ops.liveOps.prio.k.staffing_gap": "Thiếu thợ", // DRAFT — Kevin reviews
  "ops.liveOps.prio.k.overdue_appointment": "Lịch hẹn trễ", // DRAFT — Kevin reviews
  "ops.liveOps.prio.k.message_waiting": "Tin nhắn đang chờ", // DRAFT — Kevin reviews
  "ops.liveOps.prio.d.checkout_waiting": "Sẵn sàng thanh toán nhưng chưa trả hơn {m} phút", // DRAFT — Kevin reviews
  "ops.liveOps.prio.d.long_wait": "Khách trong hàng chờ hơn {m} phút", // DRAFT — Kevin reviews
  "ops.liveOps.prio.d.staffing_gap": "Số khách đang chờ trừ số thợ đang rảnh", // DRAFT — Kevin reviews
  "ops.liveOps.prio.d.overdue_appointment": "Đã quá giờ hẹn hơn {m} phút mà khách chưa đến", // DRAFT — Kevin reviews
  "ops.liveOps.prio.d.message_waiting": "Tin nhắn của khách chờ trả lời hơn {m} phút", // DRAFT — Kevin reviews
  "ops.liveOps.prio.oldest": "lâu nhất {m} phút", // DRAFT — Kevin reviews
  "ops.liveOps.prio.open": "Mở", // DRAFT — Kevin reviews
  "ops.liveOps.prio.note": "Chỉ đếm số — mở một dòng sẽ đưa bạn tới mục quản lý việc đó; không thay đổi gì từ đây.", // DRAFT — Kevin reviews
  "acx.find.title": "Tìm trong Tài khoản", // DRAFT — Kevin reviews
  "acx.find.ph": "Tìm một cài đặt tài khoản — ví dụ mật khẩu, hóa đơn, điện thoại", // DRAFT — Kevin reviews
  "acx.find.scope": "Chỉ tìm các trang và cài đặt Tài khoản bạn được mở. Không bao giờ tìm dữ liệu tiệm hay tiệm khác.", // DRAFT — Kevin reviews
  "acx.find.none": "Không có trang hay cài đặt Tài khoản nào khớp.", // DRAFT — Kevin reviews
  "acx.find.page": "Trang", // DRAFT — Kevin reviews
  "acx.find.onThisPage": "Trên trang này", // DRAFT — Kevin reviews
  "acx.find.people": "Tìm một người? Tìm nhân viên theo tên hoặc số điện thoại", // DRAFT — Kevin reviews
  "acx.find.notifTitle": "Tùy chọn thông báo", // DRAFT — Kevin reviews
  "acx.find.d.acc-overview": "Trang Tài khoản này: hồ sơ, doanh nghiệp, bảo mật, thanh toán và tình trạng", // DRAFT — Kevin reviews
  "acx.find.k.acc-overview": "tổng quan tài khoản tóm tắt", // DRAFT — Kevin reviews
  "acx.find.d.acc-subscription": "Gói của bạn, ngày gia hạn và đổi gói", // DRAFT — Kevin reviews
  "acx.find.k.acc-subscription": "gói đăng ký nâng cấp hạ cấp gia hạn", // DRAFT — Kevin reviews
  "acx.find.d.acc-ai": "Các gói AI đã có, có thể mua hoặc bị khóa", // DRAFT — Kevin reviews
  "acx.find.k.acc-ai": "gói ai trí tuệ nhân tạo", // DRAFT — Kevin reviews
  "acx.find.d.acc-usage": "Mức dùng so với giới hạn: AI, SMS và lưu trữ", // DRAFT — Kevin reviews
  "acx.find.k.acc-usage": "mức dùng giới hạn lưu trữ sms ai", // DRAFT — Kevin reviews
  "acx.find.d.acc-billing": "Tình trạng thanh toán, phương thức và lịch sử", // DRAFT — Kevin reviews
  "acx.find.k.acc-billing": "thanh toán phương thức thẻ gia hạn phí", // DRAFT — Kevin reviews
  "acx.find.d.acc-invoices": "Hóa đơn phần mềm từ AI PowerSalon", // DRAFT — Kevin reviews
  "acx.find.k.acc-invoices": "hóa đơn phí phần mềm", // DRAFT — Kevin reviews
  "acx.find.d.acc-access-governance": "Rà soát quyền truy cập, quyền rủi ro cao và tài khoản không hoạt động", // DRAFT — Kevin reviews
  "acx.find.k.acc-access-governance": "quyền truy cập rủi ro rà soát kiểm tra", // DRAFT — Kevin reviews
  "acx.find.d.acc-security": "Mật khẩu, xác thực hai lớp, thiết bị tin cậy, phiên đăng nhập và cảnh báo đăng nhập", // DRAFT — Kevin reviews
  "acx.find.k.acc-security": "mật khẩu 2fa hai lớp phiên thiết bị cảnh báo đăng nhập hồ sơ tên email thông báo", // DRAFT — Kevin reviews
  "acx.find.d.acc-activity": "Nhật ký đầy đủ hoạt động của tài khoản và tiệm", // DRAFT — Kevin reviews
  "acx.find.k.acc-activity": "hoạt động nhật ký lịch sử ai đã đổi", // DRAFT — Kevin reviews
  "acx.find.d.acc-support": "Bài hướng dẫn và yêu cầu hỗ trợ", // DRAFT — Kevin reviews
  "acx.find.k.acc-support": "trợ giúp hỗ trợ yêu cầu liên hệ", // DRAFT — Kevin reviews
  "acx.find.d.acc-settings": "Cài đặt tiệm: thông tin doanh nghiệp, hóa đơn, thương hiệu", // DRAFT — Kevin reviews
  "acx.find.k.acc-settings": "cài đặt tùy chọn hóa đơn thương hiệu doanh nghiệp", // DRAFT — Kevin reviews
  "acx.find.d.team-members": "Danh bạ nhân viên — tìm người theo tên hoặc số điện thoại trong tiệm này", // DRAFT — Kevin reviews
  "acx.find.k.team-members": "nhân viên thợ người dùng tên điện thoại danh bạ", // DRAFT — Kevin reviews
  "acx.find.d.team-permissions": "Các vai trò và quyền của từng vai trò", // DRAFT — Kevin reviews
  "acx.find.k.team-permissions": "vai trò quyền truy cập người dùng", // DRAFT — Kevin reviews
  "acx.find.d.panel-profile": "Tên, email, điện thoại, ngôn ngữ và lần đăng nhập cuối của bạn", // DRAFT — Kevin reviews
  "acx.find.k.panel-profile": "hồ sơ tên email điện thoại ngôn ngữ đăng nhập", // DRAFT — Kevin reviews
  "acx.find.d.panel-business": "Tên doanh nghiệp, chi nhánh, địa chỉ, điện thoại, múi giờ và màu thương hiệu", // DRAFT — Kevin reviews
  "acx.find.k.panel-business": "doanh nghiệp tên tiệm địa chỉ điện thoại múi giờ thương hiệu logo màu", // DRAFT — Kevin reviews
  "acx.find.d.panel-security": "Tuổi mật khẩu, hai lớp, cảnh báo đăng nhập, thiết bị tin cậy và lần đăng nhập gần đây", // DRAFT — Kevin reviews
  "acx.find.k.panel-security": "bảo mật mật khẩu 2fa cảnh báo thiết bị đăng nhập phiên", // DRAFT — Kevin reviews
  "acx.find.d.panel-notif": "Tài khoản này nhận những thông báo nào", // DRAFT — Kevin reviews
  "acx.find.k.panel-notif": "thông báo cảnh báo sms email tùy chọn", // DRAFT — Kevin reviews
  "acx.find.d.panel-billing": "Gói, ngày gia hạn, phương thức thanh toán và phí hằng tháng", // DRAFT — Kevin reviews
  "acx.find.k.panel-billing": "gói thanh toán gia hạn phí phương thức", // DRAFT — Kevin reviews
  "acx.find.d.panel-role": "Vai trò, phạm vi dữ liệu và quyền chi nhánh của bạn", // DRAFT — Kevin reviews
  "acx.find.k.panel-role": "vai trò quyền phạm vi chi nhánh người dùng quản lý nhân viên", // DRAFT — Kevin reviews
  "acx.find.d.panel-activity": "Hoạt động tài khoản mới nhất", // DRAFT — Kevin reviews
  "acx.find.k.panel-activity": "hoạt động gần đây nhật ký", // DRAFT — Kevin reviews
  "acx.find.d.panel-health": "Những gì đã xong và những gì còn cần thiết lập", // DRAFT — Kevin reviews
  "acx.find.k.panel-health": "tình trạng điểm thiết lập", // DRAFT — Kevin reviews
  "acx.find.d.panel-compliance": "Hai lớp, tuân thủ nhắn tin và vệ sinh mật khẩu", // DRAFT — Kevin reviews
  "acx.find.k.panel-compliance": "tuân thủ a2p 10dlc nhắn tin mật khẩu", // DRAFT — Kevin reviews
  "acx.find.d.panel-backup": "Lần sao lưu trước, kế tiếp và tình trạng", // DRAFT — Kevin reviews
  "acx.find.k.panel-backup": "sao lưu dữ liệu khôi phục", // DRAFT — Kevin reviews
  "ops.serving.sdReady": "Hoàn tất dịch vụ", // DRAFT — Kevin reviews
  "ops.serving.sdState.ready": "Sẵn sàng", // DRAFT — Kevin reviews
  "ops.serving.sdState.not_ready": "Chưa sẵn sàng", // DRAFT — Kevin reviews
  "ops.serving.sdState.handed_off": "Đã chuyển sang Hoàn tất dịch vụ", // DRAFT — Kevin reviews
  "ops.serving.sdVia.mark_ready": "Đánh dấu sẵn sàng", // DRAFT — Kevin reviews
  "ops.serving.sdVia.send_to_service_done": "Chuyển sang Hoàn tất dịch vụ", // DRAFT — Kevin reviews
  "ops.serving.sdWhy.NOT_STARTED": "Dịch vụ chưa bắt đầu.", // DRAFT — Kevin reviews
  "ops.serving.sdWhy.NOTES_REQUIRED": "Tiệm yêu cầu ghi chú dịch vụ trước khi đánh dấu sẵn sàng.", // DRAFT — Kevin reviews
  "ops.serving.sdWhy.NO_PERMISSION": "Vai trò của bạn không thể chuyển khách này sang Hoàn tất dịch vụ.", // DRAFT — Kevin reviews
  "ops.serving.sdWhy.NOT_IN_SERVICE": "Lượt này không ở trạng thái có thể chuyển sang Hoàn tất dịch vụ.", // DRAFT — Kevin reviews
  "ops.serving.sdOpen": "{n} dòng dịch vụ chưa đánh dấu xong — không bắt buộc để hoàn tất", // DRAFT — Kevin reviews
  "lgx.issue.title": "Báo cho bộ phận hỗ trợ", // DRAFT — Kevin reviews
  "lgx.issue.hint": "Mở một yêu cầu hỗ trợ cho sự kiện này trong Trợ giúp & Hỗ trợ, nơi yêu cầu có người phụ trách, trạng thái và theo dõi. Chỉ gửi mã và số nhận dạng của sự kiện — không gửi chi tiết.", // DRAFT — Kevin reviews
  "lgx.issue.priority": "Mức ưu tiên", // DRAFT — Kevin reviews
  "lgx.issue.notePh": "Chuyện gì đã xảy ra ở tiệm (không bắt buộc)", // DRAFT — Kevin reviews
  "lgx.issue.submit": "Mở yêu cầu hỗ trợ", // DRAFT — Kevin reviews
  "lgx.issue.done": "Yêu cầu hỗ trợ {n} · {s}", // DRAFT — Kevin reviews
  "lgx.issue.openSupport": "Mở Trợ giúp & Hỗ trợ", // DRAFT — Kevin reviews
  "lgx.issue.event": "Sự kiện nhật ký", // DRAFT — Kevin reviews
  "lgx.issue.when": "Ghi lúc", // DRAFT — Kevin reviews
  "dfx.hw.btn": "Mức sẵn sàng của máy này", // DRAFT — Kevin reviews
  "dfx.hw.title": "Mức sẵn sàng phần cứng của máy POS này", // DRAFT — Kevin reviews
  "dfx.hw.sub": "Đo ngay trong trình duyệt này. Không thay đổi hay gửi gì; điều trình duyệt không báo được sẽ ghi rõ.", // DRAFT — Kevin reviews
  "dfx.hw.again": "Đo lại", // DRAFT — Kevin reviews
  "dfx.hw.k.screen": "Màn hình", // DRAFT — Kevin reviews
  "dfx.hw.k.viewport": "Vùng sử dụng", // DRAFT — Kevin reviews
  "dfx.hw.k.touch": "Cảm ứng", // DRAFT — Kevin reviews
  "dfx.hw.k.browser": "Trình duyệt", // DRAFT — Kevin reviews
  "dfx.hw.k.os": "Hệ điều hành", // DRAFT — Kevin reviews
  "dfx.hw.k.mode": "Chế độ hiển thị", // DRAFT — Kevin reviews
  "dfx.hw.k.network": "Mạng", // DRAFT — Kevin reviews
  "dfx.hw.k.reconnect": "Cập nhật trực tiếp", // DRAFT — Kevin reviews
  "dfx.hw.k.agent": "Phần mềm cài trên máy", // DRAFT — Kevin reviews
  "dfx.hw.k.peripherals": "Thiết bị ngoại vi", // DRAFT — Kevin reviews
  "dfx.hw.s.ok": "Tốt", // DRAFT — Kevin reviews
  "dfx.hw.s.warn": "Cần kiểm tra", // DRAFT — Kevin reviews
  "dfx.hw.s.info": "Thông tin", // DRAFT — Kevin reviews
  "dfx.hw.s.not_reported": "Không có dữ liệu", // DRAFT — Kevin reviews
  "dfx.hw.d.screen.ok": "Đủ lớn cho bố cục SUNMI 27 inch đã chứng nhận.", // DRAFT — Kevin reviews
  "dfx.hw.d.screen.warn": "Nhỏ hơn màn hình SUNMI 27 inch đã chứng nhận — các trang dùng bố cục gọn.", // DRAFT — Kevin reviews
  "dfx.hw.d.viewport.ok": "Vùng trình duyệt sử dụng được vừa với bố cục đã chứng nhận.", // DRAFT — Kevin reviews
  "dfx.hw.d.viewport.warn": "Vùng sử dụng nhỏ hơn chuẩn — đóng thanh trình duyệt hoặc dùng toàn màn hình.", // DRAFT — Kevin reviews
  "dfx.hw.d.touch.ok": "Có cảm ứng.", // DRAFT — Kevin reviews
  "dfx.hw.d.touch.warn": "Không phát hiện cảm ứng trên máy này.", // DRAFT — Kevin reviews
  "dfx.hw.d.browser.ok": "Trình duyệt Chromium, loại các màn hình đã được chứng nhận.", // DRAFT — Kevin reviews
  "dfx.hw.d.browser.warn": "Không phải trình duyệt đã chứng nhận — hãy dùng Chrome trên máy này.", // DRAFT — Kevin reviews
  "dfx.hw.d.browser.not_reported": "Trình duyệt không báo tên.", // DRAFT — Kevin reviews
  "dfx.hw.d.os.info": "Theo thông tin trình duyệt báo.", // DRAFT — Kevin reviews
  "dfx.hw.d.os.not_reported": "Trình duyệt không báo hệ điều hành.", // DRAFT — Kevin reviews
  "dfx.hw.d.mode.info": "Toàn màn hình hoặc chế độ ứng dụng sẽ ẩn thanh trình duyệt.", // DRAFT — Kevin reviews
  "dfx.hw.d.network.ok": "Trình duyệt báo có kết nối mạng.", // DRAFT — Kevin reviews
  "dfx.hw.d.network.warn": "Trình duyệt báo không có kết nối mạng.", // DRAFT — Kevin reviews
  "dfx.hw.d.reconnect.ok": "Đã kết nối cập nhật trực tiếp.", // DRAFT — Kevin reviews
  "dfx.hw.d.reconnect.warn": "Hiện chưa kết nối cập nhật trực tiếp — ứng dụng tự thử lại.", // DRAFT — Kevin reviews
  "dfx.hw.d.agent.not_reported": "AI PowerSalon chạy trong trình duyệt và không ghi nhận phần mềm cài trên máy này.", // DRAFT — Kevin reviews
  "dfx.hw.d.peripherals.not_reported": "Không khẳng định hỗ trợ trình điều khiển nào ở đây. Máy quẹt thẻ và màn hình khách được kiểm tra ở dòng riêng của chúng trên trang này.", // DRAFT — Kevin reviews
  "dfx.hw.c.density.comfortable": "Lớn", // DRAFT — Kevin reviews
  "dfx.hw.c.density.compact": "Kích thước chuẩn", // DRAFT — Kevin reviews
  "dfx.hw.c.density.tight": "Nhỏ hơn", // DRAFT — Kevin reviews
  "dfx.hw.c.density.fallback": "Nhỏ", // DRAFT — Kevin reviews
  "dfx.hw.c.mode.browser": "Cửa sổ trình duyệt", // DRAFT — Kevin reviews
  "dfx.hw.c.mode.fullscreen": "Toàn màn hình", // DRAFT — Kevin reviews
  "dfx.hw.c.mode.standalone": "Ứng dụng đã cài", // DRAFT — Kevin reviews
  "dfx.hw.c.rt.CONNECTED": "Đã kết nối", // DRAFT — Kevin reviews
  "dfx.hw.c.rt.RECONNECTING": "Đang kết nối lại", // DRAFT — Kevin reviews
  "dfx.hw.c.rt.OFFLINE": "Ngoại tuyến", // DRAFT — Kevin reviews
  "dfx.hw.c.rt.DEGRADED": "Suy giảm", // DRAFT — Kevin reviews
  "dfx.hw.c.os.android": "Android", // DRAFT — Kevin reviews
  "dfx.hw.c.os.windows": "Windows", // DRAFT — Kevin reviews
  "dfx.hw.c.os.macos": "macOS", // DRAFT — Kevin reviews
  "dfx.hw.c.os.linux": "Linux", // DRAFT — Kevin reviews
  "ops.sched.queue.waiting": "Đang chờ trong hàng chờ khách: {n} (khách vãng lai {w} · có hẹn {a}).", // DRAFT — Kevin reviews
  "ops.sched.queue.unknown": "Hiện không đọc được số khách trong hàng chờ.", // DRAFT — Kevin reviews
  "ops.sched.queue.fair": "Xếp bằng Trợ lý hàng chờ AI (xoay vòng công bằng)", // DRAFT — Kevin reviews
  "ops.sched.queue.open": "Mở hàng chờ khách", // DRAFT — Kevin reviews
  "ops.sched.queue.rule": "Khách đang chờ được xếp theo xoay vòng công bằng của hàng chờ — trình tối ưu không bao giờ tự xếp.", // DRAFT — Kevin reviews
  "syschk.catalog.checkout_subtotal_over_lines": "Không phiếu đã thanh toán nào có tạm tính cao hơn tổng các dòng của phiếu", // DRAFT — Kevin reviews
  "syschk.catalog.checkout_subtotal_over_lines.fix": "Mở các phiếu đó: có thể một dòng đã bị bỏ sau khi thanh toán hoặc giá bị đổi ngoài phiếu. Sửa bằng hoàn tiền hoặc điều chỉnh, không bao giờ sửa phiếu đã thanh toán.", // DRAFT — Kevin reviews
  "syschk.catalog.checkout_discount_over_lines": "Không phiếu đã thanh toán nào có giảm giá lớn hơn tổng các dòng", // DRAFT — Kevin reviews
  "syschk.catalog.checkout_discount_over_lines.fix": "Xem lại giảm giá trên các phiếu đó (ưu đãi, mã giảm giá, giảm tay hoặc thành viên) và ai đã duyệt.", // DRAFT — Kevin reviews
  "syschk.catalog.checkout_tax_without_taxable_line": "Không phiếu đã thanh toán nào tính thuế khi không có dòng chịu thuế", // DRAFT — Kevin reviews
  "syschk.catalog.checkout_tax_without_taxable_line.fix": "Kiểm tra cài đặt Chịu thuế của từng dịch vụ và tiền thuế trên các phiếu đó; hoàn lại thuế nếu tính nhầm.", // DRAFT — Kevin reviews
  "dfx.export.btn": "Xuất danh sách thiết bị", // DRAFT — Kevin reviews
  "dfx.export.hint": "Tải các thiết bị trong trang này (theo bộ lọc hiện tại) kèm kết quả kiểm tra dưới dạng CSV. Không bao giờ có mã token, mã ghép nối, mã bộ xử lý thanh toán, số sê-ri đầy đủ hay dữ liệu khách hàng.", // DRAFT — Kevin reviews
  "dfx.export.busy": "Đang chuẩn bị…", // DRAFT — Kevin reviews
  "dfx.export.done": "Đã tải danh sách thiết bị.", // DRAFT — Kevin reviews
  "lgx.ops.sec": "{n} giây", // DRAFT — Kevin reviews
  "lgx.ops.min": "{n} phút", // DRAFT — Kevin reviews
  "lgx.ops.hr": "{n} giờ", // DRAFT — Kevin reviews
  "lgx.alerts.btn": "Cảnh báo đã gửi", // DRAFT — Kevin reviews
  "lgx.alerts.title": "Cảnh báo đã gửi", // DRAFT — Kevin reviews
  "lgx.alerts.sub": "Sự cố thiết bị và tích hợp được gửi vào mục cảnh báo của tiệm — mỗi sự cố chỉ có một cảnh báo đang mở; cảnh báo đã xử lý sẽ im lặng {m} phút (trừ lỗi nghiêm trọng).", // DRAFT — Kevin reviews
  "lgx.alerts.status.open": "Đang mở", // DRAFT — Kevin reviews
  "lgx.alerts.status.closed": "Đã đóng", // DRAFT — Kevin reviews
  "lgx.alerts.status.all": "Tất cả", // DRAFT — Kevin reviews
  "lgx.alerts.checked": "Đã kiểm tra {t}", // DRAFT — Kevin reviews
  "lgx.alerts.resolved": "Đã xử lý cảnh báo.", // DRAFT — Kevin reviews
  "lgx.alerts.resolveFailed": "Không thể xử lý cảnh báo.", // DRAFT — Kevin reviews
  "lgx.alerts.none": "Không có cảnh báo đang mở — không phát hiện sự cố thiết bị hay tích hợp.", // DRAFT — Kevin reviews
  "lgx.alerts.noneClosed": "Không có cảnh báo đã đóng.", // DRAFT — Kevin reviews
  "lgx.alerts.sev.info": "Thông tin", // DRAFT — Kevin reviews
  "lgx.alerts.sev.warning": "Cảnh báo", // DRAFT — Kevin reviews
  "lgx.alerts.sev.high": "Cao", // DRAFT — Kevin reviews
  "lgx.alerts.sev.critical": "Nghiêm trọng", // DRAFT — Kevin reviews
  "lgx.alerts.rule.device_offline": "{c} mất kết nối: {n}", // DRAFT — Kevin reviews
  "lgx.alerts.rule.terminal_unavailable": "Máy quẹt thẻ không dùng được: {n}", // DRAFT — Kevin reviews
  "lgx.alerts.rule.sync_failures": "Lỗi lặp lại từ {s}: {n} trong giờ qua", // DRAFT — Kevin reviews
  "lgx.alerts.rule.provider_critical": "Lỗi nghiêm trọng từ {s}: {n} trong giờ qua", // DRAFT — Kevin reviews
  "lgx.alerts.cls.display": "Màn hình khách", // DRAFT — Kevin reviews
  "lgx.alerts.cls.kiosk": "Máy check-in", // DRAFT — Kevin reviews
  "lgx.alerts.cls.terminal": "Máy quẹt thẻ", // DRAFT — Kevin reviews
  "lgx.alerts.st.new": "Mới", // DRAFT — Kevin reviews
  "lgx.alerts.st.acknowledged": "Đã ghi nhận", // DRAFT — Kevin reviews
  "lgx.alerts.st.in_progress": "Đang xử lý", // DRAFT — Kevin reviews
  "lgx.alerts.st.resolved": "Đã xử lý", // DRAFT — Kevin reviews
  "lgx.alerts.st.dismissed": "Đã bỏ qua", // DRAFT — Kevin reviews
  "lgx.alerts.action.check_power_network": "Cần làm: kiểm tra nguồn điện và Wi-Fi, rồi mở Tình trạng thiết bị.", // DRAFT — Kevin reviews
  "lgx.alerts.action.test_terminal": "Cần làm: thử máy trong Máy quẹt thẻ; trong lúc chờ hãy thu tiền bằng máy khác.", // DRAFT — Kevin reviews
  "lgx.alerts.action.review_integration": "Cần làm: kiểm tra kết nối tích hợp trong Thiết bị & Tích hợp.", // DRAFT — Kevin reviews
  "lgx.alerts.action.contact_support": "Cần làm: mở nhật ký và báo lỗi cho bộ phận hỗ trợ.", // DRAFT — Kevin reviews
  "lgx.alerts.action.none": "—", // DRAFT — Kevin reviews
  "lgx.alerts.seen": "Phát hiện {n} lần · lần cuối {t}", // DRAFT — Kevin reviews
  "lgx.alerts.resolvedBy": "đã xử lý {t} bởi {w}", // DRAFT — Kevin reviews
  "lgx.alerts.openLogs": "Xem các sự kiện này", // DRAFT — Kevin reviews
  "lgx.alerts.resolve": "Đánh dấu đã xử lý", // DRAFT — Kevin reviews
  "lgx.alerts.foot": "Máy chủ kiểm tra mỗi 5 phút (và khi bạn mở danh sách này). Không quy tắc nào bị tự động tắt.", // DRAFT — Kevin reviews
  "lgx.retry.btn": "Hàng chờ thử lại", // DRAFT — Kevin reviews
  "lgx.retry.title": "Hàng chờ thử lại", // DRAFT — Kevin reviews
  "lgx.retry.sub": "Công việc của tiệm đang chờ, đang thử lại hoặc đã bỏ cuộc (hỏng trong {n} ngày qua). Chỉ xem — hàng chờ tự thử lại.", // DRAFT — Kevin reviews
  "lgx.retry.store.jobs": "Tác vụ nền", // DRAFT — Kevin reviews
  "lgx.retry.store.webhooks": "Gửi webhook", // DRAFT — Kevin reviews
  "lgx.retry.counts": "Đang chờ {w} · Đang thử lại {r} · Đang chạy {u} · Hỏng {d}", // DRAFT — Kevin reviews
  "lgx.retry.lag": "Trễ lâu nhất: {l}", // DRAFT — Kevin reviews
  "lgx.retry.none": "Không có việc nào đang chờ hay bị lỗi.", // DRAFT — Kevin reviews
  "lgx.retry.col.store": "Hàng chờ", // DRAFT — Kevin reviews
  "lgx.retry.col.type": "Công việc", // DRAFT — Kevin reviews
  "lgx.retry.col.attempt": "Lần thử", // DRAFT — Kevin reviews
  "lgx.retry.col.next": "Lần thử tiếp", // DRAFT — Kevin reviews
  "lgx.retry.col.lag": "Trễ", // DRAFT — Kevin reviews
  "lgx.retry.col.error": "Lỗi gần nhất", // DRAFT — Kevin reviews
  "lgx.retry.state.waiting": "Đang chờ", // DRAFT — Kevin reviews
  "lgx.retry.state.retrying": "Đang thử lại", // DRAFT — Kevin reviews
  "lgx.retry.state.running": "Đang chạy", // DRAFT — Kevin reviews
  "lgx.retry.state.dead": "Hỏng (đã bỏ cuộc)", // DRAFT — Kevin reviews
  "lgx.retry.attemptOf": "{a} / {m}", // DRAFT — Kevin reviews
  "lgx.retry.foot": "Lỗi được rút gọn và che thông tin; nội dung công việc không bao giờ được hiển thị.", // DRAFT — Kevin reviews
  "syschk.src.show": "Xem các dòng nguồn", // DRAFT — Kevin reviews
  "syschk.src.hide": "Ẩn các dòng nguồn", // DRAFT — Kevin reviews
  "syschk.src.failed": "Không tải được các dòng nguồn.", // DRAFT — Kevin reviews
  "syschk.src.none": "Không thể hiện dòng nguồn cho mục kiểm tra này.", // DRAFT — Kevin reviews
  "syschk.src.more": "Đang hiện {n} dòng mới nhất; còn nữa.", // DRAFT — Kevin reviews
  "syschk.src.col.source": "Nguồn", // DRAFT — Kevin reviews
  "syschk.src.col.member": "Hội viên", // DRAFT — Kevin reviews
  "syschk.src.col.ticket": "Phiếu", // DRAFT — Kevin reviews
  "syschk.src.col.amount": "Số tiền", // DRAFT — Kevin reviews
  "syschk.src.col.when": "Thời gian", // DRAFT — Kevin reviews
  "syschk.src.col.detail": "Chi tiết", // DRAFT — Kevin reviews
  "syschk.src.kind.membership": "Gói hội viên", // DRAFT — Kevin reviews
  "syschk.src.kind.payment": "Thanh toán gói hội viên", // DRAFT — Kevin reviews
  "syschk.src.kind.redemption": "Lần dùng quyền lợi", // DRAFT — Kevin reviews
  "syschk.src.kind.ledger_entry": "Bút toán sổ tín dụng", // DRAFT — Kevin reviews
  "syschk.src.kind.benefit_balance": "Số dư quyền lợi", // DRAFT — Kevin reviews
  "syschk.src.kind.redemption_vs_ledger": "Lần dùng so với sổ", // DRAFT — Kevin reviews
  "syschk.src.kind.notice": "Thông báo hội viên", // DRAFT — Kevin reviews
  "syschk.src.credits": "Số dư {n} lượt", // DRAFT — Kevin reviews
  "syschk.src.mismatch": "{r} bản ghi sử dụng so với {l} bút toán sổ", // DRAFT — Kevin reviews
  "syschk.src.code.pending": "Đang chờ", // DRAFT — Kevin reviews
  "syschk.src.code.renewal": "Gia hạn", // DRAFT — Kevin reviews
  "syschk.src.code.installment": "Trả góp", // DRAFT — Kevin reviews
  "syschk.src.code.invoice": "Trả bằng hóa đơn", // DRAFT — Kevin reviews
  "syschk.src.code.voided": "Phiếu đã hủy", // DRAFT — Kevin reviews
  "syschk.src.code.void": "Phiếu đã hủy", // DRAFT — Kevin reviews
  "syschk.src.code.paid": "Phiếu đã thanh toán", // DRAFT — Kevin reviews
  "syschk.src.code.canceled": "Đã hủy", // DRAFT — Kevin reviews
  "syschk.src.code.cancelled": "Đã hủy", // DRAFT — Kevin reviews
  "syschk.src.code.expired": "Hết hạn", // DRAFT — Kevin reviews
  "syschk.src.code.active": "Đang hoạt động", // DRAFT — Kevin reviews
  "syschk.src.code.grace": "Thời gian gia hạn", // DRAFT — Kevin reviews
  "ops.serving.review.title": "Xem lại trước khi xác nhận", // DRAFT — Kevin reviews
  "ops.serving.review.action.mark_ready": "Đánh dấu xong", // DRAFT — Kevin reviews
  "ops.serving.review.action.assign_technician": "Chuyển sang thợ khác", // DRAFT — Kevin reviews
  "ops.serving.review.action.add_service": "Thêm dịch vụ phụ", // DRAFT — Kevin reviews
  "ops.serving.review.guest": "Khách", // DRAFT — Kevin reviews
  "ops.serving.review.move": "Từ {from} → sang {to}", // DRAFT — Kevin reviews
  "ops.serving.review.priceCatalog": "Giá {price} (giá niêm yết)", // DRAFT — Kevin reviews
  "ops.serving.review.priceManual": "Giá nhập tay {price} (giá niêm yết {catalog})", // DRAFT — Kevin reviews
  "ops.serving.review.affected": "Dịch vụ bị thay đổi", // DRAFT — Kevin reviews
  "ops.serving.review.new": "mới", // DRAFT — Kevin reviews
  "ops.serving.review.permYes": "Bạn được phép: {what}", // DRAFT — Kevin reviews
  "ops.serving.review.permNo": "Vai trò của bạn không được phép: {what}", // DRAFT — Kevin reviews
  "ops.serving.review.overrideYes": "bạn có quyền quản lý ghi đè", // DRAFT — Kevin reviews
  "ops.serving.review.overrideNo": "không có quyền quản lý ghi đè", // DRAFT — Kevin reviews
  "ops.serving.review.noConflicts": "Không có xung đột.", // DRAFT — Kevin reviews
  "ops.serving.review.confirm": "Xác nhận", // DRAFT — Kevin reviews
  "ops.serving.review.c.TICKET_LOCKED_AT_SERVICE_DONE": "Phiếu này đã khóa ở Hoàn tất dịch vụ — hãy mở lại trước.", // DRAFT — Kevin reviews
  "ops.serving.review.c.ALREADY_DONE": "Khách này đã ở Hoàn tất dịch vụ.", // DRAFT — Kevin reviews
  "ops.serving.review.c.NOT_IN_SERVICE": "Dịch vụ chưa bắt đầu nên chưa thể đánh dấu xong.", // DRAFT — Kevin reviews
  "ops.serving.review.c.NOTES_REQUIRED": "Tiệm yêu cầu ghi chú dịch vụ trước khi đánh dấu xong.", // DRAFT — Kevin reviews
  "ops.serving.review.c.CANNOT_MARK_DONE": "Hiện chưa thể đánh dấu khách này xong.", // DRAFT — Kevin reviews
  "ops.serving.review.c.OPEN_SERVICE_LINES": "{n} dòng dịch vụ chưa đánh dấu xong (vẫn được phép).", // DRAFT — Kevin reviews
  "ops.serving.review.c.TECHNICIAN_NOT_FOUND": "Thợ này không thuộc tiệm.", // DRAFT — Kevin reviews
  "ops.serving.review.c.SAME_TECHNICIAN": "Khách đang ở với thợ này rồi.", // DRAFT — Kevin reviews
  "ops.serving.review.c.TECHNICIAN_NOT_ACTIVE": "Thợ này không còn hoạt động.", // DRAFT — Kevin reviews
  "ops.serving.review.c.TECHNICIAN_BRANCH_ACCESS_DENIED": "Thợ này không thuộc chi nhánh này.", // DRAFT — Kevin reviews
  "ops.serving.review.c.TECHNICIAN_NOT_SKILLED": "Thợ này chưa được duyệt làm {service}.", // DRAFT — Kevin reviews
  "ops.serving.review.c.TECHNICIAN_NOT_AVAILABLE": "Thợ này hiện không rảnh.", // DRAFT — Kevin reviews
  "ops.serving.review.c.TECHNICIAN_ALREADY_SERVING": "Thợ này đang phục vụ khách khác.", // DRAFT — Kevin reviews
  "ops.serving.review.c.SCHEDULE_CONFLICT": "Thợ này có lịch hẹn vào giờ này.", // DRAFT — Kevin reviews
  "ops.serving.review.c.BOOKING_SOON": "{name} có lịch hẹn sau {minutes} phút; việc này cần khoảng {needs} phút.", // DRAFT — Kevin reviews
  "ops.serving.review.c.MANAGER_OVERRIDE_REQUIRED": "Tiệm chỉ cho đổi dịch vụ khi đang làm nếu có quản lý ghi đè.", // DRAFT — Kevin reviews
  "ops.serving.review.c.MANUAL_PRICE": "Giá nhập tay {priceCents} thay cho giá niêm yết {catalogCents} (quản lý ghi đè).", // DRAFT — Kevin reviews
  "ops.serving.review.c.PRICE_OVERRIDE_NOT_PERMITTED": "Giá nhập tay cần quản lý ghi đè, vai trò của bạn không có quyền này.", // DRAFT — Kevin reviews
  "ops.serving.review.c.ALREADY_ON_TICKET": "{service} đã có trên phiếu này.", // DRAFT — Kevin reviews
  "ops.liveOps.kc.btn": "Kiểm tra KPI", // DRAFT — Kevin reviews
  "ops.liveOps.kc.title": "Kiểm tra độ chính xác KPI", // DRAFT — Kevin reviews
  "ops.liveOps.kc.scope": "Ngày làm việc {date} · múi giờ {tz} · doanh thu = các khoản thanh toán ở trạng thái tính doanh thu, theo ngày của chi nhánh · số trên màn hình có thể cũ tối đa {ttl} giây", // DRAFT — Kevin reviews
  "ops.liveOps.kc.summary": "{match} khớp · {stale} bộ nhớ đệm cũ · {mismatch} không khớp · {notChecked} chưa kiểm tra", // DRAFT — Kevin reviews
  "ops.liveOps.kc.kpi": "KPI", // DRAFT — Kevin reviews
  "ops.liveOps.kc.shown": "Trên màn hình", // DRAFT — Kevin reviews
  "ops.liveOps.kc.authority": "Tổng quan (nguồn chuẩn)", // DRAFT — Kevin reviews
  "ops.liveOps.kc.s.match": "Khớp", // DRAFT — Kevin reviews
  "ops.liveOps.kc.s.stale_cache": "Bộ nhớ đệm cũ hơn dữ liệu", // DRAFT — Kevin reviews
  "ops.liveOps.kc.s.mismatch": "Không khớp", // DRAFT — Kevin reviews
  "ops.liveOps.kc.s.not_checked": "Chưa kiểm tra", // DRAFT — Kevin reviews
  "ops.liveOps.kc.r.same_value": "cùng giá trị", // DRAFT — Kevin reviews
  "ops.liveOps.kc.r.cache_older_than_data": "làm mới để thấy giá trị mới", // DRAFT — Kevin reviews
  "ops.liveOps.kc.r.definition_differs": "hai cách tính không khớp nhau", // DRAFT — Kevin reviews
  "ops.liveOps.kc.r.no_second_source": "không có nguồn thứ hai để so sánh", // DRAFT — Kevin reviews
  "ops.liveOps.kc.k.todayRevenueCents": "Doanh thu hôm nay", // DRAFT — Kevin reviews
  "ops.liveOps.kc.k.averageTicketCents": "Trung bình mỗi hóa đơn", // DRAFT — Kevin reviews
  "ops.liveOps.kc.k.waitingGuests": "Khách đang chờ", // DRAFT — Kevin reviews
  "ops.liveOps.kc.k.servingNow": "Đang phục vụ", // DRAFT — Kevin reviews
  "ops.liveOps.kc.k.readyCheckout": "Sẵn sàng thanh toán", // DRAFT — Kevin reviews
  "ops.liveOps.kc.k.activeTechs": "Thợ đang làm việc", // DRAFT — Kevin reviews
  "ops.liveOps.kc.k.checkInsToday": "Lượt check-in hôm nay", // DRAFT — Kevin reviews
  "ops.liveOps.kc.k.onlineBookings": "Đặt lịch trực tuyến", // DRAFT — Kevin reviews
  "ops.liveOps.kc.k.customerSatisfactionScore": "Mức hài lòng của khách hàng", // DRAFT — Kevin reviews
  "ops.liveOps.kc.k.appointmentsToday": "Lịch hẹn hôm nay", // DRAFT — Kevin reviews
  "ops.liveOps.kc.k.monthlyCardVolumeCents": "Doanh số thẻ tháng này", // DRAFT — Kevin reviews
  "ops.liveOps.kc.k.customerRetentionPercent": "Tỷ lệ khách hàng quay lại", // DRAFT — Kevin reviews
  "ops.liveOps.kc.k.aiBookingConversionPercent": "Tỷ lệ chuyển đổi đặt lịch AI", // DRAFT — Kevin reviews
  "ops.serving.review.vip": "VIP", // DRAFT — Kevin reviews
  "syschk.service-flow.serving_timing_contradicts": "Không có phiếu đang làm nào có thời gian mâu thuẫn", // DRAFT — Kevin reviews
  "syschk.service-flow.serving_timing_contradicts.fix": "Mở phiếu: bắt đầu ở tương lai, xong trước khi bắt đầu, hoặc tạm dừng lâu hơn thời gian làm. Sửa lại đồng hồ dịch vụ.", // DRAFT — Kevin reviews
  "syschk.service-flow.serving_no_estimate": "Mọi phiếu đang làm đều có thời lượng dự kiến", // DRAFT — Kevin reviews
  "syschk.service-flow.serving_no_estimate.fix": "Các phiếu này không có thời lượng dịch vụ nên tiến độ hiện \"—\". Thêm dịch vụ có thời lượng.", // DRAFT — Kevin reviews
  "syschk.service-flow.serving_far_over_estimate": "Không có phiếu nào làm quá gấp đôi thời lượng dự kiến", // DRAFT — Kevin reviews
  "syschk.service-flow.serving_far_over_estimate.fix": "Có lẽ đồng hồ chưa được dừng. Hoàn tất, tạm dừng hoặc sửa các dịch vụ đó.", // DRAFT — Kevin reviews
  "ops.serving.sev.danger": "Khẩn", // DRAFT — Kevin reviews
  "ops.serving.sev.warn": "Cảnh báo", // DRAFT — Kevin reviews
  "ops.serving.sev.info": "Thông tin", // DRAFT — Kevin reviews
  "ops.serving.insight.unconfirmed": "{count} lịch hẹn trong 2 giờ tới chưa xác nhận (lịch đầu tiên sau {minutes} phút)", // DRAFT — Kevin reviews
  "ops.serving.insightSub.unconfirmed": "Xác nhận với khách từ bảng Đặt lịch — không có gì được gửi tự động.", // DRAFT — Kevin reviews
  "ops.serving.qualifiedFree": "Thợ đủ điều kiện & đang rảnh", // DRAFT — Kevin reviews
  "ops.serving.qualifiedNone": "Không ai trong {n} thợ đang rảnh", // DRAFT — Kevin reviews
  "ops.serving.lineClose": "Đóng", // DRAFT — Kevin reviews
  "ops.serving.linePerformer": "Người làm", // DRAFT — Kevin reviews
  "ops.serving.linePrimary": "thợ chính", // DRAFT — Kevin reviews
  "ops.serving.lineKind": "Loại dòng", // DRAFT — Kevin reviews
  "ops.serving.lineBase": "Dịch vụ chính", // DRAFT — Kevin reviews
  "ops.serving.lineProgress": "Tiến độ", // DRAFT — Kevin reviews
  "ops.serving.lineHistory": "Lịch sử của dòng này", // DRAFT — Kevin reviews
  "ops.serving.lineHistoryNone": "Chưa có thay đổi nào cho dòng này.", // DRAFT — Kevin reviews
  "syschk.inventory.po_receipt_vs_ledger": "Mỗi lần nhận hàng theo đơn đặt hàng đều được ghi vào sổ kho đúng một lần", // DRAFT — Kevin reviews
  "syschk.inventory.po_receipt_vs_ledger.fix": "Số lượng đơn ghi đã nhận không khớp với các biến động kho đã ghi. Mở đơn đặt hàng và đếm lại sản phẩm.", // DRAFT — Kevin reviews
  "syschk.inventory.transfer_vs_ledger": "Mỗi lần chuyển kho đều được ghi vào sổ kho đúng một lần", // DRAFT — Kevin reviews
  "syschk.inventory.transfer_vs_ledger.fix": "Số lượng chuyển không khớp với các biến động kho. Mở phiếu chuyển và đếm lại ở cả hai chi nhánh.", // DRAFT — Kevin reviews
  "syschk.technicians.duplicate_app_account": "Không có hai thợ dùng chung một tài khoản ứng dụng", // DRAFT — Kevin reviews
  "syschk.technicians.duplicate_app_account.fix": "Hai hồ sơ thợ đăng nhập cùng một tài khoản. Giữ một và gỡ liên kết hồ sơ kia.", // DRAFT — Kevin reviews
  "syschk.technicians.app_account_foreign": "Mọi tài khoản ứng dụng của thợ thuộc về tiệm này", // DRAFT — Kevin reviews
  "syschk.technicians.app_account_foreign.fix": "Một thợ được liên kết với tài khoản của tiệm khác. Gỡ liên kết và mời lại.", // DRAFT — Kevin reviews
  "syschk.technicians.app_account_not_active": "Mọi thợ đang làm đều đăng nhập được ứng dụng", // DRAFT — Kevin reviews
  "syschk.technicians.app_account_not_active.fix": "Tài khoản ứng dụng bị tạm ngưng hoặc chưa kích hoạt. Kích hoạt lại hoặc gửi lời mời mới.", // DRAFT — Kevin reviews
  "syschk.technicians.app_not_used_90d": "Mọi thợ đang làm đã dùng ứng dụng trong 90 ngày qua", // DRAFT — Kevin reviews
  "syschk.technicians.app_not_used_90d.fix": "Kết nối ứng dụng có vẻ đã cũ. Kiểm tra thợ vẫn làm ở đây và đăng nhập được.", // DRAFT — Kevin reviews
  "syschk.technicians.branch_not_open": "Mọi thợ đang làm đều ở chi nhánh đang mở", // DRAFT — Kevin reviews
  "syschk.technicians.branch_not_open.fix": "Chuyển thợ sang chi nhánh đang mở hoặc ngừng hoạt động thợ.", // DRAFT — Kevin reviews
  "syschk.technicians.service_link_archived": "Không thợ nào được gán dịch vụ đã lưu trữ", // DRAFT — Kevin reviews
  "syschk.technicians.service_link_archived.fix": "Gỡ dịch vụ đã lưu trữ khỏi danh sách dịch vụ của thợ.", // DRAFT — Kevin reviews
  "syschk.technicians.service_certification_missing": "Mọi dịch vụ cần chứng chỉ đều có chứng chỉ hợp lệ", // DRAFT — Kevin reviews
  "syschk.technicians.service_certification_missing.fix": "Dịch vụ yêu cầu chứng chỉ mà thợ chưa có (đã xác minh, còn hạn). Thêm chứng chỉ hoặc gỡ dịch vụ.", // DRAFT — Kevin reviews
  "lgx.drill.health": "Mở trong Tình trạng thiết bị", // DRAFT — Kevin reviews
  "lgx.drill.assign": "Phân công thiết bị", // DRAFT — Kevin reviews
  "lgx.drill.terminals": "Mở trong Máy thanh toán", // DRAFT — Kevin reviews
  "lgx.drill.gateway": "Mở Cổng thanh toán", // DRAFT — Kevin reviews
};
