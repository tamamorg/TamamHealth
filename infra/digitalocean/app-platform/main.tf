locals {
  # $${APP_URL} is an App Platform bindable variable resolved to the app's own
  # public URL. It is the only way to reference the default ingress, whose
  # hostname carries a random suffix that is not knowable before creation.
  public_base_url = var.enable_custom_domain ? "https://${var.domain}" : "$${APP_URL}"
}

resource "digitalocean_app" "tamamhealth" {
  spec {
    name                            = var.app_name
    region                          = var.app_region
    enhanced_threat_control_enabled = true

    dynamic "domain" {
      for_each = var.enable_custom_domain ? [var.domain] : []
      content {
        name = domain.value
        type = "PRIMARY"
      }
    }

    vpc {
      id = var.vpc_id
    }

    database {
      name         = "analytics-db"
      engine       = "PG"
      production   = true
      cluster_name = var.postgres_cluster_name
      db_name      = var.postgres_database
      db_user      = var.postgres_user
    }

    service {
      name               = "platform"
      instance_count     = var.instance_count
      instance_size_slug = var.instance_size_slug
      source_dir         = "/platform"
      dockerfile_path    = "Dockerfile"
      http_port          = 3000

      github {
        repo           = var.github_repo
        branch         = var.github_branch
        deploy_on_push = false
      }

      # Readiness: the deep check. A 503 here means CouchDB or the analytics
      # database is unreachable, so this instance should not take traffic and a
      # bad deployment should not be promoted.
      health_check {
        http_path             = "/api/health"
        initial_delay_seconds = 30
        period_seconds        = 15
        timeout_seconds       = 8
        success_threshold     = 1
        failure_threshold     = 3
      }

      # Liveness: process-only, never dependency-aware. Pointing this at the
      # deep check would let a CouchDB blip restart every instance at once, and
      # the restarts could not succeed until the dependency recovered.
      liveness_health_check {
        http_path             = "/api/health/live"
        initial_delay_seconds = 60
        period_seconds        = 30
        timeout_seconds       = 8
        success_threshold     = 1
        failure_threshold     = 5
      }

      alert {
        rule     = "CPU_UTILIZATION"
        value    = 80
        operator = "GREATER_THAN"
        window   = "TEN_MINUTES"
      }

      alert {
        rule     = "MEM_UTILIZATION"
        value    = 85
        operator = "GREATER_THAN"
        window   = "TEN_MINUTES"
      }

      alert {
        rule     = "RESTART_COUNT"
        value    = 3
        operator = "GREATER_THAN"
        window   = "TEN_MINUTES"
      }

      env {
        key   = "NEXT_PUBLIC_DEMO_MODE"
        value = "false"
        scope = "RUN_AND_BUILD_TIME"
      }
      env {
        key   = "NEXT_PUBLIC_SYNC_ENABLED"
        value = "true"
        scope = "RUN_AND_BUILD_TIME"
      }
      env {
        key   = "NEXT_PUBLIC_COUCHDB_TENANT_DATABASES_ENABLED"
        value = "true"
        scope = "RUN_AND_BUILD_TIME"
      }
      env {
        key   = "NEXT_PUBLIC_COUCHDB_GATEWAY_ENABLED"
        value = "true"
        scope = "RUN_AND_BUILD_TIME"
      }
      env {
        key   = "NEXT_PUBLIC_COUCHDB_URL"
        value = "${local.public_base_url}/api/couch"
        scope = "RUN_AND_BUILD_TIME"
      }
      env {
        key   = "NEXT_PUBLIC_APP_URL"
        value = local.public_base_url
        scope = "RUN_AND_BUILD_TIME"
      }
      env {
        key   = "NEXT_PUBLIC_CLEAR_SEEDED_DATA_ONCE"
        value = "false"
        scope = "RUN_AND_BUILD_TIME"
      }

      env {
        key   = "COUCHDB_URL"
        value = var.couchdb_private_url
        scope = "RUN_TIME"
      }
      # At-rest PHI protection is full-disk/volume encryption on the data
      # droplet + device encryption on clinician machines. Field-level app
      # encryption is a no-op on the offline-first browser write path and
      # breaks browser reads, so it stays OFF (see config-validation.ts and
      # docs/GO-LIVE-STEP-BY-STEP.md).
      env {
        key   = "PHI_AT_REST_STRATEGY"
        value = "disk-encryption"
        scope = "RUN_TIME"
      }
      env {
        key   = "SINGLE_ORG_MODE"
        value = "false"
        scope = "RUN_TIME"
      }
      env {
        key   = "DATABASE_URL"
        value = "$${analytics-db.DATABASE_PRIVATE_URL}"
        scope = "RUN_TIME"
        type  = "SECRET"
      }
      env {
        key   = "DATABASE_DIRECT_URL"
        value = "$${analytics-db.DATABASE_PRIVATE_URL}"
        scope = "RUN_TIME"
        type  = "SECRET"
      }

      dynamic "env" {
        for_each = nonsensitive(toset(keys(var.runtime_secrets)))
        content {
          key   = env.value
          value = var.runtime_secrets[env.value]
          scope = "RUN_TIME"
          type  = "SECRET"
        }
      }
    }

    ingress {
      rule {
        component {
          name = "platform"
        }
        match {
          path {
            prefix = "/"
          }
        }
      }
    }

    alert { rule = "DEPLOYMENT_FAILED" }
    alert { rule = "DOMAIN_FAILED" }
  }

  lifecycle {
    precondition {
      condition     = can(regex("^http://10\\.[0-9]+\\.[0-9]+\\.[0-9]+:5984$", var.couchdb_private_url))
      error_message = "CouchDB must use its private 10.x VPC address; browsers connect only through the authenticated same-origin gateway."
    }
  }
}

