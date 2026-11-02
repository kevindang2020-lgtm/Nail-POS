# AIPowerSalon — AWS infrastructure (Terraform). *** LEGACY — NOT APPLIED. *** Railway is the host of record
# (README.md in this directory). Kept, and corrected (BUILD_PLAN Phase 11, audit E6), so that IF it is ever applied it
# is safe: private buckets reachable only through CloudFront OAC, a private + versioned + encrypted media bucket, RDS
# Multi-AZ with deletion protection and a final snapshot, no SSH (SSM Session Manager instead), IMDSv2, encrypted disk.
# Provisions: VPC, EC2 (API) + Elastic IP (the dedicated IP Fiserv allowlists), RDS Postgres 16, security groups,
# S3 + CloudFront for pos-web/admin-web, the private media and evidence buckets.
# NOTE: review with `terraform plan` against your account before apply. Set db_password in a terraform.tfvars
# (never commit secrets).

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region
}

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical
  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }
  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# ---------- network ----------
resource "aws_vpc" "main" {
  cidr_block           = "10.20.0.0/16"
  enable_dns_hostnames = true
  tags                 = { Name = "${var.project}-vpc" }
}

resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${var.project}-igw" }
}

resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true
  tags                    = { Name = "${var.project}-public-${count.index}" }
}

resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index + 10)
  availability_zone = data.aws_availability_zones.available.names[count.index]
  tags              = { Name = "${var.project}-private-${count.index}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.igw.id
  }
  tags = { Name = "${var.project}-public-rt" }
}

resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# ---------- security groups ----------
resource "aws_security_group" "api" {
  name        = "${var.project}-api-sg"
  vpc_id      = aws_vpc.main.id
  description = "API host"
  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  # No SSH ingress (Phase 11, E6): shell access is AWS Systems Manager Session Manager through the instance role —
  # no open port 22, no key pair to leak.
  # The API calls payment / SMS / AI providers on the public internet over HTTPS (and Postgres inside the VPC); no
  # NAT/egress proxy exists in this legacy design, so egress is limited by PORT, not by destination.
  #trivy:ignore:AVD-AWS-0104
  egress {
    description = "HTTPS to providers"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    description = "Postgres inside the VPC"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [aws_vpc.main.cidr_block]
  }
  #trivy:ignore:AVD-AWS-0104
  egress {
    description = "HTTP for OS package mirrors (apt) only"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "${var.project}-api-sg" }
}

resource "aws_security_group" "rds" {
  name        = "${var.project}-rds-sg"
  vpc_id      = aws_vpc.main.id
  description = "Postgres — only from the API host"
  ingress {
    description     = "Postgres from API"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.api.id]
  }
  # No egress: the database initiates no connections (Terraform removes AWS's default allow-all rule).
  tags = { Name = "${var.project}-rds-sg" }
}

# ---------- RDS Postgres 16 ----------
resource "aws_db_subnet_group" "main" {
  name       = "${var.project}-db-subnets"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_instance" "postgres" {
  identifier                          = "${var.project}-db"
  engine                              = "postgres"
  engine_version                      = "16"
  instance_class                      = var.db_instance
  allocated_storage                   = 20
  max_allocated_storage               = 100
  storage_encrypted                   = true
  db_name                             = var.db_name
  username                            = var.db_username
  password                            = var.db_password
  db_subnet_group_name                = aws_db_subnet_group.main.name
  vpc_security_group_ids              = [aws_security_group.rds.id]
  multi_az                            = true # E6: survives an AZ loss
  publicly_accessible                 = false
  deletion_protection                 = true  # E6: a `terraform destroy` / console click cannot drop the database
  skip_final_snapshot                 = false # E6: a final snapshot is always taken
  final_snapshot_identifier           = "${var.project}-db-final"
  copy_tags_to_snapshot               = true
  backup_retention_period             = 14
  auto_minor_version_upgrade          = true
  iam_database_authentication_enabled = true
  performance_insights_enabled        = true
  tags                                = { Name = "${var.project}-db" }
}

