#!/usr/bin/env python3
"""
bolt_uat_roundtrip.py — validate the CardPointe **Bolt / Integrated Terminal** contract against a REAL UAT site,
exactly the way cardpointe_uat_roundtrip.py validated the Gateway (which found three real divergences from the docs).

It confirms, with observed evidence, every assumption flagged in apps/api/src/payments/cardpointe-bolt.client.ts:
  1. base URL form          https://<site>.bolt.cardpointe.com
  2. API path version       /api/v2 vs /api/v3 (auto-detected via connect)
  3. Authorization format   raw key vs "Bearer <key>" vs HTTP Basic (auto-detected, reported)
  4. session-key header     exact casing as returned + the ';ip' suffix strip + (optional) lifetime
  5. authCard behavior      decimal-dollar amounts, respstat A/B/C, blocking tap timeout   [opt-in: --tap]

READ-ONLY BY DEFAULT: connect → ping → disconnect. Nothing money-moving, nothing shown on the terminal screen.
  --display          also send a harmless "UAT PROBE HELLO" to the terminal screen (visible on hardware)
  --lifetime N       after connect, wait N seconds then ping again to observe session-key lifetime
  --tap              run ONE $1.00 AUTH-ONLY (capture:"false") on the physical terminal — a customer/tester must tap.
                     Auth-only does not settle; void it in the CardPointe portal or let it expire. Prints retref.

Usage:
  BOLT_SITE=<site> BOLT_API_KEY=<key> BOLT_MERCHANT_ID=<mid> BOLT_HSN=<hsn> python3 bolt_uat_roundtrip.py [flags]
(stdlib only — no pip installs; BOLT_BASE_URL overrides the derived https://<site>.bolt.cardpointe.com)
"""
import json
import os
import sys
import time
import base64
import urllib.request
import urllib.error

FINDINGS: list[tuple[str, str, str]] = []  # (verdict, what, evidence)


def note(verdict: str, what: str, evidence: str = "") -> None:
    FINDINGS.append((verdict, what, evidence))
    mark = {"PASS": "✅", "DIVERGENT": "⚠️ ", "FAIL": "❌", "INFO": "ℹ️ "}.get(verdict, "•")
    print(f"{mark} {what}" + (f" — {evidence}" if evidence else ""))


def post(url: str, body: dict, headers: dict, timeout: float = 20.0):
    """POST JSON; returns (status, headers-dict, parsed-or-text body). Never raises on HTTP status."""
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method="POST",
                                 headers={"Content-Type": "application/json", **headers})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode(errors="replace")
            hdrs = {k: v for k, v in r.headers.items()}
            try:
                return r.status, hdrs, json.loads(raw) if raw.strip() else {}
            except json.JSONDecodeError:
                return r.status, hdrs, raw
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        hdrs = {k: v for k, v in e.headers.items()} if e.headers else {}
        try:
            return e.code, hdrs, json.loads(raw) if raw.strip() else {}
        except json.JSONDecodeError:
            return e.code, hdrs, raw
    except Exception as e:  # DNS, refused, TLS, timeout
        return 0, {}, f"<transport error: {e}>"


def find_session_key(headers: dict) -> tuple[str | None, str | None]:
    """Case-insensitive scan for the session key header; returns (exact-casing-name, value-with-;ip-stripped)."""
    for name, value in headers.items():
        if name.lower() == "x-cardconnect-sessionkey":
            return name, value.split(";", 1)[0].strip()
    return None, None


