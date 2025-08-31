# Alpine Linux / Docker Installation Guide

## Issue
The standard n8n Docker image uses Alpine Linux with musl libc, which is not directly compatible with the prebuilt TDLib binaries that are compiled for glibc.

## Solution

### Option 1: Use gcompat (Recommended)
Add the following to your n8n Dockerfile to enable glibc compatibility:

```dockerfile
# Add this after the FROM n8nio/n8n line
USER root

# Install gcompat for glibc compatibility
RUN apk add --no-cache gcompat

# Install build tools for native modules
RUN apk add --no-cache python3 make g++ gcc libc-dev linux-headers

# Create glibc compatibility symlink
RUN mkdir -p /lib64 && ln -sf /lib/ld-musl-x86_64.so.1 /lib64/ld-linux-x86-64.so.2

USER node

# Install the telepilot package
RUN cd ~/.n8n && npm install n8n-nodes-telepilot-2
```

### Option 2: Build from source
If gcompat doesn't work, you can build the native modules from source:

```dockerfile
# Add this after the FROM n8nio/n8n line
USER root

# Install build dependencies
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

USER node

# Install with native rebuild
RUN cd ~/.n8n && npm install n8n-nodes-telepilot-2 --build-from-source
```

### Option 3: Use Debian-based n8n image
Instead of the default Alpine-based image, use the Debian variant:

```dockerfile
FROM n8nio/n8n:latest-debian

# Install the package normally
RUN cd ~/.n8n && npm install n8n-nodes-telepilot-2
```

## Docker Compose Example

```yaml
version: '3.8'

services:
  n8n:
    image: n8nio/n8n:latest
    user: root
    environment:
      - N8N_BASIC_AUTH_ACTIVE=true
      - N8N_BASIC_AUTH_USER=admin
      - N8N_BASIC_AUTH_PASSWORD=password
    ports:
      - "5678:5678"
    volumes:
      - n8n_data:/home/node/.n8n
    command: >
      sh -c "
      apk add --no-cache gcompat python3 make g++ &&
      mkdir -p /lib64 &&
      ln -sf /lib/ld-musl-x86_64.so.1 /lib64/ld-linux-x86-64.so.2 &&
      su node -c 'cd ~/.n8n && npm install n8n-nodes-telepilot-2' &&
      su node -c 'n8n start'
      "

volumes:
  n8n_data:
```

## Verification
After installation, verify that the module loads correctly:

1. Restart n8n
2. Go to Settings → Community Nodes
3. Check that "n8n-nodes-telepilot-2" appears in the list
4. Try creating a workflow with the TelePilot2 node

## Troubleshooting

If you still get errors:

1. Check the logs: `docker logs <container_name>`
2. Verify gcompat is installed: `docker exec <container_name> apk list | grep gcompat`
3. Check if the symlink exists: `docker exec <container_name> ls -la /lib64/`
4. Try rebuilding from source: `npm rebuild tdl --build-from-source`

## Known Issues
- The tdl package doesn't provide prebuilt binaries for musl libc
- Some Alpine Linux versions may require additional dependencies
- Performance may be slightly reduced when using gcompat compatibility layer