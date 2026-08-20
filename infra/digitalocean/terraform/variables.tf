# =============================================================================
# DATA RESIDENCY — READ BEFORE APPLYING
# =============================================================================
# DigitalOcean has NO Africa region. Every droplet provisioned here stores its
# data outside South Sudan (fra1 = Frankfurt, blr1 = Bangalore).
#
# Holding South Sudanese patient health information on foreign infrastructure
# very likely breaches Ministry of Health data-residency requirements. This
# path is intended for DEMO and STAGING with synthetic data only.
#
# For real patient data use AWS af-south-1 (infra/aws/) or an in-country host.
# See docs/AFRICA-HOSTING-STRATEGY.md.
#
# The `production` droplet defined in main.tf exists for pre-pilot load and
# cutover rehearsal — NOT for live PHI.
# =============================================================================

variable "data_residency_acknowledged" {
  description = <<-EOT
    Explicit acknowledgement that data provisioned here leaves South Sudan and
    must not hold real patient health information.

    Set to true in terraform.tfvars ONLY if you understand the above. `terraform
    apply` fails without it — deliberately, so nobody stands up a PHI-bearing
    droplet by copying a command out of a runbook.
  EOT
  type        = bool
  default     = false

  validation {
    condition     = var.data_residency_acknowledged == true
    error_message = <<-EOT
      Refusing to apply: data_residency_acknowledged is not set.

      DigitalOcean has no Africa region, so this infrastructure stores data
      outside South Sudan and must not hold real PHI. Use AWS af-south-1
      (infra/aws/) or an in-country host for production patient data.

      If this is a demo/staging deployment with synthetic data, set
      data_residency_acknowledged = true in terraform.tfvars.
    EOT
  }
}

variable "do_token" {
  description = "DigitalOcean API token. Prefer: export DIGITALOCEAN_TOKEN=..."
  type        = string
  sensitive   = true
}

variable "region" {
  description = "DO region (e.g. fra1, blr1). No Africa region on DO."
  type        = string
  default     = "fra1"
}

variable "domain" {
  description = "Root domain for DNS (configure A records at your registrar)."
  type        = string
  default     = "tamamhealth.org"
}

variable "ssh_public_key" {
  description = "Contents of your SSH public key (id_ed25519.pub)."
  type        = string
}

variable "admin_ssh_cidr" {
  description = "CIDR allowed to SSH (port 22). Use your public IP/32."
  type        = string
}

variable "project_name" {
  type    = string
  default = "tamamhealth"
}

variable "staging_size" {
  type    = string
  default = "s-2vcpu-4gb"
}

variable "production_size" {
  type    = string
  default = "s-4vcpu-8gb"
}
