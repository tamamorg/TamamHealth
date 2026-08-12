FROM couchdb:3.5.1@sha256:ccea1e8035bf7afd68336e24056a1ca9c1c46d7abe42da686322c0ac7218e5c2

COPY --chown=couchdb:couchdb --chmod=0644 couchdb-local.ini /opt/couchdb/etc/local.d/tamamhealth.ini
