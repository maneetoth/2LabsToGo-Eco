# Use official Node.js image
FROM node:18-alpine AS builder

WORKDIR /dashboard

# Copy package.json and package-lock.json
COPY dashboard/package.json dashboard/package-lock.json ./

# Install dependencies
RUN npm install

# Copy the rest of the project
COPY dashboard . 

# Build the Next.js app
RUN npm run build

# --- Production image ---
FROM node:18-alpine

WORKDIR /dashboard

COPY --from=builder /dashboard ./

EXPOSE 3000

ENV NODE_ENV=production

CMD ["npm", "start"]