import { defineConfig } from "drizzle-kit";

// Used by `npx drizzle-kit generate` (offline, writes SQL to ./drizzle) and `npx drizzle-kit push|migrate`
// (needs DATABASE_URL). Load it from your shell or .env.local before running push/migrate.
export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
