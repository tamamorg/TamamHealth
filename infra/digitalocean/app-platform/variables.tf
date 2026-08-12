variable "app_name" {
  type    = string
  default = "tamamhealth"
}

variable "app_region" {
  description = "App Platform region; fra maps to the fra1 VPC."
  type        = string
  default     = "fra"
}

variable "vpc_id" {
  type    = string
  default = "6a073896-d2e6-42db-9c7c-a18afaa4caca"
}

variable "github_repo" {
  type    = string
  default = "tamamorg/TamamHealth"
}

variable "github_branch" {
  type    = string
  default = "main"
}

variable "domain" {
  type    = string
  default = "staging.tamamhealth.org"
}

# tamamhealth.org is hosted on GoDaddy, not DigitalOcean DNS, so the CNAME for
# var.domain has to be created by hand. Until it exists, App Platform would hold
# the app in a pending-domain state, so the first apply runs on the default
# ondigitalocean.app ingress and the public URLs bind to ${APP_URL}. Flip this to
# true once the DNS record is live; that rebuilds the browser bundle, because the
# NEXT_PUBLIC_* values are compiled in at build time.
variable "enable_custom_domain" {
  type    = bool
  default = false
}

variable "instance_count" {
  description = "Production requires at least two app instances."
  type        = number
  default     = 2

  validation {
    condition     = var.instance_count >= 2
    error_message = "Production requires at least two App Platform instances."
  }
}

variable "instance_size_slug" {
  type    = string
  default = "apps-s-1vcpu-2gb"
}

variable "postgres_cluster_id" {
  type    = string
  default = "91243895-3e91-48c3-9c9d-9bd2ca2be34a"
}

variable "postgres_cluster_name" {
  type    = string
  default = "tamamhealth-analytics"
}

variable "postgres_database" {
  type    = string
  default = "tamamhealth"
}

variable "postgres_user" {
  type    = string
  default = "tamamhealth_app"
}

variable "data_droplet_id" {
  type    = number
  default = 591879204
}

variable "couchdb_private_url" {
  description = "Private VPC URL for the CouchDB data plane. This value is server-only."
  type        = string
  default     = "http://10.114.0.3:5984"
}

variable "admin_ssh_cidr" {
  description = "Single trusted operator CIDR for emergency SSH access to the data plane."
  type        = string
  default     = "130.64.64.39/32"
}

variable "runtime_secrets" {
  description = <<-EOT
    Server-only production values. These enter Terraform state even though the
    variable is marked sensitive. Use an encrypted, access-controlled remote
    backend before apply; never commit a tfvars file containing these values.
  EOT
  type = object({
    JWT_SECRET               = string
    PHI_ENCRYPTION_KEY       = string
    COUCHDB_ADMIN_USER       = string
    COUCHDB_ADMIN_PASSWORD   = string
    COUCHDB_GATEWAY_SECRET   = string
    COUCHDB_WEBHOOK_SECRET   = string
    DATABASE_CA_CERT_BASE64  = string
    UPSTASH_REDIS_REST_URL   = string
    UPSTASH_REDIS_REST_TOKEN = string
    AIRTEL_WEBHOOK_SECRET    = string
    MPESA_WEBHOOK_SECRET     = string
  })
  sensitive = true
}
