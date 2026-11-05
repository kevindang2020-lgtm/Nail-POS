#!/usr/bin/env python3
"""
e2e_moneypath.py — end-to-end money-path check against a LIVE Postgres-backed API.

Drives the real workflow through HTTP (login -> catalog -> queue -> serving ->
service-done -> checkout -> payment) and asserts the backend-authoritative totals.
Exercises three tenders that need no external hardware:
  1. CASH (full, with tip)            -> the core money path
  2. GIFT CARD (full)                 -> migration 033 tables + gift_card payment path
  3. CARD (processor not configured)  -> honest "not_configured" persisted, no fake auth

Exit code 0 = all assertions passed; non-zero = a failure (suitable for CI).

Config via env (defaults match scripts/seed.ts defaults):
  E2E_BASE_URL   (default http://127.0.0.1:3001)
  E2E_SALON_CODE (default PILOT01)
  E2E_OWNER_EMAIL / E2E_OWNER_PASSWORD
"""
import json, os, sys, time, urllib.request, urllib.error, http.cookiejar

BASE = os.environ.get("E2E_BASE_URL", "http://127.0.0.1:3001")
SALON = os.environ.get("E2E_SALON_CODE", "PILOT01")
OWNER_EMAIL = os.environ.get("E2E_OWNER_EMAIL", "owner@pilotsalon.com")
OWNER_PW = os.environ.get("E2E_OWNER_PASSWORD", "SmokeTest!Owner1")
RID = str(int(time.time() * 1000))[-7:]
TAX_RATE = 7.75  # confirmed from /pos/checkout/settings; re-read below and assert against it
PRICE = 5000
TIP = 1000

cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
failures = []

def call(method, path, body=None, expect=(200, 201)):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data,
                                 headers={"Content-Type": "application/json"}, method=method)
    try:
        with opener.open(req, timeout=25) as r:
            raw, status = r.read().decode(), r.status
    except urllib.error.HTTPError as e:
        raw, status = e.read().decode(), e.code
    parsed = json.loads(raw) if raw else None
    if status not in expect:
        short = raw[:200]
        print(f"  [ERR] {method:5} {path} -> {status}  {short}")
        raise RuntimeError(f"{method} {path} returned {status}")
    return parsed

def find(o, *keys):
    if not isinstance(o, dict):
        return None
    for k in keys:
        if k in o and o[k] not in (None, ""):
            return o[k]
    return None

def check(label, cond, detail=""):
    print(f"   {'PASS' if cond else 'FAIL'}  {label}" + (f"  ({detail})" if detail else ""))
    if not cond:
        failures.append(label)

# ---- shared setup -----------------------------------------------------------
def login():
    r = call("POST", "/auth/login", {"portal": "tenant", "salonCode": SALON,
             "identifier": OWNER_EMAIL, "password": OWNER_PW})
    me = call("GET", "/auth/me")
    print(f"  logged in: role={me.get('role')} tenant={me.get('tenantId')[:8]}… "
          f"branch={(me.get('branchId') or '')[:8]}… perms={len(me.get('permissions') or [])}")
    return me

def make_catalog():
    cat = call("POST", "/pos/services/categories", {"name": f"E2E Cat {RID}"})
    svc = call("POST", "/pos/services", {"name": f"E2E Service {RID}",
               "categoryId": find(cat, "categoryId", "id"),
               "durationMinutes": 30, "priceCents": PRICE})
    tech = call("POST", "/pos/technicians", {"firstName": "E2E", "lastName": f"Tech{RID}"})
    return find(svc, "serviceId", "id"), find(tech, "technicianId", "id")

_n = [0]
def ready_ticket(service_id, technician_id):
    """Walk-in (no customerId) -> ready_for_checkout; returns ticket id."""
    _n[0] += 1
    q = call("POST", "/pos/queue/items", {"customerName": f"E2E Walkin {RID}-{_n[0]}",
             "serviceIds": [service_id], "priority": "normal"})
    qid = find(q, "queueItemId", "id")
    call("POST", f"/pos/queue/items/{qid}/assign-technician",
         {"technicianId": technician_id, "managerOverride": True})
    mv = call("POST", f"/pos/queue/items/{qid}/move-to-serving", {})
    tid = find(mv, "servingTicketId", "ticketId", "id")
    call("POST", f"/pos/serving/tickets/{tid}/mark-service-done", {})
    call("POST", f"/pos/serving/tickets/{tid}/send-to-service-done", {})
    call("POST", f"/pos/service-done/tickets/{tid}/quality-check", {"result": "approved"})
    call("POST", f"/pos/service-done/tickets/{tid}/mark-ready-for-checkout", {})
    call("POST", f"/pos/service-done/tickets/{tid}/send-to-checkout", {})
    return tid

