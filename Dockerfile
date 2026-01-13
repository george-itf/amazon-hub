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

# Railway sets PORT env var at runtime
EXPOSE 8080

CMD ["npm", "start"]