# Import the existing firewall before the first plan:
# terraform import digitalocean_firewall.data_plane 265e3909-f1e4-43e9-94d1-92e701fa122b
# The existing public HTTPS rules remain temporarily so the migration and
# verification scripts can reach CouchDB. Port 5984 is only
# reachable from the FRA1 VPC and is never exposed directly to browsers.
resource "digitalocean_firewall" "data_plane" {
  name        = "tamamhealth-data-production"
  droplet_ids = [var.data_droplet_id]

  inbound_rule {
    protocol         = "tcp"
    port_range       = "22"
    source_addresses = [var.admin_ssh_cidr]
  }

  # Public 80/443 are opt-in (var.enable_public_data_plane, default false).
  # Committing them as always-open meant a later apply would revert the manual
  # post-cutover firewall closure and silently re-expose CouchDB to the
  # internet. Kept off by default so the hardened state is the committed state.
  dynamic "inbound_rule" {
    for_each = var.enable_public_data_plane ? ["80", "443"] : []
    content {
      protocol         = "tcp"
      port_range       = inbound_rule.value
      source_addresses = ["0.0.0.0/0", "::/0"]
    }
  }

  inbound_rule {
    protocol         = "tcp"
    port_range       = "5984"
    source_addresses = ["10.114.0.0/20"]
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

  outbound_rule {
    protocol              = "icmp"
    destination_addresses = ["0.0.0.0/0", "::/0"]
  }
}

# Attaching the existing production cluster makes the app its sole trusted
# source. Add operator IPs only temporarily during a documented migration.
resource "digitalocean_database_firewall" "analytics" {
  cluster_id = var.postgres_cluster_id

  rule {
    type  = "app"
    value = digitalocean_app.tamamhealth.id
  }

  # The current data Droplet runs encrypted off-site pg_dump jobs. Its VPC
  # private route stays trusted so backups continue after App Platform cutover.
  rule {
    type  = "droplet"
    value = tostring(var.data_droplet_id)
  }
}