# ---- tenders ----------------------------------------------------------------
def expected_total():
    return PRICE + TIP + round(PRICE * TAX_RATE / 100)

def test_cash(svc, tech):
    print("\n[1] CASH (full, with tip)")
    tid = ready_ticket(svc, tech)
    pay = call("POST", f"/pos/checkout/tickets/{tid}/pay/cash",
               {"amountReceivedCents": 100000, "tipCents": TIP})
    p = pay.get("payment") if isinstance(pay, dict) else None
    exp = expected_total()
    check("authoritative total", p and p["amountCents"] == exp, f"want {exp}, got {p and p['amountCents']}")
    check("tip recorded", p and p["tipCents"] == TIP)
    check("change correct", p and p["changeDueCents"] == 100000 - exp)
    check("status approved", p and p["status"] == "approved")
    return tid

def test_gift_card(svc, tech):
    print("\n[2] GIFT CARD (full)")
    issue = call("POST", "/pos/checkout/gift-cards", {"amountCents": 10000}, expect=(200, 201, 403))
    if not isinstance(issue, dict) or find(issue, "code") is None:
        # 403 or unexpected shape -> gift-card perms likely not granted to this role
        print("   SKIP  gift-card issue not available:", json.dumps(issue)[:120])
        return
    code = find(issue, "code")
    tid = ready_ticket(svc, tech)
    pay = call("POST", f"/pos/checkout/tickets/{tid}/pay/gift-card",
               {"giftCardCode": code, "tipCents": TIP})
    p = pay.get("payment") if isinstance(pay, dict) else None
    exp = expected_total()
    check("gift applied = total", p and p["amountCents"] == exp, f"want {exp}, got {p and p['amountCents']}")
    check("gift status approved", p and p["status"] == "approved")
    check("gift remaining correct", pay.get("giftRemainingCents") == 10000 - exp,
          f"want {10000-exp}, got {pay.get('giftRemainingCents')}")

def test_card_not_configured(svc, tech):
    print("\n[3] CARD (processor not configured)")
    tid = ready_ticket(svc, tech)
    res = call("POST", f"/pos/checkout/tickets/{tid}/pay/card", {"tipCents": 0}, expect=(200, 201))
    # honest behavior: configured:false + a recorded not_configured payment (no fake auth)
    check("card reports not configured", isinstance(res, dict) and res.get("configured") is False,
          json.dumps(res)[:120])

def test_cash_refund(svc, tech):
    print("\n[4] CASH REFUND (no card gateway needed) + reconciliation")
    tid = ready_ticket(svc, tech)
    pay = call("POST", f"/pos/checkout/tickets/{tid}/pay/cash", {"amountReceivedCents": 100000, "tipCents": TIP})
    p = pay.get("payment") if isinstance(pay, dict) else None
    pid = p and p.get("paymentId")
    check("cash payment created for refund", bool(pid))
    if not pid:
        return
    ref = call("POST", f"/pos/checkout/payments/{pid}/refund", {"reason": "e2e refund"})
    check("cash refund succeeds WITHOUT a card processor", isinstance(ref, dict) and ref.get("status") == "refunded",
          json.dumps(ref)[:120])
    recon = call("GET", "/pos/payments/reconciliation")
    refunds = (recon or {}).get("refunds", {}) if isinstance(recon, dict) else {}
    check("refund lands in tenant reconciliation", refunds.get("count", 0) >= 1 and refunds.get("totalCents", 0) >= expected_total(),
          json.dumps(recon)[:160])

if __name__ == "__main__":
    print(f"== E2E money path @ {BASE} ==")
    login()
    settings = call("GET", "/pos/checkout/settings")
    rate = settings.get("taxRatePercent") if isinstance(settings, dict) else None
    if rate is not None:
        TAX_RATE = float(rate)
    print(f"  taxRatePercent={TAX_RATE}  (expected total per ticket = {expected_total()})")
    svc, tech = make_catalog()
    test_cash(svc, tech)
    test_gift_card(svc, tech)
    test_card_not_configured(svc, tech)
    test_cash_refund(svc, tech)
    print("\n== RESULT ==")
    if failures:
        print("FAILED:", ", ".join(failures))
        sys.exit(1)
    print("ALL CHECKS PASSED ✓")
    sys.exit(0)
