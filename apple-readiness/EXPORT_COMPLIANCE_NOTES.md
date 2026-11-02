# Export Compliance Notes

**What the code uses:** standard HTTPS/TLS for all network calls (the platform's networking). No custom or proprietary
cryptography is implemented in the apps; password hashing and session signing happen server-side with standard
algorithms and are not part of the shipped client binary.

**App Store Connect answers (recommended, based on the code — not legal advice):**
- "Does your app use encryption?" → Yes, but only standard encryption (HTTPS/TLS) provided by Apple's OS.
- This qualifies for the standard exemption. `ITSAppUsesNonExemptEncryption` is already set to **false** in the
  customer app's Info.plist, which pre-answers the prompt and avoids the yearly self-classification dialog.

**Action:** set `ITSAppUsesNonExemptEncryption=false` in each app's Info.plist when its iOS target is created (already
done for customer). If a future feature adds non-standard cryptography, revisit this.
