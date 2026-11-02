# VI_GLOSSARY.md — the one approved English → Vietnamese POS glossary

Required by the English + Vietnamese POS mandate (`docs/mandates/2026-10-26_VIETNAMESE_POS_MANDATE.txt` §28–§34, §37, §122).
Every POS translation namespace and every reviewer uses this list. It is version-controlled; a change here is a change
to `apps/pos-web/src/i18n/ns/glossary.{en,vi}.ts` in the same commit (the gate `tooling/ci/check-vi-glossary.mjs` fails
when the two disagree, and fails on a forbidden variant in any POS Vietnamese catalogue).

**Kevin's ruling (Oct 26 2026):** technician = **"Thợ"** everywhere in the Vietnamese POS. The mandate's "Kỹ thuật viên"
(§30) is NOT applied; every term that contains "technician" uses "thợ" (Tech Queue → Hàng chờ thợ, Assign Tech → Chỉ định
thợ, Working Technicians → Thợ đang làm việc). Every other term follows the mandate.

Reviewer: Kevin (native Vietnamese speaker) approved the existing POS Vietnamese on Oct 26 2026 and the "Thợ" ruling the
same day. Terms the mandate did not translate (§37: Visit, Fair Turn, Service Line, Loyalty, Refund, Void, Break) take the
value the approved catalogue already used. Value changes this glossary made to `catalog.vi.ts` are listed before → after
in `docs/i18n/VI_NEW_STRINGS_FOR_REVIEW.md` for his sign-off.

| Reviewer | Date | Scope |
|---|---|---|
| Kevin | 2026-10-26 | "Thợ" ruling; existing catalogue approved |
| _pending_ | | WP-D1 value alignment (review file, section "D1-A" (catalog values changed before → after)) |

## Rules

- **Case follows the English.** A Vietnamese label is written in the case the English label uses on that screen (an
  upper-case section title "TEAM" → "NHÂN VIÊN"; a sentence fragment "tip" → "tiền tip").
- **Canonical codes are never translated** (§20, §26). `READY_FOR_CHECKOUT` stays the stored value; only the label is
  "Sẵn sàng thanh toán". Status labels live in `ns/status` (`statusLabel(domain, code)`), error texts in `ns/errors`
  (`errorText(code)`).
