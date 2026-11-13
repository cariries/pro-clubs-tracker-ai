import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Black-box tests of scripts/check-progress.mjs against throwaway directories with controlled mtimes.
const SCRIPT = fileURLToPath(new URL("../scripts/check-progress.mjs", import.meta.url));
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "progress-check-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Writes a file whose modification time is `secondsAgo` seconds in the past. */
function put(file: string, secondsAgo: number) {
  const p = join(root, file);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, "x");
  const t = new Date(Date.now() - secondsAgo * 1000);
  utimesSync(p, t, t);
}
const run = () => spawnSync(process.execPath, [SCRIPT, "--root", root], { encoding: "utf8" });

describe("check-progress", () => {
  it("passes when the progress data and both docs are newer than every source file", () => {
    put("lib/a.ts", 300);
    put("app/page.tsx", 300);
    put("package.json", 300);
    for (const d of ["progress-data.js", "CLAUDE.md", "README.md"]) put(d, 10);
    const r = run();
    expect(r.status).toBe(0);
    expect(r.stdout).not.toMatch(/STALE|MISSING/);
  });

  it("fails and names the changed file when code is newer than the progress data", () => {
    for (const d of ["progress-data.js", "CLAUDE.md", "README.md"]) put(d, 100);
    put("lib/new-feature.ts", 5);
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/STALE\s+the progress pages/);
    expect(r.stdout).toContain(join("lib", "new-feature.ts"));
  });

  it("reports each out-of-date file separately", () => {
    put("progress-data.js", 5);
    put("CLAUDE.md", 100);
    put("README.md", 100);
    put("db/schema.ts", 50);
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/ok\s+the progress pages/);
    expect(r.stdout).toMatch(/STALE\s+CLAUDE\.md/);
    expect(r.stdout).toMatch(/STALE\s+README\.md/);
  });

  it("watches tests, scripts, fixtures, migrations and config files too", () => {
    for (const f of ["tests/x.test.ts", "scripts/y.mjs", "fixtures/z.sample.json", "drizzle/0001.sql", ".env.example", "auth.ts"]) {
      for (const d of ["progress-data.js", "CLAUDE.md", "README.md"]) put(d, 100);
      put(f, 5);
      expect(run().status, f).toBe(1);
    }
  });

  it("ignores dependencies, build output, generated migration metadata and the reference folder", () => {
    for (const d of ["progress-data.js", "CLAUDE.md", "README.md"]) put(d, 100);
    for (const f of ["node_modules/pkg/index.js", ".next/cache/x", ".vercel/project.json", "drizzle/meta/_journal.json", "reference/proclubs-sdk/dist/a.js"]) put(f, 5);
    expect(run().status).toBe(0);
  });

  it("fails when a tracked document is missing", () => {
    put("progress-data.js", 10);
    put("CLAUDE.md", 10);
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/MISSING\s+README\.md/);
  });
});
