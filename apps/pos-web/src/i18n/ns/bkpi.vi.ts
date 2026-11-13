// bkpi.vi.ts — Booking KPI strip (booking200 addendum §08, round 12) in Vietnamese. Glossary: Thợ · hóa đơn · hàng chờ.
// Pending a native-speaker review.
export const BKPI_VI: Record<string, string> = {
  "bkpi.region": "Tóm tắt lịch hẹn", // DRAFT — Kevin reviews
  "bkpi.loading": "Đang tải…", // DRAFT — Kevin reviews
  "bkpi.notToday": "Chỉ hôm nay", // DRAFT — Kevin reviews
  "bkpi.liveTodayOnly": "Trực tiếp — chỉ hôm nay", // DRAFT — Kevin reviews
  "bkpi.unavailable": "Không tải được — không phải số 0", // DRAFT — Kevin reviews
  "bkpi.stale": "Đang hiện số liệu tải lần trước — không làm mới được", // DRAFT — Kevin reviews
  "bkpi.retry": "Thử lại", // DRAFT — Kevin reviews
  "bkpi.appointments.sub": "{awaiting} chờ xác nhận · {confirmed} đã xác nhận", // DRAFT — Kevin reviews
  "bkpi.appointments.subShort": "Đã đặt cho ngày này", // DRAFT — Kevin reviews
  "bkpi.arriving.sub": "{minutes} phút tới", // DRAFT — Kevin reviews
  "bkpi.arriving.window": "Khoảng thời gian sắp đến", // DRAFT — Kevin reviews
  "bkpi.arriving.minutes": "{minutes} phút", // DRAFT — Kevin reviews
  "bkpi.walkins.sub": "{booked} đã đặt · {queue} từ hàng chờ", // DRAFT — Kevin reviews
  "bkpi.waitlist.sub": "Đang chờ trong hàng chờ khách", // DRAFT — Kevin reviews
  "bkpi.available.sub": "{working} Thợ làm hôm nay", // DRAFT — Kevin reviews
  "bkpi.available.otherDay": "{working} Thợ có lịch ngày đó", // DRAFT — Kevin reviews
  "bkpi.revenue.sub": "Dịch vụ đã đặt · chưa thu", // DRAFT — Kevin reviews
  "bkpi.revenue.basis": "Giá dịch vụ của các lịch hẹn đã đặt trong ngày (không tính lịch đã hủy và vắng mặt). Không gồm thuế, tiền tip, phụ phí và giảm giá. Không phải tiền đã thu.", // DRAFT — Kevin reviews
  "bkpi.open": "Mở danh sách đã lọc", // DRAFT — Kevin reviews
};
