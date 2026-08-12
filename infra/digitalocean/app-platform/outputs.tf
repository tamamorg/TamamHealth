output "app_id" {
  value = digitalocean_app.v7.id
}

output "live_url" {
  value = digitalocean_app.v7.live_url
}

output "active_deployment_id" {
  value = digitalocean_app.v7.active_deployment_id
}

output "production_gate" {
  value = "Do not point v7.tamamhealth.org at the app until tenant migration counts, restore drill, and E2E workflow tests pass."
}

