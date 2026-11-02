# deploy/terraform — LEGACY, NOT APPLIED

**Railway is the host of record** for AIPowerSalon (API web service + worker from the root `Dockerfile`, configured by
`railway.json` / `railway.worker.json`; Postgres and Redis are Railway services). Nothing in this directory is applied
by CI or by any runbook, and it does not describe production.

It is kept because it documents a possible AWS layout (EC2 + Elastic IP for the Fiserv/CardPointe IP allowlist, RDS,
S3 + CloudFront, the GuardDuty-scanned evidence bucket). BUILD_PLAN Phase 11 corrected it (audit finding E6) so that
**if** it is ever applied it is not unsafe:

| E6 finding | Now |
|---|---|
| pos/admin buckets had no bucket policy for the CloudFront OAC (every request 403) | `aws_s3_bucket_policy.static_oac` (OAC read only, scoped to the distribution ARN) + public-access block + encryption |
| RDS `skip_final_snapshot = true`, no deletion protection, `multi_az = false` | `skip_final_snapshot = false` + `final_snapshot_identifier`, `deletion_protection = true`, `multi_az = true`, 14-day backups |
| EC2 public with SSH open | no port 22; AWS Systems Manager Session Manager via the instance role; IMDSv2 required; encrypted root volume |
| no media bucket | `aws_s3_bucket.media`: private, versioned, SSE, lifecycle (= `deploy/storage-lifecycle.json`), CloudFront OAC, API role scoped to it |
| egress allow-all | API: 443 + 80 (package mirrors) + 5432 inside the VPC; RDS: no egress |

`terraform fmt -check` and `terraform validate` pass (Terraform 1.9.8, `init -backend=false`). The IaC scan in
`.github/workflows/build-image.yml` (Trivy config) fails on CRITICAL; the remaining HIGH findings are accepted for a
file that is not applied: no WAF on the CloudFront distributions, SSE-S3 instead of a customer-managed KMS key, public
subnets that auto-assign public IPs (the EC2 host IS the public endpoint in this design).

**Before applying it, decide the host.** Applying this alongside Railway creates a second production. If AWS ever
becomes the host: put an ALB + WAF in front, move the EC2 host to a private subnet behind it, use a customer-managed
KMS key, and replace the user-data docker run with the image published by the `publish` job (GHCR, tag = git sha).

## Media bucket lifecycle on a bucket that is NOT managed here

`deploy/storage-lifecycle.json` is the same lifecycle as `aws_s3_bucket_lifecycle_configuration.media`, for a bucket
created by hand (the current `MEDIA_S3_BUCKET`):

```sh
aws s3api put-bucket-lifecycle-configuration --bucket <MEDIA_S3_BUCKET> \
  --lifecycle-configuration file://deploy/storage-lifecycle.json
aws s3api get-bucket-lifecycle-configuration --bucket <MEDIA_S3_BUCKET>   # verify: 3 rules
```

It aborts multipart uploads left incomplete for 1 day, expires non-current object versions after 30 days (only if the
bucket is versioned), and expires anything under `tmp/` after 7 days. Deleting the objects of deleted media rows is
the application's `media.lifecycle` job (`apps/api/src/media/media-lifecycle.ts`), driven by `classes.media` in
`apps/api/db/retention-policy.json`.
