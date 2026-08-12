output "app_id" {
  value = digitalocean_app.tamamhealth.id
}

output "live_url" {
  value = digitalocean_app.tamamhealth.live_url
}

output "active_deployment_id" {
  value = digitalocean_app.tamamhealth.active_deployment_id
}

output "production_gate" {
  value = "Do not point staging.tamamhealth.org at the app until tenant migration counts, restore drill, and E2E workflow tests pass."
}

