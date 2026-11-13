#!/usr/bin/env node
// Reminder check: warns when project files changed AFTER the progress data or the handoff docs were last
// saved. It compares file modification times only, so it is a nudge, not proof that an update was
// meaningful. Usage: node scripts/check-progress.mjs [--root <dir>]   (exit 1 when something looks stale)
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const args = process.argv.slice(2);
const at = args.indexOf("--root");
const root = at >= 0 && args[at + 1] ? args[at + 1] : process.cwd();

const WATCH_DIRS = ["app", "lib", "db", "tests", "scripts", "drizzle", "fixtures"];
const WATCH_FILES = ["auth.ts", "package.json", ".env.example", "tsconfig.json", "vitest.config.mts", "drizzle.config.ts", "next.config.js"];
const DOCS = [
  ["progress-data.js", "the progress pages (progress-data.js)"],
  ["CLAUDE.md", "CLAUDE.md"],
  ["README.md", "README.md"],
];
// Dependencies, build output and generated migration metadata are not "changes to the project".
const IGNORE = new Set(["node_modules", ".next", ".vercel", ".git", "meta"]);

function walk(dir, out) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (IGNORE.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push({ path: p, mtime: st.mtimeMs });
  }
}

const files = [];
for (const d of WATCH_DIRS) walk(join(root, d), files);
for (const f of WATCH_FILES) {
  const p = join(root, f);
  if (existsSync(p)) files.push({ path: p, mtime: statSync(p).mtimeMs });
}

let problems = 0;
for (const [file, label] of DOCS) {
  const p = join(root, file);
  if (!existsSync(p)) {
    problems++;
    console.log(`MISSING  ${label}`);
    continue;
  }
  const docTime = statSync(p).mtimeMs;
  const newer = files.filter((f) => f.mtime > docTime).sort((a, b) => b.mtime - a.mtime);
  if (newer.length === 0) {
    console.log(`ok       ${label}`);
    continue;
  }
  problems++;
  console.log(`STALE    ${label} is older than ${newer.length} changed file(s):`);
  for (const f of newer.slice(0, 5)) console.log(`           ${relative(root, f.path)}`);
  if (newer.length > 5) console.log(`           ...and ${newer.length - 5} more`);
}

if (problems > 0) {
  console.log("\nUpdate progress-data.js (item statuses, a dated log entry in English and Cantonese, the `updated` date, risks),");
  console.log("then CLAUDE.md and README.md, and re-run. Rule: CLAUDE.md > Maintenance Rules.");
  process.exit(1);
}
