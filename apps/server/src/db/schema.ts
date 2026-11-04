// SQLite schema (Drizzle). Sprint 0 holds only infrastructure tables.
// Content tables (page, block, database, property, view, change) arrive in sprint 1
// together with the sync engine, because their per-field HLC columns are designed there.
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

/** Login sessions. `id` is the SHA-256 of the cookie token, so a leaked DB cannot be replayed. */
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
});

/** Web Push subscriptions, one per installed device/browser. */
export const pushSubscriptions = sqliteTable('push_subscriptions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  deviceLabel: text('device_label'),
  createdAt: integer('created_at').notNull(),
});
