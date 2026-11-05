# Apple Review Compliance Checklist

Status legend: ✅ done & verified · 🟡 partial / needs follow-up · 🔲 blocked on native shell or infra.

| Requirement | Customer | Owner | Tech | Check-In | Notes |
|---|---|---|---|---|---|
| Native iOS target exists & builds | ✅ Capacitor (verified) | ✅ Capacitor (verified) | ✅ Capacitor (verified) | 🔲 | 3 of 4 scaffolded; check-in is ABM-bound; upload is Mac-only |
| Privacy Policy in-app | ✅ | ✅ | ✅ | 🔲 | Add to kiosk Admin/Info screen |
| Terms of Service in-app | ✅ | ✅ | ✅ | 🔲 | |
| Account deletion / deactivation request | ✅ delete | ✅ deactivate | ✅ deactivate | n/a | Backend endpoints live + verified |
| Contact Support in-app | ✅ Help screen | 🟡 email in Privacy/Terms | 🟡 "contact front desk" | 🔲 | Owner/Tech could get a dedicated row |
| Location: explained + manual fallback | ✅ 'ask' pre-prompt + manual city/ZIP on denial | n/a | n/a (no location) | n/a | Confirmed present; tech uses no location |
| Push notifications optional | 🟡 SMS/email toggles exist | 🔲 | 🟡 | n/a | APNs/FCM not wired yet (infra) |
| Marketing opt-in separate from transactional | ✅ separate toggle + own `marketing_opt_in` field | 🟡 | 🟡 | n/a | Customer done; owner/tech have no marketing messaging |
| No Apple IAP for salon services | ✅ external/gateway payments | n/a | n/a | n/a | Correct per Apple physical-services rule |
| No raw card / CVV storage | ✅ | n/a | ✅ cash conf only | n/a | Tokenized/sandbox |
| Apple Pay hidden unless configured | ✅ not shown (not integrated) | n/a | n/a | n/a | No fake Apple Pay |
| Sign in with Apple | ✅ not required | ✅ | ✅ | ✅ | Email/phone/password only |
| Info.plist permission strings correct | ✅ (1 string) | ✅ (none needed) | ✅ (none needed) | 🔲 | owner/tech request no permissions |
| App icon + launch screen | 🔲 placeholder | 🔲 | 🔲 | 🔲 | Mac asset-catalog step |
| No secrets in frontend | ✅ | ✅ | ✅ | ✅ | Verified |
| Tenant isolation (no cross-tenant data) | ✅ | ✅ | ✅ | ✅ | Server-derived scope |
| No broken buttons / placeholder content | ✅ | ✅ | ✅ | 🟡 | Web apps are functional |

**Bottom line:** the app-content compliance (privacy/terms/deletion/payments/security) is largely **done and verified**
in the three web apps; the remaining blockers are the **Mac-only steps** (app icons, signing, archive, upload) for the 3 scaffolded apps,
plus the check-in display shell. The location pre-prompt and the marketing/transactional split are now done.
