# TamamHealth sync-worker.
#
# Long-running Node 20 process that polls CouchDB _changes for every
# tamamhealth_* database, HMACs each batch, and POSTs to the platform's
# /api/sync webhook so PostgreSQL analytics stays current.
#
# Self-contained: only Node built-ins (fetch, crypto, fs, http). No npm deps.

FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293

# Run as a non-root user. node:20-alpine ships with a `node` user (UID 1000).
# Create the state directory and chown it so SIGTERM-driven flushes work
# without root.
RUN mkdir -p /var/lib/sync-worker && chown -R node:node /var/lib/sync-worker

WORKDIR /app

COPY package.json ./
COPY index.mjs ./

USER node

ENV NODE_ENV=production \
    STATE_FILE=/var/lib/sync-worker/state.json \
    HEARTBEAT_FILE=/var/lib/sync-worker/heartbeat.json

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD node -e "const fs=require('fs');const p=process.env.HEARTBEAT_FILE;const h=JSON.parse(fs.readFileSync(p,'utf8'));if(Date.now()-Date.parse(h.timestamp)>600000)process.exit(1)"

CMD ["node", "index.mjs"]
