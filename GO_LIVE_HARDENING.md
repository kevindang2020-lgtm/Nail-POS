# Go-Live Hardening — Addendum to DEPLOY_RUNBOOK.md

> **Note, Oct 10 2026 (BUILD_PLAN Phase 15 doc sweep):** the Terraform / RDS / `terraform.tfvars` steps in this checklist belong to the legacy AWS path —
> `deploy/terraform` is LEGACY and not applied (`deploy/terraform/README.md`). Railway is the host of record; the current
> go-live list is `docs/HOSTING_ACTIONS_FOR_KEVIN.md` and the deployment reference is `DEPLOYMENT.md`.

`DEPLOY_RUNBOOK.md` gets you deployed. This addendum covers the three production-hardening gaps it doesn't:
**secrets management**, **RDS durability**, and **observability**. Everything here is exact and checkable. Run it against
a **staging** stack first (`terraform workspace new staging`), then production.

Legend: **[infra]** = Terraform/AWS CLI · **[code]** = a repo change I can make on request · **[you]** = account/manual.

---

## 3. Secrets — move off tfvars/env-file into SSM Parameter Store (SecureString)

Today secrets reach the box via `/etc/aipowersalon.env` and the RDS password sits in `terraform.tfvars`. Put them in
SSM (encrypted, audited, rotatable) and have the instance fetch them at boot.

### 3.1 Generate strong secrets **[you]**
```bash
openssl rand -hex 32   # AUTH_SESSION_SECRET  (do NOT reuse the example)
openssl rand -hex 16   # MFA_ENC_KEY          (32 hex chars = 16 bytes, matches the current format)
```

### 3.2 Store secrets in SSM **[infra]**
```bash
P=/aipowersalon/prod
aws ssm put-parameter --name $P/AUTH_SESSION_SECRET --type SecureString --value "<hex32>"
aws ssm put-parameter --name $P/MFA_ENC_KEY        --type SecureString --value "<hex16>"
aws ssm put-parameter --name $P/DATABASE_URL       --type SecureString --value "postgresql://aps:<db_pw>@<rds_endpoint>:5432/aps"
aws ssm put-parameter --name $P/CARDPOINTE_MERCHID --type SecureString --value "<mid>"
aws ssm put-parameter --name $P/CARDPOINTE_USERNAME --type SecureString --value "<user>"
aws ssm put-parameter --name $P/CARDPOINTE_PASSWORD --type SecureString --value "<pass>"
# repeat for CARDPOINTE_SITE (or _BASE_URL), and any other live keys in .env.example
```

### 3.3 Let the instance read them — attach an IAM role **[infra, add to main.tf]**
```hcl
resource "aws_iam_role" "api" {
  name               = "${var.project}-api"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Principal = { Service = "ec2.amazonaws.com" }, Action = "sts:AssumeRole" }] })
}
resource "aws_iam_role_policy" "api_ssm" {
  role   = aws_iam_role.api.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Action = ["ssm:GetParametersByPath","ssm:GetParameter"],
    Resource = "arn:aws:ssm:${var.region}:*:parameter/aipowersalon/prod/*" }] })
}
resource "aws_iam_instance_profile" "api" { name = "${var.project}-api"; role = aws_iam_role.api.name }
# then on aws_instance.api add:   iam_instance_profile = aws_iam_instance_profile.api.name
```

### 3.4 Fetch into the env-file at boot — extend `user_data` in `aws_instance.api` **[infra]**
```bash
# inside the user_data heredoc, before the `docker run` line:
aws ssm get-parameters-by-path --path /aipowersalon/prod --with-decryption \
  --query "Parameters[].{n:Name,v:Value}" --output text \
  | sed 's#/aipowersalon/prod/##' | awk '{print $1"="$2}' > /etc/aipowersalon.env
chmod 600 /etc/aipowersalon.env
```
Then remove `db_password` as a plaintext value from `terraform.tfvars` once RDS reads it from a var you also keep in SSM.

- [ ] Strong `AUTH_SESSION_SECRET` / `MFA_ENC_KEY` generated and stored (not the examples)
- [ ] All live secrets in SSM SecureString; `/etc/aipowersalon.env` populated at boot; file is `chmod 600`
- [ ] No plaintext secrets remain in the repo or committed tfvars

