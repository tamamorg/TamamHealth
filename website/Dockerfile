FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --legacy-peer-deps
COPY . .

# NEXT_PUBLIC_* is read at BUILD time and inlined into the client bundle, so it
# has to be present here — a runtime env var cannot change it afterwards. Every
# login entry point on the site redirects through PLATFORM_URL, so an image
# built without this ships whatever the code default is.
ARG NEXT_PUBLIC_PLATFORM_URL
ENV NEXT_PUBLIC_PLATFORM_URL=${NEXT_PUBLIC_PLATFORM_URL}

# Search-console ownership tokens. Same build-time rule: the tag has to be in
# the HTML the crawler fetches, so it cannot be added by a runtime variable.
# Absent is fine — the tag simply is not emitted — and DNS verification is the
# alternative that needs no rebuild at all.
ARG NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
ENV NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION=${NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION}
ARG NEXT_PUBLIC_BING_SITE_VERIFICATION
ENV NEXT_PUBLIC_BING_SITE_VERIFICATION=${NEXT_PUBLIC_BING_SITE_VERIFICATION}

RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# `output: "standalone"` in next.config.mjs traces the imports the server
# actually reaches and emits just those, so this copies a pruned tree rather
# than all of node_modules.
# --chown on the COPY rather than a `RUN chown -R` afterwards: recursive chown
# rewrites every file into a second layer, which added 76 MB of duplicates.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

# The droplet runs this with `-p 3001:3001` and no command override, so the
# standalone server has to listen where `next start --port 3001` used to.
ENV PORT=3001
ENV HOSTNAME=0.0.0.0
USER node
EXPOSE 3001
CMD ["node", "server.js"]
