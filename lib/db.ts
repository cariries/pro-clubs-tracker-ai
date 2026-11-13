// Lazy Neon + Drizzle client. Created on first use so `next build` works without DATABASE_URL.
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "../db/schema";

let cached: ReturnType<typeof create> | undefined;

function create(url: string) {
  return drizzle(neon(url), { schema });
}

export function dbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
  return (cached ??= create(url));
}
