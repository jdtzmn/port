FROM ubuntu:24.04

# Install dependencies
RUN apt-get update && apt-get install -y \
    curl \
    unzip \
    git \
    build-essential \
    dnsmasq \
    dnsutils \
    && rm -rf /var/lib/apt/lists/*

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

# Set working directory
WORKDIR /app

# Copy project files
COPY . .

# Install dependencies
RUN bun install

# Build the CLI
RUN bun run build

# Create global port command
RUN ln -s /app/dist/index.js /usr/local/bin/port && chmod +x /app/dist/index.js

# Default command - keep container running
CMD ["sleep", "infinity"]