---

## 4. RDS durability — flip the unsafe defaults **[infra, edit aws_db_instance.postgres]**

Current block has `skip_final_snapshot = true` and no deletion protection — one `terraform destroy` and the data is gone.

```hcl
  skip_final_snapshot       = false                       # was true
  final_snapshot_identifier = "${var.project}-db-final"   # add
  deletion_protection       = true                        # add
  backup_retention_period   = 7                            # keep (already set)
  # multi_az                = true                         # enable for HA before high-traffic launch (item 8)
```
Then **test a restore** (the only backup that counts is one you've restored):
```bash
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier aipowersalon-db \
  --target-db-instance-identifier aipowersalon-db-restoretest \
  --use-latest-restorable-time
# verify row counts, then delete the restore-test instance
```

- [ ] `skip_final_snapshot=false`, `deletion_protection=true`, `final_snapshot_identifier` set
- [ ] Point-in-time restore performed on a throwaway instance and verified
- [ ] `terraform plan` shows only the intended DB changes (no replace)

---

## 5. Observability — you currently have none

### 5.1 Ship logs to CloudWatch **[infra]**
Install the CloudWatch agent in `user_data` and stream the Docker logs:
```bash
apt-get install -y amazon-cloudwatch-agent
# configure /opt/aws/amazon-cloudwatch-agent to tail `docker logs` → log group /aipowersalon/api
# (docker json-file logs live under /var/lib/docker/containers/*/*-json.log)
```
Add `logs:CreateLogStream`, `logs:PutLogEvents` to the IAM policy from 3.3.

### 5.2 Structured JSON logging **[DONE]**
`pino` structured JSON logging is wired: `src/observability/pino-logger.ts` (a Nest `LoggerService` with
authorization/cookie/password/token/secret redaction) is swapped in via `app.useLogger(...)` in `main.ts` **only when
`NODE_ENV=production`** — dev/test output and the full test suite are unaffected. Level via `LOG_LEVEL` (default
`info`). Output is one JSON object per line (level, time ISO, service, context, trace, msg) — CloudWatch parses it
directly. Verified: API build clean, 103 auth/observability tests pass, `DI_GRAPH_OK`, prod-mode smoke test emits valid
JSON. Nothing else to do here except point the CloudWatch agent (5.1) at the container's stdout.

### 5.3 Alarms **[infra]**
```bash
# API host down (status check)
aws cloudwatch put-metric-alarm --alarm-name aps-api-statuscheck \
  --namespace AWS/EC2 --metric-name StatusCheckFailed --statistic Maximum \
  --period 60 --evaluation-periods 3 --threshold 1 --comparison-operator GreaterThanOrEqualToThreshold \
  --dimensions Name=InstanceId,Value=<id> --alarm-actions <sns-topic-arn>
# RDS CPU, FreeStorageSpace, DatabaseConnections — repeat with AWS/RDS metrics
```

### 5.4 Error tracking (recommended) **[you + code]**
Add a Sentry (or equivalent) DSN and init in `main.ts` — surfaces exceptions with stack traces + release tracking.

- [ ] API + DB logs in CloudWatch, retention set (e.g. 30d)
- [ ] Alarms on: API status check, RDS CPU / storage / connections — wired to SNS (email/SMS)
- [ ] Error tracking initialized (Sentry DSN in SSM)
- [ ] (optional) structured pino logging enabled

---

## Master go-live checklist (ties in DEPLOY_RUNBOOK.md §1–7)

- [ ] Staging stack up via `terraform apply` (workspace `staging`); smoke test (DEPLOY_RUNBOOK §7) passes
- [ ] Live CardPointe MID configured; **real** card sale + refund + void verified from the Elastic IP (allowlisted)
- [ ] PCI SAQ completed **[you — compliance, not code]**
- [ ] §3 secrets, §4 RDS, §5 observability all checked above
- [ ] Native/kiosk apps device-tested against the AWS backend
- [ ] Rollback rehearsed (redeploy previous image tag; DB restore path known)
- [ ] Then: promote to production, point salon traffic in
