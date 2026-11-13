// Usage ledger (llm_usage table). The cap check and the reservation are ONE atomic statement
// (INSERT ... SELECT ... WHERE <under cap and under limit>), so concurrent analyses can't both slip
// under the cap. The Neon HTTP driver has no transactions, which is why this is a single statement.
import { sql } from "drizzle-orm";
import { llmUsage } from "../../db/schema";
import { getDb } from "../db";

/** The only two operations used here. Tests pass an in-process Postgres; production uses getDb(). */
type Db = Pick<ReturnType<typeof getDb>, "execute" | "update">;

/**
 * USD -> whole micro-USD, rounding UP so a cost is never under-counted. The value is first rounded to the
 * nearest nano-USD to drop floating-point noise: 0.00051 * 1e6 is 510.00000000000006, and a bare Math.ceil
 * would charge 511.
 */
export const toMicro = (usd: number) => Math.max(0, Math.ceil(Math.round(usd * 1e9) / 1000));

export interface ReserveParams {
  userId: string;
  provider: string;
  model: string;
  estMicroUsd: number;
  capMicroUsd: number;
  userLimit: number;
}

/**
 * The reservation statement as a SQL object (no database needed to build or inspect it). Every parameter is
 * cast explicitly: in `INSERT ... SELECT $1, $2` Postgres would otherwise type bare parameters as text and
 * reject the integer column. Executed in tests on PGlite (in-process Postgres); never verified against Neon's HTTP driver.
 */
export function reserveSql(p: ReserveParams) {
  return sql`
    INSERT INTO "llm_usage" ("userId", "provider", "model", "status", "costMicroUsd")
    SELECT ${p.userId}::text, ${p.provider}::text, ${p.model}::text, 'reserved', ${p.estMicroUsd}::integer
    WHERE (SELECT COALESCE(SUM("costMicroUsd"), 0) FROM "llm_usage"
           WHERE "createdAt" >= date_trunc('day', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc') + ${p.estMicroUsd}::bigint <= ${p.capMicroUsd}::bigint
      AND (SELECT COUNT(*) FROM "llm_usage"
           WHERE "userId" = ${p.userId}::text
             AND "createdAt" >= date_trunc('day', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc') < ${p.userLimit}::bigint
    RETURNING "id"
  `;
}

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
}

export type ReserveResult = { ok: true; id: string } | { ok: false };

/**
 * Tries to reserve budget. `{ ok: false }` means over the global cap or the user's daily limit. Cannot tell
 * the two apart from one statement, so the caller reports a generic "limit reached".
 */
export async function reserveBudget(p: ReserveParams, db: Db = getDb()): Promise<ReserveResult> {
  const rows = rowsOf(await db.execute(reserveSql(p)));
  const id = rows[0]?.id;
  return typeof id === "string" ? { ok: true, id } : { ok: false };
}

export async function finalizeUsage(
  id: string,
  v: { status: "ok" | "failed" | "invalid"; inputTokens: number | null; outputTokens: number | null; estimated: boolean; costMicroUsd: number },
  db: Db = getDb(),
): Promise<void> {
  await db
    .update(llmUsage)
    .set({ status: v.status, inputTokens: v.inputTokens, outputTokens: v.outputTokens, estimated: v.estimated, costMicroUsd: v.costMicroUsd })
    .where(sql`${llmUsage.id} = ${id}`);
}
