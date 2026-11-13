// Database schema (Neon Postgres via Drizzle).
// The first five tables mirror the defaults that @auth/drizzle-adapter expects (names and columns must
// match). `snapshots` is ours: a user's explicitly saved point-in-time stats, the only EA-derived data
// we persist. Nothing global is stored (see CLAUDE.md).
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

export const users = pgTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
  /** Preferred UI/AI-report language. Added by us (not part of the Auth.js defaults). */
  locale: text("locale").$type<"zh-HK" | "en">().notNull().default("zh-HK"),
});

export const accounts = pgTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [primaryKey({ columns: [account.provider, account.providerAccountId] })],
);

// Unused while sessions are JWTs, but the adapter's types expect these tables to exist.
export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })],
);

export const authenticators = pgTable(
  "authenticator",
  {
    credentialID: text("credentialID").notNull().unique(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    providerAccountId: text("providerAccountId").notNull(),
    credentialPublicKey: text("credentialPublicKey").notNull(),
    counter: integer("counter").notNull(),
    credentialDeviceType: text("credentialDeviceType").notNull(),
    credentialBackedUp: boolean("credentialBackedUp").notNull(),
    transports: text("transports"),
  },
  (a) => [primaryKey({ columns: [a.userId, a.credentialID] })],
);

/** A user-saved, point-in-time copy of a club's parsed stats. Feature built in M4. */
export const snapshots = pgTable(
  "snapshot",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clubId: text("clubId").notNull(),
    platform: text("platform").notNull(),
    /** User-chosen name, e.g. "Before the patch". */
    label: text("label").notNull(),
    /**
     * Bundle of PARSED endpoint results at save time (e.g. { memberStats, overallStats, matches }), from
     * the proxy's `parsed` field. Not `raw`: raw is larger and its field meanings are still unconfirmed.
     */
    data: jsonb("data").notNull(),
    /** Version of the parsed shape in `data`, so old snapshots stay readable when parsers change. */
    schemaVersion: integer("schemaVersion").notNull().default(1),
    /** Small digest (part statuses, counts, bytes) so lists don't have to load the full `data`. */
    summary: jsonb("summary").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  },
  (s) => [index("snapshot_user_created_idx").on(s.userId, s.createdAt)],
);

/**
 * Shared club-data cache (about 15 minutes), the same for every user: EA data only, nothing about who asked.
 * One row per club + platform, overwritten in place on a refetch.
 */
export const clubCache = pgTable(
  "club_cache",
  {
    clubId: text("clubId").notNull(),
    platform: text("platform").notNull(),
    /** The parsed capture (club info, totals, members, career) exactly as lib/club-capture produces it. */
    data: jsonb("data").notNull(),
    fetchedAt: timestamp("fetchedAt", { mode: "date" }).notNull().defaultNow(),
  },
  (c) => [primaryKey({ columns: [c.clubId, c.platform] })],
);

/** Fixed-window counters shared across serverless instances (see lib/rate-limit-db.ts). */
export const rateLimits = pgTable("rate_limit", {
  key: text("key").primaryKey(),
  windowStart: timestamp("windowStart", { mode: "date" }).notNull().defaultNow(),
  count: integer("count").notNull().default(1),
});

/**
 * One row per LLM call (reserved before the call, finalised after). The global daily cap and the
 * per-user daily limit are enforced from this table. Cost is stored in micro-USD (integer) to avoid
 * float drift; $5 = 5,000,000.
 */
export const llmUsage = pgTable(
  "llm_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    /** reserved -> ok | failed | invalid (model answered but the output failed validation). */
    status: text("status").$type<"reserved" | "ok" | "failed" | "invalid">().notNull(),
    inputTokens: integer("inputTokens"),
    outputTokens: integer("outputTokens"),
    /** True when the provider reported no usage and the figures are our estimate. */
    estimated: boolean("estimated").notNull().default(false),
    costMicroUsd: integer("costMicroUsd").notNull(),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  },
  (u) => [index("llm_usage_created_idx").on(u.createdAt), index("llm_usage_user_created_idx").on(u.userId, u.createdAt)],
);