# ---------- EC2 API host + Elastic IP (the dedicated IP CardPointe allowlists) ----------
resource "aws_instance" "api" {
  ami           = data.aws_ami.ubuntu.id
  instance_type = var.instance_type
  # The instance had no IAM role at all, so it could not reach S3. Scoped to the evidence bucket only.
  iam_instance_profile   = aws_iam_instance_profile.api.name
  subnet_id              = aws_subnet.public[0].id
  vpc_security_group_ids = [aws_security_group.api.id]
  # IMDSv2 only (blocks SSRF credential theft) and an encrypted root volume (Phase 11, E6).
  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"
  }
  root_block_device {
    encrypted = true
  }
  user_data = <<-USERDATA
    #!/bin/bash
    set -e
    apt-get update && apt-get install -y docker.io nginx certbot python3-certbot-nginx
    systemctl enable --now docker
    # Pull + run the API image (push it to ECR first; see DEPLOY_RUNBOOK.md). DATABASE_URL points at RDS.
    # docker run -d --restart always -p 127.0.0.1:3000:3000 --env-file /etc/aipowersalon.env <ECR_IMAGE>
    # nginx terminates TLS (certbot) and proxies 443 -> 127.0.0.1:3000.
  USERDATA
  tags      = { Name = "${var.project}-api" }
}

resource "aws_eip" "api" {
  domain = "vpc"
  tags   = { Name = "${var.project}-eip" }
}

resource "aws_eip_association" "api" {
  instance_id   = aws_instance.api.id
  allocation_id = aws_eip.api.id
}

# ---------- static hosting: pos-web + admin-web (S3 + CloudFront) ----------
resource "aws_s3_bucket" "pos" {
  bucket = var.pos_bucket
}

resource "aws_s3_bucket" "admin" {
  bucket = var.admin_bucket
}

