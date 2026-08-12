terraform {
  # Production state contains secret values. Configure an encrypted,
  # access-controlled S3-compatible backend during `terraform init`; never
  # apply this stack with local state.
  backend "s3" {}
}
