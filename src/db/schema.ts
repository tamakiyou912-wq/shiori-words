import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { ConversationContext, TranslationResult } from "@/lib/types";

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("users_username_unique").on(table.username)],
);

export const sessions = pgTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("sessions_user_idx").on(table.userId), index("sessions_expiry_idx").on(table.expiresAt)],
);

export const apiCredentials = pgTable("api_credentials", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  baseUrl: text("base_url").notNull(),
  model: text("model").notNull(),
  encryptedKey: text("encrypted_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const guestCodes = pgTable(
  "guest_codes",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    ownerUserId: text("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name"),
    maxUses: integer("max_uses").notNull().default(20),
    usedUses: integer("used_uses").notNull().default(0),
    enabled: boolean("enabled").notNull().default(true),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("guest_codes_code_unique").on(table.code), index("guest_codes_owner_idx").on(table.ownerUserId)],
);

export const guestSessions = pgTable(
  "guest_sessions",
  {
    id: text("id").primaryKey(),
    codeId: text("code_id").notNull().references(() => guestCodes.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("guest_sessions_code_idx").on(table.codeId), index("guest_sessions_expiry_idx").on(table.expiresAt)],
);

export const conversations = pgTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    guestSessionId: text("guest_session_id").references(() => guestSessions.id, { onDelete: "cascade" }),
    context: jsonb("context").$type<ConversationContext>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [index("conversations_user_idx").on(table.userId), index("conversations_guest_idx").on(table.guestSessionId)],
);

export const translationHistory = pgTable(
  "translation_history",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    input: text("input").notNull(),
    summary: text("summary").notNull(),
    detectedLanguage: text("detected_language").notNull(),
    targetLanguage: text("target_language").notNull(),
    result: jsonb("result").$type<TranslationResult>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("translation_history_user_created_idx").on(table.userId, table.createdAt)],
);

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull().default(0),
});
