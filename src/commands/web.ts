// web.ts — Standalone web dashboard server.
//
// Starts the HTTP dashboard and keeps running (never exits).
// Reads from the shared SQLite database written by scan.ts / settle.ts.
//
// Usage: bun run src/commands/web.ts
// Docker: runs as a separate long-lived service alongside the cron container.

import { startWebDashboard } from "../cli/web.js";
import { logger } from "../logger.js";

startWebDashboard();
logger.info("Web dashboard running — press Ctrl+C to stop");

// Keep the process alive
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
