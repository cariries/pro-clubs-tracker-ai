// A deterministic stand-in provider for testing the pipeline with no key and no cost. It reads the digest
// out of the prompt and returns a schema-valid report built from real digest numbers. It does NOT
// analyse anything; its text is placeholder wording, labelled as such.
import type { CompletionRequest, CompletionResult, LlmProvider } from "./provider";

interface FakeDigest {
  mode?: string;
  clubs?: Array<{ name: string; members?: Array<{ name: string; goals: number | null; games: number | null }> }>;
  comparison?: Array<{ metric: string; clubs: Array<{ name: string; value: number | null; rank: number | null }> }>;
}

export function createFakeProvider(): LlmProvider {
  return {
    name: "fake",
    async complete(req: CompletionRequest): Promise<CompletionResult> {
      const lang = /Requested language: zh/.test(req.user) ? "zh" : "en";
      const jsonStart = req.user.indexOf("Digest (JSON):");
      let digest: FakeDigest = {};
      try {
        digest = JSON.parse(req.user.slice(jsonStart + "Digest (JSON):".length).trim());
      } catch {
        /* leave empty */
      }
      const zh = lang === "zh";
      // One club: its members' goals. Several clubs: win rate per club. Both straight from the computed digest.
      const single = digest.mode === "one club on its own";
      const members = (digest.clubs?.[0]?.members ?? []).slice(0, 10);
      const win = digest.comparison?.find((m) => m.metric === "winRate")?.clubs ?? [];
      const report = {
        language: lang,
        headline: zh ? "示範報告(假資料供應商,未有真正 AI 分析)" : "Demo report (fake provider, no real AI analysis)",
        insufficientData: true,
        sections: [
          {
            kind: "summary",
            title: zh ? "說明" : "About this report",
            items: [zh ? "呢份報告由測試用嘅假供應商產生,只係示範版面同流程。" : "This report was produced by the test provider to demonstrate layout and flow. It contains no analysis."],
          },
        ],
        tables: [
          single
            ? {
                title: zh ? "球員入球(來自計算結果)" : "Goals per member (computed values)",
                columns: [zh ? "球員" : "Member", zh ? "入球" : "Goals", zh ? "出場" : "Games"],
                rows: members.map((m) => [m.name, String(m.goals ?? "n/a"), String(m.games ?? "n/a")]),
              }
            : {
                title: zh ? "各球會勝率(來自計算結果)" : "Win rate per club (computed values)",
                columns: [zh ? "球會" : "Club", zh ? "勝率 %" : "Win rate %", zh ? "排名" : "Rank"],
                rows: win.map((c) => [c.name, String(c.value ?? "n/a"), String(c.rank ?? "-")]),
              },
        ],
        charts: [
          single
            ? { title: zh ? "球員入球" : "Goals per member", kind: "bar", unit: zh ? "球" : "goals", labels: members.map((m) => m.name), values: members.map((m) => m.goals ?? 0) }
            : { title: zh ? "勝率" : "Win rate", kind: "bar", unit: "%", labels: win.map((c) => c.name), values: win.map((c) => c.value ?? 0) },
        ],
      };
      const text = JSON.stringify(report);
      return { text, usage: { inputTokens: Math.ceil((req.system.length + req.user.length) / 3), outputTokens: Math.ceil(text.length / 3) }, truncated: false };
    },
  };
}
