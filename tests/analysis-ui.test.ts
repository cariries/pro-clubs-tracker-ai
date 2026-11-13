import { describe, expect, it } from "vitest";
import { analysisBlockers, canRunAnalysis, describeBlocker, describeScope, describeTruncation, readTruncationTokens, type RunGate } from "@/lib/analysis-ui";
import { MAX_CLUBS, MIN_CLUBS } from "@/lib/club-compare";

const ready: RunGate = { configured: true, demo: false, agreed: true, busy: false, clubs: 2, minClubs: MIN_CLUBS, maxClubs: MAX_CLUBS, question: "Who defends best?" };

describe("the limits the page actually uses", () => {
  it("allows a single club (its own statistics and members) up to four", () => {
    expect(MIN_CLUBS).toBe(1);
    expect(MAX_CLUBS).toBe(4);
  });
});

describe("canRunAnalysis / analysisBlockers (1 to 4 chosen clubs)", () => {
  it("is enabled with 1, 2, 3 or 4 clubs chosen (regression: one club must work)", () => {
    for (const n of [1, 2, 3, 4]) expect(canRunAnalysis({ ...ready, clubs: n }), String(n)).toBe(true);
  });
  it("asks the user to add a club when none is chosen", () => {
    expect(analysisBlockers({ ...ready, clubs: 0 })).toEqual(["add_a_club"]);
  });
  it("blocks more than 4 clubs", () => {
    expect(analysisBlockers({ ...ready, clubs: 5 })).toEqual(["too_many_clubs"]);
  });
  it("the minimum is a parameter: a higher minimum still blocks (generic rule kept working)", () => {
    expect(analysisBlockers({ ...ready, minClubs: 2, clubs: 1 })).toEqual(["add_a_club"]);
  });
  it("needs the privacy tick for a real provider but not in demo mode", () => {
    expect(analysisBlockers({ ...ready, agreed: false })).toEqual(["tick_privacy"]);
    expect(canRunAnalysis({ ...ready, demo: true, agreed: false })).toBe(true);
  });
  it("explains each remaining reason, and lists several at once in the order to fix them", () => {
    expect(analysisBlockers({ ...ready, question: "   " })).toEqual(["type_question"]);
    expect(analysisBlockers({ ...ready, busy: true })).toEqual(["busy"]);
    expect(analysisBlockers({ ...ready, clubs: 0, question: "", agreed: false })).toEqual(["add_a_club", "type_question", "tick_privacy"]);
    expect(analysisBlockers({ ...ready, demo: true, agreed: false, clubs: 0, question: "" })).toEqual(["add_a_club", "type_question"]);
  });
  it("reports only 'not set up' when the service is not configured", () => {
    expect(analysisBlockers({ ...ready, configured: false, clubs: 0, question: "" })).toEqual(["not_configured"]);
  });
  it("fills in the numbers in the bilingual messages, and never mentions saving", () => {
    expect(describeBlocker("too_many_clubs", { min: 1, max: 4 }).en).toBe("You can ask about at most 4 clubs at once. Remove some.");
    expect(describeBlocker("add_a_club", { min: 1, max: 4 }).en).toBe("Add at least 1 club using the search box above.");
    for (const b of ["not_configured", "add_a_club", "too_many_clubs", "type_question", "tick_privacy", "busy"] as const) {
      const x = describeBlocker(b, { min: 1, max: 4 });
      expect(x.en.length, b).toBeGreaterThan(5);
      expect(/[\u3400-\u9fff]/.test(x.zh), `${b} zh`).toBe(true);
      expect(x.en + x.zh).not.toMatch(/\{(min|max|have)\}|[Ss]aved|[Ss]napshot|已儲存|快照/);
    }
  });
});

describe("describeScope: the page always says what will be looked at", () => {
  it("no club yet: says how to add one", () => {
    expect(describeScope({ clubs: 0, maxClubs: 4 }).en).toBe("Search for a club above to add it (up to 4).");
  });
  it("one club: its own statistics and members", () => {
    const t = describeScope({ clubs: 1, maxClubs: 4 });
    expect(t.en).toBe("Looking at this 1 club and its members. Add another club to compare.");
    expect(/[\u3400-\u9fff]/.test(t.zh)).toBe(true);
  });
  it("several clubs: clubs against each other and members across clubs", () => {
    expect(describeScope({ clubs: 3, maxClubs: 4 }).en).toBe("Comparing these 3 clubs (clubs against each other, and members across clubs).");
    expect(describeScope({ clubs: 3, maxClubs: 4 }).zh).toContain("3");
  });
});

