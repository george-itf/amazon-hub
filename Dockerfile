FROM node:20-alpine

WORKDIR /app

# Install server deps (reproducible)
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev

# Copy server code
COPY server ./server

ENV NODE_ENV=production
EXPOSE 3000

CMD ["sh", "-c", "cd server && npm start"]
