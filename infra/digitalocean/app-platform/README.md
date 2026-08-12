# TamamHealth on DigitalOcean App Platform

This stack creates the TamamHealth application. It attaches
the existing `tamamhealth-analytics` PostgreSQL cluster, connects the app to the
existing FRA1 VPC, requires two app instances, and restricts PostgreSQL trusted
sources to the App Platform app and the encrypted-backup Droplet.

It intentionally does not create another CouchDB Droplet or PostgreSQL cluster.
The current production inventory is referenced by ID/name to prevent duplicate
spend. The existing `tamamhealth-data-production` cloud firewall is imported
and managed here. It exposes CouchDB port 5984 only to the private FRA1 VPC.
Browsers use the authenticated same-origin `/api/couch` gateway and never
receive CouchDB credentials or direct database access.

## Safety gates

1. Execute the CouchDB tenant migration in dry-run mode.
2. Run the real non-destructive copy with shared access retained.
3. Verify document counts and bidirectional replication for reception, nursing,
   doctor, pharmacy, billing, ward, and audit databases.
4. Complete an encrypted off-site restore drill.
5. Apply this stack to staging/synthetic data and pass E2E tests.
6. Obtain the required healthcare/data-processing agreements and residency
   approval before storing real PHI.
7. Only then finalize shared CouchDB access and approve production deployment.

## Commands

```bash
cp backend.hcl.example backend.hcl
export AWS_ACCESS_KEY_ID='your-dedicated-spaces-key'
export AWS_SECRET_ACCESS_KEY='your-dedicated-spaces-secret'
terraform init -backend-config=backend.hcl
terraform import digitalocean_firewall.data_plane 265e3909-f1e4-43e9-94d1-92e701fa122b
terraform fmt -check -recursive
terraform validate
terraform plan -out=tamamhealth.tfplan
terraform show tamamhealth.tfplan
```

`terraform apply` creates paid App Platform capacity and changes PostgreSQL
trusted sources. It requires a separate explicit production approval. Secret
values are stored in Terraform state; configure an encrypted, tightly scoped
remote backend before supplying `runtime_secrets`.

Use a dedicated private Spaces bucket with versioning enabled and a dedicated
least-privilege key. Terraform state locking is not provided by Spaces, so only
one protected deployment job or operator may run `plan`/`apply` at a time.

Before starting the data stack, set `COUCHDB_BIND_ADDRESS=10.114.0.3` on
the data Droplet. Keep it at the example default (`127.0.0.1`) everywhere else.
The public HTTPS endpoint remains available during migration; remove its
public firewall and DNS access only after the documented cutover succeeds.

The current IDs in `variables.tf` were read from the `Tamam Health` team on
2026-08-12. Re-run `doctl vpcs list`, `doctl compute droplet list`, and
`doctl databases list` before apply if resources have changed.
