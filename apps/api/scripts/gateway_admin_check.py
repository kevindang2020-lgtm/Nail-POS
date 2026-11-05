#!/usr/bin/env python3
"""
gateway_admin_check.py — HTTP verification of the per-tenant payment-gateway routes.
Proves: Super Admin can provision a tenant's gateway (secrets encrypted, returned masked); a POS user reads ONLY its
own tenant's masked gateway (server-derived tenantId); new tenants are provisioned 'pending'; and a POS user is
forbidden from the Super Admin gateway route. No card is ever charged (no Fiserv round-trip).
"""
import json, os, sys, time, urllib.request, urllib.error, http.cookiejar

BASE = os.environ.get("E2E_BASE_URL", "http://127.0.0.1:3001")
SALON = os.environ.get("E2E_SALON_CODE", "PILOT01")
OWNER_EMAIL = os.environ.get("E2E_OWNER_EMAIL", "owner@e2e.local")
OWNER_PW = os.environ.get("E2E_OWNER_PASSWORD", "E2e!Owner1")
SA_EMAIL = os.environ.get("E2E_SUPER_ADMIN_EMAIL", "admin@e2e.local")
SA_PW = os.environ.get("E2E_SUPER_ADMIN_PASSWORD", "E2e!SuperAdmin1")
RID = str(int(time.time()))[-6:]
fails = []

def session():
    cj = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

def call(opener, method, path, body=None, expect=(200, 201)):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, headers={"Content-Type": "application/json"}, method=method)
    try:
        with opener.open(req, timeout=25) as r:
            raw, status = r.read().decode(), r.status
    except urllib.error.HTTPError as e:
        raw, status = e.read().decode(), e.code
    parsed = json.loads(raw) if raw else None
    if status not in expect:
        raise RuntimeError(f"{method} {path} -> {status}  {raw[:160]}")
    return status, parsed

def check(label, cond, detail=""):
    print(f"   {'PASS' if cond else 'FAIL'}  {label}" + (f"  ({detail})" if detail else ""))
    if not cond: fails.append(label)

def find_id_by_code(state, code):
    """tenants/state rows use {id, code, ...}; search recursively for code match."""
    found = []
    def walk(o):
        if isinstance(o, dict):
            if str(o.get("code", "")).upper() == code.upper() and "id" in o:
                found.append(o["id"])
            for v in o.values(): walk(v)
        elif isinstance(o, list):
            for v in o: walk(v)
    walk(state)
    return found[0] if found else None

if __name__ == "__main__":
    print(f"== gateway admin + POS isolation @ {BASE} ==")

    # --- Super Admin session (single-call login: any 6-digit MFA passes for the bootstrap admin) ---
    sa = session()
    call(sa, "POST", "/auth/login", {"portal": "super-admin", "identifier": SA_EMAIL, "password": SA_PW, "mfaCode": "123456"})
    _, me = call(sa, "GET", "/auth/me")
    check("super admin authenticated", me and me.get("role") == "SUPER_ADMIN", me and me.get("role"))

    _, state = call(sa, "GET", "/super-admin/tenants/state")
    pilot_id = find_id_by_code(state, SALON)
    check("found PILOT tenant id", bool(pilot_id))

    # provision PILOT's own gateway (active) — distinct MID
    PILOT_MID = f"MIDPILOT{RID}9911"; PILOT_PW = "pilotPass!secret"
    _, setres = call(sa, "POST", f"/super-admin/tenants/{pilot_id}/payment-gateway",
                     {"processorType": "fiserv", "environment": "sandbox", "baseUrl": "https://pilot.cardconnect.com",
                      "merchantId": PILOT_MID, "apiUsername": "pilotUser", "apiPassword": PILOT_PW,
                      "webhookSecret": "whP", "status": "active"})
    check("set gateway returns masked + active", setres and setres.get("status") == "active" and setres.get("merchantIdMasked", "").endswith(PILOT_MID[-4:]))
    check("set gateway never echoes a secret", PILOT_PW not in json.dumps(setres) and "pilotUser" not in json.dumps(setres))

    _, getres = call(sa, "GET", f"/super-admin/tenants/{pilot_id}/payment-gateway")
    check("get gateway masked (no secret)", getres and getres.get("merchantIdMasked", "").endswith("9911") and PILOT_MID not in json.dumps(getres))

    _, tc = call(sa, "POST", f"/super-admin/tenants/{pilot_id}/payment-gateway/test-connection")
    check("test-connection honest (ok, not faked-live)", tc and tc.get("ok") is True and tc.get("tested") is False, json.dumps(tc)[:90])

    # --- create a SECOND tenant; it must be provisioned 'pending'; give it a DIFFERENT MID ---
    codeB = f"ISOB{RID}"
    _, created = call(sa, "POST", "/super-admin/tenants",
                      {"displayName": f"ISO B {RID}", "code": codeB, "plan": "starter",
                       "ownerName": "B Owner", "ownerEmail": f"bowner{RID}@example.com",
                       "owner": {"firstName": "B", "lastName": "Owner", "email": f"bowner{RID}@example.com"}},
                      expect=(200, 201))
    _, state2 = call(sa, "GET", "/super-admin/tenants/state")
    b_id = (created or {}).get("id") or find_id_by_code(state2, codeB)
    check("second tenant created", bool(b_id), json.dumps(created)[:90] if not b_id else b_id)
    if b_id:
        _, bgw = call(sa, "GET", f"/super-admin/tenants/{b_id}/payment-gateway")
        check("new tenant provisioned 'pending' / setup required", bgw and bgw.get("setupRequired") is True and bgw.get("status") in ("pending", "not_configured"), json.dumps(bgw)[:90])
        call(sa, "POST", f"/super-admin/tenants/{b_id}/payment-gateway",
             {"processorType": "fiserv", "environment": "production", "baseUrl": "https://b.cardconnect.com",
              "merchantId": f"MIDISOB{RID}2222", "apiUsername": "bUser", "apiPassword": "bPass!", "status": "active"})

    # --- POS owner session: reads ONLY its own gateway ---
    ow = session()
    call(ow, "POST", "/auth/login", {"portal": "tenant", "salonCode": SALON, "identifier": OWNER_EMAIL, "password": OWNER_PW})
    _, ome = call(ow, "GET", "/auth/me")
    check("owner authenticated for PILOT", ome and ome.get("role") == "OWNER")

    _, status = call(ow, "GET", "/pos/payment-gateway/status")
    sj = json.dumps(status)
    check("POS sees its OWN gateway (PILOT MID …9911)", status and status.get("merchantIdMasked", "").endswith("9911") and status.get("status") == "active")
    check("POS does NOT see tenant B's MID (…2222)", "2222" not in status.get("merchantIdMasked", ""))
    check("POS status carries no raw secret", PILOT_PW not in sj and "pilotUser" not in sj)

    # --- a POS user is forbidden from the Super Admin gateway route ---
    st, _ = call(ow, "GET", f"/super-admin/tenants/{pilot_id}/payment-gateway", expect=(403, 401, 200))
    check("POS user forbidden from Super Admin gateway route", st in (401, 403), f"status {st}")

    print("\n== RESULT ==")
    if fails:
        print("FAILED:", ", ".join(fails)); sys.exit(1)
    print("ALL GATEWAY ADMIN + ISOLATION CHECKS PASSED ✓"); sys.exit(0)
