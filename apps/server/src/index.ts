// Server entry point: load config, open DB, start HTTP and the daily backup.
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { serve } from '@hono/node-server';
import { loadConfig, repoRoot, ConfigError } from './config.ts';
import { openDatabase } from './db/client.ts';
import { LoginLimiter, SessionStore } from './auth.ts';
import { PushService } from './push.ts';
import { createApp } from './app.ts';
import { PID_FILE, scheduleDailyBackup } from './backup.ts';

dotenv.config({ path: path.join(repoRoot, '.env'), quiet: true });

let config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(`[config] ${err.message}`);
    process.exit(1);
  }
  throw err;
}

const { sqlite, db, close } = openDatabase(config.dataDir);
const sessions = new SessionStore(db, config.sessionDays);
sessions.pruneExpired();

const production = process.env.NODE_ENV === 'production';
const app = createApp({
  config,
  sessions,
  limiter: new LoginLimiter(),
  push: new PushService(db, config),
  serveWeb: production,
});

// The PID file lets "pnpm restore" refuse to run while the server is up.
const pidFile = path.join(config.dataDir, PID_FILE);
fs.writeFileSync(pidFile, String(process.pid));

const stopBackup = scheduleDailyBackup({
  sqlite,
  dataDir: config.dataDir,
  backupDir: config.backupDir,
  hour: config.backupHour,
  keepDays: config.backupKeepDays,
});

const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`NonsTop ${production ? '' : '(dev API) '}running at http://${config.host}:${info.port}`);
});

function shutdown() {
  stopBackup();
  server.close();
  close();
  fs.rmSync(pidFile, { force: true });
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
