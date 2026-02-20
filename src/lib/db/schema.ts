import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { InferSelectModel, InferInsertModel } from 'drizzle-orm';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull(),
  email: text('email'),
  avatarUrl: text('avatar_url'),
  plexToken: text('plex_token').notNull(),
  role: text('role').notNull().default('user'),
  active: integer('active', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
});

export const pushSubscriptions = sqliteTable('push_subscriptions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at', { mode: 'timestamp' }),
});

export const monitoredDownloads = sqliteTable(
  'monitored_downloads',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    source: text('source').notNull(),
    mediaId: integer('media_id').notNull(),
    title: text('title').notNull(),
    lastStatus: text('last_status'),
    completedAt: integer('completed_at'),
    createdAt: integer('created_at').notNull(),
    lastActivityAt: integer('last_activity_at'),
    lastBytesAt: integer('last_bytes_at'),
  },
  (t) => ({
    sourceMediaIdUnique: uniqueIndex('monitored_downloads_source_media_id_unique').on(
      t.source,
      t.mediaId
    ),
  })
);

export const monitoredDownloadUsers = sqliteTable(
  'monitored_download_users',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    downloadId: integer('download_id')
      .notNull()
      .references(() => monitoredDownloads.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    downloadUserUnique: uniqueIndex('monitored_download_users_download_user_unique').on(
      t.downloadId,
      t.userId
    ),
  })
);

export type User = InferSelectModel<typeof users>;
export type NewUser = InferInsertModel<typeof users>;
export type PushSubscription = InferSelectModel<typeof pushSubscriptions>;
export type NewPushSubscription = InferInsertModel<typeof pushSubscriptions>;
export type MonitoredDownload = InferSelectModel<typeof monitoredDownloads>;
export type MonitoredDownloadUser = InferSelectModel<typeof monitoredDownloadUsers>;
