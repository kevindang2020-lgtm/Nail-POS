variable "region" {
  type    = string
  default = "us-east-1"
}
variable "project" {
  type    = string
  default = "aipowersalon"
}
variable "api_domain" {
  type    = string
  default = "api.aipowersalon.com"
}
variable "db_username" {
  type    = string
  default = "aps"
}
variable "db_password" {
  type        = string
  sensitive   = true
  description = "RDS master password (store in tfvars/secret)"
}
variable "db_name" {
  type    = string
  default = "aps"
}
variable "instance_type" {
  type    = string
  default = "t3.small"
}
variable "db_instance" {
  type    = string
  default = "db.t3.small"
}
variable "pos_bucket" {
  type    = string
  default = "aipowersalon-pos-web"
}
variable "admin_bucket" {
  type    = string
  default = "aipowersalon-admin-web"
}

variable "evidence_bucket" {
  description = "Private S3 bucket for Safety Community evidence attachments. GuardDuty scans each object and tags it; the API refuses to release anything not tagged clean."
  type        = string
  default     = "aipowersalon-evidence"
}

variable "media_bucket" {
  description = "Private, versioned, encrypted S3 bucket for uploaded media (MEDIA_S3_BUCKET). Served through CloudFront OAC."
  type        = string
  default     = "aipowersalon-media"
}

variable "media_prefix" {
  description = "Object-key prefix inside the media bucket (MEDIA_S3_PREFIX); also the CloudFront origin path."
  type        = string
  default     = "uploads"
}
