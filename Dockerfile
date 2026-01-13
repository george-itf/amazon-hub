FROM node:20-alpine

# Railway deployment - backend only
WORKDIR /app

# Copy server package files (both package.json and package-lock.json required for npm ci)
COPY server/package.json server/package-lock.json ./server/

# Install production dependencies only
RUN cd server && npm ci --omit=dev

# Copy server source
COPY server ./server

# Change ownership to node user for security
RUN chown -R node:node /app

ENV NODE_ENV=production

# Set working directory to server for runtime
WORKDIR /app/server

# Run as non-root user for security
USER node

# Document the default port (Railway sets PORT env var at runtime)
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 3001) + '/health', (r) => { if (r.statusCode !== 200) process.exit(1) })"

CMD ["npm", "start"]
