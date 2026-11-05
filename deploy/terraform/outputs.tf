output "api_elastic_ip" {
  value       = aws_eip.api.public_ip
  description = "Point api.aipowersalon.com (A record) here; allowlist this IP with Fiserv/CardPointe."
}
output "rds_endpoint" {
  value       = aws_db_instance.postgres.address
  description = "Use in DATABASE_URL."
}
output "pos_cloudfront_url" {
  value = aws_cloudfront_distribution.site["pos"].domain_name
}
output "admin_cloudfront_url" {
  value = aws_cloudfront_distribution.site["admin"].domain_name
}

output "evidence_bucket" {
  description = "Set this as EVIDENCE_S3_BUCKET on the API."
  value       = aws_s3_bucket.evidence.id
}

output "media_bucket" {
  description = "Set MEDIA_STORE=s3, MEDIA_S3_BUCKET=<this>, MEDIA_S3_REGION=<region>, MEDIA_S3_PREFIX=<media_prefix> on the API."
  value       = aws_s3_bucket.media.id
}

output "media_cdn_url" {
  description = "Set MEDIA_CDN_BASE_URL=https://<this> on the API."
  value       = aws_cloudfront_distribution.media.domain_name
}
