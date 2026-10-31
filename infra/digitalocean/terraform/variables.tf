# =============================================================================
# DATA RESIDENCY — READ BEFORE APPLYING
# =============================================================================
# DigitalOcean is the production platform for TamamHealth. It has NO Africa
# region, so every droplet provisioned here stores its data outside South Sudan
# (fra1 = Frankfurt, blr1 = Bangalore).
#
# Holding South Sudanese patient health information on foreign infrastructure
# may conflict with Ministry of Health data-residency requirements. Before the
# production droplet holds real PHI, confirm the hosting agreement or MoH
# approval covers this region. See docs/AFRICA-HOSTING-STRATEGY.md.
# =============================================================================

variable "data_residency_acknowledged" {
  description = <<-EOT
    Explicit acknowledgement that data provisioned here is stored outside South
    Sudan and that the hosting agreement / MoH approval covers that.

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
      outside South Sudan. Confirm the hosting agreement or MoH approval
      covers the chosen region, then set data_residency_acknowledged = true
      in terraform.tfvars.
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
