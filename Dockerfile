FROM oven/bun:alpine
WORKDIR /app

# Install dcron for cron scheduling inside the container
RUN apk add --no-cache dcron

# Install dependencies first (cached layer)
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Copy source
COPY . .

# Ensure data directory exists for SQLite
RUN mkdir -p data

# Copy cron schedule
COPY docker-crontab /etc/crontabs/root
RUN chmod 0644 /etc/crontabs/root

# Run crond in foreground
CMD ["crond", "-f", "-d", "8"]
