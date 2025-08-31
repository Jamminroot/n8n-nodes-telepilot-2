# Dockerfile for building n8n-nodes-telepilot-2 on Alpine Linux
FROM node:22-alpine

# Install build dependencies for native modules
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    gcc \
    libc-dev \
    linux-headers \
    cmake \
    git \
    openssl-dev \
    zlib-dev \
    build-base

# Install gcompat for glibc compatibility on Alpine (musl)
RUN apk add --no-cache gcompat

WORKDIR /build

# Copy package files
COPY package*.json ./

# Install dependencies with native rebuild for musl
RUN npm install --build-from-source

# Copy the rest of the source
COPY . .

# Build the project
RUN npm run build

# Create a symlink for glibc compatibility
RUN mkdir -p /lib64 && ln -sf /lib/ld-musl-x86_64.so.1 /lib64/ld-linux-x86-64.so.2

CMD ["echo", "Build complete"]