# E6: the static buckets are private; only their own CloudFront distribution may read them (OAC). Without this policy
# every request through CloudFront was a 403.
resource "aws_s3_bucket_public_access_block" "static" {
  for_each                = local.buckets
  bucket                  = each.value.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "static" {
  for_each = local.buckets
  bucket   = each.value.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_policy" "static_oac" {
  for_each = local.buckets
  bucket   = each.value.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "CloudFrontOACRead"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${each.value.arn}/*"
      Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.site[each.key].arn } }
    }]
  })
  depends_on = [aws_s3_bucket_public_access_block.static]
}

resource "aws_cloudfront_origin_access_control" "oac" {
  name                              = "${var.project}-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

locals {
  buckets = { pos = aws_s3_bucket.pos, admin = aws_s3_bucket.admin }
}

resource "aws_cloudfront_distribution" "site" {
  for_each            = local.buckets
  enabled             = true
  default_root_object = "index.html"
  origin {
    domain_name              = each.value.bucket_regional_domain_name
    origin_id                = each.key
    origin_access_control_id = aws_cloudfront_origin_access_control.oac.id
  }
  default_cache_behavior {
    target_origin_id       = each.key
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }
  }
  # SPA fallback: serve index.html for client-side routes
  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }
  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }
  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }
  viewer_certificate {
    cloudfront_default_certificate = true # swap to an ACM cert for pos./admin. subdomains
  }
  tags = { Name = "${var.project}-${each.key}" }
}

# ---------- Safety Community evidence: private S3 + malware scanning ----------
#
# Evidence attachments (photos, documents supporting a safety report) are private, and the API will NOT release
# one to a moderator until it has scanned CLEAN. Both halves are wired in the application; this is the
# infrastructure they need, so it is `terraform apply` rather than a sequence of console clicks.
#
# Three things matter here and each is deliberate:
#
#   1. The bucket is PRIVATE. Evidence in a safety report is exactly the kind of thing that must never be
#      world-readable — public access is blocked at the bucket level, in addition to no public policy.
#   2. GuardDuty Malware Protection scans every uploaded object and TAGS it with the result. The API reads that
#      tag. Until an object is tagged clean it stays locked — a scanner outage never unlocks evidence.
#   3. The API instance gets read/write via an instance ROLE, not access keys. It previously had no instance
#      profile at all, so it could not reach S3 even if the bucket existed.

resource "aws_s3_bucket" "evidence" {
  bucket = var.evidence_bucket
}

# Evidence is private. Full stop.
resource "aws_s3_bucket_public_access_block" "evidence" {
  bucket                  = aws_s3_bucket.evidence.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "evidence" {
  bucket = aws_s3_bucket.evidence.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Someone deleting evidence mid-investigation should not be able to destroy it.
resource "aws_s3_bucket_versioning" "evidence" {
  bucket = aws_s3_bucket.evidence.id
  versioning_configuration {
    status = "Enabled"
  }
}

# ---------- GuardDuty Malware Protection for S3 ----------
#
# Scans each uploaded object and writes a `GuardDutyMalwareScanStatus` tag. The API reads that tag and refuses to
# release anything not tagged clean. Enabling this needs no application change.

resource "aws_guardduty_detector" "main" {
  enable = true
}

resource "aws_iam_role" "guardduty_malware" {
  name = "${var.project}-guardduty-malware-s3"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "malware-protection-plan.guardduty.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "guardduty_malware" {
  role = aws_iam_role.guardduty_malware.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:GetObjectVersion", "s3:ListBucket", "s3:GetBucketLocation"]
        Resource = [aws_s3_bucket.evidence.arn, "${aws_s3_bucket.evidence.arn}/*"]
      },
      {
        # This is how the scan result reaches the application: the object is TAGGED.
        Effect   = "Allow"
        Action   = ["s3:PutObjectTagging", "s3:GetObjectTagging", "s3:PutObjectVersionTagging"]
        Resource = "${aws_s3_bucket.evidence.arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["kms:GenerateDataKey", "kms:Decrypt"]
        Resource = "*"
      },
    ]
  })
}

resource "aws_guardduty_malware_protection_plan" "evidence" {
  role = aws_iam_role.guardduty_malware.arn

  protected_resource {
    s3_bucket {
      bucket_name = aws_s3_bucket.evidence.id
    }
  }

  actions {
    tagging {
      status = "ENABLED" # ← the tag the API reads. Without this, nothing is ever released.
    }
  }

  depends_on = [aws_guardduty_detector.main]
}

# ---------- the API instance's own S3 access ----------
#
# The instance had NO IAM role, so it could not reach S3 at all. Scoped to the evidence bucket only.

resource "aws_iam_role" "api" {
  name = "${var.project}-api"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "api_evidence" {
  role = aws_iam_role.api.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        # GetObjectTagging is what lets the API read the scan result.
        Action   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:GetObjectTagging"]
        Resource = "${aws_s3_bucket.evidence.arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.evidence.arn
      },
    ]
  })
}

resource "aws_iam_instance_profile" "api" {
  name = "${var.project}-api"
  role = aws_iam_role.api.name
}

# ---------- media bucket (Phase 11, E6 / Constitution 4 §56–62, §169) ----------
#
# The API's MEDIA_STORE=s3 target. Private (served through CloudFront OAC — set MEDIA_CDN_BASE_URL to the distribution),
# versioned (an overwrite or delete is recoverable), encrypted, and with the lifecycle in deploy/storage-lifecycle.json.
# Object keys: <MEDIA_S3_PREFIX>/<env>/<tenantId>/… (packages/media/src/media-storage.ts).

resource "aws_s3_bucket" "media" {
  bucket = var.media_bucket
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket                  = aws_s3_bucket.media.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "media" {
  bucket = aws_s3_bucket.media.id
  versioning_configuration {
    status = "Enabled"
  }
}

# Mirrors deploy/storage-lifecycle.json (the file Kevin applies with the AWS CLI when the bucket is NOT Terraform-managed).
resource "aws_s3_bucket_lifecycle_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    id     = "abort-incomplete-multipart-uploads"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
    expiration {
      expired_object_delete_marker = true
    }
  }
  rule {
    id     = "expire-temporary-exports"
    status = "Enabled"
    filter {
      prefix = "tmp/"
    }
    expiration {
      days = 7
    }
  }
  depends_on = [aws_s3_bucket_versioning.media]
}

resource "aws_cloudfront_distribution" "media" {
  enabled = true
  origin {
    domain_name              = aws_s3_bucket.media.bucket_regional_domain_name
    origin_id                = "media"
    origin_access_control_id = aws_cloudfront_origin_access_control.oac.id
    origin_path              = var.media_prefix == "" ? "" : "/${var.media_prefix}"
  }
  default_cache_behavior {
    target_origin_id       = "media"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }
  }
  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }
  viewer_certificate {
    cloudfront_default_certificate = true
  }
  tags = { Name = "${var.project}-media" }
}

resource "aws_s3_bucket_policy" "media_oac" {
  bucket = aws_s3_bucket.media.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "CloudFrontOACRead"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.media.arn}/*"
      Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.media.arn } }
    }]
  })
  depends_on = [aws_s3_bucket_public_access_block.media]
}

resource "aws_iam_role_policy" "api_media" {
  role = aws_iam_role.api.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:AbortMultipartUpload"]
        Resource = "${aws_s3_bucket.media.arn}/*"
      },
      {
        # ListBucketMultipartUploads: the media.lifecycle job's abandoned-upload sweep
        Effect   = "Allow"
        Action   = ["s3:ListBucket", "s3:ListBucketMultipartUploads"]
        Resource = aws_s3_bucket.media.arn
      },
    ]
  })
}

# Session Manager instead of SSH (E6).
resource "aws_iam_role_policy_attachment" "api_ssm" {
  role       = aws_iam_role.api.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}
