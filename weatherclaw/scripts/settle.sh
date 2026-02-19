#!/usr/bin/env bash
# settle.sh — OpenClaw wrapper for the settle command
# Triggered by: openclaw cron add --skill weatherclaw --script settle --schedule "0 */1 * * *"

set -euo pipefail

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_DIR="$(cd "$SKILL_DIR/.." && pwd)"

cd "$PROJECT_DIR"
exec bun run src/commands/settle.ts