def main() -> int:
    site = os.environ.get("BOLT_SITE", "").strip()
    api_key = os.environ.get("BOLT_API_KEY", "").strip()
    mid = os.environ.get("BOLT_MERCHANT_ID", "").strip()
    hsn = os.environ.get("BOLT_HSN", "").strip()
    base_override = os.environ.get("BOLT_BASE_URL", "").strip().rstrip("/")
    if not api_key or not mid or not hsn or not (site or base_override):
        print(__doc__)
        print("Missing env: need BOLT_API_KEY, BOLT_MERCHANT_ID, BOLT_HSN and BOLT_SITE (or BOLT_BASE_URL).")
        return 2

    flags = set(sys.argv[1:])
    lifetime = 0
    if "--lifetime" in sys.argv:
        try:
            lifetime = int(sys.argv[sys.argv.index("--lifetime") + 1])
        except Exception:
            print("--lifetime needs a number of seconds")
            return 2

    base = base_override or f"https://{site}.bolt.cardpointe.com"
    print(f"\n— Bolt UAT roundtrip · base {base} · merchantId {mid} · hsn {hsn} —\n")

    # 1+2) base reachability + path version, via connect (the only call that needs no session)
    auth_styles = [("raw key", api_key),
                   ("Bearer", f"Bearer {api_key}"),
                   ("Basic", "Basic " + base64.b64encode(f"{api_key}:".encode()).decode())]
    connect_body = {"merchantId": mid, "hsn": hsn, "force": True}
    version = auth_used = None
    status, headers, body = 0, {}, ""
    for ver in ("v2", "v3"):
        for style, header_value in auth_styles:
            status, headers, body = post(f"{base}/api/{ver}/connect", connect_body,
                                         {"Authorization": header_value})
            if status == 0:
                note("FAIL", f"base URL unreachable ({base})", str(body))
                note("INFO", "if your site uses a different host form, re-run with BOLT_BASE_URL=<exact url>")
                return 1
            if status == 404:
                break  # wrong version path — no point cycling auth styles
            if status in (401, 403):
                continue  # try the next auth style on this version
            version, auth_used = ver, style
            break
        if version:
            break
    if not version:
        note("FAIL", "could not connect with /api/v2 or /api/v3 under any auth style",
             f"last status {status}, body {str(body)[:200]}")
        return 1
    note("PASS" if version == "v2" else "DIVERGENT",
         f"API path version: /api/{version}",
         "client assumes /api/v2" + ("" if version == "v2" else " — update BoltClient paths"))
    note("PASS" if auth_used == "raw key" else "DIVERGENT",
         f"Authorization format: {auth_used}",
         "client sends the raw key" + ("" if auth_used == "raw key" else " — update BoltClient auth header"))

    # 3) session key extraction (exact casing + ';ip' suffix)
    hdr_name, session = find_session_key(headers)
    if not session:
        note("FAIL", "connect returned no X-CardConnect-SessionKey header",
             f"status {status}, headers {list(headers.keys())[:8]}, body {str(body)[:200]}")
        return 1
    raw_value = headers.get(hdr_name, "")
    note("PASS", f"session key header present as '{hdr_name}'",
         f"value …{session[-6:]} (len {len(session)})" + ("; had ';ip' suffix as documented" if ";" in raw_value else "; NO ';ip' suffix observed"))
    auth_header = {"Authorization": dict(auth_styles)[auth_used], "X-CardConnect-SessionKey": session}

    # 4) ping with the session
    status, _, body = post(f"{base}/api/{version}/ping", {"merchantId": mid, "hsn": hsn}, auth_header)
    connected = isinstance(body, dict) and str(body.get("connected", "")).lower() in ("true", "1")
    note("PASS" if status == 200 and connected else "DIVERGENT",
         f"ping → {status}", f"body {str(body)[:160]}")

    if "--display" in flags:
        status, _, body = post(f"{base}/api/{version}/display",
                               {"merchantId": mid, "hsn": hsn, "text": "UAT PROBE HELLO"}, auth_header)
        note("PASS" if status == 200 else "DIVERGENT", f"display → {status}",
             "check the terminal screen for 'UAT PROBE HELLO'")

    if lifetime > 0:
        print(f"… waiting {lifetime}s to observe session-key lifetime …")
        time.sleep(lifetime)
        status, _, body = post(f"{base}/api/{version}/ping", {"merchantId": mid, "hsn": hsn}, auth_header)
        note("INFO", f"session key after {lifetime}s → ping {status}",
             "still valid" if status == 200 else f"expired/invalid (body {str(body)[:120]}) — size the client's reconnect accordingly")

    # 5) opt-in: one $1.00 AUTH-ONLY tap on the physical terminal
    if "--tap" in flags:
        print("\n👉 TAP REQUESTED: present a TEST card on the terminal now (auth-only $1.00, capture:\"false\").")
        order_id = f"boltprobe-{int(time.time())}"
        status, _, body = post(f"{base}/api/{version}/authCard",
                               {"merchantId": mid, "hsn": hsn, "amount": "1.00", "capture": "false",
                                "includeSignature": "true", "includeAmountDisplay": "true",
                                "beep": "true", "orderId": order_id},
                               auth_header, timeout=150.0)
        if isinstance(body, dict):
            respstat = str(body.get("respstat", ""))
            note("PASS" if respstat in ("A", "B", "C") else "DIVERGENT",
                 f"authCard → {status}, respstat {respstat or '<missing>'}",
                 f"retref {body.get('retref')}, authcode {body.get('authcode')}, amount {body.get('amount')!r} "
                 f"(decimal-string expected), resptext {body.get('resptext')}")
            amt = body.get("amount")
            note("PASS" if isinstance(amt, str) and "." in amt else "DIVERGENT",
                 "amount field is a decimal-dollar STRING", f"observed {amt!r}")
            # Kevin, Oct 6 2026: the cardholder signs on the Clover terminal — does authCard bring the signature back,
            # and in which encoding (terminalSignatureDataUrl accepts gzip-compressed or plain bitmap / PNG / JPEG)?
            sig = body.get("signature")
            if isinstance(sig, str) and sig:
                import base64, gzip
                try:
                    raw = base64.b64decode(sig)
                    if raw[:2] == b"\x1f\x8b": raw = gzip.decompress(raw)
                    kind = "bitmap" if raw[:2] == b"BM" else "PNG" if raw[:4] == b"\x89PNG" else "JPEG" if raw[:3] == b"\xff\xd8\xff" else f"unknown ({raw[:4]!r})"
                except Exception as e:  # noqa: BLE001
                    kind = f"undecodable ({e})"
                note("PASS" if not kind.startswith(("unknown", "undecodable")) else "DIVERGENT", "authCard returned the signature", f"{len(sig)} base64 chars → {kind}")
            else:
                note("DIVERGENT", "authCard returned NO signature", "the terminal did not ask, or the field is named differently — check the response keys: " + ", ".join(sorted(body.keys())))
            if body.get("retref"):
                note("INFO", "auth-only does not settle — void retref in the CardPointe portal or let it expire",
                     f"retref {body.get('retref')}, orderId {order_id}")
        else:
            note("FAIL", f"authCard → {status}", str(body)[:200])

    # 6) disconnect
    status, _, body = post(f"{base}/api/{version}/disconnect", {"merchantId": mid, "hsn": hsn}, auth_header)
    note("PASS" if status == 200 else "DIVERGENT", f"disconnect → {status}", str(body)[:120])

    print("\n──────── summary ────────")
    worst = "PASS"
    for verdict, what, _ in FINDINGS:
        if verdict == "FAIL":
            worst = "FAIL"
        elif verdict == "DIVERGENT" and worst != "FAIL":
            worst = "DIVERGENT"
        print(f"  [{verdict}] {what}")
    if worst == "PASS":
        print("\nAll client assumptions held on this UAT site. The hardware-confirm flags in cardpointe-bolt.client.ts can be marked validated.")
    elif worst == "DIVERGENT":
        print("\nDivergences found — update cardpointe-bolt.client.ts to the observed contract (same as the gateway probe outcome).")
    else:
        print("\nHard failures — fix connectivity/credentials and re-run before touching the client.")
    return 0 if worst != "FAIL" else 1


if __name__ == "__main__":
    sys.exit(main())
