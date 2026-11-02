# Sign in with Apple — Audit

**Apple rule (Guideline 4.8):** apps that offer third-party/social login (Google, Facebook, etc.) must also offer
Sign in with Apple.

**Finding:** the AIPowerSalon apps authenticate with **AIPowerSalon email / phone / password only**, over a
server-side httpOnly session cookie. A code search for Google/Facebook/Apple/OAuth social-login SDKs found **none**.

**Conclusion: Sign in with Apple is NOT required.** No social login is offered, so Guideline 4.8 does not apply.
If a social login is added later, Sign in with Apple must be added at that time.
