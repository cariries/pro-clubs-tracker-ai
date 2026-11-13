// Turns an unexpected exception into (a) a Postgres SQLSTATE code that is safe to show the user and (b) a
// short single-line summary for the server log. Drizzle wraps database errors: the message is a long
// multi-line "Failed query: <SQL> params: ..." and the real reason lives on `.cause`. Logging the whole
// message buries the cause (log viewers split lines) and leaks SQL and parameters, so neither is used.

const SQLSTATE = /^[0-9A-Z]{5}$/;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** First SQLSTATE found on the error or its `.cause` chain (max 4 levels), else null. */
export function dbErrorCode(err: unknown): string | null {
  let cur: unknown = err;
  for (let i = 0; i < 4 && isObj(cur); i++) {
    const code = cur.code;
    if (typeof code === "string" && SQLSTATE.test(code)) return code;
    cur = cur.cause;
  }
  return null;
}

const oneLine = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);

export interface UnexpectedInfo {
  code: string | null;
  /** The innermost message (for a database error: Postgres's own explanation, e.g. relation "x" does not exist). */
  cause: string;
  /** The outer error name and first line only; never the SQL text. */
  summary: string;
}

export function describeUnexpected(err: unknown): UnexpectedInfo {
  let innermost: unknown = err;
  for (let i = 0; i < 4 && isObj(innermost) && isObj(innermost.cause); i++) innermost = innermost.cause;
  const msgOf = (v: unknown) => (v instanceof Error ? v.message : isObj(v) && typeof v.message === "string" ? v.message : String(v));
  const name = err instanceof Error ? err.name : typeof err;
  const firstLine = msgOf(err).split("\n")[0];
  return {
    code: dbErrorCode(err),
    cause: oneLine(msgOf(innermost), 300),
    summary: oneLine(`${name}: ${firstLine}`, 200),
  };
}
