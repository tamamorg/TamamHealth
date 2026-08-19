variable "do_token" {
  description = "DigitalOcean API token (read+write). Pass via TF_VAR_do_token env var — never commit it."
  type        = string
  sensitive   = true
}

variable "domain" {
  description = "Root domain the website is served on (GoDaddy DNS points here)."
  type        = string
  default     = "tamamhealth.org"
}

variable "ssh_public_key_path" {
  description = "Path to the SSH public key granted access to the droplet."
  type        = string
  default     = "~/.ssh/id_ed25519.pub"
}

variable "region" {
  description = "DigitalOcean region slug. DO has no Africa region; Frankfurt/Bangalore are nearest."
  type        = string
  default     = "fra1"
}

variable "droplet_size" {
  description = "Droplet size slug. The website alone (no CouchDB/platform) doesn't need the 4GB the full stack docs recommend."
  type        = string
  default     = "s-1vcpu-2gb"
}

variable "website_image" {
  description = "Local image tag the droplet runs. Deliberately not a registry reference: deploy-website copies the image in over SSH, and a pullable name would invite docker to fetch it on every restart."
  type        = string
  default     = "tamamhealth-website:current"
}
