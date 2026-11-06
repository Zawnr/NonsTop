// Server entry point: load config, open DB, start HTTP, the daily backup and the reminder check.
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { serve } from '@hono/node-server';
import { loadConfig, repoRoot, ConfigError } from './config.ts';
import { openDatabase } from './db/client.ts';
import { LoginLimiter, SessionStore } from './auth.ts';
import { PushService } from './push.ts';
import { SyncService } from './sync.ts';
import { ReminderService, scheduleReminders } from './reminders.ts';
import { createApp } from './app.ts';
import { isServerRunning, PID_FILE, scheduleDailyBackup } from './backup.ts';

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

// One server per data dir. A second instance would confuse the restore guard.
if (isServerRunning(config.dataDir)) {
  console.error(`[server] Another NonsTop server is already running on ${config.dataDir}. If not, delete ${PID_FILE} there.`);
  process.exit(1);
}

const { sqlite, db, close } = openDatabase(config.dataDir);
const sessions = new SessionStore(db, config.sessionDays);
sessions.pruneExpired();

const production = process.env.NODE_ENV === 'production';
const push = new PushService(db, config);
const app = createApp({
  config,
  sessions,
  limiter: new LoginLimiter(),
  push,
  sync: new SyncService(db),
  serveWeb: production,
});

const pidFile = path.join(config.dataDir, PID_FILE);

const stopBackup = scheduleDailyBackup({
  sqlite,
  dataDir: config.dataDir,
  backupDir: config.backupDir,
  hour: config.backupHour,
  keepDays: config.backupKeepDays,
});

// Deadline reminders (F-52), checked every minute.
const stopReminders = scheduleReminders(new ReminderService(db, (payload) => push.sendToAll(payload)));

const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  // Written only after the port is bound. The PID file lets "pnpm restore" refuse to run while the server is up.
  fs.writeFileSync(pidFile, String(process.pid));
  console.log(`NonsTop ${production ? '' : '(dev API) '}running at http://${config.host}:${info.port}`);
});

function shutdown() {
  stopBackup();
  stopReminders();
  server.close();
  close();
  fs.rmSync(pidFile, { force: true });
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
