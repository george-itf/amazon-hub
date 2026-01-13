FROM node:20-alpine

WORKDIR /app

# Copy server package files and install dependencies
COPY server/package*.json ./server/
RUN cd server && npm ci --production

# Copy server source
COPY server ./server

ENV NODE_ENV=production

# Document the default port (actual port is set by PORT env var at runtime)
EXPOSE 3000

CMD ["sh", "-c", "cd server && npm start"]
