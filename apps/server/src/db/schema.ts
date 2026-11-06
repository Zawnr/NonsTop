// SQLite schema (Drizzle).
// Content (pages now; blocks, databases, properties and views later) is stored per field in
// `field_state`, each field with its own HLC. That is what last-writer-wins per field needs (F-63),
// and new entity types need no migration. Valid entities and fields are defined in @nonstop/shared.
import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';

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

/** Current value of every field: the winner of last-writer-wins. `value` is JSON. */
export const fieldState = sqliteTable(
  'field_state',
  {
    entity: text('entity').notNull(),
    entityId: text('entity_id').notNull(),
    field: text('field').notNull(),
    value: text('value').notNull(),
    hlc: text('hlc').notNull(),
  },
  (t) => [primaryKey({ columns: [t.entity, t.entityId, t.field] })],
);

/**
 * Log of every write the server received, in arrival order. `seq` is the pull cursor.
 * Losing writes are kept with applied = 0, so no edit is ever thrown away.
 */
export const changes = sqliteTable(
  'changes',
  {
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    opId: text('op_id').notNull().unique(),
    entity: text('entity').notNull(),
    entityId: text('entity_id').notNull(),
    field: text('field').notNull(),
    value: text('value').notNull(),
    hlc: text('hlc').notNull(),
    deviceId: text('device_id').notNull(),
    applied: integer('applied', { mode: 'boolean' }).notNull(),
    receivedAt: integer('received_at').notNull(),
  },
  (t) => [index('changes_applied_seq').on(t.applied, t.seq)],
);

/** Server-wide settings. `epoch` identifies this copy of the database (new value after a restore). */
export const serverMeta = sqliteTable('server_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

/**
 * Deadline reminders already sent (F-52), so a reminder goes out once. `fireAt` is the local
 * date and time (`YYYY-MM-DDTHH:MM`): a new time for the same date is a new reminder.
 */
export const remindersSent = sqliteTable(
  'reminders_sent',
  {
    entityId: text('entity_id').notNull(),
    field: text('field').notNull(),
    fireAt: text('fire_at').notNull(),
    sentAt: integer('sent_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.entityId, t.field, t.fireAt] })],
);
