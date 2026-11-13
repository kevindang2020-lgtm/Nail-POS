// ns/bsb.vi.ts — Bảng lịch đặt hẹn (Booking Schedule Board), Tiếng Việt. Chỉ cho màn hình POS Front Desk của nhân viên.
export const BSB_VI = {
  'bsb.toolbar.view': 'Chế độ xem', // DRAFT — Kevin reviews
  'bsb.toolbar.day': 'Ngày', // DRAFT — Kevin reviews
  'bsb.toolbar.week': 'Tuần', // DRAFT — Kevin reviews
  'bsb.toolbar.today': 'Hôm nay', // DRAFT — Kevin reviews
  'bsb.toolbar.prevDay': 'Ngày trước', // DRAFT — Kevin reviews
  'bsb.toolbar.nextDay': 'Ngày sau', // DRAFT — Kevin reviews
  'bsb.toolbar.selectedDate': 'Ngày đang chọn {date}; chọn ngày khác', // DRAFT — Kevin reviews
  'bsb.toolbar.serviceFilter': 'Lọc theo dịch vụ', // DRAFT — Kevin reviews
  'bsb.toolbar.allServices': 'Tất cả dịch vụ', // DRAFT — Kevin reviews
  'bsb.toolbar.status': 'Trạng thái', // DRAFT — Kevin reviews
  'bsb.toolbar.statusesN': '{n} trạng thái', // DRAFT — Kevin reviews
  'bsb.toolbar.statusFilter': 'Lọc trạng thái', // DRAFT — Kevin reviews
  'bsb.toolbar.clear': 'Xóa lọc', // DRAFT — Kevin reviews
  'bsb.toolbar.gridResolution': 'Độ chia lưới', // DRAFT — Kevin reviews
  'bsb.toolbar.grid15': 'Lưới 15 phút', // DRAFT — Kevin reviews
  'bsb.toolbar.fitDay': 'Vừa trong ngày', // DRAFT — Kevin reviews
  'bsb.toolbar.fullScreen': 'Toàn màn hình', // DRAFT — Kevin reviews
  'bsb.toolbar.exitFullScreen': 'Thoát toàn màn hình', // DRAFT — Kevin reviews
  'bsb.status.scheduled': 'Đã đặt', // DRAFT — Kevin reviews
  'bsb.status.confirmed': 'Đã xác nhận', // DRAFT — Kevin reviews
  'bsb.status.arrived': 'Đã đến', // DRAFT — Kevin reviews
  'bsb.status.in_service': 'Đang phục vụ', // DRAFT — Kevin reviews
  'bsb.status.completed': 'Đã hoàn tất', // DRAFT — Kevin reviews
  'bsb.status.cancelled': 'Đã hủy', // DRAFT — Kevin reviews
  'bsb.status.no_show': 'Không đến', // DRAFT — Kevin reviews
  'bsb.status.rescheduled': 'Đã dời lịch', // DRAFT — Kevin reviews
  'bsb.opening.find': 'Tìm giờ trống', // DRAFT — Kevin reviews
  'bsb.opening.serviceToBook': 'Dịch vụ cần đặt', // DRAFT — Kevin reviews
  'bsb.opening.chooseService': 'Chọn dịch vụ…', // DRAFT — Kevin reviews
  'bsb.opening.serviceOption': '{name} · {min} phút', // DRAFT — Kevin reviews
  'bsb.opening.bestMatches': 'Phù hợp nhất', // DRAFT — Kevin reviews
  'bsb.opening.rankFor': 'Xếp hạng thợ cho {name}', // DRAFT — Kevin reviews
  'bsb.opening.chooseServiceFirst': 'Hãy chọn dịch vụ trước', // DRAFT — Kevin reviews
  'bsb.opening.workingTechs': 'Thợ đang làm việc ({n})', // DRAFT — Kevin reviews
  'bsb.opening.filteredTechs': '{n} trên {total} thợ', // DRAFT — Kevin reviews
  'bsb.opening.techFilter': 'Lọc thợ', // DRAFT — Kevin reviews
  'bsb.opening.allWorking': 'Tất cả thợ đang làm việc ({n})', // DRAFT — Kevin reviews
  'bsb.opening.offToday': 'Nghỉ hôm nay: {names}', // DRAFT — Kevin reviews
  'bsb.opening.allTechs': 'Tất cả thợ ({n})', // DRAFT — Kevin reviews
  'bsb.opening.workingOnly': 'Chỉ thợ làm việc hôm nay ({n})', // DRAFT — Kevin reviews
  'bsb.opening.perPage': 'Số thợ mỗi trang', // DRAFT — Kevin reviews
  'bsb.opening.perPageOption': '{n} mỗi trang', // DRAFT — Kevin reviews
  'bsb.pager.previous': 'Trước', // DRAFT — Kevin reviews
  'bsb.pager.range': 'Thợ {first}–{last} trên {total}', // DRAFT — Kevin reviews
  'bsb.pager.none': 'Không có thợ', // DRAFT — Kevin reviews
  'bsb.pager.next': '{n} tiếp', // DRAFT — Kevin reviews
  'bsb.pager.page': 'Trang {page} / {pages}', // DRAFT — Kevin reviews
  'bsb.pager.nextTechs': '{n} thợ tiếp theo', // DRAFT — Kevin reviews
  'bsb.tech.state.working': 'Đang làm', // DRAFT — Kevin reviews
  'bsb.tech.state.off': 'Nghỉ', // DRAFT — Kevin reviews
  'bsb.tech.state.time_off': 'Nghỉ phép', // DRAFT — Kevin reviews
  'bsb.tech.state.on_break': 'Đang nghỉ giải lao', // DRAFT — Kevin reviews
  'bsb.tech.state.lunch': 'Nghỉ trưa', // DRAFT — Kevin reviews
  'bsb.tech.state.in_service': 'Đang phục vụ', // DRAFT — Kevin reviews
  'bsb.tech.state.blocked': 'Đã chặn', // DRAFT — Kevin reviews
  'bsb.tech.offToday': 'Nghỉ hôm nay', // DRAFT — Kevin reviews
  'bsb.tech.moreActions': 'Thao tác khác cho {name}', // DRAFT — Kevin reviews
  'bsb.tech.viewFullDay': 'Xem cả ngày', // DRAFT — Kevin reviews
  'bsb.tech.blockTime': 'Chặn thời gian…', // DRAFT — Kevin reviews
  'bsb.tech.clearSelection': 'Bỏ chọn', // DRAFT — Kevin reviews
  'bsb.tech.selectColumn': 'Chọn cột', // DRAFT — Kevin reviews
  'bsb.tech.viewDay': 'Xem ngày', // DRAFT — Kevin reviews
  'bsb.tech.stateTitle': '{state} · {shift} · {n} lịch đã đặt', // DRAFT — Kevin reviews
  'bsb.avail.timeOff': 'Nghỉ phép', // DRAFT — Kevin reviews
  'bsb.avail.notWorking': 'Không làm hôm nay', // DRAFT — Kevin reviews
  'bsb.avail.fullyBooked': 'Đã kín lịch', // DRAFT — Kevin reviews
  'bsb.avail.minOpen': 'phút trống', // DRAFT — Kevin reviews
  'bsb.avail.noOpeningsLeft': 'Hết giờ trống', // DRAFT — Kevin reviews
  'bsb.avail.bookAt': 'Đặt lịch với {name} lúc {range}', // DRAFT — Kevin reviews
  'bsb.avail.viewAll': 'Xem tất cả', // DRAFT — Kevin reviews
  'bsb.avail.viewAllLabel': 'Xem cả {n} khoảng trống của {name} ({min} phút trống)', // DRAFT — Kevin reviews
  'bsb.avail.caption': 'Giờ trống trong ngày', // DRAFT — Kevin reviews
  'bsb.avail.captionHint': 'chạm vào giờ trống để đặt lịch', // DRAFT — Kevin reviews
  'bsb.avail.openTimes': 'giờ trống', // DRAFT — Kevin reviews
  'bsb.avail.openTimesTitle': 'Tổng thời gian trống của các thợ đang hiển thị', // DRAFT — Kevin reviews
  'bsb.avail.hm': '{h} giờ {m} phút', // DRAFT — Kevin reviews
  'bsb.avail.h': '{h} giờ', // DRAFT — Kevin reviews
  'bsb.avail.m': '{m} phút', // DRAFT — Kevin reviews
  'bsb.grid.notVisible': 'Thợ không hiển thị', // DRAFT — Kevin reviews
  'bsb.grid.noReassign': 'Không có quyền chuyển thợ', // DRAFT — Kevin reviews
  'bsb.grid.unavailable': 'Không trống', // DRAFT — Kevin reviews
  'bsb.grid.noTechs': 'Không có thợ nào khớp bộ lọc hiện tại.', // DRAFT — Kevin reviews
  'bsb.grid.loading': 'Đang tải lịch', // DRAFT — Kevin reviews
  'bsb.grid.retry': 'Thử lại', // DRAFT — Kevin reviews
  'bsb.elig.TENANT_MISMATCH': 'Tiệm khác', // DRAFT — Kevin reviews
  'bsb.elig.BRANCH_MISMATCH': 'Chi nhánh khác', // DRAFT — Kevin reviews
  'bsb.elig.INACTIVE': 'Ngưng hoạt động', // DRAFT — Kevin reviews
  'bsb.elig.NOT_WORKING': 'Không làm việc', // DRAFT — Kevin reviews
  'bsb.elig.SERVICE_INELIGIBLE': 'Chưa được duyệt cho dịch vụ này', // DRAFT — Kevin reviews
  'bsb.elig.SERVICE_INACTIVE': 'Dịch vụ đã ngưng', // DRAFT — Kevin reviews
  'bsb.elig.SERVICE_NOT_AT_BRANCH': 'Chi nhánh không có dịch vụ này', // DRAFT — Kevin reviews
  'bsb.elig.OVERLAP': 'Đã có lịch', // DRAFT — Kevin reviews
  'bsb.elig.LUNCH': 'Nghỉ trưa', // DRAFT — Kevin reviews
  'bsb.elig.BREAK': 'Giờ nghỉ', // DRAFT — Kevin reviews
  'bsb.elig.BLOCKED': 'Thời gian đã chặn', // DRAFT — Kevin reviews
  'bsb.elig.TIME_OFF': 'Nghỉ phép', // DRAFT — Kevin reviews
  'bsb.elig.PROTECTED': 'Chạm vào lịch hẹn được giữ chỗ', // DRAFT — Kevin reviews
  'bsb.elig.OFF_GRID': 'Không đúng lưới 15 phút', // DRAFT — Kevin reviews
  'bsb.elig.INVALID_DURATION': 'Thời lượng không hợp lệ', // DRAFT — Kevin reviews
  'bsb.elig.POLICY_LEAD_TIME': 'Quá sát giờ', // DRAFT — Kevin reviews
  'bsb.elig.POLICY_MAX_DURATION': 'Vượt thời lượng tối đa', // DRAFT — Kevin reviews
  'bsb.elig.REQUESTED_OTHER_TECHNICIAN': 'Khách đã yêu cầu thợ khác', // DRAFT — Kevin reviews
  'bsb.card.walkIn': 'Khách vãng lai', // DRAFT — Kevin reviews
  'bsb.card.walkInName': 'Khách vãng lai: {name}', // DRAFT — Kevin reviews
  'bsb.card.protected': 'Được giữ chỗ', // DRAFT — Kevin reviews
  'bsb.card.requested': 'Khách yêu cầu thợ', // DRAFT — Kevin reviews
  'bsb.card.min': '{n} phút', // DRAFT — Kevin reviews
  'bsb.card.minShort': '{n}p', // DRAFT — Kevin reviews
  'bsb.open.bookAt': 'Đặt lịch lúc {time}, còn trống {n} phút', // DRAFT — Kevin reviews
  'bsb.open.passed': 'Giờ này đã qua', // DRAFT — Kevin reviews
  'bsb.open.bookMin': 'Đặt · {n}p', // DRAFT — Kevin reviews
  'bsb.seg.working': 'Đang làm', // DRAFT — Kevin reviews
  'bsb.seg.lunch': 'Nghỉ trưa', // DRAFT — Kevin reviews
  'bsb.seg.break': 'Giờ nghỉ', // DRAFT — Kevin reviews
  'bsb.seg.blocked': 'Đã chặn', // DRAFT — Kevin reviews
  'bsb.seg.time_off': 'Nghỉ phép', // DRAFT — Kevin reviews
  'bsb.seg.createdBy': 'Tạo bởi {who}', // DRAFT — Kevin reviews
  'bsb.seg.notBookable': 'không thể đặt lịch', // DRAFT — Kevin reviews
  'bsb.legend.walkIn': 'Khách vãng lai', // DRAFT — Kevin reviews
  'bsb.legend.open': 'Trống', // DRAFT — Kevin reviews
  'bsb.legend.break': 'Giờ nghỉ', // DRAFT — Kevin reviews
  'bsb.legend.blocked': 'Đã chặn', // DRAFT — Kevin reviews
  'bsb.legend.blockTime': 'Chặn thời gian', // DRAFT — Kevin reviews
  'bsb.bottom.prev': 'Các thợ trước', // DRAFT — Kevin reviews
  'bsb.bottom.next': 'Các thợ tiếp theo', // DRAFT — Kevin reviews
  'bsb.bottom.pages': 'Các trang thợ', // DRAFT — Kevin reviews
  'bsb.bottom.hint': 'Vuốt hoặc kéo sang trái/phải để xem thêm thợ', // DRAFT — Kevin reviews
  'bsb.block.title': 'Chặn thời gian', // DRAFT — Kevin reviews
  'bsb.block.cancel': 'Hủy', // DRAFT — Kevin reviews
  'bsb.block.submit': 'Chặn thời gian', // DRAFT — Kevin reviews
  'bsb.block.busy': 'Đang chặn…', // DRAFT — Kevin reviews
  'bsb.block.technician': 'Thợ', // DRAFT — Kevin reviews
  'bsb.block.date': 'Ngày', // DRAFT — Kevin reviews
  'bsb.block.start': 'Giờ bắt đầu', // DRAFT — Kevin reviews
  'bsb.block.duration': 'Thời lượng', // DRAFT — Kevin reviews
  'bsb.block.durationOption': '{n} phút', // DRAFT — Kevin reviews
  'bsb.block.end': 'Giờ kết thúc', // DRAFT — Kevin reviews
  'bsb.block.reason': 'Lý do', // DRAFT — Kevin reviews
  'bsb.block.notes': 'Ghi chú', // DRAFT — Kevin reviews
  'bsb.block.optional': 'Không bắt buộc', // DRAFT — Kevin reviews
  'bsb.block.help': 'Thời gian đã chặn không thể đặt lịch và được ghi lại người tạo. Các giờ trống bị trùng sẽ biến mất ngay.', // DRAFT — Kevin reviews
  'bsb.block.reason.training': 'Đào tạo', // DRAFT — Kevin reviews
  'bsb.block.reason.supply': 'Đi lấy vật tư', // DRAFT — Kevin reviews
  'bsb.block.reason.personal': 'Việc riêng', // DRAFT — Kevin reviews
  'bsb.block.reason.cleaning': 'Dọn dẹp', // DRAFT — Kevin reviews
  'bsb.block.reason.meeting': 'Họp', // DRAFT — Kevin reviews
  'bsb.block.reason.other': 'Khác', // DRAFT — Kevin reviews
  'bsb.find.title': 'Tìm giờ trống', // DRAFT — Kevin reviews
  'bsb.find.services': 'Dịch vụ (tổng {n} phút)', // DRAFT — Kevin reviews
  'bsb.find.servicesGroup': 'Dịch vụ', // DRAFT — Kevin reviews
  'bsb.find.technician': 'Thợ', // DRAFT — Kevin reviews
  'bsb.find.any': 'Thợ bất kỳ', // DRAFT — Kevin reviews
  'bsb.find.date': 'Ngày', // DRAFT — Kevin reviews
  'bsb.find.from': 'Từ', // DRAFT — Kevin reviews
  'bsb.find.to': 'Đến', // DRAFT — Kevin reviews
  'bsb.find.chooseOne': 'Chọn ít nhất một dịch vụ để tìm.', // DRAFT — Kevin reviews
  'bsb.find.searching': 'Đang tìm…', // DRAFT — Kevin reviews
  'bsb.find.none': 'Không có giờ trống {n} phút với thợ phù hợp trong khoảng này.', // DRAFT — Kevin reviews
  'bsb.find.row': 'Dịch vụ {n} phút · khoảng trống {gap} phút', // DRAFT — Kevin reviews
  'bsb.find.book': 'Đặt lịch', // DRAFT — Kevin reviews
  'bsb.best.title': 'Phù hợp nhất · {service}', // DRAFT — Kevin reviews
  'bsb.best.serviceFallback': 'Dịch vụ', // DRAFT — Kevin reviews
  'bsb.best.requested': 'Thợ được yêu cầu', // DRAFT — Kevin reviews
  'bsb.best.none': 'Không (thợ bất kỳ)', // DRAFT — Kevin reviews
  'bsb.best.preferred': 'Giờ bắt đầu mong muốn', // DRAFT — Kevin reviews
  'bsb.best.ranking': 'Đang xếp hạng thợ phù hợp…', // DRAFT — Kevin reviews
  'bsb.best.noMatch': 'Không có thợ phù hợp còn trống {n} phút từ {time}.', // DRAFT — Kevin reviews
  'bsb.best.earliest': 'Sớm nhất {time}', // DRAFT — Kevin reviews
  'bsb.best.noOpening': 'Không có giờ trống', // DRAFT — Kevin reviews
  'bsb.best.score': 'điểm {n}', // DRAFT — Kevin reviews
  'bsb.best.excluded': '{n} thợ không được xếp hạng (không phù hợp, hoặc hết giờ trống)', // DRAFT — Kevin reviews
  'bsb.best.reason.rank': 'Hạng {n} trên {total} thợ phù hợp', // DRAFT — Kevin reviews
  'bsb.best.reason.openSlots': 'Còn {n} giờ bắt đầu trống hôm nay', // DRAFT — Kevin reviews
  'bsb.best.reason.roster': 'Số thứ tự #{n}', // DRAFT — Kevin reviews
  'bsb.day.title': '{name} · cả ngày', // DRAFT — Kevin reviews
  'bsb.day.titleFallback': 'Lịch trong ngày của thợ', // DRAFT — Kevin reviews
  'bsb.day.loading': 'Đang tải…', // DRAFT — Kevin reviews
  'bsb.day.appointments': 'lịch hẹn', // DRAFT — Kevin reviews
  'bsb.day.minBooked': 'phút đã đặt', // DRAFT — Kevin reviews
  'bsb.day.minOpen': 'phút trống', // DRAFT — Kevin reviews
  'bsb.day.minShift': 'phút trong ca', // DRAFT — Kevin reviews
  'bsb.day.timeline': 'Dòng thời gian', // DRAFT — Kevin reviews
  'bsb.day.open': 'Trống', // DRAFT — Kevin reviews
  'bsb.day.bookChip': '{n} phút · Đặt', // DRAFT — Kevin reviews
  'bsb.day.walkIn': '(khách vãng lai)', // DRAFT — Kevin reviews
  'bsb.day.protected': 'được giữ chỗ', // DRAFT — Kevin reviews
  'bsb.appt.open': 'Mở lịch hẹn', // DRAFT — Kevin reviews
  'bsb.appt.cancel': 'Hủy lịch hẹn…', // DRAFT — Kevin reviews
  'bsb.appt.move': 'Dời', // DRAFT — Kevin reviews
  'bsb.appt.moving': 'Đang dời…', // DRAFT — Kevin reviews
  'bsb.appt.moveHeading': 'Dời lịch (máy chủ kiểm tra)', // DRAFT — Kevin reviews
  'bsb.appt.technician': 'Thợ', // DRAFT — Kevin reviews
  'bsb.appt.start': 'Bắt đầu', // DRAFT — Kevin reviews
  'bsb.appt.requestedNotice': 'Khách đã yêu cầu {name}. Việc chuyển thợ sẽ bị từ chối trừ khi chính sách của tiệm cho phép.', // DRAFT — Kevin reviews
  'bsb.appt.cancelQ': 'Hủy lịch hẹn này?', // DRAFT — Kevin reviews
  'bsb.appt.reason': 'Lý do', // DRAFT — Kevin reviews
  'bsb.appt.reasonPh': 'Vì sao hủy?', // DRAFT — Kevin reviews
  'bsb.appt.keep': 'Giữ lại', // DRAFT — Kevin reviews
  'bsb.appt.confirmCancel': 'Xác nhận hủy', // DRAFT — Kevin reviews
  'bsb.viewAll.label': 'Tất cả giờ trống của {name}', // DRAFT — Kevin reviews
  'bsb.viewAll.title': '{name} · {n} khoảng trống', // DRAFT — Kevin reviews
  'bsb.viewAll.none': 'Hôm nay không còn giờ trống.', // DRAFT — Kevin reviews
  'bsb.week.technician': 'Thợ', // DRAFT — Kevin reviews
  'bsb.week.off': 'Nghỉ', // DRAFT — Kevin reviews
  'bsb.week.summary': '{n} lịch · {m} phút trống', // DRAFT — Kevin reviews
  'bsb.week.label': '{name} ngày {date}: {n} lịch hẹn, {m} phút trống', // DRAFT — Kevin reviews
  'bsb.toast.movedTime': 'Đã dời {name} sang giờ mới.', // DRAFT — Kevin reviews
  'bsb.toast.movedTech': 'Đã chuyển {name} sang thợ khác.', // DRAFT — Kevin reviews
  'bsb.toast.cancelled': 'Đã hủy lịch hẹn của {name}.', // DRAFT — Kevin reviews
  'bsb.toast.blocked': 'Đã chặn thời gian. Các giờ trống bị trùng đã được gỡ.', // DRAFT — Kevin reviews
  'bsb.ui.close': 'Đóng', // DRAFT — Kevin reviews
  'bsb.ui.dismiss': 'Ẩn', // DRAFT — Kevin reviews
  'bsb.err.APPOINTMENT_CONFLICT': 'Giờ này vừa có người đặt. Lịch đã được cập nhật.', // DRAFT — Kevin reviews
  'bsb.err.TECHNICIAN_UNAVAILABLE': 'Thợ này không trống vào giờ đó.', // DRAFT — Kevin reviews
  'bsb.err.TECHNICIAN_SERVICE_INELIGIBLE': 'Thợ này chưa được duyệt cho dịch vụ đã chọn.', // DRAFT — Kevin reviews
  'bsb.err.SCHEDULE_CHANGED': 'Lịch đã thay đổi trong lúc bạn thao tác. Lịch đã được làm mới.', // DRAFT — Kevin reviews
  'bsb.err.PERMISSION_DENIED': 'Bạn không có quyền thực hiện thay đổi này.', // DRAFT — Kevin reviews
  'bsb.err.INVALID_DURATION': 'Thời lượng dịch vụ không vừa khoảng trống đã chọn.', // DRAFT — Kevin reviews
  'bsb.err.BLOCKED_TIME_CONFLICT': 'Giờ này đã bị chặn, không thể đặt lịch.', // DRAFT — Kevin reviews
  'bsb.err.APPOINTMENT_PROTECTION': 'Dịch vụ này sẽ chạm vào một lịch hẹn được giữ chỗ.', // DRAFT — Kevin reviews
  'bsb.err.NOT_FOUND': 'Lịch hẹn này không còn nữa.', // DRAFT — Kevin reviews
  'bsb.err.VALIDATION_FAILED': 'Một số thông tin đặt lịch không hợp lệ.', // DRAFT — Kevin reviews
  'bsb.err.NETWORK_ERROR': 'Không kết nối được dịch vụ lịch. Vui lòng thử lại.', // DRAFT — Kevin reviews
  'bsb.err.UNKNOWN': 'Đã có lỗi. Lịch đã được làm mới.', // DRAFT — Kevin reviews
  'bsb.host.classic': 'Bảng lịch cũ', // DRAFT — Kevin reviews
  'bsb.host.classicHint': 'Hiện lịch cũ thay cho bảng mới (ghi nhớ cho bạn trên thiết bị này)', // DRAFT — Kevin reviews
};
