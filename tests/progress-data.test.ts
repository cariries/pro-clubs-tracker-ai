import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

// Guards the progress tracker (progress-data.js + progress-render.js + the two HTML shells), which both
// language pages render from. These catch drift, not correctness of the claims: only a person can check
// that a status is TRUE.
const read = (f: string) => readFileSync(fileURLToPath(new URL(`../${f}`, import.meta.url)), "utf8");
const CJK = /[㐀-鿿]/;
const STATUSES = ["done", "progress", "todo", "blocked"];

type Bi = { en: string; zh: string };
interface Progress {
  updated: string;
  milestones: Array<{ id: string; title: Bi; items: Array<{ title: Bi; status: string }> }>;
  risks: Bi[];
  log: Array<{ date: string; en: string; zh: string }>;
}

function load(): Progress {
  const sandbox: { window: { PROGRESS?: Progress } } = { window: {} };
  vm.runInNewContext(read("progress-data.js"), sandbox);
  if (!sandbox.window.PROGRESS) throw new Error("progress-data.js did not set window.PROGRESS");
  return sandbox.window.PROGRESS;
}

const isRealDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const bilingual = (b: Bi, where: string) => {
  expect(b.en?.trim().length, `${where} en`).toBeGreaterThan(0);
  expect(b.zh?.trim().length, `${where} zh`).toBeGreaterThan(0);
  expect(CJK.test(b.zh), `${where}: zh has no Chinese characters (English pasted into the Cantonese field?)`).toBe(true);
};

describe("progress-data.js", () => {
  const P = load();

  it("has milestones with unique ids and at least one item each", () => {
    const ids = P.milestones.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of P.milestones) expect(m.items.length, m.id).toBeGreaterThan(0);
  });

  it("uses only the four known statuses", () => {
    for (const m of P.milestones) for (const i of m.items) expect(STATUSES, `${m.id}: ${i.title.en}`).toContain(i.status);
  });

  it("gives every milestone, item, risk and log entry both an English and a Cantonese text", () => {
    for (const m of P.milestones) {
      bilingual(m.title, `milestone ${m.id}`);
      for (const i of m.items) bilingual(i.title, `${m.id} item "${i.title.en.slice(0, 40)}"`);
    }
    P.risks.forEach((r, k) => bilingual(r, `risk ${k}`));
    P.log.forEach((l, k) => bilingual({ en: l.en, zh: l.zh }, `log ${k} (${l.date})`));
  });

  it("keeps the log newest-first with real dates, and `updated` equal to the newest entry", () => {
    expect(isRealDate(P.updated)).toBe(true);
    for (const l of P.log) expect(isRealDate(l.date), l.date).toBe(true);
    for (let i = 1; i < P.log.length; i++) expect(P.log[i].date <= P.log[i - 1].date, `entry ${i} is newer than entry ${i - 1}`).toBe(true);
    expect(P.updated).toBe(P.log[0].date);
  });
});

describe("rendering both languages", () => {
  const P = load();
  const all = P.milestones.flatMap((m) => m.items);
  const expectedPct = Math.round((100 * all.filter((i) => i.status === "done").length) / all.length);

  function render(lang: "en" | "zh") {
    let html = "";
    let title = "";
    const sandbox = {
      window: {} as { PROGRESS?: Progress },
      document: {
        documentElement: { dataset: { lang } },
        getElementById: () => ({ set innerHTML(v: string) { html = v; } }),
        set title(v: string) { title = v; },
      },
    };
    vm.runInNewContext(read("progress-data.js"), sandbox);
    vm.runInNewContext(read("progress-render.js"), sandbox);
    return { html, title };
  }

  it.each(["en", "zh"] as const)("renders the %s page without errors and with the right totals", (lang) => {
    const { html, title } = render(lang);
    expect(title.length).toBeGreaterThan(0);
    expect(html).toContain(`class="pct">${expectedPct}%`);
    expect((html.match(/<h3>/g) ?? []).length).toBe(P.milestones.length);
    expect((html.match(/class="date"/g) ?? []).length).toBe(P.log.length);
    expect(html).toContain(P.updated);
  });

  it("shows Cantonese text on the zh page and English on the en page", () => {
    expect(CJK.test(render("zh").html)).toBe(true);
    expect(render("en").html).toContain(P.milestones[0].items[0].title.en);
    expect(render("zh").html).toContain(P.milestones[0].items[0].title.zh);
  });

  it("escapes markup in data instead of rendering it", () => {
    const sandbox = {
      window: {} as { PROGRESS?: Progress },
      document: { documentElement: { dataset: { lang: "en" } }, getElementById: () => ({ set innerHTML(v: string) { (sandbox as any).out = v; } }), set title(_v: string) {} },
    };
    vm.runInNewContext(read("progress-data.js"), sandbox);
    sandbox.window.PROGRESS!.milestones[0].items[0].title.en = '<img src=x onerror="alert(1)">';
    vm.runInNewContext(read("progress-render.js"), sandbox);
    expect((sandbox as any).out).not.toContain("<img");
    expect((sandbox as any).out).toContain("&lt;img");
  });
});

describe("the two HTML pages", () => {
  it("load the shared data and renderer, set their language, and link to each other", () => {
    const en = read("progress.en.html");
    const zh = read("progress.zh-HK.html");
    for (const html of [en, zh]) {
      expect(html).toContain('src="progress-data.js"');
      expect(html).toContain('src="progress-render.js"');
      expect(html).toContain('href="progress.css"');
    }
    expect(en).toContain('data-lang="en"');
    expect(zh).toContain('data-lang="zh"');
    const renderer = read("progress-render.js");
    expect(renderer).toContain("progress.zh-HK.html");
    expect(renderer).toContain("progress.en.html");
  });
});
