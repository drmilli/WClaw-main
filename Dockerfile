FROM oven/bun:alpine
WORKDIR /app

# Install dependencies first (cached layer)
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Copy source
COPY . .

# Ensure data directory exists for SQLite
RUN mkdir -p data

# Copy cron schedule (busybox crond reads from /var/spool/cron/crontabs/)
RUN mkdir -p /var/spool/cron/crontabs
COPY docker-crontab /var/spool/cron/crontabs/root
RUN chmod 0600 /var/spool/cron/crontabs/root

# Run busybox crond in foreground (no setpgid, works in Docker without extra caps)
CMD ["busybox", "crond", "-f", "-d", "8"]
