// An in-process Postgres (PGlite) built from the project's REAL migration files, so tests run against
// the same tables the app creates, not a hand-copied schema that could drift.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/db/schema";

const MIGRATIONS = fileURLToPath(new URL("../drizzle/", import.meta.url));

export async function makeDb() {
  const client = new PGlite();
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    for (const stmt of readFileSync(MIGRATIONS + f, "utf8").split("--> statement-breakpoint")) {
      if (stmt.trim()) await client.exec(stmt);
    }
  }
  return { client, db: drizzle(client, { schema }), migrations: files };
}

/** A database with only the migrations BEFORE `stopBefore` (for example "0003") applied, to test migrating real data. */
export async function makeDbBefore(stopBefore: string) {
  const client = new PGlite();
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files.filter((x) => x < stopBefore)) {
    for (const stmt of readFileSync(MIGRATIONS + f, "utf8").split("--> statement-breakpoint")) {
      if (stmt.trim()) await client.exec(stmt);
    }
  }
  return { client, db: drizzle(client, { schema }), pending: files.filter((x) => x >= stopBefore) };
}

/** The SQL statements of one migration file, split the way drizzle-kit writes them. */
export function statementsOf(file: string): string[] {
  return readFileSync(MIGRATIONS + file, "utf8")
    .split("--> statement-breakpoint")
    .map((x) => x.trim())
    .filter(Boolean);
}

/** The statements of the standalone merge script, split by step (it is meant to be run by hand, step by step). */
export function mergeScriptSteps(): { preview: string; delete: string; check: string } {
  const text = readFileSync(fileURLToPath(new URL("../scripts/merge-duplicate-saved-clubs.sql", import.meta.url)), "utf8");
  const stmts = text
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean);
  return { preview: stmts[0], delete: stmts[1], check: stmts[2] };
}
