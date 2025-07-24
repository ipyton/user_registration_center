FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Expose ports
EXPOSE 3000
EXPOSE 8080

# Default command (can be overridden by docker-compose)
CMD ["npm", "start"] 