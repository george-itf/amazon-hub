FROM node:20-alpine

WORKDIR /app

# Copy server package files (both package.json and package-lock.json required for npm ci)
COPY server/package.json server/package-lock.json ./server/

# Install production dependencies only
RUN cd server && npm ci --omit=dev

# Copy server source
COPY server ./server

ENV NODE_ENV=production

# Document the default port (actual port is set by PORT env var at runtime)
EXPOSE 3000

CMD ["sh", "-c", "cd server && npm start"]