describe("describeTruncation: telling the user how many tokens were involved", () => {
  const tok = { inputTokens: 1234, outputTokens: 2000, limit: 2000, estimated: false };
  const zhOk = (t: { zh: string }) => /[\u3400-\u9fff]/.test(t.zh);

  it("when the output limit was fully used: says the full answer needs MORE than the limit, with thousands separators", () => {
    const t = describeTruncation({ ...tok, inputTokens: 12345, outputTokens: 8000, limit: 8000 });
    expect(t.en).toContain("used its whole output limit of 8,000 tokens");
    expect(t.en).toContain("more than 8,000 output tokens");
    expect(t.en).toContain("12,345 input tokens");
    expect(t.zh).toContain("8,000");
    expect(t.zh).toContain("12,345");
    expect(zhOk(t)).toBe(true);
  });

  it("never claims to know the length of the full answer (only that it exceeds the limit)", () => {
    const t = describeTruncation(tok);
    expect(t.en).not.toMatch(/would have|would need exactly|total of \d/);
    expect(t.en).toMatch(/more than 2,000/);
  });

  it("when the figures are estimates, says so and gives approximate numbers", () => {
    const t = describeTruncation({ ...tok, estimated: true });
    expect(t.en).toMatch(/no token count, so these are estimates/);
    expect(t.en).toContain("about 1,234 input tokens");
    expect(t.en).toContain("about 2,000 output tokens");
    expect(t.zh).toContain("估算");
    expect(zhOk(t)).toBe(true);
  });

  it("when the service reports fewer output tokens than the limit yet stopped for length: explains the mismatch, does not pretend otherwise", () => {
    const t = describeTruncation({ ...tok, outputTokens: 600 });
    expect(t.en).toContain("600 output tokens against a limit of 2,000");
    expect(t.en).toMatch(/hidden reasoning/);
    expect(t.en).not.toMatch(/used its whole/);
    expect(zhOk(t)).toBe(true);
  });

  it("handles zero and very large numbers without breaking the formatting", () => {
    expect(describeTruncation({ inputTokens: 0, outputTokens: 0, limit: 100, estimated: false }).en).toContain("0 input tokens");
    expect(describeTruncation({ inputTokens: 1_234_567, outputTokens: 100, limit: 100, estimated: false }).en).toContain("1,234,567");
    expect(describeTruncation({ ...tok, inputTokens: 999 }).en).toContain("999 input tokens");
    expect(describeTruncation({ ...tok, inputTokens: 1000 }).en).toContain("1,000 input tokens");
  });

  it("contains no placeholder text, NaN or undefined", () => {
    for (const t of [tok, { ...tok, estimated: true }, { ...tok, outputTokens: 5 }]) {
      const d = describeTruncation(t);
      expect(d.en + d.zh).not.toMatch(/undefined|NaN|null|\{|\}/);
    }
  });
});

describe("readTruncationTokens: the browser must not trust the response", () => {
  const good = { inputTokens: 100, outputTokens: 2000, limit: 2000, estimated: false };
  it("reads a well-formed tokens field", () => {
    expect(readTruncationTokens({ error: "llm_truncated", tokens: good })).toEqual(good);
  });
  it.each([
    ["no tokens field", { error: "x" }],
    ["null body", null],
    ["a string body", "oops"],
    ["tokens is null", { tokens: null }],
    ["a missing field", { tokens: { inputTokens: 1, outputTokens: 1, limit: 1 } }],
    ["a string count", { tokens: { ...good, outputTokens: "2000" } }],
    ["a negative count", { tokens: { ...good, inputTokens: -1 } }],
    ["NaN", { tokens: { ...good, outputTokens: Number.NaN } }],
    ["Infinity", { tokens: { ...good, limit: Number.POSITIVE_INFINITY } }],
    ["a zero limit", { tokens: { ...good, limit: 0 } }],
    ["estimated not a boolean", { tokens: { ...good, estimated: "yes" } }],
  ])("returns null for %s", (_n, body) => {
    expect(readTruncationTokens(body)).toBeNull();
  });
  it("ignores extra fields instead of passing them on", () => {
    const t = readTruncationTokens({ tokens: { ...good, prompt: "SECRET PROMPT", costUsd: 9.99 } });
    expect(t).toEqual(good);
    expect(JSON.stringify(t)).not.toMatch(/SECRET|9\.99/);
  });
});
