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

RUN npm run build
# Drop devDependencies (typescript, eslint, @types/*) so the runner stage
# only ships what `next start` needs.
RUN npm prune --omit=dev --legacy-peer-deps

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/public ./public
RUN chown -R node:node /app/.next
USER node
EXPOSE 3001
CMD ["npm", "run", "start"]
