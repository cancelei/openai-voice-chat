FROM node:18-alpine

WORKDIR /app

# Create app directory and set permissions
RUN mkdir -p /app && chown -R node:node /app

# Copy package files and install dependencies
COPY --chown=node:node package*.json ./
RUN npm ci --only=production

# Copy app source
COPY --chown=node:node . .

# Set environment variables (will be overridden by CapRover environment variables)
ENV PORT=3000
ENV NODE_ENV=production

# Use non-root user
USER node

# Expose the port the app runs on
EXPOSE 3000

# Start the application
CMD ["node", "server.js"] 