- **Names typed by the salon are not translated** (§49; Kevin's ruling: one service / product name, no bilingual names).

## Forbidden variants (the gate fails on these in any POS Vietnamese catalogue)

| Forbidden | Use instead | Why |
|---|---|---|
| Kỹ thuật viên / kỹ thuật viên | Thợ / thợ | Kevin's ruling; §30 one technician term |
| KTV | Thợ / thợ | abbreviation of the term the ruling replaced |
| kỹ thuật viên nail, nhân viên nail, thợ nail | thợ | §30 do not alternate technician terms |
| hàng đợi | hàng chờ | §28 / §33 queue term |
| biên nhận | hóa đơn | §29 Send / Print Receipt |
| thẻ quà (without "tặng") | thẻ quà tặng | §34 Gift Card |
| Dịch vụ xong | Hoàn tất dịch vụ | §28 / §29 Service Done |
| Nhận thanh toán (as "Take Payment") | Thu tiền | §29 Take Payment |

## Approved terms

### Navigation (§28)

| Key | English | Vietnamese (approved) | Source |
|---|---|---|---|
| `glossary.nav.overview` | Overview | Tổng quan | §28 |
| `glossary.nav.liveOperations` | Live Operations | Vận hành trực tiếp | §28 |
| `glossary.nav.checkIn` | Check-In | Tiếp nhận khách | §28 |
| `glossary.nav.booking` | Booking | Đặt lịch | §28 |
| `glossary.nav.techQueue` | Tech Queue | Hàng chờ thợ | §28 + ruling |
| `glossary.nav.customerQueue` | Customer Queue | Hàng chờ khách | §28 |
| `glossary.nav.serving` | Serving | Đang phục vụ | §28 |
| `glossary.nav.serviceDone` | Service Done | Hoàn tất dịch vụ | §28 |
| `glossary.nav.checkout` | Checkout | Thanh toán | §28 |
| `glossary.nav.customers` | Customers | Khách hàng | §28 |
| `glossary.nav.memberships` | Memberships | Hội viên | §28 |
| `glossary.nav.team` | Team | Nhân viên | §28 |
| `glossary.nav.servicesProducts` | Services & Products | Dịch vụ & Sản phẩm | §28 |
| `glossary.nav.paymentsMoney` | Payments & Money | Thanh toán & Tài chính | §28 |
| `glossary.nav.communications` | Communications | Liên lạc | §28 |
| `glossary.nav.marketingGrowth` | Marketing & Growth | Tiếp thị & Tăng trưởng | §28 |
| `glossary.nav.aiCenter` | AI Center | Trung tâm AI | §28 |
| `glossary.nav.reports` | Reports | Báo cáo | §28 |
| `glossary.nav.management` | Management | Quản lý | §28 |
| `glossary.nav.devicesIntegrations` | Devices & Integrations | Thiết bị & Tích hợp | §28 |
| `glossary.nav.account` | Account | Tài khoản | §28 |

### Actions (§29)

| Key | English | Vietnamese (approved) | Source |
|---|---|---|---|
| `glossary.action.save` | Save | Lưu | §29 |
| `glossary.action.cancel` | Cancel | Hủy | §29 |
| `glossary.action.close` | Close | Đóng | §29 |
| `glossary.action.search` | Search | Tìm kiếm | §29 |
| `glossary.action.edit` | Edit | Chỉnh sửa | §29 |
| `glossary.action.delete` | Delete | Xóa | §29 |
| `glossary.action.viewAll` | View All | Xem tất cả | §29 |
| `glossary.action.newCheckIn` | New Check-In | Tiếp nhận khách mới | §29 |
| `glossary.action.newBooking` | New Booking | Đặt lịch mới | §29 |
| `glossary.action.walkIn` | Walk-In | Khách vãng lai | §29 |
| `glossary.action.assignTech` | Assign Tech | Chỉ định thợ | §29 + ruling |
| `glossary.action.startService` | Start Service | Bắt đầu dịch vụ | §29 |
| `glossary.action.serviceDone` | Service Done | Hoàn tất dịch vụ | §29 |
| `glossary.action.takePayment` | Take Payment | Thu tiền | §29 |
| `glossary.action.sendReceipt` | Send Receipt | Gửi hóa đơn | §29 |
| `glossary.action.printReceipt` | Print Receipt | In hóa đơn | §29 |
| `glossary.action.addProduct` | Add Product | Thêm sản phẩm | §29 |
| `glossary.action.addService` | Add Service | Thêm dịch vụ | §29 |
| `glossary.action.sendMessage` | Send Message | Gửi tin nhắn | §29 |
| `glossary.action.openCustomer` | Open Customer | Mở hồ sơ khách | §29 |
| `glossary.action.viewReports` | View Reports | Xem báo cáo | §29 |
| `glossary.action.openCashDrawer` | Open Cash Drawer | Mở ngăn kéo tiền | §29 |

### Technician / customer / guest (§30, §31)

| Key | English | Vietnamese (approved) | Source |
|---|---|---|---|
| `glossary.people.technician` | Technician | Thợ | §30 (Kevin ruling Oct 26 2026: Thợ, not Kỹ thuật viên) |
| `glossary.people.customer` | Customer | Khách hàng | §31 |
| `glossary.people.guest` | Guest | Khách | §31 |
| `glossary.people.waitingGuest` | Waiting Guest | Khách đang chờ | §31 |
| `glossary.people.returningCustomer` | Returning Customer | Khách quay lại | §31 |
| `glossary.people.newCustomer` | New Customer | Khách mới | §31 |
| `glossary.people.vipCustomer` | VIP Customer | Khách VIP | §31 |

### Booking (§32)

| Key | English | Vietnamese (approved) | Source |
|---|---|---|---|
| `glossary.booking.appointment` | Appointment | Lịch hẹn | §32 |
| `glossary.booking.findOpening` | Find an Opening | Tìm giờ trống | §32 |
| `glossary.booking.available` | Available | Có thể phục vụ | §32 |
| `glossary.booking.arrivingSoon` | Arriving Soon | Sắp đến | §32 |
| `glossary.booking.waitlist` | Waitlist | Danh sách chờ | §32 |
| `glossary.booking.bestMatches` | Best Matches | Phù hợp nhất | §32 |
| `glossary.booking.workingTechnicians` | Working Technicians | Thợ đang làm việc | §32 + ruling |
| `glossary.booking.bookAppointment` | Book Appointment | Đặt lịch | §32 |
| `glossary.booking.checkAvailability` | Check Availability | Kiểm tra giờ trống | §32 |

### Queue (§33)

| Key | English | Vietnamese (approved) | Source |
|---|---|---|---|
| `glossary.queue.waiting` | Waiting | Đang chờ | §33 |
| `glossary.queue.ready` | Ready | Sẵn sàng | §33 |
| `glossary.queue.serving` | Serving | Đang phục vụ | §33 |
| `glossary.queue.onBreak` | On Break | Đang nghỉ | §33 |
| `glossary.queue.queueHold` | Queue Hold | Tạm dừng hàng chờ | §33 |
| `glossary.queue.assigned` | Assigned | Đã chỉ định | §33 |
| `glossary.queue.readyForAssignment` | Ready for Assignment | Sẵn sàng chỉ định | §33 |
| `glossary.queue.readyForService` | Ready for Service | Sẵn sàng phục vụ | §33 |
| `glossary.queue.waitTime` | Wait Time | Thời gian chờ | §33 |

### Checkout and payment (§34)

| Key | English | Vietnamese (approved) | Source |
|---|---|---|---|
| `glossary.checkout.subtotal` | Subtotal | Tạm tính | §34 |
| `glossary.checkout.discount` | Discount | Giảm giá | §34 |
| `glossary.checkout.tax` | Tax | Thuế | §34 |
| `glossary.checkout.tip` | Tip | Tiền tip | §34 |
| `glossary.checkout.total` | Total | Tổng cộng | §34 |
| `glossary.checkout.amountPaid` | Amount Paid | Đã thanh toán | §34 |
| `glossary.checkout.balanceDue` | Balance Due | Còn phải trả | §34 |
| `glossary.checkout.cash` | Cash | Tiền mặt | §34 |
| `glossary.checkout.card` | Card | Thẻ | §34 |
| `glossary.checkout.giftCard` | Gift Card | Thẻ quà tặng | §34 |
| `glossary.checkout.splitPayment` | Split Payment | Chia thanh toán | §34 |
| `glossary.checkout.splitTicket` | Split Ticket | Chia hóa đơn | §34 |
| `glossary.checkout.paymentComplete` | Payment Complete | Thanh toán hoàn tất | §34 |
| `glossary.checkout.paymentDeclined` | Payment Declined | Thanh toán bị từ chối | §34 |
| `glossary.checkout.verifyPayment` | Verify Payment | Kiểm tra thanh toán | §34 |

### Central product terms (§37)

| Key | English | Vietnamese (approved) | Source |
|---|---|---|---|
| `glossary.term.visit` | Visit | Lượt ghé | §37 (existing approved catalog value) |
| `glossary.term.queue` | Queue | Hàng chờ | §37 / §33 |
| `glossary.term.fairTurn` | Fair Turn | Lượt công bằng | §37 (existing approved catalog value) |
| `glossary.term.service` | Service | Dịch vụ | §37 |
| `glossary.term.serviceLine` | Service Line | Dòng dịch vụ | §37 (existing approved catalog value) |
| `glossary.term.payment` | Payment | Thanh toán | §37 |
| `glossary.term.loyalty` | Loyalty | Khách thân thiết | §37 (existing approved catalog value) |
| `glossary.term.receipt` | Receipt | Hóa đơn | §37 / §29 |
| `glossary.term.refund` | Refund | Hoàn tiền | §37 (existing approved catalog value) |
| `glossary.term.void` | Void | Hủy giao dịch | §37 (existing approved catalog value) |
| `glossary.term.break` | Break | Giờ nghỉ | §37 (existing approved catalog value) |
| `glossary.term.readyForCheckout` | Ready for Checkout | Sẵn sàng thanh toán | §20 / §37 |
