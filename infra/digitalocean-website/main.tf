resource "digitalocean_container_registry" "main" {
  name                   = "tamamhealth"
  subscription_tier_slug = "starter"
  region                 = var.region
}

resource "digitalocean_ssh_key" "admin" {
  name       = "tamamhealth-website-admin"
  public_key = file(pathexpand(var.ssh_public_key_path))
}

resource "digitalocean_firewall" "website" {
  name = "tamamhealth-website"

  droplet_ids = [digitalocean_droplet.website.id]

  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }
  inbound_rule {
    protocol         = "tcp"
    port_range       = "80"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }
  inbound_rule {
    protocol         = "tcp"
    port_range       = "443"
    source_addresses = ["0.0.0.0/0", "::/0"]
  }

  outbound_rule {
    protocol              = "tcp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
  outbound_rule {
    protocol              = "udp"
    port_range            = "1-65535"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
}

resource "digitalocean_droplet" "website" {
  name     = "tamamhealth-website"
  image    = "ubuntu-22-04-x64"
  region   = var.region
  size     = var.droplet_size
  ssh_keys = [digitalocean_ssh_key.admin.fingerprint]

  user_data = templatefile("${path.module}/cloud-init.tftpl", {
    domain        = var.domain
    website_image = var.website_image
  })
}

resource "digitalocean_reserved_ip" "website" {
  region = var.region
}

resource "digitalocean_reserved_ip_assignment" "website" {
  ip_address = digitalocean_reserved_ip.website.ip_address
  droplet_id = digitalocean_droplet.website.id
}
