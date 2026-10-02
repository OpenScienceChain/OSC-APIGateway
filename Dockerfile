# Node 24 is the active LTS line. The digest pins the multi-platform image index.
FROM node:24.20.0-alpine3.24@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf AS build
WORKDIR /app
# Build tools needed for native addons (e.g. bcrypt)
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json .npmrc ./
COPY scripts/security/check_npm_supply_chain.py ./scripts/security/check_npm_supply_chain.py
COPY security/npm-malware-blocklist.csv security/npm-lifecycle-allowlist.json ./security/
RUN python3 scripts/security/check_npm_supply_chain.py --repo . --offline-reviewed --skip-installed \
  && npm ci --ignore-scripts --no-audit --fund=false \
  && npm audit signatures \
  && npm rebuild bcrypt@6.0.0 --ignore-scripts=false \
  && python3 scripts/security/check_npm_supply_chain.py --repo . --offline-reviewed
COPY . .
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:24.20.0-alpine3.24@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf AS production
WORKDIR /app

# Require the fixed OpenSSL floor from Alpine's repository. The image scan
# remains the gate for any other newly disclosed vulnerability.
# npm is a build tool, not a runtime dependency.
RUN apk add --no-cache 'libcrypto3>=3.5.8-r0' 'libssl3>=3.5.8-r0' \
  && rm -rf /usr/local/lib/node_modules/npm \
  /usr/local/bin/npm \
  /usr/local/bin/npx

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nestjs -u 1001

# Copy built application and pruned production node_modules from build stage
COPY --from=build --chown=nestjs:nodejs /app/dist ./dist
COPY --from=build --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --chown=nestjs:nodejs package*.json ./

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/v1/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

USER nestjs
EXPOSE 3000

CMD ["node", "dist/main"]
