FROM node:18-alpine

WORKDIR /app

# Create app directory and set permissions
RUN mkdir -p /app && chown -R node:node /app

# Copy package files and install dependencies
COPY --chown=node:node package*.json ./
RUN npm install --omit=dev

# Copy app source
COPY --chown=node:node . .

# Use non-root user
USER node

# Expose the port the app runs on
EXPOSE 3000

# Start the application
CMD ["node", "server.js"] 