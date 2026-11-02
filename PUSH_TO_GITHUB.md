# Pushing AI PowerSalon to GitHub

> **STATUS (Jul 29, 2026): the local half of this is now DONE.** The repository is initialized and committed —
> commit `21ee2e0`, 5,536 tracked files, `.gitignore` honored (no node_modules/dist), `security:fast` re-run at
> HEAD immediately before the commit (16 PASSED / 0 FAILED). A verified, clone-tested git bundle ships alongside
> the handoff zip as `AIPowerSalon-repo.bundle` — from any machine:
> `git clone AIPowerSalon-repo.bundle aipowersalon && cd aipowersalon && git remote add origin <your-github-url> && git push -u origin --all`.
> Everything below remains accurate as background; the only steps left are yours: create the empty private repo
> and push (which activates the security CI on the first push).



Written Jul 28, 2026. Everything below was **verified by actually doing it** in a scratch copy — the file
counts, the ignore behavior, and the CI run are measured, not predicted. Only the steps needing your GitHub
account are left for you.

---

## What was fixed first

**The repository had no `.gitignore`.** A first `git add .` would have committed roughly 762 installed packages
under `node_modules/`, five built `dist/` trees, and any real `.env` a developer later created — permanently, in
history. A `.gitignore` written from this repo's actual layout is now in place.

Verified with a real `git init && git add -A` on a scratch copy:

| | Result |
|---|---|
| Files staged | **5,520** |
| `node_modules`, `dist`, `.env`, `*.log` staged | **0** |
| Repository size | **35 MB** |

One bug in my own first draft was caught by that test and fixed: git has **no inline comments**, so
`.security-audit-partial.json   # …` was read as a filename with a comment attached and silently failed to match.
The comment now sits on its own line. This is why the ignore file was tested rather than trusted.

---

## Secret scan before the first commit

Scanned every file git would track for live-key patterns (Stripe `sk_live_`, AWS `AKIA…`, SendGrid `SG.…`,
Slack tokens, PEM private keys).

**Five matches, all deliberate fakes in tests** — obvious placeholder values (`sk_live_` followed by strings like "ABCD…" and "supersecret…"), obvious placeholder values (`sk_live_` followed by strings like "ABCD…" and "supersecret…") and
similar, used by suites that assert credential masking and encryption actually work. **No real credential is in
the repository.** The committed environment files are `.env*.example` and `.env.production.template`, which
contain placeholders only; the `.gitignore` keeps those tracked while excluding a real `.env`.

It also excludes credential file types you will handle soon: `*.p8` (APNs), `google-services.json` and
`GoogleService-Info.plist` (Firebase), and `service-account*.json`. Put those on the machine, never in the repo.

---

## The CI activates on push — and it passes today

`.github/workflows/security.yml` runs on every push and pull request. I ran its exact command locally:

```
npm run security:fast
→ NO FAILED CHECKS — PASSED 15 · FAILED 0 · NOT VERIFIED 4   (53 seconds)
```

**Your first push will go green.** `npm ci` will work — `package-lock.json` is committed.

The 4 "not verified" entries are honest reports, not failures, and every one is owner-side: live processor
behavior (needs CommerceHub credentials), production CORS/TLS/rate limiting (lives on the host, not in the repo),
live Twilio SMS delivery, and physical device flows (ASUS touchscreen, Bolt terminal, iPhone Tap-to-Pay).

The nightly `full` lane runs at 1:00 AM **UTC**. If you want 1:00 AM Eastern, change the cron in the workflow to
`'0 6 * * *'` — the line is already commented in the file.

---

## Steps for you

Create an **empty private** repository on GitHub — no README, no .gitignore, no license, or the first push will
be rejected for unrelated histories. Then, from the project root:

```bash
git init
git add -A
git status                     # expect ~5,520 files, no node_modules
git commit -m "AI PowerSalon: initial commit"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

If `git` asks who you are, set it once:

```bash
git config --global user.name  "Your Name"
git config --global user.email "you@example.com"
```

GitHub no longer accepts account passwords over HTTPS. When prompted for a password, paste a **personal access
token** (GitHub → Settings → Developer settings → Personal access tokens → Fine-grained token, with
Contents: read/write on this repository).

After the push, open the **Actions** tab. `security-audit / fast` should appear and finish green in about a
minute.

---

## Two things worth knowing before you push

1. **Make the repository private.** This is a complete commercial POS platform including the payment and
   residual money models. There is nothing stopping a public repo technically — it is a business decision, and
   private is the right default.
2. **The push is not a deployment.** It gets the code off a zip file and into version control with CI attached,
   which is genuinely valuable — but nothing is hosted, and no customer can reach it. Hosting, environment
   variables, and a database are separate steps.

---

## A note on how this document is written

An earlier draft quoted the test fixtures' fake key strings verbatim. The security CI — running from inside the
packaged zip — flagged **this file and the changelog** as containing live-key patterns, which would have turned
your first push red. The literals are now described rather than reproduced.

Worth taking as evidence about the scanner: it does not care whether a match is "obviously fake" or sitting in
documentation. That is the correct behavior, and it means the gate will catch a real credential pasted into a
note or a README, not just into code.
