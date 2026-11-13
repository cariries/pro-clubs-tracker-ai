import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(fileURLToPath(new URL(`../${f}`, import.meta.url)), "utf8");

describe("vercel.json", () => {
  const cfg = JSON.parse(read("vercel.json"));

  it("pins the functions to Singapore (sin1), next to the Neon database and where Gemini is reachable", () => {
    expect(cfg.regions).toEqual(["sin1"]);
  });

  it("does not schedule jobs or rewrite anything by accident", () => {
    expect(Object.keys(cfg).sort()).toEqual(["$schema", "regions"]);
  });
});

describe("the analysis route forwards token counts and nothing else sensitive", () => {
  const route = read("app/api/analysis/route.ts");
  it("returns the tokens field only from the failure result", () => {
    expect(route).toMatch(/\.\.\.\(result\.tokens \? \{ tokens: result\.tokens \} : \{\}\)/);
  });
  it("never puts the prompt, the digest, the cost or the provider text into a response body", () => {
    const responses = route.split("\n").filter((l) => l.includes("Response.json"));
    for (const line of responses) expect(line, line).not.toMatch(/prompt|digest|system|costUsd|detail|apiKey/i);
  });
});
