FROM node:20-alpine

# Railway deployment - backend only
WORKDIR /app

# Copy server package files (both package.json and package-lock.json required for npm ci)
COPY server/package.json server/package-lock.json ./server/

# Install production dependencies only
RUN cd server && npm ci --omit=dev

# Copy server source
COPY server ./server

ENV NODE_ENV=production

# Set working directory to server for runtime
WORKDIR /app/server

# Document the default port (actual port is set by PORT env var at runtime)
EXPOSE 3000

CMD ["npm", "start"]
